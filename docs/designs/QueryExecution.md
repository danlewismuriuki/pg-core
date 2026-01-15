# Query Execution Engine

This document describes the Volcano-style iterator model, operator implementation, and heuristic query optimization.

---

## Overview

**Core principle:** Queries are executed as a tree of iterator operators that pull data on-demand.

**Key concepts:**

- **Volcano model:** Each operator implements `open()`, `next()`, `close()`
- **Pipelining:** Operators stream tuples (no materialization)
- **Pull-based:** Parent operators pull from children
- **MVCC integration:** All operators respect snapshot visibility

---

## Iterator Interface

```typescript
interface Iterator {
  open(): void; // Initialize operator state
  next(): Row | null; // Return next row, or null if exhausted
  close(): void; // Release resources
}
```

**Execution lifecycle:**

```typescript
// Query: SELECT * FROM users WHERE age > 25

const scan = new SeqScan(table, predicate);
const result = [];

scan.open();

while (true) {
  const row = scan.next();
  if (row === null) break;
  result.push(row);
}

scan.close();

return result;
```

---

## Operator Types

### 1. Sequential Scan

```typescript
class SeqScan implements Iterator {
  private iterator: Iterator<VersionedRow>;

  constructor(
    private table: Table,
    private predicate: Predicate,
    private snapshot: Snapshot
  ) {}

  open(): void {
    // Initialize scan over MemTable + SSTables
    this.iterator = this.table.scan();
  }

  next(): Row | null {
    while (true) {
      const row = this.iterator.next();

      if (!row) return null; // End of table

      // Apply MVCC visibility
      if (!mvcc.isVisible(row, this.snapshot)) {
        continue; // Skip invisible version
      }

      // Apply predicate
      if (!this.predicate.matches(row.data)) {
        continue; // Skip non-matching row
      }

      return row.data;
    }
  }

  close(): void {
    this.iterator = null;
  }
}
```

**Cost estimate:** O(table size)

---

### 2. Index Scan

```typescript
class IndexScan implements Iterator {
  private indexIterator: Iterator<IndexEntry>;

  constructor(
    private index: BTree,
    private table: Table,
    private predicate: Predicate,
    private snapshot: Snapshot
  ) {}

  open(): void {
    // Range scan over index
    const [minKey, maxKey] = this.predicate.getRange();
    this.indexIterator = this.index.range(minKey, maxKey);
  }

  next(): Row | null {
    while (true) {
      const entry = this.indexIterator.next();

      if (!entry) return null;

      // Fetch heap row
      const heapRow = this.table.get(entry.primaryKey);

      if (!heapRow) continue; // Row GC'd

      // Apply MVCC visibility
      if (!mvcc.isVisible(heapRow, this.snapshot)) {
        continue;
      }

      return heapRow.data;
    }
  }

  close(): void {
    this.indexIterator = null;
  }
}
```

**Cost estimate:** O(selectivity × table size)

---

### 3. Filter

```typescript
class Filter implements Iterator {
  constructor(private child: Iterator, private predicate: Predicate) {}

  open(): void {
    this.child.open();
  }

  next(): Row | null {
    while (true) {
      const row = this.child.next();

      if (!row) return null;

      if (this.predicate.matches(row)) {
        return row;
      }
    }
  }

  close(): void {
    this.child.close();
  }
}
```

---

### 4. Projection

```typescript
class Projection implements Iterator {
  constructor(private child: Iterator, private columns: string[]) {}

  open(): void {
    this.child.open();
  }

  next(): Row | null {
    const row = this.child.next();

    if (!row) return null;

    // Extract specified columns
    const projected: Row = {};
    for (const col of this.columns) {
      projected[col] = row[col];
    }

    return projected;
  }

  close(): void {
    this.child.close();
  }
}
```

---

### 5. Hash Join

