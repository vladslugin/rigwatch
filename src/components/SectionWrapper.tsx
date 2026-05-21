import React from 'react';
import { useStoveStore } from '../store/useStoveStore';

interface SectionWrapperProps {
  sectionId: string;
  title: string;
  children: React.ReactNode;
  onMoveSectionUp?: (sectionId: string) => void;
  onMoveSectionDown?: (sectionId: string) => void;
  className?: string;
}

const SectionWrapper: React.FC<SectionWrapperProps> = ({
  sectionId,
  title,
  children,
  onMoveSectionUp,
  onMoveSectionDown,
  className = ""
}) => {
  const isSectionReorderMode = useStoveStore(state => state.isSectionReorderMode);
  const sectionOrder = useStoveStore(state => state.sectionOrder);
  
  const currentIndex = sectionOrder.indexOf(sectionId);
  const canMoveUp = currentIndex > 0;
  const canMoveDown = currentIndex < sectionOrder.length - 1;

  if (!isSectionReorderMode) {
    return (
      <div className={className} data-section={sectionId}>
        {children}
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} data-section={sectionId}>
      {/* Reorder controls overlay */}
      <div className="absolute -top-2 -right-2 z-10 flex flex-col space-y-1 bg-card border-2 border-border rounded p-1">
        <button
          onClick={() => onMoveSectionUp?.(sectionId)}
          disabled={!canMoveUp}
          className="w-8 h-8 flex items-center justify-center rounded disabled:opacity-30 disabled:cursor-not-allowed bg-info/10 hover:bg-info/20 text-info"
          title={`Move ${title} up`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 14l5-5 5 5" />
          </svg>
        </button>

        <button
          onClick={() => onMoveSectionDown?.(sectionId)}
          disabled={!canMoveDown}
          className="w-8 h-8 flex items-center justify-center rounded disabled:opacity-30 disabled:cursor-not-allowed bg-info/10 hover:bg-info/20 text-info"
          title={`Move ${title} down`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 10l-5 5-5-5" />
          </svg>
        </button>
      </div>

      {/* Section content with highlight border */}
      <div className="border-2 border-dashed border-info/40 rounded p-2 bg-info/5">
        <div className="mb-2 text-xs font-medium text-info bg-info/10 px-2 py-1 rounded">
          {title} Section
        </div>
        {children}
      </div>
    </div>
  );
};

export default SectionWrapper; 