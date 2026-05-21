// Permissions registry used by the Privileges Manager UI and role configs
// Keep this list as a central reference. New permissions can be added here over time.

export type Permission =
  | 'read_data'
  | 'export_data'
  | 'manage_rigs'
  | 'modify_settings'
  | 'manage_updates'
  | 'manage_users'
  | 'assign_roles'
  | 'developer'
  | 'manage_devices'
  // New granular permissions
  | 'rigs.check_updates'
  | 'rigs.force_update'
  | 'rigs.alternative_update'
  | 'rigs.models_manage'
  | 'parameter.view_all'
  | 'parameter.view_readable'
  | 'parameter.view_writable'
  | 'categories.rename'
  | 'categories.create'
  | 'categories.assign_parameters'
  | 'parameters.edit_values'
  | 'updates.manage'
  | 'tickets.manage'
  | 'actions.export_cpp'
  | 'actions.get_device_list'
  | 'actions.test_firestore'
  | 'actions.open_terminal'
  | 'actions.open_firebase_console'
  | 'users.manage'
  | 'users.manage_privileges'
  | 'settings.management';

export const ALL_PERMISSIONS: Permission[] = [
  'read_data',
  'export_data',
  'manage_rigs',
  'modify_settings',
  'manage_updates',
  'manage_users',
  'assign_roles',
  'developer',
  'manage_devices',
  'rigs.check_updates',
  'rigs.force_update',
  'rigs.alternative_update',
  'rigs.models_manage',
  'parameter.view_all',
  'parameter.view_readable',
  'parameter.view_writable',
  'categories.rename',
  'categories.create',
  'categories.assign_parameters',
  'parameters.edit_values',
  'updates.manage',
  'tickets.manage',
  'actions.export_cpp',
  'actions.get_device_list',
  'actions.test_firestore',
  'actions.open_terminal',
  'actions.open_firebase_console',
  'users.manage',
  'users.manage_privileges',
  'settings.management'
];


