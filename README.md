# self-improve

A self-improving MCP server that learns from your corrections. It stores coding rules as searchable knowledge with vector similarity search — so your AI assistant never repeats the same mistakes.

## How It Works

1. **You correct your AI** — "No, use Zod for validation, not manual checks"
2. **AI saves the rule** — calls `add_rule` to store the correction with context
3. **Next time** — AI calls `find_rules` before coding and gets back: _"Use Zod for validation because..."_
4. **AI improves** — mistakes aren't repeated, knowledge compounds over time

## Quick Start

### Claude Code

Add to `~/.config/Claude/settings.json`:

```json
{
  "mcpServers": {
    "coding-knowledge": {
      "command": "npx",
      "args": ["-y", "self-improve"]
    }
  }
}
```

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "coding-knowledge": {
      "command": "npx",
      "args": ["-y", "self-improve"]
    }
  }
}
```

### Windsurf / Other MCP Clients

```json
{
  "mcpServers": {
    "coding-knowledge": {
      "command": "npx",
      "args": ["-y", "self-improve"]
    }
  }
}
```

## MCP Tools

### `find_rules`

**Must be called first on every user message.** Searches the knowledge base for relevant coding rules and project context. This prevents the AI from repeating known mistakes.

```json
{
  "query": "fix the login validation",
  "current_file": "src/auth/login.ts",
  "tech_stack": ["typescript", "zod"],
  "project_name": "my-app",
  "limit": 5
}
```

### `add_rule`

Saves a new coding rule when the user corrects the AI. Should be called immediately when the user says something was wrong.

```json
{
  "title": "Use Zod for validation",
  "description": "All API input validation must use Zod schemas",
  "what_was_wrong": "Used manual if/else checks for validation",
  "what_is_right": "Define Zod schemas and use .parse() or .safeParse()",
  "why": "Zod provides type-safe validation with automatic TypeScript inference",
  "scope": "project",
  "project_name": "my-app",
  "tech_stack": ["typescript", "zod"],
  "tags": ["validation", "api"],
  "good_example": "const schema = z.object({ email: z.string().email() });\nconst data = schema.parse(input);"
}
```

### `set_project_context`

Stores essential project context (architecture, services, conventions) for RAG retrieval. Entries are upserted — if the same `project_name + title` exists, arrays merge and strings replace.

```json
{
  "project_name": "my-app",
  "category": "architecture",
  "title": "Authentication Flow",
  "content": "Uses JWT tokens with refresh rotation. Auth service is separate microservice...",
  "related_services": ["auth-service", "api-gateway"],
  "tags": ["auth", "jwt"]
}
```

### `get_project_context`

Retrieves stored project context. Supports semantic search when a vector store is available.

```json
{
  "project_name": "my-app",
  "query": "how does authentication work",
  "category": "architecture",
  "limit": 5
}
```

### `prune_rules`

Removes duplicate and unused rules. Use `dry_run: true` first to preview changes.

```json
{
  "dry_run": true,
  "delete_unused_days": 90,
  "similarity_threshold": 0.9
}
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATA_DIR` | Directory for storing rules and embeddings | `~/.self-improve` |
| `QDRANT_URL` | Qdrant server URL for remote vector storage | _(local file-based)_ |
| `QDRANT_API_KEY` | Qdrant API key (for Qdrant Cloud) | — |
| `QDRANT_COLLECTION` | Qdrant collection name | `coding-knowledge` |

### Storage

By default, all data is stored in `~/.self-improve/`:

```
~/.self-improve/
├── rules/       # Coding rules (JSON files)
├── contexts/    # Project context entries
└── vector-db/   # Local vector embeddings
```

This means your knowledge persists across projects and sessions.

### Optional: Remote Vector Store (Qdrant)

For better search quality or sharing knowledge across machines, you can connect to a Qdrant instance:

```json
{
  "mcpServers": {
    "coding-knowledge": {
      "command": "npx",
      "args": ["-y", "self-improve"],
      "env": {
        "QDRANT_URL": "http://localhost:6333"
      }
    }
  }
}
```

## Agent Instructions

For best results, add this to your AI assistant's system instructions:

```
# MANDATORY FIRST STEP

**BEFORE doing ANYTHING else**, call the `coding-knowledge` MCP tool `find_rules` with the user's question as the `query`. Do this EVERY time, for EVERY message. No exceptions.

Example: User asks "fix the login bug" → First call `find_rules` with `query: "fix login bug"`

## When user corrects you

Call `add_rule` to save the correction so you remember it next time.
```

## Why This Instead of CLAUDE.md / AGENTS.md?

AI coding tools like Claude Code and Cursor support static instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`). They work — but they don't scale. Here's the difference:

| | Static files (`CLAUDE.md`) | `self-improve` |
|---|---|---|
| **Learning** | You write rules manually | AI saves rules automatically when you correct it |
| **Search** | Entire file loaded into context every time | Vector similarity search — only relevant rules are returned |
| **Scope** | Per-project only | Global rules + per-project rules, all in one place |
| **Cross-project** | Copy-paste between repos | Knowledge persists in `~/.self-improve`, works across all projects |
| **Context window** | Eats tokens even when irrelevant | Returns only top-N matching rules with token budgeting |
| **Deduplication** | Manual — you notice duplicates yourself | Auto-merge similar rules, prune unused ones |
| **Structure** | Free-form markdown | Structured rules with `what_was_wrong`, `what_is_right`, `why`, code examples |
| **Project context** | Mixed in with instructions | Separate `set_project_context` / `get_project_context` with RAG retrieval |

### The real problem with static files

A `CLAUDE.md` with 50 rules wastes thousands of tokens on every message — even when you're editing an unrelated file. As rules grow, the file becomes a wall of text that's hard to maintain and expensive to process.

`self-improve` solves this: the AI calls `find_rules("fix login validation")` and gets back only the 3-5 rules that actually matter for that task. Everything else stays out of context.

### They work together

You don't have to choose. Use `CLAUDE.md` for high-level project instructions (tech stack, architecture overview, repo structure) and `self-improve` for the growing body of corrections and conventions that accumulate over time. The static file gives broad context; the MCP gives precise, searchable knowledge.

## How It's Built

- **MCP SDK** — `@modelcontextprotocol/sdk` for the server protocol
- **Embeddings** — `@xenova/transformers` with `all-MiniLM-L6-v2` (local, privacy-friendly — no data leaves your machine)
- **Storage** — JSON files + file-based vector DB (zero external dependencies by default)
- **Optional** — Qdrant for remote/shared vector storage

## License

MIT
