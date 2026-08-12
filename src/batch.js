/**
 * Standalone batch entry point for Apify call-actor invocations.
 * Reads INPUT, runs the requested action, writes OUTPUT, exits.
 * No server/MCP code — pure one-shot execution.
 */
import { Actor, log } from 'apify';
import {
    actionChunk,
    actionContextPack,
    actionForget,
    actionPrune,
    actionRecall,
    actionRemember,
    actionSearch,
    actionUpdate,
} from './actions.js';
import { loadAllMemories, sanitizeStoreName } from './memory-store.js';

// Wrap everything so any crash writes an ERROR key we can read
try {
    await Actor.init();

    const input = await Actor.getInput();
    const action = input?.action;
    const memoryStoreId = input?.memoryStoreId;

    if (!action || !memoryStoreId) {
        throw new Error('Input must include action and memoryStoreId');
    }

    const storeName = sanitizeStoreName(memoryStoreId);
    log.info('Batch mode', { action, storeName });

    const store = await Actor.openKeyValueStore(storeName);

    /** @type {Record<string, unknown>} */
    let result;

    switch (action) {
        case 'remember':
        case 'store':
            result = await actionRemember(store, input);
            break;
        case 'recall':
            result = await actionRecall(store, input);
            break;
        case 'search':
            result = await actionSearch(store, input);
            break;
        case 'forget':
        case 'delete':
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
        case 'chunk':
            result = await actionChunk(store, input);
            break;
        default:
            throw new Error(`Unknown action: ${action}`);
    }

    const output = { ...result, memoryStoreId, storeName };

    await Actor.pushData(output);
    await Actor.setValue('OUTPUT', output);

    log.info('Done', { action, storeName });
    await Actor.exit();

} catch (err) {
    // Write the error so we can diagnose it via get-key-value-store-record
    console.error('BATCH_CRASH:', err?.message, err?.stack);
    try {
        await Actor.setValue('CRASH_ERROR', {
            message: err?.message,
            stack: err?.stack,
            name: err?.name,
        });
    } catch (_) { /* ignore secondary error */ }
    process.exit(1);
}
