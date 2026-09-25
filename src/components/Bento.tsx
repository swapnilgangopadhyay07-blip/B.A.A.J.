import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface BentoProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  isAlert?: boolean;
  variant?: 'flat' | 'glass';
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  headerExtra?: React.ReactNode;
}

export const Bento: React.FC<BentoProps> = ({
  title, children, className = '', isAlert = false, variant = 'glass',
  collapsible = false, collapsed: controlledCollapsed, onToggleCollapse, headerExtra,
}) => {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const isCollapsed = collapsible
    ? controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed
    : false;

  const handleToggle = () => {
    if (!collapsible) return;
    if (onToggleCollapse) { onToggleCollapse(); }
    else { setInternalCollapsed(prev => !prev); }
  };

  const sanitizedClassName = isCollapsed
    ? className.replace(/\bflex-1\b/g, '').replace(/\bh-\[[^\]]+\]/g, '')
        .replace(/\bmin-h-\[[^\]]+\]/g, '').replace(/\bmax-h-\[[^\]]+\]/g, '')
        .replace(/\bh-full\b/g, '').trim()
    : className;

  const containerClass =
    variant === 'glass'
      ? `glass-panel ${isAlert ? 'border-red' : ''} ${isCollapsed ? 'p-2.5 px-3.5 shrink-0 h-auto min-h-0' : 'p-3 md:p-4'} flex flex-col transition-all duration-200`
      : `border ${isAlert ? 'border-red' : 'border-border'} bg-panel ${isCollapsed ? 'p-2.5 px-3.5 shrink-0 h-auto min-h-0' : 'p-3 md:p-4'} flex flex-col transition-all duration-200`;

  const titleClass = `text-[10px] tracking-[0.2em] uppercase ${
    isAlert ? 'text-red' : 'text-text-dim'
  } select-none font-bold`;

  return (
    <div className={`${containerClass} ${sanitizedClassName}`}>
      {title && (
        <div
          onClick={collapsible ? handleToggle : undefined}
          className={`flex items-center justify-between ${
            collapsible ? 'cursor-pointer hover:opacity-90' : ''
          } ${
            isCollapsed ? 'mb-0 pb-0 border-b-0' : `mb-3 pb-2 border-b ${isAlert ? 'border-red' : 'border-border'}`
          }`}
        >
          <div className="flex items-center gap-2">
            <span className={titleClass}>{title}</span>
            {isCollapsed && <span className="text-[9px] text-text-faint tracking-wider uppercase font-normal">[MIN]</span>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {headerExtra}
            {collapsible && (
              <button type="button" aria-label={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
                className="text-text-faint hover:text-text p-0.5 transition-colors">
                {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>
      )}
      {!isCollapsed && <div className="flex-1 min-h-0 relative">{children}</div>}
    </div>
  );
};
