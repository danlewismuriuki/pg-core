# LSM-Tree Storage Engine

This document describes the Log-Structured Merge Tree (LSM-Tree) storage architecture, compaction strategy, and MVCC garbage collection.

---

## Overview

**Core principle:** Optimize for write throughput by converting random writes into sequential I/O.

**Key components:**

- **MemTable:** In-memory skip list for recent writes
- **SSTables:** Immutable sorted files on disk
- **Compaction:** Background merge process to reduce read amplification
- **MVCC GC:** Remove obsolete row versions during compaction

---

## Architecture

```
┌─────────────────────────────────────────┐
│ MemTable (Skip List)                    │
│ - In-memory, mutable                    │
│ - Max size: 4MB                         │
│ - Sorted by key                         │
└─────────────────────────────────────────┘
              │
              │ Flush (when full)
              v
┌─────────────────────────────────────────┐
│ Level 0 SSTables (4 files max)         │
│ - Overlapping key ranges                │
│ - Recently flushed from MemTable        │
└─────────────────────────────────────────┘
              │
              │ Compact (size-tiered)
              v
┌─────────────────────────────────────────┐
│ Level 1 SSTables (8 files max)         │
│ - Non-overlapping key ranges            │
│ - Merged from Level 0                   │
└─────────────────────────────────────────┘
              │
              │ Compact
              v
┌─────────────────────────────────────────┐
│ Level 2+ SSTables (16+ files)          │
│ - Largest, oldest data                  │
└─────────────────────────────────────────┘
```

---

## MemTable Structure

```typescript
class MemTable {
  private data: SkipList<string, VersionedRow>;
  private sizeBytes: number = 0;
  private readonly MAX_SIZE = 4 * 1024 * 1024; // 4MB

  put(key: string, value: any, xmin: number): void {
    const row: VersionedRow = {
      key,
      data: value,
      xmin,
      xmax: null,
    };

    this.data.insert(key, row);
    this.sizeBytes += this.estimateSize(row);

    // Trigger flush if over capacity
    if (this.sizeBytes >= this.MAX_SIZE) {
      this.triggerFlush();
    }
  }

  delete(key: string, xmax: number): void {
    const existing = this.data.get(key);
    if (existing) {
      existing.xmax = xmax; // Mark as deleted
    }
  }

  get(key: string, snapshot: Snapshot): VersionedRow | null {
    const row = this.data.get(key);
    if (!row) return null;

    return mvcc.isVisible(row, snapshot) ? row : null;
  }
}
```

**Why skip list?**

- O(log n) insert/lookup (similar to B-Tree)
- Lock-free concurrent reads (for future multi-threading)
- Simple implementation compared to concurrent hash tables

---

## SSTable Structure

```typescript
interface SSTable {
  filename: string;
  level: number;
  minKey: string;
  maxKey: string;
  bloomFilter: BloomFilter;
  indexBlock: Map<string, number>; // Key → file offset
  dataBlocks: Block[];
}

interface Block {
  entries: VersionedRow[];
  compressed: boolean;
}
```

**File layout:**

```
┌──────────────────────────────────────────┐
│ Data Block 0 (4KB)                       │
│ [row1, row2, row3, ...]                  │
├──────────────────────────────────────────┤
│ Data Block 1 (4KB)                       │
│ [row10, row11, row12, ...]               │
├──────────────────────────────────────────┤
│ ...                                      │
├──────────────────────────────────────────┤
│ Index Block                              │
│ [key1 → offset0, key10 → offset4096]     │
├──────────────────────────────────────────┤
│ Bloom Filter (probabilistic key set)    │
├──────────────────────────────────────────┤
│ Footer (metadata, checksum)              │
└──────────────────────────────────────────┘
```

---

## Write Path

### 1. Insert into MemTable

```typescript
async function insert(key: string, value: any, txnId: number): Promise<void> {
  // 1. Append to WAL (durability)
  await wal.append({
    type: WALRecordType.INSERT,
    txnId,
    key,
    data: value,
  });

  // 2. Update MemTable
  memTable.put(key, value, txnId);

  // 3. Check if flush needed
  if (memTable.size() >= memTable.MAX_SIZE) {
    await flushMemTable();
  }
}
```

---

### 2. Flush MemTable to SSTable

```typescript
async function flushMemTable(): Promise<void> {
  const snapshot = memTable.freeze(); // Immutable copy
  memTable = new MemTable(); // New mutable MemTable

  // Create SSTable
  const sstable = new SSTable((level = 0));

  for (const [key, row] of snapshot.entries()) {
    sstable.appendBlock(row);
    sstable.bloomFilter.add(key);

    // Every 4KB, seal block
    if (sstable.currentBlockSize() >= 4096) {
      sstable.sealBlock();
    }
  }

  // Write to disk
  await sstable.writeToDisk(`sstable-${Date.now()}.sst`);

  // Update manifest
  manifest.addSSTable(sstable.filename, (level = 0));

  // Trigger compaction if Level 0 is full
  if (manifest.getLevel(0).length >= 4) {
    await compactLevel(0);
  }
}
```

