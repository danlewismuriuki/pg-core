// // // import { TransactionManager } from '../transaction/TransactionManager';
// // // import { CommitTable } from '../transaction/CommitTable';
// // // import { MVCCEngine } from '../mvcc/MVCCEngine';
// // // import { SimpleStorage } from '../storage/SimpleStorage';
// // // import { ConflictDetector } from '../mvcc/ConflictDetector';
// // // import { Transaction } from '../transaction/Transaction';
// // // import { VersionedRow } from '../mvcc/VersionedRow';

// // // export class DatabaseService {
// // //   private txnManager = new TransactionManager();
// // //   private commitTable = new CommitTable();
// // //   private mvcc = new MVCCEngine(this.commitTable);
// // //   private storage = new SimpleStorage();
// // //   private conflictDetector = new ConflictDetector(
// // //     this.storage,
// // //     this.commitTable
// // //   );

// // //   begin(): Transaction {
// // //     const txn = this.txnManager.begin();
// // //     console.log(`[TXN ${txn.id}] BEGIN (snapshot: ${txn.snapshot.xmin}..${txn.snapshot.xmax})`);
// // //     return txn;
// // //   }

// // //   insert(txn: Transaction, key: string, data: any): void {
// // //     const row: VersionedRow = {
// // //       key,
// // //       data,
// // //       xmin: txn.id,
// // //       xmax: null,
// // //     };
// // //     txn.addWrite(key, row);
// // //     console.log(`[TXN ${txn.id}] INSERT ${key} → xmin=${txn.id}`);
// // //   }

// // //   update(txn: Transaction, key: string, data: any): void {
// // //     const versions = this.storage.getAllVersions(key);
// // //     const visible = versions.find((row) => this.mvcc.isVisible(row, txn.snapshot));

// // //     if (!visible) {
// // //       throw new Error(`Key '${key}' not found or not visible`);
// // //     }

// // //     visible.xmax = txn.id;

// // //     const newRow: VersionedRow = {
// // //       key,
// // //       data,
// // //       xmin: txn.id,
// // //       xmax: null,
// // //     };
// // //     txn.addWrite(key, newRow);
// // //     console.log(`[TXN ${txn.id}] UPDATE ${key} → deleted xmax=${txn.id}, new xmin=${txn.id}`);
// // //   }

// // //   delete(txn: Transaction, key: string): void {
// // //     const versions = this.storage.getAllVersions(key);
// // //     const visible = versions.find((row) => this.mvcc.isVisible(row, txn.snapshot));

// // //     if (!visible) {
// // //       throw new Error(`Key '${key}' not found or not visible`);
// // //     }

// // //     visible.xmax = txn.id;
// // //     txn.addWrite(key, visible);
// // //     console.log(`[TXN ${txn.id}] DELETE ${key} → xmax=${txn.id}`);
// // //   }

// // //   select(txn: Transaction, keys?: string[]): any[] {
// // //     const keysToScan = keys || this.storage.getAllKeys();
// // //     const results: any[] = [];

// // //     for (const key of keysToScan) {
// // //       txn.addRead(key);
// // //       const versions = this.storage.getAllVersions(key);

// // //       for (const row of versions) {
// // //         if (this.mvcc.isVisible(row, txn.snapshot)) {
// // //           results.push({ key: row.key, ...row.data });
// // //         }
// // //       }
// // //     }

// // //     return results;
// // //   }

// // //   commit(txn: Transaction): void {
// // //     const conflict = this.conflictDetector.detectConflict(txn);
// // //     if (conflict) {
// // //       console.log(`[TXN ${txn.id}] ABORT - ${conflict}`);
// // //       this.abort(txn);
// // //       throw new Error(conflict);
// // //     }

// // //     for (const row of txn.getWrites().values()) {
// // //       this.storage.insert(row);
// // //     }

// // //     this.commitTable.markCommitted(txn.id);
// // //     this.txnManager.commit(txn);

// // //     console.log(`[TXN ${txn.id}] COMMIT`);

// // //     this.garbageCollect();
// // //   }

// // //   abort(txn: Transaction): void {
// // //     this.commitTable.markAborted(txn.id);
// // //     this.txnManager.abort(txn);
// // //     console.log(`[TXN ${txn.id}] ABORT`);
// // //   }

// // //   garbageCollect(): void {
// // //     const oldestXmin = this.txnManager.getGlobalOldestXmin();
// // //     const collected = this.storage.garbageCollect(oldestXmin, this.mvcc);
// // //     if (collected > 0) {
// // //       console.log(`[GC] Collected ${collected} old versions (oldestXmin=${oldestXmin})`);
// // //     }
// // //   }
// // // }


