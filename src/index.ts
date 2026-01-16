import { DatabaseService } from './db/DatabaseService';

console.log("=".repeat(80));
console.log("ENTERPRISE RDBMS - PHASE 1: MVCC + SNAPSHOT ISOLATION");
console.log("=".repeat(80));

const db = new DatabaseService();

// Test 1: Basic snapshot isolation
console.log("\n--- Test 1: Snapshot Isolation ---");
const t1 = db.begin();
db.insert(t1, "user_1", { id: 1, name: "Alice", age: 25 });
db.insert(t1, "user_2", { id: 2, name: "Bob", age: 30 });
db.commit(t1);

const t2 = db.begin();
console.log("T2 sees:", db.select(t2));
db.commit(t2);

// Test 2: Write-write conflict
console.log("\n--- Test 2: First-Committer-Wins Conflict ---");
const t3 = db.begin();
const t4 = db.begin();

db.update(t3, "user_1", { id: 1, name: "Alice", age: 26 });
db.update(t4, "user_1", { id: 1, name: "Alice", age: 27 });

db.commit(t3);

try {
  db.commit(t4);
} catch (e: any) {
  console.log(`✓ T4 correctly aborted: ${e.message}`);
}

// Test 3: Aborted transaction visibility
console.log("\n--- Test 3: Aborted Transactions Invisible ---");
const t5 = db.begin();
db.insert(t5, "user_3", { id: 3, name: "Charlie", age: 35 });
db.abort(t5);

const t6 = db.begin();
const results = db.select(t6, ["user_3"]);
console.log(`T6 sees user_3: ${results.length === 0 ? "NO (correct)" : "YES (wrong)"}`);
db.commit(t6);

console.log("\n" + "=".repeat(80));
console.log("✅ PHASE 1 COMPLETE");
console.log("=".repeat(80));