---

## Read Path

```typescript
async function get(key: string, snapshot: Snapshot): Promise<any | null> {
  // 1. Check MemTable first (most recent)
  const memTableRow = memTable.get(key, snapshot);
  if (memTableRow) {
    return memTableRow.xmax === null ? memTableRow.data : null;
  }

  // 2. Check SSTables in reverse level order (L0 → L1 → L2)
  for (const level of [0, 1, 2]) {
    const sstables = manifest.getLevel(level);

    for (const sstable of sstables) {
      // Quick reject via bloom filter
      if (!sstable.bloomFilter.mightContain(key)) {
        continue;
      }

      // Binary search in index block
      const offset = sstable.indexBlock.get(key);
      if (!offset) continue;

      // Read data block
      const block = await sstable.readBlock(offset);

      for (const row of block.entries) {
        if (row.key === key && mvcc.isVisible(row, snapshot)) {
          return row.xmax === null ? row.data : null;
        }
      }
    }
  }

  return null; // Not found
}
```

**Read amplification:**

- Worst case: Check MemTable + 4 L0 SSTables + 8 L1 SSTables + ...
- Mitigated by: Bloom filters (reduce disk seeks by 99%)

---

## Compaction Strategy (Size-Tiered)

### Why Compact?

**Problems without compaction:**

1. **Read amplification:** Must check 100+ SSTables for a single key
2. **Disk space:** Obsolete MVCC versions waste space
3. **Deleted data:** Tombstones (xmax set) never reclaimed

**Solution:** Merge SSTables, apply MVCC visibility, remove garbage.

---

### Compaction Algorithm

```typescript
async function compactLevel(sourceLevel: number): Promise<void> {
  const targetLevel = sourceLevel + 1;
  const sourceSSTables = manifest.getLevel(sourceLevel);

  // 1. Merge-sort all source SSTables
  const mergedIterator = new MergeSortIterator(sourceSSTables);

  // 2. Create new SSTable at target level
  const newSSTable = new SSTable(targetLevel);

  for (const row of mergedIterator) {
    // MVCC Garbage Collection: Skip invisible versions
    if (row.xmax !== null && row.xmax < globalOldestXmin) {
      continue; // Deleted and no txn can see it
    }

    if (row.xmin < globalOldestXmin) {
      // Version visible to all future snapshots, strip MVCC metadata
      // (Optional optimization)
    }

    newSSTable.appendBlock(row);
  }

  await newSSTable.writeToDisk(`sstable-L${targetLevel}-${Date.now()}.sst`);

  // 3. Update manifest (atomic)
  await manifest.replaceLevel(sourceLevel, [], [newSSTable]);

  // 4. Delete old SSTables
  for (const old of sourceSSTables) {
    await fs.unlink(old.filename);
  }
}
```

---

### Compaction Triggering

```typescript
class CompactionManager {
  private readonly LEVEL_RATIOS = [4, 8, 16, 32]; // Max files per level

  async checkCompaction(): Promise<void> {
    for (let level = 0; level < this.LEVEL_RATIOS.length; level++) {
      const sstables = manifest.getLevel(level);

      if (sstables.length >= this.LEVEL_RATIOS[level]) {
        await this.compactLevel(level);
      }
    }
  }
}
```

**Triggering conditions:**

- Level 0 reaches 4 SSTables
- Level 1 reaches 8 SSTables
- Level 2 reaches 16 SSTables

**Compaction timing:**

- Background thread checks every 60 seconds
- Also triggered after MemTable flush

---

## MVCC Garbage Collection

### globalOldestXmin Calculation

```typescript
function computeGlobalOldestXmin(): number {
  const candidates: number[] = [];

  // Include all active snapshot xmin values
  for (const snapshot of activeSnapshots) {
    candidates.push(snapshot.xmin);
  }

  // Include all running transaction IDs
  for (const txnId of runningTransactions) {
    candidates.push(txnId);
  }

  return candidates.length > 0 ? Math.min(...candidates) : nextTxnId;
}
```

**Semantics:**

- Any row version with `xmax < globalOldestXmin` is safe to delete
- No current or future snapshot can see it

---

### Garbage Collection During Compaction

```typescript
for (const row of mergedIterator) {
  // Case 1: Row deleted and no one can see the deletion
  if (row.xmax !== null && row.xmax < globalOldestXmin) {
    continue; // Skip (garbage collect)
  }

  // Case 2: Row created before oldest snapshot, not deleted
  if (row.xmin < globalOldestXmin && row.xmax === null) {
    // Keep, but could strip xmin metadata (optimization)
    newSSTable.appendBlock(row);
  }

  // Case 3: Row has recent MVCC metadata
  else {
    newSSTable.appendBlock(row); // Keep as-is
  }
}
```

---

## Write Amplification Analysis

**Problem:** Each write is eventually written multiple times due to compaction.

