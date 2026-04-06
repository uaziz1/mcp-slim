# mcp-slim

**Your MCP costs drop automatically.**

## The Problem Nobody Talks About

You connected Notion to Claude Code. And HubSpot. And Slack, and Gmail, and Teams. MCP servers made it easy. But nobody told you what happens next.

Every time Claude calls an MCP tool, the server returns the **complete API response** as JSON. A single Notion database query? **187,000 characters**. A HubSpot deal search? **94,000 characters**. Your Gmail inbox? **120,000 characters**. Claude reads every single character. You pay for every single token.

Most of that data is garbage. Pagination metadata. Deeply nested type wrappers. API envelope objects. Response headers stuffed into the body. Fields Claude will never look at. The actual useful information (your task names, deal stages, email subjects) is buried inside a mountain of structural JSON that exists because MCP servers pass API responses through verbatim.

**The real cost**: A power user making 50 MCP calls per day is feeding Claude ~5 million characters of context that could be 50,000. That's 100x waste. At current token pricing, that's $15-25/month burned on JSON scaffolding. And it's not just cost: those bloated responses eat your context window, push out conversation history, and slow down responses.

This is the dirty secret of the MCP ecosystem: **the protocol that was supposed to make Claude smarter is also making it expensive and slow.**

## The Fix

mcp-slim is a proxy that sits alongside your existing MCP servers. It calls the same APIs directly, extracts only what Claude needs, formats it as clean markdown, and returns it in 500-2,000 characters instead of 200,000.

```
Without mcp-slim:

  Claude Code  -->  @notionhq/mcp  -->  Notion API
               <--  187,000 chars   <--  JSON (passed through verbatim)


With mcp-slim:

  Claude Code  -->  mcp-slim        -->  Notion REST API
               <--  1,200 chars     <--  JSON (parsed, extracted, formatted)

  Same question. Same answer. 99.4% fewer tokens.
```

But here's what makes mcp-slim different from writing your own proxy: **you don't write anything.**

## Zero-Code Self-Learning

mcp-slim watches your Claude Code sessions. It records every raw MCP call you make. When it sees the same pattern repeated, it generates an optimized proxy automatically. Set it up once, and the proxy grows itself.

```
  Day 1:   Install mcp-slim. Zero tools. Just observing.

  Day 7:   Run /slim-evolve in Claude Code.
           "Found 12 patterns across Notion, HubSpot, Slack.
            Top 5 cost you $0.47/day in tokens."
           Claude generates the proxy modules. Validates. Deploys.

  Day 8:   Those 5 patterns now cost $0.004/day.
           mcp-slim keeps watching for new patterns.

  Day 14:  Evolve runs again. Finds 3 more patterns. Generates.
           The proxy keeps growing itself. Zero human intervention.
```

### The Evolve Loop

```
  ┌──────────────────────────────────────────────────┐
  │                                                  │
  │  OBSERVE   Scan session transcripts for raw MCP  │
  │            calls. Record signatures + frequency. │
  │                        |                         │
  │  DETECT    Group by pattern. Find calls above    │
  │            threshold. Estimate token cost.       │
  │                        |                         │
  │  GENERATE  Claude Code writes proxy modules      │
  │            from detected patterns.               │
  │                        |                         │
  │  VALIDATE  Check syntax, exports, collisions.    │
  │            Deploy to ~/.mcp-slim/modules/.       │
  │                        |                         │
  │  (repeat on schedule)  v                         │
  │                                                  │
  └──────────────────────────────────────────────────┘
```

The key insight: every mcp-slim user already has Claude Code. So Claude IS the code generator. When you run `/slim-evolve`, you're asking the Claude instance you're already talking to to write the proxy modules. No separate API key. No external service. No cost beyond what you're already paying.

## The Numbers

Measured in production over 3 months, 35+ proxy tools, 9 backend services:

| Service | Raw MCP Response | mcp-slim Response | Reduction |
|---------|-----------------|-------------------|-----------|
| Notion query | 187,000 chars | 1,200 chars | **99.4%** |
| HubSpot search | 94,000 chars | 800 chars | **99.2%** |
| Gmail inbox | 120,000 chars | 1,500 chars | **98.8%** |
| Teams messages | 85,000 chars | 900 chars | **98.9%** |

