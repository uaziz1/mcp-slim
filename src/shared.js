/**
 * mcp-slim shared utilities.
 *
 * API fetch wrappers, property extractors, and markdown formatters.
 * These are the building blocks for proxy modules. Claude Code also
 * reads this file when generating new modules via /slim-evolve.
 */

// ── Generic REST API wrapper ───────────────────────────────────────────────

/**
 * Generic authenticated REST API call. Returns parsed JSON.
 * All service-specific wrappers (Notion, HubSpot, etc.) build on this.
 *
 * @param {string} baseUrl - API base URL (e.g., "https://api.notion.com/v1")
 * @param {string} path - API path (e.g., "/databases/abc/query")
 * @param {string} token - Bearer token
 * @param {object} options - { method, body, headers }
 */
export async function apiFetch(baseUrl, path, token, { method = "GET", body, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`API ${res.status}: non-JSON response from ${path} — ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${data.message || data.error?.message || JSON.stringify(data)}`);
  return data;
}

// ── Notion API helpers ─────────────────────────────────────────────────────

/**
 * Call the Notion API. Token is passed explicitly so modules can
 * support multiple Notion workspaces.
 */
export async function notionFetch(path, token, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Notion ${res.status}: non-JSON response from ${path} — ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`Notion ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

/**
 * Query a Notion database with automatic pagination.
 * Returns all results up to maxPages * pageSize.
 */
export async function notionQueryAll(databaseId, token, filter = undefined, { pageSize = 100, maxPages = 3, sorts } = {}) {
  const results = [];
  let cursor = undefined;

  for (let page = 0; page < maxPages; page++) {
    const body = { page_size: pageSize };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    if (cursor) body.start_cursor = cursor;

    const data = await notionFetch(`/databases/${databaseId}/query`, token, { method: "POST", body });
    results.push(...(data.results || []));

    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }

  return results;
}

// ── HubSpot API helpers ────────────────────────────────────────────────────

/**
 * Call the HubSpot API. Token is a Private App access token.
 */
export async function hubspotFetch(path, token, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`HubSpot ${res.status}: non-JSON response from ${path} — ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`HubSpot ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

/**
 * Search HubSpot objects with automatic pagination.
 */
export async function hubspotSearchAll(objectType, token, { filters = [], properties = [], limit = 100, maxPages = 3, sorts } = {}) {
  const results = [];
  let after = 0;

  for (let page = 0; page < maxPages; page++) {
    const body = {
      filterGroups: filters.length ? [{ filters }] : [],
      properties,
      limit: Math.min(limit, 100),
      after,
    };
    if (sorts) body.sorts = sorts;

    const data = await hubspotFetch(`/crm/v3/objects/${objectType}/search`, token, { method: "POST", body });
    results.push(...(data.results || []));

    if (!data.paging?.next?.after) break;
    after = data.paging.next.after;
  }

  return results;
}

// ── Microsoft Graph helpers ────────────────────────────────────────────────

import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MS_CACHE_PATH = process.env.MS_TOKEN_CACHE_PATH || join(homedir(), ".teams-mcp-token-cache.json");
const MS_CLIENT_ID = process.env.MS_CLIENT_ID || "";
const MS_AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

let msTokenCache = { accessToken: null, expiresAt: 0 };

async function getMsGraphToken() {
  if (msTokenCache.accessToken && Date.now() < msTokenCache.expiresAt - 120_000) {
    return msTokenCache.accessToken;
  }
  if (!MS_CLIENT_ID) throw new Error("MS_CLIENT_ID env var required for Microsoft Graph");

  const cacheData = JSON.parse(await fs.readFile(MS_CACHE_PATH, "utf8"));

  // Check cached access token
  const accessEntries = Object.values(cacheData.AccessToken || {});
  for (const entry of accessEntries) {
    if (entry.client_id === MS_CLIENT_ID) {
      const expiresOn = parseInt(entry.expires_on, 10) * 1000;
      if (Date.now() < expiresOn - 120_000) {
        msTokenCache = { accessToken: entry.secret, expiresAt: expiresOn };
        return entry.secret;
      }
    }
  }

  // Refresh token
  const refreshEntries = Object.values(cacheData.RefreshToken || {});
  const refreshEntry = refreshEntries.find(e => e.client_id === MS_CLIENT_ID);
  if (!refreshEntry) throw new Error("No MS refresh token found. Re-authenticate your Teams MCP server.");

  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    refresh_token: refreshEntry.secret,
    grant_type: "refresh_token",
    scope: "Mail.Read User.Read Chat.Read Chat.ReadWrite Channel.ReadBasic.All ChannelMessage.Read.All Team.ReadBasic.All TeamMember.Read.All",
  });

  const res = await fetch(MS_AUTHORITY, { method: "POST", body });
  const data = await res.json();
  if (!res.ok) throw new Error(`MS token refresh failed: ${data.error_description || JSON.stringify(data)}`);

  msTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  };

  // Update cache file
  for (const key of Object.keys(cacheData.AccessToken || {})) {
    const entry = cacheData.AccessToken[key];
    if (entry.client_id === MS_CLIENT_ID) {
      entry.secret = data.access_token;
      entry.expires_on = String(Math.floor((Date.now() + data.expires_in * 1000) / 1000));
      entry.cached_at = String(Math.floor(Date.now() / 1000));
    }
  }
  if (data.refresh_token) {
    for (const key of Object.keys(cacheData.RefreshToken || {})) {
      if (cacheData.RefreshToken[key].client_id === MS_CLIENT_ID) {
        cacheData.RefreshToken[key].secret = data.refresh_token;
      }
    }
  }
  await fs.writeFile(MS_CACHE_PATH, JSON.stringify(cacheData, null, 2), { mode: 0o600 });

  return data.access_token;
}

/**
 * Call Microsoft Graph API. Handles token refresh automatically.
 * Requires MS_CLIENT_ID and MS_TOKEN_CACHE_PATH env vars.
 */
export async function msGraphFetch(path, params = {}, { method = "GET", body } = {}) {
  const token = await getMsGraphToken();
  const url = new URL(`https://graph.microsoft.com/v1.0${path}`);
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    }
  }
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url.toString(), options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Graph ${res.status}: non-JSON response from ${path} — ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`Graph ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  return data;
}

// ── Google API helpers ─────────────────────────────────────────────────────

const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const googleTokenCaches = new Map();

/**
 * Get a Google OAuth access token. Refreshes automatically.
 * Requires env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 * For multiple accounts, use prefixed vars: GOOGLE_CC_CLIENT_ID, etc.
 *
 * @param {string} account - Account key (e.g., "personal", "cc")
 */
async function getGoogleAccessToken(account) {
  const cached = googleTokenCaches.get(account);
  if (cached && Date.now() < cached.expiresAt - 120_000) return cached.accessToken;

  const prefix = account === "personal" ? "GOOGLE" : `GOOGLE_${account.toUpperCase()}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
  const refreshToken = process.env[`${prefix}_REFRESH_TOKEN`];

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(`Google OAuth env vars required: ${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET, ${prefix}_REFRESH_TOKEN`);
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URI, { method: "POST", body });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google token refresh failed (${account}): ${data.error_description || JSON.stringify(data)}`);

  googleTokenCaches.set(account, {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  });
  return data.access_token;
}

/**
 * Call a Google API. Handles token refresh automatically.
 * Defaults to GET. For POST/PATCH/PUT, pass method and body in the options object.
 *
 * @param {string} baseUrl - API base (e.g., "https://gmail.googleapis.com/gmail/v1/users/me")
 * @param {string} path - API path (e.g., "/messages")
 * @param {string} account - Account key ("personal" or "cc")
 * @param {object} params - Query parameters appended to the URL (used for GET, or when no body)
 * @param {object} [options] - { method: "GET"|"POST"|..., body: object }
 */
export async function googleFetch(baseUrl, path, account, params = {}, { method = "GET", body } = {}) {
  const token = await getGoogleAccessToken(account);
  const url = new URL(`${baseUrl}${path}`);
  if (method === "GET" || !body) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) { for (const item of v) url.searchParams.append(k, item); }
      else url.searchParams.set(k, v);
    }
  }
  const fetchOptions = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url.toString(), fetchOptions);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Google API ${res.status}: non-JSON response from ${path} — ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${data.error?.message || JSON.stringify(data)}`);
  return data;
}

