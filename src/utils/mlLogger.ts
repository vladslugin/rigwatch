import type { ModelMetrics, CO2TrainingData } from '../types';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogCategory = 'training' | 'prediction' | 'validation' | 'data' | 'deployment';

export interface MLLogEntry {
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: any;
  error?: Error;
}

export interface MLSessionHealth {
  totalEntries: number;
  errors: number;
  warnings: number;
  lastActivity: number;
  sessionDuration: number;
}

export interface MLSessionSummary {
  sessionId: string;
  startTime: number;
  endTime?: number;
  dataSource: string;
  entries: MLLogEntry[];
  health: MLSessionHealth;
  summary: {
    trainings: number;
    predictions: number;
    validations: number;
    realCO2Points: number;
    syntheticPoints: number;
  };
}

export class MLLogger {
  private currentSession: MLSessionSummary | null = null;
  private sessions: MLSessionSummary[] = [];
  private maxSessions = 10; // Keep last 10 sessions
  
  /**
   * Start a new ML session
   */
  startSession(dataSource: string): string {
    // End current session if exists
    if (this.currentSession) {
      this.endSession();
    }
    
    const sessionId = `ml-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    
    this.currentSession = {
      sessionId,
      startTime: Date.now(),
      dataSource,
      entries: [],
      health: {
        totalEntries: 0,
        errors: 0,
        warnings: 0,
        lastActivity: Date.now(),
        sessionDuration: 0
      },
      summary: {
        trainings: 0,
        predictions: 0,
        validations: 0,
        realCO2Points: 0,
        syntheticPoints: 0
      }
    };
    
    this.log('info', 'training', `ML session started with data source: ${dataSource}`, { sessionId });
    
    return sessionId;
  }
  
  /**
   * End current session and archive it
   */
  endSession(): MLSessionSummary | null {
    if (!this.currentSession) return null;
    
    this.currentSession.endTime = Date.now();
    this.currentSession.health.sessionDuration = 
      this.currentSession.endTime - this.currentSession.startTime;
    
    this.log('info', 'training', 'ML session ended');
    
    // Archive session
    this.sessions.unshift(this.currentSession);
    
    // Keep only recent sessions
    if (this.sessions.length > this.maxSessions) {
      this.sessions = this.sessions.slice(0, this.maxSessions);
    }
    
    const endedSession = this.currentSession;
    this.currentSession = null;
    
    return endedSession;
  }
  
  /**
   * Log an entry to current session
   */
  log(level: LogLevel, category: LogCategory, message: string, data?: any): void {
    if (!this.currentSession) {
      console.warn('[MLLogger] No active session - starting default session');
      this.startSession('unknown');
    }
    
    const entry: MLLogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data
    };
    
    this.currentSession!.entries.push(entry);
    this.currentSession!.health.totalEntries++;
    this.currentSession!.health.lastActivity = Date.now();
    
    if (level === 'error') this.currentSession!.health.errors++;
    if (level === 'warn') this.currentSession!.health.warnings++;
    
    // Console output for development
    const prefix = `[ML-${category.toUpperCase()}]`;
    switch (level) {
      case 'error':
        console.error(prefix, message, data);
        break;
      case 'warn':
        console.warn(prefix, message, data);
        break;
      case 'debug':
        console.debug(prefix, message, data);
        break;
      default:
        console.log(prefix, message, data);
    }
  }
  
  /**
   * Log an error with stack trace
   */
  logError(category: LogCategory, error: Error | unknown, context?: any): void {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    
    if (!this.currentSession) {
      this.startSession('error-recovery');
    }
    
    const entry: MLLogEntry = {
      timestamp: Date.now(),
      level: 'error',
      category,
      message: errorObj.message,
      data: context,
      error: errorObj
    };
    
    this.currentSession!.entries.push(entry);
    this.currentSession!.health.totalEntries++;
    this.currentSession!.health.errors++;
    this.currentSession!.health.lastActivity = Date.now();
    
    console.error(`[ML-${category.toUpperCase()}] ERROR:`, errorObj.message, {
      context,
      stack: errorObj.stack
    });
  }
  
  /**
   * Log model training completion
   */
  logModelTraining(
    startTime: number, 
    endTime: number, 
    clusterCount: number, 
    metrics: ModelMetrics
  ): void {
    if (!this.currentSession) return;
    
    this.currentSession.summary.trainings++;
    
    this.log('info', 'training', 'Model training completed', {
      duration: endTime - startTime,
      clusterCount,
      metrics,
      efficiency: `${(metrics.r2 * 100).toFixed(1)}% accuracy`
    });
  }
  
  /**
   * Log data loading statistics
   */
  logDataLoading(source: string, totalPoints: number, realCO2Points: number): void {
    if (!this.currentSession) return;
    
    this.currentSession.summary.realCO2Points += realCO2Points;
    this.currentSession.summary.syntheticPoints += (totalPoints - realCO2Points);
    
    this.log('info', 'data', `Data loaded from ${source}`, {
      totalPoints,
      realCO2Points,
      syntheticPoints: totalPoints - realCO2Points,
      coverage: totalPoints > 0 ? ((realCO2Points / totalPoints) * 100).toFixed(1) + '%' : '0%'
    });
  }
  
  /**
   * Log data preprocessing details
   */
  logDataPreprocessing(
    originalLogs: number,
    processedPoints: number,
    windowSize: number,
    features: string[]
  ): void {
    this.log('info', 'data', 'Data preprocessing completed', {
      originalLogs,
      processedPoints,
      windowSize,
      features,
      efficiency: `${((processedPoints / originalLogs) * 100).toFixed(1)}% data utilization`
    });
  }
  
  /**
   * Log validation results
   */
  logValidation(result: any, baselineMetrics?: any): void {
    if (!this.currentSession) return;
    
    this.currentSession.summary.validations++;
    
    this.log('info', 'validation', 'Model validation completed', {
      testSamples: result.predictions?.length || 0,
      metrics: result.metrics,
      baseline: baselineMetrics,
      improvement: baselineMetrics ? 
        `${(((baselineMetrics.mae - result.metrics.mae) / baselineMetrics.mae) * 100).toFixed(1)}% MAE improvement` : 
        'No baseline'
    });
  }
  
  /**
   * Log model deployment
   */
  logDeployment(success: boolean, modelSize: number, isClientMode: boolean): void {
    this.log(success ? 'info' : 'error', 'deployment', 
      `Model deployment ${success ? 'successful' : 'failed'}`, {
      modelSize: `${(modelSize / 1024).toFixed(1)}KB`,
      mode: isClientMode ? 'client' : 'server',
      deploymentTime: new Date().toISOString()
    });
  }

  /**
   * Log model training completion with detailed metrics
   */
  async logTraining(details: {
    dataSource: string;
    modelType: string;
    sampleCount: number;
    metrics: any;
  }): Promise<void> {
    if (!this.currentSession) return;
    
    this.currentSession.summary.trainings++;
    
    this.log('info', 'training', `${details.modelType} training completed`, {
      dataSource: details.dataSource,
      sampleCount: details.sampleCount,
      metrics: details.metrics,
      accuracy: details.metrics?.r2 ? `${(details.metrics.r2 * 100).toFixed(1)}%` : 'N/A'
    });
  }
  
  /**
   * Get current session
   */
  getCurrentSession(): MLSessionSummary | null {
    return this.currentSession;
  }
  
  /**
   * Get session summary for health monitoring
   */
  getSessionSummary(): MLSessionSummary | null {
    return this.currentSession;
  }
  
  /**
   * Get all archived sessions
   */
  getAllSessions(): MLSessionSummary[] {
    const all = [...this.sessions];
    if (this.currentSession) {
      all.unshift(this.currentSession);
    }
    return all;
  }
  
  /**
   * Export session logs as downloadable data
   */
  exportSessionLogs(sessionId?: string): string {
    const session = sessionId ? 
      this.sessions.find(s => s.sessionId === sessionId) || this.currentSession :
      this.currentSession;
      
    if (!session) {
      return 'No session data available';
    }
    
    const report = [
      `ML Session Report: ${session.sessionId}`,
      `Data Source: ${session.dataSource}`,
      `Start Time: ${new Date(session.startTime).toISOString()}`,
      `End Time: ${session.endTime ? new Date(session.endTime).toISOString() : 'Active'}`,
      `Duration: ${Math.round(session.health.sessionDuration / 1000)}s`,
      '',
      `Summary:`,
      `- Trainings: ${session.summary.trainings}`,
      `- Predictions: ${session.summary.predictions}`,
      `- Validations: ${session.summary.validations}`,
      `- Real CO₂ Points: ${session.summary.realCO2Points}`,
      `- Synthetic Points: ${session.summary.syntheticPoints}`,
      '',
      `Health:`,
      `- Total Entries: ${session.health.totalEntries}`,
      `- Errors: ${session.health.errors}`,
      `- Warnings: ${session.health.warnings}`,
      '',
      `Detailed Log:`,
      '=================='
    ];
    
    for (const entry of session.entries) {
      const timestamp = new Date(entry.timestamp).toISOString();
      const data = entry.data ? ` | ${JSON.stringify(entry.data)}` : '';
      report.push(`[${timestamp}] ${entry.level.toUpperCase()} ${entry.category}: ${entry.message}${data}`);
    }
    
    return report.join('\n');
  }
  
  /**
   * Clear all session data
   */
  clearAllSessions(): void {
    this.currentSession = null;
    this.sessions = [];
    console.log('[MLLogger] All sessions cleared');
  }
}

/**
 * Session health analyzer
 */
export function analyzeMLSession(session: MLSessionSummary) {
  const now = Date.now();
  const age = now - session.startTime;
  const errorRate = session.health.totalEntries > 0 ? 
    session.health.errors / session.health.totalEntries : 0;
  const warningRate = session.health.totalEntries > 0 ? 
    session.health.warnings / session.health.totalEntries : 0;
  
  const isHealthy = errorRate < 0.1 && warningRate < 0.2 && age < 3600000; // 1 hour
  
  return {
    isHealthy,
    errorRate,
    warningRate,
    age,
    recommendations: [
      ...(errorRate > 0.1 ? ['High error rate detected - check data quality'] : []),
      ...(warningRate > 0.2 ? ['Many warnings - review configuration'] : []),
      ...(age > 3600000 ? ['Long session - consider restarting'] : [])
    ]
  };
}

/**
 * Download ML logs as file
 */
export function downloadMLLogs(): void {
  const logs = mlLogger.exportSessionLogs();
  const blob = new Blob([logs], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ml-session-${Date.now()}.log`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Export singleton instance
export const mlLogger = new MLLogger(); 