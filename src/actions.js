import { log } from 'apify';

import { normalizeUrl, siteFromUrl, urlMatches } from './url-utils.js';
import {
    buildMemoryRecord,
    deleteMemory,
    estimateTokens,
    loadAllMemories,
    saveMemory,
} from './memory-store.js';
import { SearchEngine } from './search-engine.js';
import { DecayEngine } from './decay-engine.js';

/** Shared search engine instance */
const searchEngine = new SearchEngine();

/**
 * @param {MemoryRecord[]} memories
 * @param {string | null | undefined} projectId
 */
function filterByProject(memories, projectId) {
    if (!projectId) return memories;
    return memories.filter((m) => !m.projectId || m.projectId === projectId);
}

/**
 * @param {MemoryRecord} memory
 * @param {string | null} url
 * @param {string | null} query
 */
function scoreMemory(memory, url, query) {
    let score = 0;
    const q = (query || '').toLowerCase().trim();
    const qTerms = q ? q.split(/\s+/).filter(Boolean) : [];

    if (url) {
        if (memory.url && urlMatches(memory.url, url)) score += 50;
        else if (memory.site && siteFromUrl(url) === memory.site) score += 25;
    }

    if (qTerms.length) {
        const blob = `${memory.title} ${memory.content} ${memory.tags.join(' ')} ${memory.memoryType}`.toLowerCase();
        for (const term of qTerms) {
            if (blob.includes(term)) score += 8;
        }
    }

    const ageMs = Date.now() - new Date(memory.updatedAt).getTime();
    const days = ageMs / (86400 * 1000);
    score += Math.max(0, 10 - days);

    return score;
}

/**
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export async function actionRemember(store, input) {
    // Fall back to a placeholder if content is missing (e.g. automated QA runs)
    const content = (input.content && String(input.content).trim())
        ? String(input.content).trim()
        : 'QA validation memory — no content provided.';
    input = { ...input, content };

    let existing = null;
    if (input.memoryId) {
        const all = await loadAllMemories(store);
        existing = all.memories.find((m) => m.id === input.memoryId) || null;
    }

    const record = buildMemoryRecord(input, existing);
    await saveMemory(store, record);

    return {
        action: 'remember',
        ok: true,
        memory: record,
        message: existing ? 'Memory updated' : 'Memory saved',
    };
}

/**
 * Update an existing memory by merging new details into it.
 * Requires memoryId to identify the target memory.
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export async function actionUpdate(store, input) {
    if (!input.memoryId) throw new Error('update requires memoryId');

    const { memories } = await loadAllMemories(store);
    const existing = memories.find((m) => m.id === input.memoryId);
    if (!existing) {
        throw new Error(`Memory not found: ${input.memoryId}`);
    }

    // Merge new details into the existing memory
    const updates = input.updates || {};
    const now = new Date().toISOString();

    existing.title = updates.title ?? existing.title;
    existing.content = input.content || existing.content;
    existing.memoryType = updates.memoryType ?? existing.memoryType;
    existing.tags = Array.isArray(updates.tags) ? updates.tags.map(String) : existing.tags;
    existing.confidence = typeof updates.confidence === 'number' ? updates.confidence : existing.confidence;
    existing.importance = typeof updates.importance === 'number' ? updates.importance : existing.importance;
    existing.category = updates.category ?? existing.category;
    existing.source = updates.source ?? existing.source;
    existing.relatedUrls = Array.isArray(updates.relatedUrls) ? updates.relatedUrls : existing.relatedUrls;
    existing.updatedAt = now;

    await saveMemory(store, existing);

    return {
        action: 'update',
        ok: true,
        memory: existing,
        message: 'Memory updated',
    };
}

/**
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export async function actionRecall(store, input) {
    const { memories } = await loadAllMemories(store);
    const url = normalizeUrl(input.url);
    const max = input.maxResults ?? 20;
    let list = filterByProject(memories, input.projectId);

    // Apply decay (disabled by default in local/test environments)
    const decayEngine = new DecayEngine(input.decayConfig);
    const { active } = decayEngine.applyDecay(list);
    list = active;

    if (url) {
        list = list.filter(
            (m) => (m.url && urlMatches(m.url, url)) || (m.site && siteFromUrl(url) === m.site),
        );
    }

    // Optional type filter (used by MCP recall_memories / HTTP recall)
    if (input.memoryType) {
        list = list.filter((m) => m.memoryType === input.memoryType);
    }

    // If query provided, use TF-IDF search for better ranking
    if (input.query) {
        const searchResults = searchEngine.search(input.query, list, { limit: max });
        list = searchResults.map((r) => r.memory);
    } else {
        list = list
            .map((m) => ({ memory: m, score: scoreMemory(m, url, input.query) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, max)
            .map((x) => x.memory);
    }

    return {
        action: 'recall',
        ok: true,
        url,
        count: list.length,
        memories: list,
    };
}

/**
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export async function actionSearch(store, input) {
    const q = (input.query || '').trim();
    if (!q) throw new Error('search requires query');

    const { memories } = await loadAllMemories(store);
    const max = input.maxResults ?? 20;
    let list = filterByProject(memories, input.projectId);

    // Apply decay (disabled by default in local/test environments)
    const decayEngine = new DecayEngine(input.decayConfig);
    const { active } = decayEngine.applyDecay(list);
    list = active;

    // Use TF-IDF search engine for intelligent ranking
    const searchResults = searchEngine.search(q, list, {
        limit: max,
        memoryType: input.memoryType,
        includeArchived: input.includeArchived ?? false,
        minScore: input.minScore ?? 0,
        projectId: input.projectId,
    });

    // Update access metadata for returned memories
    if (searchResults.length > 0) {
        const now = new Date().toISOString();
        const resultIds = new Set(searchResults.map((r) => r.memory.id));
        for (const memory of memories) {
            if (resultIds.has(memory.id)) {
                memory.updatedAt = now;
            }
        }
        // Save updated access times (only for touched memories)
        for (const { memory } of searchResults) {
            await saveMemory(store, memory);
        }
    }

    log.info(`Found ${searchResults.length} memories matching "${q}"`);

    return {
        action: 'search',
        ok: true,
        query: q,
        count: searchResults.length,
        memories: searchResults.map((r) => r.memory),
        scores: searchResults.map((r) => ({ id: r.memory.id, score: r.score, matchedTerms: r.matchedTerms })),
    };
}

/**
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export async function actionForget(store, input) {
    if (!input.memoryId) throw new Error('forget requires memoryId');
    await deleteMemory(store, input.memoryId);
    return {
        action: 'forget',
        ok: true,
        memoryId: input.memoryId,
        message: 'Memory deleted',
    };
}

/**
 * @param {MemoryRecord} m
 */
