import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Bento } from '../components/Bento';
import { MissionMap } from '../components/MissionMap';
import { CesiumTerrainMapView } from '../components/CesiumTerrainMapView';
import { Telemetry, MissionStatus, LogEntry, ConnectionState, QueueItem, QUEUE_STATUS_COLORS, QUEUE_STATUS_LABELS } from '../types';
import { isValidTelemetry } from '../api';
import {
  Radio, Activity, Search, Loader2, Layers, Box,
  Gauge, Navigation2, ListOrdered, AlertTriangle, Terminal, ScrollText,
} from 'lucide-react';

type DockKey = 'telemetry' | 'missionControl' | 'queue' | 'sos' | 'cli' | 'logs';

interface FeedbackPageProps {
  telemetry: Telemetry | null;
  missionStatus: MissionStatus;
  logs: LogEntry[];
  connectionState: ConnectionState;
  onCommand: (type: string, params?: Record<string, unknown>) => Promise<unknown>;
  onMissionControl: (endpoint: string) => Promise<unknown>;
  queue: QueueItem[];
  queueIndex: number;
  abortQueue: () => void;
  removeFromQueue: (id: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
}

export const FeedbackPage: React.FC<FeedbackPageProps> = ({
  telemetry, missionStatus, logs, connectionState, onCommand, onMissionControl, queue, queueIndex, abortQueue, removeFromQueue, reorderQueue, clearQueue
}) => {
  const [mapMode, setMapMode] = useState<'3D' | 'MAP'>('MAP');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'searching' | 'error'>('idle');
  const [searchErrorMsg, setSearchErrorMsg] = useState('');
  const [searchTarget, setSearchTarget] = useState<{ lat: number; lon: number; ts: number } | null>(null);

  const [sosAlt, setSosAlt] = useState('20');
  const [sosNorth, setSosNorth] = useState('0');
  const [sosEast, setSosEast] = useState('0');
  const [sosTriage, setSosTriage] = useState('1');

  const [cliInput, setCliInput] = useState('');
  const [cliHistory, setCliHistory] = useState<string[]>([]);
  const [cliHistoryIdx, setCliHistoryIdx] = useState(-1);
  const [cliOutput, setCliOutput] = useState<{ ts: string; text: string; color: string }[]>([]);
  const cliOutputRef = useRef<HTMLDivElement>(null);
  const cliInputRef = useRef<HTMLInputElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Flight path history for Cesium trail (max 500 positions)
  const flightPathRef = useRef<Array<{ north: number; east: number; alt: number }>>([]);

  // Waypoints extracted from active queue item's mission plan
  const [activeWaypoints, setActiveWaypoints] = useState<Array<{ north: number; east: number; alt?: number; label?: string }>>([]);

  // Search center for Cesium circle overlay
  const [searchCircle, setSearchCircle] = useState<{ north: number; east: number } | null>(null);
  const [searchCircleRadius, setSearchCircleRadius] = useState(100);

  const [collapsedPanels, setCollapsedPanels] = useState({
    telemetry: false,
    missionControl: false,
    queue: false,
    sos: false,
    cli: false,
    logs: false,
  });

  // Desktop tactical dock: single context-drawer, icon-triggered (like a rugged field tablet)
  const [activeDrawer, setActiveDrawer] = useState<DockKey | null>('telemetry');
  const toggleDrawer = (key: DockKey) => setActiveDrawer(prev => (prev === key ? null : key));

  const togglePanel = (key: keyof typeof collapsedPanels) => {
    setCollapsedPanels(prev => ({ ...prev, [key]: !prev[key] }));
  };

  type PendingAck = { id: number; type: string; sentAt: number };
  const pendingAcksRef = useRef<PendingAck[]>([]);
  const telemetrySnapRef = useRef<Telemetry | null>(null);
  const nextCliId = useRef(0);

  const cliPush = useCallback((text: string, color = '#929292') => {
    const ts = new Date().toTimeString().split(' ')[0];
    setCliOutput(prev => [...prev, { ts, text, color }]);
  }, []);

  const cliExec = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/\s+/);
    const verb = parts[0].toLowerCase();

    if (verb === 'help') {
      cliPush('COMMANDS:', '#929292');
      cliPush('  takeoff [alt=14]', '#e2e2e2');
      cliPush('  hold', '#e2e2e2');
      cliPush('  goto <north> <east> [alt=14] [yaw=0]', '#e2e2e2');
      cliPush('  search <north> <east> [alt=14] [1=Square|2=CreepingLine]', '#e2e2e2');
      cliPush('  rtl', '#e2e2e2');
      cliPush('  land', '#e2e2e2');
      cliPush('  sos <north> <east> [alt=14] [triage=1]', '#e2e2e2');
      cliPush('  clear', '#929292');
      return;
    }
    if (verb === 'clear') { setCliOutput([]); return; }

    const id = nextCliId.current++;
    telemetrySnapRef.current = telemetry;
    pendingAcksRef.current.push({ id, type: verb, sentAt: Date.now() });