/** Gmail convenience wrapper. */
export async function gmailFetch(path, account, params = {}) {
  return googleFetch("https://gmail.googleapis.com/gmail/v1/users/me", path, account, params);
}

/** Google Calendar convenience wrapper. */
export async function calendarFetch(path, account, params = {}) {
  return googleFetch("https://www.googleapis.com/calendar/v3", path, account, params);
}

// ── Notion property extractors ─────────────────────────────────────────────
// Notion returns deeply nested JSON for every property. These functions
// flatten the response into simple values.

export function extractTitle(prop) {
  if (!prop || prop.type !== "title") return "";
  return (prop.title || []).map(t => t.plain_text).join("");
}

export function extractSelect(prop) {
  if (!prop || prop.type !== "select") return null;
  return prop.select?.name || null;
}

export function extractStatus(prop) {
  if (!prop || prop.type !== "status") return null;
  return prop.status?.name || null;
}

export function extractRelation(prop) {
  if (!prop || prop.type !== "relation") return [];
  return (prop.relation || []).map(r => r.id);
}

export function extractRichText(prop) {
  if (!prop || prop.type !== "rich_text") return "";
  return (prop.rich_text || []).map(t => t.plain_text).join("");
}

export function extractDate(prop) {
  if (!prop || prop.type !== "date") return null;
  return prop.date?.start || null;
}

