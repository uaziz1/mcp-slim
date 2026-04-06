---
name: slim-status
description: |
  Show mcp-slim proxy status: active modules, tool count, observation stats,
  estimated savings. Use when checking proxy health or before/after evolve.
allowed-tools:
  - Bash
  - Read
---

## Instructions

Run the mcp-slim status command and present the results:

```bash
npx @uaziz1/mcp-slim status
```

Present the output to the user. If the modules directory is empty or doesn't exist, suggest running `mcp-slim init` or `/slim-evolve` to get started.

If observations exist, also check `~/.mcp-slim/observations.jsonl` line count to report total observations tracked.
