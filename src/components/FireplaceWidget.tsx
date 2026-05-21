import React, { useState, useRef, useEffect } from 'react';

interface Position {
  x: number;
  y: number;
}

const FireplaceWidget: React.FC = () => {
  const [position, setPosition] = useState<Position>({ x: 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('fireplace-widget-visible');
      return saved != null ? (saved === '1' || saved === 'true') : false; // default hidden
    } catch {
      return false; // default hidden if localStorage unavailable
    }
  });
  const [currentTime, setCurrentTime] = useState(new Date());
  const widgetRef = useRef<HTMLDivElement>(null);
  const lastCtrlPressRef = useRef<number>(0);
  const VISIBILITY_STORAGE_KEY = 'fireplace-widget-visible';
  

  // Update time every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // (Initial visibility already read synchronously from localStorage in useState initializer)

  // Persist visibility to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(VISIBILITY_STORAGE_KEY, isVisible ? '1' : '0');
    } catch {}
  }, [isVisible]);

  // Hotkey: Double-press Ctrl to toggle visibility
  useEffect(() => {
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'Control') return;
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (target as any)?.isContentEditable) return;

      const now = Date.now();
      if (now - lastCtrlPressRef.current < 350) {
        setIsVisible(v => !v);
        lastCtrlPressRef.current = 0;
      } else {
        lastCtrlPressRef.current = now;
      }
    };

    window.addEventListener('keyup', handleKeyUp, true);
    return () => window.removeEventListener('keyup', handleKeyUp, true);
  }, []);

  

  

  

  

  

  useEffect(() => {
    let rafId: number | null = null;
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const nextX = e.clientX - dragOffset.x;
      const nextY = e.clientY - dragOffset.y;
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setPosition({ x: nextX, y: nextY });
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    if (widgetRef.current) {
      const rect = widgetRef.current.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      setIsDragging(true);
    }
  };

  const handleToggleVisibility = () => {
    setIsVisible(!isVisible);
  };

  // Widget dimensions
  const widgetWidth = 120;
  const widgetHeight = 110;
  const flameScale = 1;

  if (!isVisible) {
    return null;
  }

  return (
    <>
      <div
        ref={widgetRef}
        className="fixed z-[10000] bg-card rounded-lg shadow-2xl border border-orange-800 overflow-hidden select-none cursor-move"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${widgetWidth}px`,
          height: `${widgetHeight}px`,
          transition: isDragging ? 'none' : 'width 0.2s ease, height 0.2s ease',
          cursor: isDragging ? 'grabbing' : 'grab',
          willChange: isDragging ? 'left, top' : 'auto',
        }}
        onMouseDownCapture={handleMouseDown}
        onDragStart={(e) => e.preventDefault()}
      >
        {/* Close button */}
        <div className="absolute top-1 right-1 z-10">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handleToggleVisibility}
            aria-label="Widget ausblenden"
            className="w-4 h-4 flex items-center justify-center rounded-full bg-muted/60 hover:bg-accent text-foreground shadow-md p-0"
            title="Widget ausblenden"
          >
            <svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true">
              <path d="M1 1 L11 11 M11 1 L1 11" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Fireplace container */}
        <div 
          className="relative w-full bg-gradient-to-b from-card to-background rounded-lg overflow-hidden"
          style={{ 
            height: 'calc(100% - 20px)',
            marginTop: '0px',
          }}
        >
          {/* Scaled flame container */}
          <div 
            style={{
              transform: `scale(${flameScale})`,
              transformOrigin: 'center bottom',
              width: '100%',
              height: '100%',
              position: 'relative',
            }}
          >
          {/* Fireplace base */}
          <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-gray-700 to-gray-600 pointer-events-none"></div>
          
          {/* Wood logs (closer to center) */}
          <div className="absolute bottom-3 w-6 h-1.5 bg-amber-800 rounded-full transform -rotate-12 pointer-events-none" style={{ left: 'calc(50% - 42px)' }}></div>
          <div className="absolute bottom-3 w-6 h-1.5 bg-amber-900 rounded-full transform rotate-12 pointer-events-none" style={{ left: 'calc(50% + 18px)' }}></div>
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-8 h-1.5 bg-amber-700 rounded-full pointer-events-none"></div>
          <div className="absolute bottom-2.5 w-4 h-1 bg-amber-900 rounded-full transform rotate-45 pointer-events-none" style={{ left: 'calc(50% - 30px)' }}></div>
          <div className="absolute bottom-2.5 w-4 h-1 bg-amber-800 rounded-full transform -rotate-45 pointer-events-none" style={{ left: 'calc(50% + 12px)' }}></div>

            {/* Main flame area */}
            <div className="absolute bottom-4 left-0 right-0">
            {/* Wrapper centers children without relying on child transform */}
            <div className="relative w-full flame-animation pointer-events-none" style={{ height: '36px' }}>
              {/* Large central flame - hard centered */}
              <div className="flame flame-large" style={{ position: 'absolute', bottom: 0, left: 'calc(50% - 8px)' }}></div>
              
              {/* Medium flames */}
              <div className="flame flame-medium" style={{ position: 'absolute', bottom: 0, left: 'calc(50% - 5px - 10px)' }}></div>
              <div className="flame flame-medium-2" style={{ position: 'absolute', bottom: 0, left: 'calc(50% - 4px + 10px)' }}></div>
              
              {/* Small flames - only 2 */}
              <div className="flame flame-small" style={{ position: 'absolute', bottom: 0, left: 'calc(50% - 3px - 16px)' }}></div>
              <div className="flame flame-small-2" style={{ position: 'absolute', bottom: 0, left: 'calc(50% - 2.5px + 16px)' }}></div>
              
              {/* Centered sparks with ±15% radius */}
              <div className="spark spark-1" style={{ position: 'absolute', left: 'calc(50% - 7px)' }}></div>
              <div className="spark spark-2" style={{ position: 'absolute', left: 'calc(50% - 2px)' }}></div>
              <div className="spark spark-3" style={{ position: 'absolute', left: 'calc(50% + 2px)' }}></div>
              <div className="spark spark-4" style={{ position: 'absolute', left: 'calc(50% + 7px)' }}></div>
              <div className="spark spark-5" style={{ position: 'absolute', left: 'calc(50% - 10px)' }}></div>
              <div className="spark spark-6" style={{ position: 'absolute', left: 'calc(50% + 10px)' }}></div>
              
              {/* Smoke effects */}
              <div className="smoke smoke-1" style={{ position: 'absolute', left: 'calc(50% - 4px - 1px)' }}></div>
              <div className="smoke smoke-2" style={{ position: 'absolute', left: 'calc(50% - 4px + 1px)' }}></div>
              <div className="smoke smoke-3" style={{ position: 'absolute', left: 'calc(50% - 4px + 5px)' }}></div>
            </div>
          </div>

            {/* Ember glow effects */}
            <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 w-12 h-2 bg-orange-600 opacity-60 blur-sm rounded-full animate-pulse pointer-events-none"></div>
            <div className="absolute bottom-1 left-1/4 w-4 h-1 bg-red-500 opacity-40 blur-sm rounded-full animate-pulse pointer-events-none" style={{ animationDelay: '0.5s' }}></div>
            <div className="absolute bottom-1 right-1/4 w-4 h-1 bg-orange-500 opacity-50 blur-sm rounded-full animate-pulse pointer-events-none" style={{ animationDelay: '1s' }}></div>
          </div>
        </div>

        {/* Time display */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-card via-background to-card text-center py-1 rounded-b-lg pointer-events-none">
          <div className="text-orange-300 text-xs font-mono font-semibold tracking-wider pointer-events-none">
            {currentTime.toLocaleTimeString('en-GB', { 
              hour: '2-digit', 
              minute: '2-digit',
              second: '2-digit'
            })}
          </div>
        </div>
      </div>

      {/* CSS Styles */}
      <style>{`
        .flame {
          border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
          background: linear-gradient(
            to top,
            #ff4500 0%,
            #ff6500 25%,
            #ff8500 50%,
            #ffa500 75%,
            #ffff00 100%
          );
          animation: flicker 0.5s ease-in-out infinite alternate;
          transform-origin: bottom center;
        }

        .flame-large {
          width: 16px;
          height: 32px;
          animation-delay: 0s;
        }

        .flame-medium {
          width: 10px;
          height: 20px;
          animation-delay: 0.2s;
        }

        .flame-medium-2 {
          width: 8px;
          height: 18px;
          animation-delay: 0.6s;
        }

        .flame-small {
          width: 6px;
          height: 12px;
          animation-delay: 0.4s;
        }

        .flame-small-2 {
          width: 5px;
          height: 10px;
          animation-delay: 0.9s;
        }

        .spark {
          width: 2px;
          height: 2px;
          background: #ffff00;
          border-radius: 50%;
          animation: sparkle 2s infinite linear;
        }

        .spark-1 {
          left: 20px;
          bottom: 20px;
          animation-delay: 0s;
        }

        .spark-2 {
          left: 26px;
          bottom: 25px;
          animation-delay: 0.7s;
        }

        .spark-3 {
          left: 30px;
          bottom: 18px;
          animation-delay: 1.4s;
        }

        .spark-4 {
          left: 23px;
          bottom: 30px;
          animation-delay: 0.3s;
        }

        .spark-5 {
          left: 28px;
          bottom: 22px;
          animation-delay: 1.1s;
        }

        .spark-6 {
          left: 24px;
          bottom: 28px;
          animation-delay: 1.8s;
        }

        .smoke {
          width: 8px;
          height: 12px;
          background: radial-gradient(circle, rgba(128, 128, 128, 0.3) 0%, rgba(64, 64, 64, 0.1) 70%, transparent 100%);
          border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%;
          animation: smoke-rise 4s infinite linear;
          filter: blur(1px);
        }

        .smoke-1 {
          left: 22px;
          bottom: 35px;
          animation-delay: 0s;
        }

        .smoke-2 {
          left: 28px;
          bottom: 38px;
          animation-delay: 1.5s;
        }

        .smoke-3 {
          left: 25px;
          bottom: 40px;
          animation-delay: 3s;
        }

        @keyframes flicker {
          0% {
            transform: scaleY(1) scaleX(1) rotate(-1deg);
            opacity: 0.9;
          }
          25% {
            transform: scaleY(1.1) scaleX(0.9) rotate(1deg);
            opacity: 1;
          }
          50% {
            transform: scaleY(0.9) scaleX(1.1) rotate(-0.5deg);
            opacity: 0.95;
          }
          75% {
            transform: scaleY(1.05) scaleX(0.95) rotate(0.5deg);
            opacity: 1;
          }
          100% {
            transform: scaleY(0.95) scaleX(1.05) rotate(-1deg);
            opacity: 0.9;
          }
        }

        @keyframes sparkle {
          0% {
            opacity: 0;
            transform: translateY(0px) translateX(0px) scale(0);
          }
          15% {
            opacity: 1;
            transform: translateY(-8px) translateX(2px) scale(1);
          }
          45% {
            opacity: 0.8;
            transform: translateY(-18px) translateX(-1px) scale(0.9);
          }
          75% {
            opacity: 0.6;
            transform: translateY(-28px) translateX(3px) scale(0.7);
          }
          90% {
            opacity: 0.3;
            transform: translateY(-35px) translateX(-2px) scale(0.4);
          }
          100% {
            opacity: 0;
            transform: translateY(-42px) translateX(1px) scale(0);
          }
        }

        @keyframes smoke-rise {
          0% {
            opacity: 0;
            transform: translateY(0px) translateX(0px) scale(0.8);
          }
          10% {
            opacity: 0.4;
            transform: translateY(-8px) translateX(1px) scale(0.9);
          }
          30% {
            opacity: 0.3;
            transform: translateY(-20px) translateX(-2px) scale(1.1);
          }
          60% {
            opacity: 0.2;
            transform: translateY(-35px) translateX(3px) scale(1.3);
          }
          85% {
            opacity: 0.1;
            transform: translateY(-50px) translateX(-1px) scale(1.5);
          }
          100% {
            opacity: 0;
            transform: translateY(-65px) translateX(2px) scale(1.8);
          }
        }

        @keyframes flicker-intense {
          0% {
            transform: scaleY(1.2) scaleX(0.8) rotate(-2deg);
            opacity: 1;
          }
          20% {
            transform: scaleY(0.8) scaleX(1.2) rotate(1.5deg);
            opacity: 0.85;
          }
          40% {
            transform: scaleY(1.1) scaleX(0.9) rotate(-1deg);
            opacity: 0.95;
          }
          60% {
            transform: scaleY(0.9) scaleX(1.1) rotate(2deg);
            opacity: 0.9;
          }
          80% {
            transform: scaleY(1.05) scaleX(0.95) rotate(-0.5deg);
            opacity: 1;
          }
          100% {
            transform: scaleY(0.95) scaleX(1.05) rotate(1deg);
            opacity: 0.88;
          }
        }

        .flame-large {
          animation: flicker-intense 0.4s ease-in-out infinite alternate;
        }

        .flame-medium, .flame-medium-2 {
          animation: flicker 0.6s ease-in-out infinite alternate;
        }

        .flame-small, .flame-small-2 {
          animation: flicker 0.8s ease-in-out infinite alternate;
        }

        .flame-animation {
          filter: drop-shadow(0 0 12px rgba(255, 165, 0, 0.7)) drop-shadow(0 0 6px rgba(255, 69, 0, 0.5));
        }
      `}</style>
    </>
  );
};

export default FireplaceWidget;
