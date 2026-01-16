import { VersionedRow } from './VersionedRow';
import { Snapshot } from '../transaction/Snapshot';
import { CommitTable } from '../transaction/CommitTable';

export class MVCCEngine {
  constructor(private commitTable: CommitTable) {}

  isVisible(row: VersionedRow, snapshot: Snapshot): boolean {
    const { xmin, xmax } = row;
  
    /* ---------- INSERT VISIBILITY ---------- */
  
    // Own insert
    if (xmin === snapshot.myTxnId) return true;
  
    // Created after snapshot
    if (xmin >= snapshot.xmax) return false;
  
    // Creator not committed
    if (!this.commitTable.isCommitted(xmin)) return false;
  
    /* ---------- DELETE VISIBILITY ---------- */
  
    // Not deleted
    if (xmax === null) return true;
  
    // Own delete
    if (xmax === snapshot.myTxnId) return false;
  
    // Deleted by txn active in snapshot → ignore delete ✅ (MISSING RULE)
    if (snapshot.activeTxns.has(xmax)) return true;
  
    // Deleted after snapshot
    if (xmax >= snapshot.xmax) return true;
  
    // Delete not committed
    if (!this.commitTable.isCommitted(xmax)) return true;
  
    // Deleted before snapshot
    return false;
  }  
  
  canGarbageCollect(row: VersionedRow, globalOldestXmin: number): boolean {
    if (row.xmax === null) return false;
    return row.xmin < globalOldestXmin && row.xmax < globalOldestXmin;
  }
}
