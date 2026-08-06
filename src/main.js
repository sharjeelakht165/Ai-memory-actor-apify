import { Actor, log } from 'apify';

import {
    actionContextPack,
    actionForget,
    actionRecall,
    actionRemember,
    actionSearch,
} from './actions.js';
import { sanitizeStoreName } from './memory-store.js';

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
        result = await actionRemember(store, input);
        break;
    case 'recall':
        result = await actionRecall(store, input);
        break;
    case 'search':
        result = await actionSearch(store, input);
        break;
    case 'forget':
        result = await actionForget(store, input);
        break;
    case 'context_pack':
        result = await actionContextPack(store, input);
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
