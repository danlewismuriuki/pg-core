// tests/integration.test.ts - UPDATED WITH LOGGING
import { DatabaseService } from '../src/db/DatabaseService';
import { enableTestLogging, logger } from '../src/utils/logger';

describe('Integration Tests - Snapshot Isolation', () => {
  let db: DatabaseService;

  beforeAll(() => {
    // Enable logging only if specifically requested
    if (process.env.LOG_TESTS === 'true') {
      const level = process.env.LOG_LEVEL_TEST || 'info';
      enableTestLogging(level as any);
      logger.info(`Test logging enabled at level: ${level}`);
    }
  });

  beforeEach(() => {
    db = new DatabaseService();
  });

  test('prevents dirty reads - uncommitted data invisible', () => {
    const t1 = db.begin(); // txn 1
    db.insert(t1, 'user_1', { id: 1, name: 'Alice', age: 25 });

    const t2 = db.begin(); // txn 2
    let results = db.select(t2);
    expect(results.length).toBe(0); // should not see uncommitted data

    db.commit(t1); // commit txn 1

    results = db.select(t2); // still should not see it
    expect(results.length).toBe(0);

    db.commit(t2);

    const t3 = db.begin(); // txn 3
    const results3 = db.select(t3);
    expect(results3.length).toBe(1);
    expect(results3[0].name).toBe('Alice');
    db.commit(t3);
  });

  test('prevents non-repeatable reads - snapshot frozen at BEGIN', () => {
    const t1 = db.begin();
    db.insert(t1, 'user_1', { id: 1, name: 'Alice', age: 25 });
    db.commit(t1);

    const t2 = db.begin();
    const read1 = db.select(t2, ['user_1']);
    expect(read1[0].age).toBe(25);

    const t3 = db.begin();
    db.update(t3, 'user_1', { id: 1, name: 'Alice', age: 26 });
    db.commit(t3);

    const read2 = db.select(t2, ['user_1']);
    expect(read2[0].age).toBe(25); // snapshot frozen

    db.commit(t2);

    const t4 = db.begin();
    const read3 = db.select(t4, ['user_1']);
    expect(read3[0].age).toBe(26);
    db.commit(t4);
  });

  test('first-committer-wins conflict detection', () => {
    const t1 = db.begin();
    db.insert(t1, 'user_1', { id: 1, name: 'Alice', age: 25 });
    db.commit(t1);

    const t2 = db.begin();
    const t3 = db.begin();

    db.update(t2, 'user_1', { id: 1, name: 'Alice', age: 26 });
    db.update(t3, 'user_1', { id: 1, name: 'Alice', age: 27 });

    db.commit(t2);

    expect(() => db.commit(t3)).toThrow(/Write-write conflict/);
  });

  test('aborted transaction data is invisible', () => {
    const t1 = db.begin();
    db.insert(t1, 'user_1', { id: 1, name: 'Alice', age: 25 });
    db.abort(t1);

    const t2 = db.begin();
    const results = db.select(t2, ['user_1']);
    expect(results.length).toBe(0);
    db.commit(t2);
  });

  test('garbage collection removes old versions', () => {
    const t1 = db.begin();
    db.insert(t1, 'user_1', { id: 1, name: 'Alice', age: 25 });
    db.commit(t1);

    const t2 = db.begin();
    db.update(t2, 'user_1', { id: 1, name: 'Alice', age: 26 });
    db.commit(t2);

    const t3 = db.begin();
    db.update(t3, 'user_1', { id: 1, name: 'Alice', age: 27 });
    db.commit(t3);

    // After all commits, old versions should be collected automatically
    const t4 = db.begin();
    const results = db.select(t4, ['user_1']);
    expect(results[0].age).toBe(27);
    db.commit(t4);
  });

  test('concurrent reads are consistent', () => {
    const t1 = db.begin();
    db.insert(t1, 'user_1', { id: 1, name: 'Alice', age: 25 });
    db.insert(t1, 'user_2', { id: 2, name: 'Bob', age: 30 });
    db.commit(t1);

    const t2 = db.begin();
    const t3 = db.begin();

    const read1 = db.select(t2);
    const read2 = db.select(t3);

    expect(read1.length).toBe(2);
    expect(read2.length).toBe(2);

    db.commit(t2);
    db.commit(t3);
  });

  test('delete creates invisible tombstone for other transactions', () => {
    const t1 = db.begin();
    db.insert(t1, 'user_1', { id: 1, name: 'Alice', age: 25 });
    db.commit(t1);

    const t2 = db.begin();
    const t3 = db.begin();

    db.delete(t2, 'user_1');

    // t3 should still see the old version
    let results = db.select(t3, ['user_1']);
    expect(results.length).toBe(1);

    db.commit(t2);

    // t3 still sees old version until it commits
    results = db.select(t3, ['user_1']);
    expect(results.length).toBe(1);

    db.commit(t3);

    const t4 = db.begin();
    const results3 = db.select(t4, ['user_1']);
    expect(results3.length).toBe(0);
    db.commit(t4);
  });
});
