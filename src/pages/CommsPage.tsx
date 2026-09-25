import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Bento } from '../components/Bento';
import { PacketEntry, Telemetry, ConnectionState } from '../types';
import { isValidTelemetry } from '../api';
import {
  Compass,
  Gauge,
  Navigation,
  Activity,
  Layers,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';

interface CommsPageProps {
  packets: PacketEntry[];
  connectionState: ConnectionState | string;
  telemetry: Telemetry | null;
}

export const CommsPage: React.FC<CommsPageProps> = ({
  packets,
  connectionState,
  telemetry: propTelemetry,
}) => {
  // Try to parse the most recent valid telemetry packet if propTelemetry is null
  const latestParsedTelemetry = useMemo(() => {
    if (propTelemetry && isValidTelemetry(propTelemetry)) {
      return propTelemetry;
    }
    // Fallback: check newest RX packet with TEL payload
    for (const p of packets) {
      if (p.type === 'TEL') {
        try {
          const parsed = JSON.parse(p.payload) as Telemetry;
          if (parsed && typeof parsed === 'object' && isValidTelemetry(parsed)) {
            return parsed;
          }
        } catch {
          // Ignore invalid parse
        }
      }
    }
    return propTelemetry;
  }, [propTelemetry, packets]);

  const activeTel = latestParsedTelemetry;
  const hasTelemetry = activeTel !== null && isValidTelemetry(activeTel);

  // Pulse effect whenever telemetry changes
  const [pulse, setPulse] = useState(false);
  const prevTimeRef = useRef<number>(0);

  useEffect(() => {
    if (activeTel?.timestamp && activeTel.timestamp !== prevTimeRef.current) {
      prevTimeRef.current = activeTel.timestamp;
      setPulse(true);
      const timer = setTimeout(() => setPulse(false), 220);
      return () => clearTimeout(timer);
    }
  }, [activeTel?.timestamp]);

  // Derived telemetry metrics
  const groundSpeed = activeTel
    ? Math.hypot(activeTel.vx, activeTel.vy)
    : 0;

  const verticalSpeed = activeTel ? activeTel.vz : 0;
  const thrustPercent = activeTel ? Math.min(100, Math.max(0, activeTel.thrust * 100)) : 0;

  const totalPackets = packets.length;
  const rxPackets = packets.filter(p => p.direction === 'RX').length;
  const txPackets = packets.filter(p => p.direction === 'TX').length;

  const formattedTimestamp = activeTel?.timestamp
    ? new Date(
        activeTel.timestamp > 1e11 ? activeTel.timestamp : activeTel.timestamp * 1000
      ).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)
    : '--:--:--.---';

  const statusColor =
    connectionState === 'CONNECTED' ? 'text-green' :
    connectionState === 'CONNECTING' ? 'text-yellow' :
    connectionState === 'STALE' ? 'text-amber' :
    connectionState === 'BRIDGE_ONLY' ? 'text-amber' : 'text-red';

  return (
    <div className="h-full flex flex-col lg:flex-row gap-3 overflow-hidden min-h-0 min-w-0">
      {/* LEFT COLUMN: Link Status & Live Packet Stream Log */}
      <div className="flex-1 flex flex-col gap-3 min-h-0 min-w-0">
        {/* LINK STATUS HEADER */}
        <Bento title="LINK STATUS" className="shrink-0" isAlert={connectionState === 'DISCONNECTED'}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative flex items-center justify-center">
                <span className={`w-3 h-3 rounded-full ${
                  connectionState === 'CONNECTED' ? 'bg-green animate-ping' :
                  connectionState === 'BRIDGE_ONLY' ? 'bg-amber' : 'bg-red'
                }`} />
                <span className={`absolute w-2 h-2 rounded-full ${
                  connectionState === 'CONNECTED' ? 'bg-green' :
                  connectionState === 'BRIDGE_ONLY' ? 'bg-amber' : 'bg-red'
                }`} />
              </div>
              <div>
                <div className={`font-display font-bold text-xl leading-none ${statusColor}`}>
                  {connectionState === 'BRIDGE_ONLY' ? 'WAITING FOR DRONE' : connectionState}
                </div>
                <div className="text-text-dim text-[11px] mt-1 font-mono flex items-center gap-3">
                  <span>ENDPOINT: <span className="text-text">127.0.0.1:8766</span></span>
                  <span>PROTOCOL: <span className="text-text">SSE / HTTP</span></span>
                </div>
              </div>
            </div>

            {/* Quick packet counters */}
            <div className="flex items-center gap-4 text-xs font-mono border-l border-border-lo pl-4">
              <div>
                <div className="text-[9px] text-text-faint uppercase tracking-wider">Total Packets</div>
                <div className="font-bold text-text text-sm">{totalPackets}</div>
              </div>
              <div>
                <div className="text-[9px] text-amber uppercase tracking-wider">RX Count</div>
                <div className="font-bold text-amber text-sm">{rxPackets}</div>
              </div>
              <div>
                <div className="text-[9px] text-green uppercase tracking-wider">TX Count</div>
                <div className="font-bold text-green text-sm">{txPackets}</div>
              </div>
            </div>
          </div>
        </Bento>

        {/* PACKET STREAM LOG */}
        <Bento
          title="PACKET STREAM"
          className="flex-1 min-h-0"
          headerExtra={
            <div className="flex items-center gap-2 text-[10px] text-text-dim font-mono">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green inline-block"></span> TX (Commands)
              </span>
              <span className="flex items-center gap-1 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber inline-block"></span> RX (Telemetry)
              </span>
            </div>
          }
        >
          <div className="h-full overflow-y-auto flex flex-col-reverse text-[11px] space-y-1 space-y-reverse pr-1">
            {packets.map((p) => (
              <div
                key={p.id}
                className="flex items-start gap-3 hover:bg-raised/70 p-1.5 border-b border-border-lo rounded transition-colors group"
              >
                <span className="text-text-faint shrink-0 w-20 font-mono text-[10px] pt-0.5">
                  {p.timestamp.toISOString().split('T')[1].slice(0, 12)}
                </span>
                <span
                  className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold leading-none ${
                    p.direction === 'TX'
                      ? 'bg-green/10 text-green border border-green/30'
                      : 'bg-amber/10 text-amber border border-amber/30'
                  }`}
                >
                  {p.direction}
                </span>
                <span className="shrink-0 w-7 text-text-faint font-mono font-semibold text-[10px] pt-0.5">
                  {p.type}
                </span>
                <span className="text-text-dim break-all font-mono text-[10px] group-hover:text-text selection:bg-amber/30 transition-colors">
                  {p.payload}
                </span>
              </div>
            ))}
            {packets.length === 0 && (
              <div className="text-text-faint italic p-4 text-center">
                NO PACKET HISTORY YET. WAITING FOR TELEMETRY STREAM...
              </div>
            )}
          </div>
        </Bento>
      </div>

      {/* RIGHT COLUMN: Real-Time Telemetry Attribute & Number Boxes */}
      <div className="w-full lg:w-[420px] xl:w-[460px] flex flex-col gap-3 shrink-0 min-h-0 overflow-y-auto">
        <Bento
          title="LIVE TELEMETRY MATRIX"
          className="h-full flex flex-col"
          headerExtra={
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase transition-all duration-200 ${
                  pulse
                    ? 'bg-green text-base shadow-[0_0_8px_rgba(34,197,94,0.6)]'
                    : hasTelemetry
                    ? 'bg-surface text-green border border-green/30'
                    : 'bg-surface text-text-faint border border-border-lo'
                }`}
              >
                <Activity className="w-2.5 h-2.5" />
                {hasTelemetry ? (pulse ? 'SYNCING' : 'STREAM ACTIVE') : 'NO DATA'}
              </span>
            </div>
          }
        >
          <div className="flex flex-col gap-3 text-xs overflow-y-auto pr-1">
            {/* SURVIVOR LOCK BANNER */}
            {hasTelemetry && (
              <div
                className={`px-3 py-2 border rounded flex items-center justify-between transition-all ${
                  activeTel!.survivor_lock
                    ? 'border-red bg-red-bg text-red animate-pulse'
                    : 'border-border-lo bg-surface text-text-dim'
                }`}
              >
                <div className="flex items-center gap-2 font-bold tracking-wider uppercase text-[11px]">
                  {activeTel!.survivor_lock ? (
                    <>
                      <ShieldAlert className="w-4 h-4 text-red" />
                      <span>SURVIVOR TARGET LOCKED</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 text-text-faint" />
                      <span>SURVIVOR SEARCH STANDBY</span>
                    </>
                  )}
                </div>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                    activeTel!.survivor_lock
                      ? 'bg-red text-base'
                      : 'bg-raised text-text-faint'
                  }`}
                >
                  {activeTel!.survivor_lock ? 'LOCK ENGAGED' : 'FALSE'}
                </span>
              </div>
            )}

            {/* 1. COORDINATES & SPATIAL POSITION */}
            <div className="bg-surface border border-border-lo rounded-lg p-2.5 flex flex-col gap-2">
              <div className="flex items-center justify-between border-b border-border-lo pb-1 text-[10px] font-bold text-text-dim tracking-wider uppercase">
                <span className="flex items-center gap-1.5">
                  <Navigation className="w-3 h-3 text-text-faint" />
                  GEODETIC & LOCAL POSITION
                </span>
                <span className="text-[9px] font-mono text-text-faint">WGS84 / NED</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  label="LATITUDE"
                  value={hasTelemetry ? activeTel!.lat.toFixed(6) : '--'}
                  unit="°"
                  sub="NORTH"
                />
                <MetricCard
                  label="LONGITUDE"
                  value={hasTelemetry ? activeTel!.lon.toFixed(6) : '--'}
                  unit="°"
                  sub="EAST"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <MetricCard
                  label="OFFSET NORTH"
                  value={hasTelemetry ? activeTel!.north.toFixed(2) : '--'}
                  unit="m"
                  highlight={hasTelemetry && Math.abs(activeTel!.north) > 0.1}
                />
                <MetricCard
                  label="OFFSET EAST"
                  value={hasTelemetry ? activeTel!.east.toFixed(2) : '--'}
                  unit="m"
                  highlight={hasTelemetry && Math.abs(activeTel!.east) > 0.1}
                />
                <MetricCard
                  label="ALTITUDE (AGL)"
                  value={hasTelemetry ? activeTel!.alt.toFixed(2) : '--'}
                  unit="m"
                  valueColor={
                    !hasTelemetry ? 'text-white' : activeTel!.alt > 1 ? 'text-green' : 'text-white'
                  }
                />
              </div>
            </div>

            {/* 2. KINEMATICS & DYNAMICS */}
            <div className="bg-surface border border-border-lo rounded-lg p-2.5 flex flex-col gap-2">
              <div className="flex items-center justify-between border-b border-border-lo pb-1 text-[10px] font-bold text-text-dim tracking-wider uppercase">
                <span className="flex items-center gap-1.5">
                  <Gauge className="w-3 h-3 text-text-faint" />
                  VELOCITY & PROPULSION
                </span>
                <span className="text-[9px] font-mono text-text-faint">3-AXIS SPEED</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  label="GROUND SPEED"
                  value={hasTelemetry ? groundSpeed.toFixed(2) : '--'}
                  unit="m/s"
                  valueColor={hasTelemetry && groundSpeed > 0.2 ? 'text-green' : 'text-white'}
                  sub={hasTelemetry ? `${(groundSpeed * 3.6).toFixed(1)} km/h` : ''}
                />
                <MetricCard
                  label="VERTICAL SPEED (Vz)"
                  value={hasTelemetry ? verticalSpeed.toFixed(2) : '--'}
                  unit="m/s"
                  valueColor={
                    !hasTelemetry
                      ? 'text-white'
                      : Math.abs(verticalSpeed) > 0.2
                      ? verticalSpeed > 0
                        ? 'text-green'
                        : 'text-amber'
                      : 'text-white'
                  }
                  sub={verticalSpeed < -0.1 ? 'CLIMBING' : verticalSpeed > 0.1 ? 'DESCENDING' : 'LEVEL'}
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <MetricCard
                  label="Vx (NORTH)"
                  value={hasTelemetry ? activeTel!.vx.toFixed(2) : '--'}
                  unit="m/s"
                />
                <MetricCard
                  label="Vy (EAST)"
                  value={hasTelemetry ? activeTel!.vy.toFixed(2) : '--'}
                  unit="m/s"
                />
                <MetricCard
                  label="Vz (DOWN)"
                  value={hasTelemetry ? activeTel!.vz.toFixed(2) : '--'}
                  unit="m/s"
                />
              </div>

              {/* Thrust bar */}
              <div className="mt-1 bg-raised p-2 border border-border-lo rounded flex flex-col gap-1.5">
                <div className="flex justify-between items-center text-[10px]">
                  <span className="text-text-faint font-mono font-semibold flex items-center gap-1">
                    <Zap className="w-3 h-3 text-amber" /> MOTOR THRUST
                  </span>
                  <span className={`font-mono font-extrabold text-sm ${thrustPercent > 80 ? 'text-amber' : 'text-white'}`}>
                    {hasTelemetry ? `${thrustPercent.toFixed(1)}%` : '--'}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-base rounded overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      thrustPercent > 85 ? 'bg-red' : thrustPercent > 50 ? 'bg-amber' : 'bg-green'
                    }`}
                    style={{ width: `${hasTelemetry ? thrustPercent : 0}%` }}
                  />
                </div>
              </div>
            </div>

            {/* 3. ATTITUDE & ORIENTATION */}
            <div className="bg-surface border border-border-lo rounded-lg p-2.5 flex flex-col gap-2">
              <div className="flex items-center justify-between border-b border-border-lo pb-1 text-[10px] font-bold text-text-dim tracking-wider uppercase">
                <span className="flex items-center gap-1.5">
                  <Compass className="w-3 h-3 text-text-faint" />
                  ATTITUDE & HEADING
                </span>
                <span className="text-[9px] font-mono text-text-faint">EULER ANGLES</span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <MetricCard
                  label="ROLL (φ)"
                  value={hasTelemetry ? activeTel!.roll.toFixed(1) : '--'}
                  unit="°"
                />
                <MetricCard
                  label="PITCH (θ)"
                  value={hasTelemetry ? activeTel!.pitch.toFixed(1) : '--'}
                  unit="°"
                />
                <MetricCard
                  label="YAW / HDG (ψ)"
                  value={hasTelemetry ? activeTel!.yaw.toFixed(1) : '--'}
                  unit="°"
                  valueColor="text-yellow"
                />
              </div>
            </div>

            {/* 4. MISSION PHASE & TIMING */}
            <div className="bg-surface border border-border-lo rounded-lg p-2.5 flex flex-col gap-2">
              <div className="flex items-center justify-between border-b border-border-lo pb-1 text-[10px] font-bold text-text-dim tracking-wider uppercase">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3 h-3 text-text-faint" />
                  MISSION STATUS & SEQUENCE
                </span>
                <span className="text-[9px] font-mono text-text-faint">AUTONOMY</span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <MetricCard
                  label="MISSION PHASE"
                  value={hasTelemetry ? activeTel!.mission_phase.toString() : '--'}
                  sub={
                    activeTel?.mission_phase === 0
                      ? 'IDLE / READY'
                      : activeTel?.mission_phase === 1
                      ? 'TAKEOFF'
                      : activeTel?.mission_phase === 2
                      ? 'TRANSIT'
                      : activeTel?.mission_phase === 3
                      ? 'SEARCH'
                      : activeTel?.mission_phase === 4
                      ? 'RESCUE/DROP'
                      : activeTel?.mission_phase === 5
                      ? 'RTL'
                      : 'ACTIVE'
                  }
                />
                <MetricCard
                  label="ACTIVE WP"
                  value={hasTelemetry ? activeTel!.active_wp.toString() : '--'}
                  sub={`OF ${activeTel?.num_route_pts ?? '--'} TOTAL`}
                />
                <MetricCard
                  label="ROUTE PTS"
                  value={hasTelemetry ? activeTel!.num_route_pts.toString() : '--'}
                  unit="PTS"
                />
              </div>

              {/* Timestamp footer box */}
              <div className="mt-1 flex items-center justify-between bg-raised px-2.5 py-1.5 rounded border border-border-lo text-[10px] font-mono">
                <span className="text-text-faint flex items-center gap-1">
                  <Clock className="w-3 h-3 text-text-faint" />
                  PACKET TIMESTAMP:
                </span>
                <span className="text-white font-extrabold text-xs tracking-wider">
                  {formattedTimestamp}
                </span>
              </div>
            </div>
          </div>
        </Bento>
      </div>
    </div>
  );
};

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  valueColor?: string;
  highlight?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  unit,
  sub,
  valueColor = 'text-white',
  highlight = false,
}) => {
  return (
    <div
      className={`p-2 rounded flex flex-col justify-between border transition-all ${
        highlight
          ? 'bg-raised/90 border-border-hi shadow-sm'
          : 'bg-base/70 border-border-lo hover:border-border'
      }`}
    >
      <span className="text-[9px] font-mono text-text-dim tracking-wider uppercase leading-none truncate">
        {label}
      </span>
      <div className="flex items-baseline gap-1 mt-1.5 mb-0.5">
        <span className={`font-mono font-extrabold text-base lg:text-lg leading-none tracking-tight ${valueColor}`}>
          {value}
        </span>
        {unit && (
          <span className="text-[10px] font-mono text-text-dim font-medium uppercase leading-none">
            {unit}
          </span>
        )}
      </div>
      {sub && (
        <span className="text-[8.5px] font-mono text-text-faint tracking-wide truncate mt-0.5">
          {sub}
        </span>
      )}
    </div>
  );
};
