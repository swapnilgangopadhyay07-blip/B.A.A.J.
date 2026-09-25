import React from 'react';

interface LoadingScreenProps {
  fadeOut?: boolean;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ fadeOut = false }) => {
  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-between py-12 px-6 bg-[#070707] transition-opacity duration-700 select-none ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{ backgroundColor: '#070707' }}
    >
      {/* Top spacing / balance */}
      <div className="w-full h-8" />

      {/* Center section: Logo and Wordmark */}
      <div className="flex flex-col items-center justify-center max-w-sm w-full animate-fadeIn">
        {/* Top Logo: LogoSIH_white */}
        <div className="w-28 h-28 md:w-36 md:h-36 flex items-center justify-center">
          <img
            src="/LogoSIH_white.svg"
            alt="B.A.A.J Logo"
            className="w-full h-full object-contain drop-shadow-[0_4px_24px_rgba(255,255,255,0.08)]"
          />
        </div>

        {/* Word Logo under it with padding: LogoSIH_word */}
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
  );
};
