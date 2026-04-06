/**
 * mcp-slim Example Module: Notion Task Database
 *
 * Proxies common Notion task operations. Instead of Claude parsing
 * 187,000-char JSON responses from the raw Notion MCP server, this
 * module calls the Notion API directly and returns clean markdown.
 *
 * SETUP:
 *   1. Copy this file to your modules directory (remove .example.js suffix)
 *   2. Set env vars:
 *      - NOTION_TOKEN: Your Notion integration token
 *      - NOTION_TASKS_DB: Database ID of your tasks database
 *   3. Customize property names below to match your database schema
 *
 * CUSTOMIZATION:
 *   - Property names ("Status", "Priority", "Assigned to") are workspace-specific
 *   - Edit extractTaskRow() to match your database columns
 *   - Edit the filter conditions to match your status/priority values
 */

import {
  notionFetch, notionQueryAll,
  extractTitle, extractSelect, extractStatus, extractRelation, extractRichText,
  mdTable, textResult, errorResult,
} from "./shared.js";

// ── Configuration ──────────────────────────────────────────────────────────

const TOKEN = process.env.NOTION_TOKEN;
const TASKS_DB = process.env.NOTION_TASKS_DB;

// Customize: map your priority values to sort order
const PRIORITY_ORDER = { "High": 0, "Medium": 1, "Low": 2 };

// ── Formatters ─────────────────────────────────────────────────────────────

// Customize: resolve relation IDs to names (areas, projects, etc.)
const nameCache = {};
async function resolvePageName(id) {
  if (nameCache[id]) return nameCache[id];
  try {
    const page = await notionFetch(`/pages/${id}`, TOKEN);
    const name = (page.properties?.Name?.title || page.properties?.title?.title || [])
      .map(t => t.plain_text).join("") || id.slice(0, 8);
    nameCache[id] = name;
    return name;
  } catch {
    return id.slice(0, 8);
  }
}

async function resolveRelationNames(relationIds) {
  if (!relationIds.length) return "-";
  const names = await Promise.all(relationIds.map(resolvePageName));
  return names.join(", ");
}

// NOTE: Resolves relation names with individual API calls (N+1 pattern).
// For large task lists, consider batch-resolving unique IDs upfront.

// Customize: edit these property names to match your Notion database
async function extractTaskRow(page) {
  const p = page.properties || {};
  return {
    id: page.id,
    name: extractTitle(p.Name) || "(untitled)",
    status: extractStatus(p.Status) || "-",
    priority: extractSelect(p.Priority) || "-",
    assignee: extractSelect(p["Assigned to"]) || "-",
    area: await resolveRelationNames(extractRelation(p.Area || p.Project || p.Category)),
  };
}

function sortByPriority(rows) {
  return rows.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    return pa - pb;
  });
}

async function taskTable(pages, limit = 30) {
  const extracted = await Promise.all(pages.map(extractTaskRow));
  const rows = sortByPriority(extracted).slice(0, limit);
  const headers = ["#", "Task", "Status", "Priority", "Assignee", "Area"];
  const tableRows = rows.map((r, i) => [
    i + 1,
    r.name.length > 70 ? r.name.slice(0, 67) + "..." : r.name,
    r.status,
    r.priority,
    r.assignee,
    r.area,
  ]);
  const summary = `**${pages.length} total tasks** (showing ${rows.length})`;
  return `${summary}\n\n${mdTable(headers, tableRows)}`;
}

// ── Notion block to markdown converter ─────────────────────────────────────

function blocksToMarkdown(blocks) {
  return blocks.map(b => {
    if (b.type === "paragraph") return (b.paragraph?.rich_text || []).map(t => t.plain_text).join("");
    if (b.type === "bulleted_list_item") return `- ${(b.bulleted_list_item?.rich_text || []).map(t => t.plain_text).join("")}`;
    if (b.type === "numbered_list_item") return `1. ${(b.numbered_list_item?.rich_text || []).map(t => t.plain_text).join("")}`;
    if (b.type === "to_do") return `- [${b.to_do?.checked ? "x" : " "}] ${(b.to_do?.rich_text || []).map(t => t.plain_text).join("")}`;
    if (b.type === "heading_1") return `# ${(b.heading_1?.rich_text || []).map(t => t.plain_text).join("")}`;
    if (b.type === "heading_2") return `## ${(b.heading_2?.rich_text || []).map(t => t.plain_text).join("")}`;
    if (b.type === "heading_3") return `### ${(b.heading_3?.rich_text || []).map(t => t.plain_text).join("")}`;
    if (b.type === "code") return `\`\`\`${b.code?.language || ""}\n${(b.code?.rich_text || []).map(t => t.plain_text).join("")}\n\`\`\``;
    if (b.type === "quote") return `> ${(b.quote?.rich_text || []).map(t => t.plain_text).join("")}`;
    if (b.type === "divider") return "---";
    return "";
  }).filter(Boolean).join("\n");
}

// ── Tool handlers ──────────────────────────────────────────────────────────

