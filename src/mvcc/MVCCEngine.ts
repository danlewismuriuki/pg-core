// import { VersionedRow } from './VersionedRow';
// import { Snapshot } from '../transaction/Snapshot';
// import { CommitTable } from '../transaction/CommitTable';

// export class MVCCEngine {
//   constructor(private commitTable: CommitTable) {}

// isVisible(row: VersionedRow, snapshot: Snapshot): boolean {
//     const { xmin, xmax } = row;
  
//     // 1. If WE created this row
//     if (xmin === snapshot.myTxnId) {
//       // We can see our own inserts unless WE deleted it
//       return xmax !== snapshot.myTxnId;
//     }
  
//     // 2. Check if the creator is visible to our snapshot
//     const creatorVisible = this.isTransactionVisible(xmin, snapshot);
//     if (!creatorVisible) return false;
  
//     // 3. Check if deleted
//     if (xmax === null) return true; // Not deleted
    
//     // 4. Check if the deleter is visible to our snapshot
//     const deleterVisible = this.isTransactionVisible(xmax, snapshot);
    
//     // If deleter is visible → row is deleted → NOT visible
//     // If deleter is NOT visible → delete doesn't count → row IS visible
//     return !deleterVisible;
//   }
  
//   private isTransactionVisible(txnId: number, snapshot: Snapshot): boolean {
//     // A transaction is visible to a snapshot if:
//     // 1. It happened BEFORE the snapshot ended (txnId < snapshot.xmax)
//     // 2. It was NOT active when snapshot was taken
//     // 3. It's COMMITTED
    
//     if (txnId >= snapshot.xmax) return false; // Happened after snapshot
//     if (snapshot.activeTxns.has(txnId)) return false; // Was active/uncommitted
//     return this.commitTable.isCommitted(txnId); // Must be committed
//   }
  
//   canGarbageCollect(row: VersionedRow, globalOldestXmin: number): boolean {
//     if (row.xmax === null) return false;
//     return row.xmin < globalOldestXmin && row.xmax < globalOldestXmin;
//   }
// }



// mvcc/MVCCEngine.ts
import { VersionedRow } from './VersionedRow';
import { Snapshot } from '../transaction/Snapshot';
import { CommitTable } from '../transaction/CommitTable';
import { mvccLogger } from '../utils/logger';  // Add this import

export class MVCCEngine {
  private log = mvccLogger;  // Add logger instance

  constructor(private commitTable: CommitTable) {
    this.log.debug('MVCCEngine initialized');
  }

  isVisible(row: VersionedRow, snapshot: Snapshot): boolean {
    const { xmin, xmax } = row;
    
    // Log at trace level for debugging visibility logic
    if (this.log.level === 'trace') {
      this.log.trace({
        xmin,
        xmax,
        snapshotXmax: snapshot.xmax,
        snapshotMyTxnId: snapshot.myTxnId,
        activeTxns: Array.from(snapshot.activeTxns),
        action: 'visibility_check_start'
      }, `Checking visibility for row`);
    }

    // 1. If WE created this row
    if (xmin === snapshot.myTxnId) {
      // We can see our own inserts unless WE deleted it
      const visible = xmax !== snapshot.myTxnId;
      
      if (this.log.level === 'debug') {
        this.log.debug({
          xmin,
          xmax,
          myTxnId: snapshot.myTxnId,
          result: visible,
          reason: xmax === snapshot.myTxnId ? 'self_deleted' : 'self_created'
        }, `Visibility: self-created row`);
      }
      
      return visible;
    }

    // 2. Check if the creator is visible to our snapshot
    const creatorVisible = this.isTransactionVisible(xmin, snapshot);
    if (!creatorVisible) {
      if (this.log.level === 'debug') {
        this.log.debug({
          xmin,
          xmax,
          result: false,
          reason: 'creator_not_visible'
        }, `Visibility: creator not visible`);
      }
      return false;
    }

    // 3. Check if deleted
    if (xmax === null) {
      if (this.log.level === 'debug') {
        this.log.debug({
          xmin,
          xmax,
          result: true,
          reason: 'not_deleted'
        }, `Visibility: not deleted`);
      }
      return true; // Not deleted
    }
    
    // 4. Check if the deleter is visible to our snapshot
    const deleterVisible = this.isTransactionVisible(xmax, snapshot);
    const finalVisible = !deleterVisible;
    
    if (this.log.level === 'debug') {
      this.log.debug({
        xmin,
        xmax,
        deleterVisible,
        result: finalVisible,
        reason: deleterVisible ? 'deleted_by_visible_txn' : 'deleter_not_visible'
      }, `Visibility: deleted row check`);
    }
    
    return finalVisible;
  }
  
