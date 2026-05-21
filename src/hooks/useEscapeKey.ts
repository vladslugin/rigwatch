import { useEffect } from 'react';

interface UseEscapeKeyOptions {
  enabled?: boolean;
  preventDefault?: boolean;
}

export function useEscapeKey(
  callback: () => void,
  options: UseEscapeKeyOptions = {}
) {
  const { enabled = true, preventDefault = true } = options;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (preventDefault) {
          event.preventDefault();
        }
        callback();
      }
    };

    // Use window + capture to bypass stopPropagation in inner elements
    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [callback, enabled, preventDefault]);
}
