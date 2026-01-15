# Indexing & MVCC Semantics

This document describes the B-Tree index implementation, MVCC-aware index scanning, and the index-heap interaction model.

---

## Overview

**Core principle:** Indexes are derived structures that accelerate queries while respecting MVCC visibility.

**Key properties:**

- Indexes carry MVCC metadata (xmin)
- Index scans validate visibility against heap
- Indexes are not WAL-logged (rebuilt on recovery)
- Multiple versions of same key can coexist

---

## Index Entry Structure

```typescript
interface IndexEntry {
  indexKey: any; // Value of indexed column (e.g., age=30)
  primaryKey: string; // Pointer to heap row (e.g., user_id='abc')
  xmin: number; // Transaction that created this index entry
}
```

**Why carry xmin?**

- An index entry can become "stale" if the heap row is deleted
- We need xmin to check if the entry is still valid

---

## B-Tree Structure

```typescript
class BTree {
  private root: BTreeNode;
  private readonly ORDER = 128; // Max keys per node

  insert(indexKey: any, primaryKey: string, xmin: number): void {
    const entry: IndexEntry = { indexKey, primaryKey, xmin };

    // Standard B-Tree insertion
    const leaf = this.findLeaf(indexKey);
    leaf.entries.push(entry);
    leaf.entries.sort((a, b) => compare(a.indexKey, b.indexKey));

    if (leaf.entries.length > this.ORDER) {
      this.splitNode(leaf);
    }
  }

  search(indexKey: any): IndexEntry[] {
    const leaf = this.findLeaf(indexKey);
    return leaf.entries.filter((e) => e.indexKey === indexKey);
  }

  range(minKey: any, maxKey: any): IndexEntry[] {
    const results: IndexEntry[] = [];
    const startLeaf = this.findLeaf(minKey);

    let current = startLeaf;
    while (current !== null) {
      for (const entry of current.entries) {
        if (entry.indexKey >= minKey && entry.indexKey <= maxKey) {
          results.push(entry);
        }
        if (entry.indexKey > maxKey) {
          return results;
        }
      }
      current = current.next; // Leaf nodes are linked
    }

    return results;
  }
}

interface BTreeNode {
  isLeaf: boolean;
  keys: any[];
  children?: BTreeNode[]; // Internal nodes
  entries?: IndexEntry[]; // Leaf nodes
  next?: BTreeNode; // Leaf-level linked list for range scans
}
```

---

## Index Scan with MVCC Validation

**Critical insight:** Index entries can point to stale or deleted heap rows.

### Point Lookup

```typescript
async function indexLookup(
  index: BTree,
  indexKey: any,
  table: Table,
  snapshot: Snapshot
): Promise<any | null> {
  // 1. Search index
  const entries = index.search(indexKey);

  // 2. Validate each entry against heap
  for (const entry of entries) {
    const heapRow = table.get(entry.primaryKey);

    if (!heapRow) {
      continue; // Row was physically deleted (GC'd)
    }

    // 3. Check MVCC visibility
    if (mvcc.isVisible(heapRow, snapshot)) {
      return heapRow.data;
    }
  }

  return null; // No visible version found
}
```

**Why validate against heap?**

- Index entry might have xmin=100 (visible)
- But heap row has xmax=105 (deleted by T105)
- Without heap check, we'd return deleted data

---

### Range Scan

```typescript
class IndexScanOperator implements Iterator {
  private indexIterator: Iterator<IndexEntry>;
  private currentEntry: IndexEntry | null = null;

  open(): void {
    this.indexIterator = this.index.range(this.minKey, this.maxKey);
  }

  next(): VersionedRow | null {
    while (true) {
      this.currentEntry = this.indexIterator.next();

      if (!this.currentEntry) {
        return null; // End of range
      }

      // Fetch heap row
      const heapRow = this.table.get(this.currentEntry.primaryKey);

      if (!heapRow) {
        continue; // Row GC'd, skip
      }

      // Check visibility
      if (mvcc.isVisible(heapRow, this.snapshot)) {
        return heapRow; // Visible row found
      }

      // Row not visible, continue scanning
    }
  }

  close(): void {
    this.indexIterator = null;
  }
}
```

**Performance note:**

- Must validate **every** index entry against heap
- For hot keys, this can be expensive (10+ versions)
- Production systems use index-only scans when possible

---

## Index Maintenance During Transactions

### Insert

```typescript
async function insert(
  table: Table,
  indexes: Map<string, BTree>,
  row: any,
  txnId: number
): Promise<void> {
  // 1. Insert into heap
  const versionedRow: VersionedRow = {
    key: row.id,
    data: row,
    xmin: txnId,
    xmax: null,
  };

  table.put(row.id, versionedRow);

  // 2. Insert into all indexes
  for (const [columnName, index] of indexes) {
    const indexKey = row[columnName];
    index.insert(indexKey, row.id, txnId);
  }
}
```