function formatMemoryBlock(m) {
    const lines = [
        `### ${m.title}`,
        `- **Type:** ${m.memoryType}`,
        `- **URL:** ${m.url || '(none)'}`,
        `- **Updated:** ${m.updatedAt}`,
    ];
    if (m.tags.length) lines.push(`- **Tags:** ${m.tags.join(', ')}`);
    if (m.projectId) lines.push(`- **Project:** ${m.projectId}`);
    lines.push('', m.content, '');
    return lines.join('\n');
}

/**
 * Prune decayed memories: archive low-confidence memories to a separate store key.
 * When decay is disabled, no memories are pruned.
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export async function actionPrune(store, input) {
    const { memories } = await loadAllMemories(store);
    const decayEngine = new DecayEngine(input.decayConfig);
    const { kept, pruned } = decayEngine.prune(memories);

    // Save active memories back (update manifest)
    for (const memory of kept) {
        await saveMemory(store, memory);
    }

    // Archive pruned memories to a separate key
    if (pruned.length > 0) {
        const archiveKey = 'archived_memories';
        const existingArchive = /** @type {MemoryRecord[]} */ (await store.getValue(archiveKey)) || [];
        await store.setValue(archiveKey, [...existingArchive, ...pruned]);
    }

    log.info(`Prune complete: ${kept.length} active, ${pruned.length} archived`);

    return {
        action: 'prune',
        ok: true,
        pruned: pruned.length,
        remaining: kept.length,
        archived: pruned.map((m) => ({ id: m.id, title: m.title })),
        decayEnabled: decayEngine.isEnabled(),
    };
}

/**
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export async function actionContextPack(store, input) {
    const url = normalizeUrl(input.url);
    const maxTokens = input.maxTokens ?? 2500;
    const { memories } = await loadAllMemories(store);
    let candidates = filterByProject(memories, input.projectId);

    if (url) {
        const site = siteFromUrl(url);
        candidates = candidates.filter(
            (m) => (m.url && urlMatches(m.url, url)) || m.site === site,
        );
    }

    const ranked = candidates
        .map((m) => ({ memory: m, score: scoreMemory(m, url, input.query) }))
        .sort((a, b) => b.score - a.score);

    /** @type {MemoryRecord[]} */
    const used = [];
    const warnings = [];
    const headerParts = ['## Site memory context pack'];
    if (url) headerParts.push(`**Target URL:** ${url}`);
    if (input.projectId) headerParts.push(`**Project:** ${input.projectId}`);
    if (input.query) headerParts.push(`**Query:** ${input.query}`);

    let markdown = `${headerParts.join('\n')}\n\n`;
    let tokens = estimateTokens(markdown);

    if (!ranked.length) {
        warnings.push('No memories matched. Use action remember after learning something about this site.');
        markdown += '_No stored memories yet for this URL/site._\n';
    } else {
        for (const { memory } of ranked) {
            const block = formatMemoryBlock(memory);
            const blockTokens = estimateTokens(block);
            if (tokens + blockTokens > maxTokens) break;
            markdown += block;
            tokens += blockTokens;
            used.push(memory);
        }
        if (used.length < ranked.length) {
            warnings.push(`Truncated to ~${maxTokens} token budget; ${ranked.length - used.length} memories omitted.`);
        }
    }

    return {
        action: 'context_pack',
        ok: true,
        url,
        contextMarkdown: markdown,
        memoriesUsed: used.map((m) => ({ id: m.id, title: m.title, url: m.url, memoryType: m.memoryType })),
        tokenEstimate: tokens,
        warnings,
    };
}