```typescript
class HashJoin implements Iterator {
  private hashTable: Map<any, Row[]> = new Map();
  private outerIterator: Iterator;
  private currentMatches: Row[] = [];
  private currentMatchIndex: number = 0;
  private currentOuterRow: Row | null = null;

  constructor(
    private outer: Iterator,
    private inner: Iterator,
    private joinColumn: string
  ) {}

  open(): void {
    // Phase 1: Build hash table from inner relation
    this.inner.open();

    while (true) {
      const row = this.inner.next();
      if (!row) break;

      const key = row[this.joinColumn];

      if (!this.hashTable.has(key)) {
        this.hashTable.set(key, []);
      }

      this.hashTable.get(key).push(row);
    }

    this.inner.close();

    // Phase 2: Probe with outer relation
    this.outer.open();
    this.outerIterator = this.outer;
  }

  next(): Row | null {
    while (true) {
      // Emit remaining matches for current outer row
      if (
        this.currentMatches.length > 0 &&
        this.currentMatchIndex < this.currentMatches.length
      ) {
        const innerRow = this.currentMatches[this.currentMatchIndex++];
        return { ...this.currentOuterRow, ...innerRow };
      }

      // Get next outer row
      this.currentOuterRow = this.outerIterator.next();

      if (!this.currentOuterRow) return null; // No more outer rows

      // Probe hash table
      const key = this.currentOuterRow[this.joinColumn];
      this.currentMatches = this.hashTable.get(key) || [];
      this.currentMatchIndex = 0;

      // If no matches, continue to next outer row
      // (implements inner join; for left join, emit null-padded row)
    }
  }

  close(): void {
    this.outer.close();
    this.hashTable.clear();
  }
}
```

**Key detail:** No recursion—all state stored in instance variables.

---

### 6. Sort

```typescript
class Sort implements Iterator {
  private sortedRows: Row[] = [];
  private currentIndex: number = 0;

  constructor(
    private child: Iterator,
    private sortColumn: string,
    private ascending: boolean = true
  ) {}

  open(): void {
    // Materialize entire input
    this.child.open();

    while (true) {
      const row = this.child.next();
      if (!row) break;
      this.sortedRows.push(row);
    }

    this.child.close();

    // Sort in memory
    this.sortedRows.sort((a, b) => {
      const aVal = a[this.sortColumn];
      const bVal = b[this.sortColumn];

      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return this.ascending ? cmp : -cmp;
    });
  }

  next(): Row | null {
    if (this.currentIndex >= this.sortedRows.length) {
      return null;
    }

    return this.sortedRows[this.currentIndex++];
  }

  close(): void {
    this.sortedRows = [];
    this.currentIndex = 0;
  }
}
```

**Note:** Sort is a blocking operator (materializes entire input).

---

### 7. Aggregate

```typescript
class Aggregate implements Iterator {
  private result: Row | null = null;
  private emitted: boolean = false;

  constructor(
    private child: Iterator,
    private aggregates: AggregateFunction[]
  ) {}

  open(): void {
    this.child.open();

    // Initialize accumulators
    const accumulators = new Map<string, any>();

    for (const agg of this.aggregates) {
      accumulators.set(agg.name, agg.initialize());
    }

    // Consume entire input
    while (true) {
      const row = this.child.next();
      if (!row) break;

      for (const agg of this.aggregates) {
        const current = accumulators.get(agg.name);
        const updated = agg.accumulate(current, row[agg.column]);
        accumulators.set(agg.name, updated);
      }
    }

    this.child.close();

    // Finalize result
    this.result = {};
    for (const agg of this.aggregates) {
      const final = agg.finalize(accumulators.get(agg.name));
      this.result[agg.name] = final;
    }
  }

  next(): Row | null {
    if (!this.emitted) {
      this.emitted = true;
      return this.result;
    }
    return null; // Aggregate returns single row
  }

  close(): void {
    this.result = null;
  }
}
```

---

## Query Optimization

### Heuristic Rules

