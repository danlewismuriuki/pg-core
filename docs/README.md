# Design Documentation

This directory contains focused design documents for each major subsystem of the Enterprise RDBMS prototype.

---

## Core Systems

### [MVCC & Snapshot Isolation](design/MVCC.md)

**Read this for:** Transaction isolation, visibility rules, conflict detection

**Key topics:**

- Snapshot structure (xmin, xmax, active set)
- Visibility rule ordering (critical for correctness)
- First-committer-wins conflict detection
- Write skew examples and limitations

**Interview weight:** ⭐⭐⭐⭐⭐ (Most common interview topic)

---

### [WAL & Crash Recovery](design/WAL-Recovery.md)

**Read this for:** Durability guarantees, recovery protocol, checkpoint semantics

**Key topics:**

- Write-ahead logging protocol
- Durability point (COMMIT + fsync)
- Three-phase recovery (identify, replay, rebuild)
- Index rebuild rationale

**Interview weight:** ⭐⭐⭐⭐⭐ (Second most common)

---

### [LSM-Tree Storage Engine](design/LSM-Tree.md)

**Read this for:** Storage architecture, compaction, garbage collection

**Key topics:**

- MemTable (skip list) + SSTables structure
- Flush and checkpoint timing
- Compaction with MVCC garbage collection
- globalOldestXmin usage

**Interview weight:** ⭐⭐⭐⭐ (Common for systems roles)

---

### [Indexing & MVCC Semantics](design/Indexing.md)

**Read this for:** B-Tree implementation, index-heap interaction

**Key topics:**

- Index entry structure (carries xmin/xmax)
- Index scan with MVCC validation
- Online index rebuild protocol
- Why indexes aren't WAL-logged

**Interview weight:** ⭐⭐⭐ (Intermediate depth)

---

### [Query Execution Engine](design/QueryExecution.md)

**Read this for:** Volcano model, operator pipelining, optimization

**Key topics:**

- Iterator-based execution (open/next/close)
- Hash join implementation (no recursion)
- Heuristic cost-based optimizer
- SeqScan vs IndexScan selection

**Interview weight:** ⭐⭐⭐ (Less critical than MVCC/WAL)

---

### [Transaction Management](design/Transactions.md)

**Read this for:** Transaction lifecycle, snapshot creation, commit protocol

**Key topics:**

- Transaction state machine
- Snapshot creation timing
- Abort handling
- Multi-statement vs single-statement isolation

**Interview weight:** ⭐⭐⭐⭐ (Core concept)

---

## Engineering Context

### [Known Limitations](LIMITATIONS.md)

**Purpose:** Explicit gaps, approximations, and production deviations

**Categories:**

- Critical correctness limitations (pg_xact, write skew)
- Operational limitations (no replication, pooling)
- Testing gaps (no formal verification)
- Security limitations (no auth)

**Why this matters:** Demonstrates senior-level judgment and honesty

---

### [Trade-offs](TRADEOFFS.md)

**Purpose:** Design decision rationale and alternative approaches

**Key decisions:**

- Snapshot isolation vs serializable
- Indexes not WAL-logged
- LSM-Tree vs B-Tree heap
- Single-threaded execution

**Why this matters:** Shows ability to defend technical choices

---

### [Interview Defense Guide](INTERVIEW_GUIDE.md)

**Purpose:** 30-second explanations and common Q&A

**Sections:**

- Quick explanations of each subsystem
- Common follow-up questions with answers
- Difficult questions (pg_xact, write skew, recovery correctness)
- Red flags to avoid

**Why this matters:** Practical interview preparation

---

## Reading Recommendations

### For Interviews (3 hours)

**Priority 1 (must read):**

1. [INTERVIEW_GUIDE.md](INTERVIEW_GUIDE.md) - Start here
2. [MVCC.md](design/MVCC.md) - Core concepts
3. [WAL-Recovery.md](design/WAL-Recovery.md) - Durability guarantees

**Priority 2 (if time permits):** 4. [LIMITATIONS.md](LIMITATIONS.md) - Know the gaps 5. [LSM-Tree.md](design/LSM-Tree.md) - Storage internals

---

### For Deep Understanding (8+ hours)

Read in order:

1. MVCC & Transactions (understand isolation)
2. WAL & Recovery (understand durability)
3. LSM-Tree (understand storage)
4. Indexing (understand derived state)
5. Query Execution (understand operators)
6. Limitations (understand gaps)
7. Trade-offs (understand decisions)

---

### For Code Implementation

**Phase 1: Start here**

- MVCC.md → visibility rules
- Transactions.md → snapshot creation

**Phase 2: Durability**

- WAL-Recovery.md → logging protocol

**Phase 3: Storage**

- LSM-Tree.md → memtable + sstables

**Phase 4: Execution**

- QueryExecution.md → volcano model

**Phase 5: Interfaces**

- (No doc needed, just REST/REPL wrappers)

---

## Document Conventions

Each design doc follows this structure:

1. **Overview** - What this subsystem does
2. **Data structures** - Core types and interfaces
3. **Algorithms** - Key procedures with code
4. **Testing** - Unit and integration tests
5. **Known limitations** - What's missing
6. **References** - Academic papers and production systems

**Target length:** 5-7 minutes of reading (1500-2000 words)

---

## Diagrams

All diagrams are in Mermaid format and can be rendered on GitHub or with:

```bash
npm install -g @mermaid-js/mermaid-cli
mmdc -i docs/diagrams/mvcc.mmd -o docs/diagrams/mvcc.png
```

Available diagrams:

- `mvcc.mmd` - Visibility state machine
- `recovery.mmd` - WAL replay flow
- `lsm.mmd` - LSM-Tree levels
- `execution.mmd` - Volcano operator tree

---

## Contributing

When adding new design docs:

1. Follow the existing structure (Overview → Data → Algorithms → Tests → Limits)
2. Keep it focused (one subsystem per doc)
3. Include code examples (TypeScript preferred)
4. List known limitations explicitly
5. Add references to academic papers or production systems

**Target audience:** Senior engineers and interviewers, not beginners.

---

## Quick Links

- **GitHub Root:** [../README.md](../README.md)
- **Source Code:** [../src/](../src/)
- **Tests:** [../tests/](../tests/)
- **Complete Spec (v1.3.0):** [reference/COMPLETE_SPEC_v1.3.0.md](reference/COMPLETE_SPEC_v1.3.0.md)

---

**Last Updated:** 2025-01-15  
**Maintainer:** Your Name  
**Status:** Interview-Ready
