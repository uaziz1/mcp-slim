# How mcp-slim Works

## The Problem

MCP (Model Context Protocol) servers act as bridges between Claude Code and external services like Notion, HubSpot, Slack, and Teams. When Claude needs data from these services, it calls MCP tools. The MCP server makes the API call and returns the response.

The problem: MCP servers return **complete API responses** as JSON. A single Notion database query returns ~187,000 characters. A HubSpot deal search returns ~94,000 characters. Claude reads every character of these responses, consuming tokens that you pay for.

Most of that data is pagination metadata, deeply nested type wrappers, and fields Claude doesn't need. The actual useful information (task names, deal stages, amounts) is a fraction of the response.

## The Solution

mcp-slim is a second MCP server that sits alongside your existing ones. It registers its own tools (like `fetch_tasks` instead of `API-query-data-source`) with clear descriptions. When Claude needs data, it prefers mcp-slim's tools because:

1. The descriptions are more specific ("Fetch active tasks sorted by priority" vs "Query a data source")
2. The responses are smaller and easier to parse
3. The data is already formatted as markdown

mcp-slim's tools call the APIs directly using REST endpoints, extract only the relevant fields, format them as markdown tables or text, and return ~1,000-2,000 characters instead of ~100,000-200,000.

## Dynamic Module Discovery

The server's entry point (`src/server.js`) is ~70 lines. It doesn't know or care what APIs are being proxied. On startup, it:

1. Reads all `.js` files in the modules directory
2. Skips `_`-prefixed files (templates), `.example.js` files, and `shared.js`
3. Dynamically imports each module
4. Collects all `tools` arrays into a single list
5. Merges all `handlers` objects into a single dispatch map

Adding a module = dropping a `.js` file. Removing a module = deleting it. No imports to edit, no config to update, no rebuild step.

## Shared Utilities

`src/shared.js` provides building blocks that modules use:

- **API wrappers**: Authenticated fetch for Notion, HubSpot, Microsoft Graph, Google APIs. Handles headers, auth tokens, pagination, and error formatting.
- **Notion extractors**: 8 functions that flatten Notion's deeply nested property structures into simple values. `extractTitle`, `extractSelect`, `extractStatus`, etc.
- **Formatters**: `mdTable()` builds markdown tables. `textResult()` and `errorResult()` wrap responses in MCP format.
- **Owner resolution**: Cached name lookup for HubSpot deal/contact owners.

## The Self-Learning Loop

mcp-slim's unique feature is that it grows itself. The loop has four stages:

### 1. Observe (`bin/observe.js`)

Scans Claude Code session transcripts (JSONL files in `~/.claude/projects/`). Extracts every `tool_use` block where the tool name starts with `mcp__` (an MCP call). Skips calls to mcp-slim itself.

Each call is normalized into a **canonical signature** that captures the shape of the call (which API, which operation, which filter properties) but not specific values. For example:

```
hubspot:hubspot-search-objects:obj=deals,filters=[dealstage.EQ],props=[dealname,amount,dealstage]
```

This means "search HubSpot deals filtered by dealstage, returning dealname, amount, and dealstage." Whether the filter value is "closedwon" or "closedlost" doesn't matter; the call shape is the same.

### 2. Detect (`bin/detect.js`)

Groups observations by signature. Counts how many times each signature appears. If a signature crosses the promotion threshold (default: 5 calls), it becomes a candidate for proxy generation.

The detector also:
- Suggests a tool name based on the MCP server and operation
- Suggests which module file the tool should go in
- Collects up to 5 diverse example inputs
- Checks for name collisions with existing modules

### 3. Generate

When you run `/slim-evolve` in Claude Code, Claude reads the candidates and generates proxy modules. Claude uses the `_template.js` skeleton and `shared.js` utilities as patterns. It writes the new modules to `~/.mcp-slim/modules/`.

This is the key insight: every mcp-slim user already has Claude Code, so Claude IS the code generator. No separate LLM API call needed.

### 4. Validate (`bin/validate.js`)

Checks each generated module:
- Can it be imported? (valid JavaScript)
- Does it export `{ tools: [...], handlers: {...} }`?
- Does every tool have a handler?
- Does every handler have a tool definition?
- Are there name collisions with other modules?

If validation passes, the module is ready. Restart Claude Code and the new tools are live.
