import { Actor } from 'apify';
import { randomUUID } from 'node:crypto';
import { sanitizeStoreName, loadAllMemories, saveMemory, deleteMemory as deleteMemoryRecord, contentHash, } from './memory-store.js';
import { SearchEngine } from './search-engine.js';
const DEFAULT_DECAY_CONFIG = {
    enabled: true,
    halfLifeDays: 30,
    minImportance: 0.1,
    pruneThreshold: 0.05,
    maxMemoriesPerUser: 1000,
};
/**
 * Core memory manager providing CRUD operations, search, decay, and stats
 * across all operating modes (actor, server, MCP).
 */
export class MemoryManager {
    searchEngine;
    constructor() {
        this.searchEngine = new SearchEngine();
    }
    /**
     * Store a new memory for a user.
     */
    async storeMemory(userId, details) {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const id = randomUUID();
        const now = new Date().toISOString();
        const content = details.content || '';
        const memory = {
            id,
            url: null,
            site: null,
            title: details.title || content.slice(0, 80),
            content,
            memoryType: details.memoryType || 'general',
            tags: details.tags || [],
            confidence: details.confidence ?? 0.8,
            source: details.source || 'agent',
            projectId: null,
            relatedUrls: details.relatedUrls || [],
            createdAt: now,
            updatedAt: now,
            contentHash: contentHash(content),
            importance: details.importance ?? 0.5,
            category: details.category,
        };
        await saveMemory(store, memory);
        return memory;
    }
    /**
     * Recall memories for a user, optionally filtered by category.
     */
    async recallMemories(userId, category) {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const { memories } = await loadAllMemories(store);
        let results = memories;
        if (category) {
            results = results.filter((m) => m.category === category);
        }
        return results;
    }
    /**
     * Search memories using TF-IDF scoring with relevance modifiers.
     */
    async searchMemories(userId, query, options) {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const { memories } = await loadAllMemories(store);
        return this.searchEngine.search(query, memories, {
            limit: options?.limit,
            memoryType: options?.category,
            includeArchived: options?.includeArchived,
            minScore: options?.minScore,
        });
    }
    /**
     * Update an existing memory's content or metadata.
     */
    async updateMemory(userId, memoryId, updates) {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const { memories } = await loadAllMemories(store);
        const existing = memories.find((m) => m.id === memoryId);
        if (!existing)
            return null;
        const updated = {
            ...existing,
            ...updates,
            updatedAt: new Date().toISOString(),
            contentHash: contentHash(updates.content || existing.content),
        };
        await saveMemory(store, updated);
        return updated;
    }
    /**
     * Delete a specific memory.
     */
    async deleteMemory(userId, memoryId) {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const { memories } = await loadAllMemories(store);
        const exists = memories.some((m) => m.id === memoryId);
        if (!exists)
            return { deleted: false, memoryId };
        await deleteMemoryRecord(store, memoryId);
        return { deleted: true, memoryId };
    }
    /**
     * Get statistics about a user's memory store.
     */
    async getMemoryStats(userId) {
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const { memories } = await loadAllMemories(store);
        const categories = {};
        let totalImportance = 0;
        let lastAccessed = null;
        for (const m of memories) {
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
    async pruneMemories(userId, decayConfig) {
        const config = { ...DEFAULT_DECAY_CONFIG, ...decayConfig };
        const storeName = sanitizeStoreName(userId);
        const store = await Actor.openKeyValueStore(storeName);
        const { memories } = await loadAllMemories(store);
        let pruned = 0;
        let archived = 0;
        const now = Date.now();
        for (const m of memories) {
            const importance = m.importance ?? m.confidence ?? 0.5;
            // High-importance memories are exempt from decay
            if (importance >= 0.9)
                continue;
            // Calculate decayed importance
            const lastAccess = new Date(m.updatedAt).getTime();
            const daysSinceAccess = (now - lastAccess) / (1000 * 60 * 60 * 24);
            const decayedImportance = importance * Math.pow(0.5, daysSinceAccess / config.halfLifeDays);
            if (decayedImportance < config.pruneThreshold) {
                // Archive instead of delete
                m.archived = true;
                m.decayedImportance = decayedImportance;
                await saveMemory(store, m);
                archived++;
                pruned++;
            }
            else {
                // Update decayed importance
                m.decayedImportance = decayedImportance;
                await saveMemory(store, m);
            }
        }
        const remaining = memories.length - pruned;
        return { pruned, archived, remaining };
    }
}
//# sourceMappingURL=memory-manager.js.map