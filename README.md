# 🧠 AI Memory Actor — Long-Term Memory for AI Agents

A powerful Apify actor that gives AI agents persistent long-term memory capabilities. Agents can store, recall, search, and manage memories through MCP (Model Context Protocol), HTTP REST API, or the standard Apify actor interface.

## ✨ Features

- **MCP Server** — Connect any AI agent (Claude, GPT, Cursor, Qoder, etc.) as a memory tool via stdio or SSE transport
- **HTTP REST API** — Full REST endpoints for any application to integrate with
- **Smart Search (TF-IDF)** — Intelligent relevance scoring using term frequency-inverse document frequency, with recency, confidence, tag, and URL boost modifiers
- **Memory Decay & Pruning** — Automatic importance decay over time (configurable half-life), with intelligent pruning that archives rather than deletes
- **Multi-User Support** — Isolated memory stores per user/agent via `memoryStoreId`
- **Memory Lifecycle** — Full CRUD with metadata, tags, categories, confidence scoring, content hashing, and token-budgeted context packs
- **Three Operating Modes** — Actor (batch), HTTP Server, MCP Server — all from one codebase
- **Context Packs** — Generate markdown bundles within a token budget for feeding into LLM context windows
- **Zero External Search Dependencies** — TF-IDF search engine built from scratch, no vector database required

## 🚀 Quick Start

### Running on Apify

1. Create a new task from this actor on Apify
2. Set your input:
```json
{
    "action": "remember",
    "memoryStoreId": "my-agent-001~project-alpha",
    "url": "https://docs.example.com/api/auth",
    "content": "The API uses JWT tokens with 24h expiration and requires the X-Api-Key header",
    "memoryDetails": {
        "title": "JWT Auth Flow",
        "memoryType": "auth_flow",
        "tags": ["jwt", "auth", "api-key"],
        "confidence": 0.95,
        "importance": 0.9,
        "category": "technical"
    }
}
```
3. Run the task — the memory is stored in a named key-value store!

### Running Locally

```bash
git clone https://github.com/sharjeelakht165/Ai-memory-actor-apify.git
cd Ai-memory-actor-apify
npm install

# Standard actor mode (reads from INPUT.json)
npm start

# HTTP server mode
ACTOR_MODE=server npm start

# MCP server mode (stdio transport)
ACTOR_MODE=mcp npm start

# Run tests
npm test

# End-to-end smoke test
npm run test:local
```

For local actor mode, create `storage/key_value_stores/default/INPUT.json`:
```json
{
    "action": "context_pack",
    "memoryStoreId": "demo-user~local",
    "url": "https://docs.apify.com/integrations/mcp"
}
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                  AI Memory Actor                      │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │  Actor   │  │  HTTP    │  │  MCP Server      │  │
│  │  Mode    │  │  Server  │  │  (stdio/SSE)     │  │
│  │ (batch)  │  │  Mode    │  │  Mode            │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────────────┘  │
│       │              │              │                 │
│       └──────────────┼──────────────┘                 │
│                      │                                │
│              ┌───────▼────────┐                      │
│              │ MemoryManager  │                      │
│              ├────────────────┤                      │
│              │  CRUD ops      │                      │
│              │  TF-IDF Search │                      │
│              │  Decay Engine  │                      │
│              └───────┬────────┘                      │
│                      │                                │
│              ┌───────▼────────┐                      │
│              │  Apify KV      │                      │
│              │  Store         │                      │
│              └────────────────┘                      │
└─────────────────────────────────────────────────────┘
```

The actor supports three modes, selected via `ACTOR_MODE` environment variable:
- **`actor`** (default) — Standard Apify actor input/output, one-shot execution
- **`server`** — Persistent HTTP REST API server (uses Apify Standby mode)
- **`mcp`** — MCP server with stdio/SSE transport for AI agent integration

The entry point (`src/main.ts`) routes to the correct mode at startup before initializing the Apify SDK.

## 💡 Real Use Cases

### Use Case 1: Building a Chatbot with Long-Term Memory (MCP)

Connect your chatbot to the memory actor via MCP so it remembers conversations across sessions.

**Claude Desktop Configuration:**
```json
{
    "mcpServers": {
        "memory": {
            "command": "npx",
            "args": ["tsx", "src/main.ts"],
            "env": {
                "ACTOR_MODE": "mcp",
                "APIFY_TOKEN": "your-apify-token"
            }
        }
    }
}
```

Now your Claude Desktop has access to `store_memory`, `search_memories`, `recall_memories`, and more tools. You can say:
- "Remember that I prefer TypeScript over JavaScript"
- "What do you know about my coding preferences?"
- "Search my memories for anything about databases"

### Use Case 2: Personal AI Assistant via HTTP API

Build a web app that remembers user preferences:

