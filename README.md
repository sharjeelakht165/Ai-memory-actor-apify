# Site Memory Agent (Apify Actor)

Persistent **website memory** for AI coding agents. Use it from [Apify MCP](https://docs.apify.com/integrations/mcp) (`call-actor` or preload this Actor in your MCP URL) so Cursor, Claude, and other clients can **remember** integration notes across chat sessions.

## Is it actually helpful?

**Yes, in a narrow but real way** — not as a replacement for reading docs or your repo.

| Helps when | Does not help when |
|------------|-------------------|
| You revisit the same docs/API (Stripe, Apify, OAuth providers) across many chats | The answer is already in the open files in your IDE |
| You discover **non-obvious** facts (header required, wrong example in docs, working selector) | You need live page content (use `apify/rag-web-browser`) |
| You want a **stable `memoryStoreId` per repo** so the team shares the same notes | You expect the model to “just remember” without calling the tool |
| Token budget matters — `context_pack` returns a trimmed markdown bundle | You need guaranteed freshness without optional snapshot/diff (v2) |

Think of it as **external hippocampus for the web**: cheap KV reads/writes, schema-defined MCP tool, not magic.

## Actions

| Action | Purpose |
|--------|---------|
| `remember` | Save or update a memory (`content`, optional `url`, `memoryDetails`) |
| `recall` | List memories for a URL/site, ranked by relevance |
| `search` | Keyword search across memories |
| `forget` | Delete by `memoryId` |
| `context_pack` | Markdown bundle for the model (~`maxTokens` budget) |

Memories live in a **named key-value store** derived from `memoryStoreId` (retained indefinitely on Apify).

## MCP setup (Cursor / Claude)

1. Connect to [mcp.apify.com](https://mcp.apify.com) with your Apify token.
2. Add your Actor after publish, e.g. `YOUR_USER/site-memory-agent`.
3. Typical agent flow:
   - `fetch-actor-details` → read input schema
   - `call-actor` with `action: context_pack` before coding against a doc URL
   - After debugging: `action: remember` with the quirk you found
   - `get-dataset-items` for the run output (MCP returns `nextStep` for this)

Example input:

```json
{
  "action": "remember",
  "memoryStoreId": "myuser~stripe-checkout",
  "url": "https://docs.stripe.com/webhooks",
  "content": "Must use raw body for signature verification; JSON middleware breaks it.",
  "memoryDetails": {
    "memoryType": "api_quirk",
    "tags": ["webhooks", "express"],
    "source": "agent"
  }
}
```

## Local development

Requires **Node.js 18+** (LTS recommended).

```bash
npm install
npm test              # unit tests
npm run test:local    # end-to-end: remember → context_pack → search
npm start             # single run using INPUT.json below
```

Edit input for each run:

`storage/key_value_stores/default/INPUT.json`

Example:

```json
{
  "action": "context_pack",
  "memoryStoreId": "demo-user~local",
  "url": "https://docs.apify.com/integrations/mcp"
}
```

**Where output goes locally**

| Path | Contents |
|------|----------|
| `storage/datasets/default/*.json` | Run result (same as MCP `get-dataset-items`) |
| `storage/key_value_stores/<storeName>/` | Persistent memories (`__manifest.json`, `memory-<uuid>.json`) |
| `storage/key_value_stores/default/OUTPUT.json` | Last run output mirror |

Named store folders under `storage/key_value_stores/` simulate Apify **named KV stores** on the platform.

## Deploy

```bash
apify login
apify push
```

Publish to Apify Store when ready; quality README and input schema improve MCP discovery ranking.

## Security

Anyone who knows your `memoryStoreId` can read/write that store. Use an unguessable id (e.g. `username~random-project-slug`). Optional `storeSecret` can be added in v2.

## License

Apache-2.0
