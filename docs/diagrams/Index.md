flowchart TB
subgraph Index["Index Layer"]
BTREE[B-Tree Indexes]
IDXMGR[IndexManager]
end

    BTREE --> IDXMGR
    style Index fill:#d1f7ff