```typescript
class QueryOptimizer {
  optimize(logicalPlan: LogicalPlan): PhysicalPlan {
    let plan = logicalPlan;

    // Rule 1: Push down predicates
    plan = this.pushDownFilters(plan);

    // Rule 2: Choose scan method
    plan = this.selectScanMethod(plan);

    // Rule 3: Choose join order
    plan = this.selectJoinOrder(plan);

    return plan;
  }

  private pushDownFilters(plan: LogicalPlan): LogicalPlan {
    // Move filters as close to base tables as possible
    // Example: Filter(Join(A, B), predicate on A)
    //       → Join(Filter(A, predicate), B)

    if (plan instanceof Join) {
      const leftPredicate = this.extractPredicates(plan.predicate, plan.left);
      const rightPredicate = this.extractPredicates(plan.predicate, plan.right);

      return new Join(
        new Filter(plan.left, leftPredicate),
        new Filter(plan.right, rightPredicate),
        plan.joinPredicate
      );
    }

    return plan;
  }

  private selectScanMethod(plan: LogicalPlan): PhysicalPlan {
    if (!(plan instanceof Scan)) return plan;

    const predicate = plan.predicate;
    const table = plan.table;
    const indexes = table.getIndexes();

    // Cost model
    const seqScanCost = table.estimateRowCount();
    let bestPlan: PhysicalPlan = new SeqScan(table, predicate, snapshot);
    let bestCost = seqScanCost;

    for (const index of indexes) {
      if (predicate.canUseIndex(index)) {
        const selectivity = 0.1; // Assume 10% without stats
        const indexCost = table.estimateRowCount() * selectivity;

        if (indexCost < bestCost) {
          bestPlan = new IndexScan(index, table, predicate, snapshot);
          bestCost = indexCost;
        }
      }
    }

    return bestPlan;
  }

  private selectJoinOrder(plan: LogicalPlan): PhysicalPlan {
    if (!(plan instanceof Join)) return plan;

    // Simple heuristic: smaller table as inner (build side)
    const leftSize = plan.left.estimateRowCount();
    const rightSize = plan.right.estimateRowCount();

    if (leftSize < rightSize) {
      return new HashJoin(plan.right, plan.left, plan.joinColumn);
    } else {
      return new HashJoin(plan.left, plan.right, plan.joinColumn);
    }
  }
}
```

---

### Example Query Plan

**SQL:**

```sql
SELECT u.name, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.age > 25 AND o.total > 100;
```

**Logical Plan (before optimization):**

```
Projection(name, total)
  ↓
Filter(age > 25 AND total > 100)
  ↓
Join(users.id = orders.user_id)
  ↓              ↓
Scan(users)    Scan(orders)
```

**Physical Plan (after optimization):**

```
Projection(name, total)
  ↓
HashJoin(user_id)
  ↓                    ↓
IndexScan(users)    Filter(total > 100)
  idx_age > 25         ↓
                    SeqScan(orders)
```

**Optimizations applied:**

1. Push down filters (age > 25 to users scan, total > 100 to orders scan)
2. Use index scan for users (idx_age available)
3. Smaller table (users) as inner (build side) for hash join

---

## MVCC Integration

**Critical:** Every scan operator must apply MVCC visibility.

```typescript
// Inside any scan operator
next(): Row | null {
  while (true) {
    const row = this.dataSource.next();

    if (!row) return null;

    // MVCC check (required!)
    if (!mvcc.isVisible(row, this.snapshot)) {
      continue;
    }

    // Predicate check
    if (!this.predicate.matches(row.data)) {
      continue;
    }

    return row.data;
  }
}
```

**Why this matters:**

- A scan might see 10 versions of a row
- Only 1 version is visible to the snapshot
- Without MVCC, we'd return stale/deleted data

---

## Testing Strategy

### Unit Tests