These aren't theoretical. They're measured from a production system running 35+ proxy tools across Notion, HubSpot, Gmail, Microsoft Teams, Outlook, and Google Calendar.

## Quick Start

### 1. Install

```bash
git clone https://github.com/uaziz1/mcp-slim.git ~/.mcp-slim/repo
cd ~/.mcp-slim/repo && npm install && ./setup
# OR: npm install -g @uaziz1/mcp-slim && mcp-slim init
```

The setup does three things:
- Creates `~/.mcp-slim/modules/` (where proxy tools live)
- Registers `/slim-status`, `/slim-evolve`, `/slim-observe` as Claude Code slash commands
- Copies shared utilities to the modules directory

### 2. Add to Claude Code

Add mcp-slim to your `.mcp.json` (project or global):

```json
{
  "mcpServers": {
    "mcp-slim": {
      "command": "node",
      "args": ["~/.mcp-slim/repo/bin/mcp-slim.js"],
      "env": {
        "MCP_SLIM_MODULES": "~/.mcp-slim/modules",
        "NOTION_TOKEN": "ntn_...",
        "HUBSPOT_TOKEN": "pat-na1-..."
      }
    }
  }
}
```

Or if installed via npm:
```json
{
  "mcpServers": {
    "mcp-slim": {
      "command": "npx",
      "args": ["-y", "@uaziz1/mcp-slim"],
      "env": {
        "MCP_SLIM_MODULES": "~/.mcp-slim/modules",
        "NOTION_TOKEN": "ntn_..."
      }
    }
  }
}
```

Only include env vars for the services you use. No token = that service's examples won't activate.

### 3. Use Claude Code normally

mcp-slim starts with zero proxy tools. Use Claude Code as usual for a few days. Session transcripts accumulate and the observer has data to work with.

### 4. Evolve

From within Claude Code, type:

```
/slim-evolve
```

Claude will:
- Scan your session transcripts for expensive raw MCP calls
- Detect repeated patterns above the threshold (default: 5 calls)
- Generate optimized proxy modules
- Validate and deploy them
- Report what was generated and estimated savings

All within your Claude session. No external process. No API key. No cost.

### 5. Check status

```
/slim-status
```

```
mcp-slim status
  Modules directory: ~/.mcp-slim/modules
  Active modules:    8
  Proxy tools:       23
  Observations:      1,247
  Last observed:     2026-04-05 14:30
```

### 6. Schedule it (optional)

For fully hands-free operation:

```bash
mcp-slim evolve --schedule weekly

```

This sets up a cron job (launchd on macOS, crontab on Linux) that runs the full observe-detect-generate-validate loop automatically. Your proxy keeps growing without you thinking about it.

## Why This Exists

MCP is a great protocol. It solved the hard problem of connecting LLMs to external services. But the current generation of MCP servers was designed for **correctness**, not **efficiency**. They return complete API responses because that's the safest thing to do. Nothing gets lost.

The problem is that "nothing gets lost" means "everything gets read." And in a token-priced world, everything that gets read gets billed.

mcp-slim is the efficiency layer that MCP needs. It doesn't replace your MCP servers. It sits alongside them, intercepts the expensive patterns, and returns the same data in a fraction of the size. Your existing MCP servers still handle the long tail of operations. mcp-slim handles the 20% of calls that consume 80% of your tokens.

The self-learning loop is what makes this practical. You don't have to know which calls are expensive. You don't have to understand API response schemas. You don't have to write proxy code. The system figures it out from your actual usage and generates the proxies for you.

## How the Architecture Works

### Dynamic Module Discovery

The server entry point is ~70 lines. On startup, it reads every `.js` file in the modules directory, dynamically imports each one, merges all their tools and handlers, and serves them via MCP. Adding a module = dropping a file. No imports to edit, no config to update, no rebuild.

### Signature Normalization

The observer doesn't just count raw tool calls. It normalizes each call into a **canonical signature** that captures the call shape (which API, which operation, which filter fields) but not specific values. This groups calls that do the same thing with different parameters:

```
hubspot:hubspot-search-objects:obj=deals,filters=[dealstage.EQ],props=[dealname,amount]
```

Whether you searched for "closed won" or "qualified" deals, the signature is the same. The observer counts the pattern, not the instance.

### Module Contract

Every module exports two things:

```javascript
export default {
  tools: [{ name, description, inputSchema }],
  handlers: { tool_name: async (params) => textResult(markdown) },
};
```

The shared utilities (`shared.js`) provide API wrappers for Notion, HubSpot, Microsoft Graph, Google APIs, plus Notion property extractors and markdown formatters.

## CLI Reference

```
mcp-slim                          Start the MCP proxy server (default)
mcp-slim serve                    Same as above, explicit
mcp-slim observe                  Scan sessions, record raw MCP patterns
mcp-slim evolve                   Observe + detect, show candidates
mcp-slim evolve --auto            Full loop: observe + detect + generate + validate
mcp-slim evolve --schedule weekly Set up weekly cron
mcp-slim evolve --unschedule      Remove cron schedule
mcp-slim validate                 Validate all modules
mcp-slim status                   Show proxy stats
mcp-slim init                     Set up ~/.mcp-slim/ and register skills
```

## Claude Code Slash Commands

After running `./setup`, these are available inside Claude Code:

| Command | What it does |
|---------|-------------|
| `/slim-status` | Show active modules, tool count, observation stats |
| `/slim-evolve` | Run the full evolution loop (observe, detect, generate, validate) |
| `/slim-observe` | Scan sessions, show which MCP calls are most expensive |

## For Power Users: Writing Modules

Skip the learning loop. Write proxy modules directly.

1. Copy `src/modules/_template.js` to `~/.mcp-slim/modules/my-service.js`
2. Edit handlers to call your API and return markdown via `textResult()`
3. Run `mcp-slim validate`
4. Restart Claude Code

See `src/modules/` for complete examples:
- `notion-tasks.example.js` -- Notion task database proxy (4 tools)
- `hubspot-deals.example.js` -- HubSpot deal pipeline proxy (3 tools)

Shared utilities available: `apiFetch`, `notionFetch`, `hubspotFetch`, `msGraphFetch`, `googleFetch`, `gmailFetch`, `calendarFetch`, 8 Notion property extractors, `mdTable`, `textResult`, `errorResult`. See [docs/writing-modules.md](docs/writing-modules.md) for the full reference.

## Configuration

### Environment variables

| Variable | Purpose |
|----------|---------|
| `MCP_SLIM_MODULES` | Custom modules directory path |
| `MCP_SLIM_CONFIG` | Custom config file path |
| `MCP_SLIM_PROXY_NAME` | Proxy server name to skip in observations (default: `mcp-slim`) |
| `NOTION_TOKEN` | Notion integration token |
| `HUBSPOT_TOKEN` | HubSpot Private App token |
| `MS_CLIENT_ID` | Microsoft Graph client ID |
| `MS_TOKEN_CACHE_PATH` | Path to MSAL token cache |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Google OAuth refresh token |

### Module resolution order

1. `MCP_SLIM_MODULES` env var
2. `~/.mcp-slim/modules/`
3. Bundled `src/modules/` (examples only)

## Project Structure

```
mcp-slim/
  bin/
    mcp-slim.js          CLI entry point (subcommand router)
    observe.js           Session transcript scanner
    detect.js            Pattern detector + promotion logic
    validate.js          Module structure validator
    schedule.js          Cron job management (launchd / crontab)
  src/
    server.js            MCP server with dynamic module discovery
    shared.js            API wrappers, extractors, formatters
    modules/
      _template.js       Module skeleton (Claude reads this for generation)
      *.example.js       Example modules (not auto-loaded)
  skills/
    slim-status/         /slim-status Claude Code command
    slim-evolve/         /slim-evolve Claude Code command
    slim-observe/        /slim-observe Claude Code command
  setup                  Skill installer (symlinks to ~/.claude/skills/)
```

## Requirements

- Node.js 18+ (for built-in `fetch`)
- Claude Code (for the self-learning loop and slash commands)
- API tokens for the services you want to proxy

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most valuable contribution is a pre-built proxy module for a popular MCP server.

## Further Reading

- [How It Works](docs/how-it-works.md) -- Architecture deep-dive
- [Writing Modules](docs/writing-modules.md) -- Module authoring guide
- [Self-Learning](docs/self-learning.md) -- The observe/detect/generate loop explained

## License

MIT

---

Built by [Umair Aziz](https://github.com/uaziz1). Born from running 35+ MCP proxy tools across 9 services in production and watching the token bills.
