// import { TransactionManager } from '../transaction/TransactionManager';
// import { CommitTable } from '../transaction/CommitTable';
// import { MVCCEngine } from '../mvcc/MVCCEngine';
// import { SimpleStorage } from '../storage/SimpleStorage';
// import { ConflictDetector } from '../mvcc/ConflictDetector';
// import { Transaction } from '../transaction/Transaction';
// import { VersionedRow } from '../mvcc/VersionedRow';

// export class DatabaseService {
//   private txnManager = new TransactionManager();
//   private commitTable = new CommitTable();
//   private mvcc = new MVCCEngine(this.commitTable);
//   private storage = new SimpleStorage();
//   private conflictDetector = new ConflictDetector(
//     this.storage,
//     this.commitTable
//   );

//   begin(): Transaction {
//     const txn = this.txnManager.begin();
//     console.log(`[TXN ${txn.id}] BEGIN (snapshot: ${txn.snapshot.xmin}..${txn.snapshot.xmax})`);
//     return txn;
//   }

//   insert(txn: Transaction, key: string, data: any): void {
//     const row: VersionedRow = {
//       key,
//       data,
//       xmin: txn.id,
//       xmax: null,
//     };
//     txn.addWrite(key, row);
//     console.log(`[TXN ${txn.id}] INSERT ${key} → xmin=${txn.id}`);
//   }

//   update(txn: Transaction, key: string, data: any): void {
//     const versions = this.storage.getAllVersions(key);
//     const visible = versions.find((row) => this.mvcc.isVisible(row, txn.snapshot));

//     if (!visible) {
//       throw new Error(`Key '${key}' not found or not visible`);
//     }

//     visible.xmax = txn.id;

//     const newRow: VersionedRow = {
//       key,
//       data,
//       xmin: txn.id,
//       xmax: null,
//     };
//     txn.addWrite(key, newRow);
//     console.log(`[TXN ${txn.id}] UPDATE ${key} → deleted xmax=${txn.id}, new xmin=${txn.id}`);
//   }

//   delete(txn: Transaction, key: string): void {
//     const versions = this.storage.getAllVersions(key);
//     const visible = versions.find((row) => this.mvcc.isVisible(row, txn.snapshot));

//     if (!visible) {
//       throw new Error(`Key '${key}' not found or not visible`);
//     }

//     visible.xmax = txn.id;
//     txn.addWrite(key, visible);
//     console.log(`[TXN ${txn.id}] DELETE ${key} → xmax=${txn.id}`);
//   }

//   select(txn: Transaction, keys?: string[]): any[] {
//     const keysToScan = keys || this.storage.getAllKeys();
//     const results: any[] = [];

//     for (const key of keysToScan) {
//       txn.addRead(key);
//       const versions = this.storage.getAllVersions(key);

//       for (const row of versions) {
//         if (this.mvcc.isVisible(row, txn.snapshot)) {
//           results.push({ key: row.key, ...row.data });
//         }
//       }
//     }

//     return results;
//   }

//   commit(txn: Transaction): void {
//     const conflict = this.conflictDetector.detectConflict(txn);
//     if (conflict) {
//       console.log(`[TXN ${txn.id}] ABORT - ${conflict}`);
//       this.abort(txn);
//       throw new Error(conflict);
//     }

//     for (const row of txn.getWrites().values()) {
//       this.storage.insert(row);
//     }

//     this.commitTable.markCommitted(txn.id);
//     this.txnManager.commit(txn);

//     console.log(`[TXN ${txn.id}] COMMIT`);

//     this.garbageCollect();
//   }

//   abort(txn: Transaction): void {
//     this.commitTable.markAborted(txn.id);
//     this.txnManager.abort(txn);
//     console.log(`[TXN ${txn.id}] ABORT`);
//   }

//   garbageCollect(): void {
//     const oldestXmin = this.txnManager.getGlobalOldestXmin();
//     const collected = this.storage.garbageCollect(oldestXmin, this.mvcc);
//     if (collected > 0) {
//       console.log(`[GC] Collected ${collected} old versions (oldestXmin=${oldestXmin})`);
//     }
//   }
// }