  private isTransactionVisible(txnId: number, snapshot: Snapshot): boolean {
    // Log at trace level for deep debugging
    if (this.log.level === 'trace') {
      this.log.trace({
        txnId,
        snapshotXmax: snapshot.xmax,
        activeTxns: Array.from(snapshot.activeTxns),
        commitStatus: this.commitTable.isCommitted(txnId)
      }, `Checking transaction visibility`);
    }

    // A transaction is visible to a snapshot if:
    // 1. It happened BEFORE the snapshot ended (txnId < snapshot.xmax)
    if (txnId >= snapshot.xmax) {
      if (this.log.level === 'debug') {
        this.log.debug({
          txnId,
          snapshotXmax: snapshot.xmax,
          result: false,
          reason: 'txn_happened_after_snapshot'
        }, `Transaction visibility check failed: happened after snapshot`);
      }
      return false; // Happened after snapshot
    }
    
    // 2. It was NOT active when snapshot was taken
    if (snapshot.activeTxns.has(txnId)) {
      if (this.log.level === 'debug') {
        this.log.debug({
          txnId,
          result: false,
          reason: 'txn_was_active_during_snapshot'
        }, `Transaction visibility check failed: was active`);
      }
      return false; // Was active/uncommitted
    }
    
    // 3. It's COMMITTED
    const isCommitted = this.commitTable.isCommitted(txnId);
    
    if (this.log.level === 'debug') {
      this.log.debug({
        txnId,
        isCommitted,
        result: isCommitted,
        reason: isCommitted ? 'txn_committed' : 'txn_not_committed'
      }, `Transaction visibility check: ${isCommitted ? 'visible' : 'not visible'}`);
    }
    
    return isCommitted; // Must be committed
  }
  
  canGarbageCollect(row: VersionedRow, globalOldestXmin: number): boolean {
    // Log at debug level for GC decisions
    if (this.log.level === 'debug') {
      this.log.debug({
        xmin: row.xmin,
        xmax: row.xmax,
        globalOldestXmin,
        rowKey: row.key,
        action: 'gc_check'
      }, `Checking if row can be garbage collected`);
    }

    if (row.xmax === null) {
      if (this.log.level === 'debug') {
        this.log.debug({
          rowKey: row.key,
          reason: 'xmax_null',
          result: false
        }, `GC: Cannot collect - not deleted (xmax is null)`);
      }
      return false;
    }

    const canCollect = row.xmin < globalOldestXmin && row.xmax < globalOldestXmin;
    
    if (this.log.level === 'debug') {
      this.log.debug({
        rowKey: row.key,
        xmin: row.xmin,
        xmax: row.xmax,
        globalOldestXmin,
        result: canCollect,
        reason: canCollect 
          ? 'both_xmin_xmax_before_oldest_xmin'
          : 'xmin_or_xmax_after_oldest_xmin'
      }, `GC check result`);
    }
    
    return canCollect;
  }

  // Optional: Add a method to log visibility summary
  logVisibilitySummary(rows: VersionedRow[], snapshot: Snapshot, key: string): void {
    if (this.log.level !== 'debug') return;
    
    const visibleRows = rows.filter(row => this.isVisible(row, snapshot));
    const invisibleRows = rows.filter(row => !this.isVisible(row, snapshot));
    
    this.log.debug({
      key,
      totalVersions: rows.length,
      visibleCount: visibleRows.length,
      invisibleCount: invisibleRows.length,
      visibleXmins: visibleRows.map(r => r.xmin),
      invisibleXmins: invisibleRows.map(r => r.xmin),
      action: 'visibility_summary'
    }, `Visibility summary for key`);
  }
}