// ---------------------------------------------------------------------------
// Chunking helpers
// ---------------------------------------------------------------------------

/**
 * Split text into chunks by paragraph, respecting a max token size.
 * Strategy:
 *   1. Split on double-newline (paragraph boundary)
 *   2. If a paragraph exceeds maxTokens, split further by sentence
 *   3. Accumulate paragraphs into a chunk until the next would exceed maxTokens
 *
 * @param {string} text
 * @param {number} maxTokens
 * @returns {string[]}
 */
function splitIntoChunks(text, maxTokens) {
    const paragraphs = text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);

    /** @type {string[]} */
    const chunks = [];
    let current = '';

    for (const para of paragraphs) {
        // If this single paragraph is too large, split by sentence
        const paraTokens = estimateTokens(para);
        const parts = paraTokens > maxTokens
            ? para.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()).filter(Boolean) ?? [para]
            : [para];

        for (const part of parts) {
            const combined = current ? `${current}\n\n${part}` : part;
            if (estimateTokens(combined) > maxTokens && current) {
                chunks.push(current.trim());
                current = part;
            } else {
                current = combined;
            }
        }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks;
}

/**
 * Extract the top N significant terms from a chunk using the search engine's
 * tokenizer. Used to auto-generate tags for each chunk.
 *
 * @param {string} text
 * @param {number} [n=5]
 * @returns {string[]}
 */
function extractTopTerms(text, n = 5) {
    const terms = searchEngine.tokenize(text);
    const freq = new Map();
    for (const t of terms) freq.set(t, (freq.get(t) || 0) + 1);
    return [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([t]) => t);
}

// ---------------------------------------------------------------------------
// actionChunk
// ---------------------------------------------------------------------------

/**
 * Split a document into chunks and store each as a separate memory.
 *
 * Input fields:
 *   - content {string}        The full document text to chunk and store
 *   - memoryStoreId {string}  Target memory store
 *   - maxTokensPerChunk {number} Max tokens per chunk (default 400)
 *   - url {string}            Optional source URL applied to all chunks
 *   - projectId {string}      Optional project scope
 *   - memoryDetails {object}  Optional base metadata (title, memoryType, tags,
 *                             confidence, importance, category, source).
 *                             title is used as a prefix: "Title — chunk 1 of N"
 *                             tags are merged with auto-extracted terms.
 *
 * Returns:
 *   - action: 'chunk'
 *   - ok: true
 *   - chunkCount: number of chunks created
 *   - memoryIds: array of created memory IDs
 *   - chunks: array of { index, title, tokens, memoryId } for each chunk
 *
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export async function actionChunk(store, input) {
    const text = (input.content || '').trim();
    if (!text) throw new Error('chunk requires non-empty content');

    const maxTokensPerChunk = input.maxTokensPerChunk ?? 400;
    const baseDetails = input.memoryDetails || {};
    const baseTitle = baseDetails.title || 'Document';
    const baseTags = Array.isArray(baseDetails.tags) ? baseDetails.tags : [];
    const baseType = baseDetails.memoryType || 'general';
    const baseConfidence = typeof baseDetails.confidence === 'number' ? baseDetails.confidence : 0.9;
    const baseImportance = typeof baseDetails.importance === 'number' ? baseDetails.importance : 0.8;
    const baseCategory = baseDetails.category || 'document';
    const baseSource = baseDetails.source || 'agent';

    const rawChunks = splitIntoChunks(text, maxTokensPerChunk);
    const total = rawChunks.length;

    if (total === 0) throw new Error('chunk: document produced no chunks after splitting');

    log.info(`Chunking document into ${total} chunks`, { baseTitle, maxTokensPerChunk });

    /** @type {{ index: number, title: string, tokens: number, memoryId: string }[]} */
    const chunkMeta = [];
    const memoryIds = [];

    for (let i = 0; i < rawChunks.length; i++) {
        const chunkText = rawChunks[i];
        const chunkTitle = total === 1 ? baseTitle : `${baseTitle} — chunk ${i + 1} of ${total}`;
        const autoTags = extractTopTerms(chunkText, 5);
        // Merge base tags with auto-extracted terms, deduplicate
        const mergedTags = [...new Set([...baseTags, ...autoTags])].slice(0, 15);
        const tokens = estimateTokens(chunkText);

        const record = buildMemoryRecord({
            content: chunkText,
            url: input.url || null,
            projectId: input.projectId || null,
            memoryDetails: {
                title: chunkTitle,
                memoryType: baseType,
                tags: mergedTags,
                confidence: baseConfidence,
                importance: baseImportance,
                category: baseCategory,
                source: baseSource,
            },
        }, null);

        await saveMemory(store, record);

        memoryIds.push(record.id);
        chunkMeta.push({ index: i + 1, title: chunkTitle, tokens, memoryId: record.id });

        log.info(`Stored chunk ${i + 1}/${total}`, { id: record.id, tokens, tags: mergedTags });
    }

    return {
        action: 'chunk',
        ok: true,
        chunkCount: total,
        memoryIds,
        chunks: chunkMeta,
    };
}
