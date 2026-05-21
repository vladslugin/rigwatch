import { useState, useEffect, useCallback, useRef } from 'react';

interface UseGlobalSearchResult {
  isSearchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  toggleSearch: () => void;
}

export const useGlobalSearch = (): UseGlobalSearchResult => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const lastShiftPressRef = useRef<number>(0);
  const shiftCountRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
  }, []);

  const toggleSearch = useCallback(() => {
    setIsSearchOpen(prev => !prev);
  }, []);

  // Handle double shift detection
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only trigger on Shift key
      if (event.key !== 'Shift') {
        return;
      }

      // Prevent triggering when typing in input fields
      const activeElement = document.activeElement;
      if (activeElement && (
        activeElement.tagName === 'INPUT' || 
        activeElement.tagName === 'TEXTAREA' || 
        activeElement.hasAttribute('contenteditable')
      )) {
        return;
      }

      const now = Date.now();
      const timeDifference = now - lastShiftPressRef.current;

      // Reset counter if too much time has passed (500ms window)
      if (timeDifference > 500) {
        shiftCountRef.current = 0;
      }

      shiftCountRef.current += 1;
      lastShiftPressRef.current = now;

      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // If we have two shift presses within 500ms, open search
      if (shiftCountRef.current >= 2) {
        console.log('[GlobalSearch] Double shift detected, opening search');
        setIsSearchOpen(true);
        shiftCountRef.current = 0; // Reset counter
        return;
      }

      // Set timeout to reset counter after 500ms
      timeoutRef.current = setTimeout(() => {
        shiftCountRef.current = 0;
      }, 500);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      // Close search on Escape key
      if (event.key === 'Escape' && isSearchOpen) {
        setIsSearchOpen(false);
      }
    };

    // Add event listeners
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isSearchOpen]);

  return {
    isSearchOpen,
    openSearch,
    closeSearch,
    toggleSearch,
  };
};

export default useGlobalSearch;