    try {
      if (verb === 'takeoff') {
        const alt = parseFloat(parts[1]) || 14;
        cliPush(`> takeoff ${alt}`, '#e2e2e2');
        cliPush('[PENDING] Command sent...', '#d97706');
        await onCommand('takeoff', { alt });
      } else if (verb === 'hold') {
        cliPush('> hold', '#e2e2e2');
        cliPush('[PENDING] Command sent...', '#d97706');
        await onCommand('hold');
      } else if (verb === 'goto') {
        if (parts.length < 3) { cliPush('Usage: goto <north> <east> [alt] [yaw]', '#d46a2a'); return; }
        const north = parseFloat(parts[1]) || 0;
        const east = parseFloat(parts[2]) || 0;
        const alt = parseFloat(parts[3]) || 14;
        const yaw = parseFloat(parts[4]) || 0;
        cliPush(`> goto ${north} ${east} ${alt} ${yaw}`, '#e2e2e2');
        cliPush('[PENDING] Command sent...', '#d97706');
        await onCommand('goto', { north, east, alt, yaw });
      } else if (verb === 'search') {
        if (parts.length < 3) { cliPush('Usage: search <north> <east> [alt] [1=Square|2=CreepingLine]', '#d46a2a'); return; }
        const north = parseFloat(parts[1]) || 0;
        const east = parseFloat(parts[2]) || 0;
        const alt = parseFloat(parts[3]) || 14;
        const pCode = parseInt(parts[4]) || 2;
        const pattern = pCode === 1 ? 'SQUARE' : 'CREEPING_LINE';
        cliPush(`> search ${north} ${east} ${alt} ${pattern}`, '#e2e2e2');
        cliPush('[PENDING] Command sent...', '#d97706');
        setSearchCircle({ north, east });
        setSearchCircleRadius(100);
        await onCommand('search', { north, east, alt, pattern });
      } else if (verb === 'rtl') {
        cliPush('> rtl', '#e2e2e2');
        cliPush('[PENDING] Command sent...', '#d97706');
        await onCommand('rtl');
      } else if (verb === 'land') {
        cliPush('> land', '#e2e2e2');
        cliPush('[PENDING] Command sent...', '#d97706');
        await onCommand('land');
      } else if (verb === 'sos') {
        if (parts.length < 3) { cliPush('Usage: sos <north> <east> [alt] [triage]', '#d46a2a'); return; }
        const north = parseFloat(parts[1]) || 0;
        const east = parseFloat(parts[2]) || 0;
        const alt = parseFloat(parts[3]) || 14;
        const triage_code = parseInt(parts[4]) || 1;
        cliPush(`> sos ${north} ${east} ${alt} ${triage_code}`, '#d46a2a');
        cliPush('[PENDING] SOS dispatched...', '#d46a2a');
        await onCommand('sos', { north, east, alt, triage_code });
      } else {
        cliPush(`Unknown command: '${verb}'. Type 'help'.`, '#d46a2a');
        return;
      }
    } catch {
      pendingAcksRef.current = pendingAcksRef.current.filter(a => a.id !== id);
      cliPush('[ERROR] Command failed.', '#d46a2a');
    }
  }, [onCommand, telemetry, cliPush]);

  useEffect(() => {
    if (pendingAcksRef.current.length === 0 || !telemetry) return;
    const snap = telemetrySnapRef.current;
    if (!snap) return;
    const remaining: PendingAck[] = [];
    for (const ack of pendingAcksRef.current) {
      const elapsed = Date.now() - ack.sentAt;
      let confirmed = false;
      if (ack.type === 'takeoff') { confirmed = telemetry.alt - snap.alt > 1.0; }
      else if (ack.type === 'goto') { const dn = telemetry.north - snap.north; const de = telemetry.east - snap.east; confirmed = Math.sqrt(dn * dn + de * de) > 2.0; }
      else if (ack.type === 'hold') { const spd = Math.sqrt(telemetry.vx ** 2 + telemetry.vy ** 2); confirmed = elapsed > 1500 && spd < 0.5; }
      else if (ack.type === 'search') { confirmed = telemetry.mission_phase !== snap.mission_phase || Math.abs(telemetry.north - snap.north) > 2.0; }
      else if (ack.type === 'rtl' || ack.type === 'land') { confirmed = snap.alt - telemetry.alt > 1.0; }
      else { confirmed = elapsed > 500; }
      if (confirmed) { cliPush('[CONFIRMED] Drone executing.', '#22c55e'); }
      else if (elapsed > 5000) { cliPush('[TIMEOUT] No telemetry confirmation.', '#eab308'); }
      else { remaining.push(ack); }
    }
    pendingAcksRef.current = remaining;
  }, [telemetry, cliPush]);

  useEffect(() => { if (cliOutputRef.current) cliOutputRef.current.scrollTop = cliOutputRef.current.scrollHeight; }, [cliOutput]);
  useEffect(() => { if (logContainerRef.current) logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight; }, [logs]);

    // Track flight path from telemetry
  useEffect(() => {
    if (!telemetry || !isValidTelemetry(telemetry)) return;
    const path = flightPathRef.current;
    const last = path[path.length - 1];
    // Only add if moved more than 0.5m from last point
    if (last && Math.abs(telemetry.north - last.north) < 0.5 && Math.abs(telemetry.east - last.east) < 0.5) return;
    path.push({ north: telemetry.north, east: telemetry.east, alt: telemetry.alt });
    if (path.length > 500) path.shift();
  }, [telemetry]);

  // Extract waypoints from active queue item's mission plan
  useEffect(() => {
    const runningItem = queue.find((q, i) => i === queueIndex && (q.status === 'running' || q.status === 'loaded' || q.status === 'saving'));
    if (!runningItem) { setActiveWaypoints([]); return; }
    const plan = runningItem.mission.plan as Array<Record<string, unknown>>;
    const wps = plan
      .filter((step) => (step.action === 'GOTO' || step.action === 'SEARCH') && typeof step.north === 'number' && typeof step.east === 'number')
      .map((step, i) => ({
        north: step.north as number,
        east: step.east as number,
        alt: (step.alt as number) ?? 14,
        label: `${step.action === 'SEARCH' ? 'S' : 'WP'}${i + 1}`,
      }));
    setActiveWaypoints(wps);
  }, [queue, queueIndex]);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    const coordMatch = query.match(/^([-+]?\d+(?:\.\d+)?)[,\s]+([-+]?\d+(?:\.\d+)?)(?:[,\s]+([-+]?\d+(?:\.\d+)?))?$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        setSearchStatus('searching');
        setSearchTarget({ lat, lon, ts: Date.now() });
        setSearchStatus('idle');
        return;
      }
    }
    setSearchStatus('error');
    setSearchErrorMsg('Enter lat, lon');
    setTimeout(() => setSearchStatus('idle'), 2000);
  };

  const groundspeed = telemetry ? Math.sqrt(Math.pow(telemetry.vx, 2) + Math.pow(telemetry.vy, 2)) : 0;
  const isLocked = telemetry?.survivor_lock === true;
  const hasValidData = telemetry !== null && isValidTelemetry(telemetry);
  const isBridgeUp = connectionState === 'CONNECTED' || connectionState === 'STALE';
  const altColor = !hasValidData ? 'text-text' : telemetry!.alt > 5 ? 'text-green' : telemetry!.alt > 0.5 ? 'text-amber' : 'text-text-faint';

  const statusPillClass =
    connectionState === 'CONNECTED' ? 'border-green text-green' :
    connectionState === 'STALE' ? 'border-amber text-amber animate-pulse' :
    connectionState === 'BRIDGE_ONLY' ? 'border-amber text-amber animate-pulse' :
    connectionState === 'CONNECTING' ? 'border-yellow text-yellow' :
    'border-red text-red animate-pulse bg-red-bg';

  return (
    <div className="relative w-full h-full min-h-0 min-w-0 overflow-hidden">

      {/* BASE MAP LAYER */}
      {mapMode === 'MAP' ? (
        <MissionMap
          north={telemetry?.north ?? 0}
          east={telemetry?.east ?? 0}
          yaw={telemetry?.yaw ?? 0}
          isLocked={isLocked}
          lat={telemetry?.lat ?? 0}
          lon={telemetry?.lon ?? 0}
          flightPath={flightPathRef.current}
          waypoints={activeWaypoints}
          searchCenter={searchCircle}
          searchRadius={searchCircleRadius}
          className="fixed inset-0 z-0 pointer-events-auto"
        />
      ) : (
        <CesiumTerrainMapView
          telemetry={telemetry}
          lat={telemetry?.lat ?? 0}
          lon={telemetry?.lon ?? 0}
          north={telemetry?.north ?? 0}
          east={telemetry?.east ?? 0}
          alt={telemetry?.alt ?? 0}
          yaw={telemetry?.yaw ?? 0}
          isLocked={isLocked}
          connectionState={connectionState}
          className="fixed inset-0 z-0"
          flightPath={flightPathRef.current}
          waypoints={activeWaypoints}
          searchCenter={searchCircle}
          searchRadius={searchCircleRadius}
          targetFlyTo={searchTarget}
        />
      )}

      {/* DESKTOP HUD LAYER — tactical field-tablet convention: thin data strip + icon dock + single context drawer */}
      <div className="hidden lg:block fixed inset-0 z-10 pointer-events-none">

        {/* TOP STRIP: search · live stat chips · link status · map engine toggle */}
        <div className="absolute top-3 left-4 md:left-20 right-4 z-30 pointer-events-none flex items-center gap-2">
          <form onSubmit={handleSearchSubmit} className="pointer-events-auto glass-panel px-3 py-1.5 flex items-center gap-2 w-56 shrink-0 border-border hover:border-border-hi transition-colors">
            <Search className="w-3.5 h-3.5 text-text-faint shrink-0" />
            <input type="text" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); if (searchStatus === 'error') setSearchStatus('idle'); }}
              placeholder="Search lat, lon..." className="bg-transparent text-xs text-text outline-none font-mono flex-1 min-w-0 caret-text placeholder:text-text-disabled" />
            <button type="submit" disabled={searchStatus === 'searching'} className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 bg-surface text-text-dim hover:text-text border border-border-lo hover:border-border cursor-pointer transition-colors shrink-0">GO</button>
          </form>
          {searchStatus === 'searching' && <Loader2 className="w-3.5 h-3.5 text-amber animate-spin shrink-0 pointer-events-auto" />}
          {searchStatus === 'error' && <span className="pointer-events-auto text-[10px] text-red font-mono shrink-0 font-semibold animate-pulse">{searchErrorMsg}</span>}

          {/* Compact inline stat strip — replaces the tall telemetry card up top */}
          <div className="pointer-events-auto glass-panel flex-1 min-w-0 flex items-center divide-x divide-border-lo overflow-hidden">
            <StatChip label="ALT" value={hasValidData ? telemetry!.alt.toFixed(1) : '--'} unit="m" color={hasValidData ? altColor : undefined} />
            <StatChip label="SPD" value={hasValidData ? groundspeed.toFixed(1) : '--'} unit="m/s" />
            <StatChip label="HDG" value={hasValidData ? telemetry!.yaw.toFixed(0) : '--'} unit="°" />
            <StatChip label="PHASE" value={telemetry?.mission_phase?.toString() ?? '--'} />
            <StatChip label="WP" value={telemetry?.active_wp !== undefined ? `${telemetry.active_wp}/${telemetry.num_route_pts}` : '--'} />
            {isLocked && (
              <div className="px-3 py-1.5 flex items-center gap-1.5 shrink-0 bg-red-bg/60">
                <AlertTriangle className="w-3 h-3 text-red" />
                <span className="text-[10px] font-bold text-red tracking-wider uppercase">Survivor lock</span>
              </div>
            )}
          </div>

          <div className="pointer-events-auto flex items-center gap-2 shrink-0">
            <div className="glass-panel p-0.5 flex items-center border-border">
              <button type="button" onClick={() => setMapMode('MAP')} className={`px-2.5 py-1 text-[10px] font-mono font-bold tracking-wider rounded transition-colors cursor-pointer flex items-center gap-1 ${mapMode === 'MAP' ? 'bg-text text-base' : 'text-text-faint hover:text-text'}`}>
                <Layers className="w-3 h-3" />MAP
              </button>
              <button type="button" onClick={() => setMapMode('3D')} className={`px-2.5 py-1 text-[10px] font-mono font-bold tracking-wider rounded transition-colors cursor-pointer flex items-center gap-1 ${mapMode === '3D' ? 'bg-text text-base' : 'text-text-faint hover:text-text'}`}>
                <Box className="w-3 h-3" />3D
              </button>
            </div>
            <div title={`Status: ${connectionState === 'BRIDGE_ONLY' ? 'WAITING FOR DRONE' : connectionState}`}
              className={`glass-panel px-3 py-1.5 text-center text-[10px] uppercase tracking-widest font-mono font-bold flex items-center gap-2 ${statusPillClass}`}>
              <Radio className="w-3 h-3 shrink-0" />
              <span>{connectionState === 'BRIDGE_ONLY' ? 'WAITING FOR DRONE' : connectionState}</span>
            </div>
          </div>
        </div>

        {/* CORNER RETICLE BRACKETS — recon/targeting framing on the viewport edges */}
        <CornerBrackets />

        {/* COMPASS — top-left heading indicator, ATAK-style */}
        <div className="absolute top-16 left-4 md:left-20 z-20 pointer-events-none">
          <CompassRose heading={telemetry?.yaw ?? 0} />
        </div>

        {/* TACTICAL ICON RAIL — right edge, one glass tab strip (matches the left FDBK/MSN/COMMS nav), borderless glyphs inside */}
        <div className="absolute top-16 right-4 z-30 pointer-events-auto glass-panel py-3 px-1.5 flex flex-col items-center gap-5">
          <div className="flex flex-col items-center gap-3">
            <DockIcon icon={Gauge} label="Telemetry" active={activeDrawer === 'telemetry'} onClick={() => toggleDrawer('telemetry')} />
            <DockIcon icon={Navigation2} label="Mission control" active={activeDrawer === 'missionControl'} onClick={() => toggleDrawer('missionControl')}
              dotColor={missionStatus.running ? 'bg-green' : missionStatus.paused ? 'bg-yellow' : undefined} />
            {queue.length > 0 && (
              <DockIcon icon={ListOrdered} label="Mission queue" active={activeDrawer === 'queue'} onClick={() => toggleDrawer('queue')} />
            )}
          </div>
          <div className="w-5 h-px bg-border-hi" />
          <div className="flex flex-col items-center gap-3">
            <DockIcon icon={Terminal} label="Manual command" active={activeDrawer === 'cli'} onClick={() => toggleDrawer('cli')} />
            <DockIcon icon={ScrollText} label="Event log" active={activeDrawer === 'logs'} onClick={() => toggleDrawer('logs')} />
          </div>
          <div className="w-5 h-px bg-border-hi" />
          <DockIcon icon={AlertTriangle} label="Emergency SOS" active={activeDrawer === 'sos'} onClick={() => toggleDrawer('sos')} danger />
        </div>

        {/* CONTEXT DRAWER — one panel at a time, opens from the right-edge rail */}
        {activeDrawer && (
          <div className="absolute top-16 right-20 md:right-24 z-30 w-80 max-h-[calc(100vh-8.5rem)] pointer-events-auto">
            {activeDrawer === 'telemetry' && (
              <Bento title="LIVE TELEMETRY">
                {!isBridgeUp ? (
                  <div className="text-red animate-pulse py-6 text-center uppercase tracking-widest text-xs">LINK OFFLINE</div>
                ) : !hasValidData ? (
                  <div className="text-text-faint py-6 text-center uppercase tracking-widest text-xs">AWAITING DATALINK...</div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <DataRow label="NORTH" value={telemetry!.north.toFixed(2)} unit="m" />
                    <DataRow label="EAST" value={telemetry!.east.toFixed(2)} unit="m" />
                    <DataRow label="ALT (AGL)" value={telemetry!.alt.toFixed(2)} unit="m" color={altColor} />
                    <DataRow label="GND SPD" value={groundspeed.toFixed(2)} unit="m/s" />
                    <DataRow label="VERT SPD" value={telemetry!.vz.toFixed(2)} unit="m/s" />
                    <DataRow label="THRUST" value={(telemetry!.thrust * 100).toFixed(0)} unit="%" color={telemetry!.thrust > 0.8 ? 'text-amber' : 'text-text'} />
                    <div className="col-span-2 my-0.5 border-t border-border-lo" />
                    <DataRow label="ROLL" value={telemetry!.roll.toFixed(1)} unit="deg" />
                    <DataRow label="PITCH" value={telemetry!.pitch.toFixed(1)} unit="deg" />
                    <DataRow label="YAW" value={telemetry!.yaw.toFixed(1)} unit="deg" />
                    <div className="col-span-2 my-0.5 border-t border-border-lo" />
                    <DataRow label="PHASE" value={telemetry!.mission_phase.toString()} unit="" />
                    <DataRow label="LEG" value={`${telemetry!.active_wp} / ${telemetry!.num_route_pts}`} unit="" />
                  </div>
                )}
              </Bento>
            )}

            {activeDrawer === 'missionControl' && (
              <Bento title="MISSION CONTROL">
                <div className="flex flex-col gap-2.5 text-xs">
                  <div className="flex justify-between items-center bg-raised px-3 py-1.5 border border-border-lo">
                    <span className="text-text-faint text-[10px] tracking-widest uppercase">Status</span>
                    <span className={`font-display font-semibold text-sm leading-none ${missionStatus.running ? 'text-green' : missionStatus.paused ? 'text-yellow' : 'text-text-faint'}`}>
                      {missionStatus.running ? 'RUNNING' : missionStatus.paused ? 'PAUSED' : 'STANDBY'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center bg-raised px-3 py-1.5 border border-border-lo">
                    <span className="text-text-faint text-[10px] tracking-widest uppercase">Progress</span>
                    <span className="font-display font-semibold text-sm text-text leading-none">
                      {missionStatus.step_idx}<span className="text-text-faint font-normal text-xs"> / {missionStatus.total_steps}</span>
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 mt-0.5">
                    <button onClick={() => onMissionControl('run')} className="border border-border p-1.5 hover:bg-text hover:text-base cursor-pointer">RUN</button>
                    <button onClick={() => onMissionControl('pause')} className="border border-border p-1.5 hover:bg-yellow/20 hover:text-yellow cursor-pointer">PAUSE</button>
                    <button onClick={() => onMissionControl('resume')} className="border border-border p-1.5 hover:bg-text hover:text-base cursor-pointer">RESUME</button>
                    <button onClick={() => onMissionControl('abort')} className="border border-red text-red p-1.5 hover:bg-red hover:text-base font-bold cursor-pointer">ABORT / RTL</button>
                  </div>
                </div>
              </Bento>
            )}

            {activeDrawer === 'queue' && queue.length > 0 && (
              <Bento title="MISSION QUEUE">
                <div className="flex flex-col gap-1 text-xs max-h-[280px] overflow-y-auto">
                  <div className="flex justify-between items-center bg-raised px-2.5 py-1.5 border border-border-lo mb-1">
                    <span className="text-text-faint text-[9px] tracking-widest uppercase">Queue</span>
                    <span className="font-display font-semibold text-sm text-text leading-none">{queueIndex + 1}<span className="text-text-faint font-normal text-xs"> / {queue.length}</span></span>
                  </div>
                  {queue.map((item, idx) => (
                    <div key={item.id} className={`flex items-center gap-2 p-1.5 border border-border-lo bg-surface text-[11px] ${idx === queueIndex && (item.status === 'running' || item.status === 'saving' || item.status === 'loaded') ? 'border-green bg-raised' : item.status === 'completed' ? 'border-green/30' : item.status === 'failed' ? 'border-red' : ''}`}>
                      <span className="text-text-faint w-4 text-right">{idx + 1}</span>
                      <span className="flex-1 truncate text-text">{item.mission.mission_id}</span>
                      <span className={`text-[9px] w-14 text-right ${QUEUE_STATUS_COLORS[item.status]}`}>{QUEUE_STATUS_LABELS[item.status]}</span>
                      {item.status === 'queued' && (
                        <div className="flex gap-1">
                          <button onClick={() => idx > 0 && reorderQueue(idx, idx - 1)} disabled={idx === 0} className="text-text-faint hover:text-text disabled:opacity-30 px-1">↑</button>
                          <button onClick={() => idx < queue.length - 1 && reorderQueue(idx, idx + 1)} disabled={idx === queue.length - 1} className="text-text-faint hover:text-text disabled:opacity-30 px-1">↓</button>
                          <button onClick={() => removeFromQueue(item.id)} className="text-red hover:text-text px-1">×</button>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-2 mt-1.5">
                    <button onClick={clearQueue} className="flex-1 border border-border p-1.5 text-text-dim hover:bg-raised hover:text-text text-[10px]">CLEAR</button>
                    <button onClick={abortQueue} className="flex-1 border border-red text-red p-1.5 hover:bg-red hover:text-base font-bold text-[10px]">ABORT</button>
                  </div>
                </div>
              </Bento>
            )}

            {activeDrawer === 'sos' && (
              <Bento title="EMERGENCY SOS DIVERSION" isAlert className="bg-red-bg/90">
                <div className="flex flex-col gap-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-0.5"><label className="text-red text-[10px]">NORTH</label><input type="number" value={sosNorth} onChange={e => setSosNorth(e.target.value)} className="bg-base border border-red text-text p-1 outline-none text-xs" /></div>
                    <div className="flex flex-col gap-0.5"><label className="text-red text-[10px]">EAST</label><input type="number" value={sosEast} onChange={e => setSosEast(e.target.value)} className="bg-base border border-red text-text p-1 outline-none text-xs" /></div>
                    <div className="flex flex-col gap-0.5"><label className="text-red text-[10px]">ALT</label><input type="number" value={sosAlt} onChange={e => setSosAlt(e.target.value)} className="bg-base border border-red text-text p-1 outline-none text-xs" /></div>
                    <div className="flex flex-col gap-0.5"><label className="text-red text-[10px]">TRIAGE CODE</label><input type="number" value={sosTriage} onChange={e => setSosTriage(e.target.value)} className="bg-base border border-red text-text p-1 outline-none text-xs" /></div>
                  </div>
                  <button onClick={() => onCommand('sos', { north: parseFloat(sosNorth) || 0, east: parseFloat(sosEast) || 0, alt: parseFloat(sosAlt) || 0, triage_code: parseInt(sosTriage) || 1 })}
                    className="bg-red text-base font-bold tracking-widest py-2.5 mt-1 hover:bg-red/80 cursor-pointer">DISPATCH SOS OVERRIDE</button>
                </div>
              </Bento>
            )}

            {activeDrawer === 'cli' && (
              <Bento title="MANUAL COMMAND CONTROLS" className="min-h-[260px]">
                <div className="flex flex-col h-full min-h-[220px] text-xs">
                  <div ref={cliOutputRef} className="flex-1 min-h-[170px] max-h-[260px] overflow-y-auto border border-border-lo bg-overlay/80 p-2 font-mono">
                    {cliOutput.length === 0 && <div className="text-text-disabled italic text-[11px]">Type 'help' for available commands.</div>}
                    {cliOutput.map((line, i) => (<div key={i} className="flex gap-1.5 leading-relaxed text-[11px]"><span className="text-text-faint shrink-0">{line.ts}</span><span style={{ color: line.color }}>{line.text}</span></div>))}
                  </div>
                  <div className="flex items-center border border-border border-t-0 bg-surface/90 px-2 py-1.5 cursor-text" onClick={() => cliInputRef.current?.focus()}>
                    <span className="text-text font-bold mr-1.5 shrink-0 text-xs">{'>'}</span>
                    <input ref={cliInputRef} type="text" value={cliInput} onChange={e => setCliInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); if (cliInput.trim()) { setCliHistory(prev => [...prev, cliInput]); setCliHistoryIdx(-1); } cliExec(cliInput); setCliInput(''); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); if (cliHistory.length === 0) return; const newIdx = cliHistoryIdx === -1 ? cliHistory.length - 1 : Math.max(0, cliHistoryIdx - 1); setCliHistoryIdx(newIdx); setCliInput(cliHistory[newIdx]); }
                        else if (e.key === 'ArrowDown') { e.preventDefault(); if (cliHistoryIdx === -1) return; const newIdx = cliHistoryIdx + 1; if (newIdx >= cliHistory.length) { setCliHistoryIdx(-1); setCliInput(''); } else { setCliHistoryIdx(newIdx); setCliInput(cliHistory[newIdx]); } }
                        else if (e.key === 'Tab') { e.preventDefault(); const cmds = ['takeoff', 'hold', 'goto', 'search', 'rtl', 'land', 'sos', 'help', 'clear']; const match = cmds.filter(c => c.startsWith(cliInput.toLowerCase())); if (match.length === 1) setCliInput(match[0] + ' '); }
                        else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); setCliOutput([]); }
                      }}
                      className="flex-1 bg-transparent text-text outline-none font-mono caret-text text-xs" spellCheck={false} autoComplete="off" />
                  </div>
                </div>
              </Bento>
            )}

            {activeDrawer === 'logs' && (
              <Bento title="EVENT LOG FEED" className="max-h-[calc(100vh-8.5rem)] flex flex-col">
                <div ref={logContainerRef} className="h-full min-h-[200px] max-h-[calc(100vh-14rem)] overflow-y-auto flex flex-col space-y-2 text-[10px] pr-1">
                  {logs.map(log => (
                    <div key={log.id} className="flex flex-col border-l-2 border-border pl-2 py-0.5 gap-0.5">
                      <div className="flex items-center gap-1.5 text-text-faint"><span>{log.timestamp.toTimeString().split(' ')[0]}</span><span className="px-1 bg-raised border border-border-lo text-[9px]">[{log.source}]</span></div>
                      <div className={`${log.isAlert ? 'text-red font-bold' : 'text-text-dim'} leading-snug`}>{log.message}</div>
                    </div>
                  ))}
                  {logs.length === 0 && <div className="text-text-faint italic py-4 text-center">SYSTEM INITIALIZED...</div>}
                </div>
              </Bento>
            )}
          </div>
        )}

        {/* BOTTOM STATUS BAR — phase, waypoint and queue progress consolidated into one strip */}
        <div className="absolute bottom-4 left-4 md:left-20 right-4 z-20 pointer-events-auto glass-panel px-4 py-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber opacity-80 shrink-0" />
            <span className="text-text-faint text-[10px] tracking-[0.2em] uppercase font-mono">Phase</span>
            <span className="text-text font-display font-bold text-lg leading-none">{telemetry?.mission_phase !== undefined ? telemetry.mission_phase : '--'}</span>
          </div>
          {queue.length > 0 && (
            <div className="hidden md:flex items-center gap-2 min-w-0 flex-1 justify-center">
              <ListOrdered className="w-3.5 h-3.5 text-text-faint shrink-0" />
              <span className="text-text-faint text-[10px] tracking-[0.15em] uppercase font-mono truncate">{queue[queueIndex]?.mission.mission_id ?? '--'}</span>
              <span className="text-text-dim text-[10px] font-mono shrink-0">{queueIndex + 1}/{queue.length}</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-text-faint text-[10px] tracking-[0.2em] uppercase font-mono">Waypoint</span>
            <span className="text-text font-display font-bold text-lg leading-none">
              {telemetry?.active_wp !== undefined && telemetry?.num_route_pts !== undefined ? (<><span className="text-green">{telemetry.active_wp}</span><span className="text-text-faint font-normal text-sm"> / {telemetry.num_route_pts}</span></>) : ('--')}
            </span>
          </div>
        </div>
      </div>

      {/* MOBILE FALLBACK */}
      <div className="lg:hidden h-full flex flex-col gap-3 overflow-y-auto p-2 pb-8">
        <div className="flex items-center gap-2">
          <form onSubmit={handleSearchSubmit} className="glass-panel px-2.5 py-1.5 flex-1 flex items-center gap-2 border-border">
            <Search className="w-3.5 h-3.5 text-text-faint shrink-0" />
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search lat, lon..." className="bg-transparent text-xs text-text outline-none font-mono flex-1 caret-text placeholder:text-text-disabled" />
            {searchStatus === 'searching' && <Loader2 className="w-3.5 h-3.5 text-amber animate-spin shrink-0" />}
            <button type="submit" className="text-[9px] font-mono uppercase px-1.5 py-0.5 bg-surface text-text-dim border border-border-lo">GO</button>
          </form>
        </div>
        {searchStatus === 'error' && <div className="text-[10px] text-red font-mono px-2">{searchErrorMsg}</div>}

        <div className="shrink-0 h-64 relative rounded-lg overflow-hidden glass-panel">
          <MissionMap north={telemetry?.north ?? 0} east={telemetry?.east ?? 0} yaw={telemetry?.yaw ?? 0} isLocked={isLocked}
            lat={telemetry?.lat ?? 0} lon={telemetry?.lon ?? 0} className="absolute inset-0" />
          <div className="absolute bottom-2 left-2 z-10 glass-panel px-2.5 py-1.5 text-xs">
            <span className="text-[9px] text-text-faint block uppercase">Phase</span>
            <span className="font-display font-bold text-sm text-text">{telemetry?.mission_phase ?? '--'}</span>
          </div>
          <div className="absolute bottom-2 right-2 z-10 glass-panel px-2.5 py-1.5 text-xs text-right">
            <span className="text-[9px] text-text-faint block uppercase">Waypoint</span>
            <span className="font-display font-bold text-sm text-text">{telemetry?.active_wp ?? '--'} / {telemetry?.num_route_pts ?? '--'}</span>
          </div>
        </div>

        <div className={`glass-panel p-2 text-center text-xs font-bold uppercase tracking-wider ${statusPillClass}`}>
          {connectionState === 'BRIDGE_ONLY' ? 'WAITING FOR DRONE' : connectionState}
        </div>

        <Bento title="LIVE TELEMETRY" collapsible collapsed={collapsedPanels.telemetry} onToggleCollapse={() => togglePanel('telemetry')}>
          {!isBridgeUp ? <div className="text-red animate-pulse py-4 text-center text-xs">LINK OFFLINE</div>
          : !hasValidData ? <div className="text-text-faint py-4 text-center text-xs">AWAITING DATALINK...</div>
          : <div className="grid grid-cols-2 gap-2 text-xs"><DataRow label="NORTH" value={telemetry!.north.toFixed(2)} unit="m" /><DataRow label="EAST" value={telemetry!.east.toFixed(2)} unit="m" /><DataRow label="ALT" value={telemetry!.alt.toFixed(2)} unit="m" color={altColor} /><DataRow label="SPD" value={groundspeed.toFixed(2)} unit="m/s" /><DataRow label="THRUST" value={(telemetry!.thrust * 100).toFixed(0)} unit="%" /><DataRow label="YAW" value={telemetry!.yaw.toFixed(1)} unit="deg" /></div>}
        </Bento>
        <Bento title="MISSION CONTROL" collapsible collapsed={collapsedPanels.missionControl} onToggleCollapse={() => togglePanel('missionControl')}>
          <div className="grid grid-cols-2 gap-2 text-xs"><button onClick={() => onMissionControl('run')} className="border border-border p-2">RUN</button><button onClick={() => onMissionControl('pause')} className="border border-border p-2 text-yellow">PAUSE</button><button onClick={() => onMissionControl('resume')} className="border border-border p-2">RESUME</button><button onClick={() => onMissionControl('abort')} className="border border-red text-red p-2 font-bold">ABORT</button></div>
        </Bento>
        <Bento title="EMERGENCY SOS DIVERSION" isAlert collapsible collapsed={collapsedPanels.sos} onToggleCollapse={() => togglePanel('sos')} className="bg-red-bg">
          <button onClick={() => onCommand('sos', { north: parseFloat(sosNorth) || 0, east: parseFloat(sosEast) || 0, alt: parseFloat(sosAlt) || 0, triage_code: parseInt(sosTriage) || 1 })}
            className="w-full bg-red text-base font-bold tracking-widest py-3 hover:bg-red/80">DISPATCH SOS OVERRIDE</button>
        </Bento>
        <Bento title="EVENT LOG FEED" collapsible collapsed={collapsedPanels.logs} onToggleCollapse={() => togglePanel('logs')}>
          <div className="max-h-48 overflow-y-auto space-y-1.5 text-[10px]">
            {logs.map(log => (<div key={log.id} className="border-l border-border pl-2"><span className="text-text-faint">{log.timestamp.toTimeString().split(' ')[0]}</span>{' '}<span className={log.isAlert ? 'text-red' : 'text-text-dim'}>{log.message}</span></div>))}
          </div>
        </Bento>
      </div>
    </div>
  );
};

