// Add at the top of DatabaseService.ts
import { TransactionManager } from '../transaction/TransactionManager';
import { CommitTable } from '../transaction/CommitTable';
import { MVCCEngine } from '../mvcc/MVCCEngine';
import { SimpleStorage } from '../storage/SimpleStorage';
import { ConflictDetector } from '../mvcc/ConflictDetector';
import { Transaction } from '../transaction/Transaction';
import { VersionedRow } from '../mvcc/VersionedRow';
import { logger, dbLogger } from '../utils/logger';
import { dbMetrics } from '../monitoring/metrics'

export class DatabaseService {
  private txnManager = new TransactionManager();
  private commitTable = new CommitTable();
  private mvcc = new MVCCEngine(this.commitTable);
  private storage = new SimpleStorage();
  private conflictDetector = new ConflictDetector(
    this.storage,
    this.commitTable
  );

  // Store the logger instance
  private log = dbLogger;

  /** Begin a new transaction */
  begin(): Transaction {
    const txn = this.txnManager.begin();
    
    // METRICS: Track transaction
    dbMetrics.transactionsTotal.inc();
    dbMetrics.activeTransactions.inc();
    
    // CHANGED: Use structured logging
    this.log.info({
      txId: txn.id,
      snapshotMin: txn.snapshot.xmin,
      snapshotMax: txn.snapshot.xmax,
      action: 'begin'
    }, `Transaction ${txn.id} started`);
    
    return txn;
  }

  /** Insert a new row */
  insert(txn: Transaction, key: string, data: any): void {
    const startTime = Date.now(); // <-- ADD THIS
    
    const row: VersionedRow = {
      key,
      data,
      xmin: txn.id,
      xmax: null,
    };
    txn.addWrite(key, row);
    
    // METRICS: Track insert time
    const duration = (Date.now() - startTime) / 1000;
    dbMetrics.queryTime.observe({ operation: 'INSERT' }, duration);
    
    // CHANGED: Add structured logging
    this.log.info({
      txId: txn.id,
      key,
      xmin: txn.id,
      dataSize: JSON.stringify(data).length,
      action: 'insert'
    }, `Insert operation`);
  }

  /** Update an existing row */
  update(txn: Transaction, key: string, data: any): void {
    const startTime = Date.now(); // <-- ADD THIS
  
    const versions = this.storage.getAllVersions(key);
  
    if (versions.length === 0) {
      this.log.warn({ txId: txn.id, key }, 'Update failed - key not found');
      throw new Error(`Key '${key}' not found`);
    }
  
    const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
    if (!visible) {
      this.log.warn({ 
        txId: txn.id, 
        key,
        versions: versions.length 
      }, 'Update failed - key not visible in snapshot');
      throw new Error(`Key '${key}' not visible in snapshot`);
    }
  
    // 1. Mark old version as deleted (create tombstone)
    const oldVersionTombstone: VersionedRow = {
      ...visible,
      xmax: txn.id,  // Mark old version as deleted by this transaction
    };
  
    // 2. Create new version with merged data
    const newRow: VersionedRow = {
      key,
      data: { ...visible.data, ...data },  // Merge ALL fields
      xmin: txn.id,
      xmax: null,
    };
  
    // Add BOTH to transaction writes
    txn.addWrite(key, oldVersionTombstone);
    txn.addWrite(key, newRow);
    
    // METRICS: Track update time
    const duration = (Date.now() - startTime) / 1000;
    dbMetrics.queryTime.observe({ operation: 'UPDATE' }, duration);
    
    // CHANGED: Log update details
    this.log.info({
      txId: txn.id,
      key,
      oldXmin: visible.xmin,
      newXmin: txn.id,
      oldXmax: visible.xmax,
      action: 'update'
    }, `Update operation`);
  }

  /** Delete a row */
  delete(txn: Transaction, key: string): void {
    const startTime = Date.now(); // <-- ADD THIS
  
    const versions = this.storage.getAllVersions(key);
  
    if (versions.length === 0) {
      this.log.warn({ txId: txn.id, key }, 'Delete failed - key not found');
      throw new Error(`Key '${key}' not found`);
    }
  
    const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
    if (!visible) {
      this.log.warn({ 
        txId: txn.id, 
        key,
        versions: versions.length 
      }, 'Delete failed - key not visible in snapshot');
      throw new Error(`Key '${key}' not visible in snapshot`);
    }
  
    // ✅ CORRECT: Keep original xmin, set xmax to deleter
    const tombstone: VersionedRow = {
      key,
      data: visible.data,
      xmin: visible.xmin,  // KEEP original creator
      xmax: txn.id,        // Mark as deleted by this transaction
    };
  
    txn.addWrite(key, tombstone);
    
    // METRICS: Track delete time
    const duration = (Date.now() - startTime) / 1000;
    dbMetrics.queryTime.observe({ operation: 'DELETE' }, duration);
    
    // CHANGED: Log delete operation
    this.log.info({
      txId: txn.id,
      key,
      originalXmin: visible.xmin,
      xmax: txn.id,
      action: 'delete'
    }, `Delete operation`);
  }

