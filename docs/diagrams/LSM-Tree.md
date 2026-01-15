flowchart TB
subgraph Storage["LSM-Tree Storage + WAL"]
MEMTABLE["MemTable
Skip List, 4MB"]
WAL["Write-Ahead Log
COMMIT + fsync"]
SSTABLE["SSTables
Immutable Sorted Files"]
COMPACT["Compactor
Background Merge
Uses globalOldestXmin"]
CKPT["Checkpointer
Flush → Update Manifest"]
end

    MEMTABLE --> SSTABLE
    WAL --> MEMTABLE
    SSTABLE --> COMPACT
    COMPACT --> CKPT
    CKPT --> MEMTABLE

    style Storage fill:#e1f5ff
