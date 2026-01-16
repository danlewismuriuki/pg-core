export interface Snapshot {
    xmin: number;
    xmax: number;
    activeTxns: Set<number>;
    myTxnId: number;
  }