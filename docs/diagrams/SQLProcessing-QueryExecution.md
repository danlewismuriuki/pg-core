flowchart LR
subgraph SQL["SQL Processing Pipeline"]
LEXER[Lexer] --> PARSER[Parser]
PARSER --> VALIDATOR[Validator]
VALIDATOR --> OPTIMIZER[Optimizer]
OPTIMIZER --> EXECUTOR[Executor]
end

    style SQL fill:#f0e1ff
