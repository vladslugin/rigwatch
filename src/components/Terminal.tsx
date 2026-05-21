import React, { useState, useCallback, useRef, useEffect, useMemo, lazy, Suspense } from 'react';
import asciiLogo from '../assets/ascii_logo.txt?raw';
import { realtimeDB, auth } from '../lib/firebase';
import { ref, get, set, update, runTransaction, remove } from 'firebase/database';
import { useStoveStore } from '../store/useStoveStore';
import { useAuth } from '../hooks/useAuth';
import { useFirebaseConnection, useDeviceList, useHistoricalData } from '../hooks/useFirebase';
import { formatHistoricalDateWithUserTimezone } from '../utils/timezone';
import { queueSetCommand, queueCommand } from '../utils/commandQueue';
import type { User, UserRole } from '../types/auth';
import { USER_ROLES, USER_ROLE_CONFIGS } from '../types/auth';
import ParameterCardsModal from './ParameterCardsModal';
import ChartModal from './ChartModal';
import AirFlowModal from './AirFlowModal';
// Lazy-loaded so the Monaco editor (~1.5 MB unminified) stays out of the
// initial bundle. Vite emits RigopsEditor + Monaco as a separate chunk that
// the browser fetches the first time the user opens the .rigops editor.
const RigopsEditor = lazy(() => import('./RigopsEditor'));
import { useTiling } from '../context/TilingContext';
import type { ThemeName } from '../hooks/useTheme';

// Privilege-escalation guard for terminal user-management commands.
// `super_admin` is the trusted top-level operator and may assign any role.
// `developer` is a technical role and must NOT be able to grant the elevated
// roles (`developer`, `super_admin`) — otherwise any developer could mint
// another super_admin/developer and own the whole user system.
const canAssignRole = (
  actorRole: UserRole | undefined,
  targetRole: UserRole
): boolean => {
  if (actorRole === 'super_admin') return true;
  if (actorRole === 'developer') {
    return targetRole !== 'developer' && targetRole !== 'super_admin';
  }
  return false;
};

interface TerminalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TerminalLine {
  type: 'command' | 'output' | 'error' | 'info';
  content: string;
  timestamp: Date;
}

interface CommandSuggestion {
  command: string;
  description: string;
  args?: string[];
}

interface UndoEntry {
  label: string;
  run: () => Promise<void>;
}

/** State for a terminal-managed chart window */
interface ChartWindowState {
  id: string;
  index: number;
  isOpen: boolean;
  isMinimized: boolean;
  isHighlighted: boolean;
  historicalTimestamp?: string;
}

/** State for terminal-managed modal windows */
interface TerminalWindowsState {
  charts: ChartWindowState[];
  cards: { isOpen: boolean; isMinimized: boolean; isHighlighted: boolean };
  airflow: { isOpen: boolean; isMinimized: boolean; isHighlighted: boolean };
  terminal: { isMinimized: boolean };
}

type WindowFocusId = 'terminal' | 'params' | 'airflow' | 'code' | string;

// Admin commands available only for super_admin and developer
const ADMIN_COMMANDS: CommandSuggestion[] = [
  { command: 'user_list', description: 'List all users', args: [] },
  { command: 'user_role', description: 'Change user role', args: ['<email>', '<role>'] },
  { command: 'user_active', description: 'Activate/deactivate user', args: ['<email>', '<true|false>'] },
  { command: 'user_simple', description: 'Toggle Simple Mode for user', args: ['<email>', '<true|false>'] },
  { command: 'user_dealer', description: 'Toggle dealer mode route lock for user', args: ['<email>', '<true|false>'] },
  { command: 'user_create', description: 'Create new user', args: ['<email>', '<role>'] },
  { command: 'delete_param', description: 'Delete parameter from current device', args: ['<paramId>'] },
  { command: 'temp_clear', description: 'Delete all temporaer entries', args: ['confirm'] },
];

// Base commands available for all authorized users
const BASE_COMMANDS: CommandSuggestion[] = [
  { command: 'help', description: 'Show available commands', args: [] },
  { command: 'clear', description: 'Clear terminal', args: [] },
  { command: 'undo', description: 'Undo last reversible change', args: ['[count]'] },
  { command: 'connect', description: 'Connect to device', args: ['<device_id>'] },
  { command: 'disconnect', description: 'Disconnect from current device', args: [] },
  { command: 'device', description: 'Show device info', args: [] },
  { command: 'status', description: 'Show connection status', args: [] },
  { command: 'set', description: 'Set parameter value', args: ['<parameter>', '<value>'] },
  { command: 'get', description: 'Read parameter value', args: ['<param> [as <var>]'] },
  { command: 'read', description: 'Read parameter into variable', args: ['<param> <var>'] },
  { command: 'collect', description: 'Collect params from one or many devices', args: ['from <ids|all> params <params> [where <cond>] [as <var>]'] },
  { command: 'collect_cache', description: 'Inspect or clear collect cache', args: ['[clear]'] },
  { command: 'fb_cd', description: 'Set current Firebase path', args: ['<path>'] },
  { command: 'fb_pwd', description: 'Show current Firebase path', args: [] },
  { command: 'fb_get', description: 'Read Firebase value', args: ['<path> [as <var>]'] },
  { command: 'fb_exists', description: 'Check Firebase path exists', args: ['<path> [as <var>]'] },
  { command: 'fb_keys', description: 'List keys; shallow = fast (no subtree data)', args: ['<path> [shallow] [prefix <p>] [as <var>]'] },
  { command: 'fb_tree', description: 'Show recursive Firebase tree', args: ['[path] [depth N] [limit N]'] },
  { command: 'fb_set', description: 'Set Firebase value', args: ['<path> <value>'] },
  { command: 'fb_update', description: 'Update Firebase object', args: ['<path> <json>'] },
  { command: 'fb_remove', description: 'Remove Firebase path', args: ['<path> confirm'] },
  { command: 'fb_copy', description: 'Copy Firebase value', args: ['<from> -> <to> [if_missing]'] },
  { command: 'substr', description: 'Slice string into variable', args: ['<value> <start> <length> as <var>'] },
  { command: 'update', description: 'Update with alternative file', args: ['<filename>'] },
  { command: 'sleep', description: 'Pause execution', args: ['<duration>'] },
  { command: 'wait', description: 'Pause execution', args: ['<duration>'] },
  { command: 'wait_param', description: 'Wait for parameter value', args: ['<param> [timeout] [interval]'] },
  { command: 'log_save', description: 'Save terminal log to file', args: ['[filename]'] },
  { command: 'repeat', description: 'Repeat a block', args: ['<count> { ... }'] },
  { command: 'preset_save', description: 'Save a script preset', args: ['<name> { ... }'] },
  { command: 'preset_run', description: 'Run a saved preset', args: ['<name>'] },
  { command: 'preset_list', description: 'List saved presets', args: [] },
  { command: 'preset_show', description: 'Show preset content', args: ['<name>'] },
  { command: 'preset_delete', description: 'Delete a preset', args: ['<name>'] },
  { command: 'log', description: 'Write a note to output', args: ['<message>'] },
  { command: 'assert_connected', description: 'Stop script if no device', args: [] },
  { command: 'script_status', description: 'Show script execution status', args: [] },
  { command: 'let', description: 'Set a script variable', args: ['<name> <value>'] },
  { command: 'calc', description: 'Evaluate math expression', args: ['<expr> [as <var>]'] },
  { command: 'unset', description: 'Remove a script variable', args: ['<name>'] },
  { command: 'vars', description: 'List script variables', args: [] },
  { command: 'if', description: 'Conditional execution', args: ['<cond> { ... } else { ... }'] },
  { command: 'try', description: 'Try/catch block', args: ['{ ... } catch { ... }'] },
  { command: 'while', description: 'Loop while condition is true', args: ['<cond> { ... }'] },
  { command: 'for', description: 'Loop: range, list literal, or $variable list', args: ['<var> in 1..N | [a,b] | $ids { ... }'] },
  { command: 'break', description: 'Break out of current loop', args: [] },
  { command: 'continue', description: 'Skip to next loop iteration', args: [] },
  { command: 'code', description: 'Open script editor', args: [] },
  { command: 'cards', description: 'Open parameter cards viewer', args: [] },
  { command: 'chart', description: 'Open chart (realtime or historical)', args: ['[timestamp]'] },
  { command: 'luftstrom', description: 'Open air flow diagram viewer', args: [] },
  { command: 'close', description: 'Close a modal window', args: ['<cards|chart|airflow|all|chart N>'] },
  { command: 'min', description: 'Minimize a window', args: ['<terminal|cards|chart|airflow|chart N>'] },
  { command: 'max', description: 'Maximize/restore a window', args: ['<terminal|cards|chart|airflow|chart N>'] },
  { command: 'tile', description: 'Control tiling mode', args: ['[on|off|h|v|grid]'] },
  { command: 'opacity', description: 'Set window transparency', args: ['[0.1-1.0]'] },
  { command: 'stove_status', description: 'Show current stove status', args: ['[duration] [interval]'] },
  { command: 'stop', description: 'Stop monitoring and cancel running script', args: [] },
  { command: 'd', description: 'Toggle/set Alle Werte mode', args: ['[true|false]'] },
  { command: 'k', description: 'Toggle/set Nur App-Werte mode', args: ['[true|false]'] },
  { command: 'errors', description: 'Show Fehlerlisten for PL/SL and all', args: ['[first|last] [n]'] },
  { command: 'snake', description: 'Play Snake (ASCII)', args: [] },
  { command: 'type_race', description: 'Type 10 words fast (ASCII)', args: [] },
  { command: '2048', description: 'Play 2048 (ASCII)', args: [] },
  { command: 'rigfetch', description: 'Show RigWatch system info', args: [] },
];

const PRESET_STORAGE_KEY = 'terminal_presets_v1';
const MAX_SCRIPT_STEPS = 200;
const MAX_REPEAT_COUNT = 50;
/** Historien / große fb_keys-Listen: Schleifen >100 brauchen Migrationsskripte */
const MAX_LOOP_ITERATIONS = 5000;
const COLLECT_CACHE_TTL_MS = 60 * 1000;
const MAX_UNDO_STACK = 100;

