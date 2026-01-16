export class CommitTable {
    private committed = new Set<number>();
    private aborted = new Set<number>();
  
    markCommitted(txnId: number): void {
      this.committed.add(txnId);
    }
  
    markAborted(txnId: number): void {
      this.aborted.add(txnId);
    }
  
    isCommitted(txnId: number): boolean {
      return this.committed.has(txnId);
    }
  
    isAborted(txnId: number): boolean {
      return this.aborted.has(txnId);
    }
  
    isInProgress(txnId: number): boolean {
      return !this.committed.has(txnId) && !this.aborted.has(txnId);
    }
  }