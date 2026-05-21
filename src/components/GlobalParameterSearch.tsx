import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParameterInfo } from '../types/firebase';
import type { ThemeName } from '../hooks/useTheme';

interface GlobalParameterSearchProps {
  isOpen: boolean;
  onClose: () => void;
  parameters: ParameterInfo[];
  onParameterSelect: (paramId: string, categoryName: string) => void;
}

interface SearchResult {
  parameter: ParameterInfo;
  categoryName: string;
  matchType: 'name' | 'description' | 'originalName';
  score: number;
}

const GlobalParameterSearch: React.FC<GlobalParameterSearchProps> = ({
  isOpen,
  onClose,
  parameters,
  onParameterSelect,
}) => {
  const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [themeName, setThemeName] = useState<ThemeName>('default');
  const isNeo = themeName === 'neo-brutalism';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = () => {
      const next = (document.documentElement.dataset.theme as ThemeName) || 'default';
      setThemeName(next);
    };
    const observer = new MutationObserver(handler);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    handler();
    return () => observer.disconnect();
  }, []);

  // Search and filter parameters
  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) return [];

    const term = searchTerm.toLowerCase().trim();
    const results: SearchResult[] = [];

    parameters.forEach(param => {
      const categoryName = (param as any).kategorie || 'uncategorized';
      const displayName = param.displayName || param.originalName;
      const description = param.description || '';
      const originalName = param.originalName;

      let score = 0;
      let matchType: 'name' | 'description' | 'originalName' = 'name';

      // Exact match in display name (highest priority)
      if (displayName.toLowerCase() === term) {
        score = 100;
        matchType = 'name';
      }
      // Starts with in display name
      else if (displayName.toLowerCase().startsWith(term)) {
        score = 90;
        matchType = 'name';
      }
      // Contains in display name
      else if (displayName.toLowerCase().includes(term)) {
        score = 80;
        matchType = 'name';
      }
      // Exact match in original name
      else if (originalName.toLowerCase() === term) {
        score = 75;
        matchType = 'originalName';
      }
      // Starts with in original name
      else if (originalName.toLowerCase().startsWith(term)) {
        score = 70;
        matchType = 'originalName';
      }
      // Contains in original name
      else if (originalName.toLowerCase().includes(term)) {
        score = 60;
        matchType = 'originalName';
      }
      // Contains in description
      else if (description.toLowerCase().includes(term)) {
        score = 40;
        matchType = 'description';
      }

      if (score > 0) {
        results.push({
          parameter: param,
          categoryName: categoryName === 'uncategorized' ? 'Main' : categoryName,
          matchType,
          score
        });
      }
    });

    // Sort by score (highest first), then alphabetically
    return results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.parameter.displayName || a.parameter.originalName)
        .localeCompare(b.parameter.displayName || b.parameter.originalName);
    }).slice(0, 10); // Limit to 10 results
  }, [searchTerm, parameters]);

  // Reset selected index when search results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchResults]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (searchResults[selectedIndex]) {
          handleSelectParameter(searchResults[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  }, [searchResults, selectedIndex, onClose]);

  // Handle parameter selection
  const handleSelectParameter = useCallback((result: SearchResult) => {
    const categoryName = (result.parameter as any).kategorie || 'uncategorized';
    onParameterSelect(result.parameter.originalName, categoryName);
    onClose();
    setSearchTerm('');
  }, [onParameterSelect, onClose]);

  // Auto-focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth'
        });
      }
    }
  }, [selectedIndex]);

  // Handle click outside to close
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Render icon for parameter
  const renderParameterIcon = useCallback((param: ParameterInfo) => {
    const icon = param.icon;
    
    if (!icon || icon.trim() === '') {
      return <i className="fas fa-tag text-gray-400 flex-shrink-0" />;
    }
    
    // Decode legacy Unicode sequences
    if (typeof icon === 'string' && icon.includes('\\u{')) {
      try {
        const decodedIcon = icon.replace(/\\u\{([^}]+)\}/g, (_match, hex) => {
          return String.fromCodePoint(parseInt(hex, 16));
        });
        return <span className="text-gray-400 flex-shrink-0">{decodedIcon}</span>;
      } catch (error) {
        return <i className="fas fa-tag text-gray-400 flex-shrink-0" />;
      }
    }
    
    // FontAwesome check
    const isFontAwesome = typeof icon === 'string' && 
                          icon.startsWith('fa-') && 
                          /^fa-[a-zA-Z0-9-]+$/.test(icon) &&
                          icon.length > 3 && 
                          !/[\u{1F000}-\u{1F9FF}]/u.test(icon);
    
    if (isFontAwesome) {
      return <i className={`fas ${icon} text-gray-400 flex-shrink-0`} />;
    }
    
    // Everything else (including emoji)
    return <span className="text-gray-400 flex-shrink-0">{icon}</span>;
  }, []);

  // Highlight matching text
  const highlightMatch = useCallback((text: string, term: string) => {
    if (!term.trim()) return text;
    
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) => 
      regex.test(part) ? (
        <mark key={index} className="bg-yellow-200 dark:bg-yellow-600 text-gray-900 dark:text-white px-0.5 rounded">
          {part}
        </mark>
      ) : part
    );
  }, []);

  if (!isOpen) return null;

  return (
    <div 
      className={isNeo ? 'fixed inset-0 bg-black/50 flex items-start justify-center z-50 pt-20' : 'fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center z-50 pt-20'}
      onClick={handleBackdropClick}
    >
      <div 
        className={isNeo ? 'bg-card text-foreground rounded-xl shadow-theme-lg w-full max-w-2xl mx-4 transition-all duration-300 transform scale-100 border-2 border-border' : 'bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl mx-4 transition-all duration-300 transform scale-100'}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={isNeo ? 'p-6 border-b border-border bg-section-header text-section-header-foreground' : 'p-6 border-b border-gray-200 dark:border-gray-600'}>
          <div className="flex items-center justify-between mb-4">
            <h3 className={isNeo ? 'text-lg font-semibold flex items-center' : 'text-lg font-semibold text-gray-800 dark:text-white flex items-center'}>
              <svg className={isNeo ? 'w-5 h-5 mr-2 text-info' : 'w-5 h-5 mr-2 text-blue-500'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {t('globalSearch.title', 'Search Parameters')}
            </h3>
            <button
              onClick={onClose}
              className={isNeo ? 'text-muted-foreground hover:text-destructive transition-colors' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search input */}
        <div className="relative">
          <svg className={isNeo ? 'w-5 h-5 text-muted-foreground absolute left-3 top-1/2 transform -translate-y-1/2' : 'w-5 h-5 text-gray-400 absolute left-3 top-1/2 transform -translate-y-1/2'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('globalSearch.placeholder', 'Type to search parameters...') as string}
            className={isNeo ? 'w-full pl-10 pr-4 py-3 border border-border rounded-none focus:outline-none focus:ring-2 focus:ring-primary bg-card text-foreground placeholder-muted-foreground text-lg' : 'w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-lg'}
            />
          </div>

          {/* Search hints */}
        <div className={isNeo ? 'mt-2 text-xs text-muted-foreground flex items-center justify-between' : 'mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center justify-between'}>
            <span>
              {t('globalSearch.hint', 'Use ↑↓ to navigate, Enter to select, Esc to close')}
            </span>
            {searchResults.length > 0 && (
              <span>{searchResults.length} {t('globalSearch.resultsFound', 'found')}</span>
            )}
          </div>
        </div>

        {/* Results */}
      <div 
        ref={resultsRef}
        className="max-h-96 overflow-y-auto"
      >
          {searchTerm.trim() === '' ? (
          <div className={isNeo ? 'p-8 text-center text-muted-foreground' : 'p-8 text-center text-gray-500 dark:text-gray-400'}>
            <svg className={isNeo ? 'w-12 h-12 mx-auto mb-3 opacity-50 text-muted-foreground' : 'w-12 h-12 mx-auto mb-3 opacity-50'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            <p className={isNeo ? 'text-lg font-medium mb-1 text-foreground' : 'text-lg font-medium mb-1'}>{t('globalSearch.startTyping', 'Start typing to search')}</p>
            <p className={isNeo ? 'text-sm text-muted-foreground' : 'text-sm'}>{t('globalSearch.searchInfo', 'Search by parameter name, original name, or description')}</p>
            </div>
          ) : searchResults.length === 0 ? (
          <div className={isNeo ? 'p-8 text-center text-muted-foreground' : 'p-8 text-center text-gray-500 dark:text-gray-400'}>
            <svg className={isNeo ? 'w-12 h-12 mx-auto mb-3 opacity-50 text-muted-foreground' : 'w-12 h-12 mx-auto mb-3 opacity-50'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            <p className={isNeo ? 'text-lg font-medium mb-1 text-foreground' : 'text-lg font-medium mb-1'}>{t('globalSearch.noResults', 'No parameters found')}</p>
            <p className={isNeo ? 'text-sm text-muted-foreground' : 'text-sm'}>{t('globalSearch.tryDifferent', 'Try a different search term')}</p>
            </div>
          ) : (
            <div className="py-2">
              {searchResults.map((result, index) => (
                <button
                  key={result.parameter.originalName}
                  onClick={() => handleSelectParameter(result)}
                className={`w-full px-6 py-3 text-left ${isNeo ? 'hover:bg-muted' : 'hover:bg-gray-50 dark:hover:bg-gray-700'} transition-colors ${
                    index === selectedIndex 
                    ? (isNeo ? 'bg-info/10 border-r-2 border-info' : 'bg-blue-50 dark:bg-blue-900/20 border-r-2 border-blue-500') 
                      : ''
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    {/* Parameter icon */}
                    <div className="w-6 h-6 flex items-center justify-center">
                      {renderParameterIcon(result.parameter)}
                    </div>

                    {/* Parameter info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                      <div className={isNeo ? 'font-medium text-foreground truncate' : 'font-medium text-gray-900 dark:text-white truncate'}>
                          {highlightMatch(result.parameter.displayName || result.parameter.originalName, searchTerm)}
                        </div>
                        <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                          {/* Category badge */}
                        <span className={isNeo ? 'px-2 py-1 bg-muted text-muted-foreground rounded text-xs font-medium' : 'px-2 py-1 bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded text-xs font-medium'}>
                            {result.categoryName}
                          </span>
                          {/* Match type indicator */}
                          {result.matchType === 'description' && (
                          <span className={isNeo ? 'px-1.5 py-0.5 bg-info/10 text-info rounded text-xs' : 'px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-xs'}>
                              desc
                            </span>
                          )}
                          {result.matchType === 'originalName' && (
                          <span className={isNeo ? 'px-1.5 py-0.5 bg-warning/10 text-warning rounded text-xs' : 'px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded text-xs'}>
                              id
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Original name if different from display name */}
                      {result.parameter.displayName !== result.parameter.originalName && (
                      <div className={isNeo ? 'text-sm text-muted-foreground truncate mt-0.5' : 'text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5'}>
                          {highlightMatch(result.parameter.originalName, searchTerm)}
                        </div>
                      )}
                      
                      {/* Description if it matches */}
                      {result.matchType === 'description' && result.parameter.description && (
                      <div className={isNeo ? 'text-sm text-muted-foreground truncate mt-0.5' : 'text-sm text-gray-600 dark:text-gray-300 truncate mt-0.5'}>
                          {highlightMatch(result.parameter.description, searchTerm)}
                        </div>
                      )}
                    </div>

                    {/* Arrow indicator for selected item */}
                    {index === selectedIndex && (
                    <svg className={isNeo ? 'w-4 h-4 text-info flex-shrink-0' : 'w-4 h-4 text-blue-500 flex-shrink-0'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GlobalParameterSearch;
