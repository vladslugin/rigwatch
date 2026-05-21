export interface User {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  role: UserRole;
  createdAt: string;
  lastLoginAt: string;
  isActive: boolean;
  forceSimpleMode?: boolean; // Force simple mode for this user (overrides local settings)
  isDealer?: boolean; // Optional dealer flag for /haendler routing
  createdBy?: string; // uid of admin who created this user
  language?: 'en' | 'de';
}

export type UserRole = 'pending' | 'viewer' | 'admin' | 'developer' | 'super_admin';

export interface UserRoleConfig {
  level: number;
  name: string;
  description: string;
  permissions: string[];
  color: string;
  parameterViewScope?: 'all' | 'readable' | 'writable';
  categoryVisibility?: {
    mode: 'all' | 'none' | 'allow' | 'deny';
    categories: string[];
  };
}

export const USER_ROLE_CONFIGS: Record<UserRole, UserRoleConfig> = {
  pending: {
    level: 0,
    name: 'Pending',
    description: 'Waiting for admin approval',
    permissions: [],
    color: '#6b7280', // gray
    parameterViewScope: 'readable',
    categoryVisibility: { mode: 'all', categories: [] }
  },
  viewer: {
    level: 1,
    name: 'Viewer',
    description: 'View-only access to data',
    permissions: ['read_data', 'export_data'],
    color: '#10b981', // green
    parameterViewScope: 'readable',
    categoryVisibility: { mode: 'all', categories: [] }
  },
  admin: {
    level: 2,
    name: 'Admin',
    description: 'Can manage stove settings',
    permissions: ['read_data', 'export_data', 'manage_stoves', 'modify_settings'],
    color: '#3b82f6', // blue
    parameterViewScope: 'all',
    categoryVisibility: { mode: 'all', categories: [] }
  },
  developer: {
    level: 3,
    name: 'Developer',
    description: 'Can write updates and manage users',
    permissions: ['read_data', 'export_data', 'manage_stoves', 'modify_settings', 'manage_updates', 'manage_users', 'assign_roles', 'developer', 'users.manage_privileges', 'stoves.models_manage', 'stoves.check_updates', 'stoves.force_update', 'stoves.alternative_update'],
    color: '#8b5cf6', // purple
    parameterViewScope: 'all',
    categoryVisibility: { mode: 'all', categories: [] }
  },
  super_admin: {
    level: 3, // Same level as developer
    name: 'Super Admin',
    description: 'Can manage users but not write updates',
    permissions: ['read_data', 'export_data', 'manage_stoves', 'modify_settings', 'manage_users', 'assign_roles'],
    color: '#ef4444', // red
    parameterViewScope: 'all',
    categoryVisibility: { mode: 'all', categories: [] }
  }
};

// Ordered list of roles to keep selects consistent across the app.
export const USER_ROLES: UserRole[] = Object.keys(USER_ROLE_CONFIGS) as UserRole[];

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasPermission: (permission: string) => boolean;
  rolePermissions?: string[];
  parameterViewScope?: 'all' | 'readable' | 'writable';
  categoryVisibility?: {
    mode: 'all' | 'none' | 'allow' | 'deny';
    categories: string[];
  };
}

export interface CreateUserRequest {
  email: string;
  role: UserRole;
  sendWelcomeEmail?: boolean;
} 