```javascript
// Store a preference
const response = await fetch('https://your-actor.apify.net/api/memories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        userId: 'user-123',
        content: 'User prefers concise responses and code examples',
        category: 'preference',
        tags: ['communication', 'style'],
        importance: 0.9
    })
});

// Recall before generating response
const memories = await fetch('https://your-actor.apify.net/api/memories/user-123?category=preference');
const data = await memories.json();
// Use memories to personalize the AI response
```

### Use Case 3: Multi-Agent Shared Memory

Multiple agents share the same memory store for collaborative workflows:

```
Agent A (Researcher) → stores findings with memoryStoreId "team~project-x"
Agent B (Writer)     → recalls Agent A's findings from the same store
Agent C (Editor)     → searches and refines using context_pack
```

All agents use the same `memoryStoreId` to access shared memories. The `projectId` field enables further scoping within a shared store.

### Use Case 4: RAG Alternative — Structured Memory for AI

Instead of a vector database, use structured memories with categories and tags:

```javascript
// Store knowledge chunks
await storeMemory({
    memoryStoreId: 'project-alpha~api-docs',
    url: 'https://docs.example.com/auth',
    content: 'The API uses JWT tokens with 24h expiration',
    memoryDetails: {
        memoryType: 'auth_flow',
        tags: ['auth', 'jwt', 'api'],
        confidence: 0.95
    }
});

// Smart search finds relevant memories by TF-IDF + confidence + recency
const results = await searchMemories('project-alpha~api-docs', 'how does authentication work');
// Returns the JWT memory with high score due to tag match + confidence boost
```

### Use Case 5: Context Packs for Coding Agents

Before working on a URL/API, generate a token-budgeted context pack:

```json
{
    "action": "context_pack",
    "memoryStoreId": "my-team~stripe-integration",
    "url": "https://docs.stripe.com/webhooks",
    "maxTokens": 2500
}
```

Returns a markdown bundle with the most relevant memories, ranked by score, fitting within your token budget. Perfect for feeding into an LLM context window before coding.

### Use Case 6: Memory-Augmented Automation Workflows

Use with Zapier, Make, or n8n to add memory to automation:

1. **Webhook receives customer email** → Store key info as memory (`action: remember`)
2. **AI processes new ticket** → Recall customer history from memory (`action: recall`)
3. **After resolution** → Store outcome for future reference (`action: remember`)

## 📡 API Reference

### HTTP Endpoints

#### `GET /api/health`
Health check.
```json
{ "status": "ok", "actor": "AI Memory Actor", "version": "1.0", "timestamp": "2026-01-01T00:00:00.000Z" }
```

#### `POST /api/memories`
Store a new memory.
```json
// Request body:
{
    "userId": "user-123~project",
    "content": "User prefers dark mode",
    "category": "preference",
    "tags": ["ui", "settings"],
    "importance": 0.8,
    "metadata": { "source": "chat" }
}

// Response (201):
{ "success": true, "memory": { "id": "uuid", "content": "...", "createdAt": "...", "updatedAt": "..." } }
```

#### `GET /api/memories/:userId`
Recall memories. Query params: `category`, `limit`.
```json
// Response:
{ "success": true, "count": 5, "memories": [...] }
```

#### `POST /api/memories/search`
Search memories with TF-IDF scoring.
```json
// Request body:
{
    "userId": "user-123",
    "query": "dark mode preference",
    "category": "preference",
    "limit": 10,
    "minScore": 0.1
}

// Response:
{
    "success": true,
    "count": 2,
    "results": [
        {
            "memory": { "id": "...", "content": "User prefers dark mode" },
            "score": 0.847,
            "matchedTerms": ["dark", "mode", "preference"]
        }
    ]
}
```

#### `PUT /api/memories/:userId/:memoryId`
Update an existing memory.
```json
// Request body:
{
    "content": "Updated content",
    "category": "new-category",
    "tags": ["updated"],
    "importance": 0.9
}

// Response:
{ "success": true, "memory": { ... } }
```

#### `DELETE /api/memories/:userId/:memoryId`
Delete a specific memory.
```json
// Response:
{ "success": true, "message": "Memory deleted", "memoryId": "uuid" }
```

#### `GET /api/memories/:userId/stats`
Get memory statistics (total count, categories, last accessed, average importance).
```json
// Response:
{
    "success": true,
    "stats": {
        "totalCount": 42,
        "categories": { "technical": 15, "preference": 12, "general": 15 },
        "lastAccessed": "2026-01-15T10:30:00Z",
        "avgImportance": 0.72
    }
}
```

#### `POST /api/memories/:userId/prune`
Trigger memory decay and pruning.
```json
// Request body (optional):
{
    "decayConfig": {
        "halfLifeDays": 30,
        "pruneThreshold": 0.05
    }
}

// Response:
{ "success": true, "pruned": 3, "archived": 3, "remaining": 39 }
```

