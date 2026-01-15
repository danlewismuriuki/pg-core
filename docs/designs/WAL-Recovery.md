# Write-Ahead Logging & Crash Recovery

This document describes the WAL protocol, durability guarantees, and crash recovery procedures.

---

## Overview

**Core principle:** The WAL is the single source of truth for committed data.

**Key invariants:**

1. **Write-ahead:** All modifications logged before data structures updated
2. **Commit durability:** COMMIT record fsynced before acknowledging success
3. **Replay idempotence:** Replaying committed operations produces same state

---

## WAL Record Structure

```typescript
interface WALRecord {
  lsn: number; // Log Sequence Number (monotonic)
  txnId: number; // Transaction ID
  type: WALRecordType; // Operation type
  tableId: string; // Target table
  key: string; // Row key
  data: any; // Payload (for INSERT/UPDATE)
  checksum: number; // CRC32 for corruption detection
}

enum WALRecordType {
  BEGIN,
  INSERT,
  UPDATE,
  DELETE,
  COMMIT,
  ABORT,
}
```

---

## Write Path

### 1. Transaction Begins

```typescript
BEGIN;
→ WAL: [BEGIN(txnId=100)]  // Buffered, not fsynced
```

### 2. Modifications

```typescript
INSERT INTO users VALUES (1, 'Alice', 30);
→ WAL: [INSERT(txnId=100, table='users', key='1', data={...})]  // Buffered
→ MemTable: Put(key='1', value={...}, xmin=100, xmax=null)
→ Index: Insert(age=30, pk='1', xmin=100)
```

**Critical order:**

1. Append to WAL (buffered)
2. Update MemTable
3. Update indexes

**Note:** Indexes are **not logged** (they are derived state).

### 3. Commit

```typescript
COMMIT;
→ WAL: [COMMIT(txnId=100)]
→ fsync()  ← DURABILITY POINT
→ Return success to client
```

**Durability guarantee:**
Once `fsync()` returns, the transaction is durable and will survive crashes.

---

## Durability Point Semantics

```
Timeline:

  INSERT buffered    COMMIT buffered    fsync()        ACK client
      │                  │                │                │
      v                  v                v                v
  ────┼──────────────────┼────────────────┼────────────────┼──────>
      │                  │                │                │
      │                  │                │            DURABLE
      │                  │                │            ========
      │                  │            If crash here,
      │                  │            txn survives
      │                  │
      │              If crash here,
      │              txn is lost
      │
  Not yet durable
```

**Critical:** Clients must not be acknowledged until after `fsync()` completes.

---

## Crash Scenarios

### Scenario 1: Crash Before COMMIT

```
WAL: [BEGIN(100), INSERT(...), INSERT(...)]
```

**Recovery behavior:** Transaction not committed → ignore all records for txnId=100

---

### Scenario 2: Crash After COMMIT, Before fsync

```
WAL: [BEGIN(100), INSERT(...), COMMIT(100)]  ← Not yet fsynced
```

**Recovery behavior:** COMMIT record lost → transaction aborted

**Why this is correct:** Client was not acknowledged, so from their perspective, the transaction never completed.

---

### Scenario 3: Crash After fsync, Before Index Update

```
WAL: [BEGIN(100), INSERT(...), COMMIT(100)]  ← Durable
Indexes: Not yet updated
```

**Recovery behavior:**

1. Replay INSERT into MemTable
2. Rebuild indexes from MemTable

**Why this is correct:** Indexes are ephemeral derived state. WAL is the source of truth.

---

### Scenario 4: Crash During Checkpoint

```
manifest.json: {checkpointLSN: 1000}
WAL: [LSN 1001...2000]
MemTable: Partially flushed to SSTable
```

**Recovery behavior:**

1. Read checkpointLSN from manifest
2. Replay WAL from LSN 1000 forward
3. Rebuild indexes

**Why this is correct:** Checkpoint updates are atomic (via file rename). Partial checkpoints are ignored.

---

## Recovery Protocol

### Phase 1: Identify Committed Transactions

```typescript
function identifyCommitted(checkpointLSN: number): Set<number> {
  const committed = new Set<number>();

  for (const record of wal.readFrom(checkpointLSN)) {
    if (record.type === WALRecordType.COMMIT) {
      committed.add(record.txnId);
    }
  }

  return committed;
}
```

**Rationale:** Only transactions with a COMMIT record in the WAL are durable.

---

### Phase 2: Replay WAL