  /** Select visible rows for a transaction */
  select(txn: Transaction, keys?: string[]): any[] {
    const keysToScan = keys || this.storage.getAllKeys();
    const results: any[] = [];

    // CHANGED: Debug logging with context
    this.log.debug({
      txId: txn.id,
      keyCount: keysToScan.length,
      keys: keys ? keys.slice(0, 10) : undefined, // Log first 10 keys if specific
      action: 'select_start'
    }, `Starting select operation`);

    const startTime = Date.now();
    
    for (const key of keysToScan) {
      txn.addRead(key);
      const versions = this.storage.getAllVersions(key);

      // CHANGED: Debug version info (only at trace level)
      if (this.log.level === 'trace' && versions.length > 0) {
        this.log.trace({
          txId: txn.id,
          key,
          versionCount: versions.length,
          versions: versions.map(row => ({
            xmin: row.xmin,
            xmax: row.xmax,
            visible: this.mvcc.isVisible(row, txn.snapshot)
          }))
        }, `Key versions`);
      }

      // Only pick one visible version per key
      const visible = versions.find((row) => this.mvcc.isVisible(row, txn.snapshot));
      if (visible) {
        results.push({ key: visible.key, ...visible.data });
        
        // Debug: Log which version was picked
        if (this.log.level === 'debug') {
          this.log.debug({
            txId: txn.id,
            key,
            xmin: visible.xmin,
            dataSize: JSON.stringify(visible.data).length
          }, `Selected version`);
        }
      }
    }

    const duration = Date.now() - startTime;
    
    // METRICS: Track select time
    dbMetrics.queryTime.observe({ operation: 'SELECT' }, duration / 1000);
    
    // CHANGED: Info log with performance metrics
    this.log.info({
      txId: txn.id,
      rowCount: results.length,
      duration,
      scannedKeys: keysToScan.length,
      action: 'select_complete'
    }, `Select completed`);
    
    return results;
  }

  /** Commit transaction with conflict detection */
  commit(txn: Transaction): void {
    const startTime = Date.now();
    
    // CHANGED: Log commit start
    this.log.debug({
      txId: txn.id,
      action: 'commit_start'
    }, `Starting commit process`);
    
    const conflict = this.conflictDetector.detectConflict(txn);
    if (conflict) {
      const duration = Date.now() - startTime;
      
      // METRICS: Track aborted transaction
      dbMetrics.transactionsAborted.inc();
      dbMetrics.activeTransactions.dec();
      
      this.log.warn({
        txId: txn.id,
        conflict,
        duration,
        action: 'abort'
      }, `Transaction aborted due to conflict`);
      
      this.abort(txn);
      throw new Error(conflict);
    }

    // Apply all writes (now arrays per key)
    const writes = txn.getWrites();
    let totalWrites = 0;
    
    for (const rows of writes.values()) {
      totalWrites += rows.length;
    }
    
    // CHANGED: Log commit details
    this.log.info({
      txId: txn.id,
      writeCount: totalWrites,
      keyCount: writes.size,
      action: 'commit_write'
    }, `Applying writes`);
    
    // Log each write at debug level
    if (this.log.level === 'debug') {
      for (const [key, rows] of writes) {
        for (const row of rows) {
          this.log.debug({
            txId: txn.id,
            key: row.key,
            xmin: row.xmin,
            xmax: row.xmax,
            operation: row.xmax === null ? 'insert/update' : 'delete/tombstone'
          }, `Writing row`);
        }
      }
    }

    // Actually write to storage
    for (const [key, rows] of writes) {
      for (const row of rows) {
        this.storage.insert(row);
      }
    }

    this.commitTable.markCommitted(txn.id);
    this.txnManager.commit(txn);

    const duration = Date.now() - startTime;
    
    // METRICS: Track successful commit
    dbMetrics.transactionsCommitted.inc();
    dbMetrics.activeTransactions.dec();
    dbMetrics.queryTime.observe({ operation: 'COMMIT' }, duration / 1000);
    
    // CHANGED: Final commit log
    this.log.info({
      txId: txn.id,
      duration,
      success: true,
      action: 'commit_complete'
    }, `Transaction committed successfully`);

    this.garbageCollect();
  }

  /** Abort a transaction */
  abort(txn: Transaction): void {
    const writes = txn.getWrites();
    
    // METRICS: Track aborted transaction
    dbMetrics.transactionsAborted.inc();
    dbMetrics.activeTransactions.dec();
    
    this.log.warn({
      txId: txn.id,
      reason: 'user_abort_or_conflict',
      writesDiscarded: writes.size,
      action: 'abort'
    }, `Transaction aborted`);
    
    this.commitTable.markAborted(txn.id);
    this.txnManager.abort(txn);
  }

  /** Garbage collect old row versions */
  garbageCollect(): void {
    const startTime = Date.now();
    const oldestXmin = this.txnManager.getGlobalOldestXmin();
    
    this.log.debug({
      oldestXmin,
      action: 'gc_start'
    }, `Starting garbage collection`);
    
    const collected = this.storage.garbageCollect(oldestXmin, this.mvcc);
    
    const duration = Date.now() - startTime;
    
    if (collected > 0) {
      this.log.info({
        collectedVersions: collected,
        duration,
        oldestXmin,
        action: 'gc_complete'
      }, `Garbage collection completed`);
    } else if (this.log.level === 'debug') {
      this.log.debug({
        duration,
        action: 'gc_noop'
      }, `Garbage collection - nothing to collect`);
    }
    
    // METRICS: Update memory usage
    const memory = process.memoryUsage();
    dbMetrics.memoryUsage.set(memory.heapUsed);
  }
}