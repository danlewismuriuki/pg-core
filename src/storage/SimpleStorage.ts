import { VersionedRow } from '../mvcc/VersionedRow';
import { MVCCEngine } from '../mvcc/MVCCEngine';

export class SimpleStorage {
  private data = new Map<string, VersionedRow[]>();

insert(row: VersionedRow): void {
    if (!this.data.has(row.key)) {
      this.data.set(row.key, []);
    }
    
    const versions = this.data.get(row.key)!;
    
    // Check if this row is updating an existing version
    // A tombstone (xmax !== null) should replace the version with same xmin and xmax:null
    if (row.xmax !== null) {
      // Find and replace the version this tombstone is marking as deleted
      const index = versions.findIndex(v => 
        v.xmin === row.xmin && v.xmax === null
      );
      if (index !== -1) {
        versions[index] = row;
        return;
      }
    }
    
    // Otherwise, append new version
    versions.push(row);
  }

  getAllVersions(key: string): VersionedRow[] {
    return this.data.get(key) || [];
  }

  getLatestVersion(key: string): VersionedRow | null {
    const versions = this.data.get(key);
    if (!versions || versions.length === 0) return null;
    return versions[versions.length - 1];
  }

  getAllKeys(): string[] {
    return Array.from(this.data.keys());
  }

  garbageCollect(globalOldestXmin: number, mvcc: MVCCEngine): number {
    let collected = 0;

    for (const [key, versions] of this.data) {
      const kept = versions.filter(
        (row) => !mvcc.canGarbageCollect(row, globalOldestXmin)
      );

      collected += versions.length - kept.length;

      if (kept.length === 0) {
        this.data.delete(key);
      } else {
        this.data.set(key, kept);
      }
    }

    return collected;
  }
}
