/**
 * mcp-slim Example Module: HubSpot Deal Pipeline
 *
 * Proxies common HubSpot CRM operations. Instead of Claude parsing
 * 94,000-char JSON responses, this module returns clean markdown tables.
 *
 * SETUP:
 *   1. Copy this file to your modules directory (remove .example.js suffix)
 *   2. Set env vars:
 *      - HUBSPOT_TOKEN: Your HubSpot Private App access token
 *   3. Customize stage mappings and property lists below
 *
 * CUSTOMIZATION:
 *   - STAGES: Map your pipeline stage IDs to human-readable names
 *     (Find stage IDs via HubSpot Settings > Objects > Deals > Pipelines)
 *   - DEAL_PROPERTIES: Which deal properties to fetch
 *   - formatDealRow(): How each deal appears in the table
 */

import { hubspotFetch, hubspotSearchAll, resolveHubspotOwners, mdTable, textResult, errorResult } from "./shared.js";

// ── Configuration ──────────────────────────────────────────────────────────

const TOKEN = process.env.HUBSPOT_TOKEN;

// Customize: map your pipeline stage internal IDs to display names.
// Find these in HubSpot Settings > Objects > Deals > Pipelines.
// Example stages shown below; replace with your own.
const STAGES = {
  "appointmentscheduled": "Qualified",
  "qualifiedtobuy": "Proposal",
  "contractsent": "Contract Sent",
  "closedwon": "Closed Won",
  "closedlost": "Closed Lost",
};

// Customize: which deal properties to fetch from HubSpot
const DEAL_PROPERTIES = [
  "dealname", "dealstage", "amount", "hubspot_owner_id",
  "closedate", "notes_last_contacted", "createdate",
];

let ownersMap = null;

// ── Formatters ─────────────────────────────────────────────────────────────

function resolveStageName(stageId) {
  return STAGES[stageId] || stageId || "-";
}

async function ensureOwners() {
  if (!ownersMap) ownersMap = await resolveHubspotOwners(TOKEN);
  return ownersMap;
}

function resolveOwner(owners, ownerId) {
  return owners[ownerId] || ownerId || "-";
}

function formatDealRow(deal, owners) {
  const p = deal.properties || {};
  return [
    (p.dealname || "(unnamed)").slice(0, 50),
    resolveStageName(p.dealstage),
    p.amount ? `$${Number(p.amount).toLocaleString()}` : "-",
    resolveOwner(owners, p.hubspot_owner_id),
    p.notes_last_contacted ? p.notes_last_contacted.slice(0, 10) : "-",
  ];
}

// ── Tool handlers ──────────────────────────────────────────────────────────

async function fetchPipelineSummary({ stage, owner } = {}) {
  if (!TOKEN) return errorResult("HUBSPOT_TOKEN env var required");

  const owners = await ensureOwners();
  const filters = [];
  if (stage) {
    const stageId = Object.entries(STAGES).find(([, n]) => n.toLowerCase() === stage.toLowerCase())?.[0];
    if (stageId) filters.push({ propertyName: "dealstage", operator: "EQ", value: stageId });
  }
  if (owner) {
    const ownerId = Object.entries(owners).find(([, n]) => n.toLowerCase().includes(owner.toLowerCase()))?.[0];
    if (ownerId) filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId });
  }

  const deals = await hubspotSearchAll("deals", TOKEN, {
    filters,
    properties: DEAL_PROPERTIES,
    limit: 100,
    maxPages: 3,
  });

  // Group by stage
  const byStage = {};
  for (const deal of deals) {
    const stageName = resolveStageName(deal.properties?.dealstage);
    if (!byStage[stageName]) byStage[stageName] = { count: 0, value: 0 };
    byStage[stageName].count++;
    byStage[stageName].value += Number(deal.properties?.amount || 0);
  }

  const summaryRows = Object.entries(byStage).map(([name, data]) => [
    name, data.count, `$${data.value.toLocaleString()}`,
  ]);
  const totalValue = deals.reduce((sum, d) => sum + Number(d.properties?.amount || 0), 0);
  const summary = `**${deals.length} deals, $${totalValue.toLocaleString()} total pipeline value**`;
  const table = mdTable(["Stage", "Count", "Value"], summaryRows);

  // Top deals
  const dealRows = deals
    .sort((a, b) => Number(b.properties?.amount || 0) - Number(a.properties?.amount || 0))
    .slice(0, 20)
    .map(d => formatDealRow(d, owners));
  const dealTable = mdTable(["Deal", "Stage", "Amount", "Owner", "Last Contacted"], dealRows);

  return textResult(`${summary}\n\n${table}\n\n---\n\n**Top deals:**\n\n${dealTable}`);
}

