import { useState, useEffect, useCallback, useRef } from 'react';
import { Telemetry, MissionStatus, LogEntry, PacketEntry, ConnectionState, QueueItem } from '../types';
import * as api from '../api';

const STALE_THRESHOLD_MS = 3000;

export function useBridge() {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [missionStatus, setMissionStatus] = useState<MissionStatus>({
    loaded: false, mission_id: null, running: false, paused: false, step_idx: 0, total_steps: 0
  });
  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [packets, setPackets] = useState<PacketEntry[]>([]);

  // Mission queue
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const queueProcessing = useRef(false);
  const queueAbortRef = useRef<AbortController | null>(null);

  const lastTelemetryTime = useRef<number>(0);
  const lastValidTelemetryTime = useRef<number>(0);
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = useCallback((source: LogEntry['source'], message: string, isAlert = false) => {
    setLogs(prev => [
      { id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), source, message, isAlert },
      ...prev
    ].slice(0, 200));
  }, []);

  const addPacket = useCallback((direction: 'TX' | 'RX', type: string, payload: string) => {
    setPackets(prev => [
      { id: Math.random().toString(36).substr(2, 9), timestamp: new Date(), direction, type, payload },
      ...prev
    ].slice(0, 500));
  }, []);

  // Poll Mission Status every 1s
  useEffect(() => {
    const pollStatus = async () => {
      try {
        const data = await api.getMissionStatus();
        setMissionStatus(data);
      } catch {
        // Connection state handled by SSE
      }
    };
    const interval = setInterval(pollStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  // SSE Telemetry with STALE detection
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const unsubscribe = api.subscribeTelemetry(
        (data) => {
          setTelemetry(data);
          lastTelemetryTime.current = Date.now();

          if (Math.random() < 0.1) {
            addPacket('RX', 'TEL', JSON.stringify(data));
          }

          if (data.survivor_lock) {
            setTelemetry(prev => {
              if (!prev?.survivor_lock) {
                addLog('SYS', 'SURVIVOR LOCK DETECTED', true);
              }
              return data;
            });
          }

          // Only count messages with real telemetry as "valid"
          if (api.isValidTelemetry(data)) {
            lastValidTelemetryTime.current = Date.now();
            // Transition from BRIDGE_ONLY → CONNECTED on first real data
            setConnectionState(prev => prev === 'BRIDGE_ONLY' ? 'CONNECTED' : prev);
          }
        },
        () => {
          setConnectionState('DISCONNECTED');
          addLog('SYS', 'Telemetry link lost.', true);
          if (staleTimerRef.current) clearInterval(staleTimerRef.current);
          reconnectTimer = setTimeout(connect, 3000);
        }
      );

      setConnectionState('CONNECTING');
      lastTelemetryTime.current = Date.now();
      lastValidTelemetryTime.current = 0;

      if (staleTimerRef.current) clearInterval(staleTimerRef.current);
      staleTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - lastValidTelemetryTime.current;
        setConnectionState(prev => {
          if (prev === 'DISCONNECTED') return prev;
          if (lastValidTelemetryTime.current > 0) {
            return elapsed > STALE_THRESHOLD_MS ? 'STALE' : 'CONNECTED';
          }
          if (lastTelemetryTime.current > 0) return 'BRIDGE_ONLY';
          return prev;
        });
      }, 1000);

      eventSourceUnsub.current = unsubscribe;
    };

    const eventSourceUnsub = { current: null as (() => void) | null };

    connect();

    return () => {
      eventSourceUnsub.current?.();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (staleTimerRef.current) clearInterval(staleTimerRef.current);
    };
  }, [addLog, addPacket]);

  // Command dispatch
  const sendCommand = useCallback(async (type: string, params: Record<string, unknown> = {}) => {
    const payload = { type, ...params };
    addPacket('TX', 'CMD', JSON.stringify(payload));
    addLog('CMD', `Dispatching command: ${type.toUpperCase()}`);

    try {
      const result = await api.sendCommand(type, params);

      if (type === 'sos' && typeof result.mission_paused === 'boolean') {
        setMissionStatus(prev => ({
          ...prev,
          paused: result.mission_paused,
          running: result.mission_paused ? false : prev.running,
        }));
      }

      addLog('SYS', `Command acknowledged: ${type.toUpperCase()}`);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      addLog('SYS', `Command failed: ${type.toUpperCase()} — ${msg}`, true);
      return { ok: false, error: msg };
    }
  }, [addLog, addPacket]);

  // Deploy single mission (backward compat)
  const deployMission = useCallback(async (mission: { mission_id: string; plan: unknown[] }) => {
    addLog('MSN', `Deploying mission: ${mission.mission_id} (${mission.plan.length} steps)`);

    try {
      const saveResult = await api.saveMission(mission);
      const loadResult = await api.loadMission(saveResult.filename);

      setMissionStatus(prev => ({
        ...prev,
        loaded: true,
        mission_id: loadResult.mission_id,
        total_steps: mission.plan.length,
        running: false,
        paused: false,
        step_idx: 0,
      }));

      addLog('SYS', `Mission deployed: ${loadResult.mission_id}`);
      return { ok: true as const, mission_id: loadResult.mission_id, total_steps: mission.plan.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      addLog('SYS', `Deploy failed: ${msg}`, true);
      return { ok: false as const, error: msg };
    }
  }, [addLog]);

  // Mission control: run/pause/resume/abort only
  const sendMissionControl = useCallback(async (endpoint: string) => {
    addPacket('TX', 'MSN', JSON.stringify({ endpoint }));
    addLog('MSN', `Requesting: ${endpoint.toUpperCase()}`);

    try {
      let result: Record<string, unknown>;
      switch (endpoint) {
        case 'run': result = await api.runMission(); break;
        case 'pause': result = await api.pauseMission(); break;
        case 'resume': result = await api.resumeMission(); break;
        case 'abort': result = await api.abortMission(); break;
        default: throw new Error(`Unknown mission endpoint: ${endpoint}`);
      }

      addLog('SYS', `Acknowledged: ${endpoint.toUpperCase()}`);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      addLog('SYS', `Failed: ${endpoint.toUpperCase()} — ${msg}`, true);
      return { ok: false, error: msg };
    }
  }, [addLog, addPacket]);

  // --- Mission Queue ---

  const addToQueue = useCallback((mission: { mission_id: string; plan: unknown[] }) => {
    const item: QueueItem = {
      id: `${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      mission,
      status: 'queued',
    };
    setQueue(prev => [...prev, item]);
    addLog('MSN', `Added to queue: ${mission.mission_id}`);
  }, [addLog]);

  const removeFromQueue = useCallback((id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id));
  }, []);

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    setQueue(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => {
    queueAbortRef.current?.abort();
    queueProcessing.current = false;
    setQueue([]);
    setQueueIndex(0);
    addLog('MSN', 'Queue cleared');
  }, [addLog]);

  const startQueue = useCallback(() => {
    if (queueProcessing.current) return;
    queueProcessing.current = true;
    const abort = new AbortController();
    queueAbortRef.current = abort;
    setQueueIndex(0);
    addLog('MSN', `Starting queue`);

    const waitForCompletion = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
      const check = async () => {
        if (signal.aborted) { resolve(); return; }
        try {
          const status = await api.getMissionStatus();
          if (!status.running && !status.paused) {
            resolve();
          } else {
            setTimeout(check, 1000);
          }
        } catch (err) {
          reject(err);
        }
      };
      check();
    });

    const processAll = async () => {
      const signal = abort.signal;
      const snapshot = queue;
      for (let i = 0; i < snapshot.length; i++) {
        if (!queueProcessing.current || signal.aborted) break;

        const item = snapshot[i];
        if (item.status !== 'queued') continue;

        setQueueIndex(i);

        try {
          setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'saving' } : q));
          const saveResult = await api.saveMission(item.mission);
          if (!queueProcessing.current || signal.aborted) break;

          const loadResult = await api.loadMission(saveResult.filename);
          if (!queueProcessing.current || signal.aborted) break;
          setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'loaded', filename: saveResult.filename } : q));
          setMissionStatus(prev => ({
            ...prev,
            loaded: true,
            mission_id: loadResult.mission_id,
            total_steps: item.mission.plan.length,
            running: false,
            paused: false,
            step_idx: 0,
          }));

          await api.runMission();
          if (!queueProcessing.current || signal.aborted) break;
          setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'running' } : q));

          await waitForCompletion(signal);
          if (!queueProcessing.current || signal.aborted) break;

          setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'completed' } : q));
          addLog('SYS', `Mission completed: ${item.mission.mission_id}`);
        } catch (err) {
          if (!queueProcessing.current || signal.aborted) break;
          const msg = err instanceof Error ? err.message : 'unknown error';
          setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'failed', error: msg } : q));
          addLog('SYS', `Queue item failed: ${item.mission.mission_id} — ${msg}`, true);
        }
      }

      queueProcessing.current = false;
      addLog('SYS', 'Queue processing complete');
    };

    processAll();
  }, [queue, addLog]);

  const abortQueue = useCallback(async () => {
    queueAbortRef.current?.abort();
    queueProcessing.current = false;
    await sendMissionControl('abort');
    setQueue(prev => prev.map((item, i) =>
      i === queueIndex ? { ...item, status: 'failed' as const, error: 'Aborted by operator' } : item
    ));
    addLog('MSN', 'Queue aborted by operator');
  }, [sendMissionControl, queueIndex, addLog]);

  return {
    telemetry,
    missionStatus,
    connectionState,
    logs,
    packets,
    sendCommand,
    sendMissionControl,
    deployMission,
    addLog,
    queue,
    queueIndex,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    startQueue,
    abortQueue,
  };
}
