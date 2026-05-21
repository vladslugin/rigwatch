// Core data types based on Firebase structure

// Main rig data (temporaer/{deviceId})
export interface RigData {
  T: number;                    // Temperature
  PL: number;                   // Screen Air
  SL: number;                   // Rear Air  
  P: number;                    // Performance
  N: number;                    // Reload Status
  id_timestamp: number;         // Timestamp
  
  // Air flow fields - new uppercase format (current Firebase format)
  PL_WINKEL?: number;            // Screen air flap angle
  PL_MOTOR_WINKEL?: number;      // Screen air motor angle
  PL_PROZENT?: number;           // Screen air percentage
  SL_WINKEL?: number;            // Rear air flap angle
  SL_MOTOR_WINKEL?: number;      // Rear air motor angle
  SL_PROZENT?: number;           // Rear air percentage
  RL_WINKEL?: number;            // Grate air angle
  RL_PROZENT?: number;           // Grate air percentage
  
  // Air flow fields - legacy lowercase format (for backward compatibility)
  pl_winkel?: number;           
  pl_motor_winkel?: number;     
  pl_prozent?: number;          
  sl_winkel?: number;           
  sl_motor_winkel?: number;     
  sl_prozent?: number;          
  rl_winkel?: number;           
  rl_prozent?: number;          
  
  // For dynamic parameters
  [key: string]: number | undefined;
}

// Device configuration from konstant/{deviceId}
export interface DeviceConfig {
  verz?: string;                 // Parameter set variant
  d?: boolean;                   // Always send data flag
  u?: boolean;                   // Update trigger
  [key: string]: any;
}

// Device metadata from konstant_app/{deviceId}
export interface DeviceMetadata {
  rigname?: string;             // Rig model name
  rig?: string;                 // Rig model number
  vers?: string;                 // Current firmware version
  shareData?: boolean;           // Data sharing permission
  f?: number;                    // Firmware update progress (0-100)
  v?: boolean;                   // New version available
  [key: string]: any;
}

// Parameter metadata from Firestore masse_und_gewichte/{paramId}
export interface ParameterMetadata {
  name?: string;                 // Display name
  einheit?: string;              // Unit (e.g., "°C", "%")
  einheitLegacy?: string;        // Unit specifically for 'SL' (legacy field 'eimheit')
  div?: number;                  // Divisor for value calculation
  form?: number;                 // Chart form (0=line, 1=stepped)
  min?: number;                  // Minimum value
  max?: number;                  // Maximum value
  was?: string;                  // Description
  color?: string;                // Chart color
  yAxisID?: string;              // Y-axis assignment
  initialSuggestedMax?: number;  // Chart scaling hint
  icon?: string;                 // FontAwesome icon class
  favorite?: number;             // Favorite status (0/1)
  position?: number;             // Display order
  show_in_legend?: boolean;      // Show in chart legend
  visible_on_chart?: boolean;    // Visible on chart by default
  kategorie?: string;            // Category name for parameter organization
  zugriff?: string;              // Access permissions: 'r' (read), 'w' (write), 'rw' (read-write)
  dataType?: 'float' | 'int' | 'bool' | 'string' | 'uint64_t'; // NEW: Explicit data type (optional for backward compatibility)
  decimalPlaces?: number;        // Number of decimal places for float display (0-12)
}

// Parsed parameter info (combination of metadata + runtime data)
export interface ParameterInfo {
  originalName: string;          // Parameter key (e.g., "T", "PL")
  displayName: string;           // Human readable name
  unit: string;                  // Display unit
  description: string;           // Parameter description
  icon: string;                  // FontAwesome icon
  color: string;                 // Chart/UI color
  divisor: number;               // Value divisor
  minValue?: number;             // Min value for normalization
  maxValue?: number;             // Max value for normalization
  form: number;                  // Chart display form
  yAxisID: string;               // Chart Y-axis
  favorite: number;              // Is favorite (0/1)
  position: number;              // Display position
  show_in_legend: boolean;       // Show in chart legend
  visible_on_chart: boolean;     // Visible on chart
  rangeString: string;           // Formatted range display
  defaultChart: boolean;         // Is base parameter
  isInitiallyVisibleOnChart: boolean; // Default visibility
  kategorie?: string;            // Category name for parameter organization
  zugriff?: string;              // Access permissions: 'r' (read), 'w' (write), 'rw' (read-write)
  dataType?: 'float' | 'int' | 'bool' | 'string' | 'uint64_t'; // NEW: Explicit data type (optional for backward compatibility)
  decimalPlaces?: number;        // Number of decimal places for float display (0-12)
}

// Historical data structure from historien/{deviceId}/{timestamp}
export interface HistoricalLog {
  [relativeTime: string]: RigData; // Relative time in seconds as key
}

// Chart marker data for analysis
export interface ChartMarker {
  timestamp: number | null;
  values: Record<string, number>;          // Original values
  normalizedValues: Record<string, number>; // Normalized values (0-100)
}

// Category data for parameter organization
export interface ParameterCategory {
  name: string;                  // Category name
  parameterIds: string[];        // List of parameter IDs in this category
  color?: string;                // Optional category color
  isExpanded?: boolean;          // UI state for collapsible view
}

// Connection status
export type ConnectionStatus = 'offline' | 'connecting' | 'online';

// Notification types
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface Notification {
  id: string;
  message: string;
  type: NotificationType;
  timestamp: number;
  autoClose?: boolean;
}

// Store interfaces for Zustand
export interface RigStore {
  // Connection state
  deviceId: string | null;
  connectionStatus: ConnectionStatus;
  
