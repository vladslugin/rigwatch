import * as React from 'react';
import { useSimpleMode } from '../hooks/useSimpleMode';
import AIAnalysisCard from './AIAnalysisCard';
import HistoricalAIAnalysisCard from './HistoricalAIAnalysisCard';
import SimpleAIAnalysisCard from './SimpleAIAnalysisCard';

interface AIAnalysisWrapperProps {
  className?: string;
}

/**
 * Wrapper component that shows either simple or advanced AI analysis based on user preference
 * - Simple mode: Shows combined SimpleAIAnalysisCard
 * - Advanced mode: Shows separate AIAnalysisCard and HistoricalAIAnalysisCard
 */
const AIAnalysisWrapper: React.FC<AIAnalysisWrapperProps> = ({ className = '' }) => {
  const { simpleMode, loading } = useSimpleMode();

  // Show loading state while fetching user preferences
  if (loading) {
    return (
      <div className={`bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 shadow-sm ${className}`}>
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="text-sm text-gray-600 dark:text-gray-400">Loading user preferences...</span>
          </div>
        </div>
      </div>
    );
  }

  // Simple mode: Show combined analysis
  if (simpleMode) {
    return (
      <div className={className}>
        <SimpleAIAnalysisCard />
      </div>
    );
  }

  // Advanced mode: Show separate analysis cards
  return (
    <div className={`space-y-4 ${className}`}>
      <AIAnalysisCard />
      <HistoricalAIAnalysisCard />
    </div>
  );
};

export default AIAnalysisWrapper;
