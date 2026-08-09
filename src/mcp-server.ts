/**
 * MCP server exposing site-memory tools via the Model Context Protocol.
 *
 * Transports:
 *   - stdio  (default) — local agent integration
 *   - sse    — HTTP-based integration via SSEServerTransport
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { Actor, log } from 'apify';
import {
  actionForget,
  actionPrune,
  actionRecall,
  actionRemember,
  actionSearch,
  actionUpdate,
} from './actions.js';
import {
  estimateTokens,
  loadAllMemories,
  sanitizeStoreName,
} from './memory-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result returned by searchMemories for each matched memory. */
export interface SearchResult {
  memory: Record<string, unknown>;
  score: number;
  matchedTerms: string[];
}

/** Configuration for temporal decay / pruning. */
export interface DecayConfig {
  halfLifeDays: number;
  pruneThreshold: number;
}

// ---------------------------------------------------------------------------
// MemoryManager — thin adapter delegating to the shared action handlers
// (actions.js), so MCP tools, HTTP endpoints and batch runs all use the same
// SearchEngine/DecayEngine logic and return identical rankings.
// ---------------------------------------------------------------------------

export class MemoryManager {
  private store: any;

  constructor(store: any) {
    this.store = store;
  }

  /** Store a new memory via the shared remember action. */
  async storeMemory(params: {
    userId: string;
    content: string;
    url?: string;
    category?: string;
    tags?: string[];
    importance?: number;
    metadata?: object;
  }) {
    return actionRemember(this.store, {
      content: params.content,
      url: params.url ?? (params.metadata as any)?.url ?? null,
      projectId: params.userId,
      memoryDetails: {
        title: (params.metadata as any)?.title ?? '',
        memoryType: params.category ?? 'general',
        tags: params.tags ?? [],
        confidence: params.importance ?? 0.8,
        source: 'agent',
        relatedUrls: (params.metadata as any)?.relatedUrls ?? [],
      },
    });
  }

  /** Retrieve memories for a user via the shared recall action. */
  async recallMemories(params: {
    userId: string;
    category?: string;
    limit?: number;
  }) {
    return actionRecall(this.store, {
      projectId: params.userId,
      memoryType: params.category,
      maxResults: params.limit ?? 20,
    });
  }

  /**
   * Search memories using the shared TF-IDF SearchEngine (via actionSearch).
   * Signature: searchMemories(userId, query, options?) => SearchResult[]
   */
  async searchMemories(
    userId: string,
    query: string,
    options?: { limit?: number; category?: string },
  ): Promise<SearchResult[]> {
    const result = await actionSearch(this.store, {
      query,
      projectId: userId,
      memoryType: options?.category,
      maxResults: options?.limit ?? 20,
    });
    return result.memories.map((memory: Record<string, unknown>, i: number) => ({
      memory,
      score: result.scores[i]?.score ?? 0,
      matchedTerms: result.scores[i]?.matchedTerms ?? [],
    }));
  }

  /** Update an existing memory by id via the shared update action. */
  async updateMemory(params: {
    userId: string;
    memoryId: string;
    content?: string;
    category?: string;
    tags?: string[];
    importance?: number;
  }) {
    return actionUpdate(this.store, {
      memoryId: params.memoryId,
      content: params.content,
      updates: {
        memoryType: params.category,
        tags: params.tags,
        confidence: params.importance,
      },
    });
  }

  /** Delete a specific memory by id via the shared forget action. */
  async deleteMemory(params: { userId: string; memoryId: string }) {
    return actionForget(this.store, { memoryId: params.memoryId });
  }

  /** Get memory statistics for a user. */
  async getMemoryStats(params: { userId: string }) {
    const { memories } = await loadAllMemories(this.store);
    const userMemories = memories.filter(
      (m) => !m.projectId || m.projectId === params.userId,
    );

    const byType: Record<string, number> = {};
    const bySite: Record<string, number> = {};
    let totalTokens = 0;

    for (const m of userMemories) {
      byType[m.memoryType] = (byType[m.memoryType] ?? 0) + 1;
      if (m.site) bySite[m.site] = (bySite[m.site] ?? 0) + 1;
      totalTokens += estimateTokens(m.content);
    }

    return {
      ok: true,
      userId: params.userId,
      totalMemories: userMemories.length,
      byType,
      bySite,
      totalTokensEstimated: totalTokens,
      oldestMemory: userMemories.length
        ? userMemories.reduce((a, b) =>
            a.createdAt < b.createdAt ? a : b,
          ).createdAt
        : null,
      newestMemory: userMemories.length
        ? userMemories.reduce((a, b) =>
            a.createdAt > b.createdAt ? a : b,
          ).createdAt
        : null,
    };
  }