const StatChip = ({ label, value, unit, color }: { label: string; value: string | number; unit?: string; color?: string }) => (
  <div className="px-3 py-1.5 flex items-baseline gap-1.5 shrink-0">
    <span className="text-text-faint text-[9px] tracking-wider uppercase">{label}</span>
    <span className={`font-mono text-xs font-semibold leading-none ${color ?? 'text-text'}`}>
      {value}{unit && <span className="text-text-disabled text-[9px] font-normal ml-0.5">{unit}</span>}
    </span>
  </div>
);

const DockIcon = ({ icon: Icon, label, active, onClick, danger, dotColor }: {
  icon: React.ElementType; label: string; active: boolean; onClick: () => void; danger?: boolean; dotColor?: string;
}) => (
  <div className="relative group">
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`relative flex items-center justify-center w-9 h-9 cursor-pointer transition-all duration-150 ${
        danger
          ? active ? 'text-red drop-shadow-[0_0_6px_rgba(212,106,42,0.7)]' : 'text-red hover:text-red/80'
          : active ? 'text-text drop-shadow-[0_0_6px_rgba(255,255,255,0.35)]' : 'text-text-dim hover:text-text'
      }`}
    >
      <Icon className="w-5 h-5" strokeWidth={active ? 2.25 : 1.75} />
      {active && (
        <span className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-4 h-[2px] rounded-full ${danger ? 'bg-red' : 'bg-text'}`} />
      )}
      {dotColor && !active && <span className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${dotColor}`} />}
    </button>
    <div className="hidden md:flex absolute right-full top-1/2 -translate-y-1/2 mr-2 items-center h-7 px-2.5 glass-panel border border-border-hi opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap z-50">
      <span className="text-[10px] font-mono uppercase tracking-wider text-text">{label}</span>
    </div>
  </div>
);