// // import { TransactionManager } from '../transaction/TransactionManager';
// // import { CommitTable } from '../transaction/CommitTable';
// // import { MVCCEngine } from '../mvcc/MVCCEngine';
// // import { SimpleStorage } from '../storage/SimpleStorage';
// // import { ConflictDetector } from '../mvcc/ConflictDetector';
// // import { Transaction } from '../transaction/Transaction';
// // import { VersionedRow } from '../mvcc/VersionedRow';

// // export class DatabaseService {
// //   private txnManager = new TransactionManager();
// //   private commitTable = new CommitTable();
// //   private mvcc = new MVCCEngine(this.commitTable);
// //   private storage = new SimpleStorage();
// //   private conflictDetector = new ConflictDetector(
// //     this.storage,
// //     this.commitTable
// //   );

// //   /** Begin a new transaction */
// //   begin(): Transaction {
// //     const txn = this.txnManager.begin();
// //     console.log(`[TXN ${txn.id}] BEGIN (snapshot: ${txn.snapshot.xmin}..${txn.snapshot.xmax})`);
// //     return txn;
// //   }

// //   /** Insert a new row */
// //   insert(txn: Transaction, key: string, data: any): void {
// //     const row: VersionedRow = {
// //       key,
// //       data,
// //       xmin: txn.id,
// //       xmax: null,
// //     };
// //     txn.addWrite(key, row);
// //     console.log(`[TXN ${txn.id}] INSERT ${key} → xmin=${txn.id}`);
// // //   }
// // //   update(txn: Transaction, key: string, data: any): void {
// // //     const versions = this.storage.getAllVersions(key);
  
// // //     if (versions.length === 0) {
// // //       throw new Error(`Key '${key}' not found`);
// // //     }
  
// // //     const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
// // //     if (!visible) {
// // //       throw new Error(`Key '${key}' not visible in snapshot`);
// // //     }
  
// // //     // Append a new version, old version stays untouched
// // //     const newRow: VersionedRow = {
// // //       key,
// // //       data,
// // //       xmin: txn.id,
// // //       xmax: null,
// // //     };
  
// // //     txn.addWrite(key, newRow);
// // //     console.log(`[TXN ${txn.id}] UPDATE ${key} → new xmin=${txn.id}`);
// // //   }

// // //   delete(txn: Transaction, key: string): void {
// // //     const versions = this.storage.getAllVersions(key);
  
// // //     if (versions.length === 0) {
// // //       throw new Error(`Key '${key}' not found`);
// // //     }
  
// // //     const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
// // //     if (!visible) {
// // //       throw new Error(`Key '${key}' not visible in snapshot`);
// // //     }
  
// // //     // Append tombstone version instead of mutating old version
// // //     const tombstone: VersionedRow = {
// // //       key,
// // //       data: visible.data,
// // //       xmin: txn.id,
// // //       xmax: txn.id,
// // //     };
  
// // //     txn.addWrite(key, tombstone);
// // //     console.log(`[TXN ${txn.id}] DELETE ${key} → tombstone xmin=xmax=${txn.id}`);
// // //   }
// // delete(txn: Transaction, key: string): void {
// //     const versions = this.storage.getAllVersions(key);
  
// //     if (versions.length === 0) {
// //       throw new Error(`Key '${key}' not found`);
// //     }
  
// //     const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
// //     if (!visible) {
// //       throw new Error(`Key '${key}' not visible in snapshot`);
// //     }
  
// //     // ✅ CORRECT: Keep original xmin, set xmax to deleter
// //     const tombstone: VersionedRow = {
// //       key,
// //       data: visible.data,
// //       xmin: visible.xmin,  // KEEP original creator
// //       xmax: txn.id,        // Mark as deleted by this transaction
// //     };
  
// //     txn.addWrite(key, tombstone);
// //     console.log(`[TXN ${txn.id}] DELETE ${key} → tombstone xmin=${tombstone.xmin}, xmax=${tombstone.xmax}`);
// //   }

// //   /** Select visible rows for a transaction */
// //   select(txn: Transaction, keys?: string[]): any[] {
// //     const keysToScan = keys || this.storage.getAllKeys();
// //     const results: any[] = [];

// //     for (const key of keysToScan) {
// //       txn.addRead(key);
// //       const versions = this.storage.getAllVersions(key);

