# Design Trade-offs

This document explains the rationale behind key design decisions and alternative approaches that were considered.

---

## Core Design Decisions

### 1. Snapshot Isolation vs Serializable Isolation

**Decision:** Implement snapshot isolation (SI), not serializable isolation.

**Rationale:**

- **Simplicity:** SI requires only write-write conflict detection
- **Performance:** No need to track read-write dependencies
- **Coverage:** SI handles 95% of real-world workloads
- **Educational value:** Demonstrates core MVCC mechanics clearly

**Trade-offs:**

| Aspect      | Snapshot Isolation    | Serializable (SSI)           |
| ----------- | --------------------- | ---------------------------- |
| Correctness | Allows write skew     | Prevents all anomalies       |
| Complexity  | Low (check xmin/xmax) | High (track read/write deps) |
| Performance | High (optimistic)     | Lower (more aborts)          |
| Use cases   | Most OLTP             | Financial, inventory         |

**What we gave up:**

- Cannot prevent write skew (requires read-write conflict detection)
- Some applications need application-level locking (`SELECT FOR UPDATE`)

**How production systems handle this:**

- **Postgres:** Offers both SI and SSI (user chooses)
- **MySQL:** Repeatable Read with next-key locks (prevents some anomalies)
- **Oracle:** Read Committed by default (weaker than SI)

**When this matters:**

- Multi-row constraints (accounting: SUM(balance) >= 0)
- Inventory management (reserve two items atomically)
- Any workload requiring strict serializability

---

### 2. Indexes Not WAL-Logged

**Decision:** Indexes are not logged in the WAL; they are rebuilt during recovery.

**Rationale:**

- **Simplicity:** WAL only contains data modifications, not derived structures
- **Correctness:** Indexes can always be reconstructed from base tables
- **Automatic repair:** Corrupted indexes fixed by rebuild

**Trade-offs:**

| Aspect         | Not Logged (ours) | WAL-Logged (Postgres) |
| -------------- | ----------------- | --------------------- |
| WAL complexity | Low (data only)   | High (B-Tree splits)  |
| Recovery time  | O(data × indexes) | O(WAL size)           |
| Corruption     | Auto-repaired     | Manual REINDEX        |
| Implementation | Simple            | Complex               |

**What we gave up:**

- **Slow recovery:** 10GB table + 3 indexes = minutes of rebuild time
- **Longer RTO:** Recovery time objective is higher

**How production systems handle this:**

- **Postgres:** Logs index operations (fast recovery, complex WAL)
- **SQLite:** Does not log indexes (simple, slow recovery)
- **MySQL InnoDB:** Logs index changes (redo log)

**When this matters:**

- Large datasets (> 10GB)
- Many indexes (> 5 per table)
- Strict RTO requirements (< 1 minute)

**Mitigation strategies:**

- Reduce number of indexes (only essential ones)
- Use covering indexes to reduce heap lookups
- Accept slower recovery for this prototype

---

### 3. LSM-Tree vs B-Tree Heap Storage

**Decision:** Use LSM-Tree (MemTable + SSTables) instead of B-Tree heap files.

**Rationale:**

- **Write performance:** LSM converts random writes to sequential I/O
- **Modern default:** Most new systems use LSM (RocksDB, Cassandra, LevelDB)
- **Compaction control:** Can tune read vs write amplification

**Trade-offs:**

| Aspect              | LSM-Tree (ours)                | B-Tree Heap (Postgres) |
| ------------------- | ------------------------------ | ---------------------- |
| Write throughput    | High (sequential)              | Lower (random I/O)     |
| Read latency        | Higher (check multiple levels) | Lower (single lookup)  |
| Write amplification | High (compaction)              | Low                    |
| Space amplification | Higher (multiple versions)     | Lower                  |
| Compaction overhead | Background CPU                 | VACUUM overhead        |

**What we gave up:**

- **Read amplification:** Must check MemTable + L0 + L1 + L2...
- **Compaction cost:** Background CPU for merging SSTables
- **Complexity:** Bloom filters, level management

**How production systems handle this:**

- **RocksDB:** LSM with leveled compaction (tunable)
- **Postgres:** B-Tree heap (VACUUM for space reclaim)
- **MySQL InnoDB:** B-Tree clustered index

**When this matters:**

- **Write-heavy OLTP:** LSM wins (insert-heavy applications)
- **Read-heavy OLAP:** B-Tree wins (analytical queries)
- **Mixed workloads:** Depends on ratio

**Performance comparison (rough estimates):**

