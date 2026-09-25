import { Telemetry, MissionStatus } from './types';

const BRIDGE_URL = 'http://127.0.0.1:8766';

// Validates that a telemetry message contains real drone data.
// The bridge sends an initial empty {} when a client connects — this is NOT valid.
// Valid: timestamp is a nonzero finite number, and at least north/alt are present as numbers.
export function isValidTelemetry(data: Telemetry): boolean {
  return (
    typeof data.timestamp === 'number' &&
    data.timestamp > 0 &&
    Number.isFinite(data.timestamp) &&
    typeof data.north === 'number' &&
    Number.isFinite(data.north) &&
    typeof data.alt === 'number' &&
    Number.isFinite(data.alt)
  );
}

export function subscribeTelemetry(
  onUpdate: (data: Telemetry) => void,
  onError: (error: Event) => void
): () => void {
  const es = new EventSource(`${BRIDGE_URL}/telemetry`);

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as Telemetry;
      onUpdate(data);
    } catch {
      onError(new Event('parse_error'));
    }
  };

  es.onerror = (e) => {
    onError(e);
  };

  return () => es.close();
}

export async function getMissionStatus(): Promise<MissionStatus> {
  const res = await fetch(`${BRIDGE_URL}/mission/status`);
  if (!res.ok) throw new Error(`Mission status request failed: ${res.status}`);
  return res.json();
}

export async function sendCommand(
  type: string,
  params: Record<string, unknown> = {}
): Promise<{ ok: boolean; action?: string; mission_paused?: boolean; error?: string; [key: string]: unknown }> {
  const res = await fetch(`${BRIDGE_URL}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, ...params }),
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `Command ${type} rejected`);
  }
  return body;
}

export async function saveMission(
  mission: { mission_id: string; plan: unknown[]; [key: string]: unknown }
): Promise<{ ok: boolean; filepath: string; filename: string; error?: string }> {
  const res = await fetch(`${BRIDGE_URL}/mission/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mission }),
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || 'Mission save rejected');
  }
  return body;
}

export async function loadMission(
  filename: string
): Promise<{ ok: boolean; mission_id: string; resolved_path: string; error?: string }> {
  const res = await fetch(`${BRIDGE_URL}/mission/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filepath: filename }),
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || 'Mission load rejected');
  }
  return body;
}

async function missionControl(
  endpoint: string
): Promise<{ ok: boolean; error?: string; [key: string]: unknown }> {
  const res = await fetch(`${BRIDGE_URL}/mission/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await res.json();
  if (!res.ok || body.ok === false) {
    throw new Error(body.error || `Mission ${endpoint} rejected`);
  }
  return body;
}

export function runMission() {
  return missionControl('run');
}

export function pauseMission() {
  return missionControl('pause');
}

export function resumeMission() {
  return missionControl('resume');
}

export function abortMission() {
  return missionControl('abort');
}
