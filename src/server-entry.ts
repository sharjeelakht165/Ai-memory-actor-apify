/**
 * Entry point for standby / server mode.
 * Boots the Express HTTP server (REST API + /mcp Streamable HTTP endpoint).
 *
 * Used by the Dockerfile CMD in standby mode:
 *   CMD ["node", "dist/server-entry.js"]
 */
import { startServer } from './server.js';

startServer().catch((err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
});