- LSM writes: 100k ops/sec
- B-Tree writes: 10k ops/sec (random I/O)
- LSM reads: 10k ops/sec (must check levels)
- B-Tree reads: 50k ops/sec (direct lookup)

---

### 4. Single-Threaded Execution

**Decision:** No parallel query execution or background workers.

**Rationale:**

- **Simplicity:** Avoids locking, race conditions, thread pools
- **Correctness:** Easier to reason about transaction semantics
- **Educational focus:** Demonstrates algorithms, not parallelism

**Trade-offs:**

| Aspect     | Single-Threaded (ours) | Multi-Threaded (Postgres)        |
| ---------- | ---------------------- | -------------------------------- |
| Throughput | Low (1 core)           | High (N cores)                   |
| Latency    | Moderate               | Lower (parallel scans)           |
| Complexity | Low                    | High (lock-free data structures) |
| Debugging  | Easy                   | Hard (race conditions)           |

**What we gave up:**

- **CPU utilization:** Cannot use multiple cores
- **Throughput:** Limited to single-core performance
- **Latency:** Large scans cannot be parallelized

**How production systems handle this:**

- **Postgres:** Worker pool for parallel scans (v9.6+)
- **MySQL:** Limited parallelism (thread pool for connections)
- **DuckDB:** Vectorized parallel execution

**When this matters:**

- High-concurrency workloads (> 100 QPS)
- Large table scans (> 1M rows)
- Analytics queries (aggregations, joins)

**Mitigation strategies:**

- Shard data across multiple instances
- Use read replicas for read-heavy workloads
- Accept lower throughput for this prototype

---

### 5. No Commit-Status Table (pg_xact)

**Decision:** Approximate MVCC visibility using transaction ID ordering.

**Rationale:**

- **Simplicity:** No external data structure to maintain
- **Prototype scope:** Demonstrates core MVCC without production complexity
- **Explicit limitation:** Documented in LIMITATIONS.md

**Trade-offs:**

| Aspect               | No pg_xact (ours)       | With pg_xact (Postgres) |
| -------------------- | ----------------------- | ----------------------- |
| Correctness          | Approximation           | Exact                   |
| Complexity           | Low                     | Moderate                |
| Abort handling       | Incorrect post-recovery | Correct                 |
| Out-of-order commits | Incorrect               | Correct                 |

**What we gave up:**

- **Correctness:** Aborted deletes can cause false invisibility
- **Flexibility:** Cannot handle out-of-order transaction commits

**Scenario that breaks:**

```
1. T10 deletes row (xmax=10)
2. T10 aborts
3. Snapshot with xmax=20 starts
4. Our logic: xmax(10) < snapshot.xmax(20) → invisible
5. WRONG: Row should be visible (delete was aborted)
```

**How production systems handle this:**

- **Postgres:** pg_xact (commit-status array)
- **MySQL:** Undo logs track rollback information
- **Oracle:** Rollback segments

**When this matters:**

- High abort rate workloads
- Long-running transactions with concurrent aborts
- Strict correctness requirements (financial systems)

**Mitigation strategies:**

- Assume monotonic commits (transactions commit in ID order)
- Avoid aborts in prototype testing
- Document limitation explicitly

---

### 6. Fixed Selectivity Estimates (No Statistics)

**Decision:** Query optimizer assumes 10% selectivity for all predicates.

**Rationale:**

- **Simplicity:** No need to collect/maintain histograms
- **Prototype scope:** Focus on execution, not optimization
- **Predictable behavior:** Easier to debug query plans

**Trade-offs:**

| Aspect       | No Statistics (ours) | With Statistics (Postgres)   |
| ------------ | -------------------- | ---------------------------- |
| Plan quality | Poor (heuristics)    | Good (cardinality-based)     |
| Overhead     | None                 | ANALYZE runs, disk space     |
| Complexity   | Low                  | Moderate (histogram storage) |
| Skewed data  | Wrong plans          | Correct plans                |

**What we gave up:**

- **Optimal plans:** Cannot choose correct join order for skewed data
- **Index usage:** May use index when seq scan is faster
- **Join algorithms:** Cannot estimate hash table size

**Example of bad plan:**

```sql
-- If 99% of users have age < 30, index scan is wrong
SELECT * FROM users WHERE age > 25;

-- Optimizer assumes 10% selectivity → uses index
-- Should use seq scan (touches 99% of rows)
```

**How production systems handle this:**

- **Postgres:** ANALYZE collects histograms, MCV (most common values)
- **MySQL:** Stats updated during INSERT/UPDATE
- **SQL Server:** Auto-update statistics

