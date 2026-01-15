# Known Limitations

This document explicitly lists correctness gaps, approximations, and deviations from production database systems.

---

## Critical Correctness Limitations

### 1. No Commit-Status Tracking (pg_xact equivalent)

**What's missing:**
We don't maintain a commit/abort status table for transactions.

**Impact:**

- MVCC visibility Rule 6 approximates deletion visibility using transaction ID ordering
- Aborted deletes can cause false invisibility
- Out-of-order commits can cause incorrect visibility decisions

**Scenario that breaks:**

```
1. T10 deletes row (sets xmax=10)
2. T10 aborts
3. Snapshot S with xmax=20 starts
4. Our logic: xmax(10) < snapshot.xmax(20) → row invisible
5. WRONG: Row should be visible (delete aborted)
```

**Production solution:**

```typescript
enum TxnStatus {
  COMMITTED,
  ABORTED,
  IN_PROGRESS,
}
const commitLog: Map<number, TxnStatus>;

// Enhanced visibility check:
if (commitLog.get(row.xmax) === TxnStatus.ABORTED) {
  return true; // Ignore aborted deletion
}
```

**When this matters:**

- High abort rates (e.g., aggressive optimistic locking)
- Long-running transactions with concurrent aborts
- Strict correctness requirements (financial systems)

---

### 2. Write Skew Allowed (Snapshot Isolation, Not Serializable)

**What's missing:**
We don't detect read-write conflicts, only write-write conflicts.

**Impact:**

- Concurrent transactions can violate application-level constraints
- Classic "bank account" anomaly is possible

**Example:**

```sql
-- Constraint: SUM(balance) >= 0

-- T1 reads both accounts, withdraws from A
-- T2 reads both accounts, withdraws from B
-- Both commit → total goes negative
```

**Production solution:**

- **Option A:** Serializable Snapshot Isolation (SSI) with predicate locks
- **Option B:** Application-level `SELECT FOR UPDATE`
- **Option C:** Materialized constraints (store sum in single row)

**When this matters:**

- Multi-row constraints (accounting systems)
- Inventory management (reserve two items from different tables)
- Any workload requiring serializable semantics

---

### 3. Indexes Not WAL-Logged

**What's missing:**
Index modifications are not written to the WAL.

**Impact:**

- All indexes rebuilt from scratch during recovery
- Recovery time = O(data size × number of indexes)
- 10GB table with 3 indexes → minutes of recovery time

**Current behavior:**

1. Replay WAL into MemTable
2. Scan MemTable + SSTables
3. Rebuild every index entry-by-entry

**Production solution:**

```
WAL: [INSERT user(id=1, age=25), UPDATE_INDEX(idx_age, 25 → {pk:1})]
```

**When this matters:**

- Large datasets (> 10GB)
- Many indexes (> 5 per table)
- Strict recovery time objectives (RTO < 1 minute)

---

### 4. Single-Threaded Execution

**What's missing:**
No parallel query execution, scan operators, or background workers.

**Impact:**

- Cannot utilize multiple CPU cores
- Throughput limited to single-core performance
- Large scans are sequential

**Production solution:**

- Worker pool for scan partitioning
- Parallel hash join
- Background compaction threads

**When this matters:**

- Analytics workloads (OLAP queries)
- High-concurrency OLTP (> 100 QPS)
- Large table scans (> 1M rows)

---

### 5. No Statistics or Histograms

**What's missing:**
Query optimizer only knows row counts, not data distribution.

**Impact:**

- Join order decisions are heuristic
- Selectivity estimates are guesses (assumed 10%)
- Incorrect plans for skewed data

**Example:**

```sql
-- If 99% of users have age < 30, index scan is wrong
SELECT * FROM users WHERE age > 25;
```

**Production solution:**

```typescript
class Statistics {
  histogram: Bucket[]; // Value distribution
  distinctCount: number; // Cardinality
  nullFraction: number; // % of nulls
  mostCommonValues: any[]; // Frequent items
}
```

**When this matters:**

- Complex queries (3+ joins)
- Skewed data distributions
- Performance-sensitive applications

---

## Operational Limitations

### 6. No Connection Pooling

**Impact:**

- Each client connection = new transaction
- No connection reuse
- REST API creates transaction per request

**Production solution:** pgBouncer, connection pooling middleware

---

### 7. No Query Cancellation

**Impact:**

- Long-running queries block indefinitely
- No Ctrl+C support in REPL
- No `pg_cancel_backend()` equivalent

**Production solution:** Timeout mechanisms, signal handling

---

### 8. Fixed Memory Limits

**Impact:**

