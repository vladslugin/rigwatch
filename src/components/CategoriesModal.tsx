import * as React from 'react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ParameterInfo } from '../types/firebase';
import { useRigStore } from '../store/useRigStore';
import { useLocalSettings } from '../hooks/useLocalSettings';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface CategoriesModalProps {
  isOpen: boolean;
  onClose: () => void;
  parameters: ParameterInfo[];
  onUpdateParameterCategory: (paramId: string, category: string | null) => Promise<void>;
  onCreateCategory: (categoryName: string) => Promise<void>;
  onRenameCategory: (oldName: string, newName: string) => Promise<void>;
  onDeleteCategory: (categoryName: string) => Promise<void>;
  onTemporaryCategoriesChange?: (categories: string[]) => void;
}

const UNCATEGORIZED_KEY = 'uncategorized';

/**
 * Resolves the icon string for a parameter into a renderable element.
 * The data carries icons in three formats: a font-awesome class name like
 * `fa-fire`, a literal emoji or single character, or a `\u{XXXX}` codepoint
 * escape that needs decoding. Anything else falls back to a plain tag glyph.
 */
const renderParameterIcon = (icon: string | undefined | null) => {
  const className = 'flex h-5 w-5 flex-shrink-0 items-center justify-center text-sm text-muted-foreground';
  if (!icon || icon.trim() === '') {
    return <i className={`fas fa-tag ${className}`} />;
  }
  if (typeof icon === 'string' && icon.includes('\\u{')) {
    try {
      const decoded = icon.replace(/\\u\{([^}]+)\}/g, (_match, hex) =>
        String.fromCodePoint(parseInt(hex, 16)),
      );
      return <span className={className}>{decoded}</span>;
    } catch {
      return <i className={`fas fa-tag ${className}`} />;
    }
  }
  const isFontAwesome =
    typeof icon === 'string' &&
    icon.startsWith('fa-') &&
    /^fa-[a-zA-Z0-9-]+$/.test(icon) &&
    icon.length > 3 &&
    !/[\u{1F000}-\u{1F9FF}]/u.test(icon);
  if (isFontAwesome) {
    return <i className={`fas ${icon} ${className}`} />;
  }
  return <span className={className}>{icon}</span>;
};

