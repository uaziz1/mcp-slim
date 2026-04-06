# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

mcp-slim is a self-learning MCP proxy server for Claude Code. It intercepts expensive MCP tool calls (which return 50K-200K character JSON blobs), calls the underlying REST APIs directly, and returns clean markdown (500-2,000 chars). It learns which calls to proxy by observing session transcripts.

## Commands

```bash
npm start                    # Start the MCP proxy server (stdio transport)
npm run validate             # Validate all modules in the modules directory
npm run observe              # Scan Claude Code sessions for raw MCP calls
npm run evolve               # Observe + detect promotion candidates
node bin/mcp-slim.js status  # Show active modules, tool count, observation stats
node bin/mcp-slim.js init    # Set up ~/.mcp-slim/ and register skills
```

There are no tests, no linter, no build step, and no TypeScript. The project is plain ESM JavaScript targeting Node 18+.

## Architecture

**Server** (`src/server.js`): ~70-line MCP server using `@modelcontextprotocol/sdk`. npm package: `@uaziz1/mcp-slim`. On startup, dynamically imports all `.js` files in the modules directory (skipping `_`-prefixed, `.example.js`, and `shared.js`). Merges all `tools` arrays and `handlers` objects into a single dispatch map. Adding a module = dropping a file; no imports or config to edit.

**CLI** (`bin/mcp-slim.js`): Subcommand router (serve, observe, evolve, validate, status, init). Default command is `serve`. The `evolve --auto` path invokes `claude -p` to generate modules.

**Self-learning pipeline** (the core differentiator):
1. **Observe** (`bin/observe.js`): Scans `~/.claude/projects/*/\*.jsonl` for `mcp__*` tool_use blocks. Normalizes each call into a canonical signature (captures call shape, not specific values). Appends to `~/.mcp-slim/observations.jsonl`. Has service-specific normalization for HubSpot (objectType + filter props) and Notion (data_source_id + filter props).
2. **Detect** (`bin/detect.js`): Groups observations by signature, promotes patterns above threshold (default: 5 calls). Outputs candidates with suggested tool names, target modules, and example inputs. Checks for name collisions with existing modules.
3. **Generate**: Claude Code itself generates proxy modules when user runs `/slim-evolve`. Uses `_template.js` and `shared.js` as patterns.
4. **Validate** (`bin/validate.js`): Checks modules can import, export `{tools, handlers}`, have matching tool/handler pairs, and no name collisions.

**Shared utilities** (`src/shared.js`): API wrappers (`apiFetch`, `notionFetch`, `hubspotFetch`, `msGraphFetch`, `googleFetch`), Notion property extractors (`extractTitle`, `extractSelect`, etc.), markdown formatters (`mdTable`, `textResult`, `errorResult`). Modules import these from `./shared.js` (relative to the modules directory, not src/).

**Scheduling** (`bin/schedule.js`): Sets up launchd (macOS) or crontab (Linux) for automatic evolution.

**Skills** (`skills/`): Three Claude Code slash commands (`/slim-status`, `/slim-evolve`, `/slim-observe`). Installed via `./setup` which symlinks into `~/.claude/skills/`.

## Module Contract

Every module exports a default object:

```javascript
export default {
  tools: [{ name: "fetch_something", description: "...", inputSchema: {...} }],
  handlers: { fetch_something: async (params) => textResult(markdown) },
};
```

- Tool names: `snake_case`, reads start with `fetch_`, writes with `update_`/`create_`
- Handlers must return `textResult(markdown)` or `errorResult(message)`
- Responses should stay under 2,000 characters
- API tokens come from env vars, never hardcoded
- Community modules are read-only (no create/update/delete operations)

## Code Conventions

- ESM only (`import`/`export`, not `require`)
- `async`/`await` (not `.then()`)
- No external dependencies beyond `@modelcontextprotocol/sdk` -- uses Node 18+ built-in `fetch`
- No TypeScript, no build step
- Modules directory at runtime: `MCP_SLIM_MODULES` env var, or `~/.mcp-slim/modules/`, or `src/modules/`

## Key File Paths at Runtime

- `~/.mcp-slim/modules/` -- user's proxy modules (auto-discovered)
- `~/.mcp-slim/observations.jsonl` -- recorded MCP call observations
- `~/.mcp-slim/candidates.json` -- promotion candidates (written by evolve --auto)
- `~/.mcp-slim/config.json` -- optional config (promotion_threshold, lookback_days, excluded_tools)
- `~/.claude/projects/*/\*.jsonl` -- Claude Code session transcripts (read by observer)
