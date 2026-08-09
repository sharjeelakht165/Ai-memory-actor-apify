import { Actor } from 'apify';
import { actionPrune } from './actions.js';
import {
    sanitizeStoreName,
    loadAllMemories,
    saveMemory,
    deleteMemory as deleteMemoryRecord,
    buildMemoryRecord,
    contentHash,
} from './memory-store.js';
import { SearchEngine } from './search-engine.js';
import { DecayEngine } from './decay-engine.js';
import type { MemoryDetails, DecayConfig, SearchOptions, SearchResult, Memory } from './types.js';

/**
 * Core memory manager providing CRUD operations, search, decay, and stats
 * across all operating modes (actor, server, MCP).
 */
export class MemoryManager {
    private searchEngine: SearchEngine;

    constructor() {
        this.searchEngine = new SearchEngine();
    }

    /**
     * Store a new memory for a user.
     */
    async storeMemory(userId: string, details: MemoryDetails): Promise<Memory> {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);

        // Delegate record construction to the shared buildMemoryRecord so all
        // modes produce identical shapes (url/site normalization, hashing, ids).
        const record = buildMemoryRecord({
            content: details.content,
            url: details.url,
            memoryDetails: {
                title: details.title,
                memoryType: details.memoryType,
                tags: details.tags,
                confidence: details.confidence,
                source: details.source,
                relatedUrls: details.relatedUrls,
            },
        }) as unknown as Memory;

        // REST-only extra fields kept on the record for API consumers.
        record.importance = details.importance ?? 0.5;
        record.category = details.category;

        await saveMemory(store, record as any);
        return record;
    }

    /**
     * Recall memories for a user, optionally filtered by category.
     */
    async recallMemories(userId: string, category?: string): Promise<Memory[]> {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const { memories } = await loadAllMemories(store);

        // Apply the shared DecayEngine so decayed memories are filtered
        // consistently with the batch recall action.
        const { active } = new DecayEngine().applyDecay(memories);
        let results = active as Memory[];
        if (category) {
            results = results.filter((m) => m.category === category || m.memoryType === category);
        }

        return results;
    }

    /**
     * Search memories using TF-IDF scoring with relevance modifiers.
     */
    async searchMemories(userId: string, query: string, options?: SearchOptions): Promise<SearchResult[]> {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const { memories } = await loadAllMemories(store);

        return this.searchEngine.search(query, memories as any, {
            limit: options?.limit,
            memoryType: options?.category,
            includeArchived: options?.includeArchived,
            minScore: options?.minScore,
        }) as SearchResult[];
    }

    /**
     * Update an existing memory's content or metadata.
     */
    async updateMemory(userId: string, memoryId: string, updates: Partial<MemoryDetails>): Promise<Memory | null> {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const { memories } = await loadAllMemories(store);

        const existing = memories.find((m: any) => m.id === memoryId);
        if (!existing) return null;

        const updated: any = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString(),
            contentHash: contentHash(updates.content || existing.content),
        };

        await saveMemory(store, updated);
        return updated as Memory;
    }

    /**
     * Delete a specific memory.
     */
    async deleteMemory(userId: string, memoryId: string): Promise<{ deleted: boolean; memoryId: string }> {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const { memories } = await loadAllMemories(store);

        const exists = memories.some((m: any) => m.id === memoryId);
        if (!exists) return { deleted: false, memoryId };

        await deleteMemoryRecord(store, memoryId);
        return { deleted: true, memoryId };
    }

    /**
     * Get statistics about a user's memory store.
     */
    async getMemoryStats(userId: string): Promise<{
        totalCount: number;
        categories: Record<string, number>;
        lastAccessed: string | null;
        avgImportance: number;
    }> {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const { memories } = await loadAllMemories(store);

        const categories: Record<string, number> = {};
        let totalImportance = 0;
        let lastAccessed: string | null = null;

        for (const m of memories as Memory[]) {
            const cat = m.category || 'uncategorized';
            categories[cat] = (categories[cat] || 0) + 1;
            totalImportance += m.importance ?? 0.5;
            if (!lastAccessed || m.updatedAt > lastAccessed) {
                lastAccessed = m.updatedAt;
            }
        }

        return {
            totalCount: memories.length,
            categories,
            lastAccessed,
            avgImportance: memories.length > 0 ? totalImportance / memories.length : 0,
        };
    }

    /**
     * Apply decay and prune low-importance memories.
     * Memories with importance ≥ 0.9 are exempt from decay.
     * Pruned memories are archived, not deleted.
     */
    async pruneMemories(userId: string, decayConfig?: Partial<DecayConfig>): Promise<{
        pruned: number;
        archived: number;
        remaining: number;
    }> {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);

        // Delegate to the shared prune action (DecayEngine under the hood),
        // mapping the REST DecayConfig field names onto the engine's config.
        const result = await actionPrune(store, {
            decayConfig: {
                enabled: decayConfig?.enabled ?? true,
                halfLifeDays: decayConfig?.halfLifeDays ?? 30,
                minConfidence: decayConfig?.minImportance ?? 0.1,
                pruneThreshold: decayConfig?.pruneThreshold ?? 0.05,
                maxMemoriesPerStore: decayConfig?.maxMemoriesPerUser ?? 1000,
            },
        });

        return { pruned: result.pruned, archived: result.pruned, remaining: result.remaining };
    }
}
