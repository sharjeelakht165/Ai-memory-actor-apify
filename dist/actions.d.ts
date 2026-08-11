/**
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export function actionRemember(store: import("apify").KeyValueStore, input: object): Promise<{
    action: string;
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
/**
 * Update an existing memory by merging new details into it.
 * Requires memoryId to identify the target memory.
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export function actionUpdate(store: import("apify").KeyValueStore, input: object): Promise<{
    action: string;
    ok: boolean;
    memory: import("./memory-store.js").MemoryRecord;
    message: string;
}>;
/**
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export function actionRecall(store: import("apify").KeyValueStore, input: object): Promise<{
    action: string;
    ok: boolean;
    url: string | null;
    count: number;
    memories: MemoryRecord[];
}>;
/**
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export function actionSearch(store: import("apify").KeyValueStore, input: object): Promise<{
    action: string;
    ok: boolean;
    query: any;
    count: number;
    memories: import("./memory-store.js").MemoryRecord[];
    scores: {
        id: string;
        score: number;
        matchedTerms: string[];
    }[];
}>;
/**
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export function actionForget(store: import("apify").KeyValueStore, input: object): Promise<{
    action: string;
    ok: boolean;
    memoryId: any;
    message: string;
}>;
/**
 * Prune decayed memories: archive low-confidence memories to a separate store key.
 * When decay is disabled, no memories are pruned.
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export function actionPrune(store: import("apify").KeyValueStore, input: object): Promise<{
    action: string;
    ok: boolean;
    pruned: number;
    remaining: number;
    archived: {
        id: string;
        title: string;
    }[];
    decayEnabled: boolean;
}>;
/**
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export function actionContextPack(store: import("apify").KeyValueStore, input: object): Promise<{
    action: string;
    ok: boolean;
    url: string | null;
    contextMarkdown: string;
    memoriesUsed: {
        id: any;
        title: any;
        url: any;
        memoryType: any;
    }[];
    tokenEstimate: number;
    warnings: string[];
}>;