  /**
   * Apply temporal decay and prune via the shared DecayEngine (actionPrune).
   * Note: prune operates on the whole bound store — one store = one scope.
   * Signature: pruneMemories(userId, config?) => { pruned, remaining, archived }
   */
  async pruneMemories(
    userId: string,
    config?: Partial<DecayConfig>,
  ): Promise<{
    pruned: number;
    remaining: number;
    archived: Array<{ id: string; title: string }>;
  }> {
    const result = await actionPrune(this.store, {
      decayConfig: {
        enabled: true,
        halfLifeDays: config?.halfLifeDays ?? 30,
        pruneThreshold: config?.pruneThreshold ?? 0.1,
      },
    });
    return {
      pruned: result.pruned,
      remaining: result.remaining,
      archived: result.archived,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool registration helpers
// ---------------------------------------------------------------------------

/** Wrap a result object as MCP text content. */
function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/** Wrap an error as MCP error content. */
function jsonError(message: string) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ ok: false, error: message }),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

/**
 * Create an MCP server instance with all memory tools registered.
 * Shared by the stdio transport and the /mcp HTTP endpoint.
 */
export function createMemoryMcpServer(manager: MemoryManager): McpServer {
  const server = new McpServer({
    name: 'site-memory-agent',
    version: '0.1.0',
  });

  // ---- store_memory ----
  server.tool(
    'store_memory',
    'Store a new memory for a user. Use this when an agent learns something new about a site, project, or workflow and wants to persist it for future recall. Supports optional categorisation, tags, importance weighting, and arbitrary metadata.',
    {
      userId: z.string().describe('Unique identifier for the user or project scope.'),
      content: z.string().describe('The memory content to store. Must be non-empty.'),
      url: z.string().optional().describe('Optional page URL to scope this memory to. Normalized and used for site matching in recall/search.'),
      category: z.string().optional().describe('Category/type of memory (e.g. "integration_note", "api_quirk", "selector").'),
      tags: z.array(z.string()).optional().describe('Tags for easier retrieval and grouping.'),
      importance: z.number().min(0).max(1).optional().describe('Importance score between 0 and 1 (default 0.8). Higher values resist decay.'),
      metadata: z.record(z.string(), z.unknown()).optional().describe('Arbitrary metadata object (e.g. { url, title, relatedUrls }).'),
    },
    async (args) => {
      try {
        const result = await manager.storeMemory(args);
        return jsonResult(result);
      } catch (err: any) {
        return jsonError(err.message ?? String(err));
      }
    },
  );

  // ---- recall_memories ----
  server.tool(
    'recall_memories',
    'Retrieve stored memories for a user, optionally filtered by category. Returns the most recently updated memories first. Use this to surface context an agent has previously saved.',
    {
      userId: z.string().describe('Unique identifier for the user or project scope.'),
      category: z.string().optional().describe('Filter by memory category/type.'),
      limit: z.number().int().positive().optional().describe('Maximum number of memories to return (default 20).'),
    },
    async (args) => {
      try {
        const result = await manager.recallMemories(args);
        return jsonResult(result);
      } catch (err: any) {
        return jsonError(err.message ?? String(err));
      }
    },
  );

  // ---- search_memories ----
  server.tool(
    'search_memories',
    'Search memories using TF-IDF scoring. Use this when an agent needs to find relevant past knowledge by keyword or natural-language query. Results are ranked by relevance and recency.',
    {
      userId: z.string().describe('Unique identifier for the user or project scope.'),
      query: z.string().describe('Search query string. Supports multi-term queries.'),
      limit: z.number().int().positive().optional().describe('Maximum number of results to return (default 20).'),
      category: z.string().optional().describe('Restrict search to a specific memory category.'),
    },
    async (args) => {
      try {
        const { userId, query, limit, category } = args;
        const results = await manager.searchMemories(userId, query, {
          limit,
          category,
        });
        return jsonResult({
          ok: true,
          query,
          count: results.length,
          results: results.map((r) => ({
            memory: r.memory,
            score: Math.round(r.score * 1000) / 1000,
            matchedTerms: r.matchedTerms,
          })),
        });
      } catch (err: any) {
        return jsonError(err.message ?? String(err));
      }
    },
  );

  // ---- update_memory ----
  server.tool(
    'update_memory',
    'Update an existing memory by its ID. Use this to correct, refine, or augment a previously stored memory without creating a duplicate.',
    {
      userId: z.string().describe('Unique identifier for the user or project scope.'),
      memoryId: z.string().describe('The ID of the memory to update.'),
      content: z.string().optional().describe('New content for the memory. Omit to keep existing content.'),
      category: z.string().optional().describe('New category for the memory.'),
      tags: z.array(z.string()).optional().describe('New tags for the memory.'),
      importance: z.number().min(0).max(1).optional().describe('New importance score between 0 and 1.'),
    },
    async (args) => {
      try {
        const result = await manager.updateMemory(args);
        return jsonResult(result);
      } catch (err: any) {
        return jsonError(err.message ?? String(err));
      }
    },
  );

  // ---- delete_memory ----
  server.tool(
    'delete_memory',
    'Delete a specific memory by its ID. Use this when a memory is no longer relevant or was stored incorrectly and needs to be removed entirely.',
    {
      userId: z.string().describe('Unique identifier for the user or project scope.'),
      memoryId: z.string().describe('The ID of the memory to delete.'),
    },
    async (args) => {
      try {
        const result = await manager.deleteMemory(args);
        return jsonResult(result);
      } catch (err: any) {
        return jsonError(err.message ?? String(err));
      }
    },
  );

  // ---- get_memory_stats ----
  server.tool(
    'get_memory_stats',
    'Get statistics about stored memories for a user, including counts by type and site, token estimates, and date ranges. Useful for monitoring memory health and deciding when to prune.',
    {
      userId: z.string().describe('Unique identifier for the user or project scope.'),
    },
    async (args) => {
      try {
        const result = await manager.getMemoryStats(args);
        return jsonResult(result);
      } catch (err: any) {
        return jsonError(err.message ?? String(err));
      }
    },
  );

  // ---- prune_memories ----
  server.tool(
    'prune_memories',
    'Trigger temporal decay and prune low-scoring memories. Memories are scored using exponential decay based on age and a configurable half-life. Those below the prune threshold are archived and removed. Use this periodically to keep the memory store relevant.',
    {
      userId: z.string().describe('Unique identifier for the user or project scope.'),
      halfLifeDays: z.number().positive().optional().describe('Half-life in days for memory decay (default 30). Older memories lose score faster with smaller values.'),
      pruneThreshold: z.number().min(0).max(1).optional().describe('Minimum decay score to keep a memory (default 0.1). Memories below this are pruned.'),
    },
    async (args) => {
      try {
        const { userId, halfLifeDays, pruneThreshold } = args;
        const result = await manager.pruneMemories(userId, {
          halfLifeDays,
          pruneThreshold,
        });
        return jsonResult({
          ok: true,
          pruned: result.pruned,
          remaining: result.remaining,
          archived: result.archived,
        });
      } catch (err: any) {
        return jsonError(err.message ?? String(err));
      }
    },
  );

  return server;
}

/**
 * Start the MCP server with the given transport.
 *
 * @param transport  `'stdio'` (default) or `'sse'`.
 */
export async function startMcpServer(
  transport: 'stdio' | 'sse' = 'stdio',
): Promise<void> {
  // --- Initialise Apify Actor ---
  await Actor.init();

  const input = (await Actor.getInput()) as {
    memoryStoreId?: string;
  } | null;

  const memoryStoreId = input?.memoryStoreId ?? 'default-site-memory';
  const storeName = sanitizeStoreName(memoryStoreId);
  log.info('MCP server opening key-value store', { storeName });

  const kvStore = await Actor.openKeyValueStore(storeName);
  const manager = new MemoryManager(kvStore);
  const server = createMemoryMcpServer(manager);

  // --- Connect transport ---
  if (transport === 'sse') {
    // stdio mode cannot serve SSE. Remote MCP clients should use server mode
    // (ACTOR_MODE=server), which serves MCP over Streamable HTTP at /mcp,
    // or Apify's hosted MCP server. Fall back to stdio.
    log.warning('SSE transport is not available in stdio mode; use server mode (/mcp endpoint) or Apify hosted MCP for remote clients. Falling back to stdio.');
  }

  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  log.info('MCP server connected via stdio');
}

/**
 * Handle a single MCP Streamable HTTP request (used by the /mcp endpoint
 * in HTTP server mode). Stateless: a fresh server instance per request.
 */
export async function handleMcpHttpRequest(
  manager: MemoryManager,
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody?: unknown,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createMemoryMcpServer(manager);
  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}

// Allow running directly: node --import tsx src/mcp-server.ts
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /mcp-server\.(ts|js|mjs)$/.test(process.argv[1]);

if (isDirectRun) {
  startMcpServer().catch((err) => {
    console.error('MCP server failed:', err);
    process.exit(1);
  });
}
