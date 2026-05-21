/**
 * Command Queue Utility
 * 
 * Manages a queue of Firebase commands with configurable delays between executions.
 * This prevents overwhelming the controller with rapid successive commands.
 * 
 * Features:
 * - Command verification (checks if command was executed by monitoring value changes)
 * - Automatic retry on failure
 * - Status notifications via custom events
 */

import { ref, set, onValue, off } from 'firebase/database';
import { realtimeDB } from '../lib/firebase';

type CommandExecutor = () => Promise<void>;

interface QueuedCommand {
  id: string;
  executor: CommandExecutor;
  timestamp: number;
  // Verification fields for SET commands
  paramId?: string;
  expectedValue?: string | number | boolean;
  verify?: boolean;
  retryCount?: number;
  maxRetries?: number;
}

class CommandQueueManager {
  private queue: QueuedCommand[] = [];
  private isProcessing: boolean = false;
  private defaultDelay: number = 500; // Default 500ms delay
  private lastExecutionTime: number = 0;

  /**
   * Set the default delay between commands
   * @param delayMs Delay in milliseconds (500-2000ms recommended)
   */
  setDefaultDelay(delayMs: number) {
    this.defaultDelay = Math.max(0, Math.min(delayMs, 5000));
  }

  /**
   * Get current default delay
   */
  getDefaultDelay(): number {
    return this.defaultDelay;
  }

  /**
   * Add a command to the queue
   * @param executor Function that executes the command
   * @param priority If true, adds to front of queue
   */
  async enqueue(executor: CommandExecutor, priority: boolean = false): Promise<void> {
    const command: QueuedCommand = {
      id: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      executor,
      timestamp: Date.now()
    };

    if (priority) {
      this.queue.unshift(command);
    } else {
      this.queue.push(command);
    }

    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Process the command queue with delays
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const command = this.queue.shift();
      if (!command) break;

      try {
        const timeSinceLastExecution = Date.now() - this.lastExecutionTime;
        const requiredDelay = Math.max(0, this.defaultDelay - timeSinceLastExecution);

        if (requiredDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, requiredDelay));
        }

        await command.executor();
        this.lastExecutionTime = Date.now();

      } catch (error) {
        console.error(`[CommandQueue] Command ${command.id} failed:`, error);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Get current queue status
   */
  getStatus(): { queueLength: number; isProcessing: boolean; defaultDelay: number } {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      defaultDelay: this.defaultDelay
    };
  }

  /**
   * Wait until the queue is empty and processing is complete
   */
  async waitUntilEmpty(): Promise<void> {
    return new Promise((resolve) => {
      const checkQueue = () => {
        if (this.queue.length === 0 && !this.isProcessing) {
          resolve();
        } else {
          setTimeout(checkQueue, 100); // Check every 100ms
        }
      };
      checkQueue();
    });
  }

  /**
   * Clear all pending commands
   */
  clear(): void {
    this.queue = [];
  }

  addToFront(command: QueuedCommand): void {
    this.queue.unshift(command);
    
    if (!this.isProcessing) {
      this.processQueue();
    }
  }
}

// Singleton instance
export const commandQueue = new CommandQueueManager();

/**
 * Helper function to send any raw command with automatic queuing
 * Use this for commands like "update filename", "restart", etc.
 */
export async function queueCommand(
  deviceId: string,
  command: string,
  priority: boolean = false
): Promise<void> {
  if (!realtimeDB) {
    throw new Error('Database not initialized');
  }

  const trimmedCommand = command.trim();
  if (!trimmedCommand || trimmedCommand === '' || trimmedCommand === ' ') {
    console.warn(`[CommandQueue] Ignoring empty command`);
    return;
  }

  await commandQueue.enqueue(async () => {
    if (!realtimeDB) {
      throw new Error('Database not initialized during execution');
    }

    await set(ref(realtimeDB, `konstant/${deviceId}/cmd`), trimmedCommand);
  }, priority);
}

/**
 * Helper function to send a Firebase set command with automatic queuing and verification
 */
export async function queueSetCommand(
  deviceId: string,
  paramKey: string,
  value: number | boolean | string,
  priority: boolean = false,
  options?: { verify?: boolean; maxRetries?: number }
): Promise<void> {
  if (!realtimeDB) {
    throw new Error('Database not initialized');
  }

  const setCommand = `set ${paramKey} ${value}`;
  const { verify = false, maxRetries = 3 } = options || {};
  
  if (verify) {
    emitCommandEvent('queued', { command: setCommand, param: paramKey, value });
    await queueCommandWithVerification(deviceId, paramKey, value, setCommand, priority, maxRetries);
  } else {
    await queueCommand(deviceId, setCommand, priority);
  }
}

