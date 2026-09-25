import React, { useState, useEffect } from 'react';

interface PreloaderProps {
  onComplete?: () => void;
  stairCount?: number;
  stairsRevealDirection?: 'up' | 'down';
  stairsRevealFrom?: 'left' | 'right' | 'center';
  duration?: number; // duration of preloader logo display before reveal
}

export const Preloader: React.FC<PreloaderProps> = ({
  onComplete,
  stairCount = 8,
  stairsRevealDirection = 'down',
  stairsRevealFrom = 'left',
  duration = 2400,
}) => {
  const [phase, setPhase] = useState<'display' | 'reveal' | 'done'>('display');

  useEffect(() => {
    // Phase 1: Show solid obsidian black with logos & 3-dot pulse
    const timer = setTimeout(() => {
      setPhase('reveal');
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  // When reveal finishes
  useEffect(() => {
    if (phase === 'reveal') {
      const baseStagger = 0.09;
      const maxStagger = baseStagger * stairCount;
      const totalAnimTime = (1.4 + maxStagger + 0.2) * 1000;
      const doneTimer = setTimeout(() => {
        setPhase('done');
        onComplete?.();
      }, totalAnimTime);

      return () => clearTimeout(doneTimer);
    }
  }, [phase, stairCount, onComplete]);

  if (phase === 'done') return null;

  // Calculate delay per strip according to stairsRevealFrom
  const getDelay = (index: number) => {
    const baseStep = 0.09; // smooth, noticeable stagger between strips
    if (stairsRevealFrom === 'right') {
      return (stairCount - 1 - index) * baseStep;
    } else if (stairsRevealFrom === 'center') {
      const mid = (stairCount - 1) / 2;
      return Math.abs(index - mid) * baseStep;
    }
    return index * baseStep;
  };

  const isRevealing = phase === 'reveal';

  return (
    <div className={`fixed inset-0 z-50 overflow-hidden select-none ${isRevealing ? 'pointer-events-none' : 'pointer-events-auto'}`}>
      {/* REACTBIT PRELOADER STRIPS (STAIRS SLICED REVEAL) */}
      <div className={`absolute inset-0 flex w-full h-full ${isRevealing ? 'pointer-events-none' : 'pointer-events-auto'}`}>
        {Array.from({ length: stairCount }).map((_, i) => {
          const delay = getDelay(i);
          const transformY = isRevealing
            ? stairsRevealDirection === 'up'
              ? '-105%'
              : '105%'
            : '0%';

          return (
            <div
              key={i}
              className="h-full flex-1 bg-[#070707] will-change-transform"
              style={{
                backgroundColor: '#070707',
                transform: `translate3d(0, ${transformY}, 0)`,
                transition: `transform 1.35s cubic-bezier(0.7, 0, 0.2, 1) ${delay}s`,
              }}
            />
          );
        })}
      </div>

      {/* BRANDING CONTENT (Fades out seamlessly right as strips slide away) */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-between py-12 px-6 transition-all duration-700 ease-out pointer-events-none ${
          isRevealing ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'
        }`}
      >
        <div className="w-full h-8" />

        {/* Center: Top Logo & Word Logo */}
        <div className="flex flex-col items-center justify-center max-w-sm w-full">
          {/* LogoSIH_white */}
          <div className="w-28 h-28 md:w-36 md:h-36 flex items-center justify-center">
            <img
              src="/LogoSIH_white.svg"
              alt="B.A.A.J Logo"
              className="w-full h-full object-contain drop-shadow-[0_4px_24px_rgba(255,255,255,0.08)]"
            />
          </div>

          {/* LogoSIH_word */}
          <div className="pt-7 pb-2 w-48 md:w-64 flex items-center justify-center">
            <img
              src="/LogoSIH_word.svg"
              alt="B.A.A.J"
              className="w-full h-auto object-contain drop-shadow-[0_2px_12px_rgba(255,255,255,0.05)]"
            />
          </div>
        </div>

        {/* Bottom centered section: 3-dot loading animation */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white/90 animate-bounce [animation-delay:-0.32s]" />
            <span className="w-2 h-2 rounded-full bg-white/90 animate-bounce [animation-delay:-0.16s]" />
            <span className="w-2 h-2 rounded-full bg-white/90 animate-bounce" />
          </div>
        </div>
      </div>
    </div>
  );
};
