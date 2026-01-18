// // src/utils/logger.ts
// import pino from 'pino';

// // Create a logger instance
// export const logger = pino({
//   level: process.env.LOG_LEVEL || 'info',
//   base: {
//     pid: process.pid,
//     service: 'pg-core'
//   },
//   transport: process.env.NODE_ENV === 'development' ? {
//     target: 'pino-pretty',
//     options: {
//       colorize: true,
//       translateTime: 'SYS:standard',
//       ignore: 'pid,hostname'
//     }
//   } : undefined,
//   timestamp: () => `,"time":"${new Date().toISOString()}"`,
//   formatters: {
//     level: (label) => ({ level: label.toUpperCase() })
//   }
// });

// // Create child loggers for different components
// export const dbLogger = logger.child({ component: 'database' });
// export const mvccLogger = logger.child({ component: 'mvcc' });
// export const txLogger = logger.child({ component: 'transaction' });
// export const storageLogger = logger.child({ component: 'storage' });

// // Helper function to log transactions
// export const createTransactionLogger = (txId: number) => {
//   return txLogger.child({ txId });
// };

// // Export a function to set log level at runtime
// export const setLogLevel = (level: pino.Level) => {
//   logger.level = level;
// };

// export default logger;


// src/utils/logger.ts - Fixed TypeScript version
import pino from 'pino';

// Detect environment
const isDevelopment = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test' || 
               process.env.JEST_WORKER_ID !== undefined;
const isProduction = process.env.NODE_ENV === 'production';

// Default log levels per environment
const getDefaultLogLevel = (): string => {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  if (isTest) return 'warn'; // Default to warn in tests
  if (isDevelopment) return 'info';
  return 'info'; // Default to info in production
};

// Configure transport based on environment
const transportConfig = isDevelopment ? pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:standard',
    ignore: 'pid,hostname,service,component',
    messageFormat: '{msg}',
    errorLikeObjectKeys: ['err', 'error'],
  }
}) : undefined;

// Custom serializers for database objects
const serializers = {
  tx: (tx: any) => {
    if (!tx) return tx;
    return {
      id: tx.id,
      snapshot: tx.snapshot,
      status: tx.status
    };
  },
  error: pino.stdSerializers.err,
  row: (row: any) => {
    if (!row) return row;
    // Don't log full data in production
    if (isProduction) {
      return {
        key: row.key,
        xmin: row.xmin,
        xmax: row.xmax,
        dataSize: row.data ? JSON.stringify(row.data).length : 0
      };
    }
    return row;
  },
  snapshot: (snapshot: any) => {
    if (!snapshot) return snapshot;
    return {
      xmin: snapshot.xmin,
      xmax: snapshot.xmax,
      myTxnId: snapshot.myTxnId,
      activeTxns: snapshot.activeTxns ? Array.from(snapshot.activeTxns) : []
    };
  }
};

// Create the base logger configuration
const loggerOptions: pino.LoggerOptions = {
  level: getDefaultLogLevel(),
  base: {
    pid: process.pid,
    service: 'pg-core',
    environment: process.env.NODE_ENV || 'development'
  } as any, // Type assertion to fix TypeScript
  timestamp: pino.stdTimeFunctions.isoTime,
  serializers: serializers as any,
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      hostname: bindings.hostname,
      service: bindings.service,
      environment: (bindings as any).environment,
      component: (bindings as any).component
    })
  }
};

// Create logger with or without transport
const baseLogger = transportConfig 
  ? pino(loggerOptions, transportConfig)
  : pino(loggerOptions);

// Helper to check if logging is enabled (for test mode)
let loggingEnabled = !isTest || process.env.LOG_TESTS === 'true';

// Create child loggers for different components
export const logger = baseLogger.child({ component: 'app' });
export const dbLogger = baseLogger.child({ component: 'database' });
export const mvccLogger = baseLogger.child({ component: 'mvcc' });
export const storageLogger = baseLogger.child({ component: 'storage' });
export const transactionLogger = baseLogger.child({ component: 'transaction' });

// Type-safe logger methods
type LoggerLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

// Helper function to create transaction-specific loggers
export const createTransactionLogger = (txId: number): pino.Logger => {
  return transactionLogger.child({ txId });
};

// Helper to create context-aware loggers
export const createContextLogger = (context: Record<string, any>): pino.Logger => {
  return baseLogger.child(context);
};

// Export a function to set log level at runtime
export const setLogLevel = (level: LoggerLevel): void => {
  baseLogger.level = level;
};

// Test utilities
export const enableTestLogging = (level: LoggerLevel = 'info'): void => {
  baseLogger.level = level;
  loggingEnabled = true;
  
  // Force enable the logger
  (baseLogger as any).silent = false;
};

export const disableTestLogging = (): void => {
  baseLogger.level = 'warn';
  loggingEnabled = false;
  
  // Disable the logger
  (baseLogger as any).silent = true;
};

// Performance monitoring helpers
interface TimerResult {
  end: (context?: Record<string, any>) => number;
  log: (level: LoggerLevel, message: string, context?: Record<string, any>) => number;
}

export const createTimer = (operation: string): TimerResult => {
  const start = process.hrtime.bigint();
  
  return {
    end: (context: Record<string, any> = {}): number => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      
      if (loggingEnabled) {
        baseLogger.info({
          ...context,
          operation,
          durationMs,
          action: 'performance'
        }, `${operation} took ${durationMs.toFixed(2)}ms`);
      }
      
      return durationMs;
    },
    
    log: (level: LoggerLevel, message: string, context: Record<string, any> = {}): number => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      
      if (loggingEnabled) {
        baseLogger[level]({
          ...context,
          operation,
          durationMs,
          action: 'performance'
        }, message);
      }
      
      return durationMs;
    }
  };
};

// Simple logging wrapper for conditional logging
export const logIfEnabled = {
  info: (component: string, message: string, data?: any): void => {
    if (loggingEnabled) {
      const logger = baseLogger.child({ component });
      logger.info(data || {}, message);
    }
  },
  
  debug: (component: string, message: string, data?: any): void => {
    if (loggingEnabled) {
      const logger = baseLogger.child({ component });
      logger.debug(data || {}, message);
    }
  },
  
  warn: (component: string, message: string, data?: any): void => {
    if (loggingEnabled) {
      const logger = baseLogger.child({ component });
      logger.warn(data || {}, message);
    }
  },
  
  error: (component: string, message: string, data?: any): void => {
    if (loggingEnabled) {
      const logger = baseLogger.child({ component });
      logger.error(data || {}, message);
    }
  }
};

// Check if a specific log level is enabled
export const isLevelEnabled = (level: LoggerLevel): boolean => {
  const levels: Record<LoggerLevel, number> = {
    fatal: 60,
    error: 50,
    warn: 40,
    info: 30,
    debug: 20,
    trace: 10
  };
  
  const currentLevel = levels[baseLogger.level as LoggerLevel] || levels.info;
  const checkLevel = levels[level];
  
  return checkLevel >= currentLevel;
};

// Export logging state for tests
export const isLoggingEnabled = (): boolean => loggingEnabled;

// Optional: Simple console fallback for critical errors
export const emergencyLog = (message: string, error?: any): void => {
  console.error(`[EMERGENCY] ${message}`, error || '');
  
  // Also try to log with pino if possible
  try {
    baseLogger.error({ emergency: true }, message, error);
  } catch {
    // If pino fails, at least console worked
  }
};

export default logger;