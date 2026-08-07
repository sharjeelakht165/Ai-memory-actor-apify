/**
 * MCP server exposing site-memory tools via the Model Context Protocol.
 *
 * Transports:
 *   - stdio  (default) — local agent integration
 *   - sse    — HTTP-based integration via SSEServerTransport
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Actor, log } from 'apify';
import {
  buildMemoryRecord,
  deleteMemory,
  estimateTokens,
  loadAllMemories,
  saveMemory,
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
// MemoryManager — wraps existing memory-store helpers
// ---------------------------------------------------------------------------

export class MemoryManager {
  private store: any;

  constructor(store: any) {
    this.store = store;
  }

  /** Store a new memory (or update when memoryId is supplied). */
  async storeMemory(params: {
    userId: string;
    content: string;
    category?: string;
    tags?: string[];
    importance?: number;
    metadata?: object;
  }) {
    const record = buildMemoryRecord(
      {
        content: params.content,
        memoryDetails: {
          title: (params.metadata as any)?.title ?? '',
          memoryType: params.category ?? 'general',
          tags: params.tags ?? [],
          confidence: params.importance ?? 0.8,
          source: 'agent',
          relatedUrls: (params.metadata as any)?.relatedUrls ?? [],
        },
        url: (params.metadata as any)?.url ?? null,
        projectId: params.userId,
      },
      null,
    );

    await saveMemory(this.store, record);
    return { ok: true, memory: record, message: 'Memory saved' };
  }

  /** Retrieve memories for a user, optionally filtered by category. */
  async recallMemories(params: {
    userId: string;
    category?: string;
    limit?: number;
  }) {
    const { memories } = await loadAllMemories(this.store);
    const limit = params.limit ?? 20;

    let list = memories.filter(
      (m) => !m.projectId || m.projectId === params.userId,
    );

    if (params.category) {
      list = list.filter((m) => m.memoryType === params.category);
    }

    list = list
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, limit);

    return { ok: true, count: list.length, memories: list };
  }

  /**
   * Search memories using a TF-IDF–inspired scoring algorithm.
   * Signature: searchMemories(userId, query, options?) => SearchResult[]
   */
  async searchMemories(
    userId: string,
    query: string,
    options?: { limit?: number; category?: string },
  ): Promise<SearchResult[]> {
    const { memories } = await loadAllMemories(this.store);
    const limit = options?.limit ?? 20;
    const q = query.toLowerCase().trim();
    const qTerms = q.split(/\s+/).filter(Boolean);

    // --- IDF: inverse document frequency per term ---
    const N = Math.max(memories.length, 1);
    const docFreq = new Map<string, number>();
    for (const m of memories) {
      const blob = `${m.title} ${m.content} ${m.tags.join(' ')} ${m.memoryType}`.toLowerCase();
      for (const term of qTerms) {
        if (blob.includes(term)) {
          docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
        }
      }
    }

    let candidates = memories.filter(
      (m) => !m.projectId || m.projectId === userId,
    );
    if (options?.category) {
      candidates = candidates.filter((m) => m.memoryType === options.category);
    }

    const scored: SearchResult[] = [];

    for (const m of candidates) {
      const blob = `${m.title} ${m.content} ${m.tags.join(' ')} ${m.memoryType}`.toLowerCase();
      const matchedTerms: string[] = [];
      let score = 0;

      for (const term of qTerms) {
        if (blob.includes(term)) {
          const tf = (blob.match(new RegExp(term, 'g')) ?? []).length;
          const df = docFreq.get(term) ?? 1;
          const idf = Math.log(N / df) + 1;
          score += tf * idf;
          matchedTerms.push(term);
        }
      }

      // Recency boost
      const ageMs = Date.now() - new Date(m.updatedAt).getTime();
      const days = ageMs / 86_400_000;
      score += Math.max(0, 5 - days * 0.5);

      if (score > 0) {
        scored.push({ memory: m, score, matchedTerms });
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Update an existing memory by id. */
  async updateMemory(params: {
    userId: string;
    memoryId: string;
    content?: string;
    category?: string;
    tags?: string[];
    importance?: number;
  }) {
    const { memories } = await loadAllMemories(this.store);
    const existing = memories.find(
      (m) => m.id === params.memoryId && (!m.projectId || m.projectId === params.userId),
    );
    if (!existing) {
      return { ok: false, error: `Memory ${params.memoryId} not found for user ${params.userId}` };
    }

    const updated = buildMemoryRecord(
      {
        memoryId: params.memoryId,
        content: params.content ?? existing.content,
        url: existing.url,
        projectId: params.userId,
        memoryDetails: {
          title: existing.title,
          memoryType: params.category ?? existing.memoryType,
          tags: params.tags ?? existing.tags,
          confidence: params.importance ?? existing.confidence,
          source: existing.source,
          relatedUrls: existing.relatedUrls,
        },
      },
      existing,
    );

    await saveMemory(this.store, updated);
    return { ok: true, memory: updated, message: 'Memory updated' };
  }

  /** Delete a specific memory by id. */
  async deleteMemory(params: { userId: string; memoryId: string }) {
    const { memories } = await loadAllMemories(this.store);
    const existing = memories.find(
      (m) => m.id === params.memoryId && (!m.projectId || m.projectId === params.userId),
    );
    if (!existing) {
      return { ok: false, error: `Memory ${params.memoryId} not found for user ${params.userId}` };
    }
    await deleteMemory(this.store, params.memoryId);
    return { ok: true, memoryId: params.memoryId, message: 'Memory deleted' };
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
   * Apply temporal decay and prune low-scoring memories.
   * Signature: pruneMemories(userId, config?) => { pruned, remaining, archived }
   */
  async pruneMemories(
    userId: string,
    config?: Partial<DecayConfig>,
  ): Promise<{
    pruned: number;
    remaining: number;
    archived: Array<Record<string, unknown>>;
  }> {
    const halfLifeDays = config?.halfLifeDays ?? 30;
    const pruneThreshold = config?.pruneThreshold ?? 0.1;

    const { memories } = await loadAllMemories(this.store);
    const userMemories = memories.filter(
      (m) => !m.projectId || m.projectId === userId,
    );

    const now = Date.now();
    const archived: Array<Record<string, unknown>> = [];

    for (const m of userMemories) {
      const ageMs = now - new Date(m.updatedAt).getTime();
      const ageDays = ageMs / 86_400_000;
      // Exponential decay: score = confidence * 2^(-ageDays / halfLifeDays)
      const decayedScore = m.confidence * Math.pow(2, -ageDays / halfLifeDays);

      if (decayedScore < pruneThreshold) {
        archived.push({ ...m, decayedScore });
        await deleteMemory(this.store, m.id);
      }
    }

    const remaining = userMemories.length - archived.length;
    return { pruned: archived.length, remaining, archived };
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

  // --- Create MCP server ---
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

  // --- Connect transport ---
  if (transport === 'sse') {
    // SSE transport requires an HTTP server — defer to integration layer.
    // For now, log a message and fall back to stdio.
    log.warning('SSE transport requested but requires external HTTP server setup. Falling back to stdio.');
  }

  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  log.info('MCP server connected via stdio');
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
