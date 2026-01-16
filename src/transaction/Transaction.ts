// import { Snapshot } from './Snapshot';
// import { VersionedRow } from '../mvcc/VersionedRow';

// export class Transaction {
//   public readonly id: number;
//   public readonly snapshot: Snapshot;
//   private writeSet = new Map<string, VersionedRow>();
//   private readSet = new Set<string>();

//   constructor(id: number, snapshot: Snapshot) {
//     this.id = id;
//     this.snapshot = snapshot;
//   }

//   addRead(key: string): void {
//     this.readSet.add(key);
//   }

//   addWrite(key: string, row: VersionedRow): void {
//     this.writeSet.set(key, row);
//   }

//   getWrites(): Map<string, VersionedRow> {
//     return this.writeSet;
//   }

//   getReads(): Set<string> {
//     return this.readSet;
//   }
// }


import { Snapshot } from './Snapshot';
import { VersionedRow } from '../mvcc/VersionedRow';

export class Transaction {
  public readonly id: number;
  public readonly snapshot: Snapshot;
  private writeSet = new Map<string, VersionedRow[]>();  // ✅ Array per key
  private readSet = new Set<string>();

  constructor(id: number, snapshot: Snapshot) {
    this.id = id;
    this.snapshot = snapshot;
  }

  addRead(key: string): void {
    this.readSet.add(key);
  }

  addWrite(key: string, row: VersionedRow): void {
    if (!this.writeSet.has(key)) {
      this.writeSet.set(key, []);
    }
    this.writeSet.get(key)!.push(row);
  }

  getWrites(): Map<string, VersionedRow[]> {
    return this.writeSet;
  }

  getReads(): Set<string> {
    return this.readSet;
  }
}