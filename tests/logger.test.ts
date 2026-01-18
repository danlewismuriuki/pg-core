import { logger, setLogLevel, createTransactionLogger } from '../src/utils/logger';

describe('Logger', () => {
  test('should create logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  test('should change log levels', () => {
    const originalLevel = logger.level;
    
    setLogLevel('debug');
    expect(logger.level).toBe('debug');
    
    setLogLevel('info');
    expect(logger.level).toBe('info');
  });

  test('should create transaction logger', () => {
    const txLogger = createTransactionLogger(123);
    expect(txLogger).toBeDefined();
    // Transaction logger should have txId in context
  });
});