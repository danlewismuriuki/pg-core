import { TransactionManager } from '../src/transaction/TransactionManager';
import { CommitTable } from '../src/transaction/CommitTable';

describe('TransactionManager', () => {
  let txnManager: TransactionManager;

  beforeEach(() => {
    txnManager = new TransactionManager();
  });

  test('should allocate sequential transaction IDs', () => {
    const t1 = txnManager.begin();
    const t2 = txnManager.begin();
    const t3 = txnManager.begin();

    expect(t1.id).toBe(1);
    expect(t2.id).toBe(2);
    expect(t3.id).toBe(3);
  });

  test('should create snapshot with correct xmin, xmax, and myTxnId', () => {
    const t1 = txnManager.begin();

    expect(t1.snapshot.xmin).toBe(1);
    expect(t1.snapshot.xmax).toBe(2); // nextTxnId at time of BEGIN
    expect(t1.snapshot.activeTxns.has(1)).toBe(false);
    expect(t1.snapshot.myTxnId).toBe(1);
  });

  test('should track all active transactions in snapshot', () => {
    const t1 = txnManager.begin();
    const t2 = txnManager.begin();
    const t3 = txnManager.begin();

    // t3 snapshot should see t1, t2 as active, but NOT itself (t3)
    expect(t3.snapshot.activeTxns.has(1)).toBe(true);
    expect(t3.snapshot.activeTxns.has(2)).toBe(true);
    expect(t3.snapshot.activeTxns.has(3)).toBe(false); // ✅ FIXED: transaction not in its own activeTxns
    expect(t3.snapshot.myTxnId).toBe(3);
  });

  test('should update globalOldestXmin on commit', () => {
    const t1 = txnManager.begin();
    const t2 = txnManager.begin();

    txnManager.commit(t1);

    const oldestXmin = txnManager.getGlobalOldestXmin();
    expect(oldestXmin).toBe(t2.snapshot.xmin);

    txnManager.commit(t2);

    // When no active transactions, globalOldestXmin should equal nextTxnId
    expect(txnManager.getGlobalOldestXmin()).toBe(txnManager.getNextTxnId());
  });

  test('should handle aborted transactions correctly', () => {
    const t1 = txnManager.begin();
    const t2 = txnManager.begin();

    txnManager.abort(t1);

    // globalOldestXmin should advance past aborted txn
    expect(txnManager.getGlobalOldestXmin()).toBe(t2.snapshot.xmin);
  });
});

describe('CommitTable', () => {
  let commitTable: CommitTable;

  beforeEach(() => {
    commitTable = new CommitTable();
  });

  test('should track committed transactions', () => {
    commitTable.markCommitted(1);

    expect(commitTable.isCommitted(1)).toBe(true);
    expect(commitTable.isAborted(1)).toBe(false);
    expect(commitTable.isInProgress(1)).toBe(false);
  });

  test('should track aborted transactions', () => {
    commitTable.markAborted(2);

    expect(commitTable.isCommitted(2)).toBe(false);
    expect(commitTable.isAborted(2)).toBe(true);
    expect(commitTable.isInProgress(2)).toBe(false);
  });

  test('should identify in-progress transactions', () => {
    const txnId = 3;
    // New txnId not marked committed or aborted
    expect(commitTable.isInProgress(txnId)).toBe(true);
    expect(commitTable.isCommitted(txnId)).toBe(false);
    expect(commitTable.isAborted(txnId)).toBe(false);
  });
});