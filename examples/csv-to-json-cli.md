# Task: Design a Python CLI tool that converts CSV files to JSON

Write a detailed implementation plan for a CLI tool (`csv2json`) that reads CSV files and outputs JSON. The tool should handle real-world CSV edge cases.

## Requirements

- Read from file path or stdin
- Output to stdout (default) or file (`--output` flag)
- Support nested JSON via dot-notation headers (e.g., `address.city` becomes `{"address": {"city": ...}}`)
- Handle CSV edge cases: quoted fields, embedded commas, mixed encodings
- Include a `--schema` flag that outputs a JSON Schema inferred from the CSV
- Stream large files (100MB+) without loading the entire file into memory

## Include in your plan

- Project structure and module breakdown
- Key function signatures with type hints
- Error handling strategy (malformed rows, encoding issues)
- Testing approach: unit tests for parser edge cases, integration tests for CLI
- One complete code example showing the streaming parser
- Performance considerations for large files
- Packaging and distribution (pyproject.toml, entry point)
