---
name: slim-evolve
description: |
  Run the mcp-slim evolution loop. Observes Claude Code sessions, detects
  expensive MCP patterns, generates optimized proxy modules, validates,
  and deploys them. This is the self-learning core of mcp-slim.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

## Instructions

Run the full mcp-slim evolution loop. You ARE the LLM that generates the modules.

### Step 1: Observe

Scan session transcripts for raw MCP calls:

```bash
npx @uaziz1/mcp-slim observe
```

Review the output. Note which MCP servers and patterns are most frequent.

### Step 2: Detect

Find patterns above the promotion threshold:

```bash
npx @uaziz1/mcp-slim evolve 2>&1
```

If no candidates are found, report that to the user and suggest waiting for more usage data.

### Step 3: Generate Modules

For each promotion candidate:

1. Find the module template. Check these locations in order:
   - `~/.mcp-slim/repo/src/modules/_template.js` (git clone install)
   - `$(npm root -g)/@uaziz1/mcp-slim/src/modules/_template.js` (global npm install)
   - `$(npm root)/@uaziz1/mcp-slim/src/modules/_template.js` (local npm install)
   - Also read `shared.js` from the same directory to understand available utilities

2. Generate a proxy module following the template pattern:
   - Use the candidate's `mcp_server` to determine which API to call
   - Use `example_inputs` to understand the call shape
   - Use `suggested_name` for the tool name
   - Import utilities from `./shared.js`
   - Return markdown via `textResult()`, not raw JSON
   - Keep responses under 2,000 characters

3. Write the module to `~/.mcp-slim/modules/<suggested_name>.js`

4. Ensure `shared.js` exists in the modules directory (copy from the same location where you found the template):
   ```bash
   # Try git clone location first, then global npm, then local npm
   cp ~/.mcp-slim/repo/src/shared.js ~/.mcp-slim/modules/shared.js 2>/dev/null \
     || cp $(npm root -g)/@uaziz1/mcp-slim/src/shared.js ~/.mcp-slim/modules/shared.js 2>/dev/null \
     || cp $(npm root)/@uaziz1/mcp-slim/src/shared.js ~/.mcp-slim/modules/shared.js 2>/dev/null \
     || echo "WARNING: Could not find shared.js to copy"
   ```

### Step 4: Validate

```bash
npx @uaziz1/mcp-slim validate
```

If validation fails, fix the issues and re-validate.

### Step 5: Report

Tell the user:
- How many modules were generated
- Which MCP patterns are now proxied
- That they need to restart Claude Code for the new tools to take effect
- Estimated savings (each proxied call saves ~40K-180K characters of context)

### Important Notes

- Never generate modules for write operations (create, update, delete, send)
- Only generate for read patterns that return large JSON responses
- Each module must export `{ tools: [...], handlers: {...} }`
- Every tool name must be unique across all modules
- API tokens come from environment variables, never hardcode them