// //       // Only pick one visible version per key
// //       const visible = versions.find((row) => this.mvcc.isVisible(row, txn.snapshot));
// //       if (visible) {
// //         results.push({ key: visible.key, ...visible.data });
// //       }
// //     }

// //     return results;
// //   }

// //   /** Commit transaction with conflict detection */
// //   commit(txn: Transaction): void {
// //     const conflict = this.conflictDetector.detectConflict(txn);
// //     if (conflict) {
// //       console.log(`[TXN ${txn.id}] ABORT - ${conflict}`);
// //       this.abort(txn);
// //       throw new Error(conflict);
// //     }

// //     // Apply all writes
// //     for (const row of txn.getWrites().values()) {
// //       this.storage.insert(row);
// //     }

// //     this.commitTable.markCommitted(txn.id);
// //     this.txnManager.commit(txn);

// //     console.log(`[TXN ${txn.id}] COMMIT`);

// //     this.garbageCollect();
// //   }

// //   /** Abort a transaction */
// //   abort(txn: Transaction): void {
// //     this.commitTable.markAborted(txn.id);
// //     this.txnManager.abort(txn);
// //     console.log(`[TXN ${txn.id}] ABORT`);
// //   }

// //   /** Garbage collect old row versions */
// //   garbageCollect(): void {
// //     const oldestXmin = this.txnManager.getGlobalOldestXmin();
// //     const collected = this.storage.garbageCollect(oldestXmin, this.mvcc);
// //     if (collected > 0) {
// //       console.log(`[GC] Collected ${collected} old versions (oldestXmin=${oldestXmin})`);
// //     }
// //   }
// // }

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

//   /** Begin a new transaction */
//   begin(): Transaction {
//     const txn = this.txnManager.begin();
//     console.log(`[TXN ${txn.id}] BEGIN (snapshot: ${txn.snapshot.xmin}..${txn.snapshot.xmax})`);
//     return txn;
//   }

//   /** Insert a new row */
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

//   /** Update an existing row */
//   update(txn: Transaction, key: string, data: any): void {
//     const versions = this.storage.getAllVersions(key);
  
//     if (versions.length === 0) {
//       throw new Error(`Key '${key}' not found`);
//     }
  
//     const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
//     if (!visible) {
//       throw new Error(`Key '${key}' not visible in snapshot`);
//     }
  
//     // 1. Mark old version as deleted (create tombstone)
//     const oldVersionTombstone: VersionedRow = {
//       ...visible,
//       xmax: txn.id,  // Mark old version as deleted by this transaction
//     };
  
//     // 2. Create new version with merged data
//     const newRow: VersionedRow = {
//       key,
//       data: { ...visible.data, ...data },  // Merge existing data with updates
//       xmin: txn.id,
//       xmax: null,
//     };
  
//     // Add BOTH to transaction writes
//     txn.addWrite(key, oldVersionTombstone);
//     txn.addWrite(key, newRow);
    
//     console.log(`[TXN ${txn.id}] UPDATE ${key} → old xmax=${txn.id}, new xmin=${txn.id}`);
//   }

//   /** Delete a row */
//   delete(txn: Transaction, key: string): void {
//     const versions = this.storage.getAllVersions(key);
  
//     if (versions.length === 0) {
//       throw new Error(`Key '${key}' not found`);
//     }
  
//     const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
//     if (!visible) {
//       throw new Error(`Key '${key}' not visible in snapshot`);
//     }
  
//     // ✅ CORRECT: Keep original xmin, set xmax to deleter
//     const tombstone: VersionedRow = {
//       key,
//       data: visible.data,
//       xmin: visible.xmin,  // KEEP original creator
//       xmax: txn.id,        // Mark as deleted by this transaction
//     };
  
//     txn.addWrite(key, tombstone);
//     console.log(`[TXN ${txn.id}] DELETE ${key} → tombstone xmin=${tombstone.xmin}, xmax=${tombstone.xmax}`);
//   }

//   /** Select visible rows for a transaction */
//   select(txn: Transaction, keys?: string[]): any[] {
//     const keysToScan = keys || this.storage.getAllKeys();
//     const results: any[] = [];

//     for (const key of keysToScan) {
//       txn.addRead(key);
//       const versions = this.storage.getAllVersions(key);

//       // Only pick one visible version per key
//       const visible = versions.find((row) => this.mvcc.isVisible(row, txn.snapshot));
//       if (visible) {
//         results.push({ key: visible.key, ...visible.data });
//       }
//     }

//     return results;
//   }

