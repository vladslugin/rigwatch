import { useState, useEffect } from 'react';

const MOBILE_SCREEN_THRESHOLD = 768; // Standard Tailwind md breakpoint

/**
 * Custom hook to detect if the current screen width is considered mobile.
 * @returns {boolean} True if the screen width is below the mobile threshold, false otherwise.
 */
export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < MOBILE_SCREEN_THRESHOLD);
    };

    // Check on initial load
    checkScreenSize();

    // Add event listener for window resize
    window.addEventListener('resize', checkScreenSize);

    // Cleanup event listener on component unmount
    return () => {
      window.removeEventListener('resize', checkScreenSize);
    };
  }, []);

  return isMobile;
}; 