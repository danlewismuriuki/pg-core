import { VersionedRow } from './VersionedRow';
import { Snapshot } from '../transaction/Snapshot';
import { CommitTable } from '../transaction/CommitTable';

export class MVCCEngine {
  constructor(private commitTable: CommitTable) {}

//   isVisible(row: VersionedRow, snapshot: Snapshot): boolean {
//     const { xmin, xmax } = row;
  
//     /* ---------- INSERT VISIBILITY ---------- */
  
//     // Own insert
//     if (xmin === snapshot.myTxnId) return true;
  
//     // Created after snapshot
//     if (xmin >= snapshot.xmax) return false;
  
//     // Creator not committed
//     if (!this.commitTable.isCommitted(xmin)) return false;
  
//     /* ---------- DELETE VISIBILITY ---------- */
  
//     // Not deleted
//     if (xmax === null) return true;
  
//     // Own delete
//     if (xmax === snapshot.myTxnId) return false;
  
//     // Deleted by txn active in snapshot → ignore delete ✅ (MISSING RULE)
//     if (snapshot.activeTxns.has(xmax)) return true;
  
//     // Deleted after snapshot
//     if (xmax >= snapshot.xmax) return true;
  
//     // Delete not committed
//     if (!this.commitTable.isCommitted(xmax)) return true;
  
//     // Deleted before snapshot
//     return false;
//   }  
isVisible(row: VersionedRow, snapshot: Snapshot): boolean {
    const { xmin, xmax } = row;
  
    // 1. If WE created this row
    if (xmin === snapshot.myTxnId) {
      // We can see our own inserts unless WE deleted it
      return xmax !== snapshot.myTxnId;
    }
  
    // 2. Check if the creator is visible to our snapshot
    const creatorVisible = this.isTransactionVisible(xmin, snapshot);
    if (!creatorVisible) return false;
  
    // 3. Check if deleted
    if (xmax === null) return true; // Not deleted
    
    // 4. Check if the deleter is visible to our snapshot
    const deleterVisible = this.isTransactionVisible(xmax, snapshot);
    
    // If deleter is visible → row is deleted → NOT visible
    // If deleter is NOT visible → delete doesn't count → row IS visible
    return !deleterVisible;
  }
  
  private isTransactionVisible(txnId: number, snapshot: Snapshot): boolean {
    // A transaction is visible to a snapshot if:
    // 1. It happened BEFORE the snapshot ended (txnId < snapshot.xmax)
    // 2. It was NOT active when snapshot was taken
    // 3. It's COMMITTED
    
    if (txnId >= snapshot.xmax) return false; // Happened after snapshot
    if (snapshot.activeTxns.has(txnId)) return false; // Was active/uncommitted
    return this.commitTable.isCommitted(txnId); // Must be committed
  }
  
  canGarbageCollect(row: VersionedRow, globalOldestXmin: number): boolean {
    if (row.xmax === null) return false;
    return row.xmin < globalOldestXmin && row.xmax < globalOldestXmin;
  }
}