//   /** Commit transaction with conflict detection */
//   commit(txn: Transaction): void {
//     const conflict = this.conflictDetector.detectConflict(txn);
//     if (conflict) {
//       console.log(`[TXN ${txn.id}] ABORT - ${conflict}`);
//       this.abort(txn);
//       throw new Error(conflict);
//     }

//     // Apply all writes
//     for (const row of txn.getWrites().values()) {
//       this.storage.insert(row);
//     }

//     this.commitTable.markCommitted(txn.id);
//     this.txnManager.commit(txn);

//     console.log(`[TXN ${txn.id}] COMMIT`);

//     this.garbageCollect();
//   }

//   /** Abort a transaction */
//   abort(txn: Transaction): void {
//     this.commitTable.markAborted(txn.id);
//     this.txnManager.abort(txn);
//     console.log(`[TXN ${txn.id}] ABORT`);
//   }

//   /** Garbage collect old row versions */
//   garbageCollect(): void {
//     const oldestXmin = this.txnManager.getGlobalOldestXmin();
//     const collected = this.storage.garbageCollect(oldestXmin, this.mvcc);
//     if (collected > 0) {
//       console.log(`[GC] Collected ${collected} old versions (oldestXmin=${oldestXmin})`);
//     }
//   }
// }


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

//   /** Begin a new transaction */
//   begin(): Transaction {
//     const txn = this.txnManager.begin();
//     console.log(`[TXN ${txn.id}] BEGIN (snapshot: ${txn.snapshot.xmin}..${txn.snapshot.xmax})`);
//     return txn;
//   }

//   /** Insert a new row */
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

//   /** Update an existing row */
//   update(txn: Transaction, key: string, data: any): void {
//     const versions = this.storage.getAllVersions(key);
  
//     if (versions.length === 0) {
//       throw new Error(`Key '${key}' not found`);
//     }
  
//     const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
//     if (!visible) {
//       throw new Error(`Key '${key}' not visible in snapshot`);
//     }
  
//     // 1. Mark old version as deleted (create tombstone)
//     const oldVersionTombstone: VersionedRow = {
//       ...visible,
//       xmax: txn.id,  // Mark old version as deleted by this transaction
//     };
  
//     // 2. Create new version with merged data
//     const newRow: VersionedRow = {
//       key,
//       data: { ...visible.data, ...data },  // Merge ALL fields
//       xmin: txn.id,
//       xmax: null,
//     };
  
//     // Add BOTH to transaction writes
//     txn.addWrite(key, oldVersionTombstone);
//     txn.addWrite(key, newRow);
    
//     console.log(`[TXN ${txn.id}] UPDATE ${key} → old xmax=${txn.id}, new xmin=${txn.id}`);
//   }

//   /** Delete a row */
//   delete(txn: Transaction, key: string): void {
//     const versions = this.storage.getAllVersions(key);
  
//     if (versions.length === 0) {
//       throw new Error(`Key '${key}' not found`);
//     }
  
//     const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
//     if (!visible) {
//       throw new Error(`Key '${key}' not visible in snapshot`);
//     }
  
//     // ✅ CORRECT: Keep original xmin, set xmax to deleter
//     const tombstone: VersionedRow = {
//       key,
//       data: visible.data,
//       xmin: visible.xmin,  // KEEP original creator
//       xmax: txn.id,        // Mark as deleted by this transaction
//     };
  
//     txn.addWrite(key, tombstone);
//     console.log(`[TXN ${txn.id}] DELETE ${key} → tombstone xmin=${tombstone.xmin}, xmax=${tombstone.xmax}`);
//   }

//   /** Select visible rows for a transaction */
//   select(txn: Transaction, keys?: string[]): any[] {
//     const keysToScan = keys || this.storage.getAllKeys();
//     const results: any[] = [];

//     // DEBUG LOGGING - Add this to see what's happening
//     console.log(`[TXN ${txn.id}] SELECT - Checking ${keysToScan.length} keys`);

//     for (const key of keysToScan) {
//       txn.addRead(key);
//       const versions = this.storage.getAllVersions(key);

//       // DEBUG: Log all versions for this key
//       if (versions.length > 0) {
//         console.log(`[TXN ${txn.id}] Key '${key}' has ${versions.length} versions:`);
//         versions.forEach((row, i) => {
//           const visible = this.mvcc.isVisible(row, txn.snapshot);
//           console.log(`  V${i}: xmin=${row.xmin}, xmax=${row.xmax}, data=${JSON.stringify(row.data)}, visible=${visible}`);
//         });
//       }