const Terminal: React.FC<TerminalProps> = ({ isOpen, onClose }) => {
  const { user, hasPermission, getAllUsers, updateUserRole, toggleUserActive, toggleUserForceSimpleMode, toggleUserDealerMode, createUser } = useAuth();
  const { connect, disconnect, ensureActiveClientPresent } = useFirebaseConnection();
  const deviceId = useStoveStore(state => state.deviceId);
  const connectionStatus = useStoveStore(state => state.connectionStatus);
  const deviceConfig = useStoveStore(state => state.deviceConfig);
  const deviceMetadata = useStoveStore(state => state.deviceMetadata);
  const currentData = useStoveStore(state => state.currentData);
  const discoveredParameters = useStoveStore(state => state.discoveredParameters);
  
  // Tiling system
  const tiling = useTiling();
  
  // State for terminal-managed modal windows
  const [windowsState, setWindowsState] = useState<TerminalWindowsState>({
    charts: [],
    cards: { isOpen: false, isMinimized: false, isHighlighted: false },
    airflow: { isOpen: false, isMinimized: false, isHighlighted: false },
    terminal: { isMinimized: false },
  });
  const [activeWindowId, setActiveWindowId] = useState<WindowFocusId>('terminal');
  
  // Chart ID counter
  const chartIdCounterRef = useRef(0);
  
  // Historical timestamps for autocomplete
  const [historicalTimestamps, setHistoricalTimestamps] = useState<string[]>([]);
  const timestampsLoadedRef = useRef(false);
  
  // Highlight timeout refs
  
  // Ref for monitoring interval (stove_status)
  const monitoringIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const snakeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const scriptRunningRef = useRef(false);
  const scriptCancelRef = useRef(false);
  const scriptProgressRef = useRef<{ total: number; done: number } | null>(null);
  const scriptVarsRef = useRef<Record<string, string>>({});
  const scriptBreakRef = useRef(false);
  const scriptContinueRef = useRef(false);
  const trackCommandErrorsRef = useRef(false);
  const commandErrorRef = useRef(false);
  const scriptSilentEchoRef = useRef(false);
  const silentInfoOverrideRef = useRef(false);
  const firebaseCwdRef = useRef<string>('');
  const lastDataTimestampRef = useRef<string | number | null>(null);
  const collectCacheRef = useRef<Record<string, { payload: unknown; error: string | null; fetchedAt: number }>>({});
  const undoStackRef = useRef<UndoEntry[]>([]);
  const loopDepthRef = useRef(0);
  const snakeDirectionRef = useRef<'up' | 'down' | 'left' | 'right'>('right');
  const snakeNextDirectionRef = useRef<'up' | 'down' | 'left' | 'right'>('right');
  const snakeBodyRef = useRef<Array<{ x: number; y: number }>>([]);
  const snakeFoodRef = useRef<{ x: number; y: number } | null>(null);
  const snakeScoreRef = useRef(0);
  const typingStartTimeRef = useRef<number | null>(null);
  const typingWordsRef = useRef<string[]>([]);
  const typingIndexRef = useRef(0);
  const typingCorrectRef = useRef(0);
  const game2048WonRef = useRef(false);

  const [snakeActive, setSnakeActive] = useState(false);
  const [snakeGridLines, setSnakeGridLines] = useState<string[]>([]);
  const [snakeScore, setSnakeScore] = useState(0);
  const [typingActive, setTypingActive] = useState(false);
  const [typingCurrentWord, setTypingCurrentWord] = useState('');
  const [typingProgress, setTypingProgress] = useState({ index: 0, total: 10, correct: 0 });
  const [game2048Active, setGame2048Active] = useState(false);
  const [game2048Board, setGame2048Board] = useState<number[][]>([]);
  const [game2048Score, setGame2048Score] = useState(0);
  const [silentScriptEcho, setSilentScriptEcho] = useState(false);

  const typingWordBank = useMemo(() => ([
    'apple', 'river', 'smile', 'train', 'chair', 'table', 'cloud', 'green', 'light', 'sound',
    'bread', 'stone', 'grass', 'water', 'quiet', 'paper', 'mouse', 'sweet', 'house', 'clear',
    'sunny', 'happy', 'quick', 'brave', 'sharp', 'drink', 'world', 'phone', 'clock', 'black',
    'white', 'brown', 'earth', 'beach', 'plant', 'fresh', 'human', 'small', 'large', 'solid',
    'dream', 'plane', 'storm', 'lemon', 'peach', 'grape', 'candy', 'honey', 'spoon', 'fruit'
  ]), []);

  const [input, setInput] = useState('');
  const [history, setHistory] = useState<TerminalLine[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [presets, setPresets] = useState<Record<string, string>>({});
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorValue, setEditorValue] = useState('');
  const [lastEditorScript, setLastEditorScript] = useState('');
  const [rigopsMeta, setRigopsMeta] = useState<{ name: string; author: string; created: string; version: string }>({
    name: '',
    author: '',
    created: '',
    version: '',
  });
  const [rigopsWarnings, setRigopsWarnings] = useState<string[]>([]);
  const [rigopsBody, setRigopsBody] = useState('');
  const [rigopsMode, setRigopsMode] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 960, height: 520 });
  const resizeStateRef = useRef<{
    resizing: boolean;
    edge: { n: boolean; s: boolean; e: boolean; w: boolean };
    startMouseX: number;
    startMouseY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  }>({
    resizing: false,
    edge: { n: false, s: false, e: false, w: false },
    startMouseX: 0,
    startMouseY: 0,
    startX: 0,
    startY: 0,
    startWidth: 960,
    startHeight: 520,
  });

  // Users list for autocomplete
  const [users, setUsers] = useState<User[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Device list for autocomplete
  const { getAllDeviceIds } = useDeviceList();
  const [allDeviceIds, setAllDeviceIds] = useState<string[]>([]);
  const [allDeviceComments, setAllDeviceComments] = useState<Record<string, string>>({});
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  
  // Historical data for autocomplete
  const { loadHistoricalTimestamps } = useHistoricalData();
  const [themeName, setThemeName] = useState<ThemeName>('default');
  const isNeo = themeName === 'neo-brutalism';

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handler = () => {
      const next = (document.documentElement.dataset.theme as ThemeName) || 'default';
      setThemeName(next);
    };
    const observer = new MutationObserver(handler);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    handler();
    return () => observer.disconnect();
  }, []);

  // Stop any running setInterval timers when the Terminal unmounts.
  // `stove_status <duration>` and `snake` install long-lived intervals; without
  // an unmount cleanup they keep running (and addLine into a dead component),
  // accumulating on every Terminal mount/unmount cycle.
  useEffect(() => {
    return () => {
      if (monitoringIntervalRef.current) {
        clearInterval(monitoringIntervalRef.current);
        monitoringIntervalRef.current = null;
      }
      if (snakeIntervalRef.current) {
        clearInterval(snakeIntervalRef.current);
        snakeIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed && typeof parsed === 'object') {
        setPresets(parsed);
      }
    } catch (error) {
      console.warn('[Terminal] Failed to load presets:', error);
    }
  }, []);

  // Check if user can use admin commands
  const canUseAdminCommands = useMemo(() => {
    return user?.role === 'super_admin' || user?.role === 'developer';
  }, [user?.role]);

  // Available commands based on role
  const availableCommands = useMemo(() => {
    return canUseAdminCommands ? [...BASE_COMMANDS, ...ADMIN_COMMANDS] : BASE_COMMANDS;
  }, [canUseAdminCommands]);

  // Load users for autocomplete
  useEffect(() => {
    if (isOpen && canUseAdminCommands) {
      getAllUsers().then(setUsers).catch(() => setUsers([]));
    }
  }, [isOpen, canUseAdminCommands, getAllUsers]);

  // Load devices for autocomplete
  useEffect(() => {
    if (!isOpen || allDeviceIds.length > 0 || isLoadingDevices) return;

    const loadDevices = async () => {
      setIsLoadingDevices(true);
      try {
        const deviceIds = await getAllDeviceIds();
        setAllDeviceIds(deviceIds);

        // Load comments for devices
        if (realtimeDB) {
          const konstantAppRef = ref(realtimeDB, 'konstant_app');
          const snapshot = await get(konstantAppRef);
          const commentsMap: Record<string, string> = {};
          if (snapshot.exists()) {
            snapshot.forEach(child => {
              const id = child.key;
              const val = child.val() as any;
              if (id) {
                const comment = typeof val?.comment === 'string' ? val.comment : '';
                commentsMap[id] = comment;
              }
            });
          }
          setAllDeviceComments(commentsMap);
        }
      } catch (error) {
        console.error('[Terminal] Failed to load device IDs:', error);
      } finally {
        setIsLoadingDevices(false);
      }
    };

    loadDevices();
  }, [isOpen, allDeviceIds.length, isLoadingDevices, getAllDeviceIds]);

  // Load historical timestamps for autocomplete
  useEffect(() => {
    if (!isOpen || !deviceId || timestampsLoadedRef.current) return;
    
    const loadTimestamps = async () => {
      try {
        const timestamps = await loadHistoricalTimestamps();
        setHistoricalTimestamps(timestamps);
        timestampsLoadedRef.current = true;
      } catch (error) {
        console.error('[Terminal] Failed to load historical timestamps:', error);
      }
    };
    
    loadTimestamps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, deviceId]);

  // Reset timestamps when device changes
  useEffect(() => {
    timestampsLoadedRef.current = false;
    setHistoricalTimestamps([]);
  }, [deviceId]);

  // Format timestamp for display in suggestions
  const formatTimestampForDisplay = useCallback((timestamp: string): string => {
    try {
      const ts = parseInt(timestamp, 10);
      return formatHistoricalDateWithUserTimezone(new Date(ts * 1000), 'de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return timestamp;
    }
  }, []);

  // Generate suggestions based on current input
  const getSuggestions = useCallback((inputValue: string): { suggestions: string[]; hint: string } => {
    if (snakeActive || typingActive || game2048Active) {
      return { suggestions: [], hint: '' };
    }
    const trimmed = inputValue.trim();
    const parts = trimmed.split(' ');
    const cmd = parts[0].toLowerCase();

    // No input - show nothing
    if (!trimmed) {
      return { suggestions: [], hint: '' };
    }

    // Command not complete - suggest matching commands
    if (parts.length === 1) {
      const matchingCommands = availableCommands
        .filter(c => c.command.startsWith(cmd))
        .map(c => c.command);
      
      if (matchingCommands.length === 1 && matchingCommands[0] === cmd) {
        // Exact match - show argument hint only if command has args
        const cmdInfo = availableCommands.find(c => c.command === cmd);
        if (cmdInfo?.args && cmdInfo.args.length > 0) {
          return { suggestions: [], hint: cmdInfo.args.join(' ') };
        }
        // Command without args - no suggestions, no hint
        return { suggestions: [], hint: '' };
      }
      
      return { suggestions: matchingCommands, hint: '' };
    }

    // Admin commands autocomplete
    if (canUseAdminCommands) {
      // user_role <email> <role>
      if (cmd === 'user_role') {
        if (parts.length === 2) {
          const emailPart = parts[1].toLowerCase();
          const matchingUsers = users
            .filter(u => u.email.toLowerCase().includes(emailPart) || (u.displayName?.toLowerCase().includes(emailPart)))
            .map(u => u.email)
            .slice(0, 5);
          
          if (matchingUsers.length === 1 && matchingUsers[0].toLowerCase() === emailPart) {
            return { suggestions: [], hint: '<role: ' + USER_ROLES.join(' | ') + '>' };
          }
          return { suggestions: matchingUsers, hint: '' };
        }
        if (parts.length === 3) {
          const rolePart = parts[2].toLowerCase();
          const matchingRoles = USER_ROLES.filter(r => r.startsWith(rolePart));
          return { suggestions: matchingRoles, hint: '' };
        }
      }

      // user_active <email> <true|false>
      if (cmd === 'user_active' || cmd === 'user_simple' || cmd === 'user_dealer') {
        if (parts.length === 2) {
          const emailPart = parts[1].toLowerCase();
          const matchingUsers = users
            .filter(u => u.email.toLowerCase().includes(emailPart) || (u.displayName?.toLowerCase().includes(emailPart)))
            .map(u => u.email)
            .slice(0, 5);
          
          if (matchingUsers.length === 1 && matchingUsers[0].toLowerCase() === emailPart) {
            return { suggestions: [], hint: '<true | false>' };
          }
          return { suggestions: matchingUsers, hint: '' };
        }
        if (parts.length === 3) {
          const boolPart = parts[2].toLowerCase();
          const matchingBools = ['true', 'false'].filter(b => b.startsWith(boolPart));
          return { suggestions: matchingBools, hint: '' };
        }
      }

      // user_create <email> <role>
      if (cmd === 'user_create') {
        if (parts.length === 2) {
          return { suggestions: [], hint: '<role: ' + USER_ROLES.join(' | ') + '>' };
        }
        if (parts.length === 3) {
          const rolePart = parts[2].toLowerCase();
          const matchingRoles = USER_ROLES.filter(r => r.startsWith(rolePart));
          return { suggestions: matchingRoles, hint: '' };
        }
      }
    }

    // Connect command autocomplete - available for all users
    if (cmd === 'connect' && parts.length === 2) {
      const idPart = parts[1].toLowerCase();
      if (idPart.length >= 2 && allDeviceIds.length > 0) {
        const matchingDevices = allDeviceIds
          .filter(did => {
            const idMatch = did.toLowerCase().includes(idPart);
            const comment = allDeviceComments[did] || '';
            const commentMatch = comment.toLowerCase().includes(idPart);
            return idMatch || commentMatch;
          })
          .slice(0, 8);
        
        if (matchingDevices.length > 0 && matchingDevices.length < 10) {
          return { suggestions: matchingDevices, hint: '' };
        }
      }
    }

    // Chart command autocomplete - suggest timestamps
    if (cmd === 'chart' && parts.length === 2) {
      const tsPart = parts[1].toLowerCase();
      if (historicalTimestamps.length > 0) {
        const matchingTs = historicalTimestamps
          .filter(ts => {
            // Match by timestamp or formatted date
            const formatted = formatTimestampForDisplay(ts).toLowerCase();
            return ts.includes(tsPart) || formatted.includes(tsPart);
          })
          .slice(0, 8);
        
        if (matchingTs.length > 0) {
          return { suggestions: matchingTs, hint: '' };
        }
      }
      return { suggestions: [], hint: '<timestamp> (e.g., 1701234567)' };
    }

    // Preset commands autocomplete
    if ((cmd === 'preset_run' || cmd === 'preset_delete' || cmd === 'preset_show') && parts.length === 2) {
      const namePart = parts[1].toLowerCase();
      const matching = Object.keys(presets)
        .filter(name => name.toLowerCase().includes(namePart))
        .slice(0, 8);
      return { suggestions: matching, hint: '' };
    }

    // delete_param autocomplete - suggest parameter IDs
    if (cmd === 'delete_param' && parts.length === 2) {
      const term = parts[1].toLowerCase();
      const systemKeys = new Set(['id_timestamp', 'TRIG1', '__historical']);
      const availableParams = discoveredParameters.length > 0
        ? discoveredParameters.map(p => p.originalName)
        : Object.keys(currentData || {});
      const filtered = availableParams
        .filter(key => key && !key.startsWith('~~') && !systemKeys.has(key))
        .filter(key => key.toLowerCase().includes(term))
        .slice(0, 10);
      return { suggestions: filtered, hint: '' };
    }

    // Close command autocomplete
    if (cmd === 'close' && parts.length === 2) {
      const target = parts[1].toLowerCase();
      const openCharts = windowsState.charts.filter(c => c.isOpen);
      const targets = ['cards', 'chart', 'airflow', 'all'];
      
      // Add chart numbers if multiple charts open
      openCharts.forEach((_, idx) => {
        targets.push(`chart ${idx + 1}`);
      });
      
      const matching = targets.filter(t => t.startsWith(target));
      if (matching.length > 0) {
        return { suggestions: matching, hint: '' };
      }
    }

    // Min/Max command autocomplete
    if ((cmd === 'min' || cmd === 'max') && parts.length === 2) {
      const target = parts[1].toLowerCase();
      const openCharts = windowsState.charts.filter(c => c.isOpen);
      const targets = ['terminal', 'cards', 'chart', 'airflow'];
      
      // Add chart numbers if multiple charts open
      openCharts.forEach((_, idx) => {
        targets.push(`chart ${idx + 1}`);
      });
      
      const matching = targets.filter(t => t.startsWith(target));
      if (matching.length > 0) {
        return { suggestions: matching, hint: '' };
      }
    }

    // Default hint for known commands
    const cmdInfo = availableCommands.find(c => c.command === cmd);
    if (cmdInfo?.args) {
      const filledArgs = parts.length - 1;
      const remainingArgs = cmdInfo.args.slice(filledArgs);
      if (remainingArgs.length > 0) {
        return { suggestions: [], hint: remainingArgs.join(' ') };
      }
    }

    return { suggestions: [], hint: '' };
  }, [availableCommands, canUseAdminCommands, users, allDeviceIds, allDeviceComments, historicalTimestamps, windowsState.charts, formatTimestampForDisplay, discoveredParameters, currentData, presets, game2048Active, snakeActive, typingActive]);

  // Current suggestions
  const { suggestions, hint } = useMemo(() => getSuggestions(input), [getSuggestions, input]);

  // Reset selection when suggestions change
  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [suggestions.length]);

  // Track close command input and highlight target window
  useEffect(() => {
    const trimmed = input.trim().toLowerCase();
    
    // Check if input matches close command pattern
    const closeMatch = trimmed.match(/^close\s+(chart(?:\s+(\d+))?|cards|params|airflow|parameters)$/);
    
    // Reset all highlights first
    setWindowsState(prev => {
      let changed = false;
      const newState = { ...prev };
      
      // Check if any chart is highlighted
      const chartsNeedReset = prev.charts.some(c => c.isHighlighted);
      if (chartsNeedReset) {
        newState.charts = prev.charts.map(c => ({ ...c, isHighlighted: false }));
        changed = true;
      }
      
      // Check cards
      if (prev.cards.isHighlighted) {
        newState.cards = { ...prev.cards, isHighlighted: false };
        changed = true;
      }
      
      // Check airflow
      if (prev.airflow.isHighlighted) {
        newState.airflow = { ...prev.airflow, isHighlighted: false };
        changed = true;
      }
      
      // Now set the new highlight if there's a match
      if (closeMatch) {
        const target = closeMatch[1];
        const chartNumber = closeMatch[2] ? parseInt(closeMatch[2], 10) : undefined;
        
        if (target === 'cards' || target === 'params' || target === 'parameters') {
          if (prev.cards.isOpen) {
            newState.cards = { ...newState.cards, isHighlighted: true };
            changed = true;
          }
        } else if (target === 'airflow') {
          if (prev.airflow.isOpen) {
            newState.airflow = { ...newState.airflow, isHighlighted: true };
            changed = true;
          }
        } else if (target.startsWith('chart')) {
          const openCharts = prev.charts.filter(c => c.isOpen);
          if (chartNumber !== undefined) {
            // Highlight specific chart by number
            if (chartNumber >= 1 && chartNumber <= openCharts.length) {
              const chartToHighlight = openCharts[chartNumber - 1];
              newState.charts = newState.charts.map(c => 
                c.id === chartToHighlight.id ? { ...c, isHighlighted: true } : { ...c, isHighlighted: false }
              );
              changed = true;
            }
          } else if (openCharts.length === 1) {
            // Highlight the only open chart
            newState.charts = newState.charts.map(c => 
              c.isOpen ? { ...c, isHighlighted: true } : { ...c, isHighlighted: false }
            );
            changed = true;
          }
        }
      }
      
      return changed ? newState : prev;
    });
  }, [input]);

  const openWindowOrder = useMemo<WindowFocusId[]>(() => {
    const ids: WindowFocusId[] = ['terminal'];
    if (isEditorOpen) ids.push('code');
    if (windowsState.cards.isOpen) ids.push('params');
    windowsState.charts.filter(c => c.isOpen).forEach(c => ids.push(c.id));
    if (windowsState.airflow.isOpen) ids.push('airflow');

    if (tiling.openWindows.length === 0) return ids;

    const orderMap = new Map<string, number>();
    tiling.openWindows.forEach((id, idx) => orderMap.set(id, idx));
    return [...ids].sort((a, b) => {
      const ai = orderMap.get(String(a));
      const bi = orderMap.get(String(b));
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return ids.indexOf(a) - ids.indexOf(b);
    });
  }, [isEditorOpen, windowsState.cards.isOpen, windowsState.charts, windowsState.airflow.isOpen, tiling.openWindows]);

  const focusWindowById = useCallback((id: WindowFocusId) => {
    setActiveWindowId(id);
    if (id === 'terminal') {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setActiveWindowId('terminal');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!openWindowOrder.includes(activeWindowId)) {
      focusWindowById(openWindowOrder[0] ?? 'terminal');
    }
  }, [isOpen, openWindowOrder, activeWindowId, focusWindowById]);

  const closeWindowById = useCallback((id: WindowFocusId) => {
    if (id === 'terminal') {
      onClose();
      return;
    }
    if (id === 'code') {
      setIsEditorOpen(false);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    if (id === 'params') {
      setWindowsState(prev => ({
        ...prev,
        cards: { ...prev.cards, isOpen: false, isHighlighted: false },
      }));
      return;
    }
    if (id === 'airflow') {
      setWindowsState(prev => ({
        ...prev,
        airflow: { ...prev.airflow, isOpen: false, isHighlighted: false },
      }));
      return;
    }
    if (String(id).startsWith('chart')) {
      setWindowsState(prev => ({
        ...prev,
        charts: prev.charts.filter(c => c.id !== id),
      }));
    }
  }, [onClose]);

  const toggleMinimizeById = useCallback((id: WindowFocusId) => {
    if (id === 'terminal') {
      setWindowsState(prev => ({
        ...prev,
        terminal: { isMinimized: !prev.terminal.isMinimized },
      }));
      return;
    }
    if (id === 'params') {
      setWindowsState(prev => (
        prev.cards.isOpen
          ? { ...prev, cards: { ...prev.cards, isMinimized: !prev.cards.isMinimized } }
          : prev
      ));
      return;
    }
    if (id === 'airflow') {
      setWindowsState(prev => (
        prev.airflow.isOpen
          ? { ...prev, airflow: { ...prev.airflow, isMinimized: !prev.airflow.isMinimized } }
          : prev
      ));
      return;
    }
    if (String(id).startsWith('chart')) {
      setWindowsState(prev => ({
        ...prev,
        charts: prev.charts.map(c => (
          c.id === id ? { ...c, isMinimized: !c.isMinimized } : c
        )),
      }));
    }
  }, []);

  const cycleLayoutMode = useCallback(() => {
    const order: Array<'horizontal' | 'vertical' | 'grid'> = ['horizontal', 'vertical', 'grid'];
    const idx = order.indexOf(tiling.layoutMode);
    const next = order[(idx + 1) % order.length];
    tiling.setLayoutMode(next);
  }, [tiling.layoutMode, tiling.setLayoutMode]);

  const cycleFocusedWindow = useCallback((direction: 1 | -1) => {
    if (openWindowOrder.length === 0) return;
    const currentIdx = openWindowOrder.indexOf(activeWindowId);
    const baseIdx = currentIdx === -1 ? 0 : currentIdx;
    const nextIdx = (baseIdx + direction + openWindowOrder.length) % openWindowOrder.length;
    focusWindowById(openWindowOrder[nextIdx]);
  }, [openWindowOrder, activeWindowId, focusWindowById]);

  const activeWindowLabel = useMemo(() => {
    if (activeWindowId === 'terminal') return 'terminal';
    if (activeWindowId === 'code') return 'code';
    if (activeWindowId === 'params') return 'params';
    if (activeWindowId === 'airflow') return 'airflow';
    const chartIdx = openWindowOrder.filter(id => String(id).startsWith('chart')).indexOf(activeWindowId);
    if (chartIdx >= 0) return `chart ${chartIdx + 1}`;
    return String(activeWindowId);
  }, [activeWindowId, openWindowOrder]);

  // Apply suggestion
  const applySuggestion = useCallback((suggestion: string) => {
    const parts = input.trim().split(' ');
    if (parts.length === 1) {
      // Replace command
      setInput(suggestion + ' ');
    } else {
      // Replace last part
      parts[parts.length - 1] = suggestion;
      setInput(parts.join(' ') + ' ');
    }
    setSelectedSuggestionIndex(0);
    inputRef.current?.focus();
  }, [input]);

  const getDefaultRigopsMeta = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    const author = user?.displayName || user?.email || 'unknown';
    return {
      name: 'New Script',
      author,
      created: today,
      version: '1',
    };
  }, [user?.displayName, user?.email]);

  const buildDefaultRigopsTemplate = useCallback(() => {
    const meta = getDefaultRigopsMeta();
    return [
      '#rigops',
      `#version ${meta.version}`,
      `#name ${meta.name}`,
      `#author ${meta.author}`,
      `#created ${meta.created}`,
      '',
    ].join('\n');
  }, [getDefaultRigopsMeta]);

  const openEditor = useCallback((options?: { forceTemplate?: boolean }) => {
    if (options?.forceTemplate) {
      const template = buildDefaultRigopsTemplate();
      setEditorValue(template);
      setRigopsMode(true);
      setIsEditorOpen(true);
      setActiveWindowId('code');
      return;
    }
    const hasInput = Boolean(input.trim());
    const hasLast = Boolean(lastEditorScript);
    const next = hasInput
      ? input
      : hasLast ? lastEditorScript : buildDefaultRigopsTemplate();
    setEditorValue(next);
    setRigopsMode(!hasInput && !hasLast);
    setIsEditorOpen(true);
    setActiveWindowId('code');
  }, [buildDefaultRigopsTemplate, input, lastEditorScript]);

  const closeEditor = useCallback(() => {
    setIsEditorOpen(false);
    setActiveWindowId('terminal');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const applyEditor = useCallback(() => {
    setInput(editorValue);
    setLastEditorScript(editorValue);
    setIsEditorOpen(false);
    setActiveWindowId('terminal');
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [editorValue]);


  const adjustTextareaHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    const nextHeight = Math.min(el.scrollHeight, 160);
    el.style.height = `${Math.max(nextHeight, 20)}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [input, adjustTextareaHeight]);

  // Add welcome message when terminal opens
  useEffect(() => {
    if (isOpen && history.length === 0) {
      const welcomeLines: TerminalLine[] = [
        {
          type: 'info',
          content: '=== RigWatch Terminal v1.0 ===',
          timestamp: new Date()
        },
        {
          type: 'info',
          content: `Connected to device: ${deviceId || 'None'}`,
          timestamp: new Date()
        },
        {
          type: 'info',
          content: 'Type "help" for available commands.',
          timestamp: new Date()
        }
      ];

      if (canUseAdminCommands) {
        welcomeLines.push({
          type: 'info',
          content: 'Admin commands available: user_list, user_role, user_active, user_simple, user_dealer, user_create',
          timestamp: new Date()
        });
      }

      welcomeLines.push({
        type: 'info',
        content: '',
        timestamp: new Date()
      });

      setHistory(welcomeLines);
    }
  }, [isOpen, deviceId, history.length, canUseAdminCommands]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [history]);

  // Focus input when terminal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Register terminal with tiling system
  useEffect(() => {
    tiling.registerWindow('terminal');
    return () => tiling.unregisterWindow('terminal');
  }, [tiling.registerWindow, tiling.unregisterWindow]);

  // Notify tiling system when terminal opens/closes
  useEffect(() => {
    if (isOpen) {
      tiling.openWindow('terminal');
    } else {
      tiling.closeWindow('terminal');
    }
  }, [isOpen, tiling.openWindow, tiling.closeWindow]);

  // Initialize and keep the modal within viewport when opened
  useEffect(() => {
    if (!isOpen) return;
    const modal = modalRef.current;
    if (!modal) return;
    
    // Use tiling position if enabled
    if (tiling.tilingEnabled) {
      const tile = tiling.getTilePosition('terminal');
      setPosition({ x: tile.x, y: tile.y });
      setSize({ width: tile.width, height: tile.height });
      return;
    }
    
    // Otherwise use default centered position
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    // Compute initial size within viewport constraints
    const initialWidth = Math.min(960, Math.max(480, viewportWidth - 32));
    const initialHeight = Math.min(560, Math.max(360, Math.floor(viewportHeight * 0.8)));
    setSize({ width: initialWidth, height: initialHeight });
    const initialX = Math.max(8, Math.round((viewportWidth - initialWidth) / 2));
    const initialY = Math.max(16, Math.round((viewportHeight - initialHeight) / 2));
    setPosition({ x: initialX, y: initialY });
  }, [isOpen, tiling.tilingEnabled, tiling.getTilePosition, tiling.openWindows]);

  // Drag handlers
  const onHeaderMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!modalRef.current) return;
    e.preventDefault();
    const rect = modalRef.current.getBoundingClientRect();
    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setIsDragging(true);
    // Prevent text selection while dragging
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!modalRef.current) return;
      const rect = modalRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;

      const maxX = Math.max(0, viewportWidth - rect.width);
      const maxY = Math.max(0, viewportHeight - rect.height);

      const clampedX = Math.min(Math.max(0, newX), maxX);
      const clampedY = Math.min(Math.max(0, newY), maxY);
      setPosition({ x: clampedX, y: clampedY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Resize handlers
  const MIN_WIDTH = 480;
  const MIN_HEIGHT = 320;

  const beginResize = useCallback((edge: { n: boolean; s: boolean; e: boolean; w: boolean }) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    resizeStateRef.current = {
      resizing: true,
      edge,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startX: position.x,
      startY: position.y,
      startWidth: size.width,
      startHeight: size.height,
    };
    document.body.style.userSelect = 'none';
  }, [position.x, position.y, size.width, size.height]);

  useEffect(() => {
    if (!isOpen) return;

    const onMove = (e: MouseEvent) => {
      const st = resizeStateRef.current;
      if (!st.resizing) return;

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newWidth = st.startWidth;
      let newHeight = st.startHeight;
      let newX = st.startX;
      let newY = st.startY;

      const dx = e.clientX - st.startMouseX;
      const dy = e.clientY - st.startMouseY;

      if (st.edge.e) {
        newWidth = Math.max(MIN_WIDTH, Math.min(viewportWidth - newX - 8, st.startWidth + dx));
      }
      if (st.edge.s) {
        newHeight = Math.max(MIN_HEIGHT, Math.min(viewportHeight - newY - 8, st.startHeight + dy));
      }
      if (st.edge.w) {
        const maxLeft = st.startX + st.startWidth - MIN_WIDTH;
        newX = Math.max(0, Math.min(maxLeft, st.startX + dx));
        newWidth = Math.max(MIN_WIDTH, st.startWidth - (newX - st.startX));
      }
      if (st.edge.n) {
        const maxTop = st.startY + st.startHeight - MIN_HEIGHT;
        newY = Math.max(0, Math.min(maxTop, st.startY + dy));
        newHeight = Math.max(MIN_HEIGHT, st.startHeight - (newY - st.startY));
      }

      setPosition({ x: Math.round(newX), y: Math.round(newY) });
      setSize({ width: Math.round(newWidth), height: Math.round(newHeight) });
    };

    const onUp = () => {
      if (resizeStateRef.current.resizing) {
        resizeStateRef.current.resizing = false;
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isOpen]);

  const addLine = useCallback((type: TerminalLine['type'], content: string) => {
    if (scriptSilentEchoRef.current && type === 'info' && !silentInfoOverrideRef.current) {
      return;
    }
    if (trackCommandErrorsRef.current && type === 'error') {
      commandErrorRef.current = true;
    }
    setHistory(prev => [...prev, { type, content, timestamp: new Date() }]);
  }, []);

  const persistPresets = useCallback((next: Record<string, string>) => {
    setPresets(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('[Terminal] Failed to save presets:', error);
    }
  }, []);

  const sleepMs = useCallback((ms: number) => new Promise(resolve => setTimeout(resolve, ms)), []);
  const sleepCancelableMs = useCallback(async (ms: number) => {
    const endAt = Date.now() + ms;
    while (Date.now() < endAt) {
      if (scriptCancelRef.current) return false;
      const remaining = Math.max(0, endAt - Date.now());
      await sleepMs(Math.min(100, remaining));
    }
    return !scriptCancelRef.current;
  }, [sleepMs]);

  const stripQuotes = useCallback((value: string) => {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }, []);

  const isQuotedString = useCallback((value: string) => {
    const trimmed = value.trim();
    return (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"));
  }, []);

  const resolveDeviceParam = useCallback((key: string) => {
    const data = currentData || {};
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return (data as Record<string, unknown>)[key];
    }
    return undefined;
  }, [currentData]);

  const resolveVarToken = useCallback((token: string, depth = 0): unknown => {
    if (depth > 4) return undefined;
    const match = token.match(/^([a-zA-Z_]\w*)(?:\[(\d+|\$?[a-zA-Z_]\w*)\])?$/);
    if (!match) return undefined;
    const name = match[1];
    const indexRaw = match[2];
    const raw = scriptVarsRef.current[name];
    if (raw === undefined) return undefined;
    if (indexRaw === undefined) return raw;
    const indexToken = indexRaw.trim();
    let index: number;
    if (/^\d+$/.test(indexToken)) {
      index = parseInt(indexToken, 10);
    } else {
      const indexVarName = indexToken.startsWith('$') ? indexToken.slice(1) : indexToken;
      const indexVarValue = resolveVarToken(indexVarName, depth + 1);
      const parsedIndex = parseInt(String(indexVarValue ?? '').trim(), 10);
      if (!Number.isFinite(parsedIndex)) return undefined;
      index = parsedIndex;
    }
    if (!Number.isFinite(index)) return undefined;
    const trimmed = String(raw).trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed[index];
        }
      } catch {
        // ignore parse error
      }
    }
    return undefined;
  }, []);

  const interpolateVariables = useCallback((text: string) => {
    return text.replace(/[$@][a-zA-Z_][\w]*(?:\[(?:\d+|\$?[a-zA-Z_]\w*)\])?/g, (match) => {
      const key = match.slice(1);
      if (match.startsWith('$')) {
        const value = resolveVarToken(key);
        if (value === undefined) return match;
        return String(value);
      }
      const value = resolveDeviceParam(key);
      if (value === undefined || value === null) return match;
      return String(value);
    });
  }, [resolveDeviceParam, resolveVarToken]);

  const resolveConditionValue = useCallback((raw: string) => {
    const token = stripQuotes(raw);
    if (token.startsWith('$')) {
      const key = token.slice(1);
      const value = resolveVarToken(key);
      return value ?? '';
    }
    if (token.startsWith('@')) {
      const key = token.slice(1);
      const value = resolveDeviceParam(key);
      return value ?? '';
    }
    if (token.toLowerCase() === 'connected') {
      return !!deviceId && connectionStatus === 'online';
    }
    if (scriptVarsRef.current[token] !== undefined) {
      return scriptVarsRef.current[token] ?? '';
    }
    return token;
  }, [connectionStatus, deviceId, resolveDeviceParam, stripQuotes]);

  const evaluateCondition = useCallback((raw: string): boolean => {
    const trimmed = raw.trim();
    if (!trimmed) return false;
    if (trimmed.toLowerCase() === '!connected' || trimmed.toLowerCase() === 'not connected') {
      return !deviceId || connectionStatus !== 'online';
    }

    const tokenize = (input: string) => {
      const tokens: Array<{ type: 'op' | 'paren' | 'value'; value: string }> = [];
      let i = 0;
      while (i < input.length) {
        const ch = input[i];
        if (/\s/.test(ch)) {
          i += 1;
          continue;
        }
        if (ch === '(' || ch === ')') {
          tokens.push({ type: 'paren', value: ch });
          i += 1;
          continue;
        }
        const two = input.slice(i, i + 2);
        if (two === '&&' || two === '||' || two === '==' || two === '!=' || two === '>=' || two === '<=') {
          tokens.push({ type: 'op', value: two });
          i += 2;
          continue;
        }
        if (ch === '!' || ch === '>' || ch === '<') {
          tokens.push({ type: 'op', value: ch });
          i += 1;
          continue;
        }
        if (ch === '"' || ch === '\'') {
          const quote = ch;
          let j = i + 1;
          let escaped = false;
          while (j < input.length) {
            const curr = input[j];
            if (escaped) {
              escaped = false;
              j += 1;
              continue;
            }
            if (curr === '\\') {
              escaped = true;
              j += 1;
              continue;
            }
            if (curr === quote) {
              j += 1;
              break;
            }
            j += 1;
          }
          if (j > input.length) return null;
          tokens.push({ type: 'value', value: input.slice(i, j) });
          i = j;
          continue;
        }
        let j = i;
        while (j < input.length && !/\s/.test(input[j]) && !['(', ')', '&', '|', '!', '=', '>', '<'].includes(input[j])) {
          j += 1;
        }
        tokens.push({ type: 'value', value: input.slice(i, j) });
        i = j;
      }
      return tokens;
    };

    const tokens = tokenize(trimmed);
    if (!tokens) return false;
    let index = 0;
    let hadError = false;

    const toBoolean = (value: unknown) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      const text = String(value ?? '').trim().toLowerCase();
      if (!text) return false;
      if (text === 'false' || text === '0' || text === 'no' || text === 'off') return false;
      return true;
    };

    const compareValues = (left: unknown, op: string, right: unknown) => {
      const leftNum = Number.isFinite(Number(left)) ? Number(left) : null;
      const rightNum = Number.isFinite(Number(right)) ? Number(right) : null;
      const useNumber = leftNum !== null && rightNum !== null;
      if (op === '==') {
        return useNumber ? leftNum === rightNum : String(left) === String(right);
      }
      if (op === '!=') {
        return useNumber ? leftNum !== rightNum : String(left) !== String(right);
      }
      if (!useNumber) {
        const l = String(left);
        const r = String(right);
        if (op === '>') return l > r;
        if (op === '<') return l < r;
        if (op === '>=') return l >= r;
        if (op === '<=') return l <= r;
        return false;
      }
      if (op === '>') return leftNum! > rightNum!;
      if (op === '<') return leftNum! < rightNum!;
      if (op === '>=') return leftNum! >= rightNum!;
      if (op === '<=') return leftNum! <= rightNum!;
      return false;
    };

    const parsePrimaryValue = (): unknown => {
      const token = tokens[index];
      if (!token) {
        hadError = true;
        return '';
      }
      if (token.type === 'paren' && token.value === '(') {
        index += 1;
        const value = parseOr();
        const next = tokens[index];
        if (!next || next.type !== 'paren' || next.value !== ')') {
          hadError = true;
          return false;
        }
        index += 1;
        return value;
      }
      if (token.type === 'value') {
        index += 1;
        return resolveConditionValue(token.value);
      }
      hadError = true;
      return '';
    };

    const parseComparison = (): boolean => {
      const left = parsePrimaryValue();
      if (hadError) return false;
      const token = tokens[index];
      if (token && token.type === 'op' && ['==', '!=', '>=', '<=', '>', '<'].includes(token.value)) {
        index += 1;
        const right = parsePrimaryValue();
        if (hadError) return false;
        return compareValues(left, token.value, right);
      }
      return toBoolean(left);
    };

    const parseUnary = (): boolean => {
      const token = tokens[index];
      if (token && token.type === 'op' && token.value === '!') {
        index += 1;
        return !parseUnary();
      }
      return parseComparison();
    };

    const parseAnd = (): boolean => {
      let value = parseUnary();
      while (!hadError && tokens[index]?.type === 'op' && tokens[index]?.value === '&&') {
        index += 1;
        const rhs = parseUnary();
        value = value && rhs;
      }
      return value;
    };

    const parseOr = (): boolean => {
      let value = parseAnd();
      while (!hadError && tokens[index]?.type === 'op' && tokens[index]?.value === '||') {
        index += 1;
        const rhs = parseAnd();
        value = value || rhs;
      }
      return value;
    };

    const result = parseOr();
    if (hadError || index < tokens.length) return false;
    return result;
  }, [connectionStatus, deviceId, resolveConditionValue]);

  const parseBlockAt = useCallback((raw: string, startBrace: number): { body: string; endIndex: number } => {
    let depth = 0;
    let inString: '"' | '\'' | null = null;
    let escaped = false;
    for (let i = startBrace; i < raw.length; i += 1) {
      const ch = raw[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        continue;
      }
      if (ch === '"' || ch === '\'') {
        inString = ch;
        escaped = false;
        continue;
      }
      if (ch === '{') depth += 1;
      if (ch === '}') depth -= 1;
      if (depth === 0) {
        return { body: raw.slice(startBrace + 1, i), endIndex: i };
      }
      if (depth < 0) {
        return { body: '', endIndex: -1 };
      }
    }
    return { body: '', endIndex: -1 };
  }, []);

  const parseIfCommand = useCallback((raw: string): { condition: string; ifBody: string; elseBody: string; error?: string } => {
    const trimmed = raw.trim();
    if (!/^if\s+/i.test(trimmed)) {
      return { condition: '', ifBody: '', elseBody: '', error: 'Usage: if <condition> { ... } else { ... }' };
    }

    const ifStart = trimmed.toLowerCase().indexOf('if');
    const firstBrace = trimmed.indexOf('{', ifStart + 2);
    if (firstBrace === -1) {
      return { condition: '', ifBody: '', elseBody: '', error: 'Syntax error: missing "{" after if condition' };
    }

    const condition = trimmed.slice(ifStart + 2, firstBrace).trim();
    const ifBlock = parseBlockAt(trimmed, firstBrace);
    if (ifBlock.endIndex === -1) {
      return { condition: '', ifBody: '', elseBody: '', error: 'Syntax error: unmatched "}" in if block' };
    }

    let cursor = ifBlock.endIndex + 1;
    while (cursor < trimmed.length && /\s/.test(trimmed[cursor])) cursor += 1;

    let elseBody = '';
    if (trimmed.slice(cursor).toLowerCase().startsWith('else')) {
      cursor += 4;
      while (cursor < trimmed.length && /\s/.test(trimmed[cursor])) cursor += 1;
      const afterElse = trimmed.slice(cursor);
      // else if cond { ... } else { ... } — run remainder as nested if
      if (/^if\s+/i.test(afterElse)) {
        elseBody = afterElse.trim();
      } else if (trimmed[cursor] === '{') {
        const elseBlock = parseBlockAt(trimmed, cursor);
        if (elseBlock.endIndex === -1) {
          return { condition: '', ifBody: '', elseBody: '', error: 'Syntax error: unmatched "}" in else block' };
        }
        elseBody = elseBlock.body.trim();
      } else {
        return { condition: '', ifBody: '', elseBody: '', error: 'Syntax error: expected "{" after else' };
      }
    }

    return { condition, ifBody: ifBlock.body.trim(), elseBody };
  }, [parseBlockAt]);

  const parseTryCommand = useCallback((raw: string): { tryBody: string; catchBody: string; error?: string } => {
    const trimmed = raw.trim();
    if (!/^try\s*/i.test(trimmed)) {
      return { tryBody: '', catchBody: '', error: 'Usage: try { ... } catch { ... }' };
    }
    const tryStart = trimmed.toLowerCase().indexOf('try');
    const firstBrace = trimmed.indexOf('{', tryStart + 3);
    if (firstBrace === -1) {
      return { tryBody: '', catchBody: '', error: 'Syntax error: missing "{" after try' };
    }
    const tryBlock = parseBlockAt(trimmed, firstBrace);
    if (tryBlock.endIndex === -1) {
      return { tryBody: '', catchBody: '', error: 'Syntax error: unmatched "}" in try block' };
    }
    let cursor = tryBlock.endIndex + 1;
    const rest = trimmed.slice(cursor).trim();
    if (!rest.toLowerCase().startsWith('catch')) {
      return { tryBody: '', catchBody: '', error: 'Syntax error: missing "catch" after try block' };
    }
    const catchIndex = trimmed.toLowerCase().indexOf('catch', cursor);
    const catchBrace = trimmed.indexOf('{', catchIndex + 5);
    if (catchBrace === -1) {
      return { tryBody: '', catchBody: '', error: 'Syntax error: missing "{" after catch' };
    }
    const catchBlock = parseBlockAt(trimmed, catchBrace);
    if (catchBlock.endIndex === -1) {
      return { tryBody: '', catchBody: '', error: 'Syntax error: unmatched "}" in catch block' };
    }
    return { tryBody: tryBlock.body.trim(), catchBody: catchBlock.body.trim() };
  }, [parseBlockAt]);

  const parseListItems = useCallback((raw: string) => {
    const items: string[] = [];
    let buffer = '';
    let inString: '"' | '\'' | null = null;
    let escaped = false;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (inString) {
        buffer += ch;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        continue;
      }
      if (ch === '"' || ch === '\'') {
        inString = ch;
        buffer += ch;
        continue;
      }
      if (ch === ',') {
        const trimmedItem = buffer.trim();
        if (trimmedItem) items.push(trimmedItem);
        buffer = '';
        continue;
      }
      buffer += ch;
    }
    const trimmedItem = buffer.trim();
    if (trimmedItem) items.push(trimmedItem);
    return items;
  }, []);

  const formatLogTimestamp = useCallback((timestamp: Date) => {
    return timestamp.toLocaleString('de-DE', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, []);

  const resolveListItem = useCallback((item: string) => {
    if (item.startsWith('$')) {
      const key = item.slice(1);
      return resolveVarToken(key) ?? '';
    }
    if (item.startsWith('@')) {
      const key = item.slice(1);
      const value = resolveDeviceParam(key);
      return value === undefined || value === null ? '' : String(value);
    }
    if (isQuotedString(item)) {
      return stripQuotes(item);
    }
    return item;
  }, [isQuotedString, resolveDeviceParam, resolveVarToken, stripQuotes]);

  const normalizeListValues = useCallback((rawValue: unknown): string[] => {
    if (rawValue === undefined || rawValue === null) return [];
    if (Array.isArray(rawValue)) {
      return rawValue.map(item => String(item).trim()).filter(Boolean);
    }
    const text = String(rawValue).trim();
    if (!text) return [];
    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          return parsed.map(item => String(item).trim()).filter(Boolean);
        }
      } catch {
        // Fall back to lightweight parser below
      }
      return parseListItems(text.slice(1, -1))
        .map(entry => String(resolveListItem(entry)).trim())
        .filter(Boolean);
    }
    if (text.includes(',')) {
      return parseListItems(text)
        .map(entry => String(resolveListItem(entry)).trim())
        .filter(Boolean);
    }
    const single = String(resolveListItem(text)).trim();
    return single ? [single] : [];
  }, [parseListItems, resolveListItem]);

  const parseTokenList = useCallback((tokenRaw: string): string[] => {
    const token = tokenRaw.trim();
    if (!token) return [];
    const lowerToken = token.toLowerCase();
    if (lowerToken === 'all' || lowerToken === '*' || lowerToken === 'all_devices') {
      return allDeviceIds;
    }
    if (token.startsWith('$')) {
      return normalizeListValues(resolveVarToken(token.slice(1)));
    }
    if (token.startsWith('@')) {
      return normalizeListValues(resolveDeviceParam(token.slice(1)));
    }
    return normalizeListValues(token);
  }, [allDeviceIds, normalizeListValues, resolveDeviceParam, resolveVarToken]);

  const evaluateMathExpression = useCallback((rawExpression: string): { value?: number; error?: string } => {
    const expr = rawExpression.trim();
    if (!expr) return { error: 'Expression is empty' };

    const tokens: Array<{ type: 'num' | 'op' | 'paren'; value: string }> = [];
    let i = 0;
    let prevType: 'start' | 'num' | 'op' | 'paren_open' | 'paren_close' = 'start';

    const pushNumber = (rawNum: string) => {
      const value = Number(rawNum);
      if (!Number.isFinite(value)) return false;
      tokens.push({ type: 'num', value: String(value) });
      prevType = 'num';
      return true;
    };

    while (i < expr.length) {
      const ch = expr[i];
      if (/\s/.test(ch)) {
        i += 1;
        continue;
      }

      if (ch === '(') {
        tokens.push({ type: 'paren', value: ch });
        prevType = 'paren_open';
        i += 1;
        continue;
      }
      if (ch === ')') {
        tokens.push({ type: 'paren', value: ch });
        prevType = 'paren_close';
        i += 1;
        continue;
      }

      if ('+-*/%'.includes(ch)) {
        const isUnaryMinus = ch === '-' && (prevType === 'start' || prevType === 'op' || prevType === 'paren_open');
        if (isUnaryMinus) {
          const next = expr[i + 1] ?? '';
          if (/\d|\./.test(next)) {
            let j = i + 1;
            while (j < expr.length && /[\d.]/.test(expr[j])) j += 1;
            const rawNum = '-' + expr.slice(i + 1, j);
            if (!pushNumber(rawNum)) return { error: `Invalid number: ${rawNum}` };
            i = j;
            continue;
          }
          tokens.push({ type: 'num', value: '0' });
          tokens.push({ type: 'op', value: '-' });
          prevType = 'op';
          i += 1;
          continue;
        }
        tokens.push({ type: 'op', value: ch });
        prevType = 'op';
        i += 1;
        continue;
      }

      if (/\d|\./.test(ch)) {
        let j = i;
        while (j < expr.length && /[\d.]/.test(expr[j])) j += 1;
        const rawNum = expr.slice(i, j);
        if (!pushNumber(rawNum)) return { error: `Invalid number: ${rawNum}` };
        i = j;
        continue;
      }

      return { error: `Unsupported token: "${ch}"` };
    }

    if (tokens.length === 0) return { error: 'Expression is empty' };

    const precedence = (op: string) => (op === '+' || op === '-') ? 1 : 2;
    const output: Array<{ type: 'num' | 'op'; value: string }> = [];
    const operators: string[] = [];

    for (const token of tokens) {
      if (token.type === 'num') {
        output.push({ type: 'num', value: token.value });
        continue;
      }
      if (token.type === 'op') {
        while (operators.length > 0) {
          const top = operators[operators.length - 1];
          if (top === '(') break;
          if (precedence(top) >= precedence(token.value)) {
            output.push({ type: 'op', value: operators.pop()! });
            continue;
          }
          break;
        }
        operators.push(token.value);
        continue;
      }
      if (token.value === '(') {
        operators.push(token.value);
        continue;
      }
      if (token.value === ')') {
        let matched = false;
        while (operators.length > 0) {
          const top = operators.pop()!;
          if (top === '(') {
            matched = true;
            break;
          }
          output.push({ type: 'op', value: top });
        }
        if (!matched) return { error: 'Mismatched parentheses' };
      }
    }

    while (operators.length > 0) {
      const top = operators.pop()!;
      if (top === '(' || top === ')') return { error: 'Mismatched parentheses' };
      output.push({ type: 'op', value: top });
    }

    const stack: number[] = [];
    for (const token of output) {
      if (token.type === 'num') {
        stack.push(Number(token.value));
        continue;
      }
      if (stack.length < 2) return { error: 'Invalid expression' };
      const right = stack.pop()!;
      const left = stack.pop()!;
      let result: number;
      switch (token.value) {
        case '+':
          result = left + right;
          break;
        case '-':
          result = left - right;
          break;
        case '*':
          result = left * right;
          break;
        case '/':
          if (right === 0) return { error: 'Division by zero' };
          result = left / right;
          break;
        case '%':
          if (right === 0) return { error: 'Modulo by zero' };
          result = left % right;
          break;
        default:
          return { error: `Unsupported operator: ${token.value}` };
      }
      stack.push(result);
    }

    if (stack.length !== 1 || !Number.isFinite(stack[0])) return { error: 'Invalid expression' };
    return { value: stack[0] };
  }, []);

  const parseCollectLiteral = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (isQuotedString(trimmed)) return stripQuotes(trimmed);
    const lowered = trimmed.toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) return asNumber;
    return trimmed;
  }, [isQuotedString, stripQuotes]);

  const evaluateCollectCondition = useCallback((row: Record<string, string>, rawCondition: string): { pass: boolean; error?: string } => {
    const condition = rawCondition.trim();
    if (!condition) {
      return { pass: false, error: 'Where condition is empty' };
    }

    const tokenize = (input: string) => {
      const tokens: Array<{ type: 'op' | 'paren' | 'value'; value: string }> = [];
      let i = 0;
      while (i < input.length) {
        const ch = input[i];
        if (/\s/.test(ch)) {
          i += 1;
          continue;
        }
        if (ch === '(' || ch === ')') {
          tokens.push({ type: 'paren', value: ch });
          i += 1;
          continue;
        }
        const two = input.slice(i, i + 2);
        if (two === '&&' || two === '||' || two === '==' || two === '!=' || two === '>=' || two === '<=') {
          tokens.push({ type: 'op', value: two });
          i += 2;
          continue;
        }
        if (ch === '!' || ch === '>' || ch === '<') {
          tokens.push({ type: 'op', value: ch });
          i += 1;
          continue;
        }
        if (ch === '"' || ch === '\'') {
          const quote = ch;
          let j = i + 1;
          let escaped = false;
          while (j < input.length) {
            const curr = input[j];
            if (escaped) {
              escaped = false;
              j += 1;
              continue;
            }
            if (curr === '\\') {
              escaped = true;
              j += 1;
              continue;
            }
            if (curr === quote) {
              j += 1;
              break;
            }
            j += 1;
          }
          tokens.push({ type: 'value', value: input.slice(i, j) });
          i = j;
          continue;
        }
        let j = i;
        while (j < input.length && !/\s/.test(input[j]) && !['(', ')', '&', '|', '!', '=', '>', '<'].includes(input[j])) {
          j += 1;
        }
        tokens.push({ type: 'value', value: input.slice(i, j) });
        i = j;
      }
      return tokens;
    };

    const resolveCollectValue = (tokenRaw: string): unknown => {
      const token = tokenRaw.trim();
      if (!token) return '';
      if (token.startsWith('@')) {
        const key = token.slice(1);
        const value = row[key];
        if (value === undefined || value === null || value === 'n/a') return '';
        return parseCollectLiteral(String(value));
      }
      if (Object.prototype.hasOwnProperty.call(row, token)) {
        const value = row[token];
        if (value === undefined || value === null || value === 'n/a') return '';
        return parseCollectLiteral(String(value));
      }
      return parseCollectLiteral(token);
    };

    const toBoolean = (value: unknown) => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      const text = String(value ?? '').trim().toLowerCase();
      if (!text) return false;
      if (text === 'false' || text === '0' || text === 'no' || text === 'off' || text === 'n/a') return false;
      return true;
    };

    const compareValues = (left: unknown, op: string, right: unknown) => {
      const leftNum = Number.isFinite(Number(left)) ? Number(left) : null;
      const rightNum = Number.isFinite(Number(right)) ? Number(right) : null;
      const useNumber = leftNum !== null && rightNum !== null;
      if (op === '==') return useNumber ? leftNum === rightNum : String(left) === String(right);
      if (op === '!=') return useNumber ? leftNum !== rightNum : String(left) !== String(right);
      if (useNumber) {
        if (op === '>') return leftNum! > rightNum!;
        if (op === '<') return leftNum! < rightNum!;
        if (op === '>=') return leftNum! >= rightNum!;
        if (op === '<=') return leftNum! <= rightNum!;
        return false;
      }
      const l = String(left);
      const r = String(right);
      if (op === '>') return l > r;
      if (op === '<') return l < r;
      if (op === '>=') return l >= r;
      if (op === '<=') return l <= r;
      return false;
    };

    const tokens = tokenize(condition);
    let index = 0;
    let hadError = false;

    const parsePrimaryValue = (): unknown => {
      const token = tokens[index];
      if (!token) {
        hadError = true;
        return '';
      }
      if (token.type === 'paren' && token.value === '(') {
        index += 1;
        const value = parseOr();
        const next = tokens[index];
        if (!next || next.type !== 'paren' || next.value !== ')') {
          hadError = true;
          return false;
        }
        index += 1;
        return value;
      }
      if (token.type === 'value') {
        index += 1;
        return resolveCollectValue(token.value);
      }
      hadError = true;
      return '';
    };

    const parseComparison = (): boolean => {
      const left = parsePrimaryValue();
      if (hadError) return false;
      const token = tokens[index];
      if (token && token.type === 'op' && ['==', '!=', '>=', '<=', '>', '<'].includes(token.value)) {
        index += 1;
        const right = parsePrimaryValue();
        if (hadError) return false;
        return compareValues(left, token.value, right);
      }
      return toBoolean(left);
    };

    const parseUnary = (): boolean => {
      const token = tokens[index];
      if (token && token.type === 'op' && token.value === '!') {
        index += 1;
        return !parseUnary();
      }
      return parseComparison();
    };

    const parseAnd = (): boolean => {
      let value = parseUnary();
      while (!hadError && tokens[index]?.type === 'op' && tokens[index]?.value === '&&') {
        index += 1;
        const rhs = parseUnary();
        value = value && rhs;
      }
      return value;
    };

    const parseOr = (): boolean => {
      let value = parseAnd();
      while (!hadError && tokens[index]?.type === 'op' && tokens[index]?.value === '||') {
        index += 1;
        const rhs = parseAnd();
        value = value || rhs;
      }
      return value;
    };

    const pass = parseOr();
    if (hadError || index < tokens.length) {
      return { pass: false, error: 'Invalid where condition. Example: (T > 50 && PL < 50) || T == 0' };
    }
    return { pass };
  }, [parseCollectLiteral]);

  const parseDurationMs = useCallback((raw: string): number | null => {
    const trimmed = raw.trim();
    const match = trimmed.match(/^(\d+(?:\.\d+)?)(ms|s)?$/i);
    if (!match) return null;
    const value = parseFloat(match[1]);
    const unit = (match[2] || 's').toLowerCase();
    if (Number.isNaN(value) || value < 0) return null;
    return unit === 'ms' ? value : value * 1000;
  }, []);

  const resolveFirebasePath = useCallback((rawPath: string): string | null => {
    const cleaned = stripQuotes(rawPath).trim();
    if (!cleaned) return null;
    const normalizedInput = cleaned.replace(/\\/g, '/').replace(/\/+/g, '/');
    const isAbsolute = normalizedInput.startsWith('/');
    const segments = (isAbsolute ? [] : (firebaseCwdRef.current ? firebaseCwdRef.current.split('/') : []))
      .filter(Boolean);
    const parts = normalizedInput.split('/');
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        segments.pop();
      } else {
        segments.push(part);
      }
    }
    return segments.join('/');
  }, [stripQuotes]);

  const stringifyScriptValue = useCallback((value: unknown): string => {
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    if (value === null) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }, []);

  const setScriptVarValue = useCallback((name: string | null | undefined, value: unknown) => {
    if (!name) return;
    scriptVarsRef.current[name] = stringifyScriptValue(value);
  }, [stringifyScriptValue]);

  const parseFirebaseLiteral = useCallback((raw: string): unknown => {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (isQuotedString(trimmed)) return stripQuotes(trimmed);
    const lowered = trimmed.toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
    if (lowered === 'null') return null;
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const asNumber = Number(trimmed);
      if (Number.isFinite(asNumber)) return asNumber;
    }
    const isJsonObject = trimmed.startsWith('{') && trimmed.endsWith('}');
    const isJsonArray = trimmed.startsWith('[') && trimmed.endsWith(']');
    if (isJsonObject || isJsonArray) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }, [isQuotedString, stripQuotes]);

  const formatFirebaseValuePreview = useCallback((value: unknown, maxLen = 180): string => {
    const text = stringifyScriptValue(value);
    return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
  }, [stringifyScriptValue]);

  const buildFirebaseTreeLines = useCallback((rootValue: unknown, options?: { depthLimit?: number; nodeLimit?: number }) => {
    const depthLimit = Math.max(0, Math.floor(options?.depthLimit ?? 2));
    const nodeLimit = Math.max(1, Math.floor(options?.nodeLimit ?? 200));
    const lines: string[] = [];
    let visited = 0;
    let truncated = false;

    const visitNode = (
      key: string,
      value: unknown,
      depth: number,
      prefix: string,
      isLast: boolean
    ) => {
      if (visited >= nodeLimit) {
        truncated = true;
        return;
      }
      visited += 1;

      const connector = prefix ? (isLast ? '└─ ' : '├─ ') : '';
      const nextPrefix = prefix + (prefix ? (isLast ? '   ' : '│  ') : '');
      const isObject = value !== null && typeof value === 'object';
      const linePrefix = `${prefix}${connector}${key}`;

      if (!isObject) {
        lines.push(`${linePrefix}: ${formatFirebaseValuePreview(value, 120)}`);
        return;
      }

      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b));
      const objectLabel = Array.isArray(value)
        ? `[${entries.length}]`
        : `{${entries.length}}`;
      lines.push(`${linePrefix}: ${objectLabel}`);

      if (entries.length === 0) return;
      if (depth >= depthLimit) {
        lines.push(`${nextPrefix}└─ ... depth limit reached`);
        return;
      }

      entries.forEach(([childKey, childValue], idx) => {
        visitNode(
          childKey,
          childValue,
          depth + 1,
          nextPrefix,
          idx === entries.length - 1
        );
      });
    };

    if (rootValue === null || typeof rootValue !== 'object') {
      lines.push(`value: ${formatFirebaseValuePreview(rootValue, 160)}`);
      return { lines, visited, truncated };
    }

    const rootEntries = Object.entries(rootValue as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));
    if (rootEntries.length === 0) {
      lines.push('(empty object)');
      return { lines, visited, truncated };
    }

    rootEntries.forEach(([key, value], idx) => {
      visitNode(key, value, 0, '', idx === rootEntries.length - 1);
    });

    return { lines, visited, truncated };
  }, [formatFirebaseValuePreview]);

  const splitScriptCommands = useCallback((raw: string): { parts: string[]; error?: string } => {
    const parts: string[] = [];
    let buffer = '';
    let depthBrace = 0;
    let depthBracket = 0;
    let depthParen = 0;
    let inString: '"' | '\'' | null = null;
    let escaped = false;

    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (ch === '\r') continue;

      if (inString) {
        buffer += ch;
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        continue;
      }

      if (ch === '"' || ch === '\'') {
        inString = ch;
        buffer += ch;
        continue;
      }

      if (ch === '{') depthBrace += 1;
      if (ch === '}') depthBrace -= 1;
      if (ch === '[') depthBracket += 1;
      if (ch === ']') depthBracket -= 1;
      if (ch === '(') depthParen += 1;
      if (ch === ')') depthParen -= 1;

      if (depthBrace < 0) {
        return { parts: [], error: 'Syntax error: unmatched "}"' };
      }
      if (depthBracket < 0) {
        return { parts: [], error: 'Syntax error: unmatched "]"' };
      }
      if (depthParen < 0) {
        return { parts: [], error: 'Syntax error: unmatched ")"' };
      }

      const isTopLevel = depthBrace === 0 && depthBracket === 0 && depthParen === 0;
      if ((ch === ';' || ch === '\n') && isTopLevel) {
        const remaining = raw.slice(i + 1);
        const after = remaining.replace(/^\s+/, '');
        const endsWithBlock = buffer.trim().endsWith('}');
        const hasElseAhead = after.toLowerCase().startsWith('else');
        const hasCatchAhead = after.toLowerCase().startsWith('catch');
        if (endsWithBlock && (hasElseAhead || hasCatchAhead)) {
          buffer += ' ';
          continue;
        }
        const cleaned = buffer.trim();
        if (cleaned) parts.push(cleaned);
        buffer = '';
        continue;
      }
      buffer += ch;
    }

    if (depthBrace !== 0) {
      return { parts: [], error: 'Syntax error: missing "}"' };
    }
    if (depthBracket !== 0) {
      return { parts: [], error: 'Syntax error: missing "]"' };
    }
    if (depthParen !== 0) {
      return { parts: [], error: 'Syntax error: missing ")"' };
    }

    const cleaned = buffer.trim();
    if (cleaned) parts.push(cleaned);
    return { parts };
  }, []);

  const expandScriptCommands = useCallback((raw: string, budget: { steps: number }): { commands: string[]; error?: string } => {
    const split = splitScriptCommands(raw);
    if (split.error) return { commands: [], error: split.error };

    const commands: string[] = [];
    for (const part of split.parts) {
      const repeatMatch = part.match(/^repeat\s+(\d+)\s*\{([\s\S]*)\}\s*$/i);
      if (repeatMatch) {
        const count = parseInt(repeatMatch[1], 10);
        if (!Number.isFinite(count) || count <= 0) {
          return { commands: [], error: 'Repeat count must be a positive number' };
        }
        if (count > MAX_REPEAT_COUNT) {
          return { commands: [], error: `Repeat count too large (max ${MAX_REPEAT_COUNT})` };
        }
        const body = repeatMatch[2].trim();
        if (!body) {
          return { commands: [], error: 'Repeat block cannot be empty' };
        }
        const expandedBody = expandScriptCommands(body, budget);
        if (expandedBody.error) return { commands: [], error: expandedBody.error };

        for (let i = 0; i < count; i += 1) {
          for (const cmd of expandedBody.commands) {
            commands.push(cmd);
            budget.steps += 1;
            if (budget.steps > MAX_SCRIPT_STEPS) {
              return { commands: [], error: `Script too long (max ${MAX_SCRIPT_STEPS} commands)` };
            }
          }
        }
        continue;
      }

      commands.push(part);
      budget.steps += 1;
      if (budget.steps > MAX_SCRIPT_STEPS) {
        return { commands: [], error: `Script too long (max ${MAX_SCRIPT_STEPS} commands)` };
      }
    }

    return { commands };
  }, [splitScriptCommands]);

  const parseRigopsScript = useCallback((raw: string, options?: { requireHeader?: boolean }) => {
    const warnings: string[] = [];
    const meta = { name: '', author: '', created: '', version: '' };
    const lines = raw.replace(/\r/g, '').split('\n');
    let inHeader = true;
    let firstNonEmpty = '';
    let bodyStartIndex = 0;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (!firstNonEmpty) {
        firstNonEmpty = trimmed;
      }
      if (inHeader && trimmed.startsWith('#')) {
        const match = trimmed.match(/^#([a-zA-Z_][\w]*)\s*[: ]?\s*(.*)$/);
        if (match) {
          const key = match[1].toLowerCase();
          const value = match[2].trim();
          if (key === 'rigops') {
            meta.version = meta.version || '';
          } else if (key === 'version') {
            meta.version = value;
          } else if (key === 'name') {
            meta.name = value;
          } else if (key === 'author') {
            meta.author = value;
          } else if (key === 'created') {
            meta.created = value;
          }
        }
        continue;
      }

      inHeader = false;
      bodyStartIndex = i;
      break;
    }

    const requiresHeader = options?.requireHeader === true;
    if (requiresHeader) {
      if (!firstNonEmpty || !firstNonEmpty.toLowerCase().startsWith('#rigops')) {
        warnings.push('Missing required header: #rigops');
      }
      if (!meta.version) warnings.push('Missing required metadata: #version');
      if (!meta.name) warnings.push('Missing required metadata: #name');
      if (!meta.author) warnings.push('Missing required metadata: #author');
      if (!meta.created) warnings.push('Missing required metadata: #created');
    }

    if (meta.version && meta.version !== '1') {
      warnings.push(`Unsupported version: ${meta.version} (expected 1)`);
    }
    if (meta.created && !/^\d{4}-\d{2}-\d{2}$/.test(meta.created)) {
      warnings.push('Invalid #created format (expected YYYY-MM-DD)');
    }

    const bodyLines = lines.slice(bodyStartIndex).filter(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#');
    });
    const body = bodyLines.join('\n').trim();

    const lowerBody = body.toLowerCase();
    if (/\buser_[a-z_]+\b/.test(lowerBody)) {
      warnings.push('Dangerous command detected: user_*');
    }
    if (/\bdelete_param\b/.test(lowerBody)) {
      warnings.push('Dangerous command detected: delete_param');
    }
    if (/\bupdate\b/.test(lowerBody)) {
      warnings.push('Dangerous command detected: update');
    }

    const expanded = expandScriptCommands(body, { steps: 0 });
    if (expanded.error && expanded.error.toLowerCase().includes('script too long')) {
      warnings.push(expanded.error);
    }

    return { meta, body, warnings };
  }, [expandScriptCommands]);

  const emitWarnings = useCallback((warnings: string[], prefix: string) => {
    if (warnings.length === 0) return;
    addLine('info', `${prefix} warnings:`);
    warnings.forEach(warning => {
      addLine('info', `  - ${warning}`);
    });
  }, [addLine]);

  useEffect(() => {
    if (!isEditorOpen) return;
    const firstNonEmpty = editorValue
      .replace(/\r/g, '')
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 0) || '';
    const hasHeader = firstNonEmpty.toLowerCase().startsWith('#rigops');
    if (hasHeader && !rigopsMode) {
      setRigopsMode(true);
    }
    const parsed = parseRigopsScript(editorValue, { requireHeader: rigopsMode || hasHeader });
    setRigopsMeta(parsed.meta);
    setRigopsWarnings(parsed.warnings);
    setRigopsBody(parsed.body);
  }, [editorValue, isEditorOpen, rigopsMode, parseRigopsScript]);

  const emitRigfetch = useCallback(() => {
    const logoLines = asciiLogo.replace(/\r/g, '').split('\n');
    const infoLines: string[] = [
      'RigWatch v2.0.0',
      'Developer: Vladislav Slugin',
      'Email: vladslugin987@gmail.com',
      '',
      `User: ${user?.displayName || user?.email || 'Unknown'}`,
      `Role: ${user?.role || 'Unknown'}`,
      `Connection: ${connectionStatus}`,
    ];

    if (deviceId && connectionStatus === 'online') {
      infoLines.push(`Device ID: ${deviceId}`);
      infoLines.push(`Model: ${deviceMetadata?.ofenname || deviceMetadata?.ofen || 'N/A'}`);
      if (deviceMetadata?.vers) {
        infoLines.push(`Firmware: ${deviceMetadata.vers}`);
      }
    } else {
      infoLines.push('Device: not connected');
    }

    const pad = 2;
    const logoWidth = Math.max(...logoLines.map(line => line.length), 0);
    const totalLines = Math.max(logoLines.length, infoLines.length);

    for (let i = 0; i < totalLines; i++) {
      const logo = logoLines[i] ?? '';
      const info = infoLines[i] ?? '';
      const spacer = ' '.repeat(Math.max(0, logoWidth - logo.length + pad));
      const line = `${logo}${spacer}${info}`.replace(/ /g, '\u00A0').trimEnd();
      addLine('info', line);
    }
  }, [addLine, connectionStatus, deviceId, deviceMetadata?.ofen, deviceMetadata?.ofenname, deviceMetadata?.vers, user?.displayName, user?.email, user?.role]);

  const executeSingleCommandRef = useRef<((command: string, options?: { silentHistory?: boolean; silentEcho?: boolean }) => Promise<boolean>) | null>(null);

  const executeSingleCommand = useCallback(async (command: string, options?: { silentHistory?: boolean; silentEcho?: boolean }): Promise<boolean> => {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) return true;

    const rawCommand = trimmedCommand;
    const resolvedCommand = interpolateVariables(trimmedCommand);
    const rawParts = rawCommand.trim().split(/\s+/).filter(Boolean);
    const resolvedParts = resolvedCommand.trim().split(/\s+/).filter(Boolean);
    const cmd = (rawParts[0] || '').toLowerCase();
    const isBlockCommand = cmd === 'if' || cmd === 'while' || cmd === 'for' || cmd === 'try';

    const silentEcho = options?.silentEcho ?? scriptSilentEchoRef.current;
    if (!silentEcho) {
      addLine('command', `$ ${isBlockCommand ? rawCommand : resolvedCommand}`);
    }

    if (!options?.silentHistory) {
      setCommandHistory(prev => {
        const updated = [trimmedCommand, ...prev.filter(cmd => cmd !== trimmedCommand)];
        return updated.slice(0, 50); // Keep last 50 commands
      });
    }

    // Variable probe mode: entering only "$var" prints value (no unknown command error).
    if (rawParts.length === 1 && rawParts[0].startsWith('$')) {
      const token = rawParts[0];
      const value = resolveVarToken(token);
      if (value === undefined) {
        addLine('info', `Variable not found: ${token.slice(1)}`);
      } else {
        addLine('output', `${token} = ${stringifyScriptValue(value)}`);
      }
      return true;
    }

    // Parse command
    const parts = resolvedParts;

    const previousTracking = trackCommandErrorsRef.current;
    trackCommandErrorsRef.current = true;
    commandErrorRef.current = false;

    try {
      switch (cmd) {
        case 'help':
          addLine('info', 'Available commands:');
          addLine('info', '  connect <device_id>      - Connect to device');
          addLine('info', '  disconnect               - Disconnect from current device');
          addLine('info', '  undo [count]             - Undo last reversible change(s)');
          addLine('info', '  set <parameter> <value>  - Set parameter value');
          addLine('info', '  get <param> [as <var>]    - Read parameter value');
          addLine('info', '  read <param> <var>        - Read parameter into variable');
          addLine('info', '  collect from <ids|all> params <params> [where <cond>] [as <var>] - Read many devices');
          addLine('info', '  collect params <params> [as <var>] - Read current connected device');
          addLine('info', '  collect_cache [clear]    - Show or clear collect cache');
            addLine('info', '  fb_cd <path>             - Change Firebase working path');
            addLine('info', '  fb_pwd                   - Show Firebase working path');
          addLine('info', '  update <filename>        - Update with alternative file');
          addLine('info', '  wait_param <param> [timeout] [interval] - Wait for parameter');
          addLine('info', '  log_save [filename]       - Save terminal log');
          addLine('info', '  help                     - Show this help');
          addLine('info', '  clear                    - Clear terminal');
          addLine('info', '  device                   - Show device info');
          addLine('info', '  status                   - Show connection status');
          addLine('info', '');
          addLine('info', '--- Script Commands ---');
          addLine('info', '  sleep <duration>         - Pause (e.g., 2s, 500ms)');
          addLine('info', '  wait <duration>          - Alias for sleep');
          addLine('info', '  log_save [filename]       - Save terminal log');
          addLine('info', '  repeat N { ... }          - Repeat a block (N max 50; expanded max 200 cmds)');
          addLine('info', '  preset_save <name> { ... } - Save a script preset');
          addLine('info', '  preset_run <name>         - Run a saved preset');
          addLine('info', '  preset_list               - List presets');
          addLine('info', '  preset_show <name>        - Show preset body');
          addLine('info', '  preset_delete <name>      - Delete a preset');
          addLine('info', '  log <message>             - Print a note line');
          addLine('info', '  assert_connected          - Stop script if no device');
          addLine('info', '  script_status             - Show script progress');
          addLine('info', '  let <name> <value>         - Set script variable');
          addLine('info', '  calc <expr> [as <var>]     - Evaluate math expression');
          addLine('info', '  let <name> = @param        - Read device parameter');
          addLine('info', '  let <name> = get.<param>   - Read device parameter');
          addLine('info', '  let <name> = [a,b,c]       - Array/list literal');
          addLine('info', '  unset <name>               - Remove script variable');
          addLine('info', '  vars                        - List script variables');
          addLine('info', '  if <cond> { ... } else { ... } - Conditional block (connected/not connected)');
          addLine('info', '  try { ... } catch { ... } - Handle errors inside a block');
          addLine('info', '  while <cond> { ... }        - Loop while condition is true');
          addLine('info', '  for <var> in 1..3 { ... }   - Numeric range loop (max 5000 iter)');
          addLine('info', '  for <var> in [a,b,c] { ... } - List literal loop');
          addLine('info', '  for <var> in $listVar { ... } - Loop over variable (JSON list / e.g. fb_keys)');
          addLine('info', '  break / continue            - Control loop flow');
          addLine('info', '  substr <value> <start> <length> as <var> - Slice value to variable');
          addLine('info', '  code                        - Open script editor');
          addLine('info', '  Conditions: == != > < >= <= && || !, use $var and @param');
          addLine('info', '');
          addLine('info', '--- Data Commands ---');
          addLine('info', '  cards                    - Open parameter cards viewer');
          addLine('info', '  chart [timestamp]        - Open chart (realtime or historical)');
          addLine('info', '  luftstrom                - Open air flow diagram (same window as airflow)');
          addLine('info', '  close <cards|params|chart|chart N|airflow|luftstrom|all> - Close window(s)');
          addLine('info', '  min <terminal|cards|chart|chart N|airflow|luftstrom> - Minimize');
          addLine('info', '  max <terminal|cards|chart|chart N|airflow|luftstrom> - Restore/maximize');
          addLine('info', '  tile [on|off|h|v|grid]   - Control tiling mode');
          addLine('info', '  opacity [0.1-1.0]        - Set window transparency');
          addLine('info', '  stove_status [dur] [int] - Show stove status (dur=seconds, int=interval)');
          addLine('info', '  stop                     - Stop stove_status monitoring / cancel script');
          addLine('info', '  d [true|false]           - Toggle/set Alle Werte mode');
          addLine('info', '  k [true|false]           - Toggle/set Nur App-Werte mode');
          addLine('info', '  errors [first|last] [n]  - Show Fehlerlisten (PL/SL + all)');
          addLine('info', '  snake                    - Play Snake (ASCII)');
          addLine('info', '  type_race                - Type 10 words fast');
          addLine('info', '  2048                     - Play 2048 (ASCII)');
          addLine('info', '  rigfetch               - Show RigWatch system info');
          
          if (canUseAdminCommands) {
            addLine('info', '');
            addLine('info', '--- Admin Commands (super_admin/developer only) ---');
            addLine('info', '  user_list                       - List all users');
            addLine('info', '  user_role <email> <role>        - Change user role');
            addLine('info', '  user_active <email> <bool>      - Activate/deactivate user');
            addLine('info', '  user_simple <email> <bool>      - Toggle Simple Mode');
            addLine('info', '  user_dealer <email> <bool>      - Toggle dealer route mode');
            addLine('info', '  user_create <email> <role>      - Create new user');
            addLine('info', '  delete_param <paramId>          - Delete parameter from device');
            addLine('info', '  fb_get <path> [as <var>]        - Read Firebase value');
            addLine('info', '  fb_exists <path> [as <var>]     - Check Firebase path');
            addLine('info', '  fb_keys <path> [shallow] [prefix <t>] [as <var>] - shallow=schnell');
            addLine('info', '  fb_tree [path] [depth N] [limit N] - Recursive tree view');
            addLine('info', '  fb_set <path> <value>           - Write Firebase value');
            addLine('info', '  fb_update <path> <json>         - Partial object update');
            addLine('info', '  fb_remove <path> confirm        - Delete Firebase path');
            addLine('info', '  fb_copy <from> -> <to> [if_missing] - Copy value');
            addLine('info', '  temp_clear confirm          - Delete ALL /temporaer/<deviceId> (dangerous)');
            addLine('info', '');
            addLine('info', 'Roles: ' + USER_ROLES.join(', '));
          }
          
          addLine('info', '');
          addLine('info', 'Examples:');
          addLine('info', '  connect ABC123');
          addLine('info', '  disconnect');
          addLine('info', '  set use_fixed_tsoll true');
          addLine('info', '  set rl_position 78');
          addLine('info', '  get T as temp');
          addLine('info', '  collect from [A,B,C] params [T,PL]');
          addLine('info', '  collect from all params [T,PL]');
          addLine('info', '  collect from all params [T,PL] where T > 70');
          addLine('info', '  collect from all params [T,PL] where T > 50 && PL < 50');
          addLine('info', '  collect from $ids params [T,PL] as rows');
          addLine('info', '  collect params [T,PL] as currentRow');
          addLine('info', '  collect_cache clear');
          addLine('info', '  fb_cd /konstant_app/1000028300033490000033');
          addLine('info', '  fb_pwd');
          addLine('info', '  fb_tree depth 2');
          addLine('info', '  if @T > 70 && connected { log "Hot" }');
          addLine('info', '  try { set rl_position 80 } catch { log "Set failed" }');
          addLine('info', '  update firmware_v2.bin');
          addLine('info', '  wait_param T 10s 500ms');
          addLine('info', '  log_save session_1.txt');
          addLine('info', '  sleep 2s');
          addLine('info', '  repeat 3 { set rl_position 40; wait 500ms }');
          addLine('info', '  preset_save warmup { set use_fixed_tsoll true; sleep 2s; set rl_position 78 }');
          addLine('info', '  preset_run warmup');
          addLine('info', '  log "Starting warmup"');
          addLine('info', '  assert_connected');
          addLine('info', '  script_status');
          addLine('info', '  code');
          addLine('info', '  let mode "auto"');
          addLine('info', '  let temp = @T');
          addLine('info', '  calc ($temp + 5) * 1.8 + 32 as tempF');
          addLine('info', '  let temp = get.T');
          addLine('info', '  let ids = [A,B,C]');
          addLine('info', '  let first = $ids[0]');
          addLine('info', '  substr 1000028300033490000033 0 7 as ofen');
          addLine('info', '  fb_keys /konstant_app as ids');
          addLine('info', '  for id in $ids { log "$id" }');
          addLine('info', '  for id in $ids { connect $id; wait 2s; disconnect }');
          addLine('info', '  if $mode == "auto" { log "Auto mode" } else { log "Manual mode" }');
          addLine('info', '  if not connected { log "Offline" } else { log "Online" }');
          addLine('info', '  while connected { log "tick"; wait 1s }');
          addLine('info', '  for i in 1..3 { log "Loop $i"; wait 500ms }');
          addLine('info', '  for id in [A,B,C] { connect $id; wait 2s; disconnect }');
          addLine('info', '  for i in 1..5 { if $i == 3 { break }; log "$i" }');
          addLine('info', '  cards                    - View all parameters in table');
          addLine('info', '  luftstrom                - Open air flow diagram');
          addLine('info', '  chart                    - View realtime chart');
          addLine('info', '  chart 1701234567         - View historical chart');
          addLine('info', '  close chart              - Close chart window');
          addLine('info', '  close chart 2            - Close 2nd chart window');
          addLine('info', '  close airflow            - Close air flow window');
          addLine('info', '  close all                - Close cards, airflow, all charts');
          addLine('info', '  min chart                - Minimize chart window');
          addLine('info', '  max terminal             - Restore terminal');
          addLine('info', '  tile h                   - Set horizontal tiling layout');
          addLine('info', '  opacity                  - Toggle window transparency');
          addLine('info', '  stove_status 60 2        - Monitor for 60s, every 2s');
          addLine('info', '  stop                     - Stop monitoring / cancel script');
          addLine('info', '  d                        - Toggle Alle Werte on/off');
          addLine('info', '  k true                   - Enable Nur App-Werte');
          addLine('info', '  errors [first|last] [n]  - Show Fehlerlisten (PL/SL + all)');
          addLine('info', '  snake                    - Start Snake');
          addLine('info', '  type_race                - Start typing game');
          addLine('info', '  2048                     - Start 2048 game');
          addLine('info', '  rigfetch               - Show RigWatch info');
          if (canUseAdminCommands) {
            addLine('info', '  user_role user@example.com admin');
            addLine('info', '  user_active user@example.com false');
            addLine('info', '  user_dealer user@example.com true');
            addLine('info', '  delete_param T');
            addLine('info', '  fb_get /konstant_app/1000028300033490000033/a as appA');
            addLine('info', '  fb_exists /konstant_app/1000028300033490000033/a as hasA');
            addLine('info', '  fb_tree /controllertausch/fepaliste depth 2 limit 100');
            addLine('info', '  fb_copy /controllertausch/fepaliste/1000028/a -> /konstant_app/1000028300033490000033/a if_missing');
            addLine('info', '  fb_keys /historienliste shallow prefix 72 as keys72');
            addLine('info', '  temp_clear confirm');
          }
          break;

        case 'clear':
          setHistory([]);
          break;

        case 'errors': {
          if (!deviceId || !realtimeDB) {
            addLine('error', 'No device connected');
            break;
          }

          const ERROR_DEFINITIONS = {
            E: [
              { bit: 0, description: 'Motor A hakt' },
              { bit: 1, description: 'Motor A dreht durch' },
              { bit: 3, description: 'Motor B hakt' },
              { bit: 4, description: 'Motor B dreht durch' },
              { bit: 6, description: 'Temperatursensor defekt' }
            ],
            E2: [
              { bit: 2, description: 'Motor A kein Strom' },
              { bit: 5, description: 'Motor B kein Strom' }
            ]
          } as const;

          let limit: number | null = null;
          let direction: 'first' | 'last' = 'last';
          const arg1 = parts[1]?.toLowerCase();
          const arg2 = parts[2]?.toLowerCase();

          const parseLimit = (value?: string) => {
            if (!value) return null;
            const parsed = Number(value);
            if (!Number.isFinite(parsed) || parsed <= 0) return null;
            return Math.floor(parsed);
          };

          if (arg1 === 'first' || arg1 === 'last') {
            direction = arg1;
            limit = parseLimit(arg2);
          } else {
            limit = parseLimit(arg1);
          }

          const formatDateTime = (timestamp: number) =>
            new Date(timestamp * 1000).toLocaleString('de-DE', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit'
            });

          const parseErrorNumber = (raw: unknown) => {
            if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
            if (typeof raw !== 'string') return null;
            const numericPart = raw.split('/')[0]?.trim();
            if (!numericPart) return null;
            const parsed = Number(numericPart);
            return Number.isFinite(parsed) ? parsed : null;
          };

          const decodeErrorDescriptions = (raw: unknown, type: 'E' | 'E2') => {
            const value = parseErrorNumber(raw);
            if (value === null) return [];
            return ERROR_DEFINITIONS[type]
              .filter(def => (value & (1 << def.bit)) !== 0)
              .map(def => def.description);
          };

          const formatDecodedErrors = (raw: unknown) => {
            if (!raw || typeof raw !== 'object') return null;
            const record = raw as Record<string, unknown>;
            const parts: string[] = [];

            if ('ecode' in record) {
              const rawValue = record.ecode;
              const descriptions = decodeErrorDescriptions(rawValue, 'E');
              const rawString = typeof rawValue === 'string' || typeof rawValue === 'number' ? String(rawValue) : JSON.stringify(rawValue);
              parts.push(descriptions.length > 0 ? `ecode=${rawString} (${descriptions.join(', ')})` : `ecode=${rawString}`);
            }

            if ('ecode2' in record) {
              const rawValue = record.ecode2;
              const descriptions = decodeErrorDescriptions(rawValue, 'E2');
              const rawString = typeof rawValue === 'string' || typeof rawValue === 'number' ? String(rawValue) : JSON.stringify(rawValue);
              parts.push(descriptions.length > 0 ? `ecode2=${rawString} (${descriptions.join(', ')})` : `ecode2=${rawString}`);
            }

            return parts.length > 0 ? parts.join(' | ') : null;
          };

          const buildAngleList = (raw: Record<string, unknown> | null) => {
            if (!raw) return [];
            return Object.entries(raw)
              .map(([timestampKey, value]) => {
                const timestamp = Number(timestampKey);
                const numericValue = typeof value === 'number' ? value : Number(value);
                if (!Number.isFinite(timestamp) || !Number.isFinite(numericValue)) return null;
                return {
                  timestamp,
                  dateTime: formatDateTime(timestamp),
                  value: numericValue
                };
              })
              .filter((entry): entry is { timestamp: number; dateTime: string; value: number } => Boolean(entry))
              .sort((a, b) => a.timestamp - b.timestamp);
          };

          const buildAllErrorsList = (raw: Record<string, unknown> | null) => {
            if (!raw) return [];
            const entries: Array<{ timestamp: number; dateTime: string; path: string; valueString: string; rawValue: unknown }> = [];

            const visit = (node: unknown, path: string) => {
              if (!node || typeof node !== 'object') return;
              Object.entries(node as Record<string, unknown>).forEach(([key, value]) => {
                const timestamp = Number(key);
                if (Number.isFinite(timestamp)) {
                  entries.push({
                    timestamp,
                    dateTime: formatDateTime(timestamp),
                    path,
                    valueString: typeof value === 'string' ? value : JSON.stringify(value),
                    rawValue: value
                  });
                  return;
                }
                if (value && typeof value === 'object') {
                  visit(value, path ? `${path}/${key}` : key);
                }
              });
            };

            visit(raw, '');

            return entries.sort((a, b) => a.timestamp - b.timestamp);
          };

          try {
            addLine('info', 'Loading Fehlerlisten...');
            const [plSnap, slSnap, allSnap] = await Promise.all([
              get(ref(realtimeDB, `fehler/PL/${deviceId}`)),
              get(ref(realtimeDB, `fehler/SL/${deviceId}`)),
              get(ref(realtimeDB, `fehler/${deviceId}`))
            ]);

            const plRaw = plSnap.exists() && typeof plSnap.val() === 'object' ? plSnap.val() : null;
            const slRaw = slSnap.exists() && typeof slSnap.val() === 'object' ? slSnap.val() : null;
            const allRaw = allSnap.exists() && typeof allSnap.val() === 'object' ? allSnap.val() : null;

            const plListFull = buildAngleList(plRaw);
            const slListFull = buildAngleList(slRaw);
            const allListFull = buildAllErrorsList(allRaw);

            const applyLimit = <T,>(items: T[]) => {
              if (!limit) return items;
              return direction === 'first' ? items.slice(0, limit) : items.slice(-limit);
            };

            const plList = applyLimit(plListFull);
            const slList = applyLimit(slListFull);
            const allList = applyLimit(allListFull);

            addLine('info', `--- Fehlerliste PL (fehler/PL/${deviceId}) ---`);
            if (plList.length === 0) {
              addLine('info', 'Keine Einträge');
            } else {
              plList.forEach(item => {
                addLine('output', `${item.dateTime}: ${item.value}`);
              });
            }

            addLine('info', `--- Fehlerliste SL (fehler/SL/${deviceId}) ---`);
            if (slList.length === 0) {
              addLine('info', 'Keine Einträge');
            } else {
              slList.forEach(item => {
                addLine('output', `${item.dateTime}: ${item.value}`);
              });
            }

            addLine('info', `--- Fehlerübersicht (fehler/${deviceId}) ---`);
            if (allList.length === 0) {
              addLine('info', 'Keine Einträge');
            } else {
              allList.forEach(item => {
                addLine('output', `${item.dateTime}${item.path ? ` [${item.path}]` : ''}: ${formatDecodedErrors(item.rawValue) ?? item.valueString}`);
              });
            }
          } catch (error) {
            addLine('error', `Failed to load Fehlerlisten: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;
        }

        case 'connect':
          if (parts.length < 2) {
            addLine('error', 'Usage: connect <device_id>');
            addLine('info', 'Example: connect ABC123');
            break;
          }

          const targetDeviceId = parts[1].trim();
          
          if (!targetDeviceId) {
            addLine('error', 'Device ID cannot be empty');
            break;
          }

          if (connectionStatus === 'connecting') {
            addLine('error', 'Already connecting to a device. Please wait...');
            break;
          }

          if (deviceId === targetDeviceId && connectionStatus === 'online') {
            addLine('info', `Already connected to device: ${targetDeviceId}`);
            break;
          }

          try {
            addLine('info', `Connecting to device: ${targetDeviceId}...`);
            
            // Clear store state before connecting
            const { clearAllState } = useStoveStore.getState();
            clearAllState();
            
            const success = await connect(targetDeviceId);
            
            if (success) {
              addLine('info', `✓ Successfully connected to: ${targetDeviceId}`);
              const snapshot = useStoveStore.getState().currentData as Record<string, unknown>;
              const rawStamp = snapshot?.id_timestamp;
              if (typeof rawStamp === 'string' || typeof rawStamp === 'number') {
                lastDataTimestampRef.current = rawStamp;
              } else {
                lastDataTimestampRef.current = null;
              }
              // Update URL parameter
              try {
                const url = new URL(window.location.href);
                url.searchParams.set('id', targetDeviceId);
                const query = url.searchParams.toString();
                const newUrl = `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
                window.history.replaceState({}, '', newUrl);
              } catch {}
            } else {
              addLine('error', `Failed to connect to: ${targetDeviceId}`);
            }
          } catch (error) {
            addLine('error', `Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'disconnect':
          if (!deviceId || connectionStatus === 'offline') {
            addLine('error', 'No device connected');
            break;
          }

          try {
            addLine('info', `Disconnecting from device: ${deviceId}...`);
            await disconnect();
            addLine('info', '✓ Disconnected successfully');
            lastDataTimestampRef.current = null;
            // Clear URL parameter
            try {
              const url = new URL(window.location.href);
              url.searchParams.delete('id');
              const query = url.searchParams.toString();
              const newUrl = `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
              window.history.replaceState({}, '', newUrl);
            } catch {}
          } catch (error) {
            addLine('error', `Disconnect error: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'device':
          if (deviceId) {
            addLine('info', `Device ID: ${deviceId}`);
          } else {
            addLine('error', 'No device connected');
          }
          break;

        case 'status':
          addLine('info', `Connection Status: ${connectionStatus}`);
          addLine('info', `Device: ${deviceId || 'None'}`);
          addLine('info', `User: ${user?.displayName || user?.email || 'Unknown'}`);
          addLine('info', `Role: ${user?.role || 'Unknown'}`);
          addLine('info', `Undo stack: ${undoStackRef.current.length} entr${undoStackRef.current.length === 1 ? 'y' : 'ies'}`);
          break;

        case 'undo': {
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          const rawCount = parts[1];
          const undoCount = rawCount ? Number.parseInt(rawCount, 10) : 1;
          if (!Number.isFinite(undoCount) || undoCount < 1) {
            addLine('error', 'Usage: undo [count]');
            break;
          }
          if (undoStackRef.current.length === 0) {
            addLine('info', 'Nothing to undo');
            break;
          }
          const safeCount = Math.min(undoCount, undoStackRef.current.length);
          for (let i = 0; i < safeCount; i += 1) {
            const entry = undoStackRef.current.pop();
            if (!entry) break;
            try {
              await entry.run();
              addLine('info', `↶ Undone: ${entry.label}`);
            } catch (error) {
              addLine('error', `Undo failed: ${entry.label} (${error instanceof Error ? error.message : 'Unknown error'})`);
              break;
            }
          }
          break;
        }

        case 'set':
          if (!deviceId) {
            addLine('error', 'No device connected');
            break;
          }

          if (parts.length < 3) {
            addLine('error', 'Usage: set <parameter> <value>');
            addLine('info', 'Example: set use_fixed_tsoll true');
            break;
          }

          const paramName = parts[1];
          const paramValue = parts.slice(2).join(' '); // Join in case value has spaces
          
          try {
            if (!realtimeDB) {
              addLine('error', 'Database not initialized');
              break;
            }

            addLine('info', `Queueing: set ${paramName} ${paramValue}`);
            
            // Use command queue to prevent overwhelming the controller
            await queueSetCommand(deviceId, paramName, paramValue);
            
            addLine('info', `✓ Command queued successfully (will be sent with delay)`);
            addLine('info', `Parameter "${paramName}" will be set to "${paramValue}"`);
            
          } catch (error) {
            addLine('error', `Failed to queue command: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'get':
        case 'read': {
          if (!deviceId) {
            addLine('error', 'No device connected');
            break;
          }
          if (parts.length < 2) {
            addLine('error', 'Usage: get <param> [as <var>] | read <param> <var>');
            addLine('info', 'Examples: get T | get T as temp | read T temp');
            break;
          }
          const paramName = parts[1].trim();
          let varName: string | null = null;
          if (parts.length >= 3) {
            const marker = parts[2].toLowerCase();
            if ((marker === 'as' || marker === '->') && parts[3]) {
              varName = parts[3];
            } else if (cmd === 'read') {
              varName = parts[2];
            } else if (parts[2]) {
              varName = parts[2];
            }
          }

          const rawValue = resolveDeviceParam(paramName);
          if (rawValue === undefined || rawValue === null) {
            addLine('error', `Parameter not found: ${paramName}`);
            if (varName) {
              scriptVarsRef.current[varName] = '';
            }
            break;
          }
          const value = typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue);
          addLine('output', `${paramName} = ${value}`);
          if (varName) {
            scriptVarsRef.current[varName] = value;
          }
          break;
        }

        case 'collect': {
          const fromMatch = rawCommand.match(/^collect\s+from\s+(.+?)\s+params\s+(.+)\s*$/i);
          const localMatch = rawCommand.match(/^collect\s+params\s+(.+)\s*$/i);
          if (!fromMatch && !localMatch) {
            addLine('error', 'Usage: collect from <ids|all> params <params> [where <cond>] [as <var>] | collect params <params> [where <cond>] [as <var>]');
            addLine('info', 'Examples: collect from [A,B] params [T,PL] where T > 70 | collect params T,PL as row');
            break;
          }

          const parseCollectTail = (tailRaw: string) => {
            let tail = tailRaw.trim();
            let varName: string | null = null;
            let whereClause: string | null = null;
            const asMatch = tail.match(/^(.*?)(?:\s+as\s+([a-zA-Z_]\w*))\s*$/i);
            if (asMatch) {
              tail = asMatch[1].trim();
              varName = asMatch[2];
            }
            const whereMatch = tail.match(/^(.*?)(?:\s+where\s+(.+))$/i);
            if (whereMatch) {
              tail = whereMatch[1].trim();
              whereClause = whereMatch[2].trim();
            }
            return { paramsToken: tail, whereClause, varName };
          };

          const tail = parseCollectTail(fromMatch ? fromMatch[2] : localMatch![1]);

          let targetIds = fromMatch
            ? parseTokenList(fromMatch[1])
            : (deviceId ? [deviceId] : []);
          const fromToken = fromMatch?.[1]?.trim().toLowerCase() || '';
          const wantsAllDevices = fromToken === 'all' || fromToken === '*' || fromToken === 'all_devices';
          if (wantsAllDevices && targetIds.length === 0) {
            try {
              const fetchedIds = await getAllDeviceIds();
              if (fetchedIds.length > 0) {
                targetIds = fetchedIds;
                setAllDeviceIds(fetchedIds);
              }
            } catch {
              // fallback to existing state-based message below
            }
          }
          const params = parseTokenList(tail.paramsToken);
          const whereClause = tail.whereClause;
          const varName = tail.varName;
          const uniqueTargetIds = Array.from(new Set(targetIds.map(id => id.trim()).filter(Boolean)));
          const uniqueParams = Array.from(new Set(params.map(param => param.trim()).filter(Boolean)));

          if (uniqueTargetIds.length === 0) {
            addLine('error', fromMatch
              ? 'Device list is empty. Provide IDs, array ([A,B]), variable ($ids), or use "all" when devices are available.'
              : 'No device connected. Use "connect <device_id>" or "collect from <ids> params <params>".');
            break;
          }
          if (uniqueParams.length === 0) {
            addLine('error', 'Parameter list is empty. Provide list like [T,PL] or variable ($params).');
            break;
          }
          if (whereClause && !whereClause.trim()) {
            addLine('error', 'Where condition is empty. Example: where T > 70');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          const db = realtimeDB;

          addLine('info', `Collecting ${uniqueParams.length} param(s) from ${uniqueTargetIds.length} device(s)...`);
          const rows: Array<Record<string, string>> = [];
          const now = Date.now();
          const cache = collectCacheRef.current;
          const snapshotByTarget: Record<string, { target: string; payload: unknown; error: string | null }> = {};
          const targetsToFetch: string[] = [];

          uniqueTargetIds.forEach(target => {
            const cached = cache[target];
            if (cached && now - cached.fetchedAt < COLLECT_CACHE_TTL_MS) {
              snapshotByTarget[target] = { target, payload: cached.payload, error: cached.error };
            } else {
              targetsToFetch.push(target);
            }
          });

          const cachedCount = uniqueTargetIds.length - targetsToFetch.length;
          if (cachedCount > 0) {
            addLine('info', `Using cached data for ${cachedCount} device(s) (<=60s old).`);
          }

          if (targetsToFetch.length > 0) {
            const fetchedSnapshots = await Promise.all(targetsToFetch.map(async (target) => {
              try {
                const snap = await get(ref(db, `temporaer/${target}`));
                const payload = snap.exists() ? snap.val() : null;
                const record = { target, payload, error: null as string | null };
                cache[target] = { payload, error: null, fetchedAt: Date.now() };
                return record;
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                const record = { target, payload: null, error: message };
                cache[target] = { payload: null, error: message, fetchedAt: Date.now() };
                return record;
              }
            }));
            fetchedSnapshots.forEach(entry => {
              snapshotByTarget[entry.target] = entry;
            });
          }

          const snapshots = uniqueTargetIds
            .map(target => snapshotByTarget[target])
            .filter((entry): entry is { target: string; payload: unknown; error: string | null } => Boolean(entry));

          let filterError: string | null = null;
          let matchedCount = 0;
          for (const entry of snapshots) {
            const row: Record<string, string> = { device: entry.target };
            if (entry.error) {
              row._error = entry.error;
              addLine('error', `${entry.target}: ${entry.error}`);
            } else {
              const payload = (entry.payload && typeof entry.payload === 'object')
                ? entry.payload as Record<string, unknown>
                : null;
              const paramText = uniqueParams.map(param => {
                const rawValue = payload && Object.prototype.hasOwnProperty.call(payload, param)
                  ? payload[param]
                  : undefined;
                const value = rawValue === undefined || rawValue === null
                  ? 'n/a'
                  : (typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue));
                row[param] = value;
                return `${param}=${value}`;
              }).join(' | ');
              if (whereClause) {
                const result = evaluateCollectCondition(row, whereClause);
                if (result.error) {
                  filterError = result.error;
                  break;
                }
                if (result.pass) {
                  addLine('output', `${entry.target}: ${paramText}`);
                  matchedCount += 1;
                  rows.push(row);
                }
              } else {
                addLine('output', `${entry.target}: ${paramText}`);
                rows.push(row);
              }
            }
          }
          if (filterError) {
            addLine('error', filterError);
            break;
          }
          if (whereClause) {
            addLine('info', `Filter matched ${matchedCount}/${uniqueTargetIds.length} device(s)`);
          }

          if (varName) {
            scriptVarsRef.current[varName] = JSON.stringify(rows);
            addLine('info', `Saved ${rows.length} row(s) to $${varName}`);
          }
          break;
        }

        case 'collect_cache': {
          const action = (parts[1] || '').trim().toLowerCase();
          if (!action) {
            const cacheEntries = Object.entries(collectCacheRef.current);
            const nowTs = Date.now();
            if (cacheEntries.length === 0) {
              addLine('info', 'Collect cache is empty');
              break;
            }
            const freshCount = cacheEntries.filter(([, value]) => nowTs - value.fetchedAt < COLLECT_CACHE_TTL_MS).length;
            addLine('info', `Collect cache: ${cacheEntries.length} entr${cacheEntries.length === 1 ? 'y' : 'ies'} (${freshCount} fresh <=60s)`);
            break;
          }
          if (action === 'clear') {
            collectCacheRef.current = {};
            addLine('info', '✓ Collect cache cleared');
            break;
          }
          addLine('error', 'Usage: collect_cache [clear]');
          break;
        }

        case 'fb_cd': {
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          const match = resolvedCommand.match(/^fb_cd(?:\s+(\S+))?\s*$/i);
          if (!match) {
            addLine('error', 'Usage: fb_cd <path>');
            addLine('info', 'Examples: fb_cd /konstant_app, fb_cd 1000028300033490000033, fb_cd .., fb_cd /');
            break;
          }
          const targetRaw = match[1] ?? '/';
          const normalizedPath = resolveFirebasePath(targetRaw);
          if (normalizedPath === null) {
            addLine('error', 'Invalid Firebase path');
            break;
          }
          try {
            const snapshot = await get(ref(realtimeDB, normalizedPath));
            if (!snapshot.exists()) {
              addLine('error', `Path not found: /${normalizedPath || ''}`);
              break;
            }
            firebaseCwdRef.current = normalizedPath;
            addLine('info', `Firebase cwd: /${firebaseCwdRef.current || ''}`);
          } catch (error) {
            addLine('error', `Failed to change path: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;
        }

        case 'fb_pwd': {
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          addLine('info', `Firebase cwd: /${firebaseCwdRef.current || ''}`);
          break;
        }

        case 'fb_get': {
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          const match = resolvedCommand.match(/^fb_get\s+(\S+)(?:\s+as\s+([a-zA-Z_]\w*))?\s*$/i);
          if (!match) {
            addLine('error', 'Usage: fb_get <path> [as <var>]');
            addLine('info', 'Example: fb_get /konstant_app/100000000000000000000/a as appA');
            break;
          }
          const normalizedPath = resolveFirebasePath(match[1]);
          const varName = match[2] || null;
          if (!normalizedPath) {
            addLine('error', 'Invalid Firebase path');
            break;
          }
          try {
            const snapshot = await get(ref(realtimeDB, normalizedPath));
            if (!snapshot.exists()) {
              addLine('info', `Path not found: /${normalizedPath}`);
              if (varName) {
                setScriptVarValue(varName, '');
                addLine('info', `Saved empty value to $${varName}`);
              }
              break;
            }
            const value = snapshot.val();
            addLine('output', `/${normalizedPath} = ${formatFirebaseValuePreview(value)}`);
            if (varName) {
              setScriptVarValue(varName, value);
              addLine('info', `Saved value to $${varName}`);
            }
          } catch (error) {
            addLine('error', `Failed to read path: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;
        }

        case 'fb_exists': {
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          const match = resolvedCommand.match(/^fb_exists\s+(\S+)(?:\s+as\s+([a-zA-Z_]\w*))?\s*$/i);
          if (!match) {
            addLine('error', 'Usage: fb_exists <path> [as <var>]');
            addLine('info', 'Example: fb_exists /konstant_app/100000000000000000000/a as hasA');
            break;
          }
          const normalizedPath = resolveFirebasePath(match[1]);
          const varName = match[2] || null;
          if (!normalizedPath) {
            addLine('error', 'Invalid Firebase path');
            break;
          }
          try {
            const snapshot = await get(ref(realtimeDB, normalizedPath));
            const exists = snapshot.exists();
            addLine('output', `/${normalizedPath} exists = ${exists}`);
            if (varName) {
              setScriptVarValue(varName, exists);
              addLine('info', `Saved value to $${varName}`);
            }
          } catch (error) {
            addLine('error', `Failed to check path: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;
        }

        case 'fb_keys': {
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          const fbKeysParsed = resolvedCommand.match(/^fb_keys\s+(\S+)\s*(.*)$/i);
          if (!fbKeysParsed) {
            addLine('error', 'Usage: fb_keys <path> [shallow] [prefix <t>] [as <var>]');
            break;
          }
          const pathToken = fbKeysParsed[1];
          let tail = (fbKeysParsed[2] || '').trim();
          let useShallow = false;
          if (/^shallow\b/i.test(tail)) {
            useShallow = true;
            tail = tail.replace(/^shallow\s+/i, '').trim();
          }
          let prefixFilter: string | null = null;
          if (/^prefix\s+/i.test(tail)) {
            const pm = tail.match(/^prefix\s+(\S+)\s*(.*)$/i);
            if (pm) {
              prefixFilter = stripQuotes(pm[1].trim());
              tail = (pm[2] || '').trim();
            }
          }
          let varName: string | null = null;
          if (tail) {
            const am = tail.match(/^as\s+([a-zA-Z_]\w*)\s*$/i);
            if (!am) {
              addLine('error', 'Usage: fb_keys <path> [shallow] [prefix <t>] [as <var>]');
              addLine('info', 'shallow = nur Schlüssel (schnell), ohne Historie-Daten zu laden');
              break;
            }
            varName = am[1];
          }
          const normalizedPath = resolveFirebasePath(pathToken);
          if (!normalizedPath) {
            addLine('error', 'Invalid Firebase path');
            break;
          }
          try {
            let keys: string[] = [];
            if (useShallow) {
              const baseUrl = (import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined)?.replace(/\/$/, '');
              if (!baseUrl) {
                addLine('error', 'VITE_FIREBASE_DATABASE_URL missing (shallow keys need REST)');
                break;
              }
              if (!auth?.currentUser) {
                addLine('error', 'Shallow keys: bitte einloggen (Auth-Token für REST)');
                break;
              }
              const token = await auth.currentUser.getIdToken();
              const pathEnc = normalizedPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
              const url = `${baseUrl}/${pathEnc}.json?shallow=true&auth=${encodeURIComponent(token)}`;
              const res = await fetch(url);
              if (!res.ok) {
                const errText = await res.text();
                addLine('error', `Shallow keys failed (${res.status}): ${errText.slice(0, 240)}`);
                break;
              }
              const data = await res.json();
              if (data !== null && data !== undefined && typeof data === 'object' && !Array.isArray(data)) {
                keys = Object.keys(data as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
              }
              addLine('info', `/${normalizedPath} shallow keys (${keys.length})`);
            } else {
              const snapshot = await get(ref(realtimeDB, normalizedPath));
              if (!snapshot.exists()) {
                addLine('info', `Path not found: /${normalizedPath}`);
                if (varName) {
                  setScriptVarValue(varName, []);
                  addLine('info', `Saved empty list to $${varName}`);
                }
                break;
              }
              const raw = snapshot.val();
              keys = raw && typeof raw === 'object'
                ? Object.keys(raw as Record<string, unknown>).sort((a, b) => a.localeCompare(b))
                : [];
              addLine('info', `/${normalizedPath} keys (${keys.length}, full read):`);
            }
            if (prefixFilter) {
              keys = keys.filter((k) => k.startsWith(prefixFilter));
              addLine('info', `  prefix "${prefixFilter}" → ${keys.length} key(s)`);
            }
            if (keys.length === 0) {
              addLine('output', '  (none)');
            } else {
              const preview = keys.slice(0, 20);
              preview.forEach((key, idx) => addLine('output', `  ${idx + 1}. ${key}`));
              if (keys.length > preview.length) {
                addLine('output', `  ... and ${keys.length - preview.length} more`);
              }
            }
            if (varName) {
              setScriptVarValue(varName, keys);
              addLine('info', `Saved ${keys.length} key(s) to $${varName}`);
            }
          } catch (error) {
            addLine('error', `Failed to read keys: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;
        }

        case 'fb_tree': {
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          let pathToken: string | null = null;
          let argStartIndex = 1;
          const firstArg = parts[1]?.toLowerCase();
          if (parts.length >= 2 && firstArg && firstArg !== 'depth' && firstArg !== 'limit') {
            pathToken = parts[1];
            argStartIndex = 2;
          }
          const normalizedPath = pathToken ? resolveFirebasePath(pathToken) : firebaseCwdRef.current;
          if (normalizedPath === null) {
            addLine('error', 'Invalid Firebase path');
            break;
          }
          let depthLimit = 2;
          let nodeLimit = 200;
          let parseError: string | null = null;
          for (let i = argStartIndex; i < parts.length; i += 1) {
            const token = parts[i].toLowerCase();
            if (token === 'depth') {
              const value = Number(parts[i + 1]);
              if (!Number.isFinite(value) || value < 0) {
                parseError = 'depth must be a non-negative integer';
                break;
              }
              depthLimit = Math.floor(value);
              i += 1;
              continue;
            }
            if (token === 'limit') {
              const value = Number(parts[i + 1]);
              if (!Number.isFinite(value) || value < 1) {
                parseError = 'limit must be a positive integer';
                break;
              }
              nodeLimit = Math.floor(value);
              i += 1;
              continue;
            }
            parseError = `Unknown argument: ${parts[i]}`;
            break;
          }
          if (parseError) {
            addLine('error', `Usage error: ${parseError}`);
            addLine('info', 'Usage: fb_tree [path] [depth N] [limit N]');
            break;
          }
          try {
            const snapshot = await get(ref(realtimeDB, normalizedPath));
            if (!snapshot.exists()) {
              addLine('info', `Path not found: /${normalizedPath}`);
              break;
            }
            const value = snapshot.val();
            const tree = buildFirebaseTreeLines(value, { depthLimit, nodeLimit });
            addLine('info', `Tree for /${normalizedPath} (depth=${depthLimit}, limit=${nodeLimit}):`);
            tree.lines.forEach(line => addLine('output', line));
            if (tree.truncated) {
              addLine('info', `Output truncated after ${tree.visited} node(s). Increase limit to see more.`);
            }
          } catch (error) {
            addLine('error', `Failed to build tree: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;
        }

        case 'fb_set': {
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          const match = resolvedCommand.match(/^fb_set\s+(\S+)\s+([\s\S]+?)\s*$/i);
          if (!match) {
            addLine('error', 'Usage: fb_set <path> <value>');
            addLine('info', 'Example: fb_set /konstant_app/100000000000000000000/a 1000028');
            break;
          }
          const normalizedPath = resolveFirebasePath(match[1]);
          if (!normalizedPath) {
            addLine('error', 'Invalid Firebase path');
            break;
          }
          try {
            const parsedValue = parseFirebaseLiteral(match[2]);
            const targetRef = ref(realtimeDB, normalizedPath);
            const beforeSnap = await get(targetRef);
            const hadBefore = beforeSnap.exists();
            const beforeValue = beforeSnap.val();
            await set(ref(realtimeDB, normalizedPath), parsedValue);
            addLine('info', `✓ Set /${normalizedPath} = ${formatFirebaseValuePreview(parsedValue)}`);
            undoStackRef.current.push({
              label: `fb_set /${normalizedPath}`,
              run: async () => {
                if (hadBefore) {
                  await set(targetRef, beforeValue);
                } else {
                  await remove(targetRef);
                }
              },
            });
            if (undoStackRef.current.length > MAX_UNDO_STACK) undoStackRef.current.shift();
          } catch (error) {
            addLine('error', `Failed to set value: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;
        }

        case 'fb_update': {
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          const match = resolvedCommand.match(/^fb_update\s+(\S+)\s+([\s\S]+?)\s*$/i);
          if (!match) {
            addLine('error', 'Usage: fb_update <path> <json>');
            addLine('info', 'Example: fb_update /konstant_app/100000000000000000000 {"a":1000028}');
            break;
          }
          const normalizedPath = resolveFirebasePath(match[1]);
          if (!normalizedPath) {
            addLine('error', 'Invalid Firebase path');
            break;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(match[2].trim());
          } catch {
            addLine('error', 'fb_update requires valid JSON object');
            break;
          }
          if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            addLine('error', 'fb_update requires a JSON object (e.g. {"a":1})');
            break;
          }
          try {
            const targetRef = ref(realtimeDB, normalizedPath);
            const beforeSnap = await get(targetRef);
            const hadBefore = beforeSnap.exists();
            const beforeValue = beforeSnap.val();
            await update(ref(realtimeDB, normalizedPath), parsed as Record<string, unknown>);
            addLine('info', `✓ Updated /${normalizedPath}`);
            undoStackRef.current.push({
              label: `fb_update /${normalizedPath}`,
              run: async () => {
                if (hadBefore) {
                  await set(targetRef, beforeValue);
                } else {
                  await remove(targetRef);
                }
              },
            });
            if (undoStackRef.current.length > MAX_UNDO_STACK) undoStackRef.current.shift();
          } catch (error) {
            addLine('error', `Failed to update value: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;
        }

        case 'fb_remove': {
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          const match = resolvedCommand.match(/^fb_remove\s+(\S+)\s+confirm\s*$/i);
          if (!match) {
            addLine('error', 'Usage: fb_remove <path> confirm');
            addLine('info', 'Example: fb_remove /konstant_app/100000000000000000000/temp_flag confirm');
            break;
          }
          const normalizedPath = resolveFirebasePath(match[1]);
          if (!normalizedPath) {
            addLine('error', 'Invalid Firebase path');
            break;
          }
          try {
            const targetRef = ref(realtimeDB, normalizedPath);
            const beforeSnap = await get(targetRef);
            const hadBefore = beforeSnap.exists();
            const beforeValue = beforeSnap.val();
            await remove(targetRef);
            addLine('info', `✓ Removed /${normalizedPath}`);
            undoStackRef.current.push({
              label: `fb_remove /${normalizedPath}`,
              run: async () => {
                if (hadBefore) {
                  await set(targetRef, beforeValue);
                } else {
                  await remove(targetRef);
                }
              },
            });
            if (undoStackRef.current.length > MAX_UNDO_STACK) undoStackRef.current.shift();
          } catch (error) {
            addLine('error', `Failed to remove path: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;
        }

        case 'fb_copy': {
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          const match = resolvedCommand.match(/^fb_copy\s+(\S+)\s*->\s*(\S+)(?:\s+(if_missing))?\s*$/i);
          if (!match) {
            addLine('error', 'Usage: fb_copy <from> -> <to> [if_missing]');
            addLine('info', 'Example: fb_copy /controllertausch/fepaliste/1000028/a -> /konstant_app/1000028300033490000033/a if_missing');
            break;
          }
          const fromPath = resolveFirebasePath(match[1]);
          const toPath = resolveFirebasePath(match[2]);
          const ifMissing = Boolean(match[3]);
          if (!fromPath || !toPath) {
            addLine('error', 'Invalid Firebase path');
            break;
          }
          try {
            const targetRef = ref(realtimeDB, toPath);
            const beforeTargetSnap = await get(targetRef);
            const hadBefore = beforeTargetSnap.exists();
            const beforeTargetValue = beforeTargetSnap.val();
            const sourceSnap = await get(ref(realtimeDB, fromPath));
            if (!sourceSnap.exists()) {
              addLine('error', `Source path not found: /${fromPath}`);
              break;
            }
            if (ifMissing) {
              if (beforeTargetSnap.exists()) {
                addLine('info', `Skipped copy, target already exists: /${toPath}`);
                break;
              }
            }
            const valueToCopy = sourceSnap.val();
            await set(targetRef, valueToCopy);
            addLine('info', `✓ Copied /${fromPath} -> /${toPath}`);
            undoStackRef.current.push({
              label: `fb_copy /${fromPath} -> /${toPath}`,
              run: async () => {
                if (hadBefore) {
                  await set(targetRef, beforeTargetValue);
                } else {
                  await remove(targetRef);
                }
              },
            });
            if (undoStackRef.current.length > MAX_UNDO_STACK) undoStackRef.current.shift();
          } catch (error) {
            addLine('error', `Failed to copy value: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;
        }

        case 'substr': {
          const match = resolvedCommand.match(/^substr\s+(.+?)\s+(-?\d+)\s+(\d+)\s+as\s+([a-zA-Z_]\w*)\s*$/i);
          if (!match) {
            addLine('error', 'Usage: substr <value> <start> <length> as <var>');
            addLine('info', 'Example: substr 1000028300033490000033 0 7 as ofen');
            break;
          }
          const sourceRaw = match[1].trim();
          const start = Number(match[2]);
          const length = Number(match[3]);
          const varName = match[4];
          if (!Number.isFinite(start) || !Number.isInteger(start)) {
            addLine('error', 'substr start must be an integer');
            break;
          }
          if (!Number.isFinite(length) || !Number.isInteger(length) || length < 0) {
            addLine('error', 'substr length must be a non-negative integer');
            break;
          }
          const source = stripQuotes(sourceRaw);
          const normalizedStart = start >= 0 ? start : Math.max(0, source.length + start);
          const sliced = source.slice(normalizedStart, normalizedStart + length);
          setScriptVarValue(varName, sliced);
          addLine('info', `✓ ${varName} = ${sliced}`);
          break;
        }

        case 'update':
          if (!deviceId) {
            addLine('error', 'No device connected');
            break;
          }

          if (parts.length < 2) {
            addLine('error', 'Usage: update <filename>');
            addLine('info', 'Example: update firmware_v2.bin');
            break;
          }

          const updateFileName = parts.slice(1).join(' '); // Join in case filename has spaces
          
          try {
            if (!realtimeDB) {
              addLine('error', 'Database not initialized');
              break;
            }

            addLine('info', `Sending update command for file: ${updateFileName}`);
            
            // Use command queue to prevent race conditions
            const updateCommand = `update ${updateFileName}`;
            await queueCommand(deviceId, updateCommand);
            
            addLine('info', `✓ Update command queued successfully`);
            addLine('info', `Alternative update initiated with file "${updateFileName}"`);
            
          } catch (error) {
            addLine('error', `Failed to execute update command: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'sleep':
        case 'wait': {
          if (parts.length < 2) {
            addLine('error', 'Usage: sleep <duration>');
            addLine('info', 'Examples: sleep 2s | wait 1000ms | sleep 0.5s');
            break;
          }
          const duration = parseDurationMs(parts[1]);
          if (duration === null) {
            addLine('error', 'Invalid duration. Use numbers with s or ms (e.g., 2s, 500ms).');
            break;
          }
          addLine('info', `Waiting ${parts[1]}...`);
          const completed = await sleepCancelableMs(duration);
          if (completed) {
            addLine('info', `✓ Waited ${parts[1]}`);
          } else {
            addLine('info', 'Wait cancelled');
          }
          break;
        }

        case 'wait_param': {
          if (!deviceId || connectionStatus !== 'online') {
            addLine('error', 'No device connected. Use "connect <device_id>" first.');
            break;
          }
          if (parts.length < 2) {
            addLine('error', 'Usage: wait_param <param> [timeout] [interval]');
            addLine('info', 'Example: wait_param T 10s 500ms');
            break;
          }
          const param = parts[1].trim();
          const timeoutMs = parts.length >= 3 ? parseDurationMs(parts[2]) : 5000;
          const intervalMs = parts.length >= 4 ? parseDurationMs(parts[3]) : 250;
          if (timeoutMs === null || intervalMs === null) {
            addLine('error', 'Invalid duration. Use numbers with s or ms (e.g., 2s, 500ms).');
            break;
          }
          const startedAt = Date.now();
          const baseline = lastDataTimestampRef.current;
          addLine('info', `Waiting for ${param} (timeout ${parts[2] || '5s'})...`);
          while (Date.now() - startedAt < timeoutMs) {
            if (scriptCancelRef.current) {
              addLine('info', 'Wait cancelled');
              break;
            }
            const value = resolveDeviceParam(param);
            if (value !== undefined && value !== null) {
              if (baseline !== null) {
                const snap = useStoveStore.getState().currentData as Record<string, unknown>;
                const currentStamp = snap?.id_timestamp ?? null;
                if (currentStamp === baseline) {
                  const sleepOk = await sleepCancelableMs(intervalMs);
                  if (!sleepOk) {
                    addLine('info', 'Wait cancelled');
                    break;
                  }
                  continue;
                }
              }
              addLine('info', `✓ ${param} is available`);
              break;
            }
            const sleepOk = await sleepCancelableMs(intervalMs);
            if (!sleepOk) {
              addLine('info', 'Wait cancelled');
              break;
            }
          }
          if (Date.now() - startedAt >= timeoutMs) {
            addLine('error', `Timeout waiting for ${param}`);
          }
          break;
        }

        case 'log_save': {
          const rawName = parts.slice(1).join(' ').trim();
          const now = new Date();
          const stamp = now.toISOString().replace(/[:]/g, '-').split('.')[0];
          const baseName = rawName || `terminal_log_${stamp}`;
          const safeName = baseName.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || `terminal_log_${stamp}`;
          const fileName = safeName.toLowerCase().endsWith('.txt') ? safeName : `${safeName}.txt`;
          const lines = history.map(line => `${formatLogTimestamp(line.timestamp)} [${line.type.toUpperCase()}] ${line.content}`);
          const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          addLine('output', `Log saved: ${fileName} (${lines.length} line(s))`);
          break;
        }

        case 'preset_save': {
          const match = trimmedCommand.match(/^preset_save\s+(\S+)\s*\{([\s\S]*)\}\s*$/i);
          if (!match) {
            addLine('error', 'Usage: preset_save <name> { ... }');
            addLine('info', 'Example: preset_save warmup { set p1 10; sleep 2s; set p2 20 }');
            break;
          }
          const name = match[1].trim();
          const body = match[2].trim();
          if (!name) {
            addLine('error', 'Preset name cannot be empty');
            break;
          }
          if (!body) {
            addLine('error', 'Preset body cannot be empty');
            break;
          }
          const next = { ...presets, [name]: body };
          persistPresets(next);
          addLine('info', `✓ Preset saved: ${name}`);
          break;
        }

        case 'preset_list': {
          const names = Object.keys(presets);
          if (names.length === 0) {
            addLine('info', 'No presets saved');
            break;
          }
          addLine('info', `Presets (${names.length}):`);
          names.forEach((name, idx) => {
            addLine('output', `  ${idx + 1}. ${name}`);
          });
          break;
        }

        case 'preset_show': {
          if (parts.length < 2) {
            addLine('error', 'Usage: preset_show <name>');
            break;
          }
          const name = parts[1].trim();
          const key = Object.keys(presets).find(k => k.toLowerCase() === name.toLowerCase());
          if (!key) {
            addLine('error', `Preset not found: ${name}`);
            break;
          }
          addLine('info', `Preset "${key}":`);
          presets[key].replace(/\r/g, '').split('\n').forEach(line => {
            addLine('output', `  ${line}`);
          });
          break;
        }

        case 'preset_delete': {
          if (parts.length < 2) {
            addLine('error', 'Usage: preset_delete <name>');
            break;
          }
          const name = parts[1].trim();
          const key = Object.keys(presets).find(k => k.toLowerCase() === name.toLowerCase());
          if (!key) {
            addLine('error', `Preset not found: ${name}`);
            break;
          }
          const next = { ...presets };
          delete next[key];
          persistPresets(next);
          addLine('info', `✓ Preset deleted: ${key}`);
          break;
        }

        case 'preset_run': {
          if (parts.length < 2) {
            addLine('error', 'Usage: preset_run <name>');
            break;
          }
          const name = parts[1].trim();
          const key = Object.keys(presets).find(k => k.toLowerCase() === name.toLowerCase());
          if (!key) {
            addLine('error', `Preset not found: ${name}`);
            break;
          }
          const script = presets[key];
          const expanded = expandScriptCommands(script, { steps: 0 });
          if (expanded.error) {
            addLine('error', `Preset error: ${expanded.error}`);
            break;
          }
          if (expanded.commands.length === 0) {
            addLine('info', `Preset "${key}" is empty`);
            break;
          }
          addLine('info', `Running preset "${key}" (${expanded.commands.length} command(s))...`);
          for (const cmdLine of expanded.commands) {
            await executeSingleCommandRef.current?.(cmdLine, { silentHistory: true });
          }
          addLine('info', `✓ Preset "${key}" completed`);
          break;
        }

        case 'log': {
          const message = resolvedCommand.slice(3).trim();
          if (!message) {
            addLine('error', 'Usage: log <message>');
            break;
          }
          if (!isQuotedString(message)) {
            addLine('error', 'String must be quoted. Example: log "Hello World"');
            break;
          }
          addLine('output', stripQuotes(message));
          break;
        }

        case 'assert_connected': {
          if (!deviceId || connectionStatus !== 'online') {
            addLine('error', 'No device connected. Use "connect <device_id>" first.');
            if (scriptRunningRef.current) {
              scriptCancelRef.current = true;
              addLine('info', '✓ Script stop requested');
            }
            break;
          }
          addLine('info', '✓ Device is connected');
          break;
        }

        case 'script_status': {
          if (!scriptRunningRef.current || !scriptProgressRef.current) {
            addLine('info', 'No script running');
            break;
          }
          const { total, done } = scriptProgressRef.current;
          addLine('info', `Script running: ${done}/${total} completed`);
          break;
        }

        case 'code': {
          addLine('info', 'Opening script editor...');
          openEditor({ forceTemplate: true });
          break;
        }

        case 'break': {
          if (loopDepthRef.current <= 0) {
            addLine('error', 'break can only be used inside a loop');
            break;
          }
          scriptBreakRef.current = true;
          break;
        }

        case 'continue': {
          if (loopDepthRef.current <= 0) {
            addLine('error', 'continue can only be used inside a loop');
            break;
          }
          scriptContinueRef.current = true;
          break;
        }

        case 'if': {
          const parsed = parseIfCommand(rawCommand);
          if (parsed.error) {
            addLine('error', parsed.error);
            break;
          }
          const condition = parsed.condition;
          const ifBody = parsed.ifBody;
          const elseBody = parsed.elseBody;
          const result = evaluateCondition(condition);
          const branch = result ? ifBody : elseBody;
          if (!branch) {
            addLine('info', `If ${condition.trim()} => ${result ? 'true' : 'false'} (no commands)`);
            break;
          }
          const expanded = expandScriptCommands(branch, { steps: 0 });
          if (expanded.error) {
            addLine('error', expanded.error);
            break;
          }
          addLine('info', `If ${condition.trim()} => ${result ? 'true' : 'false'}`);
          for (const cmdLine of expanded.commands) {
            if (scriptCancelRef.current) {
              addLine('info', 'Script cancelled');
              break;
            }
            await executeSingleCommandRef.current?.(cmdLine, { silentHistory: true });
          }
          break;
        }

        case 'try': {
          const parsed = parseTryCommand(rawCommand);
          if (parsed.error) {
            addLine('error', parsed.error);
            break;
          }
          const tryBody = parsed.tryBody;
          const catchBody = parsed.catchBody;
          const expandedTry = expandScriptCommands(tryBody, { steps: 0 });
          if (expandedTry.error) {
            addLine('error', expandedTry.error);
            break;
          }
          let failed = false;
          for (const cmdLine of expandedTry.commands) {
            if (scriptCancelRef.current) {
              addLine('info', 'Script cancelled');
              break;
            }
            const ok = await executeSingleCommandRef.current?.(cmdLine, { silentHistory: true });
            if (ok === false) {
              failed = true;
              break;
            }
          }
          if (!failed || !catchBody) {
            break;
          }
          const expandedCatch = expandScriptCommands(catchBody, { steps: 0 });
          if (expandedCatch.error) {
            addLine('error', expandedCatch.error);
            break;
          }
          addLine('info', 'Try block failed, running catch...');
          for (const cmdLine of expandedCatch.commands) {
            if (scriptCancelRef.current) {
              addLine('info', 'Script cancelled');
              break;
            }
            await executeSingleCommandRef.current?.(cmdLine, { silentHistory: true });
          }
          break;
        }

        case 'while': {
          const trimmed = rawCommand.trim();
          if (!/^while\s+/i.test(trimmed)) {
            addLine('error', 'Usage: while <condition> { ... }');
            break;
          }
          const firstBrace = trimmed.indexOf('{');
          if (firstBrace === -1) {
            addLine('error', 'Syntax error: missing "{" after while condition');
            break;
          }
          const condition = trimmed.slice(5, firstBrace).trim();
          const block = parseBlockAt(trimmed, firstBrace);
          if (block.endIndex === -1) {
            addLine('error', 'Syntax error: unmatched "}" in while block');
            break;
          }
          const body = block.body.trim();
          if (!body) {
            addLine('info', 'While block is empty');
            break;
          }
          let iter = 0;
          loopDepthRef.current += 1;
          while (evaluateCondition(condition)) {
            if (scriptCancelRef.current) {
              addLine('info', 'Script cancelled');
              break;
            }
            iter += 1;
            if (iter > MAX_LOOP_ITERATIONS) {
              addLine('error', `Loop limit exceeded (max ${MAX_LOOP_ITERATIONS})`);
              break;
            }
            scriptBreakRef.current = false;
            scriptContinueRef.current = false;
            const expanded = expandScriptCommands(body, { steps: 0 });
            if (expanded.error) {
              addLine('error', expanded.error);
              break;
            }
            let shouldBreak = false;
            let shouldContinue = false;
            for (const cmdLine of expanded.commands) {
              if (scriptCancelRef.current) {
                addLine('info', 'Script cancelled');
                break;
              }
              await executeSingleCommandRef.current?.(cmdLine, { silentHistory: true });
              if (scriptBreakRef.current) {
                scriptBreakRef.current = false;
                shouldBreak = true;
                break;
              }
              if (scriptContinueRef.current) {
                scriptContinueRef.current = false;
                shouldContinue = true;
                break;
              }
            }
            if (shouldBreak) {
              break;
            }
            if (shouldContinue) {
              continue;
            }
          }
          loopDepthRef.current = Math.max(0, loopDepthRef.current - 1);
          break;
        }

        case 'for': {
          const trimmed = rawCommand.trim();
          const firstBrace = trimmed.indexOf('{');
          if (!/^for\s+/i.test(trimmed)) {
            addLine('error', 'Usage: for <var> in <start>..<end> { ... }');
            break;
          }
          if (firstBrace === -1) {
            addLine('error', 'Syntax error: missing "{" in for loop');
            break;
          }
          const block = parseBlockAt(trimmed, firstBrace);
          if (block.endIndex === -1) {
            addLine('error', 'Syntax error: unmatched "}" in for block');
            break;
          }
          const body = block.body.trim();
          if (!body) {
            addLine('info', 'For block is empty');
            break;
          }

          const parseListItems = (raw: string) => {
            const items: string[] = [];
            let buffer = '';
            let inString: '"' | '\'' | null = null;
            let escaped = false;
            for (let i = 0; i < raw.length; i += 1) {
              const ch = raw[i];
              if (inString) {
                buffer += ch;
                if (escaped) {
                  escaped = false;
                  continue;
                }
                if (ch === '\\') {
                  escaped = true;
                  continue;
                }
                if (ch === inString) {
                  inString = null;
                }
                continue;
              }
              if (ch === '"' || ch === '\'') {
                inString = ch;
                buffer += ch;
                continue;
              }
              if (ch === ',') {
                const trimmedItem = buffer.trim();
                if (trimmedItem) items.push(trimmedItem);
                buffer = '';
                continue;
              }
              buffer += ch;
            }
            const trimmedItem = buffer.trim();
            if (trimmedItem) items.push(trimmedItem);
            return items;
          };

          const runListLoop = async (varName: string, entries: string[]) => {
            const previous = scriptVarsRef.current[varName];
            loopDepthRef.current += 1;
            for (const entry of entries) {
              if (scriptCancelRef.current) {
                addLine('info', 'Script cancelled');
                break;
              }
              scriptVarsRef.current[varName] = String(entry);
              scriptBreakRef.current = false;
              scriptContinueRef.current = false;
              const expanded = expandScriptCommands(body, { steps: 0 });
              if (expanded.error) {
                addLine('error', expanded.error);
                break;
              }
              let shouldBreak = false;
              let shouldContinue = false;
              for (const cmdLine of expanded.commands) {
                if (scriptCancelRef.current) {
                  addLine('info', 'Script cancelled');
                  break;
                }
                await executeSingleCommandRef.current?.(cmdLine, { silentHistory: true });
                if (scriptBreakRef.current) {
                  scriptBreakRef.current = false;
                  shouldBreak = true;
                  break;
                }
                if (scriptContinueRef.current) {
                  scriptContinueRef.current = false;
                  shouldContinue = true;
                  break;
                }
              }
              if (shouldBreak) break;
              if (shouldContinue) continue;
            }
            loopDepthRef.current = Math.max(0, loopDepthRef.current - 1);
            if (previous === undefined) {
              delete scriptVarsRef.current[varName];
            } else {
              scriptVarsRef.current[varName] = previous;
            }
          };

          const expandListLiteralItem = (rawItem: string): string[] => {
            const item = rawItem.trim();
            if (!item) return [];
            if (item.startsWith('$')) {
              return normalizeListValues(resolveVarToken(item.slice(1)));
            }
            if (item.startsWith('@')) {
              return normalizeListValues(resolveDeviceParam(item.slice(1)));
            }
            const resolved = String(resolveListItem(item)).trim();
            return resolved ? [resolved] : [];
          };

          const listMatch = trimmed.match(/^for\s+([a-zA-Z_]\w*)\s+in\s+\[(.*)\]\s*\{/i);
          if (listMatch) {
            const varName = listMatch[1];
            const listRaw = listMatch[2].trim();
            const entries = parseListItems(listRaw).flatMap(expandListLiteralItem);
            if (entries.length === 0) {
              addLine('error', 'List in for-loop is empty');
              break;
            }
            await runListLoop(varName, entries);
            break;
          }

          const varListMatch = trimmed.match(/^for\s+([a-zA-Z_]\w*)\s+in\s+([$@][a-zA-Z_]\w*)\s*\{/i);
          if (varListMatch) {
            const varName = varListMatch[1];
            const listToken = varListMatch[2];
            let rawList = '';
            if (listToken.startsWith('$')) {
              rawList = scriptVarsRef.current[listToken.slice(1)] ?? '';
            } else {
              const value = resolveDeviceParam(listToken.slice(1));
              rawList = value === undefined || value === null ? '' : String(value);
            }
            const trimmedList = String(rawList).trim();
            if (!trimmedList) {
              addLine('error', `List is empty: ${listToken}`);
              break;
            }
            let entries: string[] = [];
            if (trimmedList.startsWith('[') && trimmedList.endsWith(']')) {
              try {
                const parsed = JSON.parse(trimmedList);
                if (Array.isArray(parsed)) {
                  entries = parsed.map(item => String(item));
                } else {
                  entries = parseListItems(trimmedList.slice(1, -1)).map(item => String(resolveListItem(item)));
                }
              } catch {
                entries = parseListItems(trimmedList.slice(1, -1)).map(item => String(resolveListItem(item)));
              }
            } else if (trimmedList.includes(',')) {
              entries = parseListItems(trimmedList).map(item => String(resolveListItem(item)));
            } else {
              entries = [trimmedList];
            }
            if (entries.length === 0) {
              addLine('error', `List is empty: ${listToken}`);
              break;
            }
            await runListLoop(varName, entries);
            break;
          }

          const forMatch = trimmed.match(/^for\s+([a-zA-Z_]\w*)\s+in\s+(-?\d+)\s*\.\.\s*(-?\d+)\s*\{/i);
          if (!forMatch) {
            addLine('error', 'Usage: for <var> in <start>..<end> { ... } or for <var> in [a,b,c] { ... }');
            break;
          }
          const varName = forMatch[1];
          const start = parseInt(forMatch[2], 10);
          const end = parseInt(forMatch[3], 10);
          const step = start <= end ? 1 : -1;
          const total = Math.abs(end - start) + 1;
          if (total > MAX_LOOP_ITERATIONS) {
            addLine('error', `Loop limit exceeded (max ${MAX_LOOP_ITERATIONS})`);
            break;
          }
          const previous = scriptVarsRef.current[varName];
          loopDepthRef.current += 1;
          for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
            if (scriptCancelRef.current) {
              addLine('info', 'Script cancelled');
              break;
            }
            scriptVarsRef.current[varName] = String(i);
            scriptBreakRef.current = false;
            scriptContinueRef.current = false;
            const expanded = expandScriptCommands(body, { steps: 0 });
            if (expanded.error) {
              addLine('error', expanded.error);
              break;
            }
            let shouldBreak = false;
            let shouldContinue = false;
            for (const cmdLine of expanded.commands) {
              if (scriptCancelRef.current) {
                addLine('info', 'Script cancelled');
                break;
              }
              await executeSingleCommandRef.current?.(cmdLine, { silentHistory: true });
              if (scriptBreakRef.current) {
                scriptBreakRef.current = false;
                shouldBreak = true;
                break;
              }
              if (scriptContinueRef.current) {
                scriptContinueRef.current = false;
                shouldContinue = true;
                break;
              }
            }
            if (shouldBreak) break;
            if (shouldContinue) continue;
          }
          loopDepthRef.current = Math.max(0, loopDepthRef.current - 1);
          if (previous === undefined) {
            delete scriptVarsRef.current[varName];
          } else {
            scriptVarsRef.current[varName] = previous;
          }
          break;
        }

        case 'let': {
          // [\s\S]+ so multiline values work (e.g. let x = [ ... ] with line breaks)
          const match = resolvedCommand.match(/^let\s+([a-zA-Z_][\w]*)\s*(?:=\s*)?([\s\S]+)$/i);
          if (!match) {
            addLine('error', 'Usage: let <name> <value> | let <name> = <value>');
            break;
          }
          const name = match[1].trim();
          const rawValue = match[2].trim();
          if (!rawValue) {
            addLine('error', 'Usage: let <name> <value> | let <name> = <value>');
            break;
          }

          if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
            let entries: string[] = [];
            try {
              const parsed = JSON.parse(rawValue) as unknown;
              if (Array.isArray(parsed)) {
                entries = parsed.map((item) => {
                  if (Array.isArray(item) || (item !== null && typeof item === 'object')) {
                    return JSON.stringify(item);
                  }
                  return String(item);
                });
              }
            } catch {
              entries = [];
            }
            if (entries.length === 0) {
              const inner = rawValue.slice(1, -1);
              entries = parseListItems(inner).flatMap((rawItem) => {
                const item = rawItem.trim();
                if (!item) return [];
                if (item.startsWith('$')) {
                  return normalizeListValues(resolveVarToken(item.slice(1)));
                }
                if (item.startsWith('@')) {
                  return normalizeListValues(resolveDeviceParam(item.slice(1)));
                }
                const resolved = String(resolveListItem(item)).trim();
                return resolved ? [resolved] : [];
              });
            }
            const stored = JSON.stringify(entries);
            scriptVarsRef.current[name] = stored;
            addLine('info', `✓ ${name} = ${stored}`);
            break;
          }

          if (rawValue.startsWith('@')) {
            const param = rawValue.slice(1).trim();
            const value = resolveDeviceParam(param);
            if (value === undefined || value === null) {
              addLine('error', `Parameter not found: ${param}`);
              scriptVarsRef.current[name] = '';
              break;
            }
            const stored = typeof value === 'object' ? JSON.stringify(value) : String(value);
            scriptVarsRef.current[name] = stored;
            addLine('info', `✓ ${name} = ${stored}`);
            break;
          }

          if (/^get\./i.test(rawValue)) {
            const param = rawValue.slice(4).trim();
            if (!param) {
              addLine('error', 'Usage: let <name> = get.<param>');
              break;
            }
            const value = resolveDeviceParam(param);
            if (value === undefined || value === null) {
              addLine('error', `Parameter not found: ${param}`);
              scriptVarsRef.current[name] = '';
              break;
            }
            const stored = typeof value === 'object' ? JSON.stringify(value) : String(value);
            scriptVarsRef.current[name] = stored;
            addLine('info', `✓ ${name} = ${stored}`);
            break;
          }

          if (/^get\s+/i.test(rawValue)) {
            const param = rawValue.replace(/^get\s+/i, '').trim();
            if (!param) {
              addLine('error', 'Usage: let <name> = get <param>');
              break;
            }
            const value = resolveDeviceParam(param);
            if (value === undefined || value === null) {
              addLine('error', `Parameter not found: ${param}`);
              scriptVarsRef.current[name] = '';
              break;
            }
            const stored = typeof value === 'object' ? JSON.stringify(value) : String(value);
            scriptVarsRef.current[name] = stored;
            addLine('info', `✓ ${name} = ${stored}`);
            break;
          }

          const isNumber = /^-?\d+(?:\.\d+)?$/.test(rawValue);
          const isBool = /^(true|false)$/i.test(rawValue);
          if (!isNumber && !isBool && !isQuotedString(rawValue)) {
            addLine('error', 'String must be quoted. Example: let mode "auto"');
            break;
          }
          const value = isQuotedString(rawValue) ? stripQuotes(rawValue) : rawValue;
          scriptVarsRef.current[name] = value;
          addLine('info', `✓ ${name} = ${value}`);
          break;
        }

        case 'calc': {
          const match = rawCommand.match(/^calc\s+(.+?)(?:\s+as\s+([a-zA-Z_]\w*))?\s*$/i);
          if (!match) {
            addLine('error', 'Usage: calc <expr> [as <var>]');
            addLine('info', 'Example: calc ($temp + 5) * 1.8 + 32 as tempF');
            break;
          }

          const expression = match[1].trim();
          const varName = match[2]?.trim();
          const interpolated = interpolateVariables(expression);
          const evaluation = evaluateMathExpression(interpolated);
          if (evaluation.error) {
            addLine('error', `Calc error: ${evaluation.error}`);
            break;
          }

          const value = evaluation.value!;
          const rendered = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)));
          if (varName) {
            setScriptVarValue(varName, rendered);
            addLine('info', `✓ ${varName} = ${rendered}`);
          } else {
            addLine('output', rendered);
          }
          break;
        }

        case 'unset': {
          if (parts.length < 2) {
            addLine('error', 'Usage: unset <name>');
            break;
          }
          const name = parts[1].trim();
          if (scriptVarsRef.current[name] === undefined) {
            addLine('info', `Variable not found: ${name}`);
            break;
          }
          delete scriptVarsRef.current[name];
          addLine('info', `✓ ${name} removed`);
          break;
        }

        case 'vars': {
          const entries = Object.entries(scriptVarsRef.current);
          if (entries.length === 0) {
            addLine('info', 'No script variables set');
            break;
          }
          addLine('info', `Variables (${entries.length}):`);
          entries.forEach(([key, val], idx) => {
            addLine('output', `  ${idx + 1}. ${key} = ${val}`);
          });
          break;
        }

        // ==================== ADMIN COMMANDS ====================
        case 'user_list':
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }

          try {
            addLine('info', 'Fetching users...');
            const userList = await getAllUsers();
            setUsers(userList); // Update local cache
            
            if (userList.length === 0) {
              addLine('info', 'No users found.');
            } else {
              addLine('info', `Found ${userList.length} user(s):`);
              addLine('info', '');
              userList.forEach((u, idx) => {
                const status = u.isActive ? '●' : '○';
                const simple = u.forceSimpleMode ? ' [Simple]' : '';
                const dealer = u.isDealer ? ' [Dealer]' : '';
                const roleColor = USER_ROLE_CONFIGS[u.role]?.name || u.role;
                addLine('output', `  ${idx + 1}. ${status} ${u.email}`);
                addLine('output', `     Name: ${u.displayName || 'N/A'} | Role: ${roleColor}${simple}${dealer}`);
              });
            }
          } catch (error) {
            addLine('error', `Failed to fetch users: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'user_role':
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }

          if (parts.length < 3) {
            addLine('error', 'Usage: user_role <email> <role>');
            addLine('info', 'Available roles: ' + USER_ROLES.join(', '));
            break;
          }

          const roleEmail = parts[1];
          const newRole = parts[2] as UserRole;

          if (!USER_ROLES.includes(newRole)) {
            addLine('error', `Invalid role: ${newRole}`);
            addLine('info', 'Available roles: ' + USER_ROLES.join(', '));
            break;
          }

          if (!canAssignRole(user?.role, newRole)) {
            addLine('error', `Access denied. Your role (${user?.role}) cannot assign role "${newRole}".`);
            addLine('info', 'Only super_admin can grant developer or super_admin roles.');
            break;
          }

          try {
            const targetUser = users.find(u => u.email.toLowerCase() === roleEmail.toLowerCase());
            if (!targetUser) {
              addLine('error', `User not found: ${roleEmail}`);
              addLine('info', 'Use "user_list" to see available users.');
              break;
            }

            if (targetUser.uid === user?.uid) {
              addLine('error', 'Cannot change your own role.');
              break;
            }

            addLine('info', `Changing role for ${roleEmail} to ${newRole}...`);
            const result = await updateUserRole(targetUser.uid, newRole);
            
            if (result.success) {
              addLine('info', `✓ Role updated successfully: ${roleEmail} → ${newRole}`);
              // Refresh users list
              const updatedUsers = await getAllUsers();
              setUsers(updatedUsers);
              // Notify other components about the change
              window.dispatchEvent(new CustomEvent('users-updated'));
            } else {
              addLine('error', `Failed: ${result.error || 'Unknown error'}`);
            }
          } catch (error) {
            addLine('error', `Failed to update role: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'user_active':
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }

          if (parts.length < 3) {
            addLine('error', 'Usage: user_active <email> <true|false>');
            break;
          }

          const activeEmail = parts[1];
          const activeValue = parts[2].toLowerCase();

          if (activeValue !== 'true' && activeValue !== 'false') {
            addLine('error', 'Value must be "true" or "false"');
            break;
          }

          try {
            const targetActiveUser = users.find(u => u.email.toLowerCase() === activeEmail.toLowerCase());
            if (!targetActiveUser) {
              addLine('error', `User not found: ${activeEmail}`);
              addLine('info', 'Use "user_list" to see available users.');
              break;
            }

            if (targetActiveUser.uid === user?.uid) {
              addLine('error', 'Cannot deactivate yourself.');
              break;
            }

            const isActive = activeValue === 'true';
            addLine('info', `${isActive ? 'Activating' : 'Deactivating'} user ${activeEmail}...`);
            const result = await toggleUserActive(targetActiveUser.uid, isActive);
            
            if (result.success) {
              addLine('info', `✓ User ${activeEmail} ${isActive ? 'activated' : 'deactivated'} successfully`);
              // Refresh users list
              const updatedUsers = await getAllUsers();
              setUsers(updatedUsers);
              // Notify other components about the change
              window.dispatchEvent(new CustomEvent('users-updated'));
            } else {
              addLine('error', `Failed: ${result.error || 'Unknown error'}`);
            }
          } catch (error) {
            addLine('error', `Failed to update status: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'user_simple':
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }

          if (parts.length < 3) {
            addLine('error', 'Usage: user_simple <email> <true|false>');
            break;
          }

          const simpleEmail = parts[1];
          const simpleValue = parts[2].toLowerCase();

          if (simpleValue !== 'true' && simpleValue !== 'false') {
            addLine('error', 'Value must be "true" or "false"');
            break;
          }

          try {
            const targetSimpleUser = users.find(u => u.email.toLowerCase() === simpleEmail.toLowerCase());
            if (!targetSimpleUser) {
              addLine('error', `User not found: ${simpleEmail}`);
              addLine('info', 'Use "user_list" to see available users.');
              break;
            }

            const forceSimple = simpleValue === 'true';
            addLine('info', `${forceSimple ? 'Enabling' : 'Disabling'} Simple Mode for ${simpleEmail}...`);
            const result = await toggleUserForceSimpleMode(targetSimpleUser.uid, forceSimple);
            
            if (result.success) {
              addLine('info', `✓ Simple Mode ${forceSimple ? 'enabled' : 'disabled'} for ${simpleEmail}`);
              // Refresh users list
              const updatedUsers = await getAllUsers();
              setUsers(updatedUsers);
              // Notify other components about the change
              window.dispatchEvent(new CustomEvent('users-updated'));
            } else {
              addLine('error', `Failed: ${result.error || 'Unknown error'}`);
            }
          } catch (error) {
            addLine('error', `Failed to update Simple Mode: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'user_dealer':
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }

          if (parts.length < 3) {
            addLine('error', 'Usage: user_dealer <email> <true|false>');
            break;
          }

          const dealerEmail = parts[1];
          const dealerValue = parts[2].toLowerCase();

          if (dealerValue !== 'true' && dealerValue !== 'false') {
            addLine('error', 'Value must be "true" or "false"');
            break;
          }

          try {
            const targetDealerUser = users.find(u => u.email.toLowerCase() === dealerEmail.toLowerCase());
            if (!targetDealerUser) {
              addLine('error', `User not found: ${dealerEmail}`);
              addLine('info', 'Use "user_list" to see available users.');
              break;
            }

            const isDealer = dealerValue === 'true';
            addLine('info', `${isDealer ? 'Enabling' : 'Disabling'} dealer route mode for ${dealerEmail}...`);
            const result = await toggleUserDealerMode(targetDealerUser.uid, isDealer);

            if (result.success) {
              addLine('info', `✓ Dealer route mode ${isDealer ? 'enabled' : 'disabled'} for ${dealerEmail}`);
              const updatedUsers = await getAllUsers();
              setUsers(updatedUsers);
              window.dispatchEvent(new CustomEvent('users-updated'));
            } else {
              addLine('error', `Failed: ${result.error || 'Unknown error'}`);
            }
          } catch (error) {
            addLine('error', `Failed to update dealer mode: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'user_create':
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }

          if (parts.length < 3) {
            addLine('error', 'Usage: user_create <email> <role>');
            addLine('info', 'Available roles: ' + USER_ROLES.join(', '));
            break;
          }

          const createEmail = parts[1];
          const createRole = parts[2] as UserRole;

          // Basic email validation
          if (!createEmail.includes('@') || !createEmail.includes('.')) {
            addLine('error', 'Invalid email format');
            break;
          }

          if (!USER_ROLES.includes(createRole)) {
            addLine('error', `Invalid role: ${createRole}`);
            addLine('info', 'Available roles: ' + USER_ROLES.join(', '));
            break;
          }

          if (!canAssignRole(user?.role, createRole)) {
            addLine('error', `Access denied. Your role (${user?.role}) cannot create users with role "${createRole}".`);
            addLine('info', 'Only super_admin can create developer or super_admin users.');
            break;
          }

          // Check if user already exists
          const existingUser = users.find(u => u.email.toLowerCase() === createEmail.toLowerCase());
          if (existingUser) {
            addLine('error', `User already exists: ${createEmail}`);
            break;
          }

          try {
            addLine('info', `Creating user ${createEmail} with role ${createRole}...`);
            const result = await createUser({ email: createEmail, role: createRole }, user?.uid || 'terminal');
            
            if (result.success) {
              addLine('info', `✓ User ${createEmail} created successfully with role ${createRole}`);
              // Refresh users list
              const updatedUsers = await getAllUsers();
              setUsers(updatedUsers);
              // Notify other components about the change
              window.dispatchEvent(new CustomEvent('users-updated'));
            } else {
              addLine('error', `Failed: ${result.error || 'Unknown error'}`);
            }
          } catch (error) {
            addLine('error', `Failed to create user: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'delete_param':
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          if (!deviceId || connectionStatus !== 'online') {
            addLine('error', 'No device connected. Use "connect <device_id>" first.');
            break;
          }
          if (parts.length < 2) {
            addLine('error', 'Usage: delete_param <paramId>');
            addLine('info', 'Example: delete_param T');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          try {
            const paramIdToDelete = parts[1].trim();
            if (!paramIdToDelete) {
              addLine('error', 'Parameter ID cannot be empty');
              break;
            }
            addLine('info', `Deleting parameter "${paramIdToDelete}" from device ${deviceId}...`);
            await remove(ref(realtimeDB, `temporaer/${deviceId}/${paramIdToDelete}`));
            addLine('info', `✓ Parameter "${paramIdToDelete}" deleted`);
          } catch (error) {
            addLine('error', `Failed to delete parameter: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'temp_clear':
          if (!canUseAdminCommands) {
            addLine('error', 'Access denied. This command requires super_admin or developer role.');
            break;
          }
          if (!deviceId || connectionStatus !== 'online') {
            addLine('error', 'No device connected. Use "connect <device_id>" first.');
            break;
          }
          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }
          if (parts.length < 2 || parts[1].toLowerCase() !== 'confirm') {
            addLine('error', 'Usage: temp_clear confirm');
            addLine('info', 'Deletes all entries under /temporaer/<device_id>');
            break;
          }
          try {
            addLine('info', `Deleting all temporaer entries for device ${deviceId}...`);
            await remove(ref(realtimeDB, `temporaer/${deviceId}`));
            addLine('info', `✓ temporaer/${deviceId} cleared`);
          } catch (error) {
            addLine('error', `Failed to clear temporaer: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        // ==================== DEVICE DATA COMMANDS ====================
        case 'cards':
          if (!deviceId || connectionStatus !== 'online') {
            addLine('error', 'No device connected. Use "connect <device_id>" first.');
            break;
          }
          addLine('info', 'Opening parameter cards viewer...');
          setWindowsState(prev => ({
            ...prev,
            cards: { ...prev.cards, isOpen: true, isHighlighted: false }
          }));
          setActiveWindowId('params');
          break;

        case 'chart': {
          if (!deviceId || connectionStatus !== 'online') {
            addLine('error', 'No device connected. Use "connect <device_id>" first.');
            break;
          }
          
          const timestamp = parts.length > 1 ? parts[1] : undefined;
          
          // Validate timestamp if provided
          if (timestamp) {
            const ts = parseInt(timestamp, 10);
            if (isNaN(ts) || ts < 0) {
              addLine('error', 'Invalid timestamp. Use a valid Unix timestamp.');
              break;
            }
            
            // Check if timestamp exists in available historical data
            if (historicalTimestamps.length > 0 && !historicalTimestamps.includes(timestamp)) {
              addLine('info', `Note: Timestamp ${timestamp} not found in available logs.`);
              addLine('info', 'Available timestamps:');
              historicalTimestamps.slice(0, 5).forEach(ts => {
                addLine('output', `  ${ts} - ${formatTimestampForDisplay(ts)}`);
              });
              if (historicalTimestamps.length > 5) {
                addLine('output', `  ... and ${historicalTimestamps.length - 5} more`);
              }
              break;
            }
            
            addLine('info', `Opening historical chart for ${formatTimestampForDisplay(timestamp)}...`);
          } else {
            addLine('info', 'Opening realtime chart viewer...');
          }
          
          // Create new chart window
          const newChartId = `chart-${++chartIdCounterRef.current}`;
          const openCharts = windowsState.charts.filter(c => c.isOpen);
          const newIndex = openCharts.length + 1;
          
          setWindowsState(prev => ({
            ...prev,
            charts: [
              ...prev.charts,
              {
                id: newChartId,
                index: newIndex,
                isOpen: true,
                isMinimized: false,
                isHighlighted: false,
                historicalTimestamp: timestamp,
              }
            ]
          }));
          setActiveWindowId(newChartId);
          
          addLine('info', `✓ Chart ${newIndex} opened${timestamp ? ' (historical)' : ' (realtime)'}`);
          break;
        }

        case 'luftstrom':
          if (!deviceId || connectionStatus !== 'online') {
            addLine('error', 'No device connected. Use "connect <device_id>" first.');
            break;
          }
          addLine('info', 'Opening air flow diagram...');
          setWindowsState(prev => ({
            ...prev,
            airflow: { ...prev.airflow, isOpen: true, isHighlighted: false }
          }));
          setActiveWindowId('airflow');
          break;

        case 'close': {
          if (parts.length < 2) {
            addLine('error', 'Usage: close <cards|chart|chart N|airflow|all>');
            break;
          }
          
          const windowToClose = parts[1].toLowerCase();
          const chartNumber = parts.length > 2 ? parseInt(parts[2], 10) : undefined;
          
          // Helper to close window immediately (highlight is already shown during typing)
          const closeWindow = (targetType: 'cards' | 'airflow' | 'chart', chartIdx?: number) => {
            if (targetType === 'cards') {
              setWindowsState(prev => ({
                ...prev,
                cards: { ...prev.cards, isOpen: false, isHighlighted: false }
              }));
            } else if (targetType === 'airflow') {
              setWindowsState(prev => ({
                ...prev,
                airflow: { ...prev.airflow, isOpen: false, isHighlighted: false }
              }));
            } else if (targetType === 'chart' && chartIdx !== undefined) {
              setWindowsState(prev => ({
                ...prev,
                charts: prev.charts.filter((_, i) => i !== chartIdx)
              }));
            }
          };
          
          switch (windowToClose) {
            case 'cards':
            case 'params':
              if (windowsState.cards.isOpen) {
                closeWindow('cards');
                addLine('info', '✓ Cards window closed');
              } else {
                addLine('info', 'Cards window is not open');
              }
              break;
              
            case 'chart': {
              const openCharts = windowsState.charts.filter(c => c.isOpen);
              
              if (chartNumber !== undefined) {
                // Close specific chart by number
                if (chartNumber < 1 || chartNumber > openCharts.length) {
                  addLine('error', `Invalid chart number. Open charts: ${openCharts.length}`);
                  break;
                }
                const chartIdx = windowsState.charts.findIndex(c => 
                  c.isOpen && windowsState.charts.filter(x => x.isOpen).indexOf(c) === chartNumber - 1
                );
                if (chartIdx >= 0) {
                  closeWindow('chart', chartIdx);
                  addLine('info', `✓ Chart ${chartNumber} closed`);
                }
              } else if (openCharts.length === 1) {
                // Close the only chart
                const chartIdx = windowsState.charts.findIndex(c => c.isOpen);
                if (chartIdx >= 0) {
                  closeWindow('chart', chartIdx);
                  addLine('info', '✓ Chart window closed');
                }
              } else if (openCharts.length > 1) {
                addLine('error', `Multiple charts open (${openCharts.length}). Use "close chart N" to close a specific chart.`);
                openCharts.forEach((c, idx) => {
                  const type = c.historicalTimestamp ? 'historical' : 'realtime';
                  addLine('output', `  Chart ${idx + 1}: ${type}`);
                });
              } else {
                addLine('info', 'No chart windows are open');
              }
              break;
            }
              
            case 'airflow':
            case 'luftstrom':
              if (windowsState.airflow.isOpen) {
                closeWindow('airflow');
                addLine('info', '✓ Airflow window closed');
              } else {
                addLine('info', 'Airflow window is not open');
              }
              break;
              
            case 'all':
              // Close all without highlight
              setWindowsState(prev => ({
                ...prev,
                cards: { ...prev.cards, isOpen: false, isHighlighted: false },
                airflow: { ...prev.airflow, isOpen: false, isHighlighted: false },
                charts: []
              }));
              setActiveWindowId('terminal');
              addLine('info', '✓ Closed all windows');
              break;
              
            default:
              // Check if it's "chart N" without space
              const chartMatch = windowToClose.match(/^chart(\d+)$/);
              if (chartMatch) {
                const num = parseInt(chartMatch[1], 10);
                const openCharts = windowsState.charts.filter(c => c.isOpen);
                if (num >= 1 && num <= openCharts.length) {
                  const chartIdx = windowsState.charts.findIndex(c => 
                    c.isOpen && windowsState.charts.filter(x => x.isOpen).indexOf(c) === num - 1
                  );
                  if (chartIdx >= 0) {
                    closeWindow('chart', chartIdx);
                    addLine('info', `✓ Chart ${num} closed`);
                    break;
                  }
                }
              }
              addLine('error', `Unknown window: ${windowToClose}`);
              addLine('info', 'Available: cards, chart, chart N, airflow, all');
          }
          break;
        }

        case 'stop':
          if (monitoringIntervalRef.current) {
            clearInterval(monitoringIntervalRef.current);
            monitoringIntervalRef.current = null;
            addLine('info', '✓ Monitoring stopped');
          }
          if (scriptRunningRef.current) {
            scriptCancelRef.current = true;
            addLine('info', '✓ Script stop requested');
          }
          if (!monitoringIntervalRef.current && !scriptRunningRef.current) {
            addLine('info', 'No active monitoring or script to stop');
          }
          break;

        case 'snake':
          if (snakeActive) {
            addLine('info', 'Snake is already running. Press ESC to exit.');
            break;
          }
          if (typingActive) {
            addLine('info', 'Typing game is running. Finish it or press ESC to stop.');
            break;
          }
          if (game2048Active) {
            addLine('info', '2048 is running. Finish it or press ESC to stop.');
            break;
          }
          addLine('info', 'Starting Snake... Use arrow keys. ESC to exit.');
          setSnakeActive(true);
          break;

        case 'type_race':
          if (typingActive) {
            addLine('info', 'Typing game is already running. Press ESC to stop.');
            break;
          }
          if (snakeActive) {
            addLine('info', 'Snake is running. Press ESC to exit first.');
            break;
          }
          if (game2048Active) {
            addLine('info', '2048 is running. Press ESC to exit first.');
            break;
          }
          {
            const shuffled = [...typingWordBank].sort(() => Math.random() - 0.5);
            const words = shuffled.slice(0, 10);
            typingWordsRef.current = words;
            typingIndexRef.current = 0;
            typingCorrectRef.current = 0;
            typingStartTimeRef.current = Date.now();
            setTypingCurrentWord(words[0]);
            setTypingProgress({ index: 0, total: 10, correct: 0 });
            setTypingActive(true);
            addLine('info', 'Type Race started. Type the word and press Enter. ESC to stop.');
          }
          break;

        case '2048':
          if (game2048Active) {
            addLine('info', '2048 is already running. Press ESC to exit.');
            break;
          }
          if (snakeActive || typingActive) {
            addLine('info', 'Another game is running. Finish it or press ESC to stop.');
            break;
          }
          {
            const spawnTile = (board: number[][]) => {
              const emptyCells: Array<{ r: number; c: number }> = [];
              for (let r = 0; r < 4; r += 1) {
                for (let c = 0; c < 4; c += 1) {
                  if (board[r][c] === 0) emptyCells.push({ r, c });
                }
              }
              if (emptyCells.length === 0) return board;
              const picked = emptyCells[Math.floor(Math.random() * emptyCells.length)];
              const next = board.map(row => [...row]);
              next[picked.r][picked.c] = Math.random() < 0.9 ? 2 : 4;
              return next;
            };
            const empty = Array.from({ length: 4 }, () => Array(4).fill(0)) as number[][];
            const initBoard = spawnTile(spawnTile(empty));
            setGame2048Board(initBoard);
          }
          setGame2048Score(0);
          game2048WonRef.current = false;
          setGame2048Active(true);
          addLine('info', 'Starting 2048... Use arrow keys. ESC to exit.');
          break;

        case 'rigfetch':
          {
            const prevOverride = silentInfoOverrideRef.current;
            silentInfoOverrideRef.current = true;
            emitRigfetch();
            silentInfoOverrideRef.current = prevOverride;
          }
          break;

        case 'min': {
          if (parts.length < 2) {
            addLine('error', 'Usage: min <terminal|cards|chart|chart N|airflow>');
            break;
          }
          
          const target = parts[1].toLowerCase();
          const chartNum = parts.length > 2 ? parseInt(parts[2], 10) : undefined;
          
          if (target === 'terminal') {
            setWindowsState(prev => ({
              ...prev,
              terminal: { isMinimized: true }
            }));
            addLine('info', '✓ Terminal minimized');
          } else if (target === 'cards') {
            if (!windowsState.cards.isOpen) {
              addLine('info', 'Cards window is not open');
            } else if (windowsState.cards.isMinimized) {
              addLine('info', 'Cards window is already minimized');
            } else {
              setWindowsState(prev => ({
                ...prev,
                cards: { ...prev.cards, isMinimized: true }
              }));
              addLine('info', '✓ Cards window minimized');
            }
          } else if (target === 'airflow' || target === 'luftstrom') {
            if (!windowsState.airflow.isOpen) {
              addLine('info', 'Airflow window is not open');
            } else if (windowsState.airflow.isMinimized) {
              addLine('info', 'Airflow window is already minimized');
            } else {
              setWindowsState(prev => ({
                ...prev,
                airflow: { ...prev.airflow, isMinimized: true }
              }));
              addLine('info', '✓ Airflow window minimized');
            }
          } else if (target === 'chart' || target.match(/^chart\d+$/)) {
            const openCharts = windowsState.charts.filter(c => c.isOpen);
            let chartIndex = chartNum;
            
            // Handle "chartN" format
            const match = target.match(/^chart(\d+)$/);
            if (match) {
              chartIndex = parseInt(match[1], 10);
            }
            
            if (chartIndex !== undefined) {
              if (chartIndex < 1 || chartIndex > openCharts.length) {
                addLine('error', `Invalid chart number. Open charts: ${openCharts.length}`);
              } else {
                const idx = windowsState.charts.findIndex(c => 
                  c.isOpen && windowsState.charts.filter(x => x.isOpen).indexOf(c) === chartIndex! - 1
                );
                if (idx >= 0) {
                  if (windowsState.charts[idx].isMinimized) {
                    addLine('info', `Chart ${chartIndex} is already minimized`);
                  } else {
                    setWindowsState(prev => ({
                      ...prev,
                      charts: prev.charts.map((c, i) => 
                        i === idx ? { ...c, isMinimized: true } : c
                      )
                    }));
                    addLine('info', `✓ Chart ${chartIndex} minimized`);
                  }
                }
              }
            } else if (openCharts.length === 1) {
              const idx = windowsState.charts.findIndex(c => c.isOpen);
              if (idx >= 0) {
                if (windowsState.charts[idx].isMinimized) {
                  addLine('info', 'Chart is already minimized');
                } else {
                  setWindowsState(prev => ({
                    ...prev,
                    charts: prev.charts.map((c, i) => 
                      i === idx ? { ...c, isMinimized: true } : c
                    )
                  }));
                  addLine('info', '✓ Chart minimized');
                }
              }
            } else if (openCharts.length > 1) {
              addLine('error', `Multiple charts open (${openCharts.length}). Use "min chart N".`);
            } else {
              addLine('info', 'No chart windows are open');
            }
          } else {
            addLine('error', `Unknown window: ${target}`);
            addLine('info', 'Available: terminal, cards, chart, chart N, airflow');
          }
          break;
        }

        case 'max': {
          if (parts.length < 2) {
            addLine('error', 'Usage: max <terminal|cards|chart|chart N|airflow>');
            break;
          }
          
          const target = parts[1].toLowerCase();
          const chartNum = parts.length > 2 ? parseInt(parts[2], 10) : undefined;
          
          if (target === 'terminal') {
            if (!windowsState.terminal.isMinimized) {
              addLine('info', 'Terminal is already maximized');
            } else {
              setWindowsState(prev => ({
                ...prev,
                terminal: { isMinimized: false }
              }));
              addLine('info', '✓ Terminal restored');
            }
          } else if (target === 'cards') {
            if (!windowsState.cards.isOpen) {
              addLine('info', 'Cards window is not open');
            } else if (!windowsState.cards.isMinimized) {
              addLine('info', 'Cards window is already maximized');
            } else {
              setWindowsState(prev => ({
                ...prev,
                cards: { ...prev.cards, isMinimized: false }
              }));
              addLine('info', '✓ Cards window restored');
            }
          } else if (target === 'airflow' || target === 'luftstrom') {
            if (!windowsState.airflow.isOpen) {
              addLine('info', 'Airflow window is not open');
            } else if (!windowsState.airflow.isMinimized) {
              addLine('info', 'Airflow window is already maximized');
            } else {
              setWindowsState(prev => ({
                ...prev,
                airflow: { ...prev.airflow, isMinimized: false }
              }));
              addLine('info', '✓ Airflow window restored');
            }
          } else if (target === 'chart' || target.match(/^chart\d+$/)) {
            const openCharts = windowsState.charts.filter(c => c.isOpen);
            let chartIndex = chartNum;
            
            // Handle "chartN" format
            const match = target.match(/^chart(\d+)$/);
            if (match) {
              chartIndex = parseInt(match[1], 10);
            }
            
            if (chartIndex !== undefined) {
              if (chartIndex < 1 || chartIndex > openCharts.length) {
                addLine('error', `Invalid chart number. Open charts: ${openCharts.length}`);
              } else {
                const idx = windowsState.charts.findIndex(c => 
                  c.isOpen && windowsState.charts.filter(x => x.isOpen).indexOf(c) === chartIndex! - 1
                );
                if (idx >= 0) {
                  if (!windowsState.charts[idx].isMinimized) {
                    addLine('info', `Chart ${chartIndex} is already maximized`);
                  } else {
                    setWindowsState(prev => ({
                      ...prev,
                      charts: prev.charts.map((c, i) => 
                        i === idx ? { ...c, isMinimized: false } : c
                      )
                    }));
                    addLine('info', `✓ Chart ${chartIndex} restored`);
                  }
                }
              }
            } else if (openCharts.length === 1) {
              const idx = windowsState.charts.findIndex(c => c.isOpen);
              if (idx >= 0) {
                if (!windowsState.charts[idx].isMinimized) {
                  addLine('info', 'Chart is already maximized');
                } else {
                  setWindowsState(prev => ({
                    ...prev,
                    charts: prev.charts.map((c, i) => 
                      i === idx ? { ...c, isMinimized: false } : c
                    )
                  }));
                  addLine('info', '✓ Chart restored');
                }
              }
            } else if (openCharts.length > 1) {
              addLine('error', `Multiple charts open (${openCharts.length}). Use "max chart N".`);
            } else {
              addLine('info', 'No chart windows are open');
            }
          } else {
            addLine('error', `Unknown window: ${target}`);
            addLine('info', 'Available: terminal, cards, chart, chart N, airflow');
          }
          break;
        }

        case 'tile':
          // Control tiling window manager
          if (parts.length < 2) {
            // Show current state
            addLine('info', `Tiling: ${tiling.tilingEnabled ? 'ON' : 'OFF'}`);
            addLine('info', `Layout: ${tiling.layoutMode}`);
            addLine('info', `Open windows: ${tiling.openWindows.join(', ') || 'none'}`);
            addLine('info', '');
            addLine('info', 'Usage: tile [on|off|h|v|grid]');
            addLine('info', '  on    - Enable tiling');
            addLine('info', '  off   - Disable tiling');
            addLine('info', '  h     - Horizontal layout (side by side)');
            addLine('info', '  v     - Vertical layout (stacked)');
            addLine('info', '  grid  - Grid layout');
            break;
          }
          
          const tileArg = parts[1].toLowerCase();
          switch (tileArg) {
            case 'on':
              tiling.setTilingEnabled(true);
              addLine('info', '✓ Tiling enabled');
              break;
            case 'off':
              tiling.setTilingEnabled(false);
              addLine('info', '✓ Tiling disabled');
              break;
            case 'h':
            case 'horizontal':
              tiling.setLayoutMode('horizontal');
              addLine('info', '✓ Layout: horizontal (side by side)');
              break;
            case 'v':
            case 'vertical':
              tiling.setLayoutMode('vertical');
              addLine('info', '✓ Layout: vertical (stacked)');
              break;
            case 'grid':
              tiling.setLayoutMode('grid');
              addLine('info', '✓ Layout: grid');
              break;
            default:
              addLine('error', `Unknown tile argument: ${tileArg}`);
              addLine('info', 'Use: tile [on|off|h|v|grid]');
          }
          break;

        case 'opacity':
          // Toggle or set window opacity
          if (parts.length < 2) {
            // Toggle between 1 and 0.2
            if (tiling.windowOpacity === 1) {
              tiling.setWindowOpacity(0.2);
              addLine('info', '✓ Window opacity: 0.2 (transparent)');
            } else {
              tiling.setWindowOpacity(1);
              addLine('info', '✓ Window opacity: 1 (solid)');
            }
            break;
          }
          
          const opacityValue = parseFloat(parts[1]);
          if (isNaN(opacityValue) || opacityValue < 0.1 || opacityValue > 1) {
            addLine('error', 'Opacity must be a number between 0.1 and 1.0');
            break;
          }
          
          tiling.setWindowOpacity(opacityValue);
          addLine('info', `✓ Window opacity: ${opacityValue}`);
          break;

        case 'stove_status': {
          // Show current stove status
          if (!deviceId || connectionStatus !== 'online') {
            addLine('error', 'No device connected. Use "connect <device_id>" first.');
            break;
          }
          
          // Helper to display status
          const showStatus = () => {
            const data = useStoveStore.getState().currentData;
            const t = data.T;
            const sl = data.PL;
            const rl = data.SL;
            const bp = data.F;
            
            const bpLabels: Record<number, string> = {
              1: 'Anheizen', 2: 'Abbrand', 3: 'Nachlegen', 4: 'Aufheizen', 5: 'Ausgehen'
            };
            const phase = typeof bp === 'number' ? (bpLabels[bp] || `Phase ${bp}`) : '—';
            const fmt = (v: any, s: string = '') => v !== undefined && v !== null ? `${v}${s}` : '—';
            
            const ln = '─'.repeat(24);
            const rw = (label: string, value: string) => `  ${label.padEnd(14)} ${value}`;
            const ts = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            
            addLine('info', '');
            addLine('output', `  ${ln}`);
            addLine('output', `STOVE STATUS [${ts}]`);
            addLine('output', `  ${ln}`);
            addLine('output', rw('Temp:', fmt(t, '°C')));
            addLine('output', rw('Scheibenluft:', fmt(sl, '%')));
            addLine('output', rw('Rückwandluft:', fmt(rl, '%')));
            addLine('output', rw('Brennphase:', phase));
            addLine('output', `  ${ln}`);
          };
          
          // Check for duration and interval parameters
          const durationSec = parts.length > 1 ? parseInt(parts[1], 10) : 0;
          const intervalSec = parts.length > 2 ? parseInt(parts[2], 10) : 5; // default 5 seconds
          
          if (durationSec > 0) {
            // Stop any existing monitoring
            if (monitoringIntervalRef.current) {
              clearInterval(monitoringIntervalRef.current);
            }
            
            const intervalMs = Math.max(1, intervalSec) * 1000; // minimum 1 second
            const endTime = Date.now() + durationSec * 1000;
            
            addLine('info', `Monitoring for ${durationSec}s (every ${intervalSec}s). Use "stop" to cancel.`);
            showStatus();
            
            monitoringIntervalRef.current = setInterval(() => {
              if (Date.now() >= endTime) {
                if (monitoringIntervalRef.current) {
                  clearInterval(monitoringIntervalRef.current);
                  monitoringIntervalRef.current = null;
                }
                addLine('info', '✓ Monitoring complete');
                return;
              }
              showStatus();
            }, intervalMs);
          } else {
            showStatus();
          }
          
          addLine('info', '');
          break;
        }

        case 'd':
          // Toggle or set "Alle Werte" (d flag) - controls whether device sends all parameter values
          if (!deviceId || connectionStatus !== 'online') {
            addLine('error', 'No device connected. Use "connect <device_id>" first.');
            break;
          }

          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }

          try {
            // Get current value
            const currentDRaw = (deviceConfig as any)?.d;
            let currentD = false;
            if (typeof currentDRaw === 'boolean') currentD = currentDRaw;
            else if (typeof currentDRaw === 'number') currentD = currentDRaw !== 0;
            else if (typeof currentDRaw === 'string') {
              const s = currentDRaw.trim().toLowerCase();
              currentD = s === 'true' || s === '1' || s === 'yes' || s === 'ja';
            }

            // Determine new value
            let newD: boolean;
            if (parts.length >= 2) {
              const arg = parts[1].toLowerCase();
              if (arg === 'true' || arg === '1' || arg === 'on' || arg === 'yes' || arg === 'ja') {
                newD = true;
              } else if (arg === 'false' || arg === '0' || arg === 'off' || arg === 'no' || arg === 'nein') {
                newD = false;
              } else {
                addLine('error', 'Invalid value. Use: d [true|false|on|off|1|0]');
                addLine('info', `Current state: Alle Werte = ${currentD ? 'ON' : 'OFF'}`);
                break;
              }
            } else {
              // Toggle
              newD = !currentD;
            }

            // Ensure active client is registered
            try { await ensureActiveClientPresent(deviceId); } catch {}

            // Update Firebase
            await set(ref(realtimeDB, `konstant/${deviceId}/d`), newD);
            addLine('info', `✓ Alle Werte (d) set to: ${newD ? 'ON' : 'OFF'}`);
            addLine('output', newD 
              ? 'Device will now send ALL parameter values.' 
              : 'Device will only send app-subscribed values.');
          } catch (error) {
            addLine('error', `Failed to update Alle Werte: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        case 'k':
          // Toggle or set "Nur App-Werte" (k_manual flag) - increments k counter for app-only mode
          if (!deviceId || connectionStatus !== 'online') {
            addLine('error', 'No device connected. Use "connect <device_id>" first.');
            break;
          }

          if (!realtimeDB) {
            addLine('error', 'Database not initialized');
            break;
          }

          try {
            // Get current k_manual value
            const currentKManualRaw = (deviceConfig as any)?.k_manual;
            let currentKManual = false;
            if (typeof currentKManualRaw === 'boolean') currentKManual = currentKManualRaw;
            else if (typeof currentKManualRaw === 'number') currentKManual = currentKManualRaw !== 0;
            else if (typeof currentKManualRaw === 'string') {
              const s = currentKManualRaw.trim().toLowerCase();
              currentKManual = s === 'true' || s === '1' || s === 'yes' || s === 'ja';
            }

            // Determine new value
            let newKManual: boolean;
            if (parts.length >= 2) {
              const arg = parts[1].toLowerCase();
              if (arg === 'true' || arg === '1' || arg === 'on' || arg === 'yes' || arg === 'ja') {
                newKManual = true;
              } else if (arg === 'false' || arg === '0' || arg === 'off' || arg === 'no' || arg === 'nein') {
                newKManual = false;
              } else {
                addLine('error', 'Invalid value. Use: k [true|false|on|off|1|0]');
                addLine('info', `Current state: Nur App-Werte = ${currentKManual ? 'ON' : 'OFF'}`);
                break;
              }
            } else {
              // Toggle
              newKManual = !currentKManual;
            }

            // Ensure active client is registered
            try { await ensureActiveClientPresent(deviceId); } catch {}

            // Update Firebase using transaction
            const kManualRef = ref(realtimeDB, `konstant/${deviceId}/k_manual`);
            await runTransaction(kManualRef, () => newKManual);
            
            addLine('info', `✓ Nur App-Werte (k_manual) set to: ${newKManual ? 'ON' : 'OFF'}`);
            addLine('output', newKManual 
              ? 'App-only values mode enabled (+1 to k counter).' 
              : 'App-only values mode disabled.');
          } catch (error) {
            addLine('error', `Failed to update Nur App-Werte: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          break;

        default:
          addLine('error', `Unknown command: ${cmd}`);
          addLine('info', 'Type "help" for available commands');
          break;
      }
    } catch (error) {
      addLine('error', `Command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      trackCommandErrorsRef.current = previousTracking;
    }
    return !commandErrorRef.current;
  }, [deviceId, addLine, user, canUseAdminCommands, getAllUsers, updateUserRole, toggleUserActive, toggleUserForceSimpleMode, toggleUserDealerMode, createUser, users, connect, disconnect, connectionStatus, deviceConfig, ensureActiveClientPresent, windowsState, historicalTimestamps, formatTimestampForDisplay, snakeActive, typingActive, game2048Active, typingWordBank, parseDurationMs, sleepCancelableMs, presets, persistPresets, expandScriptCommands, interpolateVariables, evaluateCondition, parseIfCommand, parseTryCommand, parseBlockAt, openEditor, resolveDeviceParam, formatLogTimestamp, history, parseTokenList, getAllDeviceIds, evaluateCollectCondition, setScriptVarValue, parseFirebaseLiteral, formatFirebaseValuePreview, buildFirebaseTreeLines, stripQuotes, evaluateMathExpression, resolveVarToken, stringifyScriptValue]);

  useEffect(() => {
    executeSingleCommandRef.current = executeSingleCommand;
  }, [executeSingleCommand]);

  const executeCommand = useCallback(async (command: string) => {
    const trimmedCommand = command.trim();
    if (!trimmedCommand) return;

    const expanded = expandScriptCommands(trimmedCommand, { steps: 0 });
    if (expanded.error) {
      addLine('error', expanded.error);
      return;
    }

    const isScriptInput = expanded.commands.length > 1 || /^repeat\s+/i.test(trimmedCommand) || /^if\s+/i.test(trimmedCommand);
    if (!isScriptInput) {
      await executeSingleCommand(trimmedCommand);
      return;
    }

    scriptCancelRef.current = false;
    scriptRunningRef.current = true;
    scriptSilentEchoRef.current = silentScriptEcho;
    scriptProgressRef.current = { total: expanded.commands.length, done: 0 };
    setCommandHistory(prev => {
      const updated = [trimmedCommand, ...prev.filter(cmd => cmd !== trimmedCommand)];
      return updated.slice(0, 50);
    });

    if (expanded.commands.length === 0) {
      addLine('info', 'No commands to execute');
      scriptRunningRef.current = false;
      scriptSilentEchoRef.current = false;
      return;
    }

    addLine('info', `Running script: ${expanded.commands.length} command(s)`);
    for (const cmdLine of expanded.commands) {
      if (scriptCancelRef.current) {
        addLine('info', 'Script cancelled');
        scriptRunningRef.current = false;
        scriptProgressRef.current = null;
        scriptSilentEchoRef.current = false;
        return;
      }
      await executeSingleCommandRef.current?.(cmdLine, { silentHistory: true });
      if (scriptProgressRef.current) {
        scriptProgressRef.current.done += 1;
      }
    }
    scriptRunningRef.current = false;
    scriptSilentEchoRef.current = false;
    scriptProgressRef.current = null;
    addLine('info', '✓ Script completed');
  }, [addLine, executeSingleCommand, expandScriptCommands, silentScriptEcho]);

  const handleEditorRun = useCallback(() => {
    const script = (rigopsMode ? rigopsBody : editorValue).trim();
    if (!script) return;
    setLastEditorScript(editorValue);
    emitWarnings(rigopsWarnings, 'Script');
    executeCommand(script);
    setInput('');
    setHistoryIndex(-1);
    setSelectedSuggestionIndex(0);
  }, [editorValue, executeCommand, rigopsBody, rigopsMode, rigopsWarnings, emitWarnings]);

  const handleEditorFileLoaded = useCallback((fileName: string, text: string) => {
    setEditorValue(text);
    setLastEditorScript(text);
    setIsEditorOpen(true);
    setActiveWindowId('code');
    const isRigopsFile = fileName.toLowerCase().endsWith('.rigops');
    setRigopsMode(isRigopsFile);
    addLine('info', `Loaded script: ${fileName} (${Math.max(0, text.length)} chars)`);
  }, [addLine]);

  const renderSnakeGrid = useCallback((width: number, height: number) => {
    const grid: string[] = [];
    const body = snakeBodyRef.current;
    const food = snakeFoodRef.current;
    const bodySet = new Set(body.map(p => `${p.x},${p.y}`));

    const horizontal = '#'.repeat(width + 2);
    grid.push(horizontal);
    for (let y = 0; y < height; y++) {
      let row = '#';
      for (let x = 0; x < width; x++) {
        const key = `${x},${y}`;
        if (bodySet.has(key)) {
          row += 'O';
        } else if (food && food.x === x && food.y === y) {
          row += '*';
        } else {
          row += ' ';
        }
      }
      row += '#';
      grid.push(row);
    }
    grid.push(horizontal);
    setSnakeGridLines(grid);
    setSnakeScore(snakeScoreRef.current);
  }, []);

  const resetSnakeGame = useCallback(() => {
    const width = 20;
    const height = 10;
    const startX = Math.floor(width / 2);
    const startY = Math.floor(height / 2);
    snakeBodyRef.current = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ];
    snakeDirectionRef.current = 'right';
    snakeNextDirectionRef.current = 'right';
    snakeScoreRef.current = 0;

    const spawnFood = () => {
      let fx = 0;
      let fy = 0;
      const occupied = new Set(snakeBodyRef.current.map(p => `${p.x},${p.y}`));
      do {
        fx = Math.floor(Math.random() * width);
        fy = Math.floor(Math.random() * height);
      } while (occupied.has(`${fx},${fy}`));
      snakeFoodRef.current = { x: fx, y: fy };
    };
    spawnFood();
    renderSnakeGrid(width, height);
  }, [renderSnakeGrid]);

  useEffect(() => {
    if (!snakeActive) {
      if (snakeIntervalRef.current) {
        clearInterval(snakeIntervalRef.current);
        snakeIntervalRef.current = null;
      }
      return;
    }

    const width = 20;
    const height = 10;
    resetSnakeGame();

    snakeIntervalRef.current = setInterval(() => {
      const currentDir = snakeDirectionRef.current;
      const nextDir = snakeNextDirectionRef.current;
      if (currentDir !== nextDir) {
        snakeDirectionRef.current = nextDir;
      }

      const head = snakeBodyRef.current[0];
      const nextHead = { x: head.x, y: head.y };
      switch (snakeDirectionRef.current) {
        case 'up':
          nextHead.y -= 1;
          break;
        case 'down':
          nextHead.y += 1;
          break;
        case 'left':
          nextHead.x -= 1;
          break;
        case 'right':
          nextHead.x += 1;
          break;
      }

      // Wall collision
      if (nextHead.x < 0 || nextHead.x >= width || nextHead.y < 0 || nextHead.y >= height) {
        setSnakeActive(false);
        addLine('info', `Game over. Score: ${snakeScoreRef.current}`);
        return;
      }

      const bodySet = new Set(snakeBodyRef.current.map(p => `${p.x},${p.y}`));
      if (bodySet.has(`${nextHead.x},${nextHead.y}`)) {
        setSnakeActive(false);
        addLine('info', `Game over. Score: ${snakeScoreRef.current}`);
        return;
      }

      snakeBodyRef.current.unshift(nextHead);
      const food = snakeFoodRef.current;
      if (food && nextHead.x === food.x && nextHead.y === food.y) {
        snakeScoreRef.current += 1;
        // spawn new food
        let fx = 0;
        let fy = 0;
        const occupied = new Set(snakeBodyRef.current.map(p => `${p.x},${p.y}`));
        do {
          fx = Math.floor(Math.random() * width);
          fy = Math.floor(Math.random() * height);
        } while (occupied.has(`${fx},${fy}`));
        snakeFoodRef.current = { x: fx, y: fy };
      } else {
        snakeBodyRef.current.pop();
      }

      renderSnakeGrid(width, height);
    }, 160);

    return () => {
      if (snakeIntervalRef.current) {
        clearInterval(snakeIntervalRef.current);
        snakeIntervalRef.current = null;
      }
    };
  }, [snakeActive, resetSnakeGame, renderSnakeGrid, addLine]);

  const render2048Grid = useCallback((board: number[][]) => {
    const border = '+------+------+------+------+';
    const lines: string[] = [border];
    board.forEach((row) => {
      const cells = row.map((n) => (n === 0 ? '      ' : String(n).padStart(6, ' ')));
      lines.push(`|${cells[0]}|${cells[1]}|${cells[2]}|${cells[3]}|`);
      lines.push(border);
    });
    return lines;
  }, []);

  const spawn2048Tile = useCallback((board: number[][]) => {
    const empty: Array<{ r: number; c: number }> = [];
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        if (board[r][c] === 0) empty.push({ r, c });
      }
    }
    if (empty.length === 0) return board;
    const pick = empty[Math.floor(Math.random() * empty.length)];
    const next = board.map(row => [...row]);
    next[pick.r][pick.c] = Math.random() < 0.9 ? 2 : 4;
    return next;
  }, []);

  const canMove2048 = useCallback((board: number[][]) => {
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        const value = board[r][c];
        if (value === 0) return true;
        if (r < 3 && board[r + 1][c] === value) return true;
        if (c < 3 && board[r][c + 1] === value) return true;
      }
    }
    return false;
  }, []);

  const move2048 = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    const reverse = (arr: number[]) => [...arr].reverse();
    const transpose = (matrix: number[][]) => matrix[0].map((_, col) => matrix.map(row => row[col]));

    const collapseLeft = (row: number[]) => {
      const compact = row.filter(v => v !== 0);
      const merged: number[] = [];
      let gained = 0;
      for (let i = 0; i < compact.length; i += 1) {
        if (i + 1 < compact.length && compact[i] === compact[i + 1]) {
          const doubled = compact[i] * 2;
          merged.push(doubled);
          gained += doubled;
          i += 1;
        } else {
          merged.push(compact[i]);
        }
      }
      while (merged.length < 4) merged.push(0);
      const moved = merged.some((v, idx) => v !== row[idx]);
      return { row: merged, gained, moved };
    };

    const board = game2048Board;
    if (board.length !== 4) return;

    let working = board.map(row => [...row]);
    if (direction === 'up' || direction === 'down') working = transpose(working);
    if (direction === 'right' || direction === 'down') working = working.map(reverse);

    let gainedTotal = 0;
    let anyMoved = false;
    const shifted = working.map((row) => {
      const next = collapseLeft(row);
      gainedTotal += next.gained;
      anyMoved = anyMoved || next.moved;
      return next.row;
    });

    let restored = shifted;
    if (direction === 'right' || direction === 'down') restored = restored.map(reverse);
    if (direction === 'up' || direction === 'down') restored = transpose(restored);

    if (!anyMoved) return;

    const spawned = spawn2048Tile(restored);
    const nextScore = game2048Score + gainedTotal;
    setGame2048Board(spawned);
    setGame2048Score(nextScore);

    if (!game2048WonRef.current && spawned.some(row => row.some(cell => cell >= 2048))) {
      game2048WonRef.current = true;
      addLine('info', `2048 reached! Score: ${nextScore}`);
    }

    if (!canMove2048(spawned)) {
      setGame2048Active(false);
      addLine('info', `2048 game over. Score: ${nextScore}`);
    }
  }, [addLine, canMove2048, game2048Board, game2048Score, spawn2048Tile]);

  const game2048GridLines = useMemo(() => (
    game2048Board.length === 4 ? render2048Grid(game2048Board) : []
  ), [game2048Board, render2048Grid]);

  useEffect(() => {
    if (!isOpen) return;

    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (typingActive || snakeActive || game2048Active) return;
      if (e.defaultPrevented) return;

      const hasOnlyAlt = e.altKey && !e.ctrlKey && !e.metaKey;
      const key = e.key.toLowerCase();

      if (hasOnlyAlt && (key === 'j' || key === 'k')) {
        e.preventDefault();
        cycleFocusedWindow(key === 'j' ? 1 : -1);
        return;
      }

      if (hasOnlyAlt && /^[1-9]$/.test(key)) {
        const index = Number(key) - 1;
        if (index >= 0 && index < openWindowOrder.length) {
          e.preventDefault();
          focusWindowById(openWindowOrder[index]);
        }
        return;
      }

      if (hasOnlyAlt && key === 'm') {
        e.preventDefault();
        toggleMinimizeById(activeWindowId);
        return;
      }

      if (hasOnlyAlt && key === 'w') {
        e.preventDefault();
        closeWindowById(activeWindowId);
        return;
      }

      if (hasOnlyAlt && key === 't') {
        e.preventDefault();
        cycleLayoutMode();
        return;
      }

      if (hasOnlyAlt && key === 'enter') {
        e.preventDefault();
        toggleMinimizeById(activeWindowId);
        return;
      }

      if (!e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'Escape' && activeWindowId !== 'terminal') {
        e.preventDefault();
        closeWindowById(activeWindowId);
      }
    };

    document.addEventListener('keydown', onGlobalKeyDown);
    return () => document.removeEventListener('keydown', onGlobalKeyDown);
  }, [
    isOpen,
    typingActive,
    snakeActive,
    game2048Active,
    activeWindowId,
    openWindowOrder,
    cycleFocusedWindow,
    focusWindowById,
    toggleMinimizeById,
    closeWindowById,
    cycleLayoutMode,
  ]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (game2048Active) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setGame2048Active(false);
        addLine('info', `2048 stopped. Score: ${game2048Score}`);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        move2048('up');
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        move2048('down');
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        move2048('left');
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        move2048('right');
        return;
      }
    }

    if (snakeActive) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSnakeActive(false);
        addLine('info', `Snake stopped. Score: ${snakeScoreRef.current}`);
        return;
      }
      const current = snakeDirectionRef.current;
      if (e.key === 'ArrowUp' && current !== 'down') {
        e.preventDefault();
        snakeNextDirectionRef.current = 'up';
        return;
      }
      if (e.key === 'ArrowDown' && current !== 'up') {
        e.preventDefault();
        snakeNextDirectionRef.current = 'down';
        return;
      }
      if (e.key === 'ArrowLeft' && current !== 'right') {
        e.preventDefault();
        snakeNextDirectionRef.current = 'left';
        return;
      }
      if (e.key === 'ArrowRight' && current !== 'left') {
        e.preventDefault();
        snakeNextDirectionRef.current = 'right';
        return;
      }
    }

    if (typingActive) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setTypingActive(false);
        const elapsedMs = typingStartTimeRef.current ? Date.now() - typingStartTimeRef.current : 0;
        const elapsedSec = Math.max(0.1, elapsedMs / 1000);
        addLine('info', `Type race stopped. You typed ${typingCorrectRef.current} correct words in ${elapsedSec.toFixed(1)} seconds.`);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const typed = input.trim();
        const expected = typingWordsRef.current[typingIndexRef.current] || '';
        if (typed && expected && typed.toLowerCase() === expected.toLowerCase()) {
          typingCorrectRef.current += 1;
        }
        typingIndexRef.current += 1;
        if (typingIndexRef.current >= typingWordsRef.current.length) {
          const elapsedMs = typingStartTimeRef.current ? Date.now() - typingStartTimeRef.current : 0;
          const elapsedSec = Math.max(0.1, elapsedMs / 1000);
          setTypingActive(false);
          addLine('info', `You typed ${typingCorrectRef.current} correct words in ${elapsedSec.toFixed(1)} seconds!`);
          setInput('');
          return;
        }
        setTypingCurrentWord(typingWordsRef.current[typingIndexRef.current]);
        setTypingProgress({
          index: typingIndexRef.current,
          total: typingWordsRef.current.length,
          correct: typingCorrectRef.current
        });
        setInput('');
        return;
      }
    }

    // Tab - autocomplete
    if (e.key === 'Tab') {
      e.preventDefault();
      if (suggestions.length > 0) {
        applySuggestion(suggestions[selectedSuggestionIndex]);
      } else if (hint) {
        // If there's a hint but no suggestions, add a space for the next argument
        if (!input.endsWith(' ')) {
          setInput(input + ' ');
        }
      }
      return;
    }

    // Enter - execute command (Shift+Enter inserts newline)
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        return;
      }
      e.preventDefault();
      if (input.trim()) {
        executeCommand(input);
        setInput('');
        setHistoryIndex(-1);
        setSelectedSuggestionIndex(0);
      }
      return;
    }

    // Arrow navigation for suggestions or command history
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSelectedSuggestionIndex(prev => Math.max(0, prev - 1));
      } else if (commandHistory.length > 0) {
        const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex] || '');
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestions.length > 0) {
        setSelectedSuggestionIndex(prev => Math.min(suggestions.length - 1, prev + 1));
      } else if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex] || '');
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (activeWindowId === 'terminal') {
        onClose();
      } else {
        closeWindowById(activeWindowId);
      }
    }
  }, [game2048Active, game2048Score, move2048, snakeActive, typingActive, addLine, input, executeCommand, commandHistory, historyIndex, onClose, suggestions, selectedSuggestionIndex, applySuggestion, hint, activeWindowId, closeWindowById]);

  const formatTimestamp = (timestamp: Date) => {
    return timestamp.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      timeZone: 'Europe/Berlin' 
    });
  };

  if (!isOpen) return null;

  // Check permissions
  if (!hasPermission('manage_users') && user?.role !== 'developer') {
    return (
      <div className="fixed inset-0 bg-black/45 backdrop-blur-md p-4 flex items-center justify-center z-50">
        <div className="bg-card text-foreground rounded-lg p-6 max-w-md w-full mx-4 border-2 border-border shadow-theme-lg">
          <h3 className="text-lg font-semibold text-foreground mb-4">
            Access Denied
          </h3>
          <p className="text-muted-foreground mb-4">
            Terminal access is restricted to super_admin and developer roles only.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-destructive text-destructive-foreground rounded-none border border-border shadow-[3px_3px_0_0_var(--border)] hover:brightness-95"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 pointer-events-none" />
      <div className="fixed inset-0 z-50 p-4 pointer-events-none">
      <div
        ref={modalRef}
        data-window-id="terminal"
        onMouseDown={() => setActiveWindowId('terminal')}
        className={`bg-terminal rounded-theme-lg flex flex-col border shadow-theme-2xl pointer-events-auto ${activeWindowId === 'terminal' ? 'border-terminal-command' : 'border-terminal-border'}`}
        style={{ 
          position: 'absolute', 
          left: position.x, 
          top: position.y, 
          width: size.width, 
          height: windowsState.terminal.isMinimized ? 32 : size.height,
          opacity: tiling.windowOpacity,
          backdropFilter: tiling.windowOpacity < 1 ? 'blur(4px)' : undefined,
        }}
      >
        {/* Header - Linux/zsh style */}
        <div
          className={`flex items-center justify-between px-2 py-1 border-b border-terminal-border/50 bg-terminal-header ${windowsState.terminal.isMinimized ? 'rounded-theme-lg' : 'rounded-t-theme-lg'} cursor-move select-none relative z-10`}
          onMouseDown={onHeaderMouseDown}
        >
          <div className="flex items-center gap-1 font-mono text-[11px]">
            <span className="text-terminal-success">┌─</span>
            <span className="text-terminal-command">[</span>
            <span className="text-terminal-prompt">{user?.email?.split('@')[0] || 'user'}</span>
            <span className="text-muted-foreground">@</span>
            <span className="text-terminal-prompt">rigops</span>
            <span className="text-terminal-command">]</span>
            {deviceId && (
              <>
                <span className="text-muted-foreground">:</span>
                <span className="text-terminal-warning/80">~/{deviceId}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {/* Minimize/Maximize button */}
            <button
              onClick={(e) => { 
                e.stopPropagation(); 
                setWindowsState(prev => ({
                  ...prev,
                  terminal: { isMinimized: !prev.terminal.isMinimized }
                }));
              }}
              className="text-muted-foreground hover:text-terminal-warning text-xs px-1.5 py-0.5 rounded-theme-sm hover:bg-terminal-border/30 transition-colors font-mono relative z-20"
              title={windowsState.terminal.isMinimized ? 'Expand' : 'Minimize'}
            >
              {windowsState.terminal.isMinimized ? '[▲]' : '[─]'}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="text-muted-foreground hover:text-terminal-error text-xs px-1.5 py-0.5 rounded-theme-sm hover:bg-terminal-border/30 transition-colors font-mono relative z-20"
              title="Close (ESC)"
            >
              [×]
            </button>
          </div>
        </div>

        {/* Terminal Content - only show when not minimized */}
        {!windowsState.terminal.isMinimized && (
          <>
            <div 
              ref={terminalRef}
              className="flex-1 px-3 py-2 bg-terminal text-terminal-success font-mono text-xs overflow-y-auto space-y-0.5"
            >
              {history.map((line, index) => (
                <div key={index} className="flex items-start gap-2">
                  <span className="text-muted-foreground text-[10px] w-14 flex-shrink-0 opacity-60">
                    {formatTimestamp(line.timestamp)}
                  </span>
                  <span className={`flex-1 ${
                    line.type === 'command' ? 'text-terminal-foreground font-medium' :
                    line.type === 'error' ? 'text-terminal-error' :
                    line.type === 'info' ? 'text-terminal-command' :
                    'text-terminal-success'
                  }`}>
                    {line.content || '\u00A0'}
                  </span>
                </div>
              ))}

              {/* Snake game (ASCII) */}
              {snakeActive && (
                <div className="mt-2">
                  <div className="text-terminal-command text-[10px] mb-1">
                    Snake • Score: {snakeScore}
                  </div>
                  <pre className="text-terminal-foreground text-[10px] leading-4">
                    {snakeGridLines.join('\n')}
                  </pre>
                </div>
              )}

              {/* Typing game */}
              {typingActive && (
                <div className="mt-2">
                  <div className="text-terminal-command text-[10px] mb-1">
                    Type Race • Word {typingProgress.index + 1}/{typingProgress.total} • Correct: {typingProgress.correct}
                  </div>
                  <div className="font-mono text-terminal-foreground text-sm">
                    {typingCurrentWord}
                  </div>
                </div>
              )}

              {/* 2048 game (ASCII) */}
              {game2048Active && (
                <div className="mt-2">
                  <div className="text-terminal-command text-[10px] mb-1">
                    2048 • Score: {game2048Score}
                  </div>
                  <pre className="text-terminal-foreground text-[10px] leading-4">
                    {game2048GridLines.join('\n')}
                  </pre>
                </div>
              )}
              
              {/* Input Line */}
              <div className="flex items-center gap-2 pt-1.5 relative">
                <span className="text-muted-foreground text-[10px] w-14 flex-shrink-0 opacity-60">
                  {formatTimestamp(new Date())}
                </span>
                <span className="text-terminal-prompt">$</span>
                <div className="flex-1 relative flex items-center gap-2">
                  {/* Suggestions Dropdown - positioned above input */}
                  {suggestions.length > 0 && (
                    <div 
                      ref={suggestionsRef}
                      className="absolute bottom-full left-0 mb-1 bg-terminal-header border border-terminal-border rounded-theme-md overflow-hidden shadow-theme-lg max-w-md z-20"
                    >
                      {suggestions.map((suggestion, index) => {
                        const isSelected = index === selectedSuggestionIndex;
                        const userInfo = users.find(u => u.email === suggestion);
                        const deviceComment = allDeviceIds.includes(suggestion) ? allDeviceComments[suggestion] : null;
                        // Check if suggestion is a historical timestamp
                        const isTimestamp = historicalTimestamps.includes(suggestion);
                        
                        return (
                          <div
                            key={suggestion}
                            onClick={() => applySuggestion(suggestion)}
                            className={`px-3 py-1.5 cursor-pointer flex items-center justify-between ${
                              isSelected 
                                ? 'bg-primary text-primary-foreground' 
                                : 'text-terminal-foreground hover:bg-terminal-border/50'
                            }`}
                          >
                            <span className="font-mono text-sm">{suggestion}</span>
                            {userInfo && (
                              <span className={`text-xs ml-3 ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                                {userInfo.displayName || 'No name'} • {USER_ROLE_CONFIGS[userInfo.role]?.name || userInfo.role}
                                {!userInfo.isActive && ' (inactive)'}
                              </span>
                            )}
                            {!userInfo && USER_ROLES.includes(suggestion as UserRole) && (
                              <span className={`text-xs ml-3 ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                                {USER_ROLE_CONFIGS[suggestion as UserRole]?.description}
                              </span>
                            )}
                            {deviceComment && (
                              <span className={`text-xs ml-3 truncate max-w-[200px] ${isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                                {deviceComment.substring(0, 30)}{deviceComment.length > 30 ? '...' : ''}
                              </span>
                            )}
                            {isTimestamp && (
                              <span className={`text-xs ml-3 ${isSelected ? 'text-primary-foreground' : 'text-warning/70'}`}>
                                {formatTimestampForDisplay(suggestion)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  
                  <div className="relative flex items-center flex-1">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      readOnly={snakeActive || game2048Active}
                      rows={1}
                      className="w-full bg-transparent text-terminal-success outline-none font-mono resize-none"
                      style={{ caretColor: '#4ade80' }}
                      placeholder={
                        snakeActive
                          ? 'Snake running... ESC to exit'
                          : game2048Active
                            ? '2048 running... use arrow keys, ESC to exit'
                          : typingActive
                            ? 'Type the word and press Enter'
                            : 'Enter command... (Shift+Enter for new line)'
                      }
                      autoComplete="off"
                      spellCheck="false"
                    />
                    {/* Inline hint (gray text after input) */}
                    {hint && input.length > 0 && !input.includes('\n') && (
                      <span
                        className="absolute inset-y-0 left-0 pointer-events-none font-mono text-muted-foreground whitespace-pre flex items-center"
                        style={{ paddingLeft: `${input.length + 4}ch` }}
                      >
                        {hint}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => openEditor()}
                    className="text-[10px] px-2 py-0.5 rounded-theme-sm border border-terminal-border/50 text-muted-foreground hover:text-terminal-command hover:bg-terminal-border/30 transition-colors font-mono"
                    title="Open editor"
                  >
                    edit
                  </button>
                </div>
              </div>
            </div>

            {/* Footer - compact */}
            <div className="px-3 py-1 border-t border-terminal-border/50 bg-terminal-header/80 rounded-b-theme-lg">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="opacity-70">Tab · ↑↓ · ESC · Alt+J/K · Alt+M/W/T · Alt+1..9</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-terminal-command/80">active: {activeWindowLabel}</span>
                  <label className="flex items-center gap-1 text-muted-foreground cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={silentScriptEcho}
                      onChange={(e) => setSilentScriptEcho(e.target.checked)}
                      className="accent-terminal-success"
                    />
                    <span className="text-[10px]">stilles Skript</span>
                  </label>
                  {canUseAdminCommands && (
                    <span className="text-accent-foreground/70">admin</span>
                  )}
                  <span className="font-mono text-muted-foreground">{user?.role}</span>
                </div>
              </div>
            </div>

            {/* Resize Handles - z-0 to stay below header */}
            <div
              className="absolute top-8 bottom-0 left-0 w-1 cursor-w-resize z-0"
              onMouseDown={beginResize({ n: false, s: false, e: false, w: true })}
            />
            <div
              className="absolute top-8 bottom-0 right-0 w-1 cursor-e-resize z-0"
              onMouseDown={beginResize({ n: false, s: false, e: true, w: false })}
            />
            <div
              className="absolute inset-x-0 bottom-0 h-1 cursor-s-resize z-0"
              onMouseDown={beginResize({ n: false, s: true, e: false, w: false })}
            />
            {/* Corners - only bottom */}
            <div
              className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-0"
              onMouseDown={beginResize({ n: false, s: true, e: false, w: true })}
            />
            <div
              className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize z-0"
              onMouseDown={beginResize({ n: false, s: true, e: true, w: false })}
            />
          </>
        )}
      </div>
      
      {/* Conditional + Suspense: nothing about Monaco is loaded until the
          dealer/dev opens the editor. fallback={null} keeps the page quiet
          while the chunk is in flight (~200-400 ms on a fast connection). */}
      {isEditorOpen && (
        <Suspense fallback={null}>
          <RigopsEditor
            isOpen
            value={editorValue}
            meta={rigopsMeta}
            warnings={rigopsWarnings}
            defaultMeta={getDefaultRigopsMeta()}
            onChange={setEditorValue}
            onClose={closeEditor}
            onApply={applyEditor}
            onRun={handleEditorRun}
            onFileLoaded={handleEditorFileLoaded}
          />
        </Suspense>
      )}

      {/* Parameter Cards Modal */}
      <ParameterCardsModal 
        isOpen={windowsState.cards.isOpen} 
        onActivate={() => setActiveWindowId('params')}
        onClose={() => setWindowsState(prev => ({
          ...prev,
          cards: { ...prev.cards, isOpen: false, isHighlighted: false }
        }))} 
      />
      
      {/* Chart Modals - multiple instances */}
      {windowsState.charts.map((chart, idx) => (
        chart.isOpen && (
          <ChartModal 
            key={chart.id}
            isOpen={chart.isOpen}
            chartId={chart.id}
            chartIndex={windowsState.charts.filter(c => c.isOpen).indexOf(chart) + 1}
            historicalTimestamp={chart.historicalTimestamp}
            isMinimized={chart.isMinimized}
            isHighlighted={chart.isHighlighted}
            onActivate={() => setActiveWindowId(chart.id)}
            onToggleMinimize={() => setWindowsState(prev => ({
              ...prev,
              charts: prev.charts.map((c, i) => 
                i === idx ? { ...c, isMinimized: !c.isMinimized } : c
              )
            }))}
            onClose={() => setWindowsState(prev => ({
              ...prev,
              charts: prev.charts.filter((_, i) => i !== idx)
            }))} 
          />
        )
      ))}

      {/* AirFlow Modal */}
      <AirFlowModal 
        isOpen={windowsState.airflow.isOpen} 
        onActivate={() => setActiveWindowId('airflow')}
        onClose={() => setWindowsState(prev => ({
          ...prev,
          airflow: { ...prev.airflow, isOpen: false, isHighlighted: false }
        }))} 
      />
      </div>
    </>
  );
};

export default Terminal; 