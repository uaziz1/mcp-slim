# Writing Modules

This guide is for power users who want to write proxy modules directly, bypassing the self-learning loop.

## The Module Contract

Every module is a single `.js` file that exports:

```javascript
export default {
  tools: [/* MCP tool definitions */],
  handlers: {/* tool_name: async handler function */},
};
```

That's it. Drop the file in your modules directory, restart mcp-slim, and the tools are live.

## Step by Step

### 1. Copy the template

```bash
cp ~/.mcp-slim/repo/src/modules/_template.js ~/.mcp-slim/modules/my-service.js
```

### 2. Configure authentication

```javascript
const TOKEN = process.env.MY_SERVICE_TOKEN;
```

Always use environment variables. Never hardcode tokens.

### 3. Write a handler

```javascript
import { apiFetch, mdTable, textResult, errorResult } from "./shared.js";

async function fetchItems({ filter, limit = 20 } = {}) {
  if (!TOKEN) return errorResult("MY_SERVICE_TOKEN env var required");

  // Call the API directly
  const data = await apiFetch("https://api.example.com/v1", "/items", TOKEN, {
    method: "GET",
  });

  // Extract only what Claude needs
  const rows = data.items.slice(0, limit).map((item, i) => [
    i + 1,
    item.name.slice(0, 50),
    item.status,
    item.updated_at?.slice(0, 10) || "-",
  ]);

  // Return markdown, not JSON
  return textResult(`**${data.items.length} items**\n\n${mdTable(["#", "Name", "Status", "Updated"], rows)}`);
}
```

### 4. Define the tool

```javascript
export default {
  tools: [
    {
      name: "fetch_items",
      description: "Fetch items from My Service. Returns a markdown table.",
      inputSchema: {
        type: "object",
        properties: {
          filter: { type: "string", description: "Filter expression" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
    },
  ],
  handlers: {
    fetch_items: fetchItems,
  },
};
```

### 5. Validate

```bash
mcp-slim validate
```

### 6. Add env vars

Add the API token to your `.mcp.json`:

```json
{
  "mcpServers": {
    "mcp-slim": {
      "command": "npx",
      "args": ["-y", "@uaziz1/mcp-slim"],
      "env": {
        "MCP_SLIM_MODULES": "~/.mcp-slim/modules",
        "MY_SERVICE_TOKEN": "your-token-here"
      }
    }
  }
}
```

## Key Principles

### Return markdown, not JSON

The whole point of mcp-slim is to reduce response size. Your handler should:
- Call the API and get JSON
- Extract the 3-5 fields that matter
- Format as a markdown table or text
- Return via `textResult()`

Bad (defeats the purpose):
```javascript
return textResult(JSON.stringify(data, null, 2));
```

Good:
```javascript
const rows = data.results.map(r => [r.name, r.status, r.amount]);
return textResult(mdTable(["Name", "Status", "Amount"], rows));
```

### Keep responses under 2,000 characters

This is the sweet spot. Enough data for Claude to answer the question, small enough to save 99%+ on tokens.

### Use shared utilities

Don't build your own fetch wrappers. Use what's in `shared.js`:

- `apiFetch()` for any REST API with bearer tokens
- `notionFetch()` / `notionQueryAll()` for Notion
- `hubspotFetch()` / `hubspotSearchAll()` for HubSpot
- `msGraphFetch()` for Microsoft Graph (Teams, Outlook, OneDrive)
- `googleFetch()` / `gmailFetch()` / `calendarFetch()` for Google APIs

### Handle errors gracefully

```javascript
if (!TOKEN) return errorResult("MY_TOKEN env var required");
```

### One module per service

Keep modules focused. One file per API/service. The filename should be descriptive: `notion.js`, `hubspot.js`, `slack.js`.

## Available Utilities Reference

### API Wrappers

| Function | API | Auth |
|----------|-----|------|
| `apiFetch(baseUrl, path, token, opts)` | Any REST API | Bearer token |
| `notionFetch(path, token, opts)` | Notion | Integration token |
| `notionQueryAll(dbId, token, filter, opts)` | Notion DB query | Paginated |
| `hubspotFetch(path, token, opts)` | HubSpot | Private App token |
| `hubspotSearchAll(type, token, opts)` | HubSpot search | Paginated |
| `msGraphFetch(path, params, opts)` | Microsoft Graph | MSAL cache |
| `googleFetch(base, path, account, params)` | Google APIs | OAuth refresh |
| `gmailFetch(path, account, params)` | Gmail | Convenience |
| `calendarFetch(path, account, params)` | Calendar | Convenience |

### Notion Extractors

| Function | Input | Output |
|----------|-------|--------|
| `extractTitle(prop)` | `{"type":"title","title":[...]}` | `"My Task"` |
| `extractSelect(prop)` | `{"type":"select","select":{"name":"High"}}` | `"High"` |
| `extractStatus(prop)` | `{"type":"status","status":{"name":"Done"}}` | `"Done"` |
| `extractRelation(prop)` | `{"type":"relation","relation":[{"id":"..."}]}` | `["abc123"]` |
| `extractRichText(prop)` | `{"type":"rich_text","rich_text":[...]}` | `"Plain text"` |
| `extractDate(prop)` | `{"type":"date","date":{"start":"2026-01-15"}}` | `"2026-01-15"` |
| `extractMultiSelect(prop)` | `{"type":"multi_select",...}` | `["Tag1","Tag2"]` |
| `extractNumber(prop)` | `{"type":"number","number":42}` | `42` |

### Formatters

| Function | Purpose |
|----------|---------|
| `mdTable(headers, rows)` | Build markdown table from arrays |
| `textResult(text)` | Wrap text in MCP response format |
| `errorResult(msg)` | Wrap error in MCP response format |
| `resolveHubspotOwners(token)` | Cached owner name lookup |
