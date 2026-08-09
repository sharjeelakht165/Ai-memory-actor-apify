// Ad-hoc verification of the unified action layer across MCP + REST adapters.
import { MemoryManager as McpMemoryManager } from '../src/mcp-server.ts';
import { MemoryManager as RestMemoryManager } from '../src/memory-manager.ts';
import { actionSearch } from '../src/actions.js';

// Minimal in-memory stand-in for an Apify KeyValueStore
function fakeStore() {
    const data = new Map();
    return {
        async getValue(k) { return data.has(k) ? data.get(k) : null; },
        async setValue(k, v) { if (v === null) data.delete(k); else data.set(k, v); },
    };
}

const store = fakeStore();
const mcp = new McpMemoryManager(store);

// --- store via MCP adapter (delegates to actionRemember/buildMemoryRecord) ---
const stored = await mcp.storeMemory({
    userId: 'user-1',
    content: 'Stripe webhooks need signature verification with the endpoint secret',
    url: 'https://docs.stripe.com/webhooks',
    category: 'integration_note',
    tags: ['stripe', 'webhooks'],
    importance: 0.9,
});
console.log('mcp store ok:', stored.ok, '| url:', stored.memory.url, '| site:', stored.memory.site);

const stored2 = await mcp.storeMemory({
    userId: 'user-1',
    content: 'The deploy pipeline runs on GitHub Actions every night',
    category: 'general',
    importance: 0.3,
});
console.log('mcp store2 ok:', stored2.ok);

// --- search via MCP adapter must rank identically to the batch action ---
const mcpResults = await mcp.searchMemories('user-1', 'stripe webhook signature', { limit: 5 });
const batchResults = await actionSearch(store, { query: 'stripe webhook signature', maxResults: 5 });
const sameRanking = JSON.stringify(mcpResults.map((r) => r.memory.id))
    === JSON.stringify(batchResults.memories.map((m) => m.id));
console.log('mcp search hits:', mcpResults.length, '| matched:', mcpResults[0]?.matchedTerms?.join(','));
console.log('MCP vs batch ranking identical:', sameRanking);

// --- recall / stats / prune ---
const recall = await mcp.recallMemories({ userId: 'user-1', category: 'integration_note' });
console.log('mcp recall count:', recall.count);
const stats = await mcp.getMemoryStats({ userId: 'user-1' });
console.log('mcp stats total:', stats.totalMemories, '| bySite:', JSON.stringify(stats.bySite));
const pruned = await mcp.pruneMemories('user-1', { pruneThreshold: 0.0001 });
console.log('mcp prune:', JSON.stringify({ pruned: pruned.pruned, remaining: pruned.remaining }));

// --- REST adapter (memory-manager.ts) over the same store shape ---
// Needs an Apify-like store; the REST manager opens stores itself via Actor,
// so only validate its export surface here.
console.log('rest adapter export:', typeof RestMemoryManager);

if (!stored.ok || !sameRanking) process.exit(1);
console.log('ALL CHECKS PASSED');
