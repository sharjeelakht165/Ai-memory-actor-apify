import { createHash, randomUUID } from 'node:crypto';

import { normalizeUrl, siteFromUrl } from './url-utils.js';

const MANIFEST_KEY = '__manifest';
const MEMORY_PREFIX = 'memory-';

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
export function sanitizeStoreName(memoryStoreId) {
    const cleaned = memoryStoreId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9~_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[-~]+|[-~]+$/g, '');
    const name = cleaned || 'default-site-memory';
    return name.length > 63 ? name.slice(0, 63) : name;
}

/**
 * @param {string} content
 */
export function contentHash(content) {
    return createHash('sha256').update(content || '', 'utf8').digest('hex').slice(0, 16);
}

/**
 * @param {import('apify').KeyValueStore} store
 */
export async function loadManifest(store) {
    const manifest = await store.getValue(MANIFEST_KEY);
    if (manifest && typeof manifest === 'object' && Array.isArray(manifest.memoryIds)) {
        return manifest;
    }
    return { version: 1, memoryIds: [], updatedAt: new Date().toISOString() };
}

/**
 * @param {import('apify').KeyValueStore} store
 * @param {{ version: number, memoryIds: string[], updatedAt: string }} manifest
 */
export async function saveManifest(store, manifest) {
    manifest.updatedAt = new Date().toISOString();
    await store.setValue(MANIFEST_KEY, manifest);
}

/**
 * @param {import('apify').KeyValueStore} store
 */
export async function loadAllMemories(store) {
    const manifest = await loadManifest(store);
    /** @type {MemoryRecord[]} */
    const memories = [];
    for (const id of manifest.memoryIds) {
        const rec = await store.getValue(`${MEMORY_PREFIX}${id}`);
        if (rec && typeof rec === 'object') memories.push(/** @type {MemoryRecord} */ (rec));
    }
    return { manifest, memories };
}

/**
 * @param {import('apify').KeyValueStore} store
 * @param {MemoryRecord} record
 */
export async function saveMemory(store, record) {
    await store.setValue(`${MEMORY_PREFIX}${record.id}`, record);
    const manifest = await loadManifest(store);
    if (!manifest.memoryIds.includes(record.id)) {
        manifest.memoryIds.push(record.id);
    }
    await saveManifest(store, manifest);
}

/**
 * @param {import('apify').KeyValueStore} store
 * @param {string} memoryId
 */
export async function deleteMemory(store, memoryId) {
    await store.setValue(`${MEMORY_PREFIX}${memoryId}`, null);
    const manifest = await loadManifest(store);
    manifest.memoryIds = manifest.memoryIds.filter((id) => id !== memoryId);
    await saveManifest(store, manifest);
}

/**
 * @param {object} input
 * @param {MemoryRecord|null} [existing]
 */
export function buildMemoryRecord(input, existing = null) {
    const nested = input.memoryDetails && typeof input.memoryDetails === 'object'
        ? input.memoryDetails
        : {};

    // Merge top-level input schema fields (Apify Console form) with nested
    // memoryDetails. Nested fields take priority when both are present.
    const details = {
        title: nested.title || input.memoryTitle || undefined,
        memoryType: nested.memoryType || input.memoryType || undefined,
        tags: Array.isArray(nested.tags) && nested.tags.length ? nested.tags : (Array.isArray(input.tags) && input.tags.length ? input.tags : undefined),
        confidence: typeof nested.confidence === 'number' ? nested.confidence : (typeof input.confidence === 'number' ? input.confidence : undefined),
        source: nested.source || input.memorySource || undefined,
        relatedUrls: Array.isArray(nested.relatedUrls) && nested.relatedUrls.length ? nested.relatedUrls : (Array.isArray(input.relatedUrls) && input.relatedUrls.length ? input.relatedUrls : undefined),
    };

    const url = normalizeUrl(input.url);
    const content = String(input.content || '').trim();
    const now = new Date().toISOString();
    const id = input.memoryId || existing?.id || randomUUID();
    const tags = details.tags ? details.tags.map(String) : [];
    /** @type {MemoryType} */
    const memoryType = details.memoryType || existing?.memoryType || 'general';
    /** @type {MemorySource} */
    const source = details.source || existing?.source || 'agent';

    return {
        id,
        url,
        site: siteFromUrl(url),
        title: String(details.title || existing?.title || '').trim() || (url ? `Notes for ${url}` : 'Untitled memory'),
        content,
        memoryType,
        tags,
        confidence: typeof details.confidence === 'number' ? details.confidence : (existing?.confidence ?? 0.8),
        source,
        projectId: input.projectId || existing?.projectId || null,
        relatedUrls: details.relatedUrls ? details.relatedUrls.map(String) : (existing?.relatedUrls || []),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        contentHash: contentHash(content),
    };
}

/**
 * Rough token estimate (~4 chars per token for English prose).
 * @param {string} text
 */
export function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
}
