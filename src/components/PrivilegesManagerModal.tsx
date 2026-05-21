import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserRole, UserRoleConfig } from '../types/auth';
import { USER_ROLE_CONFIGS } from '../types/auth';
import { ALL_PERMISSIONS } from '../types/permissions';
import { getAllRoleConfigs, saveRoleConfig } from '../hooks/useRoleConfigs';
import { useCategoryManager } from '../hooks/useCategoryManager';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface PrivilegesManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'permissions' | 'parameterScope' | 'categoryVisibility';
type ViewScope = 'all' | 'readable' | 'writable';
type CategoryVisibilityMode = 'all' | 'none' | 'allow' | 'deny';

const ROLES: UserRole[] = ['pending', 'viewer', 'admin', 'developer', 'super_admin'];

/**
 * Permission groups by namespace prefix. Anything that doesn't start with one
 * of the listed prefixes is bucketed under "general" (the legacy / un-prefixed
 * permissions like `read_data`, `manage_stoves`, etc.). Order here also drives
 * the render order of the groups so similar things stay together.
 */
const PERMISSION_GROUPS: { id: string; prefix: string }[] = [
  { id: 'general', prefix: '' }, // catch-all, evaluated last
  { id: 'stoves', prefix: 'stoves.' },
  { id: 'parameter', prefix: 'parameter.' },
  { id: 'parameters', prefix: 'parameters.' },
  { id: 'categories', prefix: 'categories.' },
  { id: 'users', prefix: 'users.' },
  { id: 'updates', prefix: 'updates.' },
  { id: 'tickets', prefix: 'tickets.' },
  { id: 'actions', prefix: 'actions.' },
  { id: 'settings', prefix: 'settings.' },
];

const groupForPermission = (perm: string): string => {
  for (const group of PERMISSION_GROUPS) {
    if (group.prefix && perm.startsWith(group.prefix)) return group.id;
  }
  return 'general';
};

