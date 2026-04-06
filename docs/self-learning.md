# Self-Learning Deep Dive

mcp-slim's self-learning loop is what sets it apart from static proxy frameworks. Instead of requiring manual module development, the system watches your actual usage and generates proxies for the patterns that matter most.

## The Loop

```
OBSERVE  -->  DETECT  -->  GENERATE  -->  VALIDATE  -->  DEPLOY
   ^                                                       |
   └───────────── (repeat on schedule) ────────────────────┘
```

## Stage 1: Observe

**What**: Scans Claude Code session transcripts for raw MCP tool calls.

**Where**: Session files live at `~/.claude/projects/*/\*.jsonl`. Each JSONL file is one conversation session. Each line is a message (user, assistant, or tool result).

**How**: The observer reads each JSONL file, finds `tool_use` blocks in assistant messages, and filters for MCP calls (`name.startsWith("mcp__")`). It skips calls to the mcp-slim proxy itself.

### Signature Normalization

Each raw MCP call is normalized into a **canonical signature** that captures the shape of the call but not specific values. This groups calls that do the same thing with different parameters.

Example raw call:
```json
{
  "name": "mcp__hubspot__hubspot-search-objects",
  "input": {
    "objectType": "deals",
    "filterGroups": [{"filters": [{"propertyName": "dealstage", "operator": "EQ", "value": "closedwon"}]}],
    "properties": ["dealname", "amount", "dealstage"]
  }
}
```

Normalized signature:
```
hubspot:hubspot-search-objects:obj=deals,filters=[dealstage.EQ],props=[amount,dealname,dealstage]
```

The signature captures: server (hubspot), operation (search-objects), object type (deals), filter property names and operators (dealstage.EQ), and requested properties (sorted). But NOT the filter value ("closedwon") because that changes between calls while the call shape stays the same.

### Service-Specific Normalization

The observer has specialized normalization for:
- **HubSpot**: Groups by objectType + filter propertyNames + requested properties
- **Notion**: Groups by data_source_id + filter property names
- **Generic**: Groups by sorted parameter keys

### Deduplication

Each `tool_use` block has a unique ID. The observer tracks seen IDs in `~/.mcp-slim/observations.jsonl` and skips duplicates. Safe to run repeatedly.

## Stage 2: Detect

**What**: Groups observations by signature, finds patterns above the promotion threshold.

**Threshold**: Default is 5 calls. If a signature appears 5+ times across all observed sessions, it becomes a promotion candidate.

### Candidate Output

Each candidate includes:
- **signature**: The canonical call pattern
- **call_count**: How many times it was observed
- **suggested_name**: A proposed tool name (e.g., `fetch_deals_search`)
- **target_module**: Which module file it should go in
- **example_inputs**: Up to 5 diverse real inputs (for Claude to understand the call shape)
- **sessions**: Which sessions made these calls

### Name Suggestion Heuristics

The detector has specialized naming logic for many MCP servers:

| Server | Raw Tool | Suggested Name |
|--------|----------|---------------|
| hubspot | hubspot-search-objects (deals) | `fetch_deals_search` |
| hubspot | hubspot-list-objects (contacts) | `fetch_contacts_list` |
| notion-personal | API-query-data-source | `fetch_query_<db_prefix>` |
| slack | slack_read_channel | `fetch_slack_read_channel` |
| teams | get_chat_messages | `fetch_teams_get_chat_messages` |
| granola | list_meetings | `fetch_granola_list_meetings` |

### Collision Detection

Before suggesting a candidate, the detector checks all existing modules for name collisions. If `fetch_deals_search` already exists as a tool, the candidate is skipped.

## Stage 3: Generate

**What**: Claude Code writes proxy modules from the detected candidates.

**How**: When you run `/slim-evolve`, the SKILL.md instructions tell Claude to:
1. Read the candidates from the detect output
2. Read `_template.js` to understand the module contract
3. Read `shared.js` to understand available utilities
4. For each candidate, generate a module that calls the API directly and returns markdown
5. Write the module to `~/.mcp-slim/modules/`

Claude uses the `example_inputs` to understand the API call shape and the `suggested_name` for the tool name. The result is a module that makes the same API call but returns ~1,000 characters instead of ~100,000.

### Why Claude Code?

Every mcp-slim user already has Claude Code. Instead of shipping an LLM integration (which would require API keys and billing), mcp-slim leverages the LLM that's already present. When you run `/slim-evolve`, you ARE the Claude instance that generates the code. Elegant and free.

## Stage 4: Validate

**What**: Checks each generated module for structural correctness.

**Checks**:
1. Valid JavaScript syntax (can be imported)
2. Default export exists
3. `tools` is an array of properly structured tool definitions
4. `handlers` is an object of functions
5. Every tool has a matching handler and vice versa
6. No tool names collide with other modules

## Stage 5: Deploy

**What**: The generated modules are already in `~/.mcp-slim/modules/`. They'll be auto-discovered on the next mcp-slim server start (which happens when Claude Code restarts).

## Scheduling

For fully automatic operation:

```bash
# Weekly evolution
mcp-slim evolve --schedule weekly

# This sets up:
# - macOS: launchd plist at ~/Library/LaunchAgents/com.mcp-slim.evolve.plist
# - Linux: crontab entry
```

The scheduled job runs `mcp-slim evolve --auto`, which invokes `claude -p` to handle the generation step.

## Configuration

The promotion threshold and other settings can be configured in `~/.mcp-slim/config.json`:

```json
{
  "evolve": {
    "promotion_threshold": 5,
    "lookback_days": 30,
    "excluded_tools": [
      "mcp__notion__API-patch-page",
      "mcp__hubspot__hubspot-create-engagement"
    ]
  }
}
```

- **promotion_threshold**: Minimum call count to become a candidate (default: 5)
- **lookback_days**: How far back to scan sessions (default: 30)
- **excluded_tools**: Write operations to never promote (safety measure)