```typescript
function replayWAL(committed: Set<number>, checkpointLSN: number): void {
  for (const record of wal.readFrom(checkpointLSN)) {
    // Skip uncommitted transactions
    if (!committed.has(record.txnId)) continue;

    switch (record.type) {
      case INSERT:
        memTable.put(record.key, record.data, record.txnId);
        break;

      case DELETE:
        memTable.delete(record.key, record.txnId);
        break;

      case UPDATE:
        // UPDATE = DELETE + INSERT in MVCC
        const oldRow = memTable.get(record.key);
        memTable.delete(record.key, record.txnId);
        memTable.put(record.key, record.data, record.txnId);
        break;
    }
  }
}
```

**Key point:** We replay into MemTable, not SSTables. Checkpointed data is in SSTables.

---

### Phase 3: Rebuild Indexes

```typescript
function rebuildIndexes(): void {
  for (const table of schema.getTables()) {
    for (const index of table.getIndexes()) {
      const newIndex = new BTree(index.keyColumn);

      // Scan MemTable + SSTables
      for (const row of scanAllVersions(table)) {
        // Apply MVCC visibility (important!)
        if (mvcc.isVisible(row, currentSnapshot)) {
          newIndex.insert(
            row[index.keyColumn], // Index key
            row.primaryKey, // Pointer to heap
            row.xmin // MVCC metadata
          );
        }
      }

      // Atomic swap
      indexManager.replace(index.name, newIndex);
    }
  }
}

function* scanAllVersions(table: Table): Generator<VersionedRow> {
  // Scan MemTable (from WAL replay)
  for (const row of memTable.scan(table.name)) {
    yield row;
  }

  // Scan SSTables (checkpointed data)
  for (const sstable of sstables.getAll(table.name)) {
    for (const row of sstable.scan()) {
      yield row;
    }
  }
}
```

**Critical:** Index rebuild must scan **both** MemTable (newly replayed) and SSTables (old checkpointed data).

---

## Checkpoint Protocol

### Why Checkpoint?

Without checkpoints, recovery would replay the **entire WAL** from database creation. For a long-lived database, this could take hours.

**Solution:** Periodically flush MemTable to SSTables and record the checkpoint LSN.

### Checkpoint Procedure

```typescript
async function createCheckpoint(): Promise<void> {
  // 1. Flush current MemTable to SSTable
  const sstable = await memTable.flushToSSTable();

  // 2. Record LSN of last record in this flush
  const checkpointLSN = wal.getCurrentLSN();

  // 3. Update manifest (atomic via rename)
  const manifest = {
    checkpointLSN: checkpointLSN,
    sstables: [...existingSSTables, sstable.filename],
  };

  await writeFile("manifest.json.tmp", JSON.stringify(manifest));
  await rename("manifest.json.tmp", "manifest.json"); // Atomic

  // 4. Optional: Truncate old WAL segments
  await wal.archiveSegmentsBefore(checkpointLSN);
}
```

**Atomicity guarantee:** The `rename()` operation is atomic. Either we see the old manifest or the new manifest, never a partial state.

---

## Checkpoint Timing

**Trigger conditions:**

1. MemTable size >= 4MB
2. WAL size >= 64MB
3. Time since last checkpoint >= 60 seconds

**Trade-offs:**

| Frequency         | Recovery Time  | I/O Overhead | WAL Size |
| ----------------- | -------------- | ------------ | -------- |
| High (every 10s)  | Fast (seconds) | High         | Small    |
| Low (every 10min) | Slow (minutes) | Low          | Large    |

**Our choice:** Every 60 seconds or 4MB MemTable, whichever comes first.

---

## Index Durability Trade-Off

### Current Approach: Indexes Not Logged

**Advantages:**

- Simpler WAL logic (only data modifications)
- No index-specific redo operations
- Automatic corruption repair (rebuild from scratch)

**Disadvantages:**

- Slow recovery (O(data size × number of indexes))
- Cold start performance penalty

### Alternative: WAL-Logged Indexes (Postgres Approach)

**How it works:**

```
WAL: [INSERT user(id=1, age=25), INSERT_INDEX(idx_age, key=25, ptr=pk:1)]
```

**Advantages:**

- Fast recovery (just replay index operations)

**Disadvantages:**

- More complex WAL (index splits, page modifications)
- Harder to reason about correctness
- Index-specific crash recovery logic

**Our decision:** Prioritize simplicity for this prototype. Production systems would log indexes.

---

## Testing Strategy

### Unit Tests

