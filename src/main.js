import { Actor, log } from 'apify';

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------
// The actor supports three modes:
//   - "server"  → HTTP REST API (Apify Standby mode)
//   - "mcp"     → MCP server via stdio transport
//   - "actor"   → Standard one-shot batch execution (default)
//
// On the Apify platform, standby mode is detected by the presence of
// ACTOR_WEB_SERVER_PORT.  Locally, set ACTOR_MODE explicitly.
// ---------------------------------------------------------------------------

const actorMode = process.env.ACTOR_MODE || '';
const standbyPort = process.env.ACTOR_WEB_SERVER_PORT;
const isServerMode = actorMode === 'server' || !!standbyPort;
const isMcpMode = actorMode === 'mcp';

log.info('Mode detection', {
    actorMode: actorMode || '(unset)',
    standbyPort: standbyPort || '(unset)',
    selected: isServerMode ? 'server' : isMcpMode ? 'mcp' : 'actor (batch)',
});

// --- Standby / HTTP server mode ---
if (isServerMode) {
    log.info('Starting in HTTP server mode (standby)', { port: standbyPort });
    const { startServer } = await import('./server.ts');
    await startServer();
    // Keep the process alive — the Express server is running.
} else if (isMcpMode) {
    // --- MCP server mode (stdio transport) ---
    log.info('Starting in MCP server mode');
    const { startMcpServer } = await import('./mcp-server.ts');
    await startMcpServer();
} else {
    // --- Standard actor (batch) mode ---
    await runBatchMode();
}

// ===========================================================================
// Batch-mode implementation
// ===========================================================================
async function runBatchMode() {
    const {
        actionContextPack,
        actionForget,
        actionPrune,
        actionRecall,
        actionRemember,
        actionSearch,
        actionUpdate,
    } = await import('./actions.js');
    const { loadAllMemories, sanitizeStoreName } = await import('./memory-store.js');

    await Actor.init();

    const input = await Actor.getInput();
    const action = input?.action;
    const memoryStoreId = input?.memoryStoreId;

    if (!action || !memoryStoreId) {
        throw new Error('Input must include action and memoryStoreId');
    }

    const storeName = sanitizeStoreName(memoryStoreId);
    log.info('Opening named key-value store', { storeName, action });

    const store = await Actor.openKeyValueStore(storeName);

    /** @type {Record<string, unknown>} */
    let result;

    switch (action) {
        case 'remember':
        case 'store': // alias for remember
            result = await actionRemember(store, input);
            break;
        case 'recall':
            result = await actionRecall(store, input);
            break;
        case 'search':
            result = await actionSearch(store, input);
            break;
        case 'forget':
        case 'delete': // alias for forget
            result = await actionForget(store, input);
            break;
        case 'context_pack':
            result = await actionContextPack(store, input);
            break;
        case 'update':
            if (!input.memoryId) throw new Error('update requires memoryId');
            result = await actionUpdate(store, input);
            break;
        case 'stats': {
            const { memories } = await loadAllMemories(store);
            const byType = {};
            for (const m of memories) {
                byType[m.memoryType] = (byType[m.memoryType] || 0) + 1;
            }
            result = {
                action: 'stats',
                ok: true,
                totalMemories: memories.length,
                byType,
                lastUpdated: memories.length
                    ? memories.reduce((latest, m) => m.updatedAt > latest ? m.updatedAt : latest, '')
                    : null,
            };
            break;
        }
        case 'prune':
            result = await actionPrune(store, input);
            break;
        default:
            throw new Error(`Unknown action: ${action}`);
    }

    const output = {
        ...result,
        memoryStoreId,
        storeName,
    };

    await Actor.pushData(output);
    await Actor.setValue('OUTPUT', output);

    log.info('Done', { action, storeName });

    await Actor.exit();
}
