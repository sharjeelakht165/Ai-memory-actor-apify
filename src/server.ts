import express from 'express';
import cors from 'cors';
import { Actor, log } from 'apify';
import { MemoryManager } from './memory-manager.js';
import type { MemoryDetails, DecayConfig, SearchOptions, SearchResult } from './types.js';

export async function startServer(port?: number): Promise<void> {
    await Actor.init();

    const app = express();
    const serverPort = port || Number(process.env.ACTOR_WEB_SERVER_PORT) || 3000;
    const memoryManager = new MemoryManager();

    // Middleware
    app.use(cors());
    app.use(express.json());

    // Health check
    app.get('/api/health', (_req, res) => {
        res.json({
            status: 'ok',
            actor: 'AI Memory Actor',
            version: '1.0',
            timestamp: new Date().toISOString(),
        });
    });

    // Store a memory
    // POST /api/memories
    // Body: { userId, content, category?, tags?, importance?, metadata? }
    app.post('/api/memories', async (req, res) => {
        try {
            const { userId, ...memoryDetails } = req.body;
            if (!userId || !memoryDetails.content) {
                res.status(400).json({ error: 'userId and content are required' });
                return;
            }
            const memory = await memoryManager.storeMemory(userId, memoryDetails as MemoryDetails);
            res.status(201).json({ success: true, memory });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to store memory';
            res.status(500).json({ error: message });
        }
    });

    // Recall memories for a user
    // GET /api/memories/:userId?category=xxx&limit=20
    app.get('/api/memories/:userId', async (req, res) => {
        try {
            const { userId } = req.params;
            const category = req.query.category as string | undefined;
            const memories = await memoryManager.recallMemories(userId, category);
            res.json({ success: true, count: memories.length, memories });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to recall memories';
            res.status(500).json({ error: message });
        }
    });

    // Search memories
    // POST /api/memories/search
    // Body: { userId, query, category?, limit?, minScore? }
    app.post('/api/memories/search', async (req, res) => {
        try {
            const { userId, query, ...searchOpts } = req.body;
            if (!userId || !query) {
                res.status(400).json({ error: 'userId and query are required' });
                return;
            }
            const options: SearchOptions = {
                limit: searchOpts.limit,
                category: searchOpts.category,
                minScore: searchOpts.minScore,
            };
            const results: SearchResult[] = await memoryManager.searchMemories(userId, query, options);
            res.json({ success: true, count: results.length, results });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to search memories';
            res.status(500).json({ error: message });
        }
    });

    // Update a memory
    // PUT /api/memories/:userId/:memoryId
    // Body: { content?, category?, tags?, importance?, metadata? }
    app.put('/api/memories/:userId/:memoryId', async (req, res) => {
        try {
            const { userId, memoryId } = req.params;
            const updates = req.body;
            const memory = await memoryManager.updateMemory(userId, memoryId, updates);
            if (!memory) {
                res.status(404).json({ error: 'Memory not found' });
                return;
            }
            res.json({ success: true, memory });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update memory';
            res.status(500).json({ error: message });
        }
    });

    // Delete a memory
    // DELETE /api/memories/:userId/:memoryId
    app.delete('/api/memories/:userId/:memoryId', async (req, res) => {
        try {
            const { userId, memoryId } = req.params;
            const result = await memoryManager.deleteMemory(userId, memoryId);
            if (!result.deleted) {
                res.status(404).json({ error: 'Memory not found' });
                return;
            }
            res.json({ success: true, message: 'Memory deleted', memoryId });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete memory';
            res.status(500).json({ error: message });
        }
    });

    // Get memory statistics
    // GET /api/memories/:userId/stats
    app.get('/api/memories/:userId/stats', async (req, res) => {
        try {
            const { userId } = req.params;
            const stats = await memoryManager.getMemoryStats(userId);
            res.json({ success: true, stats });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to get stats';
            res.status(500).json({ error: message });
        }
    });

    // Prune memories (trigger decay)
    // POST /api/memories/:userId/prune
    // Body: { decayConfig? }
    app.post('/api/memories/:userId/prune', async (req, res) => {
        try {
            const { userId } = req.params;
            const decayConfig = req.body.decayConfig as Partial<DecayConfig> | undefined;
            const result = await memoryManager.pruneMemories(userId, decayConfig);
            res.json({ success: true, ...result });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to prune memories';
            res.status(500).json({ error: message });
        }
    });

    // API documentation endpoint
    app.get('/api/docs', (_req, res) => {
        res.json({
            name: 'AI Memory Actor API',
            version: '1.0',
            endpoints: [
                { method: 'GET', path: '/api/health', description: 'Health check' },
                { method: 'POST', path: '/api/memories', description: 'Store a new memory', body: '{ userId, content, category?, tags?, importance?, metadata? }' },
                { method: 'GET', path: '/api/memories/:userId', description: 'Recall memories', query: 'category?, limit?' },
                { method: 'POST', path: '/api/memories/search', description: 'Search memories', body: '{ userId, query, category?, limit?, minScore? }' },
                { method: 'PUT', path: '/api/memories/:userId/:memoryId', description: 'Update a memory', body: '{ content?, category?, tags?, importance? }' },
                { method: 'DELETE', path: '/api/memories/:userId/:memoryId', description: 'Delete a memory' },
                { method: 'GET', path: '/api/memories/:userId/stats', description: 'Get memory statistics' },
                { method: 'POST', path: '/api/memories/:userId/prune', description: 'Prune/decay memories', body: '{ decayConfig? }' },
            ],
        });
    });

    // Start server
    app.listen(serverPort, () => {
        log.info(`AI Memory Actor HTTP server running on port ${serverPort}`);
    });
}
