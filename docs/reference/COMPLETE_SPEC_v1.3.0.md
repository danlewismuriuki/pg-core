# Enterprise RDBMS Prototype - Complete Reference v1.3.0

This document is the **comprehensive internal source of truth** for the Enterprise RDBMS prototype.
It includes full design, algorithms, examples, limitations, and trade-offs.  
**Not intended for interview consumption** — use `docs/design/*.md` for focused, interview-friendly reads.

---

## Table of Contents

1. [Full System Overview](#full-system-overview)
2. [Detailed Subsystem Documentation](#detailed-subsystem-documentation)
   - [MVCC & Snapshot Isolation](#mvcc--snapshot-isolation)
   - [Write-Ahead Logging & Crash Recovery](#write-ahead-logging--crash-recovery)
   - [LSM-Tree Storage](#lsm-tree-storage)
   - [Indexing](#indexing)
   - [Query Execution](#query-execution)
   - [Transactions](#transactions)
3. [Examples](#examples)
4. [Testing](#testing)
5. [Limitations & Trade-Offs](#limitations--trade-offs)
6. [References](#references)

---

## Full System Overview

### Purpose

A single-node relational database prototype demonstrating **transaction processing**, **MVCC visibility rules**, and **WAL-based crash recovery**.

- Demonstrates database internals and **systems engineering judgment**.
- Prioritizes **correctness**, **failure semantics**, and **trade-off clarity** over performance or completeness.
- **Non-goals:** production readiness, distributed replication, serializable isolation, adaptive query optimization.

### High-Level Architecture

┌───────────────────────────────┐
│ Client Layer (REPL / REST API)│
└───────────────────────────────┘
│
┌────────────────────────────────────────────┐
│ SQL Processing (Lexer → Parser → Optimizer)│
└────────────────────────────────────────────┘
│
┌───────────────────────────────────────────┐
│ Transaction Manager (MVCC + Conflict Detect)│
└───────────────────────────────────────────┘
│
┌─────────────┬──────────────┬─────────────┐
│ LSM-Tree │ B-Tree Index │ WAL │
│ Storage │ (MVCC) │ (Durability)│
└─────────────┴──────────────┴─────────────┘

pgsql
Copy code

### Key Design Decisions

| Decision                             | Rationale                        | Trade-off                 |
| ------------------------------------ | -------------------------------- | ------------------------- |
| Snapshot isolation over serializable | Demonstrates core MVCC mechanics | Allows write skew         |
| Indexes not WAL-logged               | Simpler recovery logic           | Slower recovery           |
| LSM-Tree over B-Tree heap            | Write-optimized, modern storage  | Read amplification        |
| Single-threaded execution            | Correctness over performance     | No parallelism            |
| No commit-status table               | Prototype simplification         | Visibility approximations |

---

## Detailed Subsystem Documentation

### MVCC & Snapshot Isolation

#### Overview

- **Postgres-style MVCC** with `xmin`/`xmax` per row.
- Snapshot: `[xmin, xmax)` plus set of active transactions.
- Ensures **statement-level snapshot isolation**.
- **Conflict detection:** first-committer-wins.

#### Data Structures

```typescript
interface Row {
  id: number;
  xmin: number;
  xmax: number | null;
  data: Record<string, any>;
}

interface Snapshot {
  xmin: number;
  xmax: number;
  activeTxns: Set<number>;
}
Visibility Rules
Active transaction check first.

Compare xmin and xmax against snapshot.

Apply conflict detection rules for concurrent updates.

Example
typescript
Copy code
function isVisible(row: Row, snapshot: Snapshot): boolean {
  if (snapshot.activeTxns.has(row.xmin)) return false;
  return row.xmin < snapshot.xmax && (row.xmax === null || row.xmax > snapshot.xmin);
}
Write-Ahead Logging & Crash Recovery
Overview
WAL is single source of truth for committed data.

Logs all modifications before applying to storage.

Recovery scans WAL + MemTable + SSTables to restore consistent state.

WAL Operations
Append new transaction record.

fsync() to durable storage.

Apply to MemTable/LSM.

Recovery Flow
scss
Copy code
[WAL] → scanAllVersions() → MemTable → SSTables → rebuild indexes
Indexes are ephemeral; rebuilt from base tables after crash.

LSM-Tree Storage
MemTable: in-memory skip list.

SSTable: immutable sorted files.

Compaction: size-tiered, MVCC-aware.

Bloom filter: probabilistic key membership check.

Example
typescript
Copy code
class MemTable {
  insert(row: Row) { ... }
  flush(): SSTable { ... }
}
Indexing
B-Tree implementation with MVCC-aware scanning.

Indexes not WAL-logged (rebuild on recovery).

Operations: CREATE INDEX, DROP INDEX, rebuild.

Query Execution
Volcano-style execution model.

Operators: SeqScan, IndexScan, Filter, Projection, HashJoin, Sort, Aggregate.

Optimizer applies simple heuristics (filter pushdown, scan selection).

Transactions
Lifecycle: BEGIN → COMMIT → ABORT.

Global oldestXmin tracking for snapshots.

Conflict detection enforces first-committer-wins.

Examples
SQL Transactions
sql
Copy code
BEGIN;
INSERT INTO users VALUES (1, 'Alice', 30);
CREATE INDEX idx_age ON users(age);
SELECT * FROM users WHERE age > 25;
COMMIT;
MVCC Behavior
Row inserted by Tx1 is invisible to Tx2 until commit.

Tx2 sees snapshot at xmin when it began.

Testing
Unit tests: MVCC rules, WAL durability, LSM flush/compaction, B-Tree operations, operators.

Integration tests: concurrent transactions, crash recovery, end-to-end queries.

Test data stored in tests/fixtures.

Limitations & Trade-Offs
No commit-status table → approximated visibility.

Allows write skew (SI, not serializable).

Indexes rebuilt after recovery.

Single-threaded execution.

No distributed replication.

Not optimized for performance.

References
Postgres MVCC papers

WAL design documents

LSM-Tree research

Industry database comparisons (Postgres, RocksDB, etc.)
---
```