  // Current data
  currentData: RigData;
  deviceConfig: DeviceConfig;
  deviceMetadata: DeviceMetadata;
  
  // Parameters
  discoveredParameters: ParameterInfo[];
  parameterMetadataCache: Record<string, ParameterMetadata>;
  
  // Historical data
  isHistoricalMode: boolean;
  historicalTimestamps: string[];
  
  // UI state
  isEditMode: boolean;
  notifications: Notification[];
  
  // Actions
  setDeviceId: (id: string | null) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  updateCurrentData: (data: RigData) => void;
  updateDeviceConfig: (config: DeviceConfig) => void;
  updateDeviceMetadata: (metadata: DeviceMetadata) => void;
  addDiscoveredParameter: (param: ParameterInfo) => void;
  updateParameterMetadata: (paramId: string, metadata: ParameterMetadata) => void;
  setHistoricalMode: (enabled: boolean) => void;
  setEditMode: (enabled: boolean) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

// Props interfaces for components
export interface ConnectionPanelProps {
  onConnect: (deviceId: string) => Promise<void>;
  onDisconnect: () => void;
}

export interface DeviceInfoProps {
  metadata: DeviceMetadata;
  config: DeviceConfig;
  onConfigUpdate: (key: string, value: any) => Promise<void>;
  onFirmwareUpdate: (force?: boolean) => Promise<void>;
}

export interface ParameterCardProps {
  parameter: ParameterInfo;
  currentValue?: number;
  onToggleFavorite: (paramId: string) => Promise<void>;
  onToggleChart: (paramId: string, showInLegend: boolean) => Promise<void>;
  onEdit: (paramId: string) => void;
}

export interface ParameterGridProps {
  parameters: ParameterInfo[];
  currentData: RigData;
  isEditMode: boolean;
  onParameterUpdate: (paramId: string, changes: Partial<ParameterMetadata>) => Promise<void>;
  onReorderParameters: (orderedParamIds: string[]) => Promise<void>;
}

// Chart-related types
export interface ChartDataPoint {
  x: number;                     // Timestamp
  y: number | null;              // Normalized value (0-100)
  originalY: number | null;      // Original value
}

export interface ChartDataset {
  paramId: string;
  label: string;
  data: ChartDataPoint[];
  borderColor: string;
  backgroundColor: string;
  hidden: boolean;
  stepped: boolean;
}

// Error types
export interface FirebaseError {
  code: string;
  message: string;
}

// Base parameter definitions (from legacy baseParameterMetadata)
export const BASE_PARAMETERS: Record<string, Partial<ParameterInfo>> = {
  T: {
    originalName: 'T',
    displayName: 'Temperature',
    unit: '°C',
    icon: 'fa-thermometer-half',
    defaultChart: true,
    isInitiallyVisibleOnChart: true,
    color: '#d62728',
    divisor: 1,
    description: 'Main flue gas temperature.',
    zugriff: 'r'  // Read-only according to table
  },
  PL: {
    originalName: 'PL',
    displayName: 'Screen Air',
    unit: '%',
    icon: 'fa-wind',
    defaultChart: true,
    isInitiallyVisibleOnChart: true,
    color: '#1f77b4',
    divisor: 1,
    description: 'Primary air supply through the screen.',
    zugriff: 'r'  // Read-only according to table
  },
  SL: {
    originalName: 'SL',
    displayName: 'Rear Air',
    unit: '%',
    icon: 'fa-wind',
    defaultChart: true,
    isInitiallyVisibleOnChart: true,
    color: '#2ca02c',
    divisor: 1,
    description: 'Secondary air supply from the rear.',
    zugriff: 'r'  // Read-only according to table
  },
  P: {
    originalName: 'P',
    displayName: 'Performance',
    unit: '%',
    icon: 'fa-tachometer-alt',
    defaultChart: true,
    isInitiallyVisibleOnChart: true,
    color: '#ff7f0e',
    divisor: 1,
    description: 'Calculated rig performance.',
    zugriff: 'r'  // Read-only according to table
  },
  N: {
    originalName: 'N',
    displayName: 'Reload Status',
    unit: '',
    icon: 'fa-sync',
    defaultChart: true,
    isInitiallyVisibleOnChart: true,
    color: '#9467bd',
    divisor: 1,
    form: 1,
    minValue: 0,
    maxValue: 7,
    description: 'Status of the reloading process (0-7).',
    zugriff: 'r'  // Read-only according to table
  }
};

// Default values for parameter metadata
export const DEFAULT_PARAMETER_VALUES: Partial<ParameterInfo> = {
  displayName: 'Unknown Param',
  unit: '',
  description: 'Parameter data',
  icon: 'fa-tag',
  divisor: 1,
  defaultChart: false,
  isInitiallyVisibleOnChart: false,
  form: 0,
  color: '#7f7f7f',
  favorite: 0,
  position: Infinity,
  show_in_legend: false,
  visible_on_chart: false,
  zugriff: 'r'  // Default to read-only access
};

// Types needed by constants/firebase.ts
// Re-export Firebase config type so consumers don't need to import from firebase/app
export type FirebaseConfig = import('firebase/app').FirebaseOptions;

// Base parameter config shape used in baseParameterMetadata
export interface BaseParameterConfig {
  name: string;
  unit: string;
  icon: string;
  defaultChart: boolean;
  isInitiallyVisibleOnChart: boolean;
  yAxisID: string;
  initialSuggestedMax: number;
  color: string;
  divisor: number;
  description: string;
  // Optional fields used by some parameters (e.g., N)
  minValue?: number;
  maxValue?: number;
  maxValueForDisplay?: number;
  form?: number;
}
