flowchart TB
subgraph Execution["Query Execution (Volcano Model)"]
EXECUTOR[Executor]
TABLESCAN[TableScan]
INDEXSCAN[IndexScan]
HASHJOIN[HashJoin]
FILTER[Filter]
PROJECTION[Projection]
end

    EXECUTOR --> TABLESCAN
    EXECUTOR --> INDEXSCAN
    TABLESCAN --> FILTER --> PROJECTION
    INDEXSCAN --> FILTER --> PROJECTION
    PROJECTION --> HASHJOIN

    style Execution fill:#e8f5e9
