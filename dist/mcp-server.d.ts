/**
 * MCP server exposing site-memory tools via the Model Context Protocol.
 *
 * Transports:
 *   - stdio  (default) — local agent integration
 *   - sse    — HTTP-based integration via SSEServerTransport
 */
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
export declare class MemoryManager {
    private store;
    constructor(store: any);
    /** Store a new memory (or update when memoryId is supplied). */
    storeMemory(params: {
        userId: string;
        content: string;
        category?: string;
        tags?: string[];
        importance?: number;
        metadata?: object;
    }): Promise<{
        ok: boolean;
        memory: {
            id: any;
            url: string | null;
            site: string | null;
            title: string;
            content: string;
            memoryType: import("./memory-store.js").MemoryType;
            tags: any;
            confidence: number;
            source: import("./memory-store.js").MemorySource;
            projectId: any;
            relatedUrls: any;
            createdAt: string;
            updatedAt: string;
            contentHash: string;
        };
        message: string;
    }>;
    /** Retrieve memories for a user, optionally filtered by category. */
    recallMemories(params: {
        userId: string;
        category?: string;
        limit?: number;
    }): Promise<{
        ok: boolean;
        count: number;
        memories: import("./memory-store.js").MemoryRecord[];
    }>;
    /**
     * Search memories using a TF-IDF–inspired scoring algorithm.
     * Signature: searchMemories(userId, query, options?) => SearchResult[]
     */
    searchMemories(userId: string, query: string, options?: {
        limit?: number;
        category?: string;
    }): Promise<SearchResult[]>;
    /** Update an existing memory by id. */
    updateMemory(params: {
        userId: string;
        memoryId: string;
        content?: string;
        category?: string;
        tags?: string[];
        importance?: number;
    }): Promise<{
        ok: boolean;
        error: string;
        memory?: undefined;
        message?: undefined;
    } | {
        ok: boolean;
        memory: {
            id: any;
            url: string | null;
            site: string | null;
            title: string;
            content: string;
            memoryType: import("./memory-store.js").MemoryType;
            tags: any;
            confidence: number;
            source: import("./memory-store.js").MemorySource;
            projectId: any;
            relatedUrls: any;
            createdAt: string;
            updatedAt: string;
            contentHash: string;
        };
        message: string;
        error?: undefined;
    }>;
    /** Delete a specific memory by id. */
    deleteMemory(params: {
        userId: string;
        memoryId: string;
    }): Promise<{
        ok: boolean;
        error: string;
        memoryId?: undefined;
        message?: undefined;
    } | {
        ok: boolean;
        memoryId: string;
        message: string;
        error?: undefined;
    }>;
    /** Get memory statistics for a user. */
    getMemoryStats(params: {
        userId: string;
    }): Promise<{
        ok: boolean;
        userId: string;
        totalMemories: number;
        byType: Record<string, number>;
        bySite: Record<string, number>;
        totalTokensEstimated: number;
        oldestMemory: string | null;
        newestMemory: string | null;
    }>;
    /**
     * Apply temporal decay and prune low-scoring memories.
     * Signature: pruneMemories(userId, config?) => { pruned, remaining, archived }
     */
    pruneMemories(userId: string, config?: Partial<DecayConfig>): Promise<{
        pruned: number;
        remaining: number;
        archived: Array<Record<string, unknown>>;
    }>;
}
/**
 * Start the MCP server with the given transport.
 *
 * @param transport  `'stdio'` (default) or `'sse'`.
 */
export declare function startMcpServer(transport?: 'stdio' | 'sse'): Promise<void>;