#### `GET /api/docs`
Returns a machine-readable API documentation object listing all endpoints.

### Actor Input (Standard Mode)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | Yes | One of: `remember`, `recall`, `search`, `forget`, `context_pack` |
| `memoryStoreId` | string | Yes | Stable id for your named KV store (e.g. `user~project`). Same id = persistent memory |
| `url` | string | No | Page URL for store, recall, or search. Normalized for matching |
| `content` | string | For remember | Text to save |
| `query` | string | For search | Keywords for search ranking |
| `memoryId` | string | For forget | UUID of a specific memory to delete |
| `projectId` | string | No | Optional filter (repo name, feature slug) |
| `maxResults` | integer | No | Limit for recall and search (default: 20) |
| `maxTokens` | integer | No | Token budget for context_pack (default: 2500) |
| `memoryDetails` | object | No | Structured metadata — see below |
| `searchOptions` | object | No | Options for refining search results |
| `decayConfig` | object | No | Configuration for memory importance decay |

#### `memoryDetails` Object

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Short descriptive title for this memory |
| `memoryType` | enum | One of: `integration_note`, `api_quirk`, `auth_flow`, `selector`, `breaking_change`, `project_binding`, `general` |
| `tags` | string[] | Tags for categorization (max 50) |
| `confidence` | number | Confidence in accuracy (0.0–1.0) |
| `importance` | number | Importance for ranking and decay (0.0–1.0) |
| `category` | string | Category for organizing memories |
| `source` | enum | Origin: `agent`, `human`, or `crawl` |
| `relatedUrls` | string[] | Related URLs |

## 🔧 MCP Tools Reference

When running in MCP mode, the following tools are available to AI agents:

| Tool | Description | Required Parameters |
|------|-------------|---------------------|
| `store_memory` | Save a new memory for future recall | `userId`, `content` |
| `recall_memories` | Retrieve stored memories for a user | `userId` |
| `search_memories` | Search memories using intelligent TF-IDF scoring | `userId`, `query` |
| `update_memory` | Modify an existing memory's content or metadata | `userId`, `memoryId` |
| `delete_memory` | Permanently remove a specific memory | `userId`, `memoryId` |
| `get_memory_stats` | Get statistics about a user's memory store | `userId` |
| `prune_memories` | Trigger decay and remove low-relevance memories | `userId` |

### MCP Tool Details

#### `store_memory`
**When to use:** When the user shares information that should be remembered for future interactions — preferences, facts, decisions, or any contextual information.

**Example:**
```json
{
    "userId": "agent-claude-001",
    "content": "User's project uses React 18 with TypeScript and Vite",
    "category": "technical",
    "tags": ["react", "typescript", "vite"],
    "importance": 0.9
}
```

#### `search_memories`
**When to use:** When you need to find relevant past information. Uses TF-IDF scoring that considers keyword relevance, memory confidence, recency, and category matches.

**Example:**
```json
{
    "userId": "agent-claude-001",
    "query": "what framework does the user prefer",
    "limit": 5
}
```

#### `prune_memories`
**When to use:** Periodically or when memory count is large. Applies exponential decay based on time since last access and archives memories below the importance threshold. High-importance memories (≥0.9) are exempt.

**Example:**
```json
{
    "userId": "agent-claude-001",
    "halfLifeDays": 30,
    "pruneThreshold": 0.05
}
```

## 🔍 Search Algorithm

The search engine uses a multi-factor relevance scoring system implemented in `src/search-engine.js`:

1. **TF-IDF Score** — Term Frequency × Inverse Document Frequency across all candidate memories. Stopwords are filtered out. Partial matches receive a small bonus (0.05).
2. **Confidence Boost** — Memory's confidence value × 0.3 (higher confidence = higher ranking)
3. **Recency Boost** — Exponential decay based on days since last update: `e^(-daysSinceUpdate / 30)` × 0.2
4. **Memory Type Match** — +0.1 bonus if `memoryType` matches search filter
5. **Tag Match** — +0.15 bonus if any tag matches search query terms
6. **URL Relevance** — +0.1 bonus if URL contains search terms

**Composite Score:**
```
finalScore = tfidf + (confidence × 0.3) + (recencyBoost × 0.2) + typeBoost + tagBoost + urlBoost
```

Results are filtered by `minScore` threshold and sorted by composite score descending.

## 🔄 Memory Lifecycle & Decay

Memories have a natural lifecycle:

```
Store → Access (boost recency) → Decay (if unused) → Archive → Prune
```

**Decay Formula:**
```
decayedImportance = importance × 0.5^(daysSinceAccess / halfLifeDays)
```

