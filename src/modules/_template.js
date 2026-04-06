/**
 * mcp-slim Module Template
 *
 * Copy this file, rename it (e.g., my-api.js), and customize.
 * Drop the file in your modules directory and restart mcp-slim.
 * It will be auto-discovered and loaded.
 *
 * MODULE CONTRACT:
 * Every module must export a default object with:
 *   - tools: Array of MCP tool definitions
 *   - handlers: Object mapping tool names to async handler functions
 *
 * NAMING CONVENTIONS:
 *   - Tool names use snake_case: fetch_tasks, fetch_deal_detail
 *   - Read tools start with "fetch_": fetch_inbox, fetch_pipeline
 *   - Write tools start with "update_" or "create_": update_status, create_task
 *
 * RESPONSE FORMAT:
 *   - Always return textResult(markdown) or errorResult(message)
 *   - Use mdTable() for tabular data
 *   - Keep responses under 2,000 characters when possible
 *   - Strip unnecessary fields; include only what Claude needs to answer the user
 */

import { apiFetch, mdTable, textResult, errorResult } from "./shared.js";

// ── Configuration ──────────────────────────────────────────────────────────
// Read API tokens and workspace-specific IDs from environment variables.
// Never hardcode secrets or workspace IDs in module files.

const TOKEN = process.env.MY_API_TOKEN;
const DATABASE_ID = process.env.MY_DATABASE_ID;

// ── Handlers ───────────────────────────────────────────────────────────────

async function fetchItems({ filter, limit = 20 } = {}) {
  if (!TOKEN) return errorResult("MY_API_TOKEN env var is required");

  // Call your API directly (not through the raw MCP server)
  const data = await apiFetch("https://api.example.com/v1", "/items", TOKEN, {
    method: "POST",
    body: { filter, limit },
  });

  // Extract only the fields Claude needs
  const rows = (data.results || []).slice(0, limit).map((item, i) => [
    i + 1,
    item.name || "(unnamed)",
    item.status || "-",
    item.created_at?.slice(0, 10) || "-",
  ]);

  // Format as markdown table (this is what Claude reads)
  const summary = `**${data.results?.length || 0} items**`;
  return textResult(`${summary}\n\n${mdTable(["#", "Name", "Status", "Created"], rows)}`);
}

async function fetchItemDetail({ item_id } = {}) {
  if (!item_id) return errorResult("item_id is required");
  if (!TOKEN) return errorResult("MY_API_TOKEN env var is required");

  const item = await apiFetch("https://api.example.com/v1", `/items/${item_id}`, TOKEN);

  // Format as readable text (not raw JSON)
  const lines = [
    `**${item.name || "(unnamed)"}**`,
    `Status: ${item.status || "-"}`,
    `Created: ${item.created_at || "-"}`,
    item.description ? `\n${item.description}` : null,
  ].filter(Boolean);

  return textResult(lines.join("\n"));
}

// ── Module Export ──────────────────────────────────────────────────────────
// The tools array defines what Claude sees. The handlers object maps
// tool names to the functions above. Every tool must have a handler.

export default {
  tools: [
    {
      name: "fetch_items",
      description: "Fetch items from My API. Returns a markdown table with name, status, and creation date.",
      inputSchema: {
        type: "object",
        properties: {
          filter: { type: "string", description: "Filter expression" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
    },
    {
      name: "fetch_item_detail",
      description: "Fetch full details of a single item by ID.",
      inputSchema: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "Item ID" },
        },
        required: ["item_id"],
      },
    },
  ],
  handlers: {
    fetch_items: fetchItems,
    fetch_item_detail: fetchItemDetail,
  },
};
