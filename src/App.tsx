import React, { useState, useEffect } from 'react';
import { useBridge } from './hooks/useBridge';
import { CommsPage } from './pages/CommsPage';
import { MissionBuilderPage } from './pages/MissionBuilderPage';
import { FeedbackPage } from './pages/FeedbackPage';
import { Preloader } from './components/Preloader';
import { Radio, Route, Activity, ShieldAlert } from 'lucide-react';

type Tab = 'COMMS' | 'MISSION_BUILDER' | 'FEEDBACK';

interface NavItem {
  id: Tab;
  label: string;
  shortLabel: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'FEEDBACK', label: 'FEEDBACK', shortLabel: 'FDBK', icon: Activity },
  { id: 'MISSION_BUILDER', label: 'MISSION BUILDER', shortLabel: 'MSN', icon: Route },
  { id: 'COMMS', label: 'COMMS', shortLabel: 'COMMS', icon: Radio },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('FEEDBACK');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const {
    telemetry, missionStatus, connectionState, logs, packets,
    sendCommand, sendMissionControl, deployMission,
    queue, queueIndex, addToQueue, removeFromQueue, reorderQueue,
    clearQueue, startQueue, abortQueue
  } = useBridge();

  const isSurvivorLocked = telemetry?.survivor_lock === true;

  const statusColor =
    connectionState === 'CONNECTED' ? 'border-green text-green' :
    connectionState === 'STALE' ? 'border-amber text-amber animate-pulse' :
    connectionState === 'BRIDGE_ONLY' ? 'border-amber text-amber animate-pulse' :
    connectionState === 'CONNECTING' ? 'border-yellow text-yellow' :
    'border-red text-red animate-pulse bg-red-bg';

  const statusAbbrev: Record<string, string> = {
    BRIDGE_ONLY: 'BRIDGE',
    CONNECTED: 'CONN',
    CONNECTING: 'INIT',
    STALE: 'STALE',
    DISCONNECTED: 'DISC',
  };

  return (
    <div className="h-screen w-screen bg-base text-text font-mono flex flex-col md:flex-row items-start p-2 md:p-4 gap-2 md:gap-4 overflow-hidden select-none">

      {/* TACTICAL NAVIGATION RAIL */}
      <aside className="relative z-20 shrink-0 flex md:flex-col justify-start items-center glass-panel p-1 md:w-14 gap-1.5 h-fit">
        {/* MINIMAL B.A.A.J LOGO (NO EXTRA SURROUNDING BOX) */}
        <div className="flex items-center justify-center w-9 h-9 md:w-11 md:h-11 my-0.5" title="B.A.A.J">
          <img
            src="/LogoSIH_white (1).svg"
            alt="B.A.A.J"
            className="w-full h-full object-contain pointer-events-none select-none drop-shadow-sm"
          />
        </div>

        <div className="flex md:flex-col items-center gap-0.5 w-full">
          <nav className="flex md:flex-col gap-0.5 w-full">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <div key={item.id} className="relative group">
                  <button
                    onClick={() => setActiveTab(item.id)}
                    title={item.label}
                    aria-label={item.label}
                    className={`relative flex flex-col items-center justify-center w-10 h-10 md:w-full md:h-14 border transition-colors cursor-pointer ${
                      isActive
                        ? 'border-text bg-text text-base font-bold'
                        : 'border-border bg-base text-text-dim hover:border-border-hi hover:text-text'
                    }`}
                  >
                    <Icon className="w-6 h-6 md:w-7 md:h-7 shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                    <span className={`text-[9px] tracking-wider uppercase mt-0.5 leading-none ${isActive ? 'text-base font-bold' : 'text-text-faint'}`}>
                      {item.shortLabel}
                    </span>
                  </button>
                  <div className="hidden md:flex absolute left-full top-0 ml-2 items-center h-14 px-3 glass-panel border border-border-hi opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-150 whitespace-nowrap z-50">
                    <span className="text-[11px] font-mono uppercase tracking-wider text-text">{item.label}</span>
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        <div className="flex md:flex-col items-center gap-1 mt-auto shrink-0">
          {isSurvivorLocked && (
            <div
              title="SURVIVOR LOCKED"
              className="flex items-center justify-center w-8 h-8 border border-red bg-red text-base animate-pulse"
            >
              <ShieldAlert className="w-4 h-4" />
            </div>
          )}
          {activeTab !== 'FEEDBACK' && (
            <div
              title={`Status: ${connectionState === 'BRIDGE_ONLY' ? 'WAITING FOR DRONE' : connectionState}`}
              className={`border px-1.5 py-1 md:w-full text-center text-[9px] uppercase tracking-wider font-bold transition-colors ${statusColor}`}
            >
              <span className="md:hidden">
                {connectionState === 'BRIDGE_ONLY' ? 'WAIT' : connectionState}
              </span>
              <span className="hidden md:inline leading-tight">
                {statusAbbrev[connectionState] ?? connectionState}
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* CONTENT AREA */}
      <main className="relative z-10 flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
        {activeTab === 'COMMS' && (
          <CommsPage packets={packets} connectionState={connectionState} telemetry={telemetry} />
        )}
        {activeTab === 'MISSION_BUILDER' && (
          <MissionBuilderPage
            missionStatus={missionStatus}
            deployMission={deployMission}
            queue={queue}
            addToQueue={addToQueue}
            removeFromQueue={removeFromQueue}
            reorderQueue={reorderQueue}
            clearQueue={clearQueue}
            startQueue={startQueue}
          />
        )}
        {activeTab === 'FEEDBACK' && (
          <FeedbackPage
            telemetry={telemetry}
            missionStatus={missionStatus}
            logs={logs}
            connectionState={connectionState}
            onCommand={sendCommand}
            onMissionControl={sendMissionControl}
            queue={queue}
            queueIndex={queueIndex}
            abortQueue={abortQueue}
            removeFromQueue={removeFromQueue}
            reorderQueue={reorderQueue}
            clearQueue={clearQueue}
          />
        )}
      </main>

      {/* REACTBIT OBSIDIAN PRELOADER WITH STAIRS STRIP REVEAL */}
      {isLoading && (
        <Preloader
          stairCount={8}
          stairsRevealDirection="down"
          stairsRevealFrom="left"
          duration={2400}
          onComplete={() => setIsLoading(false)}
        />
      )}
    </div>
  );
}