---

### Delete (Logical)

```typescript
async function deleteRow(
  table: Table,
  indexes: Map<string, BTree>,
  primaryKey: string,
  txnId: number
): Promise<void> {
  // 1. Mark heap row as deleted (xmax = txnId)
  const heapRow = table.get(primaryKey);
  heapRow.xmax = txnId;

  // 2. Index entries remain!
  // They will be filtered out during index scans via MVCC visibility

  // Note: Physical deletion happens during compaction/VACUUM
}
```

**Why not delete index entries?**

- Concurrent transactions with older snapshots might still see the row
- Index entry with xmin=100 is still valid for snapshots < 105

---

### Update

```typescript
async function update(
  table: Table,
  indexes: Map<string, BTree>,
  primaryKey: string,
  newData: any,
  txnId: number
): Promise<void> {
  // UPDATE = DELETE old + INSERT new (in MVCC)

  // 1. Mark old version as deleted
  const oldRow = table.get(primaryKey);
  oldRow.xmax = txnId;

  // 2. Insert new version
  const newRow: VersionedRow = {
    key: primaryKey,
    data: newData,
    xmin: txnId,
    xmax: null,
  };

  table.put(primaryKey, newRow);

  // 3. Update indexes (insert new entries)
  for (const [columnName, index] of indexes) {
    const indexKey = newData[columnName];
    index.insert(indexKey, primaryKey, txnId);
  }

  // Old index entries remain (filtered by MVCC)
}
```

---

## Index Garbage Collection

### Problem: Index Bloat

**Scenario:**

```sql
-- T100: Insert row
INSERT INTO users VALUES (1, 'Alice', 30);
→ Index entry: {indexKey: 30, pk: 1, xmin: 100}

-- T101: Update row
UPDATE users SET age = 31 WHERE id = 1;
→ New index entry: {indexKey: 31, pk: 1, xmin: 101}
→ Old entry still exists: {indexKey: 30, pk: 1, xmin: 100}

-- T102: Delete row
DELETE FROM users WHERE id = 1;
→ Both index entries still exist!
```

**Result:** Index grows without bound.

---

### Solution: Index Compaction

```typescript
async function compactIndex(index: BTree, table: Table): Promise<void> {
  const newIndex = new BTree(index.keyColumn);

  // Scan heap and rebuild index
  for (const heapRow of table.scan()) {
    // Only index visible versions
    if (heapRow.xmax === null || heapRow.xmax >= globalOldestXmin) {
      const indexKey = heapRow.data[index.keyColumn];
      newIndex.insert(indexKey, heapRow.key, heapRow.xmin);
    }
  }

  // Atomic swap
  indexManager.replace(index.name, newIndex);
}
```

**Triggering:**

- Piggyback on LSM-Tree compaction
- Or periodic VACUUM-style process

---

## Index Selection (Query Optimizer)

### Cost Model

```typescript
function selectIndex(
  table: Table,
  predicate: Predicate,
  indexes: Map<string, BTree>
): ScanOperator {
  const seqScanCost = table.estimateRowCount();

  let bestPlan: ScanOperator = new SeqScan(table);
  let bestCost = seqScanCost;

  for (const [columnName, index] of indexes) {
    if (predicate.column !== columnName) {
      continue; // Index doesn't cover predicate
    }

    // Estimate index selectivity
    const selectivity = 0.1; // Assume 10% without statistics
    const indexCost = table.estimateRowCount() * selectivity;

    if (indexCost < bestCost) {
      bestPlan = new IndexScan(index, table, predicate);
      bestCost = indexCost;
    }
  }

  return bestPlan;
}
```

**Limitations (without statistics):**

- Assumes 10% selectivity for all predicates
- Doesn't account for data skew
- No histogram information

---

## Index-Only Scans (Future Optimization)

**Current approach:** Always fetch heap row to validate visibility

**Optimization:** If index carries enough info, skip heap lookup

```typescript
interface IndexEntryWithVisibility {
  indexKey: any;
  primaryKey: string;
  xmin: number;
  xmax: number | null; // Add xmax to index!
  data: any; // Add covered columns
}

function indexOnlyScan(
  index: BTree,
  predicate: Predicate,
  snapshot: Snapshot
): any[] {
  const results = [];

  for (const entry of index.range(predicate.minKey, predicate.maxKey)) {
    // Check visibility WITHOUT heap lookup
    if (mvcc.isVisible({ xmin: entry.xmin, xmax: entry.xmax }, snapshot)) {
      results.push(entry.data);
    }
  }

  return results;
}
```

**Trade-off:**

- Faster queries (no heap lookups)
- Larger indexes (store xmax + data)

---

## Why Indexes Are Not WAL-Logged

### Current Approach

**Recovery protocol:**

1. Replay WAL into MemTable (data)
2. Rebuild all indexes from scratch

**Rationale:**

