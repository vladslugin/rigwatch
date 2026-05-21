import { useCallback, useRef } from 'react';

interface UseParameterNavigationProps {
  onExpandCategory?: (categoryName: string) => void;
}

interface UseParameterNavigationResult {
  navigateToParameter: (paramId: string, categoryName: string) => void;
}

export const useParameterNavigation = ({
  onExpandCategory
}: UseParameterNavigationProps = {}): UseParameterNavigationResult => {
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigateToParameter = useCallback(async (paramId: string, categoryName: string) => {
    console.log(`[ParameterNavigation] Navigating to parameter: ${paramId} in category: ${categoryName}`);

    try {
      // Step 1: Expand category if needed
      if (onExpandCategory) {
        onExpandCategory(categoryName);
        // Wait a bit for the category to expand
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Step 2: Find the parameter element
      const parameterElement = document.querySelector(`[data-param-id="${paramId}"]`) as HTMLElement;
      
      if (!parameterElement) {
        console.warn(`[ParameterNavigation] Parameter element not found: ${paramId}`);
        return;
      }

      // Step 3: Scroll to the parameter with smooth animation
      parameterElement.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });

      // Step 4: Add highlight effect
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for scroll to complete

      // Clear any existing highlight timeout
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }

      // Add highlight class
      parameterElement.classList.add('parameter-highlight');

      // Create pulsing border effect
      const originalTransition = parameterElement.style.transition;
      const originalBoxShadow = parameterElement.style.boxShadow;
      const originalTransform = parameterElement.style.transform;

      // Apply highlight styles
      parameterElement.style.transition = 'all 0.3s ease-in-out';
      parameterElement.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.5), 0 0 20px rgba(59, 130, 246, 0.3)';
      parameterElement.style.transform = 'scale(1.02)';

      // Create pulsing animation
      let pulseCount = 0;
      const maxPulses = 6;
      const pulseInterval = setInterval(() => {
        if (pulseCount >= maxPulses) {
          clearInterval(pulseInterval);
          
          // Restore original styles
          parameterElement.style.transition = originalTransition;
          parameterElement.style.boxShadow = originalBoxShadow;
          parameterElement.style.transform = originalTransform;
          parameterElement.classList.remove('parameter-highlight');
          
          return;
        }

        const isEven = pulseCount % 2 === 0;
        parameterElement.style.boxShadow = isEven 
          ? '0 0 0 3px rgba(59, 130, 246, 0.8), 0 0 30px rgba(59, 130, 246, 0.6)'
          : '0 0 0 3px rgba(59, 130, 246, 0.3), 0 0 15px rgba(59, 130, 246, 0.2)';
        
        parameterElement.style.transform = isEven ? 'scale(1.03)' : 'scale(1.02)';
        
        pulseCount++;
      }, 500);

      // Cleanup after 3 seconds
      highlightTimeoutRef.current = setTimeout(() => {
        clearInterval(pulseInterval);
        parameterElement.style.transition = originalTransition;
        parameterElement.style.boxShadow = originalBoxShadow;
        parameterElement.style.transform = originalTransform;
        parameterElement.classList.remove('parameter-highlight');
      }, 3000);

    } catch (error) {
      console.error('[ParameterNavigation] Error navigating to parameter:', error);
    }
  }, [onExpandCategory]);

  return {
    navigateToParameter
  };
};

export default useParameterNavigation;