**Default Configuration:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `halfLifeDays` | 30 | Days for importance to halve |
| `minImportance` | 0.1 | Minimum importance before archiving |
| `pruneThreshold` | 0.05 | Importance threshold for pruning |
| `maxMemoriesPerUser` | 1000 | Maximum active memories per user |

**Key behaviors:**
- Memories with importance ≥ 0.9 are **exempt from decay** — they persist indefinitely
- Pruned memories are **archived**, not deleted (the `archived` flag is set, and they're excluded from search by default)
- Decay is computed **lazily** on access — no background process needed
- Accessing a memory (updating it) resets its decay timer via the `updatedAt` timestamp

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ACTOR_MODE` | Operating mode: `actor`, `server`, `mcp` | `actor` |
| `APIFY_TOKEN` | Your Apify API token (required for all modes) | — |
| `ACTOR_WEB_SERVER_PORT` | Port for HTTP server mode | `3000` |
| `MCP_TRANSPORT` | MCP transport type: `stdio` or `sse` | `stdio` |

### Apify Platform Configuration
- Enable **Standby mode** in actor settings for persistent HTTP server or MCP SSE mode
- Set `APIFY_TOKEN` as an environment variable in actor configuration
- The actor uses **named key-value stores** derived from `memoryStoreId` for persistence

### Storage Model

Each `memoryStoreId` maps to a named Apify key-value store. Inside each store:

| Key Pattern | Contents |
|-------------|----------|
| `__manifest` | Index of all memory IDs in the store |
| `memory-<uuid>` | Individual memory records |

Named stores are retained indefinitely on Apify — your memories persist across runs.

## 🏠 Self-Hosting

### Docker

```bash
docker build -t ai-memory-actor .
docker run -p 3000:3000 -e ACTOR_MODE=server -e APIFY_TOKEN=your-token ai-memory-actor
```

### Local Development

```bash
git clone https://github.com/sharjeelakht165/Ai-memory-actor-apify.git
cd Ai-memory-actor-apify
npm install

# Run tests
npm test

# Run end-to-end smoke test
npm run test:local

# Standard actor mode (reads INPUT.json from storage/)
npm start

# HTTP server mode
ACTOR_MODE=server npm start

# MCP server mode
ACTOR_MODE=mcp npm start
```

**Local output locations:**

| Path | Contents |
|------|----------|
| `storage/datasets/default/*.json` | Run result (same as MCP `get-dataset-items`) |
| `storage/key_value_stores/<storeName>/` | Persistent memories (`__manifest.json`, `memory-<uuid>.json`) |
| `storage/key_value_stores/default/OUTPUT.json` | Last run output mirror |

### Deploy to Apify

```bash
apify login
apify push
```

Publish to Apify Store when ready. A quality README and input schema improve MCP discovery ranking.

## 📁 Project Structure

```
.actor/
  actor.json              — Actor configuration, metadata, and standby mode settings
  input_schema.json       — Input schema for Apify platform UI
  Dockerfile              — Docker build configuration (Node 22)
src/
  main.ts                 — Entry point with mode routing (actor/server/mcp)
  main.js                 — Original JavaScript entry point
  types.ts                — TypeScript interfaces (Memory, MemoryDetails, DecayConfig, etc.)
  actions.js              — Action handlers (remember, recall, search, forget, context_pack)
  memory-store.js         — Core KV storage operations (CRUD, manifest management)
  memory-manager.ts       — High-level MemoryManager class wrapping storage + search + decay
  search-engine.js        — TF-IDF search engine with multi-factor relevance scoring
  server.ts               — Express HTTP API server with full REST endpoints
  mcp-server.ts           — MCP server with stdio and SSE transport, tool definitions
  url-utils.js            — URL normalization, site extraction, URL matching utilities
test/
  url-utils.test.js       — Unit tests for URL utilities
scripts/
  local-smoke.mjs         — End-to-end smoke test script
package.json              — Dependencies and scripts
```

## 🔒 Security

Anyone who knows your `memoryStoreId` can read/write that store. Use an unguessable id (e.g. `username~random-project-slug-8f3a`). The `memoryStoreId` is sanitized to meet Apify store naming constraints (max 63 chars, lowercase alphanumeric with `~`, `_`, `-`).

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and add tests
4. Run tests: `npm test`
5. Commit: `git commit -m "Add my feature"`
6. Push: `git push origin feature/my-feature`
7. Open a Pull Request

### Development Guidelines
- Keep modules focused and single-purpose
- Add TypeScript types for all new interfaces in `types.ts`
- The search engine (`search-engine.js`) is dependency-free — keep it that way
- Follow existing code style (JSDoc for JS files, TypeScript for new modules)
- Test with `npm test` and `npm run test:local` before submitting

## 📄 License

Apache-2.0

---

Built with ❤️ for the AI agent community. Give your agents the gift of memory!