- Simpler WAL (no index-specific operations)
- Automatic corruption repair
- Indexes are derived state (can always be reconstructed)

---

### Alternative: WAL-Logged Indexes (Postgres)

**How it works:**

```
WAL: [
  INSERT user(id=1, name='Alice', age=30),
  INSERT_INDEX(idx_name, 'Alice' → pk:1),
  INSERT_INDEX(idx_age, 30 → pk:1)
]
```

**Advantages:**

- Fast recovery (just replay index operations)

**Disadvantages:**

- More complex WAL
- Index-specific redo logic
- B-Tree splits logged explicitly

---

### Trade-off Analysis

| Approach                  | Recovery Time     | WAL Complexity | Corruption Handling |
| ------------------------- | ----------------- | -------------- | ------------------- |
| **Not logged (ours)**     | O(data × indexes) | Low            | Automatic           |
| **WAL-logged (Postgres)** | O(WAL size)       | High           | Manual repair       |

**Our decision:** Prototype simplicity > recovery speed

---

## Testing Strategy

### Unit Tests

```typescript
describe("Index MVCC Semantics", () => {
  test("Index scan filters deleted rows", async () => {
    const table = new Table("users");
    const index = new BTree("age");

    // T100: Insert
    await insert(table, new Map([["age", index]]), { id: 1, age: 30 }, 100);

    // T101: Delete
    await deleteRow(table, new Map([["age", index]]), "1", 101);

    // Snapshot at T102 (after delete)
    const snapshot = { xmin: 100, xmax: 102, activeTxns: new Set() };

    const result = await indexLookup(index, 30, table, snapshot);
    expect(result).toBeNull(); // Row deleted
  });

  test("Index scan sees own writes", async () => {
    const txn = db.begin(); // xmin=100

    await db.execute('INSERT INTO users VALUES (1, "Alice", 30)', txn);
    const result = await db.execute("SELECT * FROM users WHERE age=30", txn);

    expect(result.rows).toHaveLength(1); // Sees own insert
  });
});
```

---

### Integration Tests

```typescript
describe("Index + Compaction", () => {
  test("Index GC removes stale entries", async () => {
    // Insert 1000 rows
    for (let i = 0; i < 1000; i++) {
      await db.execute(
        `INSERT INTO users VALUES (${i}, "User${i}", ${i % 100})`
      );
    }

    // Update all rows (creates 1000 stale index entries)
    for (let i = 0; i < 1000; i++) {
      await db.execute(
        `UPDATE users SET age = ${(i % 100) + 1} WHERE id = ${i}`
      );
    }

    // Trigger compaction
    globalOldestXmin = 2000;
    await db.compactIndexes();

    // Index should have ~1000 entries, not 2000
    const indexSize = db.getIndex("idx_age").size();
    expect(indexSize).toBeLessThan(1500);
  });
});
```

---

## Known Limitations

### 1. No Covering Indexes

**Missing:** Index-only scans (avoid heap lookups)

**Impact:** Every index scan touches heap

---

### 2. No Partial Indexes

**Missing:** `CREATE INDEX idx_active ON users(age) WHERE active = true`

**Impact:** Cannot optimize filtered queries

---

### 3. No Expression Indexes

**Missing:** `CREATE INDEX idx_lower ON users(LOWER(name))`

**Impact:** Cannot index computed values

---

### 4. No Concurrent Index Build

**Current:** `CREATE INDEX` blocks all writes

**Production solution:** Online index build (Postgres-style)

---

### 5. Fixed B-Tree Order

**Current:** ORDER = 128 (fixed)

**Missing:** Adaptive order based on key size

---

## Comparison to Other Systems

| System             | Index Type       | MVCC in Index        | Index WAL | Index-Only Scans     |
| ------------------ | ---------------- | -------------------- | --------- | -------------------- |
| **This prototype** | B-Tree           | Yes (xmin)           | No        | No                   |
| **Postgres**       | B-Tree           | Partial              | Yes       | Yes (visibility map) |
| **MySQL InnoDB**   | B-Tree clustered | Yes                  | Yes       | Yes                  |
| **MongoDB**        | B-Tree           | No (uses WiredTiger) | Yes       | Yes                  |
| **SQLite**         | B-Tree           | No (lock-based)      | Yes       | No                   |

---

## Future Enhancements

### 1. Covering Indexes

Store additional columns in index for index-only scans

---

### 2. Bloom Filter Indexes

For high-cardinality columns (UUIDs, URLs)

---

### 3. GIN/GiST Indexes

For full-text search, JSON, geospatial

---

### 4. Index Compression

Delta encoding for sorted keys (RLE, prefix compression)

---

## References

- [Postgres Index Types](https://www.postgresql.org/docs/current/indexes-types.html)
- [Index-Only Scans](https://www.postgresql.org/docs/current/indexes-index-only-scans.html)
- [The Case for Learned Index Structures](https://arxiv.org/abs/1712.01208) (Kraska et al., 2018)
