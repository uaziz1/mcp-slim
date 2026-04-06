/**
 * mcp-slim server -- Dynamic module discovery MCP proxy.
 *
 * Auto-loads every .js file in the modules directory (except shared.js,
 * _-prefixed files, and .example.js files). Drop a new module file in
 * the directory and it's available on next server start.
 *
 * Each module must export: { tools: [...], handlers: {...} }
 */

import { readdir } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const SKIP = new Set(["shared.js"]);

export async function startServer(modulesDir, { name = "mcp-slim", version = "0.1.0" } = {}) {
  // Dynamic module discovery
  let files;
  try {
    files = (await readdir(modulesDir))
      .filter(f => f.endsWith(".js") && !f.startsWith("_") && !f.endsWith(".example.js") && !SKIP.has(f))
      .sort();
  } catch {
    files = [];
  }

  const modules = [];
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(join(modulesDir, f)).href);
      modules.push(mod.default);
    } catch (err) {
      console.error(`[mcp-slim] Failed to load module ${f}: ${err.message}`);
    }
  }

  const allTools = modules.flatMap(m => m.tools || []);

  const seenTools = new Set();
  for (const tool of allTools) {
    if (seenTools.has(tool.name)) {
      console.error(`[mcp-slim] WARNING: duplicate tool name "${tool.name}" — last loaded module wins`);
    }
    seenTools.add(tool.name);
  }

  const allHandlers = Object.assign({}, ...modules.map(m => m.handlers || {}));

  console.error(`[mcp-slim] Loaded ${modules.length} modules, ${allTools.length} tools`);

  // MCP Server
  const server = new Server(
    { name, version },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: allTools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: params } = request.params;
    const handler = allHandlers[toolName];
    if (!handler) {
      return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true };
    }
    try {
      return await handler(params || {});
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