const CategoriesModal: React.FC<CategoriesModalProps> = ({
  isOpen,
  onClose,
  parameters,
  onUpdateParameterCategory,
  onRenameCategory,
  onDeleteCategory,
  onTemporaryCategoriesChange,
}) => {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();

  // Primary category management
  const primaryCategory = useRigStore((state) => state.primaryCategory);
  const setPrimaryCategory = useRigStore((state) => state.setPrimaryCategory);
  const { savePrimaryCategory } = useLocalSettings();

  // Form / list state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [draggedParameter, setDraggedParameter] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);
  const [temporaryCategories, setTemporaryCategories] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  // Two-step delete confirm: first click arms the button, second click within
  // a few seconds actually deletes. Replaces window.confirm() so the user is
  // not blocked by an OS dialog and can dismiss by simply moving on.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const pendingDeleteTimerRef = useRef<number | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEscapeKey(onClose, { enabled: isOpen });

  // Reset transient form state every time the modal reopens.
  useEffect(() => {
    if (!isOpen) return;
    setSearchTerm('');
    setCreateError(null);
    setNewCategoryName('');
    setEditingCategory(null);
    setEditingCategoryName('');
    setPendingDelete(null);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (pendingDeleteTimerRef.current) window.clearTimeout(pendingDeleteTimerRef.current);
    };
  }, []);

  const handleSetPrimaryCategory = useCallback(
    (category: string) => {
      setPrimaryCategory(category);
      savePrimaryCategory(category);
    },
    [setPrimaryCategory, savePrimaryCategory],
  );

  useEffect(() => {
    if (onTemporaryCategoriesChange) {
      onTemporaryCategoriesChange(Array.from(temporaryCategories));
    }
  }, [temporaryCategories, onTemporaryCategoriesChange]);

  // Group parameters into named categories + an "uncategorized" bucket.
  // Temporary categories appear here even when empty so they remain visible
  // as drop targets for the dragger.
  const categorizedParameters = useMemo(() => {
    const categories: Record<string, ParameterInfo[]> = {};
    const uncategorized: ParameterInfo[] = [];

    parameters.forEach((param) => {
      const kategorie = (param as any).kategorie;
      if (kategorie && kategorie.trim() !== '') {
        if (!categories[kategorie]) categories[kategorie] = [];
        categories[kategorie].push(param);
      } else {
        uncategorized.push(param);
      }
    });

    temporaryCategories.forEach((name) => {
      if (!categories[name]) categories[name] = [];
    });

    Object.keys(categories).forEach((name) => {
      categories[name].sort((a, b) => a.position - b.position);
    });
    uncategorized.sort((a, b) => a.position - b.position);

    return { categories, uncategorized };
  }, [parameters, temporaryCategories]);

  const sortedCategoryNames = useMemo(
    () => Object.keys(categorizedParameters.categories).sort(),
    [categorizedParameters.categories],
  );

  // Compute search-filtered parameter list for the right pane. When the
  // search box is empty we fall back to the uncategorized bucket so the
  // dealer's default workflow ("show me leftovers") stays one click away.
  const rightPaneParameters = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      return categorizedParameters.uncategorized.map((param) => ({
        param,
        category: null as string | null,
      }));
    }
    const matches: { param: ParameterInfo; category: string | null }[] = [];
    parameters.forEach((param) => {
      const kategorie = ((param as any).kategorie as string | undefined) ?? null;
      const haystack = [
        param.displayName,
        param.originalName,
        kategorie ?? '',
        param.unit ?? '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (haystack.includes(term)) {
        matches.push({ param, category: kategorie && kategorie.trim() !== '' ? kategorie : null });
      }
    });
    matches.sort((a, b) => a.param.position - b.param.position);
    return matches;
  }, [parameters, searchTerm, categorizedParameters.uncategorized]);

  // Stats — kept in sync via a single derivation so footer and headers can
  // share counts without diverging.
  const stats = useMemo(
    () => ({
      total: parameters.length,
      uncategorized: categorizedParameters.uncategorized.length,
      categories: sortedCategoryNames.length,
    }),
    [parameters.length, categorizedParameters.uncategorized.length, sortedCategoryNames.length],
  );

  // ─── Mutations ────────────────────────────────────────────────────────
  const handleCreateCategory = useCallback(async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    if (sortedCategoryNames.includes(name) || temporaryCategories.has(name)) {
      setCreateError(t('categories.errors.duplicate') as string);
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      setTemporaryCategories((prev) => new Set([...prev, name]));
      setExpandedCategories((prev) => new Set([...prev, name]));
      setNewCategoryName('');
    } catch (error) {
      console.error('Failed to create category:', error);
    } finally {
      setIsCreating(false);
    }
  }, [newCategoryName, sortedCategoryNames, temporaryCategories, t]);

  const handleRenameCategory = useCallback(
    async (oldName: string) => {
      const next = editingCategoryName.trim();
      if (!next || next === oldName) {
        setEditingCategory(null);
        setEditingCategoryName('');
        return;
      }
      try {
        await onRenameCategory(oldName, next);
        setEditingCategory(null);
        setEditingCategoryName('');
        setExpandedCategories((prev) => {
          const updated = new Set(prev);
          if (updated.has(oldName)) {
            updated.delete(oldName);
            updated.add(next);
          }
          return updated;
        });
      } catch (error) {
        console.error('Failed to rename category:', error);
      }
    },
    [editingCategoryName, onRenameCategory],
  );

  const armDelete = useCallback((categoryName: string) => {
    setPendingDelete(categoryName);
    if (pendingDeleteTimerRef.current) window.clearTimeout(pendingDeleteTimerRef.current);
    pendingDeleteTimerRef.current = window.setTimeout(() => {
      setPendingDelete((current) => (current === categoryName ? null : current));
    }, 4000);
  }, []);

  const handleDeleteCategory = useCallback(
    async (categoryName: string) => {
      // First click: arm the delete button. Second click confirms.
      if (pendingDelete !== categoryName) {
        armDelete(categoryName);
        return;
      }
      try {
        const wasPrimary = primaryCategory === categoryName;
        if (temporaryCategories.has(categoryName)) {
          setTemporaryCategories((prev) => {
            const next = new Set(prev);
            next.delete(categoryName);
            return next;
          });
        } else {
          await onDeleteCategory(categoryName);
        }
        if (wasPrimary) handleSetPrimaryCategory(UNCATEGORIZED_KEY);
        setExpandedCategories((prev) => {
          const next = new Set(prev);
          next.delete(categoryName);
          return next;
        });
        setPendingDelete(null);
      } catch (error) {
        console.error('Failed to delete category:', error);
      }
    },
    [pendingDelete, armDelete, onDeleteCategory, temporaryCategories, primaryCategory, handleSetPrimaryCategory],
  );

  const toggleCategoryExpansion = useCallback((categoryName: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryName)) next.delete(categoryName);
      else next.add(categoryName);
      return next;
    });
  }, []);

  // ─── Drag and drop ───────────────────────────────────────────────────
  const handleDragMove = useCallback((event: React.DragEvent) => {
    if (!scrollContainerRef.current || !draggedParameter) return;
    const container = scrollContainerRef.current;
    const rect = container.getBoundingClientRect();
    const threshold = 100;
    const speed = 10;
    const mouseY = event.clientY;
    if (mouseY - rect.top < threshold) {
      container.scrollTop = Math.max(0, container.scrollTop - speed);
    } else if (rect.bottom - mouseY < threshold) {
      container.scrollTop = Math.min(
        container.scrollHeight - container.clientHeight,
        container.scrollTop + speed,
      );
    }
  }, [draggedParameter]);

  const handleDragStart = useCallback((event: React.DragEvent, paramId: string) => {
    setDraggedParameter(paramId);
    event.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback(
    (event: React.DragEvent, target: string) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (dragOverTarget !== target) setDragOverTarget(target);
      handleDragMove(event);
    },
    [dragOverTarget, handleDragMove],
  );

  const handleDropOnCategory = useCallback(
    async (event: React.DragEvent, categoryName: string) => {
      event.preventDefault();
      setDragOverTarget(null);
      if (!draggedParameter) return;
      try {
        await onUpdateParameterCategory(draggedParameter, categoryName);
        if (temporaryCategories.has(categoryName)) {
          // Temporary category becomes "real" once any parameter lives in it;
          // prune from the temp list after the store catches up.
          window.setTimeout(() => {
            setTemporaryCategories((prev) => {
              const next = new Set(prev);
              next.delete(categoryName);
              return next;
            });
          }, 100);
        }
      } catch (error) {
        console.error('Failed to move parameter to category:', error);
      }
      setDraggedParameter(null);
    },
    [draggedParameter, onUpdateParameterCategory, temporaryCategories],
  );

  const handleDropOnUncategorized = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      setDragOverTarget(null);
      if (!draggedParameter) return;
      try {
        await onUpdateParameterCategory(draggedParameter, null);
      } catch (error) {
        console.error('Failed to remove parameter category:', error);
      }
      setDraggedParameter(null);
    },
    [draggedParameter, onUpdateParameterCategory],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedParameter(null);
    setDragOverTarget(null);
  }, []);

  // ─── Render helpers ──────────────────────────────────────────────────
  if (!isOpen) return null;

  const renderParameterRow = (param: ParameterInfo, currentCategory?: string | null) => {
    const isDragging = draggedParameter === param.originalName;
    return (
      <div
        key={`${param.originalName}-${currentCategory ?? 'uncat'}`}
        draggable
        onDragStart={(event) => handleDragStart(event, param.originalName)}
        onDragEnd={handleDragEnd}
        className={`group flex cursor-move items-center gap-2 rounded-lg border border-transparent bg-card px-2 py-1.5 transition-colors hover:border-border hover:bg-muted/40 ${
          isDragging ? 'opacity-40' : ''
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60"
        >
          <circle cx="9" cy="6" r="1" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="9" cy="18" r="1" />
          <circle cx="15" cy="6" r="1" />
          <circle cx="15" cy="12" r="1" />
          <circle cx="15" cy="18" r="1" />
        </svg>
        {renderParameterIcon(param.icon)}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {param.displayName}
        </span>
        {currentCategory ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {currentCategory}
          </span>
        ) : null}
      </div>
    );
  };

  const renderCategoryItem = (categoryName: string) => {
    const items = categorizedParameters.categories[categoryName];
    const isExpanded = expandedCategories.has(categoryName);
    const isPrimary = primaryCategory === categoryName;
    const isEditing = editingCategory === categoryName;
    const isOver = dragOverTarget === categoryName;
    const isPendingDelete = pendingDelete === categoryName;
    const isTemporary = temporaryCategories.has(categoryName);

    return (
      <div
        key={categoryName}
        className={`overflow-hidden rounded-xl border transition-colors ${
          isOver
            ? 'border-primary bg-primary/10 shadow-theme-sm'
            : isPrimary
            ? 'border-info/40 bg-info/5'
            : 'border-border bg-card'
        }`}
        onDragOver={(event) => handleDragOver(event, categoryName)}
        onDragLeave={() => setDragOverTarget((current) => (current === categoryName ? null : current))}
        onDrop={(event) => handleDropOnCategory(event, categoryName)}
      >
        {/* Header */}
        <div className="flex items-center gap-1 px-2 py-2">
          <button
            type="button"
            onClick={() => toggleCategoryExpansion(categoryName)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={isExpanded ? t('actions.collapse') as string : t('actions.expand') as string}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {isEditing ? (
            <input
              type="text"
              value={editingCategoryName}
              onChange={(event) => setEditingCategoryName(event.target.value)}
              onBlur={() => handleRenameCategory(categoryName)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleRenameCategory(categoryName);
                if (event.key === 'Escape') {
                  setEditingCategory(null);
                  setEditingCategoryName('');
                }
              }}
              autoFocus
              disabled={!hasPermission('categories.rename')}
              className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!hasPermission('categories.rename')) return;
                setEditingCategory(categoryName);
                setEditingCategoryName(categoryName);
              }}
              className="flex min-w-0 flex-1 items-center gap-2 truncate text-left text-sm font-medium text-foreground"
            >
              <span className="truncate">{categoryName}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {items.length}
              </span>
              {isTemporary ? (
                <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
                  {t('categories.temporary')}
                </span>
              ) : null}
            </button>
          )}

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => handleSetPrimaryCategory(categoryName)}
              className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                isPrimary
                  ? 'text-info'
                  : 'text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground'
              }`}
              title={
                (isPrimary
                  ? t('categories.primaryTooltip.isPrimary')
                  : t('categories.primaryTooltip.setPrimary')) as string
              }
            >
              <svg viewBox="0 0 24 24" fill={isPrimary ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L4.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!hasPermission('categories.rename')) return;
                setEditingCategory(categoryName);
                setEditingCategoryName(categoryName);
              }}
              disabled={!hasPermission('categories.rename')}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
              title={t('actions.edit') as string}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => hasPermission('categories.rename') && handleDeleteCategory(categoryName)}
              disabled={!hasPermission('categories.rename')}
              className={`flex h-6 items-center justify-center gap-1 rounded px-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                isPendingDelete
                  ? 'w-auto bg-destructive text-destructive-foreground'
                  : 'w-6 text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
              }`}
              title={isPendingDelete ? (t('categories.confirmDelete') as string) : (t('actions.delete') as string)}
            >
              {isPendingDelete ? (
                <span className="px-1">{t('categories.confirmDelete')}</span>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Body — only when expanded */}
        {isExpanded ? (
          <div className="border-t border-border/60 px-2 py-2">
            {items.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                {t('categories.emptyDropZone')}
              </p>
            ) : (
              <div className="space-y-1">{items.map((param) => renderParameterRow(param))}</div>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const isUncategorizedOver = dragOverTarget === UNCATEGORIZED_KEY;
  const isUncategorizedPrimary = primaryCategory === UNCATEGORIZED_KEY;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-theme-lg sm:h-[90vh]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="categories-modal-title"
      >
        {/* Header */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
              </svg>
            </div>
            <h3 id="categories-modal-title" className="text-base font-semibold text-foreground">
              {t('categories.manage')}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('actions.close') as string}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Body — two-pane on md+, stacked on mobile */}
        <div
          ref={scrollContainerRef}
          className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto bg-muted/20 p-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          {/* ── Left pane: categories ── */}
          <section className="flex min-h-0 flex-col gap-3">
            {/* Create form */}
            <div className="rounded-xl border border-border bg-card p-3 shadow-theme-sm">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(event) => {
                    setNewCategoryName(event.target.value);
                    if (createError) setCreateError(null);
                  }}
                  onKeyDown={(event) => event.key === 'Enter' && handleCreateCategory()}
                  placeholder={t('categories.enterNewName') as string}
                  disabled={!hasPermission('categories.create')}
                  className={`flex-1 rounded-lg border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 ${
                    createError
                      ? 'border-destructive focus:border-destructive focus:ring-destructive'
                      : 'border-border focus:border-primary focus:ring-primary'
                  }`}
                />
                <button
                  type="button"
                  onClick={handleCreateCategory}
                  disabled={isCreating || !newCategoryName.trim() || !hasPermission('categories.create')}
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreating ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  )}
                  <span className="hidden sm:inline">{t('categories.add')}</span>
                </button>
              </div>
              {createError ? (
                <p className="mt-2 text-xs font-medium text-destructive">{createError}</p>
              ) : null}
            </div>

            {/* Category list header */}
            <div className="flex items-center justify-between px-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('categories.listHeading', { count: stats.categories })}
              </h4>
            </div>

            {/* Category list */}
            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {sortedCategoryNames.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-card/40 px-3 py-8 text-center text-xs text-muted-foreground">
                  {t('categories.empty')}
                </div>
              ) : (
                sortedCategoryNames.map(renderCategoryItem)
              )}
            </div>
          </section>

          {/* ── Right pane: search + uncategorized / search results ── */}
          <section className="flex min-h-0 flex-col gap-3">
            {/* Search bar */}
            <div className="rounded-xl border border-border bg-card p-3 shadow-theme-sm">
              <div className="relative">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path strokeLinecap="round" d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={t('categories.searchPlaceholder') as string}
                  className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {searchTerm ? (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={t('actions.cancel') as string}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                ) : null}
              </div>
            </div>

            {/* List header — adapts to whether we're showing search results or
                the uncategorized bucket. */}
            <div
              onDragOver={(event) => handleDragOver(event, UNCATEGORIZED_KEY)}
              onDragLeave={() =>
                setDragOverTarget((current) => (current === UNCATEGORIZED_KEY ? null : current))
              }
              onDrop={handleDropOnUncategorized}
              className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-colors ${
                isUncategorizedOver
                  ? 'border-primary bg-primary/10'
                  : isUncategorizedPrimary
                  ? 'border-info/40 bg-info/5'
                  : 'border-border bg-card'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  {searchTerm
                    ? t('categories.searchResults', { count: rightPaneParameters.length })
                    : t('categories.mainTitle')}
                </span>
                {!searchTerm ? (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {stats.uncategorized}
                  </span>
                ) : null}
              </div>
              {!searchTerm ? (
                <button
                  type="button"
                  onClick={() => handleSetPrimaryCategory(UNCATEGORIZED_KEY)}
                  className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                    isUncategorizedPrimary
                      ? 'text-info'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  title={
                    (isUncategorizedPrimary
                      ? t('categories.primaryTooltip.isPrimary')
                      : t('categories.primaryTooltip.setPrimary')) as string
                  }
                >
                  <svg viewBox="0 0 24 24" fill={isUncategorizedPrimary ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L4.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                </button>
              ) : null}
            </div>

            {/* Parameter list */}
            <div className="flex-1 overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-theme-sm">
              {rightPaneParameters.length === 0 ? (
                <div className="flex h-full min-h-[120px] items-center justify-center px-4 py-8 text-center text-xs text-muted-foreground">
                  {searchTerm ? t('categories.searchEmpty') : t('categories.uncategorizedEmpty')}
                </div>
              ) : (
                <div className="space-y-1">
                  {rightPaneParameters.map(({ param, category }) =>
                    renderParameterRow(param, category),
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Footer — stats summary + close */}
        <footer className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {t('categories.stats', {
              total: stats.total,
              categories: stats.categories,
              uncategorized: stats.uncategorized,
            })}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border bg-card px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t('actions.close')}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default CategoriesModal;
