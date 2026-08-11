import type { MemoryDetails, DecayConfig, SearchOptions, SearchResult, Memory } from './types.js';
/**
 * Core memory manager providing CRUD operations, search, decay, and stats
 * across all operating modes (actor, server, MCP).
 */
export declare class MemoryManager {
    private searchEngine;
    constructor();
    /**
     * Store a new memory for a user.
     */
    storeMemory(userId: string, details: MemoryDetails): Promise<Memory>;
    /**
     * Recall memories for a user, optionally filtered by category.
     */
    recallMemories(userId: string, category?: string): Promise<Memory[]>;
    /**
     * Search memories using TF-IDF scoring with relevance modifiers.
     */
    searchMemories(userId: string, query: string, options?: SearchOptions): Promise<SearchResult[]>;
    /**
     * Update an existing memory's content or metadata.
     */
    updateMemory(userId: string, memoryId: string, updates: Partial<MemoryDetails>): Promise<Memory | null>;
    /**
     * Delete a specific memory.
     */
    deleteMemory(userId: string, memoryId: string): Promise<{
        deleted: boolean;
        memoryId: string;
    }>;
    /**
     * Get statistics about a user's memory store.
     */
    getMemoryStats(userId: string): Promise<{
        totalCount: number;
        categories: Record<string, number>;
        lastAccessed: string | null;
        avgImportance: number;
    }>;
    /**
     * Apply decay and prune low-importance memories.
     * Memories with importance ≥ 0.9 are exempt from decay.
     * Pruned memories are archived, not deleted.
     */
    pruneMemories(userId: string, decayConfig?: Partial<DecayConfig>): Promise<{
        pruned: number;
        archived: number;
        remaining: number;
    }>;
}
