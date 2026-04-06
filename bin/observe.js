/**
 * Session observer for mcp-slim self-learning.
 *
 * Scans Claude Code session JSONL files, extracts raw MCP tool calls
 * (anything mcp__* that isn't mcp__mcp-slim__*), normalizes them into
 * canonical signatures, and appends observations to observations.jsonl.
 */

import { readdir, readFile, stat, appendFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

const HOME_DIR = join(homedir(), ".mcp-slim");
const OBSERVATIONS_PATH = join(HOME_DIR, "observations.jsonl");
const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
const PROXY_PREFIX = process.env.MCP_SLIM_PROXY_NAME || "mcp-slim";
const DEFAULT_LOOKBACK_DAYS = 30;

// ── Signature Normalization ────────────────────────────────────────────────

function extractMcpServer(toolName) {
  const parts = toolName.split("__");
  return parts[1] || "unknown";
}

function extractRawTool(toolName) {
  const parts = toolName.split("__");
  return parts[2] || toolName;
}

function extractNotionFilterProps(filterObj) {
  const props = [];
  if (!filterObj || typeof filterObj !== "object") return props;
  if (filterObj.property) props.push(filterObj.property);
  for (const compound of ["and", "or"]) {
    if (Array.isArray(filterObj[compound])) {
      for (const sub of filterObj[compound]) {
        props.push(...extractNotionFilterProps(sub));
      }
    }
  }
  return props;
}

function normalizeSignature(toolName, inputParams) {
  const server = extractMcpServer(toolName);
  const rawTool = extractRawTool(toolName);
  const params = inputParams || {};

  // HubSpot search: key on objectType + filter propertyNames
  if (rawTool === "hubspot-search-objects") {
    const objType = params.objectType || "unknown";
    const filterParts = [];
    for (const fg of params.filterGroups || []) {
      for (const f of fg.filters || []) {
        filterParts.push(`${f.propertyName || "?"}.${f.operator || "?"}`);
      }
    }
    filterParts.sort();
    const props = Array.from(params.properties || []).sort();
    return `${server}:${rawTool}:obj=${objType},filters=[${filterParts.join(",")}],props=[${props.join(",")}]`;
  }

  // HubSpot list/batch-read: key on objectType
  if (rawTool === "hubspot-list-objects" || rawTool === "hubspot-batch-read-objects") {
    const objType = params.objectType || "unknown";
    const props = Array.from(params.properties || []).sort();
    return `${server}:${rawTool}:obj=${objType},props=[${props.join(",")}]`;
  }

  // HubSpot get-*: key on param keys
  if (rawTool.startsWith("hubspot-get-")) {
    return `${server}:${rawTool}:keys=[${Object.keys(params).sort().join(",")}]`;
  }

  // HubSpot list-associations
  if (rawTool === "hubspot-list-associations") {
    return `${server}:${rawTool}:from=${params.fromObjectType || "?"},to=${params.toObjectType || "?"}`;
  }

  // Notion query/search
  if (rawTool === "API-query-data-source" || rawTool === "API-post-search") {
    const dsId = params.data_source_id ? params.data_source_id.slice(0, 8) : "search";
    const filterProps = extractNotionFilterProps(params.filter || {}).sort();
    return `${server}:${rawTool}:ds=${dsId},filters=[${filterProps.join(",")}]`;
  }

  // Notion single-resource reads
  if (rawTool.startsWith("API-retrieve-") || rawTool === "API-get-block-children" || rawTool === "API-get-self") {
    return `${server}:${rawTool}:keys=[${Object.keys(params).sort().join(",")}]`;
  }

  // Generic: key on tool name + sorted param keys
  return `${server}:${rawTool}:keys=[${Object.keys(params).sort().join(",")}]`;
}

// ── Session Scanning ───────────────────────────────────────────────────────

async function loadExistingIds() {
  const ids = new Set();
  if (!existsSync(OBSERVATIONS_PATH)) return ids;
  const content = await readFile(OBSERVATIONS_PATH, "utf8");
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obs = JSON.parse(line);
      if (obs.id) ids.add(obs.id);
    } catch { /* skip malformed lines */ }
  }
  return ids;
}

