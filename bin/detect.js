/**
 * Pattern detector for mcp-slim self-learning.
 *
 * Reads observations.jsonl, groups by canonical signature, checks against
 * a configurable promotion threshold, and outputs promotion candidates.
 */

import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { pathToFileURL } from "url";

const HOME_DIR = join(homedir(), ".mcp-slim");
const OBSERVATIONS_PATH = join(HOME_DIR, "observations.jsonl");
const DEFAULT_THRESHOLD = 5;
const DEFAULT_LOOKBACK_DAYS = 30;

// ── Existing Tool Detection ────────────────────────────────────────────────

async function getExistingToolNames(modulesDir) {
  const tools = new Set();
  if (!modulesDir || !existsSync(modulesDir)) return tools;

  let files;
  try {
    files = await readdir(modulesDir);
  } catch { return tools; }

  for (const f of files) {
    if (!f.endsWith(".js") || f.startsWith("_") || f.endsWith(".example.js") || f === "shared.js") continue;
    try {
      const mod = await import(pathToFileURL(join(modulesDir, f)).href);
      const modTools = mod.default?.tools || [];
      for (const t of modTools) {
        if (t && t.name) tools.add(t.name);
      }
    } catch { continue; }
  }
  return tools;
}

// ── Name Suggestion ────────────────────────────────────────────────────────

function suggestToolName(signature, mcpServer, rawTool) {
  const parts = signature.split(":");

  // HubSpot search
  if (rawTool === "hubspot-search-objects" && parts.length >= 3) {
    const objMatch = parts[2].split(",")[0];
    const objType = objMatch.includes("=") ? objMatch.split("=")[1] : "objects";
    const prefix = mcpServer.includes("peopleops") ? "peopleops_" : "";
    return `fetch_${prefix}${objType}_search`;
  }

  // HubSpot list
  if (rawTool === "hubspot-list-objects" && parts.length >= 3) {
    const objMatch = parts[2].split(",")[0];
    const objType = objMatch.includes("=") ? objMatch.split("=")[1] : "objects";
    const prefix = mcpServer.includes("peopleops") ? "peopleops_" : "";
    return `fetch_${prefix}${objType}_list`;
  }

  // Notion query
  if (rawTool === "API-query-data-source" || rawTool === "API-post-search") {
    const prefix = mcpServer === "notion-cc" ? "cc_" : "";
    const dsId = parts.length >= 3 ? parts[2].split(",")[0].split("=")[1] || "data" : "data";
    return `fetch_${prefix}query_${dsId}`;
  }

  // Granola
  if (mcpServer.includes("granola")) return `fetch_granola_${rawTool}`;

  // Slack
  if (mcpServer.includes("slack")) return `fetch_slack_${rawTool.replace("slack_", "")}`;

  // Teams
  if (mcpServer.includes("teams")) return `fetch_teams_${rawTool}`;

  // Google
  if (mcpServer.includes("gws")) {
    const variant = mcpServer.includes("personal") ? "personal" : "cc";
    return `fetch_gws_${variant}_${rawTool.replace("gws_", "")}`;
  }

  // Generic
  return `fetch_${mcpServer}_${rawTool}`.replace(/-/g, "_");
}

function suggestTargetModule(mcpServer) {
  const map = {
    "hubspot": "hubspot.js",
    "notion-personal": "notion.js",
    "notion-cc": "notion-cc.js",
  };
  return map[mcpServer] || `${mcpServer}.js`;
}

// ── Detection Logic ────────────────────────────────────────────────────────

export async function runDetector({ threshold = DEFAULT_THRESHOLD, lookbackDays = DEFAULT_LOOKBACK_DAYS, json = false, modulesDir } = {}) {
  if (!existsSync(OBSERVATIONS_PATH)) {
    if (json) {
      console.log("[]");
    } else {
      console.log("No observations file found. Run `mcp-slim observe` first.");
    }
    return [];
  }

  // Load observations
  const content = await readFile(OBSERVATIONS_PATH, "utf8");
  const observations = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      observations.push(JSON.parse(line));
    } catch { continue; }
  }

  // Filter by lookback window
  const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const filtered = observations.filter(obs => obs.timestamp >= cutoff);

  if (!filtered.length) {
    if (json) console.log("[]");
    else console.log("No observations found.");
    return [];
  }

  // Group by signature
  const sigGroups = {};
  for (const obs of filtered) {
    if (!sigGroups[obs.signature]) sigGroups[obs.signature] = [];
    sigGroups[obs.signature].push(obs);
  }

  // Get existing tools for collision check
  const existingTools = await getExistingToolNames(modulesDir);

  // Find candidates above threshold
  const candidates = [];
  for (const [signature, obsList] of Object.entries(sigGroups)) {
    if (obsList.length < threshold) continue;

    const sample = obsList[0];
    const suggestedName = suggestToolName(signature, sample.mcp_server, sample.raw_tool);

    // Skip if name collides
    if (existingTools.has(suggestedName)) continue;

    // Collect diverse examples
    const examples = [];
    const seenInputs = new Set();
    for (const obs of obsList) {
      const hash = JSON.stringify(obs.input, Object.keys(obs.input).sort());
      if (!seenInputs.has(hash)) {
        seenInputs.add(hash);
        examples.push(obs.input);
        if (examples.length >= 5) break;
      }
    }

    const targetModule = suggestTargetModule(sample.mcp_server);
    candidates.push({
      signature,
      mcp_server: sample.mcp_server,
      raw_tool: sample.raw_tool,
      call_count: obsList.length,
      suggested_name: suggestedName,
      target_module: targetModule,
      is_new_module: modulesDir ? !existsSync(join(modulesDir, targetModule)) : true,
      example_inputs: examples,
      sessions: [...new Set(obsList.map(o => o.session))].slice(0, 10),
    });
  }

  // Sort by call count
  candidates.sort((a, b) => b.call_count - a.call_count);

  if (json) {
    console.log(JSON.stringify(candidates, null, 2));
  } else {
    if (!candidates.length) {
      console.log(`No patterns above threshold (${threshold}). ${Object.keys(sigGroups).length} unique signatures observed.`);
    } else {
      console.log(`**${candidates.length} promotion candidates** (threshold: ${threshold})\n`);
      for (const c of candidates) {
        const newTag = c.is_new_module ? " [NEW MODULE]" : "";
        console.log(`  ${String(c.call_count).padStart(4)} calls | ${c.suggested_name}`);
        console.log(`         | ${c.signature}`);
        console.log(`         | -> ${c.target_module}${newTag}`);
        console.log(`         | ${c.example_inputs.length} unique input shapes, ${c.sessions.length} sessions`);
        console.log();
      }
    }
  }

  return candidates;
}