async function fetchDeals({ stage, owner, min_amount, days_since_activity, limit = 30 } = {}) {
  if (!TOKEN) return errorResult("HUBSPOT_TOKEN env var required");

  const owners = await ensureOwners();
  const filters = [];
  if (stage) {
    const stageId = Object.entries(STAGES).find(([, n]) => n.toLowerCase() === stage.toLowerCase())?.[0];
    if (stageId) filters.push({ propertyName: "dealstage", operator: "EQ", value: stageId });
  }
  if (owner) {
    const ownerId = Object.entries(owners).find(([, n]) => n.toLowerCase().includes(owner.toLowerCase()))?.[0];
    if (ownerId) filters.push({ propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId });
  }
  if (min_amount) {
    filters.push({ propertyName: "amount", operator: "GTE", value: String(min_amount) });
  }

  const deals = await hubspotSearchAll("deals", TOKEN, {
    filters,
    properties: DEAL_PROPERTIES,
    limit: Math.min(limit, 100),
  });

  let filtered = deals;
  if (days_since_activity) {
    const cutoff = new Date(Date.now() - days_since_activity * 86400000).toISOString().slice(0, 10);
    filtered = deals.filter(d => {
      const lastContact = d.properties?.notes_last_contacted;
      return !lastContact || lastContact < cutoff;
    });
  }

  const rows = filtered
    .sort((a, b) => Number(b.properties?.amount || 0) - Number(a.properties?.amount || 0))
    .slice(0, limit)
    .map(d => formatDealRow(d, owners));

  const summary = `**${filtered.length} deals**${days_since_activity ? ` (inactive ${days_since_activity}+ days)` : ""}`;
  return textResult(`${summary}\n\n${mdTable(["Deal", "Stage", "Amount", "Owner", "Last Contacted"], rows)}`);
}

async function fetchDealNotes({ deal_id } = {}) {
  if (!deal_id) return errorResult("deal_id is required");
  if (!TOKEN) return errorResult("HUBSPOT_TOKEN env var required");

  const assocData = await hubspotFetch(`/crm/v4/objects/deals/${deal_id}/associations/notes`, TOKEN);
  const noteIds = (assocData.results || []).map(r => r.toObjectId);

  if (!noteIds.length) return textResult(`No notes found for deal ${deal_id}`);

  const batchData = await hubspotFetch("/crm/v3/objects/notes/batch/read", TOKEN, {
    method: "POST",
    body: {
      inputs: noteIds.slice(0, 20).map(id => ({ id: String(id) })),
      properties: ["hs_note_body", "hs_timestamp", "hubspot_owner_id"],
    },
  });

  const owners = await ensureOwners();
  const notes = (batchData.results || [])
    .sort((a, b) => (b.properties?.hs_timestamp || "").localeCompare(a.properties?.hs_timestamp || ""));

  const rows = notes.map(n => {
    const p = n.properties || {};
    const body = (p.hs_note_body || "").replace(/<[^>]*>/g, "").slice(0, 120);
    return [
      p.hs_timestamp ? p.hs_timestamp.slice(0, 10) : "-",
      resolveOwner(owners, p.hubspot_owner_id),
      body || "(empty)",
    ];
  });

  return textResult(`**${notes.length} notes** for deal ${deal_id}\n\n${mdTable(["Date", "Owner", "Note"], rows)}`);
}

// ── Module export ──────────────────────────────────────────────────────────

export default {
  tools: [
    {
      name: "fetch_pipeline_summary",
      description: "HubSpot pipeline summary: deal counts and values by stage, plus top deals list.",
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", description: "Filter by stage name" },
          owner: { type: "string", description: "Filter by owner name" },
        },
      },
    },
    {
      name: "fetch_deals",
      description: "HubSpot deal list with optional filters. Returns markdown table sorted by amount.",
      inputSchema: {
        type: "object",
        properties: {
          stage: { type: "string", description: "Filter by stage name" },
          owner: { type: "string", description: "Filter by owner name" },
          min_amount: { type: "number", description: "Minimum deal amount" },
          days_since_activity: { type: "number", description: "Show deals inactive for N+ days" },
          limit: { type: "number", description: "Max rows (default 30)" },
        },
      },
    },
    {
      name: "fetch_deal_notes",
      description: "Fetch notes attached to a HubSpot deal. Returns date, owner, and note body.",
      inputSchema: {
        type: "object",
        properties: {
          deal_id: { type: "string", description: "HubSpot deal ID" },
        },
        required: ["deal_id"],
      },
    },
  ],
  handlers: {
    fetch_pipeline_summary: fetchPipelineSummary,
    fetch_deals: fetchDeals,
    fetch_deal_notes: fetchDealNotes,
  },
};
