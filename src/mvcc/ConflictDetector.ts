// import { Transaction } from '../transaction/Transaction';
// import { CommitTable } from '../transaction/CommitTable';
// import { SimpleStorage } from '../storage/SimpleStorage';

// export class ConflictDetector {
//   constructor(
//     private storage: SimpleStorage,
//     private commitTable: CommitTable
//   ) {}

//   detectConflict(txn: Transaction): string | null {
//     for (const [key, writtenRow] of txn.getWrites()) {
//       const latestVersion = this.storage.getLatestVersion(key);

//       if (!latestVersion) continue;

//       // Conflict: Someone else modified this key after our snapshot
//       if (
//         latestVersion.xmin > txn.snapshot.xmin &&
//         this.commitTable.isCommitted(latestVersion.xmin)
//       ) {
//         return `Write-write conflict on key '${key}': Transaction ${latestVersion.xmin} committed after snapshot`;
//       }

//       // Conflict: Someone else deleted this key after our snapshot
//       if (
//         latestVersion.xmax !== null &&
//         latestVersion.xmax > txn.snapshot.xmin &&
//         this.commitTable.isCommitted(latestVersion.xmax)
//       ) {
//         return `Write-write conflict on key '${key}': Row deleted by transaction ${latestVersion.xmax}`;
//       }
//     }

//     return null;
//   }
// }


import { CommitTable } from '../transaction/CommitTable';
import { Transaction } from '../transaction/Transaction';
import { SimpleStorage } from '../storage/SimpleStorage';

export class ConflictDetector {
  constructor(private storage: SimpleStorage, private commitTable: CommitTable) {}

//   detectConflict(txn: Transaction): string | null {
//     for (const key of txn.getWrites().keys()) {
//       const versions = this.storage.getAllVersions(key);

//       for (const row of versions) {
//         // Skip my own writes
//         if (row.xmin === txn.id) continue;

//         // Another committed transaction wrote after my snapshot
//         if (this.commitTable.isCommitted(row.xmin) && row.xmin >= txn.snapshot.xmin) {
//           return `Write-write conflict on key '${key}'`;
//         }
//       }
//     }

//     return null;
//   }

// detectConflict(txn: Transaction): string | null {
//     for (const key of txn.getWrites().keys()) {
//       const versions = this.storage.getAllVersions(key);
  
//       for (const row of versions) {
//         // Skip my own writes
//         if (row.xmin === txn.id) continue;
  
//         // Another committed txn wrote after my snapshot
//         if (
//           this.commitTable.isCommitted(row.xmin) &&
//           row.xmin >= txn.snapshot.xmin
//         ) {
//           return `Write-write conflict on key '${key}'`;
//         }
//       }
//     }
//     return null;
//   }  
detectConflict(txn: Transaction): string | null {
    for (const key of txn.getWrites().keys()) {
      const versions = this.storage.getAllVersions(key);
  
      for (const row of versions) {
        if (row.xmin === txn.id) continue;
  
        if (
          this.commitTable.isCommitted(row.xmin) &&
          row.xmin >= txn.snapshot.xmin
        ) {
          return `Write-write conflict on key '${key}'`;
        }
      }
    }
    return null;
  }
  
}

