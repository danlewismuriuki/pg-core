// // // // import { Transaction } from './Transaction';
// // // // import { Snapshot } from './Snapshot';

// // // // export class TransactionManager {
// // // //   private nextTxnId = 1;
// // // //   private activeTxns = new Map<number, Transaction>();

// // // //   begin(): Transaction {
// // // //     const txnId = this.nextTxnId++;

// // // //     // snapshot xmin must be smallest active txn id
// // // //     const xmin = this.activeTxns.size === 0
// // // //       ? txnId
// // // //       : Math.min(...this.activeTxns.keys());

// // // //     const snapshot: Snapshot = {
// // // //       xmin,
// // // //       xmax: this.nextTxnId,
// // // //       activeTxns: new Set(this.activeTxns.keys()),
// // // //       myTxnId: txnId,
// // // //     };

// // // //     const txn = new Transaction(txnId, snapshot);
// // // //     this.activeTxns.set(txnId, txn);

// // // //     return txn;
// // // //   }

// // // //   commit(txn: Transaction): void {
// // // //     this.activeTxns.delete(txn.id);
// // // //   }

// // // //   abort(txn: Transaction): void {
// // // //     this.activeTxns.delete(txn.id);
// // // //   }

// // // //   getGlobalOldestXmin(): number {
// // // //     if (this.activeTxns.size === 0) {
// // // //       return this.nextTxnId;
// // // //     }
// // // //     return Math.min(...Array.from(this.activeTxns.keys()));
// // // //   }

// // // //   getActiveTxns(): Map<number, Transaction> {
// // // //     return this.activeTxns;
// // // //   }

// // // //   getNextTxnId(): number {
// // // //     return this.nextTxnId;
// // // //   }
// // // // }


// // // import { Transaction } from './Transaction';
// // // import { Snapshot } from './Snapshot';

// // // export class TransactionManager {
// // //   private nextTxnId = 1;
// // //   private activeTxns = new Map<number, Transaction>();

// // //   begin(): Transaction {
// // //     const txnId = this.nextTxnId++;

// // //     // Snapshot xmin = smallest active txn, or txnId if none
// // //     const xmin = this.activeTxns.size === 0
// // //       ? txnId
// // //       : Math.min(...this.activeTxns.keys());

// // //     // Capture snapshot of currently active txns (exclude the new txn)
// // //     const snapshot: Snapshot = {
// // //       xmin,
// // //       xmax: this.nextTxnId,
// // //       activeTxns: new Set(this.activeTxns.keys()),
// // //       myTxnId: txnId,
// // //     };

// // //     const txn = new Transaction(txnId, snapshot);

// // //     // Add new transaction to active txns after snapshot is captured
// // //     this.activeTxns.set(txnId, txn);

// // //     return txn;
// // //   }

// // //   commit(txn: Transaction): void {
// // //     this.activeTxns.delete(txn.id);
// // //   }

// // //   abort(txn: Transaction): void {
// // //     this.activeTxns.delete(txn.id);
// // //   }

// // //   getGlobalOldestXmin(): number {
// // //     if (this.activeTxns.size === 0) {
// // //       return this.nextTxnId;
// // //     }
// // //     return Math.min(...this.activeTxns.keys());
// // //   }

// // //   getActiveTxns(): Map<number, Transaction> {
// // //     return this.activeTxns;
// // //   }

// // //   getNextTxnId(): number {
// // //     return this.nextTxnId;
// // //   }
// // // }

// // import { Transaction } from './Transaction';
// // import { Snapshot } from './Snapshot';

// // export class TransactionManager {
// //   private nextTxnId = 1;
// //   private activeTxns = new Map<number, Transaction>();

// //   begin(): Transaction {
// //     const txnId = this.nextTxnId++;

// //     // xmin = smallest active txn including this one
// //     const xmin = this.activeTxns.size === 0
// //       ? txnId
// //       : Math.min(...this.activeTxns.keys(), txnId);

// //     // activeTxns includes current txn
// //     const snapshot: Snapshot = {
// //       xmin,
// //       xmax: this.nextTxnId,
// //       activeTxns: new Set([...this.activeTxns.keys(), txnId]),
// //       myTxnId: txnId,
// //     };

// //     const txn = new Transaction(txnId, snapshot);
// //     this.activeTxns.set(txnId, txn);

// //     return txn;
// //   }

// //   commit(txn: Transaction): void {
// //     this.activeTxns.delete(txn.id);
// //   }

// //   abort(txn: Transaction): void {
// //     this.activeTxns.delete(txn.id);
// //   }

// //   getGlobalOldestXmin(): number {
// //     if (this.activeTxns.size === 0) {
// //       return this.nextTxnId;
// //     }
// //     return Math.min(...this.activeTxns.keys());
// //   }

