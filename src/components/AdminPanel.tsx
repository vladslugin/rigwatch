import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { User, UserRole, CreateUserRequest } from '../types/auth';
import { USER_ROLE_CONFIGS, USER_ROLES } from '../types/auth';
import { useTranslation } from 'react-i18next';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const ROLE_BADGE_CLASSES: Record<string, string> = {
  super_admin: 'bg-destructive/15 text-destructive border-destructive/30',
  admin: 'bg-warning/15 text-warning border-warning/30',
  developer: 'bg-info/15 text-info border-info/30',
  pending: 'bg-muted text-muted-foreground border-border',
  viewer: 'bg-muted text-foreground border-border',
};

const getRoleBadgeClass = (role: string) =>
  ROLE_BADGE_CLASSES[role] ?? 'bg-muted text-foreground border-border';

const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose }) => {
  const { user, hasPermission, createUser, getAllUsers, updateUserRole, toggleUserActive, toggleUserForceSimpleMode } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUserData, setNewUserData] = useState<CreateUserRequest>({
    email: '',
    role: 'viewer',
    sendWelcomeEmail: true
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { t } = useTranslation();
  // Reuse a single timeout so transient success banners auto-hide consistently.
  const successTimeoutRef = useRef<number | null>(null);
  const canManageUsers = hasPermission('manage_users');

  const showSuccessMessage = useCallback((message: string) => {
    setSuccess(message);
    if (successTimeoutRef.current) {
      window.clearTimeout(successTimeoutRef.current);
    }
    successTimeoutRef.current = window.setTimeout(() => setSuccess(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        window.clearTimeout(successTimeoutRef.current);
      }
    };
  }, []);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const userList = await getAllUsers();
      setUsers(userList);
    } catch (err) {
      setError(t('admin.failedLoad'));
    } finally {
      setIsLoading(false);
    }
  }, [getAllUsers, t]);

  // Centralized handler keeps loading/error handling identical for every mutation.
  const runUserMutation = useCallback(
    async (
      mutation: () => Promise<{ success: boolean; error?: string }>,
      successMessage: string,
      fallbackError: string
    ) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await mutation();
        if (result.success) {
          showSuccessMessage(successMessage);
          await loadUsers();
        } else {
          setError(result.error || fallbackError);
        }
      } catch (err) {
        setError(fallbackError);
      } finally {
        setIsLoading(false);
      }
    },
    [loadUsers, showSuccessMessage]
  );

  const handleRoleChange = useCallback(
    async (userId: string, newRole: UserRole) => {
      await runUserMutation(
        () => updateUserRole(userId, newRole),
        t('admin.roleUpdated'),
        t('admin.failedUpdateRole')
      );
    },
    [runUserMutation, updateUserRole, t]
  );

  const handleToggleActive = useCallback(
    async (userId: string, isActive: boolean) => {
      await runUserMutation(
        () => toggleUserActive(userId, isActive),
        isActive ? t('admin.userActivated') : t('admin.userDeactivated'),
        t('admin.failedUpdateStatus')
      );
    },
    [runUserMutation, toggleUserActive, t]
  );

  const handleToggleForceSimpleMode = useCallback(
    async (userId: string, forceSimpleMode: boolean) => {
      await runUserMutation(
        () => toggleUserForceSimpleMode(userId, forceSimpleMode),
        forceSimpleMode
          ? t('admin.simpleModeEnabled', { defaultValue: 'Simple Mode enabled' })
          : t('admin.simpleModeDisabled', { defaultValue: 'Simple Mode disabled' }),
        t('admin.failedUpdateSimpleMode', { defaultValue: 'Failed to update Simple Mode' })
      );
    },
    [runUserMutation, toggleUserForceSimpleMode, t]
  );

  useEffect(() => {
    if (isOpen && canManageUsers) {
      loadUsers();
    }
  }, [isOpen, canManageUsers, loadUsers]);

  // Listen for user updates from Terminal or other components
  useEffect(() => {
    if (!isOpen || !canManageUsers) return;

    const handleUsersUpdated = () => {
      loadUsers();
    };

    window.addEventListener('users-updated', handleUsersUpdated);
    return () => {
      window.removeEventListener('users-updated', handleUsersUpdated);
    };
  }, [isOpen, canManageUsers, loadUsers]);

  const roleOptions = useMemo(
    () =>
      USER_ROLES.map((role) => ({
        value: role,
        label: USER_ROLE_CONFIGS[role].name,
        description: USER_ROLE_CONFIGS[role].description,
      })),
    []
  );

  // Check if user has permission to access admin panel
  if (!canManageUsers) {
    return null;
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/45 backdrop-blur-md flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-card text-foreground rounded-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col border border-border shadow-theme-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-section-header text-section-header-foreground">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-info" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <h2 className="text-base font-semibold">{t('admin.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-section-header-foreground/70 hover:text-section-header-foreground hover:bg-section-header-foreground/10 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 bg-background">
          {/* Error/Success Messages */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-success bg-success/10 border border-success/30 rounded-lg">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{success}</span>
            </div>
          )}

          {/* Create User Section */}
          <div className="space-y-3">
            <button
              onClick={() => setShowCreateUser(!showCreateUser)}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-primary-foreground bg-primary rounded-md border border-border hover:brightness-95 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              {t('admin.addNewUser')}
            </button>

            {showCreateUser && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!user || !newUserData.email.trim()) return;

                  setIsLoading(true);
                  setError(null);

                  try {
                    const result = await createUser(newUserData, user.uid);
                    if (result.success) {
                      showSuccessMessage(t('admin.createUser'));
                      setNewUserData({ email: '', role: 'viewer', sendWelcomeEmail: true });
                      setShowCreateUser(false);
                      await loadUsers();
                    } else {
                      setError(result.error || t('admin.failedCreateUser', { defaultValue: 'Failed to create user' }));
                    }
                  } catch (err) {
                    setError(t('admin.failedCreateUser', { defaultValue: 'Failed to create user' }));
                  } finally {
                    setIsLoading(false);
                  }
                }}
                className="p-4 bg-muted/50 rounded-lg border border-border space-y-4"
              >
                <h4 className="text-sm font-medium text-foreground">{t('admin.createNewUser')}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      {t('admin.emailAddress')}
                    </label>
                    <input
                      type="email"
                      value={newUserData.email}
                      onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                      placeholder="user@example.com"
                      className="w-full px-3 py-2 text-sm border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                      {t('admin.role')}
                    </label>
                    <select
                      value={newUserData.role}
                      onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value as UserRole })}
                      className="w-full px-3 py-2 text-sm border border-border rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                    >
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newUserData.sendWelcomeEmail}
                    onChange={(e) => setNewUserData({ ...newUserData, sendWelcomeEmail: e.target.checked })}
                    className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                  />
                  <span className="text-sm text-muted-foreground">{t('admin.sendWelcomeEmail')}</span>
                </label>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateUser(false)}
                    className="px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted rounded-md transition-colors"
                  >
                    {t('admin.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={!newUserData.email.trim() || isLoading}
                    className="px-3 py-1.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isLoading ? t('admin.creating') : t('admin.createUser')}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Users List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">
                {t('admin.users')} <span className="text-muted-foreground font-normal">({users.length})</span>
              </h3>
              <button
                onClick={loadUsers}
                disabled={isLoading}
                className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
              >
                {isLoading ? t('actions.loading') : t('admin.refresh')}
              </button>
            </div>

            {isLoading && users.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin mb-3"></div>
                <p className="text-sm">{t('admin.loadingUsers')}</p>
              </div>
            ) : users.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <svg className="w-10 h-10 mb-3 text-muted-foreground/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <p className="text-sm">{t('admin.noUsers')}</p>
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted text-left">
                        <th className="px-4 py-3 font-medium text-muted-foreground">User</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Role</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Status</th>
                        <th className="px-4 py-3 font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {users.map((userItem) => (
                        <tr key={userItem.uid} className="hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="relative flex-shrink-0">
                                <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center overflow-hidden">
                                  {userItem.photoURL ? (
                                    <img src={userItem.photoURL} alt="" className="w-8 h-8 rounded-full object-cover" />
                                  ) : (
                                    <span className="text-xs font-medium text-muted-foreground">
                                      {(userItem.displayName || userItem.email || '?')[0].toUpperCase()}
                                    </span>
                                  )}
                                </div>
                                {!userItem.isActive && (
                                  <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-destructive border-2 border-card rounded-full" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium text-foreground truncate">
                                  {userItem.displayName || userItem.email?.split('@')[0]}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {userItem.email}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex px-2 py-0.5 text-xs font-medium rounded border ${getRoleBadgeClass(userItem.role)}`}
                            >
                              {USER_ROLE_CONFIGS[userItem.role]?.name || userItem.role}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 text-xs ${userItem.isActive ? 'text-success' : 'text-muted-foreground'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${userItem.isActive ? 'bg-success' : 'bg-muted-foreground'}`} />
                              {userItem.isActive ? t('admin.active') : t('admin.inactive')}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <select
                                value={userItem.role}
                                onChange={(e) => handleRoleChange(userItem.uid, e.target.value as UserRole)}
                                disabled={isLoading || userItem.uid === user?.uid}
                                className="text-xs border border-border rounded px-2 py-1 bg-card text-foreground disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-primary"
                              >
                                {roleOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>

                              {userItem.uid !== user?.uid && (
                                <>
                                  <button
                                    onClick={() => handleToggleActive(userItem.uid, !userItem.isActive)}
                                    disabled={isLoading}
                                    className={`px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50 ${
                                      userItem.isActive
                                        ? 'text-destructive hover:bg-destructive/10'
                                        : 'text-success hover:bg-success/10'
                                    }`}
                                  >
                                    {userItem.isActive ? t('admin.deactivate') : t('admin.activate')}
                                  </button>
                                  <button
                                    onClick={() => handleToggleForceSimpleMode(userItem.uid, !userItem.forceSimpleMode)}
                                    disabled={isLoading}
                                    className={`px-2 py-1 text-xs font-medium rounded transition-colors disabled:opacity-50 ${
                                      userItem.forceSimpleMode
                                        ? 'text-info hover:bg-info/10'
                                        : 'text-muted-foreground hover:bg-muted'
                                    }`}
                                    title={
                                      userItem.forceSimpleMode
                                        ? t('admin.simpleModeDisableHint', { defaultValue: 'Disable Simple Mode' })
                                        : t('admin.simpleModeEnableHint', { defaultValue: 'Enable Simple Mode' })
                                    }
                                  >
                                    {userItem.forceSimpleMode
                                      ? t('admin.simpleModeOn', { defaultValue: 'Easyradar: On' })
                                      : t('admin.simpleModeOff', { defaultValue: 'Easyradar: Off' })}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end bg-card">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted rounded-md transition-colors"
          >
            {t('actions.close')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