// Thin L-shaped brackets at each viewport corner — a recon/targeting frame
// instead of a full rectangular panel border.
const CornerBrackets = () => {
  const stroke = 'rgba(255,255,255,0.14)';
  const arm = 22;
  const inset = 10;
  const corner = (rotate: number, top: boolean, left: boolean) => (
    <svg
      className="absolute w-8 h-8 pointer-events-none"
      style={{ top: top ? inset : undefined, bottom: top ? undefined : inset, left: left ? inset : undefined, right: left ? undefined : inset, transform: `rotate(${rotate}deg)` }}
      viewBox="0 0 32 32"
    >
      <path d={`M2 ${arm} V2 H${arm}`} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
  return (
    <div className="absolute inset-0 z-20 pointer-events-none">
      {corner(0, true, true)}
      {corner(90, true, false)}
      {corner(270, false, true)}
      {corner(180, false, false)}
    </div>
  );
};

// Minimal heading compass — bare glyph on the map surface, no card behind it.
const CompassRose = ({ heading }: { heading: number }) => (
  <div className="relative w-11 h-11 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
    <svg viewBox="0 0 44 44" className="w-full h-full">
      <circle cx="22" cy="22" r="19" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
      {[0, 90, 180, 270].map(deg => {
        const rad = ((deg - 90) * Math.PI) / 180;
        const x1 = 22 + Math.cos(rad) * 15, y1 = 22 + Math.sin(rad) * 15;
        const x2 = 22 + Math.cos(rad) * 19, y2 = 22 + Math.sin(rad) * 19;
        return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke={deg === 0 ? '#22c55e' : 'rgba(255,255,255,0.3)'} strokeWidth="1.5" />;
      })}
      <g style={{ transform: `rotate(${heading}deg)`, transformOrigin: '22px 22px' }}>
        <path d="M22 8 L26 24 L22 21 L18 24 Z" fill="#e2e2e2" />
      </g>
    </svg>
    <span className="absolute -top-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-green">N</span>
  </div>
);

const DataRow = ({ label, value, unit, color }: { label: string; value: string | number; unit: string; color?: string }) => (
  <div className="flex justify-between items-end border-b border-border-lo pb-1">
    <span className="text-text-faint text-[10px] tracking-wider uppercase">{label}</span>
    <span className={`font-mono text-xs font-semibold leading-none ${color ?? 'text-text'}`}>
      {value}{unit && <span className="text-text-disabled text-[9px] font-normal ml-0.5">{unit}</span>}
    </span>
  </div>
);