//       // Only pick one visible version per key
//       const visible = versions.find((row) => this.mvcc.isVisible(row, txn.snapshot));
//       if (visible) {
//         results.push({ key: visible.key, ...visible.data });
//         console.log(`[TXN ${txn.id}] SELECT picked version with xmin=${visible.xmin}, data=${JSON.stringify(visible.data)}`);
//       }
//     }

//     console.log(`[TXN ${txn.id}] SELECT returning ${results.length} rows`);
//     return results;
//   }

//   /** Commit transaction with conflict detection */
//   commit(txn: Transaction): void {
//     const conflict = this.conflictDetector.detectConflict(txn);
//     if (conflict) {
//       console.log(`[TXN ${txn.id}] ABORT - ${conflict}`);
//       this.abort(txn);
//       throw new Error(conflict);
//     }

//     // Apply all writes
//     console.log(`[TXN ${txn.id}] COMMIT - Applying ${txn.getWrites().size} writes`);
//     for (const row of txn.getWrites().values()) {
//       console.log(`  Writing: key=${row.key}, xmin=${row.xmin}, xmax=${row.xmax}`);
//       this.storage.insert(row);
//     }

//     this.commitTable.markCommitted(txn.id);
//     this.txnManager.commit(txn);

//     console.log(`[TXN ${txn.id}] COMMIT completed`);

//     this.garbageCollect();
//   }

//   /** Abort a transaction */
//   abort(txn: Transaction): void {
//     this.commitTable.markAborted(txn.id);
//     this.txnManager.abort(txn);
//     console.log(`[TXN ${txn.id}] ABORT`);
//   }

//   /** Garbage collect old row versions */
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

  /** Update an existing row */
  update(txn: Transaction, key: string, data: any): void {
    const versions = this.storage.getAllVersions(key);
  
    if (versions.length === 0) {
      throw new Error(`Key '${key}' not found`);
    }
  
    const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
    if (!visible) {
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
    
    console.log(`[TXN ${txn.id}] UPDATE ${key} → old xmax=${txn.id}, new xmin=${txn.id}`);
  }

  /** Delete a row */
  delete(txn: Transaction, key: string): void {
    const versions = this.storage.getAllVersions(key);
  
    if (versions.length === 0) {
      throw new Error(`Key '${key}' not found`);
    }
  
    const visible = versions.find(row => this.mvcc.isVisible(row, txn.snapshot));
    if (!visible) {
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
    console.log(`[TXN ${txn.id}] DELETE ${key} → tombstone xmin=${tombstone.xmin}, xmax=${tombstone.xmax}`);
  }

  /** Select visible rows for a transaction */
  select(txn: Transaction, keys?: string[]): any[] {
    const keysToScan = keys || this.storage.getAllKeys();
    const results: any[] = [];

    // DEBUG LOGGING - Add this to see what's happening
    console.log(`[TXN ${txn.id}] SELECT - Checking ${keysToScan.length} keys`);

    for (const key of keysToScan) {
      txn.addRead(key);
      const versions = this.storage.getAllVersions(key);

      // DEBUG: Log all versions for this key
      if (versions.length > 0) {
        console.log(`[TXN ${txn.id}] Key '${key}' has ${versions.length} versions:`);
        versions.forEach((row, i) => {
          const visible = this.mvcc.isVisible(row, txn.snapshot);
          console.log(`  V${i}: xmin=${row.xmin}, xmax=${row.xmax}, data=${JSON.stringify(row.data)}, visible=${visible}`);
        });
      }

      // Only pick one visible version per key
      const visible = versions.find((row) => this.mvcc.isVisible(row, txn.snapshot));
      if (visible) {
        results.push({ key: visible.key, ...visible.data });
        console.log(`[TXN ${txn.id}] SELECT picked version with xmin=${visible.xmin}, data=${JSON.stringify(visible.data)}`);
      }
    }

    console.log(`[TXN ${txn.id}] SELECT returning ${results.length} rows`);
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

    // Apply all writes (now arrays per key)
    const writes = txn.getWrites();
    let totalWrites = 0;
    
    for (const rows of writes.values()) {
      totalWrites += rows.length;
    }
    
    console.log(`[TXN ${txn.id}] COMMIT - Applying ${totalWrites} writes across ${writes.size} keys`);
    
    for (const [key, rows] of writes) {
      for (const row of rows) {
        console.log(`  Writing: key=${row.key}, xmin=${row.xmin}, xmax=${row.xmax}`);
        this.storage.insert(row);
      }
    }

    this.commitTable.markCommitted(txn.id);
    this.txnManager.commit(txn);

    console.log(`[TXN ${txn.id}] COMMIT completed`);

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