import { TransactionManager } from '../transaction/TransactionManager';
import { CommitTable } from '../transaction/CommitTable';
import { MVCCEngine } from '../mvcc/MVCCEngine';
import { SimpleStorage } from '../storage/SimpleStorage';
import { ConflictDetector } from '../mvcc/ConflictDetector';
import { Transaction } from '../transaction/Transaction';
import { VersionedRow } from '../mvcc/VersionedRow';

export class DatabaseService {
  private txnManager = new TransactionManager();
  private commitTable = new CommitTable();
  private mvcc = new MVCCEngine(this.commitTable);
  private storage = new SimpleStorage();
  private conflictDetector = new ConflictDetector(
    this.storage,
    this.commitTable
  );

  /** Begin a new transaction */
  begin(): Transaction {
    const txn = this.txnManager.begin();
    console.log(`[TXN ${txn.id}] BEGIN (snapshot: ${txn.snapshot.xmin}..${txn.snapshot.xmax})`);
    return txn;
  }

  /** Insert a new row */
  insert(txn: Transaction, key: string, data: any): void {
    const row: VersionedRow = {
      key,
      data,
      xmin: txn.id,
      xmax: null,
    };
    txn.addWrite(key, row);
    console.log(`[TXN ${txn.id}] INSERT ${key} → xmin=${txn.id}`);
  }
  update(txn: Transaction, key: string, data: any): void {
    const versions = this.storage.getAllVersions(key);
  
    if (versions.length === 0) {
      throw new Error(`Key '${key}' not found`);
    }
  
    const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
    if (!visible) {
      throw new Error(`Key '${key}' not visible in snapshot`);
    }
  
    // Append a new version, old version stays untouched
    const newRow: VersionedRow = {
      key,
      data,
      xmin: txn.id,
      xmax: null,
    };
  
    txn.addWrite(key, newRow);
    console.log(`[TXN ${txn.id}] UPDATE ${key} → new xmin=${txn.id}`);
  }
  

  delete(txn: Transaction, key: string): void {
    const versions = this.storage.getAllVersions(key);
  
    if (versions.length === 0) {
      throw new Error(`Key '${key}' not found`);
    }
  
    const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
    if (!visible) {
      throw new Error(`Key '${key}' not visible in snapshot`);
    }
  
    // Append tombstone version instead of mutating old version
    const tombstone: VersionedRow = {
      key,
      data: visible.data,
      xmin: txn.id,
      xmax: txn.id,
    };
  
    txn.addWrite(key, tombstone);
    console.log(`[TXN ${txn.id}] DELETE ${key} → tombstone xmin=xmax=${txn.id}`);
  }
  
  /** Select visible rows for a transaction */
  select(txn: Transaction, keys?: string[]): any[] {
    const keysToScan = keys || this.storage.getAllKeys();
    const results: any[] = [];

    for (const key of keysToScan) {
      txn.addRead(key);
      const versions = this.storage.getAllVersions(key);

      // Only pick one visible version per key
      const visible = versions.find((row) => this.mvcc.isVisible(row, txn.snapshot));
      if (visible) {
        results.push({ key: visible.key, ...visible.data });
      }
    }

    return results;
  }

  /** Commit transaction with conflict detection */
  commit(txn: Transaction): void {
    const conflict = this.conflictDetector.detectConflict(txn);
    if (conflict) {
      console.log(`[TXN ${txn.id}] ABORT - ${conflict}`);
      this.abort(txn);
      throw new Error(conflict);
    }

    // Apply all writes
    for (const row of txn.getWrites().values()) {
      this.storage.insert(row);
    }

    this.commitTable.markCommitted(txn.id);
    this.txnManager.commit(txn);

    console.log(`[TXN ${txn.id}] COMMIT`);

    this.garbageCollect();
  }

  /** Abort a transaction */
  abort(txn: Transaction): void {
    this.commitTable.markAborted(txn.id);
    this.txnManager.abort(txn);
    console.log(`[TXN ${txn.id}] ABORT`);
  }

  /** Garbage collect old row versions */
  garbageCollect(): void {
    const oldestXmin = this.txnManager.getGlobalOldestXmin();
    const collected = this.storage.garbageCollect(oldestXmin, this.mvcc);
    if (collected > 0) {
      console.log(`[GC] Collected ${collected} old versions (oldestXmin=${oldestXmin})`);
    }
  }
}