async function fetchTasks({ priority, assignee, status, limit = 30 } = {}) {
  if (!TOKEN || !TASKS_DB) return errorResult("NOTION_TOKEN and NOTION_TASKS_DB env vars required");

  // Customize: edit these filter conditions to match your status values
  const conditions = [];
  if (status) {
    conditions.push({ property: "Status", status: { equals: status } });
  } else {
    conditions.push({ property: "Status", status: { does_not_equal: "Done" } });
  }
  if (priority) conditions.push({ property: "Priority", select: { equals: priority } });
  if (assignee) conditions.push({ property: "Assigned to", select: { equals: assignee } });

  const filter = { and: conditions };
  const pages = await notionQueryAll(TASKS_DB, TOKEN, filter);
  return textResult(await taskTable(pages, limit));
}

async function fetchTaskDetail({ task_id } = {}) {
  if (!task_id) return errorResult("task_id is required");
  if (!TOKEN) return errorResult("NOTION_TOKEN env var required");

  const page = await notionFetch(`/pages/${task_id}`, TOKEN);
  const row = await extractTaskRow(page);

  // Fetch body content
  let body = "";
  try {
    const blocks = await notionFetch(`/blocks/${task_id}/children`, TOKEN);
    body = blocksToMarkdown(blocks.results || []);
  } catch { /* no body content */ }

  const lines = [
    `**${row.name}**`,
    `Status: ${row.status} | Priority: ${row.priority} | Assignee: ${row.assignee}`,
    `Area: ${row.area}`,
    `Page ID: ${task_id}`,
    body ? `\n---\n${body}` : null,
  ].filter(Boolean);

  return textResult(lines.join("\n"));
}

async function updateTaskStatus({ task_id, status, assigned_to } = {}) {
  if (!task_id) return errorResult("task_id is required");
  if (!status) return errorResult("status is required");
  if (!TOKEN) return errorResult("NOTION_TOKEN env var required");

  const properties = { Status: { status: { name: status } } };
  if (assigned_to) properties["Assigned to"] = { select: { name: assigned_to } };

  await notionFetch(`/pages/${task_id}`, TOKEN, { method: "PATCH", body: { properties } });

  const assignStr = assigned_to ? `, Assigned to: ${assigned_to}` : "";
  return textResult(`Updated task ${task_id.slice(0, 8)} to Status: ${status}${assignStr}`);
}

async function createTask({ name, status = "Not started", priority, body, assigned_to } = {}) {
  if (!name) return errorResult("name is required");
  if (!TOKEN || !TASKS_DB) return errorResult("NOTION_TOKEN and NOTION_TASKS_DB env vars required");

  const properties = {
    Name: { title: [{ text: { content: name } }] },
    Status: { status: { name: status } },
  };
  if (priority) properties.Priority = { select: { name: priority } };
  if (assigned_to) properties["Assigned to"] = { select: { name: assigned_to } };

  const pageBody = { parent: { database_id: TASKS_DB }, properties };
  const page = await notionFetch("/pages", TOKEN, { method: "POST", body: pageBody });

  if (body) {
    await notionFetch(`/blocks/${page.id}/children`, TOKEN, {
      method: "PATCH",
      body: {
        children: [{
          object: "block",
          type: "paragraph",
          paragraph: { rich_text: [{ type: "text", text: { content: body } }] },
        }],
      },
    });
  }

  return textResult(`Created task "${name}" (ID: ${page.id})`);
}

// ── Module export ──────────────────────────────────────────────────────────

export default {
  tools: [
    {
      name: "fetch_tasks",
      description: "Fetch active tasks from Notion. Returns a markdown table sorted by priority.",
      inputSchema: {
        type: "object",
        properties: {
          priority: { type: "string", description: "Filter by priority (e.g., High, Medium, Low)" },
          assignee: { type: "string", description: "Filter by assignee name" },
          status: { type: "string", description: "Filter by status (e.g., In progress, Not started)" },
          limit: { type: "number", description: "Max rows (default 30)" },
        },
      },
    },
    {
      name: "fetch_task_detail",
      description: "Fetch full details of a single task by page ID, including body content.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Notion page ID of the task" },
        },
        required: ["task_id"],
      },
    },
    {
      name: "update_task_status",
      description: "Update the status and/or assignee of a Notion task.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Notion page ID" },
          status: { type: "string", description: "New status value" },
          assigned_to: { type: "string", description: "New assignee (optional)" },
        },
        required: ["task_id", "status"],
      },
    },
    {
      name: "create_task",
      description: "Create a new task in the Notion tasks database.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Task title" },
          status: { type: "string", description: "Initial status (default: Not started)" },
          priority: { type: "string", description: "Priority level" },
          body: { type: "string", description: "Task description" },
          assigned_to: { type: "string", description: "Assignee name" },
        },
        required: ["name"],
      },
    },
  ],
  handlers: {
    fetch_tasks: fetchTasks,
    fetch_task_detail: fetchTaskDetail,
    update_task_status: updateTaskStatus,
    create_task: createTask,
  },
};