- MemTable hardcoded to 4MB
- No adaptive memory management
- OOM under high write load

**Production solution:** Dynamic work_mem, shared_buffers

---

### 9. No Replication or Durability Guarantees Beyond Single Node

**Impact:**

- Disk failure = data loss
- No high availability
- No disaster recovery

**Production solution:** Streaming replication (Postgres), Raft consensus

---

### 10. No Online Schema Migration

**Impact:**

- `ALTER TABLE` blocks all writes
- No zero-downtime column additions
- No backward-compatible schema evolution

**Production solution:** Dual-write migrations, ghost tables (pt-online-schema-change)

---

## Approximations & Simplifications

### 11. globalOldestXmin Calculation

**Current approach:**

```typescript
globalOldestXmin = Math.min(
  ...activeSnapshots.map((s) => s.xmin),
  ...activeTxns
);
```

**Missing:**

- Idle transactions (no snapshot yet)
- Prepared transactions (2PC)
- Replication lag considerations

**Impact:** May retain versions longer than necessary (disk bloat)

---

### 12. Compaction Strategy

**Current approach:**

- Size-tiered compaction
- Fixed level ratios (4, 8, 16 SSTables)
- No leveled compaction

**Missing:**

- Adaptive compaction scheduling
- Write amplification minimization
- Space amplification vs read amplification trade-offs

**Impact:** Suboptimal for mixed workloads

---

### 13. Lock-Free Data Structures

**Current approach:**

- Single-threaded, no locks needed
- Skip list (MemTable) is single-writer

**Missing:**

- Concurrent skip list for multi-writer
- Lock-free hash tables
- Atomic reference counting

**Impact:** Cannot scale to multiple cores

---

### 14. Error Handling

**Current approach:**

- Basic try/catch
- Simple error messages
- No error codes or categorization

**Missing:**

- Postgres-style SQLSTATE codes
- Detailed error context
- Retry semantics

**Impact:** Debugging is harder

---

## Security Limitations

### 15. No Authentication or Authorization

**Missing:**

- User management
- Role-based access control (RBAC)
- Row-level security (RLS)

**Impact:** Anyone can read/write any data

---

### 16. No SQL Injection Prevention

**Current approach:**

- Simple string-based SQL parsing
- No parameterized queries

**Missing:**

- Prepared statements with parameter binding
- Input sanitization

**Impact:** Vulnerable to injection attacks

---

## Testing Gaps

### 17. No Formal Verification

**Missing:**

- TLA+ model of MVCC
- Jepsen-style fault injection
- Linearizability checking

**Impact:** Concurrency bugs may exist

---

### 18. No Performance Benchmarks

**Missing:**

- TPC-C / TPC-H results
- Latency percentiles (P99, P999)
- Throughput under load

**Impact:** Cannot compare to production systems

---

## When This Prototype Is Sufficient

Despite these limitations, this prototype is suitable for:

✅ **Educational purposes** - Demonstrates core MVCC mechanics  
✅ **Interview demonstrations** - Shows systems understanding  
✅ **Prototyping** - Validates application logic before production  
✅ **Low-concurrency workloads** - < 10 concurrent transactions  
✅ **Append-mostly data** - Where write skew is unlikely

---

## When You Need More

This prototype is **not suitable** for:

❌ **Production OLTP** - Need SSI, replication, connection pooling  
❌ **Mission-critical systems** - Need formal verification, HA  
❌ **Large datasets** - Need parallel execution, statistics  
❌ **Multi-tenant SaaS** - Need RBAC, RLS, audit logs  
❌ **High-throughput** - Need lock-free data structures, parallelism

---

## Mitigation Strategies

For each limitation, here's how to address it if needed:

| Limitation      | Quick Fix                      | Production Fix                     |
| --------------- | ------------------------------ | ---------------------------------- |
| No pg_xact      | Assume monotonic commits       | Implement commit-status table      |
| Write skew      | Use SELECT FOR UPDATE          | Add SSI or serialize on constraint |
| Index rebuild   | Accept slow recovery           | WAL-log index operations           |
| Single-threaded | Accept low throughput          | Worker pool + partitioning         |
| No statistics   | Manual ANALYZE runs            | Auto-vacuum + histogram collection |
| No replication  | Accept single-point-of-failure | Streaming replication              |

---

## References

- **Postgres Limitations:** https://www.postgresql.org/docs/current/limits.html
- **MySQL Known Issues:** https://dev.mysql.com/doc/refman/8.0/en/known-issues.html
- **Jepsen Analysis:** https://jepsen.io/analyses (for understanding real-world failures)
