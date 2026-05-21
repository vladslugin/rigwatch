import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import type { User, UserRole, CreateUserRequest } from '../types/auth';
import { USER_ROLE_CONFIGS } from '../types/auth';

interface MobileAdminPanelProps {
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

// Simple Create User Modal
const CreateUserModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onCreate: (userData: CreateUserRequest) => void;
  isLoading: boolean;
}> = ({ isOpen, onClose, onCreate, isLoading }) => {
  const [userData, setUserData] = useState<CreateUserRequest>({
    email: '',
    role: 'viewer',
    sendWelcomeEmail: true
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userData.email.trim()) {
      onCreate(userData);
      setUserData({ email: '', role: 'viewer', sendWelcomeEmail: true });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-md"
        onClick={onClose}
      />

      <div className="relative bg-card text-foreground rounded-lg shadow-lg w-full max-w-md p-6 border border-border">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-foreground">Add New User</h3>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Email Address
            </label>
            <input
              type="email"
              value={userData.email}
              onChange={(e) => setUserData({ ...userData, email: e.target.value })}
              placeholder="operator@rigwatch.app"
              className="w-full px-3 py-2 border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Role
            </label>
            <select
              value={userData.role}
              onChange={(e) => setUserData({ ...userData, role: e.target.value as UserRole })}
              className="w-full px-3 py-2 border border-border rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {Object.entries(USER_ROLE_CONFIGS).map(([role, config]) => (
                <option key={role} value={role}>
                  {config.name} - {config.description}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="sendWelcomeEmail"
              checked={userData.sendWelcomeEmail}
              onChange={(e) => setUserData({ ...userData, sendWelcomeEmail: e.target.checked })}
              className="h-4 w-4 text-primary border-border rounded focus:ring-primary"
            />
            <label htmlFor="sendWelcomeEmail" className="ml-2 text-sm text-muted-foreground">
              Send welcome email
            </label>
          </div>

          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-muted text-foreground rounded-md hover:brightness-95 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!userData.email.trim() || isLoading}
              className="flex-1 px-4 py-2 bg-primary hover:brightness-95 disabled:opacity-50 text-primary-foreground rounded-md transition-colors"
            >
              {isLoading ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Main Admin Panel (Desktop only for now)
const MobileAdminPanel: React.FC<MobileAdminPanelProps> = ({ isOpen, onClose }) => {
  const { user, hasPermission, createUser, getAllUsers, updateUserRole, toggleUserActive, toggleUserForceSimpleMode } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && hasPermission('manage_users')) {
      loadUsers();
      setShowCreateUser(false);
    }
  }, [isOpen, hasPermission]);

  useEffect(() => {
    if (!isOpen) {
      setShowCreateUser(false);
    }
  }, [isOpen]);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const userList = await getAllUsers();
      setUsers(userList);
    } catch (err) {
      setError('Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateUser = async (userData: CreateUserRequest) => {
    if (!user) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await createUser(userData, user.uid);
      if (result.success) {
        setSuccess('User created successfully!');
        setShowCreateUser(false);
        await loadUsers();
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(result.error || 'Failed to create user');
      }
    } catch (err) {
      setError('Failed to create user');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await updateUserRole(userId, newRole);
      if (result.success) {
        setSuccess('Role updated successfully!');
        await loadUsers();
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(result.error || 'Failed to update role');
      }
    } catch (err) {
      setError('Failed to update role');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleActive = async (userId: string, isActive: boolean) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await toggleUserActive(userId, isActive);
      if (result.success) {
        setSuccess(`User ${isActive ? 'activated' : 'deactivated'} successfully!`);
        await loadUsers();
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(result.error || 'Failed to update user status');
      }
    } catch (err) {
      setError('Failed to update user status');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleForceSimpleMode = async (userId: string, forceSimpleMode: boolean) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await toggleUserForceSimpleMode(userId, forceSimpleMode);
      if (result.success) {
        setSuccess(forceSimpleMode ? 'Simple Mode aktiviert' : 'Simple Mode deaktiviert');
        await loadUsers();
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(result.error || 'Fehler beim Aktualisieren des Simple Mode');
      }
    } catch (err) {
      setError('Fehler beim Aktualisieren des Simple Mode');
    } finally {
      setIsLoading(false);
    }
  };

  if (!hasPermission('manage_users') || !isOpen) {
    return null;
  }

  return (
    <>
      {/* Desktop Modal */}
      <div className="fixed inset-0 bg-black/45 backdrop-blur-md flex items-center justify-center z-[60] p-4" onClick={onClose}>
        <div
          className="bg-card text-foreground rounded-lg shadow-lg w-full max-w-7xl mx-4 max-h-[90vh] overflow-hidden border border-border flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-6 border-b border-border bg-section-header text-section-header-foreground">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-destructive/20 rounded-lg flex items-center justify-center mr-3">
                <svg className="w-5 h-5 text-destructive" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 7V9C15 9.8 14.2 10.5 13.4 10.5H10.6C9.8 10.5 9 9.8 9 9V7H3V9C3 10.1 3.9 11 5 11V19C5 20.1 5.9 21 7 21H17C18.1 21 19 20.1 19 19V11C20.1 11 21 10.1 21 9Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold">User Management</h3>
                <p className="text-sm text-section-header-foreground/80">{users.length} users total</p>
              </div>
            </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowCreateUser(true)}
                className="flex items-center px-4 py-2 bg-primary hover:brightness-95 text-primary-foreground rounded-lg transition-colors text-sm font-medium"
              >
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                Add New User
              </button>
              <button
                onClick={onClose}
                className="text-section-header-foreground/70 hover:text-section-header-foreground transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] bg-background">
            {error && (
              <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {success && (
              <div className="mb-4 p-3 bg-success/10 border border-success/30 rounded-lg">
                <p className="text-sm text-success">{success}</p>
              </div>
            )}

            {isLoading && users.length === 0 ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="bg-muted rounded-lg p-4 animate-pulse">
                    <div className="flex items-center space-x-4">
                      <div className="w-12 h-12 bg-muted-foreground/20 rounded-full" />
                      <div className="flex-1">
                        <div className="h-4 bg-muted-foreground/20 rounded mb-2" />
                        <div className="h-3 bg-muted-foreground/20 rounded w-2/3" />
                      </div>
                      <div className="w-24 h-8 bg-muted-foreground/20 rounded" />
                      <div className="w-16 h-8 bg-muted-foreground/20 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : users.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <p className="text-muted-foreground">No users found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Create the first user to get started
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">User</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Role</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Status</th>
                      <th className="text-left py-3 px-4 font-medium text-muted-foreground">Last Login</th>
                      <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((userItem) => {
                      const roleConfig = USER_ROLE_CONFIGS[userItem.role];

                      return (
                        <tr key={userItem.uid} className="border-b border-border hover:bg-muted/50">
                          <td className="py-4 px-4">
                            <div className="flex items-center space-x-3">
                              <div className="relative">
                                <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center flex-shrink-0">
                                  {userItem.photoURL ? (
                                    <img src={userItem.photoURL} alt="" className="w-10 h-10 rounded-full" />
                                  ) : (
                                    <svg className="w-5 h-5 mr-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                  )}
                                </div>
                                {!userItem.isActive && (
                                  <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-destructive border-2 border-card rounded-full" />
                                )}
                              </div>
                              <div>
                                <div className="flex items-center space-x-2">
                                  <p className="text-sm font-medium text-foreground">
                                    {userItem.displayName || userItem.email}
                                  </p>
                                  {userItem.uid === user?.uid && (
                                    <span className="px-2 py-1 text-xs bg-info/15 text-info border border-info/30 rounded">
                                      You
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">{userItem.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${getRoleBadgeClass(userItem.role)}`}
                            >
                              {roleConfig?.name || userItem.role}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                              userItem.isActive
                                ? 'bg-success/15 text-success border-success/30'
                                : 'bg-destructive/15 text-destructive border-destructive/30'
                            }`}>
                              <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                                userItem.isActive ? 'bg-success' : 'bg-destructive'
                              }`} />
                              {userItem.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-sm text-muted-foreground">
                              {new Date(userItem.lastLoginAt).toLocaleDateString()}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center justify-end space-x-2">
                              <select
                                value={userItem.role}
                                onChange={(e) => handleRoleChange(userItem.uid, e.target.value as UserRole)}
                                disabled={isLoading || userItem.uid === user?.uid}
                                className="text-xs border border-border rounded px-2 py-1 bg-card text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {Object.entries(USER_ROLE_CONFIGS).map(([role, config]) => (
                                  <option key={role} value={role}>
                                    {config.name}
                                  </option>
                                ))}
                              </select>

                              {userItem.uid !== user?.uid && (
                                <>
                                  <button
                                    onClick={() => handleToggleActive(userItem.uid, !userItem.isActive)}
                                    disabled={isLoading}
                                    className={`px-2 py-1 text-xs rounded border transition-colors disabled:opacity-50 ${
                                      userItem.isActive
                                        ? 'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20'
                                        : 'bg-success/10 text-success border-success/30 hover:bg-success/20'
                                    }`}
                                  >
                                    {userItem.isActive ? 'Deactivate' : 'Activate'}
                                  </button>
                                  <button
                                    onClick={() => handleToggleForceSimpleMode(userItem.uid, !userItem.forceSimpleMode)}
                                    disabled={isLoading}
                                    className={`px-2 py-1 text-xs rounded border transition-colors disabled:opacity-50 ${
                                      userItem.forceSimpleMode
                                        ? 'bg-info/10 text-info border-info/30 hover:bg-info/20'
                                        : 'bg-muted text-muted-foreground border-border hover:brightness-95'
                                    }`}
                                    title={userItem.forceSimpleMode ? 'Simple Mode deaktivieren' : 'Simple Mode aktivieren'}
                                  >
                                    {userItem.forceSimpleMode ? 'Simple: Ein' : 'Simple: Aus'}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create User Modal */}
      <CreateUserModal
        isOpen={showCreateUser}
        onClose={() => setShowCreateUser(false)}
        onCreate={handleCreateUser}
        isLoading={isLoading}
      />
    </>
  );
};

export default MobileAdminPanel;
