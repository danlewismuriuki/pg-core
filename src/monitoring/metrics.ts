// src/monitoring/metrics.ts - UPDATED VERSION
import client from 'prom-client';

// Create metrics registry
const register = new client.Registry();

// Add default Node.js metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// Create your database metrics - UPDATED to match DatabaseService
export const dbMetrics = {
  // Total transactions (no labels - simpler)
  transactionsTotal: new client.Counter({
    name: 'db_transactions_total',
    help: 'Total database transactions'
  }),
  
  // Committed transactions
  transactionsCommitted: new client.Counter({
    name: 'db_transactions_committed_total',
    help: 'Committed transactions'
  }),
  
  // Aborted transactions  
  transactionsAborted: new client.Counter({
    name: 'db_transactions_aborted_total',
    help: 'Aborted transactions'
  }),
  
  // Measure query speed - uses "operation" label
  queryTime: new client.Histogram({
    name: 'db_query_duration_seconds',
    help: 'How long queries take',
    labelNames: ['operation'] as const, // SELECT, INSERT, UPDATE, DELETE, COMMIT
    buckets: [0.001, 0.01, 0.1, 0.5, 1, 5] // seconds
  }),
  
  // Track active transactions
  activeTransactions: new client.Gauge({
    name: 'db_active_transactions',
    help: 'Currently running transactions'
  }),
  
  // Memory usage
  memoryUsage: new client.Gauge({
    name: 'db_memory_bytes',
    help: 'Memory used by database in bytes'
  })
};

// Register each metric
register.registerMetric(dbMetrics.transactionsTotal);
register.registerMetric(dbMetrics.transactionsCommitted);
register.registerMetric(dbMetrics.transactionsAborted);
register.registerMetric(dbMetrics.queryTime);
register.registerMetric(dbMetrics.activeTransactions);
register.registerMetric(dbMetrics.memoryUsage);

export { register };