async function findSessionFiles(lookbackDays) {
  const cutoff = Date.now() - (lookbackDays * 86400000);
  const allFiles = [];

  if (!existsSync(CLAUDE_PROJECTS_DIR)) return allFiles;

  // Scan all project directories
  let projectDirs;
  try {
    projectDirs = await readdir(CLAUDE_PROJECTS_DIR);
  } catch { return allFiles; }

  for (const dir of projectDirs) {
    const projectPath = join(CLAUDE_PROJECTS_DIR, dir);
    let files;
    try {
      files = await readdir(projectPath);
    } catch { continue; }

    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const filePath = join(projectPath, f);
      try {
        const s = await stat(filePath);
        if (s.mtimeMs >= cutoff) {
          allFiles.push({ path: filePath, mtime: s.mtime });
        }
      } catch { continue; }
    }
  }

  return allFiles.sort((a, b) => b.mtime - a.mtime);
}

async function scanSessions(lookbackDays, excludedTools = new Set()) {
  const files = await findSessionFiles(lookbackDays);
  const existingIds = await loadExistingIds();
  const observations = [];

  for (const { path: filePath, mtime } of files) {
    const sessionId = basename(filePath, ".jsonl").slice(0, 8);
    let content;
    try {
      content = await readFile(filePath, "utf8");
    } catch { continue; }

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch { continue; }

      if (obj.type !== "assistant") continue;

      const blocks = obj.message?.content || [];
      for (const block of blocks) {
        if (typeof block !== "object" || block.type !== "tool_use") continue;

        const name = block.name || "";
        if (!name.startsWith("mcp__")) continue;
        if (name.startsWith(`mcp__${PROXY_PREFIX}__`)) continue;
        if (excludedTools.has(name)) continue;

        const inputParams = block.input || {};
        const toolId = block.id || `${sessionId}-${name}-${JSON.stringify(inputParams).slice(0, 100)}`;
        if (existingIds.has(toolId)) continue;
        const signature = normalizeSignature(name, inputParams);

        observations.push({
          id: toolId,
          session: sessionId,
          timestamp: mtime.toISOString(),
          tool: name,
          mcp_server: extractMcpServer(name),
          raw_tool: extractRawTool(name),
          signature,
          input: inputParams,
        });
        existingIds.add(toolId);
      }
    }
  }

  return observations;
}

// ── Output ─────────────────────────────────────────────────────────────────

async function appendObservations(observations) {
  await mkdir(HOME_DIR, { recursive: true });
  const lines = observations.map(obs => JSON.stringify(obs)).join("\n");
  if (lines) await appendFile(OBSERVATIONS_PATH, lines + "\n");
}

function printSummary(observations) {
  if (!observations.length) {
    console.log("No new raw MCP calls observed.");
    return;
  }

  const toolCounts = {};
  const sigCounts = {};
  for (const obs of observations) {
    toolCounts[obs.tool] = (toolCounts[obs.tool] || 0) + 1;
    sigCounts[obs.signature] = (sigCounts[obs.signature] || 0) + 1;
  }

  console.log(`**${observations.length} new raw MCP observations**\n`);

  console.log("By tool:");
  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(4)}  ${tool}`);
  }

  console.log(`\n${Object.keys(sigCounts).length} unique signatures`);

  const topSigs = Object.entries(sigCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (topSigs.length) {
    console.log("\nTop signatures:");
    for (const [sig, count] of topSigs) {
      console.log(`  ${String(count).padStart(4)}  ${sig}`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function runObserver({ lookbackDays = DEFAULT_LOOKBACK_DAYS, excludedTools = new Set() } = {}) {
  const observations = await scanSessions(lookbackDays, excludedTools);
  await appendObservations(observations);
  printSummary(observations);
  return observations;
}