```typescript
describe("WAL Durability", () => {
  test("Committed transaction survives crash", async () => {
    const db = new Database();
    const txn = db.begin();
    await db.execute('INSERT INTO users VALUES (1, "Alice")', txn);
    await db.commit(txn); // fsync here

    await db.simulateCrash();

    const db2 = new Database();
    await db2.recover();

    const result = await db2.execute("SELECT * FROM users");
    expect(result.rows).toEqual([{ id: 1, name: "Alice" }]);
  });

  test("Uncommitted transaction lost after crash", async () => {
    const db = new Database();
    const txn = db.begin();
    await db.execute('INSERT INTO users VALUES (1, "Alice")', txn);
    // No commit

    await db.simulateCrash();

    const db2 = new Database();
    await db2.recover();

    const result = await db2.execute("SELECT * FROM users");
    expect(result.rows).toEqual([]);
  });
});
```

### Chaos Tests

```typescript
describe("Recovery Under Faults", () => {
  test("Crash during checkpoint", async () => {
    const db = new Database();

    // Insert data
    for (let i = 0; i < 1000; i++) {
      await db.execute(`INSERT INTO users VALUES (${i}, "User${i}")`);
    }

    // Start checkpoint, crash mid-way
    const checkpointPromise = db.createCheckpoint();
    setTimeout(() => db.simulateCrash(), 50);

    await checkpointPromise.catch(() => {});

    // Recovery should work
    const db2 = new Database();
    await db2.recover();

    const result = await db2.execute("SELECT COUNT(*) FROM users");
    expect(result.rows[0].count).toBe(1000);
  });
});
```

---

## Correctness Argument

### Durability Proof

**Claim:** If a client receives a commit acknowledgment, the transaction survives any single crash.

**Proof sketch:**

1. Client receives ACK only after `fsync()` completes (by protocol)
2. `fsync()` ensures COMMIT record is on durable storage
3. Recovery scans WAL and identifies all COMMIT records
4. All operations from committed transactions are replayed
5. Therefore, transaction survives ∎

### Atomicity Proof

**Claim:** Transactions are all-or-nothing.

**Proof sketch:**

1. During recovery, we build a set of committed transaction IDs
2. We replay only operations from transactions in this set
3. Operations from uncommitted transactions are ignored
4. Therefore, either all operations from a transaction are applied or none are ∎

### Consistency Proof

**Claim:** The recovered database is in a consistent state.

**Proof sketch:**

1. Each committed transaction saw a consistent snapshot (MVCC guarantees)
2. Conflict detection prevented write-write conflicts
3. Recovery replays committed transactions in commit order
4. Therefore, recovered state is equivalent to some serial execution ∎

**Gap:** We don't verify checksums, so disk corruption can violate this. Production systems add CRC checks.

---

## Comparison to Other Systems

| System             | WAL Strategy     | Index Logging | Recovery Time     |
| ------------------ | ---------------- | ------------- | ----------------- |
| **This prototype** | Commit-on-fsync  | Not logged    | O(data × indexes) |
| **Postgres**       | WAL-based        | Logged        | O(WAL size)       |
| **MySQL InnoDB**   | Redo + undo logs | Logged        | O(WAL size)       |
| **SQLite**         | Rollback journal | Not logged    | O(database size)  |
| **MongoDB**        | Oplog            | Logged        | O(oplog size)     |

---

## Future Enhancements

### 1. Group Commit

**Current:** Each commit = individual fsync  
**Improvement:** Batch multiple commits into single fsync

```typescript
class GroupCommitManager {
  private pendingCommits: Transaction[] = [];

  async commitWithGrouping(txn: Transaction): Promise<void> {
    this.pendingCommits.push(txn);

    if (this.pendingCommits.length >= 10 || timeout) {
      await this.flushGroup();
    }
  }

  private async flushGroup(): Promise<void> {
    // Write all COMMIT records
    for (const txn of this.pendingCommits) {
      wal.append({ type: COMMIT, txnId: txn.id });
    }

    // Single fsync for all
    await wal.fsync();

    // Acknowledge all
    for (const txn of this.pendingCommits) {
      txn.resolve();
    }

    this.pendingCommits = [];
  }
}
```

**Benefit:** 10x throughput improvement under high concurrency

---

### 2. WAL Compression

**Current:** Uncompressed records  
**Improvement:** ZSTD compression for bulk inserts

**Benefit:** Reduce I/O bandwidth, faster recovery

---

### 3. Parallel Recovery

**Current:** Single-threaded replay  
**Improvement:** Partition WAL by table, replay in parallel

**Benefit:** 4-8x faster recovery on multi-core systems

---

## References

- [ARIES: A Transaction Recovery Method](https://cs.stanford.edu/people/chrismre/cs345/rl/aries.pdf) (Mohan et al., 1992)
- [Postgres WAL Internals](https://www.postgresql.org/docs/current/wal-internals.html)
- [SQLite Rollback Journal](https://www.sqlite.org/atomiccommit.html)