```typescript
describe("Iterator Mechanics", () => {
  test("SeqScan filters by predicate", () => {
    const table = createTestTable([
      { id: 1, age: 25 },
      { id: 2, age: 30 },
      { id: 3, age: 35 },
    ]);

    const scan = new SeqScan(table, new Predicate("age", ">", 28), snapshot);
    const results = [];

    scan.open();
    while (true) {
      const row = scan.next();
      if (!row) break;
      results.push(row);
    }
    scan.close();

    expect(results).toEqual([
      { id: 2, age: 30 },
      { id: 3, age: 35 },
    ]);
  });
});
```

---

### Integration Tests

```typescript
describe("Query Execution", () => {
  test("Join with filter", async () => {
    await db.execute("CREATE TABLE users (id INT, name VARCHAR, age INT)");
    await db.execute("CREATE TABLE orders (id INT, user_id INT, total INT)");

    await db.execute('INSERT INTO users VALUES (1, "Alice", 30)');
    await db.execute('INSERT INTO users VALUES (2, "Bob", 25)');
    await db.execute("INSERT INTO orders VALUES (1, 1, 100)");
    await db.execute("INSERT INTO orders VALUES (2, 1, 200)");

    const result = await db.execute(`
      SELECT u.name, o.total
      FROM users u
      JOIN orders o ON u.id = o.user_id
      WHERE u.age > 25
    `);

    expect(result.rows).toEqual([
      { name: "Alice", total: 100 },
      { name: "Alice", total: 200 },
    ]);
  });
});
```

---

## Known Limitations

### 1. No Statistics

**Missing:** Histograms, cardinality estimates

**Impact:** Optimizer uses fixed 10% selectivity

---

### 2. No Adaptive Optimization

**Missing:** Runtime query reoptimization

**Impact:** Cannot adjust plan based on actual selectivity

---

### 3. No Parallelism

**Current:** Single-threaded execution

**Production solution:** Parallel hash join, partitioned scans

---

### 4. No Index-Only Scans

**Current:** Always fetch heap row

**Impact:** Extra I/O for covering queries

---

### 5. Limited Join Algorithms

**Current:** Hash join only

**Missing:** Sort-merge join, nested loop join

---

### 6. No Subquery Optimization

**Current:** Subqueries executed independently

**Missing:** Correlated subquery decorrelation

---

## Comparison to Other Systems

| System             | Model      | Join Algorithms     | Parallelism | Adaptivity       |
| ------------------ | ---------- | ------------------- | ----------- | ---------------- |
| **This prototype** | Volcano    | Hash                | None        | None             |
| **Postgres**       | Volcano    | Hash, Nested, Merge | Worker pool | None             |
| **MySQL**          | Volcano    | Nested, Hash (8.0+) | None        | None             |
| **SQL Server**     | Volcano    | Hash, Merge, Nested | Yes         | Adaptive (2017+) |
| **DuckDB**         | Vectorized | Hash, Merge         | Yes         | Yes              |

---

## Future Enhancements

### 1. Vectorized Execution

**Current:** Row-at-a-time (Volcano)

**Improvement:** Process batches of 1000 rows

```typescript
interface VectorizedIterator {
  nextBatch(): RowBatch | null;
}

class RowBatch {
  columns: Map<string, any[]>;
  size: number;
}
```

**Benefit:** 10x faster via CPU cache locality

---

### 2. Code Generation

**Current:** Interpreted execution

**Improvement:** JIT-compile query to native code

**Benefit:** Remove iterator overhead

---

### 3. Parallel Execution

**Current:** Single-threaded

**Improvement:** Partition scans across workers

---

### 4. Materialization Hints

**Current:** Sort always materializes

**Improvement:** Spill to disk if memory exceeds threshold

---

## References

- [Volcano: An Extensible and Parallel Query Evaluation System](https://paperhub.s3.amazonaws.com/dace52a42c07f7f8348b08dc2b186061.pdf) (Graefe, 1994)
- [MonetDB/X100: Hyper-Pipelining Query Execution](https://www.cidrdb.org/cidr2005/papers/P19.pdf) (Boncz et al., 2005)
- [Adaptive Execution in SQL Server](https://docs.microsoft.com/en-us/sql/relational-databases/performance/adaptive-query-processing)
