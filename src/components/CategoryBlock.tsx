import * as React from 'react';
import { useAuth } from '../hooks/useAuth';
import { useState, useMemo, useCallback, useEffect } from 'react';
import ParameterGrid from './ParameterGrid';
import type { ParameterInfo } from '../types';
import { useLocalSettings } from '../hooks/useLocalSettings';

interface CategoryBlockProps {
  categoryName: string;
  parameters: ParameterInfo[];
  isEditMode: boolean;
  onToggleFavorite: (paramId: string) => Promise<void>;
  onToggleShowInLegend: (paramId: string, showInLegend: boolean) => Promise<void>;
  onEditParameter: (paramId: string) => void;
  onReorderParameters: (orderedParamIds: string[]) => void;
  onMoveParameterToCategory?: (paramId: string, targetCategory: string | null) => Promise<void>;
  onRenameCategory?: (oldName: string, newName: string) => Promise<void>;
  onParameterValueChange?: (paramId: string, newValue: string) => Promise<boolean>;
  isTemporary?: boolean; // Add flag for temporary categories
  onCollapseChange?: (categoryName: string, isCollapsed: boolean) => void; // Add callback for collapse state
  isCollapsedExternal?: boolean; // External collapse state from parent
}

// Helper functions for localStorage
const getCollapsedCategories = (): Set<string> => {
  try {
    const stored = localStorage.getItem('collapsedCategories');
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch (error) {
    console.error('Failed to parse collapsed categories from localStorage:', error);
    return new Set();
  }
};

const setCollapsedCategories = (categories: Set<string>): void => {
  try {
    localStorage.setItem('collapsedCategories', JSON.stringify(Array.from(categories)));
  } catch (error) {
    console.error('Failed to save collapsed categories to localStorage:', error);
  }
};

const CategoryBlock: React.FC<CategoryBlockProps> = React.memo(({
  categoryName,
  parameters,
  isEditMode,
  onToggleFavorite,
  onToggleShowInLegend,
  onEditParameter,
  onReorderParameters,
  onMoveParameterToCategory,
  onRenameCategory,
  onParameterValueChange,
  isTemporary = false,
  onCollapseChange,
  isCollapsedExternal,
}) => {
  const { hasPermission, categoryVisibility, parameterViewScope } = useAuth();
  const { getUserPreferences, getParameterSettings } = useLocalSettings();
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editingName, setEditingName] = useState(categoryName);
  const [isDraggedOver, setIsDraggedOver] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);
  
  // Collapse state from localStorage and external control
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (isCollapsedExternal !== undefined) {
      return isCollapsedExternal;
    }
    const collapsedCategories = getCollapsedCategories();
    return collapsedCategories.has(categoryName);
  });

  // Update collapse state when external prop changes
  useEffect(() => {
    if (isCollapsedExternal !== undefined) {
      setIsCollapsed(isCollapsedExternal);
    }
  }, [isCollapsedExternal]);

  // Handle collapse toggle
  const handleToggleCollapse = useCallback(() => {
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    
    // Clear search when collapsing
    if (newCollapsed) {
      setSearchTerm('');
    }
    
    // Update localStorage
    const collapsedCategories = getCollapsedCategories();
    if (newCollapsed) {
      collapsedCategories.add(categoryName);
    } else {
      collapsedCategories.delete(categoryName);
    }
    setCollapsedCategories(collapsedCategories);
    
    // Notify parent about collapse state change
    if (onCollapseChange) {
      onCollapseChange(categoryName, newCollapsed);
    }
  }, [isCollapsed, categoryName, onCollapseChange]);

  // Update collapsed state when category name changes (for renames)
  useEffect(() => {
    const collapsedCategories = getCollapsedCategories();
    setIsCollapsed(collapsedCategories.has(categoryName));
  }, [categoryName]);

  // Collapse once when simplification mode is enabled (on mount and on preference changes)
  useEffect(() => {
    // On mount: if simplification is enabled, ensure collapsed
    try {
      const prefs = getUserPreferences();
      if (prefs?.simplificationMode) {
        setIsCollapsed(true);
        const collapsed = getCollapsedCategories();
        if (!collapsed.has(categoryName)) {
          collapsed.add(categoryName);
          setCollapsedCategories(collapsed);
        }
        if (onCollapseChange) onCollapseChange(categoryName, true);
      }
    } catch (e) {}

    // Respond to future preference changes
    const handler = (e: any) => {
      const enabled = e?.detail?.simplificationMode;
      if (enabled === true) {
        setIsCollapsed(true);
        const collapsed = getCollapsedCategories();
        if (!collapsed.has(categoryName)) {
          collapsed.add(categoryName);
          setCollapsedCategories(collapsed);
        }
        if (onCollapseChange) onCollapseChange(categoryName, true);
      }
    };
    window.addEventListener('userPreferencesChanged', handler as EventListener);
    return () => window.removeEventListener('userPreferencesChanged', handler as EventListener);
  }, [categoryName, onCollapseChange, getUserPreferences]);

  // Listen for local settings changes (hidden/visibility)
  useEffect(() => {
    const handler = () => setSettingsVersion(v => v + 1);
    window.addEventListener('localSettingsChanged', handler);
    return () => window.removeEventListener('localSettingsChanged', handler);
  }, []);

  // Clear drag state when edit mode is disabled
  useEffect(() => {
    if (!isEditMode) {
      setIsDraggedOver(false);
    }
  }, [isEditMode]);

  // Filter parameters for this category
  const categoryParameters = useMemo(() => {
    if (categoryName === 'uncategorized') {
      return parameters.filter(param => {
        const kategorie = (param as any).kategorie;
        return !kategorie || kategorie.trim() === '';
      });
    } else {
      return parameters.filter(param => {
        const kategorie = (param as any).kategorie;
        return kategorie === categoryName;
      });
    }
  }, [parameters, categoryName]);

  const visibleCategoryParameters = useMemo(() => {
    return categoryParameters.filter(param => !getParameterSettings(param.originalName).hidden);
  }, [categoryParameters, getParameterSettings, settingsVersion]);

  if (visibleCategoryParameters.length === 0) {
    return null;
  }

  // Handle drag over for category drop zone
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDraggedOver(true);
  }, []);

  // Handle drag leave
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only set isDraggedOver to false if we're actually leaving the entire component
    // Check if the related target is still within this component
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    
    // If mouse is still within the component bounds, don't hide the drag state
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      return;
    }
    
    setIsDraggedOver(false);
  }, []);

  // Handle drop on category header
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggedOver(false);
    
    const paramId = e.dataTransfer.getData('text/plain');
    if (paramId && onMoveParameterToCategory) {
      try {
        // Determine target category value
        const targetCategory = categoryName === 'uncategorized' ? null : categoryName;
        await onMoveParameterToCategory(paramId, targetCategory);
      } catch (error) {
        console.error('Failed to move parameter:', error);
      }
    }
  }, [categoryName, onMoveParameterToCategory]);

  // Handle double click to edit category name
  const handleDoubleClick = useCallback(() => {
    if (categoryName !== 'uncategorized' && onRenameCategory) {
      if (!hasPermission('categories.rename')) return;
      setIsEditing(true);
      setEditingName(categoryName);
    }
  }, [categoryName, onRenameCategory, hasPermission]);

  // Handle rename category
  const handleRename = useCallback(async () => {
    if (editingName.trim() && editingName.trim() !== categoryName && onRenameCategory) {
      try {
        await onRenameCategory(categoryName, editingName.trim());
        setIsEditing(false);
      } catch (error) {
        console.error('Failed to rename category:', error);
        setEditingName(categoryName);
        setIsEditing(false);
      }
    } else {
      setIsEditing(false);
      setEditingName(categoryName);
    }
  }, [categoryName, editingName, onRenameCategory]);

  // Don't render if no parameters in this category, UNLESS it's a temporary category
  // Enforce category visibility per role
  const isCategoryVisible = React.useMemo(() => {
    const vis = categoryVisibility || { mode: 'all', categories: [] } as any;
    if (vis.mode === 'all') return true;
    if (vis.mode === 'none') return false;
    
    // Special handling for uncategorized/main category
    const checkName = categoryName === 'uncategorized' ? 'uncategorized' : categoryName;
    
    if (vis.mode === 'allow') return vis.categories.includes(checkName);
    if (vis.mode === 'deny') return !vis.categories.includes(checkName);
    return true;
  }, [categoryVisibility, categoryName]);

  if (!isCategoryVisible) return null;

  if (categoryParameters.length === 0 && !isTemporary) {
    return null;
  }

  return (
    <div 
      className={`bg-card rounded-xl border shadow-sm relative ${
        isDraggedOver
          ? 'border-success bg-success/10'
          : 'border-border'
      } ${
        isCollapsed ? 'self-start' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div 
        className={`px-2 sm:px-3 py-2 ${
          isCollapsed ? 'rounded-theme' : 'rounded-t-theme'
        } ${
          isDraggedOver
            ? 'bg-success text-success-foreground'
            : 'bg-muted/70 dark:bg-muted/50 text-foreground border-b border-border'
        }`}
      >
        <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <h2 className="text-sm font-semibold flex items-center">
            {/* Collapse button */}
            <button
              onClick={handleToggleCollapse}
              className="w-4 h-4 mr-2 flex items-center justify-center hover:bg-white/10 rounded-theme-sm transition-colors"
              title={isCollapsed ? 'Expand category' : 'Collapse category'}
            >
              <svg 
                className={`w-3.5 h-3.5 text-section-header-foreground/60 transition-transform ${
                  isCollapsed ? 'rotate-0' : 'rotate-90'
                }`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            
            {/* Category icon */}
            <div className="w-4 h-4 mr-2 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            
            {/* Editable category name */}
            {isEditing ? (
              <input
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={handleRename}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') {
                    setIsEditing(false);
                    setEditingName(categoryName);
                  }
                }}
                className="bg-muted border border-border rounded-theme-sm px-2 py-1 text-sm min-w-0 flex-1 max-w-40 text-foreground placeholder-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                autoFocus
              />
            ) : (
              <span 
                className={`${categoryName !== 'uncategorized' ? 'cursor-pointer hover:text-section-header-foreground/70 transition-colors' : ''}`}
                onDoubleClick={handleDoubleClick}
                title={categoryName !== 'uncategorized' ? 'Double-click to rename' : ''}
              >
                {categoryName === 'uncategorized' ? 'Main' : categoryName}
              </span>
            )}
            
            <span className="ml-2 bg-white/10 text-section-header-foreground/70 px-2 py-0.5 rounded-theme-sm text-xs font-medium tabular-nums">
              {categoryParameters.length}
            </span>
            
            {/* Removed inline "Drop here" hint to avoid covering labels */}
          </h2>
          
          {!isCollapsed && (
            <div className="flex items-center space-x-2">
              {/* Search */}
              <div className="relative flex-1 sm:flex-none">
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-7 pr-3 py-1.5 bg-muted/50 border border-border/50 rounded-theme-sm text-xs w-full sm:w-32 md:w-36 text-foreground placeholder-muted-foreground focus:bg-muted focus:border-primary focus:ring-1 focus:ring-primary focus:outline-none"
                />
                <svg className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Parameters grid - Only show when not collapsed */}
      {!isCollapsed && (
        <div className="p-2 sm:p-3">
          {categoryParameters.length === 0 && isTemporary ? (
            // Empty temporary category placeholder
            <div className="text-center py-8 text-muted-foreground">
              <div className={`border-2 border-dashed rounded-theme p-6 ${
                isDraggedOver 
                  ? 'border-success bg-success/10' 
                  : 'bg-muted border-border'
              }`}>
                <svg className="w-12 h-12 mx-auto mb-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  {isDraggedOver ? 'Drop Here!' : 'Empty Category'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isDraggedOver 
                    ? 'Release to add parameter to this category' 
                    : 'Drag parameters here or this category will disappear on page reload'
                  }
                </p>
              </div>
            </div>
          ) : (
            <ParameterGrid
              parameters={categoryParameters}
              isEditMode={isEditMode}
              searchTerm={searchTerm}
              filterAccess={parameterViewScope || 'all'}
              onToggleFavorite={onToggleFavorite}
              onToggleShowInLegend={onToggleShowInLegend}
              onEditParameter={onEditParameter}
              onReorderParameters={onReorderParameters}
              onParameterValueChange={onParameterValueChange}
              categoryName={categoryName}
            />
          )}
        </div>
      )}
    </div>
  );
});

CategoryBlock.displayName = 'CategoryBlock';

export default CategoryBlock;