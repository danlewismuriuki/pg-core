import { MVCCEngine } from '../src/mvcc/MVCCEngine';
import { CommitTable } from '../src/transaction/CommitTable';
import { VersionedRow } from '../src/mvcc/VersionedRow';
import { Snapshot } from '../src/transaction/Snapshot';

describe('MVCCEngine - Visibility Rules', () => {
  let mvcc: MVCCEngine;
  let commitTable: CommitTable;

  beforeEach(() => {
    commitTable = new CommitTable();
    mvcc = new MVCCEngine(commitTable);
  });

  test('Rule 1: Created by active txn → invisible', () => {
    const snapshot: Snapshot = {
      xmin: 1,
      xmax: 5,
      activeTxns: new Set([3]), // txn 3 is active
      myTxnId: 2, // current txn
    };

    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 3,
      xmax: null,
    };

    expect(mvcc.isVisible(row, snapshot)).toBe(false);
  });

  test('Rule 2: Created after snapshot → invisible', () => {
    commitTable.markCommitted(6);

    const snapshot: Snapshot = {
      xmin: 1,
      xmax: 5,
      activeTxns: new Set(),
      myTxnId: 1,
    };

    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 6,
      xmax: null,
    };

    expect(mvcc.isVisible(row, snapshot)).toBe(false);
  });

  test('Rule 3: Not deleted and committed → visible', () => {
    commitTable.markCommitted(2);

    const snapshot: Snapshot = {
      xmin: 1,
      xmax: 5,
      activeTxns: new Set(),
      myTxnId: 3,
    };

    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 2,
      xmax: null,
    };

    expect(mvcc.isVisible(row, snapshot)).toBe(true);
  });

  test('Rule 4: Deleted before snapshot → invisible', () => {
    commitTable.markCommitted(2);
    commitTable.markCommitted(4);

    const snapshot: Snapshot = {
      xmin: 5,
      xmax: 10,
      activeTxns: new Set(),
      myTxnId: 5,
    };

    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 2,
      xmax: 4,
    };

    expect(mvcc.isVisible(row, snapshot)).toBe(false);
  });

  test('Rule 5: Deleted by active txn → still visible', () => {
    commitTable.markCommitted(2);

    const snapshot: Snapshot = {
      xmin: 1,
      xmax: 5,
      activeTxns: new Set([3]),
      myTxnId: 2,
    };

    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 2,
      xmax: 3,
    };

    expect(mvcc.isVisible(row, snapshot)).toBe(true);
  });

  test('Rule 6: Deleted after snapshot → visible', () => {
    commitTable.markCommitted(2);
    commitTable.markCommitted(6);

    const snapshot: Snapshot = {
      xmin: 1,
      xmax: 5,
      activeTxns: new Set(),
      myTxnId: 3,
    };

    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 2,
      xmax: 6,
    };

    expect(mvcc.isVisible(row, snapshot)).toBe(true);
  });

  test('Creator not committed → invisible', () => {
    const snapshot: Snapshot = {
      xmin: 1,
      xmax: 5,
      activeTxns: new Set(),
      myTxnId: 1,
    };

    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 2, // not committed
      xmax: null,
    };

    expect(mvcc.isVisible(row, snapshot)).toBe(false);
  });

  test('Deleter not committed → visible', () => {
    commitTable.markCommitted(2);

    const snapshot: Snapshot = {
      xmin: 1,
      xmax: 5,
      activeTxns: new Set(),
      myTxnId: 3,
    };

    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 2,
      xmax: 3, // deleter not committed
    };

    expect(mvcc.isVisible(row, snapshot)).toBe(true);
  });
});

describe('MVCCEngine - Garbage Collection', () => {
  let mvcc: MVCCEngine;
  let commitTable: CommitTable;

  beforeEach(() => {
    commitTable = new CommitTable();
    mvcc = new MVCCEngine(commitTable);
  });

  test('should NOT collect undeleted rows', () => {
    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 1,
      xmax: null,
    };

    expect(mvcc.canGarbageCollect(row, 10)).toBe(false);
  });

  test('should collect row when both xmin and xmax < globalOldestXmin', () => {
    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 2,
      xmax: 5,
    };

    expect(mvcc.canGarbageCollect(row, 10)).toBe(true);
  });

  test('should NOT collect row if xmin >= globalOldestXmin', () => {
    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 8,
      xmax: 9,
    };

    expect(mvcc.canGarbageCollect(row, 5)).toBe(false);
  });

  test('should NOT collect row if xmax >= globalOldestXmin', () => {
    const row: VersionedRow = {
      key: 'test',
      data: { value: 'data' },
      xmin: 2,
      xmax: 10,
    };

    expect(mvcc.canGarbageCollect(row, 5)).toBe(false);
  });
});
