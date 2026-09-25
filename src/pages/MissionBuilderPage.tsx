import React, { useState, useRef } from 'react';
import { Bento } from '../components/Bento';
import { MissionStep, MissionStatus, QueueItem, QUEUE_STATUS_COLORS, QUEUE_STATUS_LABELS } from '../types';

interface MissionBuilderPageProps {
  missionStatus: MissionStatus;
  deployMission: (mission: { mission_id: string; plan: unknown[] }) => Promise<
    { ok: true; mission_id: string; total_steps: number } | { ok: false; error: string }
  >;
  queue: QueueItem[];
  addToQueue: (mission: { mission_id: string; plan: unknown[] }) => void;
  removeFromQueue: (id: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  clearQueue: () => void;
  startQueue: () => void;
}

const ALLOWED_ACTIONS = ['TAKEOFF', 'GOTO', 'SEARCH', 'HOLD', 'RTL', 'LAND'];

export const MissionBuilderPage: React.FC<MissionBuilderPageProps> = ({
  missionStatus, deployMission, queue, addToQueue, removeFromQueue,
  reorderQueue, clearQueue, startQueue
}) => {
  const [mode, setMode] = useState<'BUILD' | 'UPLOAD'>('BUILD');

  // BUILD mode state
  const [missionId, setMissionId] = useState('SAR_MISSION_01');
  const [steps, setSteps] = useState<MissionStep[]>([]);
  const [action, setAction] = useState<MissionStep['action']>('TAKEOFF');
  const [alt, setAlt] = useState('14');
  const [north, setNorth] = useState('0');
  const [east, setEast] = useState('0');
  const [yaw, setYaw] = useState('0');
  const [pattern, setPattern] = useState<'CREEPING_LINE' | 'SQUARE'>('CREEPING_LINE');
  const [duration, setDuration] = useState('30');

  // UPLOAD mode state
  const [uploadedMission, setUploadedMission] = useState<{ mission_id: string; plan: unknown[] } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Deploy state (single-mission legacy)
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);

  // Build: add step
  const handleAddStep = () => {
    const nextStepNum = steps.length + 1;
    const step: MissionStep = { step: nextStepNum, action };

    if (['TAKEOFF', 'GOTO', 'SEARCH'].includes(action)) step.alt = parseFloat(alt) || 0;
    if (['GOTO', 'SEARCH'].includes(action)) {
      step.north = parseFloat(north) || 0;
      step.east = parseFloat(east) || 0;
    }
    if (action === 'GOTO') step.yaw = parseFloat(yaw) || 0;
    if (action === 'SEARCH') step.pattern = pattern;
    if (action === 'HOLD') step.duration_sec = parseFloat(duration) || 0;

    setSteps([...steps, step]);
  };

  const handleClear = () => setSteps([]);

