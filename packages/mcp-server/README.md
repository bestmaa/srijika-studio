# Srijika MCP Server

This stdio MCP server lets Codex and other MCP clients understand, validate, plan,
and safely scaffold a CLI-first Srijika TSX project without Desktop Studio.

```bash
npx -y @srijika/mcp-server --project /absolute/path/to/project
```

The code-project tools are bounded to `--project`, use the shared Srijika developer
engine, refuse overwrite, and enforce the canonical Feature → Slot → Part contract.
When Srijika Studio is running, the same server also exposes its authenticated
document, layout, preview, and history bridge tools.
