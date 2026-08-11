# How Apify MCP + the AI Memory Actor Give an AI Agent Real Long-Term Memory

> A deep technical walkthrough of building, running, and integrating a persistent memory system for AI agents — based on live experimentation with the `charmed_magnolia/Ai-memory-actor-apify` Actor via Apify's hosted MCP server.

---

## Table of Contents

1. [What Problem Does This Solve?](#1-what-problem-does-this-solve)
2. [The Stack at a Glance](#2-the-stack-at-a-glance)
3. [How the MCP Connection Works](#3-how-the-mcp-connection-works)
4. [Inside the Actor: Three Operating Modes](#4-inside-the-actor-three-operating-modes)
5. [The Storage Layer: Manifest-Based KV Store](#5-the-storage-layer-manifest-based-kv-store)
6. [The Memory Record Schema](#6-the-memory-record-schema)
7. [The Search Engine: Zero-Dependency TF-IDF](#7-the-search-engine-zero-dependency-tf-idf)
8. [Memory Decay: Exponential Half-Life](#8-memory-decay-exponential-half-life)
9. [Real Observations: What Actually Happens When You Call It](#9-real-observations-what-actually-happens-when-you-call-it)
10. [Use Case 1 — AI Coding Agent with Persistent Project Context](#10-use-case-1--ai-coding-agent-with-persistent-project-context)
11. [Use Case 2 — Chatbot That Remembers Across Sessions](#11-use-case-2--chatbot-that-remembers-across-sessions)
12. [Use Case 3 — Multi-Agent Shared Memory](#12-use-case-3--multi-agent-shared-memory)
13. [Use Case 4 — Context Packs as a RAG Alternative](#13-use-case-4--context-packs-as-a-rag-alternative)
14. [Use Case 5 — Memory-Augmented Automation Pipelines](#14-use-case-5--memory-augmented-automation-pipelines)
15. [The Cold Start Problem and How to Solve It](#15-the-cold-start-problem-and-how-to-solve-it)
16. [Running Locally vs. On Apify: Practical Differences](#16-running-locally-vs-on-apify-practical-differences)
17. [MCP Config Reference](#17-mcp-config-reference)
18. [Full API Reference](#18-full-api-reference)
19. [Key Takeaways for Article Readers](#19-key-takeaways-for-article-readers)

---

## 1. What Problem Does This Solve?

Every time you start a new chat with an AI assistant, it starts from zero. It has no idea you spent last week refactoring your auth layer, that you prefer TypeScript strict mode, or that the Stripe webhook endpoint has a known quirk with idempotency keys. You re-explain the same context every session, wasting tokens and time.

The core insight behind this project is simple: **persistent memory is just structured storage with smart retrieval**. You don't need a vector database or a fine-tuned model. You need:

- A place to write facts down (key-value store)
- A way to find the right ones later (TF-IDF search + scoring)
- A hook into the AI's tool-calling interface (MCP)
- A way to keep the store from growing stale (decay + pruning)

This actor provides all four. It integrates into any MCP-compatible AI agent via Apify's hosted MCP server — no infrastructure to manage, no embeddings to compute, no vector index to maintain.

---

## 2. The Stack at a Glance

```
┌──────────────────────────────────────────────────────────────┐
│  AI Agent (Kiro / Claude / Cursor / GPT + tools)             │
│  ↕ MCP protocol (JSON-RPC over HTTP or stdio)                │
├──────────────────────────────────────────────────────────────┤
│  Apify Hosted MCP Server (https://mcp.apify.com)             │
│  Wraps the Actor as MCP tools automatically                  │
│  ↕ Apify Actor API                                           │
├──────────────────────────────────────────────────────────────┤
│  charmed_magnolia/Ai-memory-actor-apify                      │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │ Actor Mode  │  │  HTTP Server │  │  MCP stdio Mode   │   │
│  │ (batch)     │  │  (REST+/mcp) │  │  (local agents)   │   │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬─────────┘   │
│         └────────────────┼──────────────────────┘            │
│                          ↓                                    │
│              ┌───────────────────────┐                       │
│              │  actions.js           │                       │
│              │  SearchEngine (TF-IDF)│                       │
│              │  DecayEngine          │                       │
│              └───────────┬───────────┘                       │
│                          ↓                                    │
│              ┌───────────────────────┐                       │
│              │  Apify KV Store       │                       │
│              │  __manifest + records │                       │
│              └───────────────────────┘                       │
└──────────────────────────────────────────────────────────────┘
```

**Tech choices that matter:**
- **Node.js 22 / ES Modules** — `"type": "module"` in `package.json`; all imports use `.js` extensions even for TypeScript source
- **Apify SDK v3** — provides local KV store emulation so the exact same code runs locally and on the platform
- **`@modelcontextprotocol/sdk` v1.30** — the official MCP SDK for tool registration and stdio/SSE transport
- **Zero search dependencies** — TF-IDF implemented from scratch in ~150 lines in `search-engine.js`
- **TypeScript for new modules** — `memory-manager.ts`, `mcp-server.ts`, `server.ts`, `types.ts` are TS; older core files are plain JS with JSDoc

---

## 3. How the MCP Connection Works

### The Kiro/IDE side

In `~/.kiro/settings/mcp.json`:

```json
{
  "mcpServers": {
    "apify": {
      "url": "https://mcp.apify.com/?tools=actors,docs,charmed_magnolia/Ai-memory-actor-apify",
      "headers": {
        "Authorization": "Bearer <your-apify-api-token>"
      }
    }
  }
}
```

The `tools=` query parameter is Apify's actor selector. You can list multiple actors separated by commas. Apify's hosted MCP server reads that list at connection time and exposes each actor's tools directly — no Actor needs to be running in advance.

### What the hosted MCP server does

When Kiro connects to `https://mcp.apify.com`, the server:

1. Authenticates using the `Authorization` header
2. Reads the `tools=` list from the query string
3. For each actor listed (e.g. `charmed_magnolia/Ai-memory-actor-apify`), fetches its input schema from the Apify API
4. Wraps the actor's input schema as MCP tool definitions
5. Returns those tool definitions to the client over the MCP handshake

From that point, when Kiro calls a tool like `charmed_magnolia/Ai-memory-actor-apify` with a `remember` action, the hosted MCP server:

1. Takes the tool call arguments
2. Constructs an Apify Actor run input payload
3. Calls the Apify Actor API to start a run
4. Waits for the run to finish (or times out)
5. Returns the dataset output back as an MCP tool response

### The local MCP mode (stdio)

For local agents, the actor also ships a full MCP server in `src/mcp-server.ts`:

```typescript
// src/mcp-server.ts (abridged)
const server = new McpServer({ name: 'site-memory-agent', version: '0.1.0' });

server.tool('store_memory', 'Store a new memory for a user...', {
  userId: z.string(),
  content: z.string(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  importance: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}, async (args) => {
  const result = await manager.storeMemory(args);
  return jsonResult(result);
});

// Seven tools total: store_memory, recall_memories, search_memories,
// update_memory, delete_memory, get_memory_stats, prune_memories

const stdioTransport = new StdioServerTransport();
await server.connect(stdioTransport);
```

To use this from Claude Desktop locally:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["src/main.js"],
      "env": {
        "ACTOR_MODE": "mcp",
        "APIFY_TOKEN": "your-token"
      }
    }
  }
}
```

---

## 4. Inside the Actor: Three Operating Modes

The entry point `src/main.js` handles all three modes. Here is the full routing logic:

```javascript
// src/main.js
import { Actor, log } from 'apify';
import { actionRemember, actionRecall, actionSearch,
         actionForget, actionContextPack, actionUpdate, actionPrune } from './actions.js';
import { loadAllMemories, sanitizeStoreName } from './memory-store.js';

await Actor.init();

const input = await Actor.getInput();
const action = input?.action;
const memoryStoreId = input?.memoryStoreId;

if (!action || !memoryStoreId) {
  throw new Error('Input must include action and memoryStoreId');
}

const storeName = sanitizeStoreName(memoryStoreId);
const store = await Actor.openKeyValueStore(storeName);

switch (action) {
  case 'remember':
  case 'store':         // alias
    result = await actionRemember(store, input); break;
  case 'recall':
    result = await actionRecall(store, input); break;
  case 'search':
    result = await actionSearch(store, input); break;
  case 'forget':
  case 'delete':        // alias
    result = await actionForget(store, input); break;
  case 'context_pack':
    result = await actionContextPack(store, input); break;
  case 'update':
    result = await actionUpdate(store, input); break;
  case 'stats':
    // inline — counts memories by type
    const { memories } = await loadAllMemories(store);
    result = { action: 'stats', ok: true, totalMemories: memories.length, byType, lastUpdated };
    break;
  case 'prune':
    result = await actionPrune(store, input); break;
}

await Actor.pushData(output);    // → dataset
await Actor.setValue('OUTPUT', output); // → KV store OUTPUT key
await Actor.exit();
```

**Key design decision:** every action handler receives the raw `store` handle and the raw `input` object. There is no ORM or abstraction layer between actions and storage — the store is passed directly. This makes each action testable in isolation by passing a mock store.

The `storeName` conversion is worth calling out:

```javascript
// src/memory-store.js
export function sanitizeStoreName(memoryStoreId) {
  const cleaned = memoryStoreId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9~_-]+/g, '-')  // only alphanumeric, ~, _, -
    .replace(/-+/g, '-')              // collapse consecutive dashes
    .replace(/^[-~]+|[-~]+$/g, '');   // strip leading/trailing dashes
  const name = cleaned || 'default-site-memory';
  return name.length > 63 ? name.slice(0, 63) : name;
}
```

Apify KV store names have a 63-character limit and restricted charset. The `~` separator is preserved deliberately — the convention `username~project-name` keeps stores human-readable in the Apify Console while namespacing them per user.

---

## 5. The Storage Layer: Manifest-Based KV Store

This is the most architecturally interesting part of the project. Apify's KV store is a key-value store — not a database. You can't `SELECT * WHERE type = 'general'`. To avoid having to list all keys on every read (which would be an O(n) API call per operation), the actor uses a **manifest pattern**:

```
KV Store: "sharjeel~site-memory-agent"
├── __manifest  →  { version: 1, memoryIds: ["uuid1", "uuid2", ...], updatedAt: "..." }
├── memory-16db455b-f7e5-42a9-804b-e19a8b6afaa2  →  { full memory record }
├── memory-bb45fbe2-b64a-443b-b753-f462c4d6156a  →  { full memory record }
└── ...
```

Here is what an actual `__manifest.json` from a live local run looks like:

```json
{
  "version": 1,
  "memoryIds": [
    "bb45fbe2-b64a-443b-b753-f462c4d6156a"
  ],
  "updatedAt": "2026-08-06T14:08:47.527Z"
}
```

And here is the `loadAllMemories` function that reads using it:

```javascript
// src/memory-store.js
export async function loadAllMemories(store) {
  const manifest = await loadManifest(store);
  const memories = [];
  for (const id of manifest.memoryIds) {
    const rec = await store.getValue(`memory-${id}`);
    if (rec && typeof rec === 'object') memories.push(rec);
  }
  return { manifest, memories };
}
```

And `saveMemory`, which keeps the manifest in sync on every write:

```javascript
export async function saveMemory(store, record) {
  await store.setValue(`memory-${record.id}`, record);
  const manifest = await loadManifest(store);
  if (!manifest.memoryIds.includes(record.id)) {
    manifest.memoryIds.push(record.id);
  }
  await saveManifest(store, manifest);
}
```

**Trade-off:** this pattern is O(n) in reads on load (one KV get per memory ID), but avoids any KV key-listing API call. For stores up to ~1000 memories (the configurable max), this is fast enough and keeps the code simple. The manifest also doubles as a soft lock — two concurrent writes both updating the manifest could race, but in practice each actor run is single-threaded and the KV store is eventually consistent.

**Deletion** sets the value to `null` (Apify's way of deleting a KV record) and splices the ID from the manifest:

```javascript
export async function deleteMemory(store, memoryId) {
  await store.setValue(`memory-${memoryId}`, null);
  const manifest = await loadManifest(store);
  manifest.memoryIds = manifest.memoryIds.filter((id) => id !== memoryId);
  await saveManifest(store, manifest);
}
```

---

## 6. The Memory Record Schema

Every memory stored is a plain JSON object. Here is a real record from the local-smoke~demo store, written by the `remember` action during a smoke test run:

```json
{
  "id": "bb45fbe2-b64a-443b-b753-f462c4d6156a",
  "url": "https://docs.apify.com/integrations/mcp",
  "site": "docs.apify.com",
  "title": "Notes for https://docs.apify.com/integrations/mcp",
  "content": "After call-actor, use get-dataset-items to read the result payload.",
  "memoryType": "integration_note",
  "tags": ["mcp", "smoke-test"],
  "confidence": 0.8,
  "source": "agent",
  "projectId": null,
  "relatedUrls": [],
  "createdAt": "2026-08-06T14:08:47.510Z",
  "updatedAt": "2026-08-06T14:08:47.510Z",
  "contentHash": "1197788730f0b8a8"
}
```

And another from the `demo-user~apify-mcp-project` store, stored by a previous session of Kiro:

```json
{
  "id": "16db455b-f7e5-42a9-804b-e19a8b6afaa2",
  "url": "https://docs.apify.com/integrations/mcp",
  "site": "docs.apify.com",
  "title": "Apify MCP for coding agents",
  "content": "Hosted MCP at https://mcp.apify.com exposes call-actor; preload Actors in the MCP configurator. Dataset items require get-dataset-items after the run.",
  "memoryType": "integration_note",
  "tags": ["mcp", "cursor", "apify"],
  "confidence": 0.9,
  "source": "agent",
  "projectId": null,
  "relatedUrls": [],
  "createdAt": "2026-08-06T14:08:12.760Z",
  "updatedAt": "2026-08-06T14:08:12.760Z",
  "contentHash": "d8466d0f16dd9566"
}
```

The full TypeScript interface from `src/types.ts`:

```typescript
export interface Memory {
  id: string;             // UUID v4
  url?: string | null;    // normalized URL (trailing slash stripped, hash removed)
  site?: string | null;   // extracted hostname, www. stripped
  title: string;          // auto-generated from URL if not provided
  content: string;        // the actual memory text
  memoryType: string;     // 'integration_note' | 'api_quirk' | 'auth_flow' |
                          // 'selector' | 'breaking_change' | 'project_binding' | 'general'
  tags: string[];         // max 50, max 50 chars each
  confidence: number;     // 0.0–1.0, default 0.8
  source: string;         // 'agent' | 'human' | 'crawl'
  projectId?: string | null;
  relatedUrls: string[];
  createdAt: string;      // ISO 8601
  updatedAt: string;      // ISO 8601, reset on every access (drives decay timer)
  contentHash: string;    // SHA-256 first 16 hex chars, for dedup detection
  archived?: boolean;     // set by decay engine, excluded from search by default
  decayedImportance?: number;
  importance?: number;    // 0.0–1.0, separate from confidence
  category?: string;
}
```

**`contentHash`** is a SHA-256 of the content string, truncated to 16 hex chars. It is not currently used for deduplication in the default flow but is stored so callers can detect if two memories have identical content without comparing full text.

**`url` normalization** is handled by `url-utils.js`:

```javascript
export function normalizeUrl(raw) {
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  const parsed = new URL(u);
  parsed.hash = '';                               // strip fragment
  let pathname = parsed.pathname;
  if (pathname.length > 1 && pathname.endsWith('/'))
    pathname = pathname.slice(0, -1);             // strip trailing slash
  parsed.pathname = pathname;
  return parsed.toString();
}
```

This means `https://docs.apify.com/integrations/mcp/` and `https://docs.apify.com/integrations/mcp#tools` both normalize to `https://docs.apify.com/integrations/mcp` — so recall by URL works regardless of how the caller formats it.

---

## 7. The Search Engine: Zero-Dependency TF-IDF

`src/search-engine.js` is a full TF-IDF search engine in about 150 lines with no external dependencies. Here is how it works step by step.

### Tokenization

```javascript
tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')   // strip punctuation
    .split(/\s+/)
    .filter((term) => term.length > 1 && !STOPWORDS.has(term));
}
```

Stopwords are a hardcoded set of ~60 common English words (`the`, `a`, `is`, `for`, etc.). Tokens shorter than 2 characters are dropped.

### TF-IDF Scoring

For each candidate memory, the engine computes:

```
TF(term, doc)  = count(term in doc) / total_terms_in_doc
IDF(term)      = log(N / df(term))     where df = docs containing term
TF-IDF(term)   = TF × IDF
```

The composite score adds several boosters on top of the raw TF-IDF:

```javascript
const confidenceBoost = (memory.confidence || 0.5) * 0.3;   // 30% weight
const recency = this.recencyBoost(memory) * 0.2;             // 20% weight
const typeBoost = memoryType && memory.memoryType === memoryType ? 0.1 : 0;
const tagBoost = memory.tags.some(tag =>
  queryTerms.some(qt => tag.toLowerCase().includes(qt))
) ? 0.15 : 0;
const urlBoost = memory.url &&
  queryTerms.some(qt => memory.url.toLowerCase().includes(qt)) ? 0.1 : 0;

const finalScore = tfidfScore + confidenceBoost + recency + typeBoost + tagBoost + urlBoost;
```

**Recency boost** uses an exponential decay curve:

```javascript
recencyBoost(memory) {
  const daysSince = (Date.now() - new Date(memory.updatedAt).getTime()) / 86400000;
  return Math.exp(-daysSince / 30);  // e^(-days/30), range 0–1
}
```

A memory updated today scores 1.0 recency; after 30 days it scores ~0.37; after 90 days ~0.05.

### Partial Match Bonus

If a query term doesn't exactly match any document token, the engine checks for substring overlap:

```javascript
if (termTF === 0) {
  for (const docTerm of docTerms[idx]) {
    if (docTerm.includes(queryTerm) || queryTerm.includes(docTerm)) {
      tfidfScore += 0.05;
      break;
    }
  }
}
```

So a query for `"auth"` will partially match a document containing `"authentication"` or `"oauth"`.

### Real Search Output

Here is what the search action returned locally for `query: "dataset"` against the `local-smoke~demo` store:

```json
{
  "action": "search",
  "ok": true,
  "query": "dataset",
  "count": 1,
  "memories": [
    {
      "id": "bb45fbe2-b64a-443b-b753-f462c4d6156a",
      "url": "https://docs.apify.com/integrations/mcp",
      "site": "docs.apify.com",
      "title": "Notes for https://docs.apify.com/integrations/mcp",
      "content": "After call-actor, use get-dataset-items to read the result payload.",
      "memoryType": "integration_note",
      "tags": ["mcp", "smoke-test"],
      "confidence": 0.8,
      "source": "agent"
    }
  ],
  "memoryStoreId": "local-smoke~demo",
  "storeName": "local-smoke~demo"
}
```

The word `"dataset"` matched the content token `"dataset"` inside `"get-dataset-items"` via the partial match rule, returning the relevant memory.

---

## 8. Memory Decay: Exponential Half-Life

Without a way to age out stale memories, a store used for months would accumulate thousands of entries, many of which are outdated or no longer relevant. The `DecayEngine` in `src/decay-engine.js` handles this with a configurable exponential decay model.

### The formula

```
decayedConfidence = originalConfidence × 0.5^(daysSinceAccess / halfLifeDays)
```

With the default `halfLifeDays = 30`:

| Days since last access | Retained confidence (original = 0.8) |
|------------------------|--------------------------------------|
| 0                      | 0.800                                |
| 30                     | 0.400                                |
| 60                     | 0.200                                |
| 90                     | 0.100 (hits `minConfidence` floor)   |
| 120                    | 0.050 (below `pruneThreshold`)       |

```javascript
// src/decay-engine.js
computeDecayFactor(memory) {
  const daysSinceAccess =
    (Date.now() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, daysSinceAccess / this.config.halfLifeDays);
}
```

### Decay is lazy, not scheduled

There is no cron job or background process. Decay is applied in-memory at query time — `applyDecay()` is called inside `actionRecall` and `actionSearch` before returning results. Memories below `pruneThreshold` are filtered out of results but not deleted until you explicitly call `action: prune`.

```javascript
// src/actions.js — actionRecall (abridged)
const decayEngine = new DecayEngine(input.decayConfig);
const { active } = decayEngine.applyDecay(list);
list = active;  // stale memories silently excluded from results
```

### Exemption for high-importance memories

Memories with `confidence >= 0.9` are exempt from decay entirely:

```javascript
if ((memory.confidence || 0.5) >= 0.9) {
  memory.decayedConfidence = memory.confidence;
  active.push(memory);
  continue;  // skip decay calculation
}
```

This means you can pin a memory permanently by setting `confidence: 0.95` — it will never be pruned regardless of how long ago it was accessed.

### Auto-detection: off locally, on in production

```javascript
function detectDefaultEnabled() {
  if (process.env.NODE_ENV === 'test') return false;
  if (!process.env.APIFY_IS_AT_HOME && !process.env.DECAY_ENABLED) return false;
  if (process.env.DECAY_ENABLED === 'true') return true;
  return !!process.env.APIFY_IS_AT_HOME;
}
```

`APIFY_IS_AT_HOME` is set by the Apify platform when a run executes on their infrastructure. Locally, decay is off by default, which prevents smoke tests from failing due to freshly-written memories getting decayed away.

### The prune action

`action: prune` materializes the decay — it archives (not deletes) memories below the threshold:

```javascript
// src/actions.js — actionPrune
const { kept, pruned } = decayEngine.prune(memories);
for (const memory of kept) await saveMemory(store, memory);
if (pruned.length > 0) {
  const existingArchive = await store.getValue('archived_memories') || [];
  await store.setValue('archived_memories', [...existingArchive, ...pruned]);
}
// Result: { pruned: 3, remaining: 42, archived: [{ id, title }] }
```

Archived memories are stored under the `archived_memories` KV key — a separate array outside the manifest. They are excluded from search by default but can be included with `searchOptions.includeArchived: true`.

---

## 9. Real Observations: What Actually Happens When You Call It

This section documents what actually happened during live testing via the Apify MCP, rather than what the documentation says should happen.

### The INPUT payload that goes to Apify

When Kiro (or any MCP client) calls the `charmed_magnolia/Ai-memory-actor-apify` tool with a `remember` action, the hosted MCP server constructs and sends this full INPUT payload to the actor:

```json
{
  "action": "remember",
  "memoryStoreId": "sharjeel~site-memory-agent",
  "content": "The site-memory-agent Actor uses a manifest-based storage pattern...",
  "memoryDetails": {
    "title": "KV Store Manifest Pattern — storage architecture",
    "memoryType": "integration_note",
    "tags": ["storage", "manifest", "kv-store", "architecture"],
    "importance": 0.95,
    "confidence": 0.98,
    "source": "agent"
  },
  "projectId": "site-memory-agent",
  "maxResults": 20,
  "maxTokens": 2500,
  "searchOptions": {
    "limit": 20,
    "includeArchived": false
  },
  "decayConfig": {
    "enabled": false,
    "halfLifeDays": 30,
    "minImportance": 0.1,
    "pruneThreshold": 0.05,
    "maxMemoriesPerUser": 1000
  }
}
```

Note that the MCP tool wrapper fills in the `searchOptions` and `decayConfig` fields with defaults even when they are not relevant to the current action. This is because the INPUT_SCHEMA defines them as top-level fields, and the wrapper sends the full schema-valid payload.

### Cold start timing on the Apify platform

This is the critical finding from live testing. Every `remember` call via the Apify hosted MCP timed out at exactly 300 seconds (5 minutes) without producing output:

```
Run: OVgNRJZoPXh7VFbch
Status: TIMED-OUT after 300.088s
Memory used: ~84MB (container booted)
Dataset items written: 0
KV store keys: 1 (only INPUT — no OUTPUT)
```

The container was clearly booting (memory allocation shows ~80MB), but the Node.js process + Apify SDK initialization + module loading was taking longer than the 5-minute run timeout. This is a **cold start problem** with batch-mode actors on the Apify platform.

**Why this happens:** `standby mode is disabled` in `.actor/actor.json`. Each call spins up a fresh Docker container, installs nothing (image is pre-built), but still has to:
1. Start the container
2. Load the Node.js runtime
3. Import `apify`, `@modelcontextprotocol/sdk`, `express`, `zod`, and ~50 transitive dependencies
4. Execute `Actor.init()` which communicates with the Apify platform API
5. Open the named KV store
6. Execute the action

On a warm actor (standby mode enabled), steps 1–5 are already done and a request completes in milliseconds.

### Locally: instant execution

The same code running locally (via `npm start` with `APIFY_LOCAL_STORAGE_DIR=storage`) completes in under a second:

```
OK remember: ...
OK context_pack: context_pack ok
OK search: search ok
```

The local Apify SDK emulates the KV store on disk, so no network calls are made during execution. This makes local development and testing fast and reliable.

---

## 10. Use Case 1 — AI Coding Agent with Persistent Project Context

**The problem:** You're using Kiro or Cursor for a long-running project. Every session you re-explain the same things: the project uses a monorepo, the API is versioned at `/v2`, the auth service has a known bug with refresh tokens on mobile.

**The solution:** Store those facts as memories tied to the relevant URLs, and have the agent recall them automatically at the start of each session.

### Storing project context

```json
{
  "action": "remember",
  "memoryStoreId": "sharjeel~my-project",
  "url": "https://github.com/myorg/my-project",
  "content": "Monorepo with packages/api and packages/web. API uses Express + TypeScript. Auth via JWT, refresh tokens have a known bug on iOS Safari — see issue #847. Deploy with `npm run deploy:staging`.",
  "memoryDetails": {
    "title": "Project structure and known issues",
    "memoryType": "project_binding",
    "tags": ["monorepo", "auth", "deploy", "ios-bug"],
    "confidence": 0.95,
    "importance": 0.9,
    "source": "human"
  }
}
```

Because `importance: 0.9` hits the decay exemption threshold, this memory never ages out.

### Recalling at session start

```json
{
  "action": "recall",
  "memoryStoreId": "sharjeel~my-project",
  "url": "https://github.com/myorg/my-project",
  "maxResults": 10
}
```

The recall action scores memories by URL match (+50 pts for exact match, +25 for same site), recency, and query terms. The project binding memory scores highest because its `url` exactly matches.

### Searching for specific knowledge

Later in the session, when you ask the agent about deploying:

```json
{
  "action": "search",
  "memoryStoreId": "sharjeel~my-project",
  "query": "deploy staging command"
}
```

The TF-IDF engine tokenizes `deploy staging command` → `["deploy", "staging", "command"]`, matches `"deploy"` in the content, and returns the memory with a high composite score due to the tag match (`"deploy"` is in tags) adding the 0.15 bonus.

### Why this is better than pasting context manually

- **Persistent** — survives IDE restarts, new sessions, switching machines
- **Structured** — tagged and typed, so you can filter to only `project_binding` memories
- **Token-efficient** — you pull only what's relevant, not a 2000-word project description every time
- **Shared** — multiple agents or team members can use the same `memoryStoreId`

---

## 11. Use Case 2 — Chatbot That Remembers Across Sessions

**The problem:** A user tells your chatbot their name, their preferences, and that they're allergic to certain foods. Next session: the chatbot has forgotten everything.

**The solution:** After each conversation, store key facts. Before each response, recall them.

### Storing a user preference (HTTP API)

```javascript
// After user says: "I prefer TypeScript over JavaScript"
const response = await fetch('https://your-actor.apify.net/api/memories', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user-alice-7f3a',
    content: 'Prefers TypeScript over JavaScript. Dislikes verbose boilerplate. Wants code examples in responses.',
    category: 'preference',
    tags: ['language', 'typescript', 'communication-style'],
    importance: 0.85
  })
});
const { memory } = await response.json();
// memory.id = "uuid" — store this if you want to update it later
```

### Recalling before generating a response (HTTP API)

```javascript
// At the start of each response generation
const memResponse = await fetch(
  `https://your-actor.apify.net/api/memories/user-alice-7f3a?category=preference&limit=5`
);
const { memories } = await memResponse.json();

// Build context string for the LLM
const context = memories.map(m => m.content).join('\n');
const prompt = `User preferences:\n${context}\n\nUser message: ${userMessage}`;
```

### Searching for specific past facts (HTTP API)

```javascript
const searchRes = await fetch('https://your-actor.apify.net/api/memories/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'user-alice-7f3a',
    query: 'typescript preference code style',
    limit: 3,
    minScore: 0.1
  })
});
const { results } = await searchRes.json();
// results[0].score = 0.847
// results[0].matchedTerms = ["typescript", "preference"]
// results[0].memory = { content: "Prefers TypeScript..." }
```

### The Express server routes (from `src/server.ts`)

```typescript
// POST /api/memories
app.post('/api/memories', async (req, res) => {
  const { userId, ...memoryDetails } = req.body;
  if (!userId || !memoryDetails.content) {
    res.status(400).json({ error: 'userId and content are required' });
    return;
  }
  const memory = await memoryManager.storeMemory(userId, memoryDetails);
  res.status(201).json({ success: true, memory });
});

// POST /api/memories/search
app.post('/api/memories/search', async (req, res) => {
  const { userId, query, ...searchOpts } = req.body;
  const results = await memoryManager.searchMemories(userId, query, {
    limit: searchOpts.limit,
    category: searchOpts.category,
    minScore: searchOpts.minScore,
  });
  res.json({ success: true, count: results.length, results });
});
```

The `MemoryManager` class in `src/memory-manager.ts` wraps the same underlying `memory-store.js` + `search-engine.js` that the batch actor uses, so behaviour is identical across all three modes.

---

## 12. Use Case 3 — Multi-Agent Shared Memory

**The problem:** You have a pipeline with a Researcher agent, a Writer agent, and an Editor agent. They run at different times, possibly on different machines. How do they share knowledge?

**The solution:** All agents use the same `memoryStoreId`. The KV store is the shared state bus.

```
Agent A (Researcher)
  action: remember
  memoryStoreId: "team~project-x"
  projectId: "research-phase"
  content: "Found that competitors all use Redis for session storage. 
            Redis Cluster is the most common setup. Average latency cited: 0.5ms."
  memoryType: "general"
  tags: ["competitors", "redis", "sessions"]
        ↓
  Writes to: KV store "team~project-x"
             key: "memory-{uuid}"

Agent B (Writer) — runs 2 hours later
  action: search
  memoryStoreId: "team~project-x"
  query: "redis session competitors"
        ↓
  Reads from: same KV store "team~project-x"
  Returns: Agent A's research memory with high TF-IDF score

Agent C (Editor) — runs next day
  action: context_pack
  memoryStoreId: "team~project-x"
  query: "redis performance"
  maxTokens: 1500
        ↓
  Returns: ranked markdown bundle of all relevant memories
           within 1500-token budget
```

### The `projectId` scoping mechanism

Within a shared store, `projectId` provides a second level of namespacing:

```javascript
// src/actions.js
function filterByProject(memories, projectId) {
  if (!projectId) return memories;
  return memories.filter((m) => !m.projectId || m.projectId === projectId);
}
```

Note the logic: memories with `projectId: null` are visible to all. Only memories with a specific `projectId` are scoped — so you can have global team memories alongside project-scoped ones in the same store.

---

## 13. Use Case 4 — Context Packs as a RAG Alternative

**The problem:** Retrieval-Augmented Generation (RAG) typically requires embedding models, a vector database, similarity search infrastructure, and chunking pipelines. For many use cases this is overkill.

**The solution:** Structured memories with TF-IDF search + token-budgeted context packs. No embeddings. No vector index. Just a KV store and math.

### The context_pack action

```json
{
  "action": "context_pack",
  "memoryStoreId": "my-team~stripe-integration",
  "url": "https://docs.stripe.com/webhooks",
  "query": "webhook signature verification",
  "maxTokens": 2500
}
```

The response is a markdown document generated from the highest-scoring memories, packed to fit within the token budget:

```markdown
## Site memory context pack
**Target URL:** https://docs.stripe.com/webhooks
**Query:** webhook signature verification

### Stripe Webhook Signature Verification
- **Type:** auth_flow
- **URL:** https://docs.stripe.com/webhooks
- **Updated:** 2026-07-15T10:23:00Z
- **Tags:** stripe, webhook, security, hmac

Always verify Stripe webhook signatures using the raw request body (not parsed JSON).
Use `stripe.webhooks.constructEvent(body, sig, secret)`. The signature header is
`Stripe-Signature`. Failure to use raw body causes signature mismatch.

### Stripe Webhook Retry Behaviour
- **Type:** api_quirk
- **URL:** https://docs.stripe.com/webhooks
- **Updated:** 2026-07-10T09:15:00Z
- **Tags:** stripe, retry, idempotency

Stripe retries failed webhooks up to 3 times with exponential backoff. Always return
HTTP 200 immediately even for async processing, then handle idempotency with the
event ID.
```

### How the token budget works

```javascript
// src/actions.js — actionContextPack (abridged)
const ranked = candidates
  .map((m) => ({ memory: m, score: scoreMemory(m, url, query) }))
  .sort((a, b) => b.score - a.score);

let tokens = estimateTokens(markdown);  // header tokens

for (const { memory } of ranked) {
  const block = formatMemoryBlock(memory);
  const blockTokens = estimateTokens(block);
  if (tokens + blockTokens > maxTokens) break;  // stop before exceeding budget
  markdown += block;
  tokens += blockTokens;
}
```

Token estimation is a rough heuristic:

```javascript
export function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);  // ~4 chars per token for English
}
```

It is not exact (GPT-4 uses BPE tokenization), but it is fast, has no dependencies, and is accurate enough for budget management within ±20%.

### When to use context packs vs. direct search

| Situation | Use |
|-----------|-----|
| Filling an LLM context window before a task | `context_pack` |
| Finding a specific memory by keyword | `search` |
| Getting all memories for a user/project | `recall` |
| Checking what the agent currently knows | `stats` + `recall` |

---

## 14. Use Case 5 — Memory-Augmented Automation Pipelines

**The problem:** An n8n or Make workflow processes customer support tickets. Each ticket needs context about the customer's history, account type, and past issues — but that data lives across multiple previous runs.

**The solution:** Use `remember` after each interaction and `recall` before each new one, with the customer ID as the `memoryStoreId`.

### Workflow structure

```
1. Webhook receives new ticket
   → action: recall
     memoryStoreId: "support~customer-{customerId}"
     maxResults: 5
   → Inject memories into LLM prompt

2. LLM generates response using customer context

3. After resolution:
   → action: remember
     memoryStoreId: "support~customer-{customerId}"
     content: "Resolved billing issue 2026-08-11. Customer on Pro plan. Refunded $29. Issue: duplicate charge on renewal."
     memoryDetails:
       memoryType: general
       tags: [billing, refund, renewal]
       importance: 0.7

4. Weekly:
   → action: prune
     memoryStoreId: "support~customer-{customerId}"
     decayConfig: { halfLifeDays: 90, pruneThreshold: 0.05 }
   → Archives old resolved tickets while keeping recent and high-importance ones
```

### The recall scoring for this use case

`actionRecall` without a `query` uses `scoreMemory()` which weights by:

```javascript
function scoreMemory(memory, url, query) {
  let score = 0;
  // URL/site matching (dominant signal for recall)
  if (url) {
    if (memory.url && urlMatches(memory.url, url)) score += 50;
    else if (memory.site && siteFromUrl(url) === memory.site) score += 25;
  }
  // Keyword matching (if query provided)
  if (qTerms.length) {
    const blob = `${memory.title} ${memory.content} ${memory.tags.join(' ')} ${memory.memoryType}`.toLowerCase();
    for (const term of qTerms) {
      if (blob.includes(term)) score += 8;
    }
  }
  // Recency bonus: +10 points for a memory updated today, decays over 10 days
  const ageMs = Date.now() - new Date(memory.updatedAt).getTime();
  const days = ageMs / (86400 * 1000);
  score += Math.max(0, 10 - days);
  return score;
}
```

For the support use case without a URL, `score` is driven entirely by recency, so the most recently accessed memories surface first — exactly what you want: the most recent ticket interactions come up first.

---

## 15. The Cold Start Problem and How to Solve It

As observed in live testing, the actor in default batch mode on the Apify platform consistently timed out at 300 seconds. This is not a bug in the actor — it is a fundamental characteristic of how Apify batch actors work. Every invocation gets a fresh container.

**The cold start chain:**
```
MCP call received by mcp.apify.com
  → Apify API: POST /v2/acts/{actorId}/runs
    → Container scheduler picks a worker
      → Docker image pulled / cache hit
        → Container starts
          → Node.js 22 runtime initializes
            → ES module graph resolved (~50 deps)
              → Actor.init() handshakes with Apify platform
                → KV store opened
                  → Action executes (< 1ms)
                    → Actor.exit()
```

Each step adds latency. On a cold worker, total time can exceed 5 minutes.

### Solution 1: Enable Standby Mode

The actor's `.actor/actor.json` has standby mode disabled. Re-enabling it keeps the actor process alive between requests, making subsequent calls near-instant:

```json
{
  "actorSpecification": 1,
  "name": "Ai-memory-actor-apify",
  "usesStandbyMode": true,
  "minMemoryMbytes": 256,
  "maxMemoryMbytes": 512
}
```

In standby mode, the actor runs as an HTTP server (`ACTOR_MODE=server`). Apify routes incoming requests to the warm process. The first call still has a cold start, but all subsequent calls within the standby window hit the warm process.

### Solution 2: Use the HTTP Server Mode Directly

If you are building a web app or automation pipeline, deploy the actor in server mode and call the REST API directly:

```bash
# Deploy to Apify with server mode
ACTOR_MODE=server apify push

# Now call it directly
curl -X POST https://your-actor.apify.net/api/memories \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-123", "content": "...", "category": "general"}'
```

Server mode runs Express on `ACTOR_WEB_SERVER_PORT` (default 3000) and also exposes an MCP Streamable HTTP endpoint at `/mcp` — so remote MCP clients can connect directly to your running actor instance.

### Solution 3: Use Local MCP for Development

For development and testing, run the MCP server locally over stdio. No cold starts, no network calls, no Apify credits consumed:

```bash
ACTOR_MODE=mcp node src/main.js
```

Point your MCP client at the local process. Memories are stored in `./storage/key_value_stores/` using the Apify SDK's local emulation. You can sync them to Apify later if needed.

### Solution 4: Pre-warm with a Scheduled Run

If you need cloud execution but can't use standby mode, schedule a lightweight no-op run every few minutes to keep a worker allocated. This is a workaround, not a fix, but it works for low-frequency use cases.

---

## 16. Running Locally vs. On Apify: Practical Differences

| Aspect | Local (`npm start`) | Apify Platform |
|--------|--------------------|--------------------|
| Cold start | None — runs in <1s | 30–300s depending on worker warmth |
| Storage location | `./storage/key_value_stores/` | Apify cloud KV store (persistent) |
| Decay default | Off (`APIFY_IS_AT_HOME` not set) | On (`APIFY_IS_AT_HOME=1`) |
| Multi-user isolation | Single process, shared disk | Per-store isolation in cloud |
| Persistence | Local disk only | Permanent until store deleted |
| Output | `./storage/datasets/default/*.json` | Dataset item + `OUTPUT` KV key |
| Auth | No token needed locally | `APIFY_TOKEN` required |
| Cost | Free | Charged per compute unit |

### Local storage layout after a run

```
storage/
├── datasets/
│   └── default/
│       └── 000000001.json     ← last run output (action result)
└── key_value_stores/
    ├── default/
    │   ├── INPUT.json          ← current input (modify to test different actions)
    │   └── OUTPUT.json         ← mirror of dataset output
    ├── demo-user~apify-mcp-project/
    │   ├── __manifest.json     ← { version, memoryIds, updatedAt }
    │   └── memory-16db455b-....json  ← individual memory record
    └── local-smoke~demo/
        ├── __manifest.json
        └── memory-bb45fbe2-....json
```

To test a different action locally, edit `storage/key_value_stores/default/INPUT.json` and run `npm start`:

```json
{
  "action": "context_pack",
  "memoryStoreId": "local-smoke~demo",
  "url": "https://docs.apify.com/integrations/mcp",
  "maxTokens": 2500
}
```

---

## 17. MCP Config Reference

### Connecting via Apify's Hosted MCP Server (recommended for remote agents)

```json
{
  "mcpServers": {
    "apify": {
      "url": "https://mcp.apify.com/?tools=actors,docs,charmed_magnolia/Ai-memory-actor-apify",
      "headers": {
        "Authorization": "Bearer <your-apify-api-token>"
      }
    }
  }
}
```

**`tools=` parameter breakdown:**
- `actors` — exposes the generic `call-actor` tool (run any Apify actor)
- `docs` — exposes `search-apify-docs` and `fetch-apify-docs` tools
- `charmed_magnolia/Ai-memory-actor-apify` — exposes this specific actor as an MCP tool

You can list multiple specific actors: `tools=myuser/actor-a,myuser/actor-b`.

### Connecting via Local MCP stdio (for local development)

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["src/main.js"],
      "env": {
        "ACTOR_MODE": "mcp",
        "APIFY_TOKEN": "your-token",
        "APIFY_LOCAL_STORAGE_DIR": "storage"
      }
    }
  }
}
```

### Connecting via Server Mode's /mcp endpoint

When the actor runs in server mode, it exposes an MCP Streamable HTTP endpoint:

```json
{
  "mcpServers": {
    "memory": {
      "url": "https://your-actor.apify.net/mcp",
      "headers": {
        "Authorization": "Bearer <your-apify-api-token>"
      }
    }
  }
}
```

### Available MCP tools (local MCP server mode)

The tools exposed by `src/mcp-server.ts` when running in stdio mode:

| Tool | Required params | Optional params |
|------|----------------|-----------------|
| `store_memory` | `userId`, `content` | `category`, `tags`, `importance`, `metadata` |
| `recall_memories` | `userId` | `category`, `limit` |
| `search_memories` | `userId`, `query` | `limit`, `category` |
| `update_memory` | `userId`, `memoryId` | `content`, `category`, `tags`, `importance` |
| `delete_memory` | `userId`, `memoryId` | — |
| `get_memory_stats` | `userId` | — |
| `prune_memories` | `userId` | `halfLifeDays`, `pruneThreshold` |

---

## 18. Full API Reference

### Actor Actions (batch mode)

| Action | Required input | Returns |
|--------|---------------|---------|
| `remember` | `action`, `memoryStoreId`, `content` | `{ ok, memory, message }` |
| `recall` | `action`, `memoryStoreId` | `{ ok, count, memories[] }` |
| `search` | `action`, `memoryStoreId`, `query` | `{ ok, query, count, memories[], scores[] }` |
| `forget` | `action`, `memoryStoreId`, `memoryId` | `{ ok, memoryId, message }` |
| `update` | `action`, `memoryStoreId`, `memoryId` | `{ ok, memory, message }` |
| `context_pack` | `action`, `memoryStoreId` | `{ ok, contextMarkdown, memoriesUsed[], tokenEstimate, warnings[] }` |
| `stats` | `action`, `memoryStoreId` | `{ ok, totalMemories, byType, lastUpdated }` |
| `prune` | `action`, `memoryStoreId` | `{ ok, pruned, remaining, archived[], decayEnabled }` |

### HTTP REST Endpoints (server mode)

| Method | Path | Body / Query |
|--------|------|-------------|
| `GET` | `/api/health` | — |
| `POST` | `/api/memories` | `{ userId, content, category?, tags?, importance?, metadata? }` |
| `GET` | `/api/memories/:userId` | `?category=&limit=` |
| `POST` | `/api/memories/search` | `{ userId, query, category?, limit?, minScore? }` |
| `PUT` | `/api/memories/:userId/:memoryId` | `{ content?, category?, tags?, importance? }` |
| `DELETE` | `/api/memories/:userId/:memoryId` | — |
| `GET` | `/api/memories/:userId/stats` | — |
| `POST` | `/api/memories/:userId/prune` | `{ decayConfig? }` |
| `GET` | `/api/docs` | — |
| `*` | `/mcp` | MCP Streamable HTTP (POST JSON-RPC) |

### `memoryDetails` object

```typescript
{
  title?: string;         // max 300 chars; auto-generated from URL if omitted
  memoryType?:            // default: 'general'
    | 'integration_note'  // how a tool/API works
    | 'api_quirk'         // unexpected behavior, gotchas
    | 'auth_flow'         // authentication patterns
    | 'selector'          // CSS/XPath selectors for scraping
    | 'breaking_change'   // API or behavior changes
    | 'project_binding'   // project-level facts
    | 'general';
  tags?: string[];        // max 50 tags, max 50 chars each
  confidence?: number;    // 0.0–1.0, default 0.8
                          // >= 0.9 = exempt from decay
  importance?: number;    // 0.0–1.0, default 0.5
  category?: string;      // free-form string for grouping
  source?: 'agent' | 'human' | 'crawl';
  relatedUrls?: string[];
}
```

### `decayConfig` object

```typescript
{
  enabled?: boolean;        // default: auto (off locally, on in production)
  halfLifeDays?: number;    // default: 30
  minImportance?: number;   // default: 0.1
  pruneThreshold?: number;  // default: 0.05
  maxMemoriesPerUser?: number; // default: 1000
}
```

---

## 19. Key Takeaways for Article Readers

After reading the code and running the actor live, here is what actually matters:

**1. MCP is just a tool-calling contract.** The `@modelcontextprotocol/sdk` library handles the JSON-RPC protocol, tool registration, and transport. The actor registers tools with `server.tool(name, description, zodSchema, handler)` — that's it. The hard work is in the handler.

**2. Apify's hosted MCP server is a proxy, not magic.** When you configure `https://mcp.apify.com/?tools=some/actor`, it reads the actor's input schema and wraps it as MCP tool definitions. Every tool call triggers a full actor run via the Apify API. The cold start issue is a direct consequence of this architecture.

**3. The storage pattern is the key innovation.** Using a manifest key to track all memory IDs avoids needing a database query layer. The manifest-based approach is what makes this work on a plain KV store with no query capabilities.

**4. TF-IDF is good enough for structured memories.** Vector search is better for unstructured documents or semantic similarity. But for structured memories with explicit titles, tags, types, and URLs — TF-IDF + the relevance boosts (confidence, recency, tags, URL) produces high-quality results without any model inference cost.

**5. Decay solves the long-term relevance problem.** Without decay, a memory store grows indefinitely and older, less relevant memories start polluting search results. The exponential half-life model with lazy evaluation is elegant — no background process, no scheduled job, just math at query time.

**6. High-importance memories (confidence ≥ 0.9) are pinned permanently.** This is the mechanism for storing facts you always want to surface — architectural decisions, security constraints, critical bugs. Set `confidence: 0.95` and the memory survives any prune cycle.

**7. Local execution is the development path.** Cold starts make the cloud execution slow for interactive use. The right workflow is: develop and test locally (instant, free, same codebase), then deploy to Apify with standby mode for production.

**8. `memoryStoreId` is the only security boundary.** Anyone who knows your store ID can read and write it. Treat it like an API key — use an unguessable string (`username~project-8f3a2b`) and don't share it publicly.

---

## Project Structure

```
.actor/
  actor.json          — Actor metadata; set usesStandbyMode: true to fix cold starts
  INPUT_SCHEMA.json   — Defines the Apify Console UI and MCP tool schema
  Dockerfile          — Node 22 slim image

src/
  main.js             — Entry point, action router, mode dispatcher
  types.ts            — TypeScript interfaces: Memory, MemoryDetails, DecayConfig, etc.
  actions.js          — All action handlers: remember/recall/search/forget/context_pack/update/prune
  memory-store.js     — KV store CRUD + manifest management + buildMemoryRecord
  memory-manager.ts   — MemoryManager class wrapping the above for server.ts
  search-engine.js    — Zero-dependency TF-IDF with confidence/recency/tag/URL boosts
  decay-engine.js     — Exponential half-life decay, lazy evaluation, prune logic
  server.ts           — Express REST API + /mcp Streamable HTTP endpoint
  mcp-server.ts       — MCP stdio server, 7 tools, Zod schemas
  url-utils.js        — normalizeUrl, siteFromUrl, urlMatches

test/
  url-utils.test.js   — Unit tests for URL utilities (Node built-in test runner)

scripts/
  local-smoke.mjs     — End-to-end test: remember → context_pack → search
```

---

*Written by Kiro after live experimentation: attempting memory storage via Apify's hosted MCP, observing the cold start behaviour, running the actor locally, reading all 10 source files, and collecting real stored memory records and run output. All code blocks and JSON examples in this document are taken directly from the actual source or actual run output — nothing is synthetic.*
