# Enterprise RDBMS Prototype

A single-node relational database prototype demonstrating transaction processing, MVCC visibility rules, and WAL-based crash recovery.

## Purpose

This project exists to demonstrate **database internals** and **systems engineering judgment**. It prioritizes correctness, failure semantics, and explicit trade-offs over performance or feature completeness.

**This is not production software.**  
It is a learning artifact and an interview demonstration tool.

## What This Demonstrates

- Snapshot isolation via Postgres-style MVCC (xmin / xmax versioning)
- First-committer-wins conflict detection for concurrent writers
- Write-ahead logging (WAL) with crash recovery and replay
- LSM-Tree storage with compaction and MVCC-aware garbage collection
- Volcano-style query execution with operator pipelining
- B-Tree secondary indexes with MVCC semantics

## Explicit Non-Goals

- Serializable isolation (write skew is allowed by design)
- Distributed replication or consensus
- Production performance guarantees
- Online schema migration
- Adaptive or cost-based query optimization

## Architecture Overview

The diagram below shows the **end-to-end execution path of a SQL statement**, from client request through parsing, transaction management, execution, storage, and durability.

```mermaid
flowchart TB
    subgraph Clients["Client Layer"]
        WEB[Web Browser]
        CLI[Terminal REPL]
        API[HTTP Client]
    end

    subgraph Interface["Interface Layer"]
        EXPRESS["Express Server
        :3000
        (Stateless - Single Statement)"]
        REPL["Interactive REPL
        (Stateful - Multi Statement)"]
    end

    subgraph Application["Application Layer"]
        DBSVC[DatabaseService]
        QSVC[QueryService]
        SCHEMA[SchemaService]
        METRICS[MetricsService]
    end

    subgraph SQL["SQL Processing Pipeline"]
        direction LR
        LEXER[Lexer] --> PARSER[Parser]
        PARSER --> VALIDATOR[Validator]
        VALIDATOR --> OPTIMIZER[Optimizer]
        OPTIMIZER --> EXECUTOR[Executor]
    end

    subgraph Transaction["Transaction Management"]
        TXNMGR["TransactionManager
        (Allocate xmin / xmax)
        Track globalOldestXmin"]
        MVCC["MVCC Engine
        (Visibility Rules)"]
        CONFLICT["Conflict Detector
        (First-Committer-Wins)"]
    end

    subgraph Execution["Query Execution (Volcano Model)"]
        TABLESCAN[TableScan]
        INDEXSCAN[IndexScan]
        HASHJOIN[HashJoin]
        FILTER[Filter]
    end

    subgraph Index["Index Layer"]
        IDXMGR[IndexManager]
        BTREE[B-Tree Indexes]
    end

    subgraph Storage["Storage Engine (LSM-Tree)"]
        direction TB
        MEMTABLE["MemTable
        (Skip List, 4MB)
        Write Backpressure"]
        WAL["Write-Ahead Log
        (Commit + fsync)"]
        SSTABLE["SSTables
        Immutable, Sorted"]
        COMPACT["Compactor
        Background Merge
        Uses globalOldestXmin"]
        CKPT["Checkpointer
        Flush + Manifest Update"]
    end

    subgraph FileSystem["File System"]
        WALFILES[data/wal/*.log]
        SSTFILES[data/sstables/*.sst]
        IDXFILES[data/indexes/*.btree]
        MANIFEST["manifest.json
        + checkpointLSN"]
    end

    Clients --> Interface
    Interface --> Application
    Application --> SQL
    SQL --> Transaction
    Transaction --> Execution
    Execution --> Index
    Execution --> Storage
    Index --> Storage
    Storage --> FileSystem

    QSVC -.->|"Record metrics"| METRICS
    EXECUTOR -.->|"Slow query logs"| METRICS
    MEMTABLE -.->|"Throttle writes"| TXNMGR
    CKPT -.->|"Flush trigger"| MEMTABLE
    CKPT -.->|"Persist LSN"| MANIFEST
    COMPACT -.->|"Query xmin"| TXNMGR
Key Design Decisions
Decision	Rationale	Trade-off
Snapshot isolation over serializable	Simpler MVCC, highlights core mechanics	Allows write skew
Indexes not WAL-logged	Simplifies recovery logic	Slower index rebuild on crash
LSM-Tree over heap B-Tree	Write-optimized, modern storage model	Read amplification
Single-threaded execution	Correctness-first implementation	No parallelism
No commit-status table	Prototype simplification	Visibility edge approximations

Documentation
📄 Design Documentation — docs/

Subsystem-level designs (MVCC, WAL, LSM, indexing, execution)

⚠️ Known Limitations — docs/LIMITATIONS.md

⚖️ Trade-offs — docs/TRADEOFFS.md

Quick Start
bash
Copy code
# Install dependencies
npm install

# Run all tests
npm test

# Start interactive REPL
npm start

# Start REST API
npm run server
Example Session
sql
Copy code
db> BEGIN;
Transaction started (xmin=100)

db> CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR, age INT);
Table created

db> INSERT INTO users VALUES (1, 'Alice', 30);
1 row inserted

db> CREATE INDEX idx_age ON users(age);
Index created

db> SELECT * FROM users WHERE age > 25;
+----+-------+-----+
| id | name  | age |
+----+-------+-----+
| 1  | Alice | 30  |
+----+-------+-----+

db> COMMIT;
Transaction committed
Testing
bash
Copy code
npm test                    # All tests
npm run test:unit           # MVCC, WAL, storage
npm run test:integration    # Recovery and concurrency
npm run test:coverage       # Coverage report
Project Status
Current: Phase 2 complete (WAL + Crash Recovery)
Next: Phase 3 (LSM-Tree compaction)

Author Notes
This project demonstrates senior-level understanding of:

Transaction isolation and MVCC visibility rules

Write-ahead logging and crash recovery protocols

Storage engine internals and compaction strategies

Query execution models and operator pipelines

Features that would obscure core algorithms (e.g. distributed consensus, adaptive optimization, connection pooling) are intentionally omitted.

License
MIT — Educational purposes
```
