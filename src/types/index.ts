// Core data types based on Firebase structure

// Real-time device data from temporaer/{deviceId}
export interface StoveData {
  T?: number;                    // Temperature
  PL?: number;                   // Screen Air (Primary Air)
  SL?: number;                   // Rear Air (Secondary Air)  
  P?: number;                    // Performance
  N?: number;                    // Reload Status (0-7)
  a?: number;                    // Article number (for stove model lookup)
  
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
  pl_winkel?: number;            // Screen air flap angle
  pl_motor_winkel?: number;      // Screen air motor angle
  pl_prozent?: number;           // Screen air percentage
  sl_winkel?: number;            // Rear air flap angle
  sl_motor_winkel?: number;      // Rear air motor angle
  sl_prozent?: number;           // Rear air percentage
  rl_winkel?: number;            // Grate air angle
  rl_prozent?: number;           // Grate air percentage
  
  CO2?: number;                 // Measured CO₂ concentration (historical logs)
  id_timestamp?: number;         // Server timestamp
  TRIG1?: number;                 // Trigger value
  __historical?: boolean;        // Flag indicating this is historical data
  __historicalPoints?: number;   // Number of points in historical log
  [key: string]: number | boolean | undefined; // Allow dynamic parameters
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
  ofenname?: string;             // Stove model name
  ofen?: string;                 // Stove model number
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
  dataType?: 'float' | 'int' | 'bool' | 'string' | 'uint64_t'; // Explicit data type (optional for backward compatibility)
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
  initialSuggestedMax?: number;  // Chart scaling hint
  favorite: number;              // Is favorite (0/1)
  position: number;              // Display position
  show_in_legend: boolean;       // Show in chart legend
  visible_on_chart: boolean;     // Visible on chart
  rangeString: string;           // Formatted range display
  defaultChart: boolean;         // Is base parameter
  isInitiallyVisibleOnChart: boolean; // Default visibility
  zugriff?: string;              // Access permissions (r/w/rw/empty)
  kategorie?: string;            // Parameter category
  dataType?: 'float' | 'int' | 'bool' | 'string' | 'uint64_t'; // Explicit data type (optional for backward compatibility)
}

// Historical data structure from historien/{deviceId}/{timestamp}
export interface HistoricalLog {
  [relativeTime: string]: StoveData; // Relative time in seconds as key
}

// Chart marker data for analysis
export interface ChartMarker {
  timestamp: number | null;
  values: Record<string, number>;          // Original values
  normalizedValues: Record<string, number>; // Normalized values (0-100)
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
  duration?: number; // Duration in milliseconds (default 3500)
  isAlarm?: boolean; // Special alarm notifications with sound and blinking
  deviceId?: string; // Device that triggered the alarm
  parameterName?: string; // Parameter that triggered the alarm
}

// Store interfaces for Zustand
export interface StoveStore {
  // Connection state
  deviceId: string | null;
  connectionStatus: ConnectionStatus;
  
  // Current data
  currentData: StoveData;
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
  updateCurrentData: (data: StoveData) => void;
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
  currentData: StoveData;
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
    description: 'Main flue gas temperature.'
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
    description: 'Primary air supply through the screen.'
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
    description: 'Secondary air supply from the rear.'
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
    description: 'Calculated stove performance.'
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
    description: 'Status of the reloading process (0-7).'
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
  visible_on_chart: false
};

// ML Prediction System Types
export interface CO2TrainingData {
  timestamp: number;
  features: {
    // Raw sensor data
    T: number;                    // Momentary flue gas temperature (°C)
    o2: number;                   // Residual oxygen in smoke (%)
    pl: number;                   // Primary air level (%)
    sl: number;                   // Secondary air level (%)
    Tquer: number;                // Smoothed firebox temperature (°C)
    m: number;                    // Unknown parameter
    TN: number;                   // Temperature at start of firing (°C)
    rel_t: number;                // Time since last door opening (s)
    
    // Engineered features (calculated from raw data)
    temperatureAvg?: number;        // Rolling average
    temperatureGradient?: number;   // Change rate
    temperatureVariance?: number;   // Variance in window
    temperatureTrend?: number;      // Linear trend
    
    primaryAirPositionAvg?: number;      // Rolling average
    primaryAirPositionGradient?: number; // Change rate
    primaryAirPositionVariance?: number; // Variance in window
    primaryAirPositionTrend?: number;    // Linear trend
    
    currentCOAvg?: number;             // Rolling average
    currentCOGradient?: number;        // Change rate
    currentCOVariance?: number;        // Variance in window
    currentCOTrend?: number;           // Linear trend
    
    // Legacy compatibility (will be mapped from new format)
    temperature?: number;         // Maps to T
    primaryAirPosition?: number;  // Maps to pl
    airRatio?: number;           // Calculated from pl/sl
    currentCO?: number;          // Estimated from o2
    cycleTime?: number;          // Maps to rel_t
    tempAirInteraction?: number; // Calculated feature
  };
  target: number;                 // CO2 percentage (raw_co2 / 204.73)
  hasRealTarget?: boolean;        // Flag to indicate if this is real training data
}

// Feature selection configuration
export interface FeatureSelection {
  selectedFeatures: string[];
  availableFeatures: string[];
  useEngineeredFeatures: boolean;
}

export interface CO2PredictionResult {
  predictedCO2: number;
  confidence: number;            // Model confidence (0-1)
  timestamp: number;
  features: CO2TrainingData['features'];
}

export interface ModelMetrics {
  mae: number;                   // Mean Absolute Error
  mse: number;                   // Mean Squared Error
  rmse: number;                  // Root Mean Squared Error
  mape: number;                  // Mean Absolute Percentage Error
  r2: number;                    // R-squared
  trainingSamples: number;       // Number of training samples
  lastTrainingTime: number;      // Last training time
}

export interface TimeSeriesWindow {
  windowSize: number;            // Time series window size
  features: number[][];          // Feature array for each time step
  targets: number[];             // Target values
}

// ML model settings
export interface MLModelConfig {
  windowSize: number;            // Time window size (e.g., 10 previous measurements)
  predictionHorizon: number;     // How many steps ahead to predict
  learningRate: number;          // Learning rate
  epochs: number;                // Number of training epochs
  batchSize: number;             // Batch size
  validationSplit: number;       // Validation data fraction
  earlyStoppingPatience: number; // Early stopping patience
}

// UI Components removed

export type ParameterDataType = 'float' | 'int' | 'uint64_t' | 'bool' | 'string';
