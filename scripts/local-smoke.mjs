/**
 * Local end-to-end smoke test without Apify Console.
 * Uses the same storage layout as `npm start` (Apify SDK local emulation).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const inputPath = path.join(root, 'storage', 'key_value_stores', 'default', 'INPUT.json');
const datasetDir = path.join(root, 'storage', 'datasets', 'default');

const steps = [
    {
        name: 'remember',
        input: {
            action: 'remember',
            memoryStoreId: 'local-smoke~demo',
            url: 'https://docs.apify.com/integrations/mcp',
            content: 'After call-actor, use get-dataset-items to read the result payload.',
            memoryDetails: {
                memoryType: 'integration_note',
                tags: ['mcp', 'smoke-test'],
                source: 'agent',
            },
        },
    },
    {
        name: 'context_pack',
        input: {
            action: 'context_pack',
            memoryStoreId: 'local-smoke~demo',
            url: 'https://docs.apify.com/integrations/mcp',
            maxTokens: 2500,
        },
    },
    {
        name: 'search',
        input: {
            action: 'search',
            memoryStoreId: 'local-smoke~demo',
            query: 'dataset',
        },
    },
];

function latestDatasetJson() {
    if (!fs.existsSync(datasetDir)) return null;
    const files = fs.readdirSync(datasetDir).filter((f) => f.endsWith('.json'));
    if (!files.length) return null;
    files.sort();
    const raw = fs.readFileSync(path.join(datasetDir, files[files.length - 1]), 'utf8');
    return JSON.parse(raw);
}

let failed = false;

for (const step of steps) {
    fs.writeFileSync(inputPath, `${JSON.stringify(step.input, null, 2)}\n`);
    const run = spawnSync(process.execPath, ['src/main.js'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env },
    });
    if (run.status !== 0) {
        console.error(`FAIL ${step.name}\n`, run.stdout, run.stderr);
        failed = true;
        break;
    }
    const out = latestDatasetJson();
    console.log(`OK ${step.name}:`, out?.action, out?.ok === true ? 'ok' : out);
    if (step.name === 'context_pack' && (!out?.contextMarkdown || out.memoriesUsed?.length < 1)) {
        console.error('FAIL context_pack: expected contextMarkdown and memoriesUsed');
        failed = true;
        break;
    }
}

process.exit(failed ? 1 : 0);
