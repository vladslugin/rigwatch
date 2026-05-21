import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { ParameterInfo } from '../types';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useTheme } from '../hooks/useTheme';

export interface DisplayConfiguration {
  id: string;
  name: string;
  hidden?: string[];
}

interface DisplayConfigurationModalProps {
  isOpen: boolean;
  onClose: () => void;
  parameters: ParameterInfo[];
  configurations: DisplayConfiguration[];
  selectedConfigId: string;
  onSelectConfig: (configId: string) => void;
  onCreateConfig: (name: string) => void;
  onRenameConfig: (configId: string, name: string) => void;
  onDeleteConfig: (configId: string) => void;
  onToggleParam: (configId: string, paramId: string, checked: boolean) => void;
  onSetAll: (configId: string, checked: boolean) => void;
  onSetSection: (configId: string, paramIds: string[], checked: boolean) => void;
}

const getDisplayName = (param: ParameterInfo) =>
  param.displayName || param.originalName;

const getCategoryName = (param: ParameterInfo) => {
  const kategorie = (param as any).kategorie;
  return kategorie && String(kategorie).trim() !== '' ? String(kategorie) : 'Unkategorisiert';
};

const DisplayConfigurationModal: React.FC<DisplayConfigurationModalProps> = ({
  isOpen,
  onClose,
  parameters,
  configurations,
  selectedConfigId,
  onSelectConfig,
  onCreateConfig,
  onRenameConfig,
  onDeleteConfig,
  onToggleParam,
  onSetAll,
  onSetSection,
}) => {
  const { themeName } = useTheme();
  const isNeo = themeName === 'neo-brutalism';
  const [newConfigName, setNewConfigName] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  useEscapeKey(onClose, { enabled: isOpen });

  const selectedConfig = useMemo(
    () => configurations.find((cfg) => cfg.id === selectedConfigId),
    [configurations, selectedConfigId],
  );
  
  useEffect(() => {
    setRenameValue(selectedConfig?.name || '');
    setIsRenaming(false);
  }, [selectedConfig?.id, selectedConfig?.name]);

  const groupedParameters = useMemo(() => {
    const groups = new Map<string, ParameterInfo[]>();
    parameters.forEach((param) => {
      const group = getCategoryName(param);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(param);
    });
    return Array.from(groups.entries())
      .map(([category, items]) => ({
        category,
        items: items.sort((a, b) => getDisplayName(a).localeCompare(getDisplayName(b))),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [parameters]);

  const handleCreate = useCallback(() => {
    const name = newConfigName.trim();
    if (!name) return;
    onCreateConfig(name);
    setNewConfigName('');
  }, [newConfigName, onCreateConfig]);

  const handleRename = useCallback(() => {
    if (!selectedConfigId) return;
    const name = renameValue.trim();
    if (!name) return;
    onRenameConfig(selectedConfigId, name);
    setIsRenaming(false);
  }, [selectedConfigId, renameValue, onRenameConfig]);

  if (!isOpen) return null;

  return (
    <div
      className={
        isNeo
          ? 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]'
          : 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]'
      }
      onClick={onClose}
    >
      <div
        className="bg-card text-foreground rounded-xl w-full max-w-5xl mx-4 max-h-[90vh] overflow-hidden flex flex-col border border-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0 bg-muted/70 dark:bg-muted/50 text-foreground">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-muted rounded flex items-center justify-center border border-border">
              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold">Anzeigekonfigurationen</h3>
              <p className="text-xs text-muted-foreground">
                Konfigurationen verwalten
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5 flex-1 overflow-y-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={newConfigName}
                onChange={(e) => setNewConfigName(e.target.value)}
                placeholder="Neue Konfiguration"
                className={
                  'px-2 py-1 bg-card border border-border rounded text-xs text-foreground focus:ring-1 focus:ring-primary focus:border-primary'
                }
              />
              <button
                onClick={handleCreate}
                className={
                  'px-2 py-1 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-xs'
                }
                title="Neue Konfiguration erstellen"
              >
                +
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedConfigId}
                onChange={(e) => onSelectConfig(e.target.value)}
                className={
                  'px-2 py-1 bg-card border border-border rounded text-xs text-foreground focus:ring-1 focus:ring-primary focus:border-primary'
                }
              >
                <option value="" disabled>
                  Konfiguration auswählen
                </option>
                {configurations.map((cfg) => (
                  <option key={cfg.id} value={cfg.id}>
                    {cfg.name}
                  </option>
                ))}
              </select>
              {!isRenaming && (
                <button
                  onClick={() => setIsRenaming(true)}
                  disabled={!selectedConfigId}
                  className={
                    'px-2 py-1 bg-muted hover:bg-muted/80 text-foreground rounded text-xs disabled:opacity-50 border border-border'
                  }
                >
                  Umbenennen
                </button>
              )}
              {isRenaming && (
                <>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder="Neuer Name"
                    className={
                      isNeo
                        ? 'px-2 py-1 bg-card border border-border rounded-none text-xs text-foreground focus:ring-1 focus:ring-primary focus:border-primary'
                        : 'px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-xs text-gray-800 dark:text-gray-100 focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
                    }
                  />
                  <button
                    onClick={handleRename}
                    className={
                      isNeo
                        ? 'px-2 py-1 bg-primary text-primary-foreground rounded-none border border-border shadow-[2px_2px_0_0_var(--border)] text-xs'
                        : 'px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs'
                    }
                  >
                    Speichern
                  </button>
                  <button
                    onClick={() => {
                      setRenameValue(selectedConfig?.name || '');
                      setIsRenaming(false);
                    }}
                    className={
                      isNeo
                        ? 'px-2 py-1 bg-muted text-foreground rounded-none border border-border shadow-[2px_2px_0_0_var(--border)] text-xs'
                        : 'px-2 py-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded text-xs'
                    }
                  >
                    Abbrechen
                  </button>
                </>
              )}
              <button
                onClick={() => selectedConfigId && onDeleteConfig(selectedConfigId)}
                disabled={!selectedConfigId}
                className={
                  'px-2 py-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded text-xs disabled:opacity-50'
                }
              >
                Löschen
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end space-x-2">
            <button
              onClick={() => selectedConfigId && onSetAll(selectedConfigId, true)}
              disabled={!selectedConfigId}
              className={
                isNeo
                  ? 'px-2 py-1 bg-primary text-primary-foreground rounded-none border border-border shadow-[2px_2px_0_0_var(--border)] text-xs disabled:opacity-50'
                  : 'px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs disabled:opacity-50'
              }
            >
              Alle auswählen
            </button>
            <button
              onClick={() => selectedConfigId && onSetAll(selectedConfigId, false)}
              disabled={!selectedConfigId}
              className={
                isNeo
                  ? 'px-2 py-1 bg-muted text-foreground rounded-none border border-border shadow-[2px_2px_0_0_var(--border)] text-xs disabled:opacity-50'
                  : 'px-2 py-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded text-xs disabled:opacity-50'
              }
            >
              Alle abwählen
            </button>
          </div>

          {!selectedConfig && (
            <div className={'text-xs text-muted-foreground'}>
              Bitte zuerst eine Konfiguration auswählen.
            </div>
          )}

          {groupedParameters.map(({ category, items }) => (
            <div key={category} className={'bg-muted/40 border border-border/60 rounded-lg p-3'}>
              <div className="flex items-center justify-between mb-2">
                <div className={'text-xs font-semibold text-foreground'}>
                  {category}
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => selectedConfigId && onSetSection(selectedConfigId, items.map(p => p.originalName), true)}
                    disabled={!selectedConfigId}
                    className={
                      'px-1.5 py-0.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded text-[10px] disabled:opacity-50'
                    }
                  >
                    Alle an
                  </button>
                  <button
                    onClick={() => selectedConfigId && onSetSection(selectedConfigId, items.map(p => p.originalName), false)}
                    disabled={!selectedConfigId}
                    className={
                      'px-1.5 py-0.5 bg-muted hover:bg-muted/80 text-foreground rounded text-[10px] disabled:opacity-50 border border-border'
                    }
                  >
                    Alle aus
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-1 text-[10px]">
                {items.map((param) => {
                  const hiddenSet = new Set(selectedConfig?.hidden || []);
                  const checked = !hiddenSet.has(param.originalName);
                  return (
                    <label
                      key={param.originalName}
                      className={'flex items-center space-x-1 text-foreground'}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          selectedConfigId && onToggleParam(selectedConfigId, param.originalName, e.target.checked)
                        }
                        disabled={!selectedConfigId}
                        className="h-3 w-3"
                      />
                      <span className="truncate" title={getDisplayName(param)}>
                        {getDisplayName(param)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DisplayConfigurationModal;