// ────────────────────────────────────────────────────────────────────────
const PrivilegesManagerModal: React.FC<PrivilegesManagerModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const { availableCategories } = useCategoryManager();

  // ─── State ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>('permissions');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [configs, setConfigs] = useState<Record<UserRole, UserRoleConfig>>(USER_ROLE_CONFIGS as any);
  const [permissions, setPermissions] = useState<string[]>(ALL_PERMISSIONS);
  const [modifiedRoles, setModifiedRoles] = useState<Set<UserRole>>(new Set());

  const [roleViewScope, setRoleViewScope] = useState<Record<UserRole, ViewScope>>(() => {
    const map: Record<string, ViewScope> = {};
    ROLES.forEach((r) => {
      map[r] = ((USER_ROLE_CONFIGS as any)[r]?.parameterViewScope as ViewScope) || 'all';
    });
    return map as Record<UserRole, ViewScope>;
  });

  const [roleCategoryVisibility, setRoleCategoryVisibility] = useState<
    Record<UserRole, { mode: CategoryVisibilityMode; categories: string[] }>
  >(() => {
    const map: any = {};
    ROLES.forEach((r) => {
      map[r] = (USER_ROLE_CONFIGS as any)[r]?.categoryVisibility || { mode: 'all', categories: [] };
    });
    return map;
  });

  // Filter / search state for the permissions tab
  const [searchTerm, setSearchTerm] = useState('');
  const [showOnlyModified, setShowOnlyModified] = useState(false);

  useEscapeKey(onClose, { enabled: isOpen });

  // ─── Initial load ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setActiveTab('permissions');
    setSearchTerm('');
    setShowOnlyModified(false);

    getAllRoleConfigs()
      .then((rc) => {
        if (!mounted) return;
        setConfigs(rc);
        // Permissions registry = built-in list ∪ anything saved on a role.
        // Lets the modal display custom permissions someone added directly
        // in Firestore without losing them.
        try {
          const dyn = new Set<string>(ALL_PERMISSIONS as string[]);
          Object.values(rc || {}).forEach((cfg: any) => {
            (cfg?.permissions || []).forEach((p: string) => dyn.add(p));
          });
          setPermissions(Array.from(dyn));
        } catch {}
        const vs: any = {};
        ROLES.forEach((r) => {
          vs[r] = rc[r]?.parameterViewScope || (USER_ROLE_CONFIGS as any)[r]?.parameterViewScope || 'all';
        });
        setRoleViewScope(vs);
        const cv: any = {};
        ROLES.forEach((r) => {
          cv[r] = rc[r]?.categoryVisibility || (USER_ROLE_CONFIGS as any)[r]?.categoryVisibility || { mode: 'all', categories: [] };
        });
        setRoleCategoryVisibility(cv);
        setModifiedRoles(new Set());
      })
      .catch(() => {
        if (mounted) setError(t('privileges.errorLoad') as string);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [isOpen, t]);

  // ─── Derived: grouped permissions, filtered ──────────────────────────
  const groupedPermissions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const groups: Record<string, string[]> = {};
    PERMISSION_GROUPS.forEach((g) => {
      groups[g.id] = [];
    });

    permissions.forEach((perm) => {
      // Apply search
      if (term) {
        const description = (t(`privileges.descriptions.${perm}`, perm) as string).toLowerCase();
        if (!perm.toLowerCase().includes(term) && !description.includes(term)) return;
      }
      // Apply "only modified" — keep permissions that differ from defaults in
      // any of the visible roles.
      if (showOnlyModified) {
        const defaultsHave = (role: UserRole) => USER_ROLE_CONFIGS[role].permissions.includes(perm);
        const currentHave = (role: UserRole) => configs[role]?.permissions?.includes(perm) ?? false;
        const anyDifference = ROLES.some((role) => defaultsHave(role) !== currentHave(role));
        if (!anyDifference) return;
      }
      const groupId = groupForPermission(perm);
      groups[groupId].push(perm);
    });

    Object.keys(groups).forEach((id) => groups[id].sort());

    return PERMISSION_GROUPS.filter((g) => groups[g.id].length > 0).map((g) => ({
      id: g.id,
      perms: groups[g.id],
    }));
  }, [permissions, searchTerm, showOnlyModified, t, configs]);

  // ─── Mutations ───────────────────────────────────────────────────────
  const markModified = useCallback((role: UserRole) => {
    setModifiedRoles((prev) => new Set(prev).add(role));
  }, []);

  const toggleRolePerm = useCallback(
    (role: UserRole, perm: string) => {
      setConfigs((prev) => {
        const next = { ...prev } as Record<UserRole, UserRoleConfig>;
        const current = next[role];
        const has = current.permissions.includes(perm);
        next[role] = {
          ...current,
          permissions: has
            ? current.permissions.filter((p) => p !== perm)
            : [...current.permissions, perm],
        };
        return next;
      });
      markModified(role);
    },
    [markModified],
  );

  /**
   * Bulk-toggle every permission in a group for a given role. The decision
   * is "if the role is missing any permission in the group, give it
   * everything; otherwise revoke everything in the group". Mirrors the
   * common "select / deselect all" toggle UX.
   */
  const toggleGroupForRole = useCallback(
    (role: UserRole, perms: string[]) => {
      setConfigs((prev) => {
        const current = prev[role];
        const allHave = perms.every((p) => current.permissions.includes(p));
        const filtered = current.permissions.filter((p) => !perms.includes(p));
        const nextPerms = allHave ? filtered : [...filtered, ...perms];
        return {
          ...prev,
          [role]: { ...current, permissions: nextPerms },
        };
      });
      markModified(role);
    },
    [markModified],
  );

  const resetRoleToDefault = useCallback((role: UserRole) => {
    const defaults = USER_ROLE_CONFIGS[role];
    setConfigs((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        permissions: [...defaults.permissions],
      },
    }));
    setRoleViewScope((prev) => ({ ...prev, [role]: defaults.parameterViewScope || 'all' }));
    setRoleCategoryVisibility((prev) => ({
      ...prev,
      [role]: defaults.categoryVisibility || { mode: 'all', categories: [] },
    }));
    setModifiedRoles((prev) => new Set(prev).add(role));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      for (const role of Array.from(modifiedRoles)) {
        await saveRoleConfig(role, {
          ...configs[role],
          parameterViewScope: roleViewScope[role],
          categoryVisibility: roleCategoryVisibility[role],
        });
      }
      setModifiedRoles(new Set());
      setSuccess(t('privileges.saved') as string);
      window.setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError(t('privileges.errorSave') as string);
    } finally {
      setSaving(false);
    }
  }, [configs, modifiedRoles, t, roleViewScope, roleCategoryVisibility]);

  // ─── Tabs ────────────────────────────────────────────────────────────
  const tabs: { id: Tab; label: string }[] = [
    { id: 'permissions', label: t('privileges.tabs.permissions') as string },
    { id: 'parameterScope', label: t('privileges.tabs.parameterScope') as string },
    { id: 'categoryVisibility', label: t('privileges.tabs.categoryVisibility') as string },
  ];

  // ─── Render helpers ──────────────────────────────────────────────────
  if (!isOpen) return null;

  const RoleColorDot: React.FC<{ role: UserRole; className?: string }> = ({ role, className }) => (
    <span
      className={`inline-block h-2 w-2 rounded-full ${className ?? ''}`}
      style={{ backgroundColor: USER_ROLE_CONFIGS[role].color }}
      aria-hidden="true"
    />
  );

  // ─── Permissions tab ─────────────────────────────────────────────────
  const renderPermissionsTab = () => (
    <div className="space-y-4">
      {/* Toolbar: search + "only modified" filter */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <div className="relative flex-1 min-w-[200px]">
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
            placeholder={t('privileges.searchPlaceholder') as string}
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowOnlyModified((prev) => !prev)}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
            showOnlyModified
              ? 'border-warning/40 bg-warning/15 text-warning'
              : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {t('privileges.filters.onlyModified')}
        </button>
      </div>

      {/* Permission groups table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 border-b border-border bg-muted/80 backdrop-blur">
            <tr>
              <th className="w-64 px-3 py-2 text-left font-medium text-muted-foreground">
                {t('privileges.permission')}
              </th>
              {ROLES.map((role) => {
                const isModified = modifiedRoles.has(role);
                return (
                  <th key={role} className="px-2 py-2 text-center font-medium text-muted-foreground">
                    <div className="flex flex-col items-center gap-1">
                      <span className="flex items-center gap-1.5">
                        <RoleColorDot role={role} />
                        <span>{USER_ROLE_CONFIGS[role].name}</span>
                        {isModified ? (
                          <span
                            aria-label={t('privileges.modifiedRoleAria') as string}
                            title={t('privileges.modifiedRoleAria') as string}
                            className="inline-block h-1.5 w-1.5 rounded-full bg-warning"
                          />
                        ) : null}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {groupedPermissions.length === 0 ? (
              <tr>
                <td
                  colSpan={ROLES.length + 1}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  {t('privileges.empty')}
                </td>
              </tr>
            ) : (
              groupedPermissions.map((group) => (
                <React.Fragment key={group.id}>
                  {/* Group header — name + "all" toggles per role */}
                  <tr className="bg-muted/40">
                    <td className="px-3 py-2 font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(`privileges.groups.${group.id}`, group.id)}
                      <span className="ml-2 font-mono text-[10px] font-normal text-muted-foreground/70">
                        {group.perms.length}
                      </span>
                    </td>
                    {ROLES.map((role) => {
                      const allHave = group.perms.every((p) =>
                        configs[role]?.permissions?.includes(p),
                      );
                      const someHave =
                        !allHave &&
                        group.perms.some((p) => configs[role]?.permissions?.includes(p));
                      return (
                        <td key={`${group.id}-${role}`} className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => toggleGroupForRole(role, group.perms)}
                            title={t('privileges.bulk.toggleGroup') as string}
                            className={`inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] transition-colors ${
                              allHave
                                ? 'border-primary bg-primary text-primary-foreground'
                                : someHave
                                ? 'border-primary bg-primary/30 text-primary-foreground'
                                : 'border-border bg-card text-muted-foreground hover:border-primary/50'
                            }`}
                          >
                            {allHave ? '✓' : someHave ? '–' : ''}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                  {/* Each permission row */}
                  {group.perms.map((perm) => (
                    <tr
                      key={perm}
                      className="border-t border-border/40 transition-colors hover:bg-muted/30"
                    >
                      <td className="px-3 py-1.5">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-[11px] text-foreground">{perm}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {t(`privileges.descriptions.${perm}`, perm)}
                          </span>
                        </div>
                      </td>
                      {ROLES.map((role) => {
                        const isOn = configs[role]?.permissions?.includes(perm) || false;
                        const isDefault = USER_ROLE_CONFIGS[role].permissions.includes(perm);
                        const drift = isOn !== isDefault;
                        return (
                          <td key={`${perm}-${role}`} className="px-2 py-1.5 text-center">
                            <label className="inline-flex cursor-pointer items-center justify-center">
                              <input
                                type="checkbox"
                                checked={isOn}
                                onChange={() => toggleRolePerm(role, perm)}
                                className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary"
                              />
                              {drift ? (
                                <span
                                  className="ml-1 h-1 w-1 rounded-full bg-warning"
                                  title={t('privileges.driftAria') as string}
                                />
                              ) : null}
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ─── Parameter scope tab ─────────────────────────────────────────────
  const renderParameterScopeTab = () => (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('privileges.parameterScopeDesc')}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ROLES.map((role) => {
          const isModified = modifiedRoles.has(role);
          return (
            <div
              key={`scope:${role}`}
              className={`rounded-xl border p-3 transition-colors ${
                isModified ? 'border-warning/40 bg-warning/5' : 'border-border bg-card'
              }`}
            >
              <div className="mb-2 flex items-center gap-2">
                <RoleColorDot role={role} />
                <span className="text-sm font-medium text-foreground">
                  {USER_ROLE_CONFIGS[role].name}
                </span>
              </div>
              <select
                value={roleViewScope[role]}
                onChange={(event) => {
                  const value = event.target.value as ViewScope;
                  setRoleViewScope((prev) => ({ ...prev, [role]: value }));
                  markModified(role);
                }}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="all">{t('privileges.scopeAll')}</option>
                <option value="readable">{t('privileges.scopeReadable')}</option>
                <option value="writable">{t('privileges.scopeWritable')}</option>
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ─── Category visibility tab ─────────────────────────────────────────
  const renderCategoryVisibilityTab = () => (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('privileges.categoryVisibilityDesc')}</p>
      <div className="space-y-3">
        {ROLES.map((role) => {
          const current = roleCategoryVisibility[role] || { mode: 'all', categories: [] };
          const allCategoriesList = ['uncategorized', ...availableCategories];
          const visibleCount =
            current.mode === 'all'
              ? allCategoriesList.length
              : current.mode === 'none'
              ? 0
              : current.mode === 'allow'
              ? current.categories.length
              : allCategoriesList.length - current.categories.length;
          const isModified = modifiedRoles.has(role);
          const showCategoryGrid = current.mode === 'allow' || current.mode === 'deny';

          return (
            <div
              key={`catvis:${role}`}
              className={`rounded-xl border p-3 transition-colors ${
                isModified ? 'border-warning/40 bg-warning/5' : 'border-border bg-card'
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <RoleColorDot role={role} />
                  <span className="text-sm font-medium text-foreground">
                    {USER_ROLE_CONFIGS[role].name}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground">
                    {t('privileges.categories.visibleCount', { count: visibleCount })}
                  </span>
                </div>
                <select
                  value={current.mode}
                  onChange={(event) => {
                    const value = event.target.value as CategoryVisibilityMode;
                    setRoleCategoryVisibility((prev) => ({
                      ...prev,
                      [role]: {
                        mode: value,
                        categories:
                          value === 'all' || value === 'none' ? [] : prev[role]?.categories || [],
                      },
                    }));
                    markModified(role);
                  }}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="all">{t('privileges.categories.all')}</option>
                  <option value="none">{t('privileges.categories.none')}</option>
                  <option value="allow">{t('privileges.categories.allow')}</option>
                  <option value="deny">{t('privileges.categories.deny')}</option>
                </select>
              </div>

              {showCategoryGrid ? (
                <>
                  {/* Quick actions for the picker — clear / main only / select-all */}
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setRoleCategoryVisibility((prev) => ({
                          ...prev,
                          [role]: { ...prev[role], categories: [] },
                        }));
                        markModified(role);
                      }}
                      className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {t('privileges.categories.clear')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRoleCategoryVisibility((prev) => ({
                          ...prev,
                          [role]: { ...prev[role], categories: ['uncategorized'] },
                        }));
                        markModified(role);
                      }}
                      className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {t('privileges.categories.onlyMain')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRoleCategoryVisibility((prev) => ({
                          ...prev,
                          [role]: {
                            ...prev[role],
                            categories: current.mode === 'allow' ? allCategoriesList : [],
                          },
                        }));
                        markModified(role);
                      }}
                      className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {current.mode === 'allow'
                        ? t('privileges.categories.selectAll')
                        : t('privileges.categories.hideAll')}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {allCategoriesList.map((cat) => {
                      const checked = current.categories.includes(cat);
                      const label =
                        cat === 'uncategorized'
                          ? (t('privileges.categories.main') as string)
                          : cat;
                      return (
                        <label
                          key={`${role}:${cat}`}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                            checked
                              ? 'border-primary/40 bg-primary/10 text-foreground'
                              : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              const isChecked = event.target.checked;
                              setRoleCategoryVisibility((prev) => {
                                const setOf = new Set(prev[role]?.categories || []);
                                if (isChecked) setOf.add(cat);
                                else setOf.delete(cat);
                                return {
                                  ...prev,
                                  [role]: { ...prev[role], categories: Array.from(setOf) },
                                };
                              });
                              markModified(role);
                            }}
                            className="h-3.5 w-3.5 cursor-pointer rounded border-border accent-primary"
                          />
                          <span className="truncate">{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-theme-lg"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="privileges-title"
      >
        {/* Header */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h3 id="privileges-title" className="text-base font-semibold text-foreground">
                {t('privileges.title')}
              </h3>
              <p className="text-xs text-muted-foreground">{t('privileges.subtitle')}</p>
            </div>
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

        {/* Tabs */}
        <nav
          className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-border px-3 pt-2"
          role="tablist"
        >
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                role="tab"
                aria-selected={isActive}
                className={`relative whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
                {isActive ? (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-t bg-primary" />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-muted/20 p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {t('privileges.loading')}
            </div>
          ) : error ? (
            <div className="flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4M12 17h.01" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
              {error}
            </div>
          ) : (
            <>
              {activeTab === 'permissions' && renderPermissionsTab()}
              {activeTab === 'parameterScope' && renderParameterScopeTab()}
              {activeTab === 'categoryVisibility' && renderCategoryVisibilityTab()}
            </>
          )}
          {success ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 5 5L20 7" />
              </svg>
              {success}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <footer className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-3">
          <div className="flex items-center gap-2">
            {modifiedRoles.size > 0 ? (
              <>
                <span className="text-xs font-medium text-warning">
                  {t('privileges.modifiedRoles')}:
                </span>
                <div className="flex flex-wrap gap-1">
                  {Array.from(modifiedRoles).map((role) => (
                    <span
                      key={role}
                      className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
                    >
                      <RoleColorDot role={role} />
                      {USER_ROLE_CONFIGS[role].name}
                      <button
                        type="button"
                        onClick={() => resetRoleToDefault(role)}
                        title={t('privileges.resetRole') as string}
                        className="ml-0.5 rounded p-0.5 text-warning/70 hover:bg-warning/20 hover:text-warning"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">{t('privileges.noChanges')}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              {t('privileges.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || modifiedRoles.size === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {saving ? t('privileges.saving') : t('privileges.save')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default PrivilegesManagerModal;
