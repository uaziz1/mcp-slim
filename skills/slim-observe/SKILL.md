---
name: slim-observe
description: |
  Scan Claude Code session transcripts for raw MCP calls. Shows which
  calls are most expensive and frequent. Use to understand MCP usage
  before running /slim-evolve.
allowed-tools:
  - Bash
  - Read
---

## Instructions

Run the mcp-slim observer to scan session transcripts:

```bash
npx @uaziz1/mcp-slim observe
```

Present the output to the user. Explain:
- **By tool**: Which raw MCP tools are called most frequently
- **Unique signatures**: How many distinct call patterns exist
- **Top signatures**: The most repeated patterns (these are evolution candidates)

If the user wants to see existing observation data:
```bash
wc -l ~/.mcp-slim/observations.jsonl 2>/dev/null || echo "No observations yet"
```

Suggest running `/slim-evolve` if there are patterns above the promotion threshold (default: 5 calls).
