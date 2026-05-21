import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { ParameterInfo } from '../types/firebase';
import { getParameterDataType } from '../utils/parameterTypes';
import { useRigStore } from '../store/useRigStore';
import { useLocalSettings } from '../hooks/useLocalSettings';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface ParameterListModalProps {
  isOpen: boolean;
  onClose: () => void;
  parameters: ParameterInfo[];
  availableCategories: string[];
  onUpdateParameter: (paramId: string, updates: Partial<ParameterInfo>) => Promise<void>;
}

type SortField = 'name' | 'div' | 'zugriff' | 'einheit' | 'kategorie' | 'dataType';
type SortDirection = 'asc' | 'desc';
type VisibilityFilter = 'all' | 'visible' | 'hidden';
type AccessFilter = 'all' | 'r' | 'w' | 'rw';

interface EditingCell {
  paramId: string;
  field: SortField;
}

// Available units of measurement — matches the controller's known unit set.
const AVAILABLE_UNITS = ['%', '°C', '°C/min', '1', 'min', '°', 's'];
const AVAILABLE_DATA_TYPES = ['float', 'int', 'bool', 'string'];

const ParameterListModal: React.FC<ParameterListModalProps> = ({
  isOpen,
  onClose,
  parameters,
  availableCategories,
  onUpdateParameter,
}) => {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();

  // Sort
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Cell editing
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [modifiedParameters, setModifiedParameters] = useState<Set<string>>(new Set());

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all');
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  // Bulk selection
  const [selectedParams, setSelectedParams] = useState<Set<string>>(new Set());

  // Local-settings change pulses to force re-render of visibility chips.
  const [settingsVersion, setSettingsVersion] = useState<number>(0);

  useEscapeKey(onClose, { enabled: isOpen });

  // Live parameters from store override the props once we have anything in
  // there — keeps the table in sync with Firebase pushes without us wiring
  // a redundant subscription per modal instance.
  const storeParameters = useRigStore((state) => state.discoveredParameters);
  const currentParameters = storeParameters.length > 0 ? storeParameters : parameters;

  const { getParameterSettings, toggleHidden } = useLocalSettings();

  useEffect(() => {
    const handler = () => setSettingsVersion((v) => v + 1);
    window.addEventListener('localSettingsChanged', handler);
    return () => window.removeEventListener('localSettingsChanged', handler);
  }, []);

  // Reset transient state on each open so the operator sees a clean slate.
  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setVisibilityFilter('all');
    setAccessFilter('all');
    setCategoryFilter('');
    setSelectedParams(new Set());
    setEditingCell(null);
  }, [isOpen]);

  // ─── Filter + sort pipeline ──────────────────────────────────────────
  const sortedParameters = useMemo(() => {
    let valid = currentParameters.filter(
      (param): param is ParameterInfo =>
        param != null && typeof param === 'object' && 'originalName' in param,
    );

    if (searchQuery.trim()) {
      const term = searchQuery.toLowerCase().trim();
      valid = valid.filter((param) => {
        return (
          param.originalName.toLowerCase().includes(term) ||
          (param.kategorie || '').toLowerCase().includes(term) ||
          (param.unit || '').toLowerCase().includes(term) ||
          (param.zugriff || '').toLowerCase().includes(term) ||
          getParameterDataType(param).toLowerCase().includes(term)
        );
      });
    }

    if (visibilityFilter !== 'all') {
      valid = valid.filter((param) => {
        const hidden = !!getParameterSettings(param.originalName).hidden;
        return visibilityFilter === 'hidden' ? hidden : !hidden;
      });
    }

    if (accessFilter !== 'all') {
      valid = valid.filter((param) => {
        const z = (param.zugriff || '').toLowerCase();
        return z === accessFilter;
      });
    }

    if (categoryFilter) {
      valid = valid.filter((param) => (param.kategorie || '') === categoryFilter);
    }

    return valid.sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;
      switch (sortField) {
        case 'name':
          aValue = a.originalName.toLowerCase();
          bValue = b.originalName.toLowerCase();
          break;
        case 'div':
          aValue = a.divisor || 1;
          bValue = b.divisor || 1;
          break;
        case 'zugriff':
          aValue = (a.zugriff || '').toLowerCase();
          bValue = (b.zugriff || '').toLowerCase();
          break;
        case 'einheit':
          aValue = (a.unit || '').toLowerCase();
          bValue = (b.unit || '').toLowerCase();
          break;
        case 'kategorie':
          aValue = (a.kategorie || '').toLowerCase();
          bValue = (b.kategorie || '').toLowerCase();
          break;
        case 'dataType':
          aValue = (a as any).dataType || getParameterDataType(a);
          bValue = (b as any).dataType || getParameterDataType(b);
          break;
        default:
          return 0;
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      }
      return sortDirection === 'asc'
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });
  }, [currentParameters, searchQuery, visibilityFilter, accessFilter, categoryFilter, sortField, sortDirection, getParameterSettings, settingsVersion]);

  // ─── Stats footer ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let hiddenCount = 0;
    currentParameters.forEach((p) => {
      if (getParameterSettings(p.originalName).hidden) hiddenCount += 1;
    });
    return {
      total: currentParameters.length,
      shown: sortedParameters.length,
      hidden: hiddenCount,
      modified: modifiedParameters.size,
      selected: selectedParams.size,
    };
  }, [currentParameters, sortedParameters.length, modifiedParameters.size, selectedParams.size, getParameterSettings, settingsVersion]);

  // ─── Sort + edit handlers ────────────────────────────────────────────
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDirection('asc');
      }
    },
    [sortField],
  );

  const handleCellEdit = useCallback(
    (paramId: string, field: SortField, currentValue: string | number) => {
      if (!hasPermission('parameters.edit_values')) return;
      setEditingCell({ paramId, field });
      setEditValue(String(currentValue));
    },
    [hasPermission],
  );

  const handleCellSave = useCallback(async () => {
    if (!editingCell) return;
    const { paramId, field } = editingCell;
    const updates: Partial<ParameterInfo> = {};
    try {
      switch (field) {
        case 'div': {
          const divisor = parseFloat(editValue);
          if (!isNaN(divisor) && divisor > 0) updates.divisor = divisor;
          break;
        }
        case 'zugriff': {
          const z = editValue.trim().toLowerCase();
          if (z === '' || z === 'r' || z === 'w' || z === 'rw') updates.zugriff = z;
          break;
        }
        case 'einheit':
          updates.unit = editValue.trim();
          break;
        case 'kategorie':
          updates.kategorie = editValue.trim() || undefined;
          break;
        case 'dataType': {
          const dt = editValue.trim().toLowerCase();
          if (dt === '' || AVAILABLE_DATA_TYPES.includes(dt)) {
            (updates as any).dataType = dt === '' ? undefined : dt;
          }
          break;
        }
      }
      if (Object.keys(updates).length > 0) {
        await onUpdateParameter(paramId, updates);
        setModifiedParameters((prev) => new Set([...prev, paramId]));
      }
    } catch (error) {
      console.error('Failed to update parameter:', error);
    } finally {
      setEditingCell(null);
      setEditValue('');
    }
  }, [editingCell, editValue, onUpdateParameter]);

  const handleCellCancel = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const handleKeyPress = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') handleCellSave();
      else if (event.key === 'Escape') handleCellCancel();
    },
    [handleCellSave, handleCellCancel],
  );

  // ─── Bulk selection ──────────────────────────────────────────────────
  const toggleSelected = useCallback((paramId: string) => {
    setSelectedParams((prev) => {
      const next = new Set(prev);
      if (next.has(paramId)) next.delete(paramId);
      else next.add(paramId);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedParams(new Set(sortedParameters.map((p) => p.originalName)));
  }, [sortedParameters]);

  const clearSelection = useCallback(() => setSelectedParams(new Set()), []);

  /**
   * Apply visibility to every selected parameter, respecting the desired
   * end-state. We compare each one's current hidden flag and call the
   * toggle only when needed — avoids an unnecessary localStorage write per
   * already-correct row.
   */
  const applyBulkVisibility = useCallback(
    (shouldHide: boolean) => {
      selectedParams.forEach((paramId) => {
        const settings = getParameterSettings(paramId);
        const currentlyHidden = !!settings.hidden;
        if (currentlyHidden !== shouldHide) toggleHidden(paramId);
      });
      clearSelection();
    },
    [selectedParams, getParameterSettings, toggleHidden, clearSelection],
  );

  // ─── Render helpers ──────────────────────────────────────────────────
  const SortIcon: React.FC<{ field: SortField }> = ({ field }) => {
    if (sortField !== field) {
      return (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="ml-1 inline-block h-3 w-3 text-muted-foreground/50"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className={`ml-1 inline-block h-3 w-3 text-primary ${
          sortDirection === 'asc' ? '' : 'rotate-180'
        }`}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7-7-7 7" />
      </svg>
    );
  };

  const renderEditableCell = (
    param: ParameterInfo,
    field: SortField,
    value: string | number,
    isDropdown = false,
    options: string[] = [],
  ) => {
    const isEditing =
      editingCell?.paramId === param.originalName && editingCell?.field === field;

    if (isEditing) {
      const inputClass =
        'w-full rounded-md border border-primary bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';
      if (isDropdown) {
        return (
          <select
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onBlur={handleCellSave}
            onKeyDown={handleKeyPress}
            className={inputClass}
            autoFocus
          >
            {field === 'dataType' ? (
              <>
                <option value="">{t('parameterList.auto')}</option>
                {AVAILABLE_DATA_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {dt}
                  </option>
                ))}
              </>
            ) : field === 'einheit' ? (
              <>
                <option value="">—</option>
                {AVAILABLE_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </>
            ) : (
              <>
                <option value="">—</option>
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </>
            )}
          </select>
        );
      }
      return (
        <input
          type="text"
          value={editValue}
          onChange={(event) => setEditValue(event.target.value)}
          onBlur={handleCellSave}
          onKeyDown={handleKeyPress}
          className={inputClass}
          autoFocus
        />
      );
    }

    return (
      <div
        className="cursor-pointer rounded px-1 py-0.5 text-foreground transition-colors hover:bg-muted"
        onClick={() => handleCellEdit(param.originalName, field, value)}
        title={t('parameterList.clickToEdit') as string}
      >
        {field === 'dataType' ? (
          <>
            {(() => {
              const explicit = (param as any).dataType;
              const auto = getParameterDataType(param);
              return explicit && explicit !== null
                ? explicit
                : `${auto} (${t('parameterList.auto')})`;
            })()}
          </>
        ) : (
          value || '—'
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  // Render filter chips for visibility / access — common style.
  const FilterChip: React.FC<{
    isActive: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }> = ({ isActive, onClick, children }) => (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        isActive
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );

  // Master checkbox for "select every currently visible row".
  const allSelected =
    sortedParameters.length > 0 &&
    sortedParameters.every((p) => selectedParams.has(p.originalName));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3 backdrop-blur-md sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-theme-lg sm:max-h-[90vh]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="parameter-list-title"
      >
        {/* Header */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18M3 6h18M3 18h18" />
              </svg>
            </div>
            <h2 id="parameter-list-title" className="text-base font-semibold text-foreground">
              {t('parameterList.title')}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {stats.shown} / {stats.total}
              </span>
            </h2>
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

        {/* Filters / search bar — sticks to the top of the scroll area */}
        <div className="flex-shrink-0 space-y-2 border-b border-border bg-muted/20 px-4 py-3">
          {/* Search */}
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
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('parameterList.searchPlaceholder') as string}
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ) : null}
          </div>

          {/* Filter chips + dropdown */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* Visibility */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('parameterList.filters.visibility')}
              </span>
              <FilterChip
                isActive={visibilityFilter === 'all'}
                onClick={() => setVisibilityFilter('all')}
              >
                {t('parameterList.filters.all')}
              </FilterChip>
              <FilterChip
                isActive={visibilityFilter === 'visible'}
                onClick={() => setVisibilityFilter('visible')}
              >
                {t('parameterList.filters.visible')}
              </FilterChip>
              <FilterChip
                isActive={visibilityFilter === 'hidden'}
                onClick={() => setVisibilityFilter('hidden')}
              >
                {t('parameterList.filters.hidden')}
              </FilterChip>
            </div>

            {/* Access */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('parameterList.filters.access')}
              </span>
              {(['all', 'r', 'w', 'rw'] as const).map((value) => (
                <FilterChip
                  key={value}
                  isActive={accessFilter === value}
                  onClick={() => setAccessFilter(value)}
                >
                  {value === 'all' ? t('parameterList.filters.all') : value.toUpperCase()}
                </FilterChip>
              ))}
            </div>

            {/* Category dropdown */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('parameterList.filters.category')}
              </span>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">{t('parameterList.filters.allCategories')}</option>
                {availableCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Bulk action bar — only when something is selected */}
          {selectedParams.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
              <span className="text-xs font-medium text-foreground">
                {t('parameterList.bulk.selected', { count: selectedParams.size })}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => applyBulkVisibility(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18m-3.59-3.59A9.77 9.77 0 0112 19c-7 0-10-7-10-7a17.5 17.5 0 014.06-5.65M9.9 4.24A10 10 0 0112 4c7 0 10 7 10 7a17.5 17.5 0 01-2.16 3.19m-5.25 1.32A3 3 0 119.6 9.6" />
                </svg>
                {t('parameterList.bulk.hide')}
              </button>
              <button
                type="button"
                onClick={() => applyBulkVisibility(false)}
                className="inline-flex items-center gap-1 rounded-lg bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {t('parameterList.bulk.show')}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {t('parameterList.bulk.clear')}
              </button>
            </div>
          ) : null}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr>
                <th className="w-9 px-2 py-2 text-left font-medium text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => (allSelected ? clearSelection() : selectAllVisible())}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary"
                    aria-label={t('parameterList.bulk.selectAll') as string}
                  />
                </th>
                <th className="w-12 px-2 py-2 text-left font-medium text-muted-foreground">
                  {t('parameterList.headers.vis')}
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-left font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => handleSort('name')}
                >
                  {t('parameterList.headers.name')}
                  <SortIcon field="name" />
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-left font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => handleSort('div')}
                >
                  {t('parameterList.headers.div')}
                  <SortIcon field="div" />
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-left font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => handleSort('zugriff')}
                >
                  {t('parameterList.headers.zugriff')}
                  <SortIcon field="zugriff" />
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-left font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => handleSort('einheit')}
                >
                  {t('parameterList.headers.einheit')}
                  <SortIcon field="einheit" />
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-left font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => handleSort('kategorie')}
                >
                  {t('parameterList.headers.kategorie')}
                  <SortIcon field="kategorie" />
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-left font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => handleSort('dataType')}
                >
                  {t('parameterList.headers.dataType')}
                  <SortIcon field="dataType" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {sortedParameters.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-muted-foreground/50">
                        <circle cx="11" cy="11" r="7" />
                        <path strokeLinecap="round" d="m20 20-3.5-3.5" />
                      </svg>
                      <p>
                        {searchQuery
                          ? t('parameterList.noResults', { query: searchQuery })
                          : t('parameterList.noResultsFiltered')}
                      </p>
                      {(searchQuery || visibilityFilter !== 'all' || accessFilter !== 'all' || categoryFilter) && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery('');
                            setVisibilityFilter('all');
                            setAccessFilter('all');
                            setCategoryFilter('');
                          }}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {t('parameterList.clearFilters')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                sortedParameters.map((param) => {
                  const isModified = modifiedParameters.has(param.originalName);
                  const isSelected = selectedParams.has(param.originalName);
                  const hidden = !!getParameterSettings(param.originalName).hidden;
                  return (
                    <tr
                      key={param.originalName}
                      className={`transition-colors ${
                        isSelected
                          ? 'bg-primary/10'
                          : isModified
                          ? 'bg-warning/10 hover:bg-warning/15'
                          : 'hover:bg-muted/40'
                      }`}
                    >
                      <td className="px-2 py-1.5 align-middle">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelected(param.originalName)}
                          className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary"
                          aria-label={t('parameterList.bulk.toggleRow') as string}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggleHidden(param.originalName)}
                          className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                            hidden
                              ? 'text-destructive hover:bg-destructive/10'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}
                          title={
                            (hidden ? t('parameterList.show') : t('parameterList.hide')) as string
                          }
                        >
                          <i className={`fas ${hidden ? 'fa-eye-slash' : 'fa-eye'} text-xs`} />
                        </button>
                      </td>
                      <td className="px-3 py-1.5 font-mono font-semibold text-foreground">
                        {param.originalName}
                      </td>
                      <td className="px-3 py-1.5 text-foreground">
                        {renderEditableCell(param, 'div', param.divisor || 1)}
                      </td>
                      <td className="px-3 py-1.5 text-foreground">
                        {renderEditableCell(param, 'zugriff', param.zugriff || '')}
                      </td>
                      <td className="px-3 py-1.5 text-foreground">
                        {renderEditableCell(param, 'einheit', param.unit || '', true, AVAILABLE_UNITS)}
                      </td>
                      <td className="px-3 py-1.5 text-foreground">
                        {renderEditableCell(param, 'kategorie', param.kategorie || '', true, availableCategories)}
                      </td>
                      <td className="px-3 py-1.5 text-foreground">
                        {renderEditableCell(
                          param,
                          'dataType',
                          (param as any).dataType || '',
                          true,
                          AVAILABLE_DATA_TYPES,
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <footer className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-3 text-xs text-muted-foreground">
          <p>
            {t('parameterList.stats.total', { total: stats.total })}
            {stats.hidden > 0 ? ` · ${t('parameterList.stats.hidden', { count: stats.hidden })}` : ''}
            {stats.modified > 0 ? ` · ${t('parameterList.stats.modified', { count: stats.modified })}` : ''}
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

export default ParameterListModal;
