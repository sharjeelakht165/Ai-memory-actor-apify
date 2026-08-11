FROM apify/actor-node:22

# Copy package files
COPY package*.json ./

# Install ALL deps (including devDependencies) for the build step
RUN npm --quiet set progress=false \
    && npm install \
    && rm -rf ~/.npm

# Copy source code
COPY . ./

# Compile TypeScript to dist/
RUN npx tsc --project tsconfig.json

# Remove dev dependencies after build to keep the image lean
RUN npm prune --omit=dev

# Expose port for HTTP server mode
EXPOSE 3000

# The actor mode is controlled by the ACTOR_MODE environment variable:
# - "actor": Standard Apify actor input/output mode (batch, one-shot)
# - "server": HTTP API server mode with REST + /mcp Streamable HTTP endpoint (default, standby)
# - "mcp": MCP server mode (stdio transport, local only)
ENV ACTOR_MODE=server

# In server mode, run the compiled JS entry point directly (no tsx needed)
CMD ["node", "dist/server-entry.js"]