// //   getActiveTxns(): Map<number, Transaction> {
// //     return this.activeTxns;
// //   }

// //   getNextTxnId(): number {
// //     return this.nextTxnId;
// //   }
// // }

// import { Transaction } from './Transaction';
// import { Snapshot } from './Snapshot';

// export class TransactionManager {
//   private nextTxnId = 1;
//   private activeTxns = new Map<number, Transaction>();

//   begin(): Transaction {
//     const txnId = this.nextTxnId++;

//     const xmin =
//       this.activeTxns.size === 0
//         ? txnId
//         : Math.min(...this.activeTxns.keys());

//     const snapshot: Snapshot = {
//       xmin,
//       xmax: this.nextTxnId,
//       activeTxns: new Set(this.activeTxns.keys()), // ❗ excludes self
//       myTxnId: txnId,
//     };

//     const txn = new Transaction(txnId, snapshot);
//     this.activeTxns.set(txnId, txn);

//     return txn;
//   }

//   commit(txn: Transaction): void {
//     this.activeTxns.delete(txn.id);
//   }

//   abort(txn: Transaction): void {
//     this.activeTxns.delete(txn.id);
//   }

//   getGlobalOldestXmin(): number {
//     if (this.activeTxns.size === 0) {
//       return this.nextTxnId;
//     }
//     return Math.min(
//       ...Array.from(this.activeTxns.values()).map(t => t.snapshot.xmin)
//     );
//   }
// }

// import { Transaction } from './Transaction';
// import { Snapshot } from './Snapshot';

// export class TransactionManager {
//   private nextTxnId = 1;
//   private activeTxns = new Map<number, Transaction>();

//   begin(): Transaction {
//     const txnId = this.nextTxnId++;

//     const xmin =
//       this.activeTxns.size === 0
//         ? txnId
//         : Math.min(...this.activeTxns.keys());

//     const snapshot: Snapshot = {
//       xmin,
//       xmax: this.nextTxnId,
//       activeTxns: new Set(this.activeTxns.keys()), // excludes self
//       myTxnId: txnId,
//     };

//     const txn = new Transaction(txnId, snapshot);
//     this.activeTxns.set(txnId, txn);

//     return txn;
//   }

//   commit(txn: Transaction): void {
//     this.activeTxns.delete(txn.id);
//   }

//   abort(txn: Transaction): void {
//     this.activeTxns.delete(txn.id);
//   }

//   getGlobalOldestXmin(): number {
//     if (this.activeTxns.size === 0) {
//       return this.nextTxnId;
//     }
//     return Math.min(
//       ...Array.from(this.activeTxns.values()).map(t => t.snapshot.xmin)
//     );
//   }

//   getNextTxnId(): number {
//     return this.nextTxnId;
//   }
// }


import { Transaction } from './Transaction';
import { Snapshot } from './Snapshot';

export class TransactionManager {
  private nextTxnId = 1;
  private activeTxns = new Map<number, Transaction>();

//   begin(): Transaction {
//     const txnId = this.nextTxnId++;

//     // xmin = smallest active txn INCLUDING this one
//     const xmin =
//       this.activeTxns.size === 0
//         ? txnId
//         : Math.min(...this.activeTxns.keys(), txnId);

//     const snapshot: Snapshot = {
//       xmin,
//       xmax: this.nextTxnId,
//       activeTxns: new Set([...this.activeTxns.keys(), txnId]), // INCLUDE self
//       myTxnId: txnId,
//     };

//     const txn = new Transaction(txnId, snapshot);
//     this.activeTxns.set(txnId, txn);
//     return txn;
//   }
begin(): Transaction {
    const txnId = this.nextTxnId++;
  
    // Active txns BEFORE this txn starts (exclude this txn)
    const activeBefore = Array.from(this.activeTxns.keys()).filter(id => id < txnId);
  
    const xmin =
      activeBefore.length === 0
        ? txnId
        : Math.min(...activeBefore);
  
    const snapshot: Snapshot = {
      xmin,
      xmax: txnId, // snapshot boundary is this txn
      activeTxns: new Set(activeBefore), // IMPORTANT: exclude self
      myTxnId: txnId,
    };
  
    const txn = new Transaction(txnId, snapshot);
    this.activeTxns.set(txnId, txn);
  
    return txn;
  }  

  commit(txn: Transaction): void {
    this.activeTxns.delete(txn.id);
  }

  abort(txn: Transaction): void {
    this.activeTxns.delete(txn.id);
  }

  getGlobalOldestXmin(): number {
    if (this.activeTxns.size === 0) {
      return this.nextTxnId;
    }
    return Math.min(
      ...Array.from(this.activeTxns.values()).map(t => t.snapshot.xmin)
    );
  }

  getNextTxnId(): number {
    return this.nextTxnId;
  }
}
