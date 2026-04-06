# Contributing to mcp-slim

## Contributing Pre-Built Modules

The most valuable contribution is a pre-built proxy module for a popular MCP server. These help the community skip the observe/detect phase and get immediate savings.

### How to contribute a module

1. **Fork the repo** and create a branch
2. **Copy `src/modules/_template.js`** to `src/modules/<service>.example.js`
3. **Implement handlers** that call the service's REST API directly and return markdown
4. **Test it**: rename to `.js` (remove `.example`), run `npx @uaziz1/mcp-slim validate`
5. **Submit a PR** with your module and a description of the savings

### Module contract

Every module must export a default object:

```javascript
export default {
  tools: [
    {
      name: "fetch_something",        // snake_case, starts with fetch_ for reads
      description: "What it does",     // Clear, concise
      inputSchema: {                   // JSON Schema for parameters
        type: "object",
        properties: { ... },
      },
    },
  ],
  handlers: {
    fetch_something: async (params) => {
      // Call the API directly
      // Extract relevant fields
      // Return textResult(markdown)
    },
  },
};
```

### Guidelines

- **Read operations only** for community modules (no create, update, delete)
- **Use shared utilities**: `apiFetch`, `mdTable`, `textResult`, `errorResult` from `./shared.js`
- **API tokens from env vars**: never hardcode credentials
- **Keep responses under 2,000 characters**: strip unnecessary fields
- **No external dependencies**: use Node 18+ built-in `fetch`, no npm packages
- **Include setup instructions**: document required env vars and configuration
- **Validation must pass**: `npx @uaziz1/mcp-slim validate` with zero errors

### Code style

- ESM (`import`/`export`, not `require`)
- `async`/`await` (not `.then()`)
- No TypeScript (plain JavaScript for zero-build simplicity)
- Descriptive variable names, minimal comments

## Reporting Issues

Open an issue on GitHub with:
- Which MCP server you're using
- Expected vs actual behavior
- Node.js version (`node --version`)

## Development Setup

```bash
git clone https://github.com/uaziz1/mcp-slim.git
cd mcp-slim
npm install
npm run validate
```