**When this matters:**

- Complex queries (3+ joins)
- Skewed data distributions
- Performance-sensitive applications

**Mitigation strategies:**

- Manual hint system (e.g., `USE INDEX (idx_name)`)
- Fixed query plans for known workloads
- Accept suboptimal plans for this prototype

---

### 7. No Compression

**Decision:** Data blocks are stored uncompressed.

**Rationale:**

- **Simplicity:** No codec integration, no compression heuristics
- **Prototype scope:** Focus on core algorithms
- **Debugging:** Easier to inspect raw data

**Trade-offs:**

| Aspect         | No Compression (ours) | With Compression (RocksDB)     |
| -------------- | --------------------- | ------------------------------ |
| Disk usage     | High (2-5x)           | Low                            |
| CPU usage      | Low                   | Moderate (compress/decompress) |
| I/O bandwidth  | High                  | Low                            |
| Implementation | Simple                | Moderate (ZSTD/Snappy)         |

**What we gave up:**

- **Disk cost:** 2-5x more storage required
- **I/O efficiency:** More data transferred from disk

**How production systems handle this:**

- **RocksDB:** ZSTD compression (default)
- **Postgres:** TOAST (large values only)
- **Cassandra:** LZ4 compression

**When this matters:**

- Large datasets (> 100GB)
- Disk space constrained environments
- High I/O workloads

---

## Alternative Approaches Considered

### 1. Read Committed Instead of Snapshot Isolation

**Why not chosen:**

- **Weaker guarantees:** Non-repeatable reads, phantom reads
- **Less interesting:** SI demonstrates MVCC better
- **Less common:** Most modern systems offer at least SI

**When it makes sense:**

- Simple applications (single-statement queries)
- Oracle-style applications (built for Read Committed)

---

### 2. Pessimistic Locking (2PL) Instead of MVCC

**Why not chosen:**

- **Lower concurrency:** Reads block writes
- **Simpler but limiting:** No multi-versioning
- **Less modern:** MVCC is industry standard

**When it makes sense:**

- Low-contention workloads
- Simpler implementation (no snapshot management)

---

### 3. Append-Only Storage (No In-Place Updates)

**Why not chosen:**

- **Space amplification:** Even worse than LSM
- **No compaction:** Disk usage grows unbounded

**When it makes sense:**

- Audit requirements (keep all versions forever)
- Time-travel queries (query as-of timestamp)

---

### 4. Distributed Replication (Raft/Paxos)

**Why not chosen:**

- **Massive complexity:** Consensus protocols, network partitions
- **Out of scope:** This is a single-node prototype

**When it makes sense:**

- High availability requirements
- Multi-datacenter deployments
- Production systems

---

## Design Philosophy Summary

### Prioritized Values

1. **Correctness** over performance
2. **Simplicity** over features
3. **Educational clarity** over production readiness
4. **Explicit limitations** over silent approximations
5. **Modern defaults** (LSM, MVCC) over legacy approaches

### Acceptable Trade-offs

✅ **Willing to sacrifice:**

- High throughput (single-threaded is fine)
- Fast recovery (rebuild indexes is fine)
- Optimal plans (fixed selectivity is fine)
- Serializability (snapshot isolation is fine)

❌ **Not willing to sacrifice:**

- Durability (COMMIT + fsync is required)
- Atomicity (all-or-nothing transactions)
- Snapshot consistency (repeatable reads)
- Write-write conflict detection (prevent lost updates)

---

## When to Reconsider These Decisions

| Decision           | Reconsider If...                            |
| ------------------ | ------------------------------------------- |
| Snapshot isolation | Application requires strict serializability |
| Indexes not logged | Recovery time > 5 minutes is unacceptable   |
| LSM-Tree storage   | Workload is 95%+ reads                      |
| Single-threaded    | Throughput < 10 QPS on modern hardware      |
| No pg_xact         | High abort rate (> 10% of transactions)     |
| No statistics      | Query performance is critical               |
| No compression     | Disk cost > compute cost                    |

---

## References

- [Architecture of a Database System](https://dsf.berkeley.edu/papers/fntdb07-architecture.pdf) (Hellerstein et al., 2007)
- [What Goes Around Comes Around](https://db.cs.cmu.edu/papers/2024/whatgoesaround-sigmodrec2024.pdf) (Stonebraker & Hellerstein, 2024)
- [The Log-Structured Merge-Tree](https://www.cs.umb.edu/~poneil/lsmtree.pdf) (O'Neil et al., 1996)
