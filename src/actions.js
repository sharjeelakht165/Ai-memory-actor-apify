import { normalizeUrl, siteFromUrl, urlMatches } from './url-utils.js';
import {
    buildMemoryRecord,
    deleteMemory,
    estimateTokens,
    loadAllMemories,
    saveMemory,
} from './memory-store.js';

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
    if (!input.content || !String(input.content).trim()) {
        throw new Error('remember requires non-empty content');
    }

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
 * @param {import('apify').KeyValueStore} store
 * @param {object} input
 */
export async function actionRecall(store, input) {
    const { memories } = await loadAllMemories(store);
    const url = normalizeUrl(input.url);
    const max = input.maxResults ?? 20;
    let list = filterByProject(memories, input.projectId);

    if (url) {
        list = list.filter(
            (m) => (m.url && urlMatches(m.url, url)) || (m.site && siteFromUrl(url) === m.site),
        );
    }

    list = list
        .map((m) => ({ memory: m, score: scoreMemory(m, url, input.query) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, max)
        .map((x) => x.memory);

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
    const url = normalizeUrl(input.url);
    let list = filterByProject(memories, input.projectId);

    list = list
        .map((m) => ({ memory: m, score: scoreMemory(m, url, q) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, max)
        .map((x) => x.memory);

    return {
        action: 'search',
        ok: true,
        query: q,
        count: list.length,
        memories: list,
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
