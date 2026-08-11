/** @typedef {'integration_note' | 'api_quirk' | 'auth_flow' | 'selector' | 'breaking_change' | 'project_binding' | 'general'} MemoryType */
/** @typedef {'agent' | 'human' | 'crawl'} MemorySource */
/**
 * @typedef {object} MemoryRecord
 * @property {string} id
 * @property {string | null} url
 * @property {string | null} site
 * @property {string} title
 * @property {string} content
 * @property {MemoryType} memoryType
 * @property {string[]} tags
 * @property {number} confidence
 * @property {MemorySource} source
 * @property {string | null} projectId
 * @property {string[]} relatedUrls
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} contentHash
 * @property {boolean} [archived]
 * @property {number} [decayedConfidence]
 * @property {number} [accessCount]
 */
/**
 * Apify store names: max 63 chars, use username~name pattern when possible.
 * @param {string} memoryStoreId
 */
export function sanitizeStoreName(memoryStoreId: string): string;
/**
 * @param {string} content
 */
export function contentHash(content: string): string;
/**
 * @param {import('apify').KeyValueStore} store
 */
export function loadManifest(store: import("apify").KeyValueStore): Promise<object>;
/**
 * @param {import('apify').KeyValueStore} store
 * @param {{ version: number, memoryIds: string[], updatedAt: string }} manifest
 */
export function saveManifest(store: import("apify").KeyValueStore, manifest: {
    version: number;
    memoryIds: string[];
    updatedAt: string;
}): Promise<void>;
/**
 * @param {import('apify').KeyValueStore} store
 */
export function loadAllMemories(store: import("apify").KeyValueStore): Promise<{
    manifest: object;
    memories: MemoryRecord[];
}>;
/**
 * @param {import('apify').KeyValueStore} store
 * @param {MemoryRecord} record
 */
export function saveMemory(store: import("apify").KeyValueStore, record: MemoryRecord): Promise<void>;
/**
 * @param {import('apify').KeyValueStore} store
 * @param {string} memoryId
 */
export function deleteMemory(store: import("apify").KeyValueStore, memoryId: string): Promise<void>;
/**
 * @param {object} input
 * @param {MemoryRecord|null} [existing]
 */
export function buildMemoryRecord(input: object, existing?: MemoryRecord | null): {
    id: any;
    url: string | null;
    site: string | null;
    title: string;
    content: string;
    memoryType: MemoryType;
    tags: any;
    confidence: number;
    source: MemorySource;
    projectId: any;
    relatedUrls: any;
    createdAt: string;
    updatedAt: string;
    contentHash: string;
};
/**
 * Rough token estimate (~4 chars per token for English prose).
 * @param {string} text
 */
export function estimateTokens(text: string): number;
export type MemoryType = "integration_note" | "api_quirk" | "auth_flow" | "selector" | "breaking_change" | "project_binding" | "general";
export type MemorySource = "agent" | "human" | "crawl";
export type MemoryRecord = {
    id: string;
    url: string | null;
    site: string | null;
    title: string;
    content: string;
    memoryType: MemoryType;
    tags: string[];
    confidence: number;
    source: MemorySource;
    projectId: string | null;
    relatedUrls: string[];
    createdAt: string;
    updatedAt: string;
    contentHash: string;
    archived?: boolean | undefined;
    decayedConfidence?: number | undefined;
    accessCount?: number | undefined;
};