/**
 * Queue a SET command with verification that it was executed
 */
async function queueCommandWithVerification(
  deviceId: string,
  paramKey: string,
  expectedValue: string | number | boolean,
  setCommand: string,
  priority: boolean,
  maxRetries: number
): Promise<void> {
  if (!realtimeDB) {
    throw new Error('Database not initialized');
  }

  const timestamp = Date.now();
  const commandId = `cmd_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Create command object without executor first
  const command: QueuedCommand = {
    id: commandId,
    timestamp,
    paramId: paramKey,
    expectedValue,
    verify: true,
    retryCount: 0,
    maxRetries,
    executor: async () => {} // Placeholder, will be replaced
  };
  
  command.executor = async () => {
    if (!realtimeDB) {
      throw new Error('Database not initialized during execution');
    }
    
    emitCommandEvent('sending', { command: setCommand, param: paramKey, value: expectedValue });
    await set(ref(realtimeDB, `konstant/${deviceId}/cmd`), setCommand);
    
    const verified = await verifyCommandExecution(deviceId, paramKey, expectedValue);
    
    if (verified) {
      emitCommandEvent('success', { command: setCommand, param: paramKey, value: expectedValue });
    } else {
      const retryCount = (command.retryCount || 0) + 1;
      
      if (retryCount < maxRetries) {
        console.warn(`[CommandQueue] Verification failed for ${paramKey}, retry ${retryCount}/${maxRetries}`);
        emitCommandEvent('retrying', { 
          command: setCommand, 
          param: paramKey, 
          value: expectedValue, 
          retryCount, 
          maxRetries 
        });
        
        command.retryCount = retryCount;
        commandQueue.addToFront(command);
      } else {
        console.error(`[CommandQueue] Failed: ${paramKey} after ${maxRetries} attempts`);
        emitCommandEvent('failed', { 
          command: setCommand, 
          param: paramKey, 
          value: expectedValue, 
          retryCount: maxRetries 
        });
      }
    }
  };
  
  await commandQueue.enqueue(command.executor, priority);
}

/**
 * Verify that a command was executed by checking if the parameter value changed
 */
async function verifyCommandExecution(
  deviceId: string,
  paramKey: string,
  expectedValue: string | number | boolean,
  timeoutMs: number = 10000 // Increased to 10 seconds
): Promise<boolean> {
  if (!realtimeDB) return false;
  
  return new Promise((resolve) => {
    const paramRef = ref(realtimeDB!, `temporaer/${deviceId}/${paramKey}`);
    let unsubscribed = false;
    
    const timeout = setTimeout(() => {
      if (!unsubscribed) {
        unsubscribed = true;
        off(paramRef);
        console.warn(`[CommandQueue] Verification timeout for ${paramKey}`);
        
        setTimeout(async () => {
          try {
            const { get } = await import('firebase/database');
            const finalSnapshot = await get(paramRef);
            const finalValue = finalSnapshot.val();
            const normalizedFinal = normalizeValue(finalValue);
            const normalizedExpected = normalizeValue(expectedValue);
            
            if (normalizedFinal === normalizedExpected) {
              resolve(true);
            } else {
              console.error(`[CommandQueue] Final verification failed for ${paramKey}`);
              resolve(false);
            }
          } catch (error) {
            console.error(`[CommandQueue] Error in final check for ${paramKey}:`, error);
            resolve(false);
          }
        }, 1000);
      }
    }, timeoutMs);
    
    onValue(paramRef, (snapshot) => {
      if (unsubscribed) return;
      
      const currentValue = snapshot.val();
      const normalizedCurrent = normalizeValue(currentValue);
      const normalizedExpected = normalizeValue(expectedValue);
      
      if (normalizedCurrent === normalizedExpected) {
        unsubscribed = true;
        clearTimeout(timeout);
        off(paramRef);
        resolve(true);
      }
    });
  });
}

/**
 * Normalize values for comparison (handle type conversions)
 */
function normalizeValue(value: any): string | number | boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Try to parse as number
    const num = parseFloat(value);
    if (!isNaN(num)) return num;
    // Try to parse as boolean
    const lower = value.toLowerCase().trim();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
    return value;
  }
  return String(value);
}

/**
 * Emit command event for UI updates
 */
function emitCommandEvent(
  status: 'queued' | 'sending' | 'success' | 'failed' | 'retrying',
  data: { command: string; param: string; value: any; retryCount?: number; maxRetries?: number }
): void {
  window.dispatchEvent(new CustomEvent('command-status', {
    detail: { status, ...data, timestamp: Date.now() }
  }));
}


