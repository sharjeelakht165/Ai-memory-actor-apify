export class DecayEngine {
    /**
     * @param {DecayConfig} [config]
     */
    constructor(config?: DecayConfig);
    /** @type {Required<DecayConfig>} */
    config: Required<DecayConfig>;
    /**
     * Check if decay is currently enabled.
     * @returns {boolean}
     */
    isEnabled(): boolean;
    /**
     * Disable decay at runtime (useful for testing).
     * @returns {DecayEngine} this (for chaining)
     */
    disable(): DecayEngine;
    /**
     * Compute decay factor for a single memory.
     * factor = 0.5 ^ (daysSinceAccess / halfLifeDays)
     * Returns value between 0 and 1.
     * @param {MemoryRecord} memory
     * @returns {number}
     */
    computeDecayFactor(memory: MemoryRecord): number;
    /**
     * Calculate the decayed confidence of a memory.
     * decayedConfidence = originalConfidence * decayFactor
     * @param {MemoryRecord} memory
     * @returns {number}
     */
    computeDecayedConfidence(memory: MemoryRecord): number;
    /**
     * Apply decay to all memories and mark those below threshold as archived.
     * When disabled, returns all memories as active with no modifications.
     * Does NOT delete memories — only sets archived=true and updates decayedConfidence.
     *
     * @param {MemoryRecord[]} memories
     * @returns {{ active: MemoryRecord[], archived: MemoryRecord[] }}
     */
    applyDecay(memories: MemoryRecord[]): {
        active: MemoryRecord[];
        archived: MemoryRecord[];
    };
    /**
     * Prune memories: apply decay and separate archived ones.
     * When decay is disabled, all memories are kept as-is.
     * Returns the pruned (archived) memories for external storage.
     *
     * @param {MemoryRecord[]} memories
     * @returns {{ kept: MemoryRecord[], pruned: MemoryRecord[] }}
     */
    prune(memories: MemoryRecord[]): {
        kept: MemoryRecord[];
        pruned: MemoryRecord[];
    };
}
export type MemoryRecord = import("./memory-store.js").MemoryRecord;
export type DecayConfig = {
    /**
     * - Enable/disable decay. Defaults: true in production, false in test/local.
     */
    enabled?: boolean | undefined;
    /**
     * - Half-life in days for exponential decay.
     */
    halfLifeDays?: number | undefined;
    /**
     * - Minimum confidence threshold.
     */
    minConfidence?: number | undefined;
    /**
     * - Memories below this decayed confidence are archived.
     */
    pruneThreshold?: number | undefined;
    /**
     * - Max active memories per store before forced archival.
     */
    maxMemoriesPerStore?: number | undefined;
};
