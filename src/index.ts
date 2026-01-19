// src/index.ts - FIXED VERSION
import { DatabaseService } from './db/DatabaseService';
import { logger, setLogLevel } from './utils/logger';
import { startMetricsServer } from './monitoring/metrics-server';

// Set log level based on environment
const logLevel = process.env.LOG_LEVEL || 'info';
setLogLevel(logLevel as any);

// Start metrics server FIRST
const METRICS_PORT = 9090;
try {
  startMetricsServer(METRICS_PORT);
  logger.info(`Metrics server started on port ${METRICS_PORT}`);
  logger.info(`Access metrics at: http://localhost:${METRICS_PORT}/metrics`);
  logger.info(`Health check at: http://localhost:${METRICS_PORT}/health`);
} catch (error) {
  // FIXED: Handle unknown error type
  if (error instanceof Error) {
    logger.error({ error: error.message }, 'Failed to start metrics server');
  } else {
    logger.error({ error: String(error) }, 'Failed to start metrics server');
  }
}

// Log startup banner
logger.info({
  version: '1.0.0',
  logLevel,
  action: 'startup',
  metricsEnabled: true,
  metricsPort: METRICS_PORT
}, "=".repeat(80));
logger.info("ENTERPRISE RDBMS - PHASE 1: MVCC + SNAPSHOT ISOLATION");
logger.info("=".repeat(80));

// Initialize database
logger.info('Initializing database service...');
const db = new DatabaseService();
logger.info('Database service ready');

// Test 1: Basic snapshot isolation
logger.info({ test: 1, name: 'Snapshot Isolation' }, "--- Test 1: Snapshot Isolation ---");

const t1 = db.begin();
logger.debug({ txId: t1.id }, 'Transaction T1 started');

db.insert(t1, "user_1", { id: 1, name: "Alice", age: 25 });
db.insert(t1, "user_2", { id: 2, name: "Bob", age: 30 });
db.commit(t1);
logger.info({ txId: t1.id, usersInserted: 2 }, 'T1 committed with 2 users');

const t2 = db.begin();
logger.debug({ txId: t2.id }, 'Transaction T2 started');

const t2Results = db.select(t2);
logger.info({ 
  txId: t2.id, 
  rowCount: t2Results.length,
  results: t2Results 
}, 'T2 select results');

db.commit(t2);
logger.info({ txId: t2.id }, 'T2 committed');

// Test 2: Write-write conflict
logger.info({ test: 2, name: 'Write-Write Conflict' }, "\n--- Test 2: First-Committer-Wins Conflict ---");

const t3 = db.begin();
const t4 = db.begin();
logger.debug({ txId: t3.id, concurrentWith: t4.id }, 'Starting concurrent transactions T3 and T4');

db.update(t3, "user_1", { id: 1, name: "Alice", age: 26 });
logger.debug({ txId: t3.id, key: "user_1", newAge: 26 }, 'T3 updating user_1');

db.update(t4, "user_1", { id: 1, name: "Alice", age: 27 });
logger.debug({ txId: t4.id, key: "user_1", newAge: 27 }, 'T4 updating user_1');

db.commit(t3);
logger.info({ txId: t3.id, winner: true }, 'T3 committed successfully (first committer)');

try {
  db.commit(t4);
  logger.warn({ txId: t4.id }, 'T4 should have failed but didn\'t!');
} catch (e: any) {
  logger.info({ 
    txId: t4.id, 
    error: e.message,
    expected: true 
  }, `✓ T4 correctly aborted: ${e.message}`);
}

// Test 3: Aborted transaction visibility
logger.info({ test: 3, name: 'Aborted Transaction Visibility' }, "\n--- Test 3: Aborted Transactions Invisible ---");

const t5 = db.begin();
logger.debug({ txId: t5.id }, 'Transaction T5 started (will abort)');

db.insert(t5, "user_3", { id: 3, name: "Charlie", age: 35 });
logger.debug({ txId: t5.id, key: "user_3" }, 'T5 inserted user_3');

db.abort(t5);
logger.warn({ txId: t5.id, reason: 'user_abort' }, 'T5 aborted');

const t6 = db.begin();
logger.debug({ txId: t6.id }, 'Transaction T6 started (checking for aborted data)');

const results = db.select(t6, ["user_3"]);
const shouldSeeUser3 = results.length > 0;

if (shouldSeeUser3) {
  logger.error({ 
    txId: t6.id,
    foundUser3: true,
    expected: false,
    results
  }, '❌ ERROR: T6 should NOT see aborted transaction data!');
} else {
  logger.info({ 
    txId: t6.id,
    foundUser3: false,
    expected: false
  }, `✓ T6 sees user_3: NO (correct)`);
}

db.commit(t6);
logger.info({ txId: t6.id }, 'T6 committed');

// Summary
logger.info({ 
  testsRun: 3,
  status: 'completed',
  metricsUrl: `http://localhost:${METRICS_PORT}/metrics`
}, "\n" + "=".repeat(80));
logger.info("✅ PHASE 1 COMPLETE");
logger.info("=".repeat(80));

// Log performance summary if available
logger.info({
  action: 'shutdown',
  memoryUsage: process.memoryUsage(),
  uptime: process.uptime(),
  metricsCollected: true
}, 'Test suite completed successfully');

// Give time to check metrics before exit
setTimeout(() => {
  logger.info('Press Ctrl+C to exit');
}, 1000);