  // Upload: parse and validate file
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploadedMission(null);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);

        if (!parsed.mission_id || typeof parsed.mission_id !== 'string') {
          setUploadError('Missing or invalid mission_id (must be a string)');
          return;
        }
        if (!Array.isArray(parsed.plan)) {
          setUploadError('plan is not an array');
          return;
        }
        for (let i = 0; i < parsed.plan.length; i++) {
          const step = parsed.plan[i];
          if (!step.action || typeof step.action !== 'string') {
            setUploadError(`Step ${i + 1}: missing or invalid "action"`);
            return;
          }
          if (!ALLOWED_ACTIONS.includes(step.action)) {
            setUploadError(`Step ${i + 1}: unknown action "${step.action}"`);
            return;
          }
          if (typeof step.step !== 'number') {
            setUploadError(`Step ${i + 1}: missing or invalid "step" number`);
            return;
          }
        }

        setUploadedMission({ mission_id: parsed.mission_id, plan: parsed.plan });
      } catch {
        setUploadError('Invalid JSON — could not parse file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Add current draft to queue
  const handleAddToQueue = () => {
    const mission = mode === 'BUILD'
      ? (steps.length > 0 ? { mission_id: missionId, plan: steps } : null)
      : uploadedMission;
    if (!mission) return;
    addToQueue(mission);
  };

  // Deploy single mission (backward compat)
  const handleDeploy = async (mission: { mission_id: string; plan: unknown[] }) => {
    setDeploying(true);
    setDeployError(null);
    const result = await deployMission(mission);
    if (!result.ok) {
      setDeployError(result.error);
    }
    setDeploying(false);
  };

  const pendingMission = mode === 'BUILD'
    ? (steps.length > 0 ? { mission_id: missionId, plan: steps } : null)
    : uploadedMission;

  const isQueueProcessing = queue.some(q => q.status === 'running' || q.status === 'saving' || q.status === 'loaded');
  const hasQueuedItems = queue.length > 0;

  return (
    <div className="h-full grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* LEFT COLUMN: BUILD/UPLOAD + QUEUE */}
      <div className="flex flex-col gap-4 h-full overflow-y-auto">
        {/* MODE TOGGLE */}
        <Bento className="shrink-0">
          <div className="flex gap-1 p-0.5 bg-overlay border border-border-lo">
            <button
              onClick={() => setMode('BUILD')}
              className={`flex-1 py-2 text-[11px] uppercase font-mono font-bold tracking-wider transition-colors cursor-pointer ${
                mode === 'BUILD'
                  ? 'bg-text text-base'
                  : 'text-text-faint hover:text-text'
              }`}
            >
              BUILD
            </button>
            <button
              onClick={() => setMode('UPLOAD')}
              className={`flex-1 py-2 text-[11px] uppercase font-mono font-bold tracking-wider transition-colors cursor-pointer ${
                mode === 'UPLOAD'
                  ? 'bg-text text-base'
                  : 'text-text-faint hover:text-text'
              }`}
            >
              UPLOAD
            </button>
          </div>
        </Bento>

        {/* BUILD MODE */}
        {mode === 'BUILD' && (
          <>
            <Bento title="MISSION CONFIGURATION" className="shrink-0">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] text-text-faint uppercase tracking-widest font-mono">MISSION ID</label>
                <input
                  type="text"
                  value={missionId}
                  onChange={e => setMissionId(e.target.value)}
                  className="bg-overlay border border-border text-text p-2 outline-none focus:border-border-hi uppercase font-display text-sm caret-text"
                />
              </div>
            </Bento>

            {/* WAYPOINT EDITOR — scrollable, max-height */}
            <Bento title="WAYPOINT EDITOR" className="shrink-0 max-h-[340px] overflow-y-auto">
              <div className="flex flex-col gap-4 text-xs">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-text-dim">ACTION</label>
                    <select
                      value={action}
                      onChange={(e) => setAction(e.target.value as MissionStep['action'])}
                      className="bg-surface border border-border p-1 text-text outline-none"
                    >
                      {ALLOWED_ACTIONS.map(a => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-2 p-4 border border-border-lo">
                  {['TAKEOFF', 'GOTO', 'SEARCH'].includes(action) && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-text-faint uppercase tracking-widest font-mono">ALTITUDE (m)</label>
                      <input type="number" value={alt} onChange={e => setAlt(e.target.value)} className="bg-overlay border border-border text-text p-2 outline-none focus:border-border-hi font-display text-sm" />
                    </div>
                  )}
                  {['GOTO', 'SEARCH'].includes(action) && (
                    <>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-text-faint uppercase tracking-widest font-mono">NORTH (m)</label>
                        <input type="number" value={north} onChange={e => setNorth(e.target.value)} className="bg-overlay border border-border text-text p-2 outline-none focus:border-border-hi font-display text-sm" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-text-faint uppercase tracking-widest font-mono">EAST (m)</label>
                        <input type="number" value={east} onChange={e => setEast(e.target.value)} className="bg-overlay border border-border text-text p-2 outline-none focus:border-border-hi font-display text-sm" />
                      </div>
                    </>
                  )}
                  {action === 'GOTO' && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-text-faint uppercase tracking-widest font-mono">YAW (deg)</label>
                      <input type="number" value={yaw} onChange={e => setYaw(e.target.value)} className="bg-overlay border border-border text-text p-2 outline-none focus:border-border-hi font-display text-sm" />
                    </div>
                  )}
                  {action === 'SEARCH' && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-text-faint uppercase tracking-widest font-mono">PATTERN</label>
                      <select value={pattern} onChange={e => setPattern(e.target.value as 'CREEPING_LINE' | 'SQUARE')} className="bg-overlay border border-border text-text p-2 outline-none focus:border-border-hi font-display text-sm">
                        <option value="CREEPING_LINE">CREEPING_LINE</option>
                        <option value="SQUARE">SQUARE</option>
                      </select>
                    </div>
                  )}
                  {action === 'HOLD' && (
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-text-faint uppercase tracking-widest font-mono">DURATION (sec)</label>
                      <input type="number" value={duration} onChange={e => setDuration(e.target.value)} className="bg-overlay border border-border text-text p-2 outline-none focus:border-border-hi font-display text-sm" />
                    </div>
                  )}
                </div>

                <button
                  onClick={handleAddStep}
                  className="mt-2 border border-border p-2 hover:bg-raised hover:text-text transition-colors uppercase tracking-widest text-center"
                >
                  APPEND STEP TO SEQUENCE
                </button>
              </div>
            </Bento>
          </>
        )}

        {/* UPLOAD MODE */}
        {mode === 'UPLOAD' && (
          <Bento title="UPLOAD MISSION FILE" className="shrink-0">
            <div className="flex flex-col gap-4 text-xs">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border border-dashed border-text-faint p-8 text-center cursor-pointer hover:border-text hover:bg-raised transition-colors"
              >
                <div className="text-text-faint mb-2">CLICK TO SELECT .json FILE</div>
                <div className="text-text-disabled text-[10px]">Accepts: mission JSON with mission_id and plan array</div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                className="hidden"
              />

              {uploadError && (
                <div className="text-red text-[10px] border border-red p-2 bg-red-bg">
                  VALIDATION ERROR: {uploadError}
                </div>
              )}

              {uploadedMission && (
                <div className="flex flex-col gap-2 border border-border p-3 bg-surface">
                  <div className="text-green font-bold">FILE PARSED SUCCESSFULLY</div>
                  <div className="flex justify-between">
                    <span className="text-text-dim">MISSION ID</span>
                    <span className="text-text font-bold">{uploadedMission.mission_id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-dim">TOTAL STEPS</span>
                    <span className="text-text">{uploadedMission.plan.length}</span>
                  </div>
                </div>
              )}
            </div>
          </Bento>
        )}

        {/* QUEUE PANEL */}
        <Bento title={`MISSION QUEUE (${queue.length})`} className="shrink-0">
          <div className="flex flex-col gap-2 text-xs">
            {queue.length === 0 ? (
              <div className="text-text-disabled italic py-2 text-center">
                No missions queued. Build or upload, then ADD TO QUEUE.
              </div>
            ) : (
              <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto">
                {queue.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 p-2 border border-border-lo bg-surface ${
                      item.status === 'running' ? 'border-green bg-raised' :
                      item.status === 'completed' ? 'border-green/30' :
                      item.status === 'failed' ? 'border-red' : ''
                    }`}
                  >
                    <span className="text-text-faint w-4 text-right">{idx + 1}</span>
                    <span className="flex-1 truncate text-text">{item.mission.mission_id}</span>
                    <span className={`text-[10px] w-16 text-right ${QUEUE_STATUS_COLORS[item.status]}`}>
                      {QUEUE_STATUS_LABELS[item.status]}
                    </span>
                    {item.status === 'queued' && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => idx > 0 && reorderQueue(idx, idx - 1)}
                          disabled={idx === 0}
                          className="text-text-faint hover:text-text disabled:opacity-30 px-1"
                        >↑</button>
                        <button
                          onClick={() => idx < queue.length - 1 && reorderQueue(idx, idx + 1)}
                          disabled={idx === queue.length - 1}
                          className="text-text-faint hover:text-text disabled:opacity-30 px-1"
                        >↓</button>
                        <button
                          onClick={() => removeFromQueue(item.id)}
                          className="text-red hover:text-text px-1"
                        >×</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {queue.length > 0 && (
              <div className="flex gap-2 mt-1">
                <button
                  onClick={clearQueue}
                  disabled={isQueueProcessing}
                  className="flex-1 border border-border p-2 text-text-dim hover:bg-raised disabled:opacity-40"
                >
                  CLEAR QUEUE
                </button>
                <button
                  onClick={startQueue}
                  disabled={isQueueProcessing || queue.every(q => q.status !== 'queued')}
                  className="flex-1 border border-text text-text p-2 hover:bg-text hover:text-base transition-colors disabled:opacity-40 font-bold"
                >
                  {isQueueProcessing ? 'PROCESSING...' : 'START QUEUE'}
                </button>
              </div>
            )}
          </div>
        </Bento>

        {/* ADD TO QUEUE + DEPLOY SINGLE */}
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleAddToQueue}
            disabled={!pendingMission}
            className="flex-1 border border-border p-2 text-xs hover:bg-raised hover:text-text transition-colors uppercase tracking-widest disabled:opacity-40"
          >
            + ADD TO QUEUE
          </button>
          <button
            onClick={() => pendingMission && handleDeploy(pendingMission)}
            disabled={!pendingMission || deploying}
            className="flex-1 border border-border p-2 text-xs hover:bg-text hover:text-base transition-colors disabled:opacity-40 uppercase tracking-widest"
          >
            {deploying ? 'DEPLOYING...' : 'DEPLOY NOW'}
          </button>
        </div>
        {deployError && (
          <div className="text-red text-[10px] border border-red p-2 bg-red-bg shrink-0">
            DEPLOY FAILED: {deployError}
          </div>
        )}
      </div>

      {/* RIGHT COLUMN: PREVIEW + STATUS */}
      <div className="flex flex-col gap-4 h-full min-h-0 overflow-hidden">
        <Bento title={mode === 'BUILD' ? 'FLIGHT PLAN PREVIEW' : 'UPLOADED MISSION PREVIEW'} className="flex-1 min-h-0">
          <div className="flex flex-col h-full min-h-0">
            <div className="flex-1 overflow-y-auto mb-4 border border-border-lo p-2 bg-overlay text-[10px] space-y-1 min-h-0">
              {mode === 'BUILD' ? (
                steps.length === 0 ? (
                  <span className="text-text-disabled italic">SEQUENCE EMPTY</span>
                ) : (
                  <pre className="text-text-dim whitespace-pre-wrap font-mono">
                    {JSON.stringify({ mission_id: missionId, plan: steps }, null, 2)}
                  </pre>
                )
              ) : (
                uploadedMission ? (
                  <pre className="text-text-dim whitespace-pre-wrap font-mono">
                    {JSON.stringify(uploadedMission, null, 2)}
                  </pre>
                ) : (
                  <span className="text-text-disabled italic">NO FILE UPLOADED</span>
                )
              )}
            </div>
            {mode === 'BUILD' && (
              <button onClick={handleClear} className="shrink-0 border border-border p-2 text-text-dim hover:bg-raised w-full">
                CLEAR SEQUENCE
              </button>
            )}
          </div>
        </Bento>

        {/* DEPLOYED MISSION STATUS */}
        <Bento title="DEPLOYED MISSION STATUS" className="shrink-0">
          {missionStatus.loaded && missionStatus.mission_id ? (
            <div className="flex flex-col gap-2 text-xs">
              <div className="flex justify-between items-center bg-raised p-2 border border-border-lo">
                <span className="text-text-dim">MISSION ID</span>
                <span className="text-text font-bold">{missionStatus.mission_id}</span>
              </div>
              <div className="flex justify-between items-center bg-raised p-2 border border-border-lo">
                <span className="text-text-dim">TOTAL STEPS</span>
                <span className="text-text">{missionStatus.total_steps}</span>
              </div>
              <div className="flex justify-between items-center bg-raised p-2 border border-border-lo">
                <span className="text-[10px] text-text-faint uppercase tracking-widest font-mono">STATUS</span>
                <span className={`font-display font-semibold text-sm ${missionStatus.running ? 'text-green' : missionStatus.paused ? 'text-yellow' : 'text-text-faint'}`}>
                  {missionStatus.running ? 'RUNNING' : missionStatus.paused ? 'PAUSED' : 'LOADED'}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-text-disabled text-xs italic py-4 text-center">
              No mission deployed.
            </div>
          )}
        </Bento>
      </div>
    </div>
  );
};
