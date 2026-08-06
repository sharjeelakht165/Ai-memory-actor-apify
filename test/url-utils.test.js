import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeUrl, siteFromUrl, urlMatches } from '../src/url-utils.js';
import { contentHash, sanitizeStoreName } from '../src/memory-store.js';

describe('url-utils', () => {
    it('normalizes trailing slashes and hash', () => {
        assert.equal(
            normalizeUrl('https://docs.apify.com/integrations/mcp/#foo'),
            'https://docs.apify.com/integrations/mcp',
        );
    });

    it('extracts site without www', () => {
        assert.equal(siteFromUrl('https://www.stripe.com/docs'), 'stripe.com');
    });

    it('matches path prefixes on same origin', () => {
        assert.ok(urlMatches('https://docs.apify.com/integrations', 'https://docs.apify.com/integrations/mcp'));
    });
});

describe('memory-store helpers', () => {
    it('sanitizes store names', () => {
        assert.equal(sanitizeStoreName('User Name~My Project!'), 'user-name~my-project');
    });

    it('hashes content', () => {
        assert.equal(contentHash('hello').length, 16);
    });
});