export function extractMultiSelect(prop) {
  if (!prop || prop.type !== "multi_select") return [];
  return (prop.multi_select || []).map(s => s.name);
}

export function extractNumber(prop) {
  if (!prop || prop.type !== "number") return null;
  return prop.number;
}

// ── HubSpot owner resolution ──────────────────────────────────────────────

const ownerCaches = new Map();
const OWNER_CACHE_TTL = 3600000; // 1 hour

/**
 * Fetch and cache HubSpot owner names. Returns { ownerId: "Full Name" }.
 */
export async function resolveHubspotOwners(token) {
  const cached = ownerCaches.get(token);
  if (cached && Date.now() - cached.ts < OWNER_CACHE_TTL) return cached.map;

  const map = {};
  try {
    const data = await hubspotFetch("/crm/v3/owners?limit=100", token);
    for (const o of data.results || []) {
      const name = [o.firstName, o.lastName].filter(Boolean).join(" ");
      if (name) map[o.id] = name;
    }
  } catch (e) {
    console.error("Failed to fetch HubSpot owners:", e.message);
  }

  ownerCaches.set(token, { map, ts: Date.now() });
  return map;
}

// ── Markdown formatting ────────────────────────────────────────────────────

/**
 * Build a markdown table from headers and rows.
 * Returns "No results found." if rows is empty.
 */
export function mdTable(headers, rows) {
  if (!rows.length) return "No results found.";
  const sep = headers.map(() => "---");
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...rows.map(row => `| ${row.map(cell => String(cell ?? "-")).join(" | ")} |`),
  ];
  return lines.join("\n");
}

// ── MCP response wrappers ──────────────────────────────────────────────────

/** Wrap text in MCP tool response format. */
export function textResult(text) {
  return { content: [{ type: "text", text }] };
}

/** Wrap an error message in MCP tool response format. */
export function errorResult(msg) {
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}
