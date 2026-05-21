import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { USER_ROLE_CONFIGS } from '../types/auth';

interface UsersListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onStartChat: (targetUser: any) => void;
}

/**
 * Compact "start a chat" picker. Shows the team list with the current user
 * filtered out plus a one-click "team chat" entry. Switched to theme tokens
 * + USER_ROLE_CONFIGS so the role pills follow the same colour as the rest
 * of the app instead of the per-component hex zoo the previous version had.
 */
const UsersListModal: React.FC<UsersListModalProps> = ({ isOpen, onClose, onStartChat }) => {
  const { getAllUsers, user: currentUser } = useAuth();
  const { t } = useTranslation();
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEscapeKey(onClose, { enabled: isOpen });

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const allUsers = await getAllUsers();
      // Exclude the current user (no self-chat) and inactive accounts.
      const activeUsers = allUsers.filter((u) => u.uid !== currentUser?.uid && u.isActive !== false);
      setUsers(activeUsers);
    } catch (error) {
      console.error('[UsersList] Error loading users:', error);
    } finally {
      setIsLoading(false);
    }
  }, [getAllUsers, currentUser?.uid]);

  useEffect(() => {
    if (isOpen) {
      loadUsers();
    } else {
      // Drop cached state on close so reopen re-fetches and the search box
      // doesn't carry a stale query into the next session.
      setUsers([]);
      setSearchTerm('');
    }
  }, [isOpen, loadUsers]);

  const filteredUsers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (user) =>
        user.displayName?.toLowerCase().includes(term) ||
        user.email?.toLowerCase().includes(term),
    );
  }, [users, searchTerm]);

  const handleStartChat = useCallback(
    (targetUser: any) => {
      onStartChat(targetUser);
      onClose();
    },
    [onStartChat, onClose],
  );

  // Translate the i18n role-shorthand map to a typed Record so role keys
  // unknown to the dictionary fall back to the raw role string.
  const roleShortMap = useMemo(
    () => (t('usersList.roleShort', { returnObjects: true }) as Record<string, string>) || {},
    [t],
  );
  const getRoleShort = (role: string) => roleShortMap[role] || role;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-theme-lg"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="users-list-title"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" />
              </svg>
            </div>
            <h2 id="users-list-title" className="text-sm font-semibold text-foreground">
              {t('usersList.startChat')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t('actions.close') as string}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        {/* Search + Team chat shortcut */}
        <div className="space-y-2 border-b border-border px-4 py-3">
          <div className="relative">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            >
              <circle cx="11" cy="11" r="7" />
              <path strokeLinecap="round" d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t('usersList.searchPlaceholder') as string}
              className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <button
            type="button"
            onClick={() => handleStartChat(null)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-2M3 4h6v4H7l-2 2V6H3V4z" />
            </svg>
            {t('usersList.teamChat')}
          </button>
        </div>

        {/* User list */}
        <div className="max-h-72 overflow-y-auto px-2 py-2">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              {t('usersList.loading')}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">
              <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              {searchTerm ? t('usersList.noUsersFound') : t('usersList.noTeamMembers')}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('usersList.teamMembers')} · {filteredUsers.length}
              </p>
              {filteredUsers.map((user) => {
                const roleConfig = USER_ROLE_CONFIGS[user.role as keyof typeof USER_ROLE_CONFIGS];
                const roleColor = roleConfig?.color;
                return (
                  <button
                    key={user.uid}
                    type="button"
                    onClick={() => handleStartChat(user)}
                    className="group flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-border hover:bg-muted/40"
                  >
                    {/* Avatar + active dot */}
                    <div className="relative flex-shrink-0">
                      {user.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt={user.displayName || user.email || ''}
                          className="h-7 w-7 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                      )}
                      <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-card bg-success" />
                    </div>

                    {/* Identity + role pill */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-xs font-medium text-foreground">
                          {user.displayName || user.email?.split('@')[0]}
                        </p>
                        {roleColor ? (
                          <span
                            className="rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              borderColor: `${roleColor}55`,
                              backgroundColor: `${roleColor}1a`,
                              color: roleColor,
                            }}
                          >
                            {getRoleShort(user.role)}
                          </span>
                        ) : (
                          <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {getRoleShort(user.role)}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
                    </div>

                    {/* Chat affordance — appears on hover */}
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UsersListModal;