**Example:**

1. Write goes to MemTable
2. MemTable flushed to L0 SSTable (write #1)
3. L0 compacted to L1 (write #2)
4. L1 compacted to L2 (write #3)

**Write amplification = 3x** for a 3-level LSM-Tree.

**Mitigation:**

- Larger MemTable (fewer flushes)
- Larger level ratios (fewer compactions)
- Leveled compaction (lower amplification, higher cost)

---

## Bloom Filter

```typescript
class BloomFilter {
  private bits: BitArray;
  private numHashes: number = 3;

  add(key: string): void {
    for (let i = 0; i < this.numHashes; i++) {
      const hash = this.hash(key, i);
      this.bits.set(hash % this.bits.length);
    }
  }

  mightContain(key: string): boolean {
    for (let i = 0; i < this.numHashes; i++) {
      const hash = this.hash(key, i);
      if (!this.bits.get(hash % this.bits.length)) {
        return false; // Definitely not in set
      }
    }
    return true; // Might be in set (false positive possible)
  }
}
```

**False positive rate:** 1% with 3 hash functions and 10 bits per key

**Impact:**

- 99% of unnecessary disk seeks avoided
- Read performance improved by 10-100x

---

## Testing Strategy

### Unit Tests

```typescript
describe("LSM-Tree Mechanics", () => {
  test("MemTable flush at capacity", async () => {
    const lsm = new LSMTree();

    // Insert 4MB of data
    for (let i = 0; i < 1000; i++) {
      await lsm.put(`key${i}`, { data: "x".repeat(4096) }, (txnId = 1));
    }

    // Should trigger flush
    expect(lsm.getLevel(0).length).toBeGreaterThan(0);
  });

  test("Compaction merges SSTables", async () => {
    const lsm = new LSMTree();

    // Create 5 SSTables at L0 (trigger compaction)
    for (let i = 0; i < 5; i++) {
      await lsm.flushMemTable();
    }

    await lsm.compactLevel(0);

    expect(lsm.getLevel(0).length).toBe(0);
    expect(lsm.getLevel(1).length).toBeGreaterThan(0);
  });
});
```

### MVCC Integration Tests

```typescript
describe("LSM + MVCC", () => {
  test("Garbage collect deleted rows", async () => {
    const lsm = new LSMTree();

    // Insert and delete
    await lsm.put("key1", { data: "v1" }, (xmin = 100));
    await lsm.delete("key1", (xmax = 101));

    // Update globalOldestXmin
    globalOldestXmin = 102;

    // Compact
    await lsm.compactLevel(0);

    // Row should be gone
    const result = await lsm.get("key1", snapshot);
    expect(result).toBeNull();
  });
});
```

---

## Known Limitations

### 1. No Leveled Compaction

**Current:** Size-tiered compaction  
**Missing:** Leveled compaction (RocksDB/Cassandra style)

**Impact:**

- Higher write amplification
- More space amplification

**Production solution:** Implement leveled compaction for write-heavy workloads

---

### 2. No Compression

**Current:** Uncompressed data blocks  
**Missing:** ZSTD/Snappy compression

**Impact:** 2-5x larger disk usage

---

### 3. No Tiered Storage

**Current:** All SSTables on same disk  
**Missing:** Hot data on SSD, cold data on HDD

**Impact:** Cannot optimize cost vs performance

---

### 4. Fixed Block Size

**Current:** 4KB blocks  
**Missing:** Adaptive block sizing

**Impact:** Suboptimal for large values

---

## Comparison to Other Systems

| System             | Storage Model    | Compaction  | Compression | Use Case        |
| ------------------ | ---------------- | ----------- | ----------- | --------------- |
| **This prototype** | LSM-Tree         | Size-tiered | None        | Write-heavy     |
| **RocksDB**        | LSM-Tree         | Leveled     | ZSTD        | General-purpose |
| **Cassandra**      | LSM-Tree         | Size-tiered | LZ4         | Distributed     |
| **Postgres**       | B-Tree heap      | VACUUM      | TOAST       | OLTP            |
| **MySQL InnoDB**   | B-Tree clustered | None        | None        | OLTP            |

---

## Future Enhancements

### 1. Parallel Compaction

**Current:** Single-threaded compaction  
**Improvement:** Compact multiple levels in parallel

---

### 2. Partitioned SSTables

**Current:** Single key range per SSTable  
**Improvement:** Shard by hash(key) for parallel reads

---

### 3. Column-Oriented Storage

**Current:** Row-oriented  
**Improvement:** Parquet-style columnar blocks for analytics

---

## References

- [The Log-Structured Merge-Tree (LSM-Tree)](https://www.cs.umb.edu/~poneil/lsmtree.pdf) (O'Neil et al., 1996)
- [RocksDB Compaction](https://github.com/facebook/rocksdb/wiki/Compaction)
- [Cassandra Storage Engine](https://cassandra.apache.org/doc/latest/architecture/storage-engine.html)
