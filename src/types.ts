export interface Telemetry {
  lat: number;
  lon: number;
  alt: number;
  north: number;
  east: number;
  vx: number;
  vy: number;
  vz: number;
  roll: number;
  pitch: number;
  yaw: number;
  thrust: number;
  active_wp: number;
  num_route_pts: number;
  mission_phase: number;
  survivor_lock: boolean;
  timestamp: number;
}

export interface MissionStatus {
  loaded: boolean;
  mission_id: string | null;
  running: boolean;
  paused: boolean;
  step_idx: number;
  total_steps: number;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  source: 'SYS' | 'CMD' | 'TEL' | 'SOS' | 'MSN';
  message: string;
  isAlert?: boolean;
}

export interface PacketEntry {
  id: string;
  timestamp: Date;
  direction: 'TX' | 'RX';
  type: string;
  payload: string;
}

export interface MissionStep {
  step: number;
  action: 'TAKEOFF' | 'GOTO' | 'SEARCH' | 'HOLD' | 'RTL' | 'LAND';
  alt?: number;
  north?: number;
  east?: number;
  yaw?: number;
  pattern?: 'CREEPING_LINE' | 'SQUARE';
  duration_sec?: number;
}

export type ConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'BRIDGE_ONLY' | 'CONNECTED' | 'STALE';

export interface QueueItem {
  id: string;
  mission: { mission_id: string; plan: unknown[] };
  status: 'queued' | 'saving' | 'loaded' | 'running' | 'completed' | 'failed';
  filename?: string;
  error?: string;
}

export const QUEUE_STATUS_COLORS: Record<QueueItem['status'], string> = {
  queued: 'text-text-faint',
  saving: 'text-yellow',
  loaded: 'text-text-dim',
  running: 'text-text font-bold',
  completed: 'text-green',
  failed: 'text-red',
};

export const QUEUE_STATUS_LABELS: Record<QueueItem['status'], string> = {
  queued: 'QUEUED',
  saving: 'SAVING',
  loaded: 'LOADED',
  running: 'RUNNING',
  completed: 'DONE',
  failed: 'FAILED',
};
