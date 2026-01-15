flowchart TB
subgraph Transaction["Transaction Management"]
TXNMGR["TransactionManager
(Allocate xmin/xmax)
Track globalOldestXmin"]
MVCC["MVCCEngine
(Visibility Rules)"]
CONFLICT["ConflictDetector
(First-Committer-Wins)"]
end

    TXNMGR --> MVCC
    MVCC --> CONFLICT
    style Transaction fill:#fff4e1
