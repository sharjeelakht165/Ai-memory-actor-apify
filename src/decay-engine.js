import { log } from 'apify';

/** @typedef {import('./memory-store.js').MemoryRecord} MemoryRecord */

/**
 * @typedef {object} DecayConfig
 * @property {boolean} [enabled] - Enable/disable decay. Defaults: true in production, false in test/local.
 * @property {number} [halfLifeDays=30] - Half-life in days for exponential decay.
 * @property {number} [minConfidence=0.1] - Minimum confidence threshold.
 * @property {number} [pruneThreshold=0.05] - Memories below this decayed confidence are archived.
 * @property {number} [maxMemoriesPerStore=1000] - Max active memories per store before forced archival.
 */

/**
 * Auto-detect default enabled state.
 * Decay is ON in production (APIFY_IS_AT_HOME), OFF in local/test environments.
 */
function detectDefaultEnabled() {
    if (typeof process !== 'undefined') {
        if (process.env.NODE_ENV === 'test') return false;
        if (!process.env.APIFY_IS_AT_HOME && !process.env.DECAY_ENABLED) return false;
        if (process.env.DECAY_ENABLED === 'true') return true;
    }
    // Fallback: enabled in production-like environments
    return !!process.env.APIFY_IS_AT_HOME;
}

/** @type {Required<DecayConfig>} */
const DEFAULT_DECAY_CONFIG = {
    enabled: detectDefaultEnabled(),
    halfLifeDays: 30,
    minConfidence: 0.1,
    pruneThreshold: 0.05,
    maxMemoriesPerStore: 1000,
};

export class DecayEngine {
    /** @type {Required<DecayConfig>} */
    config;

    /**
     * @param {DecayConfig} [config]
     */
    constructor(config) {
        this.config = { ...DEFAULT_DECAY_CONFIG, ...config };
    }

    /**
     * Check if decay is currently enabled.
     * @returns {boolean}
     */
    isEnabled() {
        return this.config.enabled;
    }

    /**
     * Disable decay at runtime (useful for testing).
     * @returns {DecayEngine} this (for chaining)
     */
    disable() {
        this.config.enabled = false;
        return this;
    }

    /**
     * Compute decay factor for a single memory.
     * factor = 0.5 ^ (daysSinceAccess / halfLifeDays)
     * Returns value between 0 and 1.
     * @param {MemoryRecord} memory
     * @returns {number}
     */
    computeDecayFactor(memory) {
        const lastAccess = memory.updatedAt || memory.createdAt;
        const daysSinceAccess = (Date.now() - new Date(lastAccess).getTime()) / (1000 * 60 * 60 * 24);
        return Math.pow(0.5, daysSinceAccess / this.config.halfLifeDays);
    }

    /**
     * Calculate the decayed confidence of a memory.
     * decayedConfidence = originalConfidence * decayFactor
     * @param {MemoryRecord} memory
     * @returns {number}
     */
    computeDecayedConfidence(memory) {
        return (memory.confidence || 0.5) * this.computeDecayFactor(memory);
    }

    /**
     * Apply decay to all memories and mark those below threshold as archived.
     * When disabled, returns all memories as active with no modifications.
     * Does NOT delete memories — only sets archived=true and updates decayedConfidence.
     *
     * @param {MemoryRecord[]} memories
     * @returns {{ active: MemoryRecord[], archived: MemoryRecord[] }}
     */
    applyDecay(memories) {
        // When decay is disabled, return all memories untouched
        if (!this.config.enabled) {
            return { active: memories, archived: [] };
        }

        /** @type {MemoryRecord[]} */
        const active = [];
        /** @type {MemoryRecord[]} */
        const archived = [];

        for (const memory of memories) {
            // High-confidence memories are exempt from decay
            if ((memory.confidence || 0.5) >= 0.9) {
                // @ts-ignore - decayedConfidence is a dynamic field
                memory.decayedConfidence = memory.confidence;
                active.push(memory);
                continue;
            }

            const decayedConfidence = this.computeDecayedConfidence(memory);
            // @ts-ignore - decayedConfidence is a dynamic field
            memory.decayedConfidence = decayedConfidence;

            if (decayedConfidence < this.config.pruneThreshold) {
                // @ts-ignore - archived is a dynamic field
                memory.archived = true;
                archived.push(memory);
            } else {
                active.push(memory);
            }
        }

        // If active memories exceed max, archive lowest-confidence ones
        if (active.length > this.config.maxMemoriesPerStore) {
            active.sort(
                (a, b) =>
                    // @ts-ignore
                    (b.decayedConfidence || b.confidence || 0.5) -
                    // @ts-ignore
                    (a.decayedConfidence || a.confidence || 0.5),
            );
            const excess = active.splice(this.config.maxMemoriesPerStore);
            for (const mem of excess) {
                // @ts-ignore
                mem.archived = true;
                archived.push(mem);
            }
        }

        return { active, archived };
    }

    /**
     * Prune memories: apply decay and separate archived ones.
     * When decay is disabled, all memories are kept as-is.
     * Returns the pruned (archived) memories for external storage.
     *
     * @param {MemoryRecord[]} memories
     * @returns {{ kept: MemoryRecord[], pruned: MemoryRecord[] }}
     */
    prune(memories) {
        const { active, archived } = this.applyDecay(memories);

        if (archived.length > 0 && this.config.enabled) {
            log.info(`Pruning ${archived.length} memories (decayed below threshold)`);
        }

        return { kept: active, pruned: archived };
    }
}
