FROM apify/actor-node:22

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && rm -rf ~/.npm

# Copy source code
COPY . ./

# Expose port for HTTP server mode
EXPOSE 3000

# The actor mode is controlled by the ACTOR_MODE environment variable:
# - "actor" (default): Standard Apify actor input/output mode
# - "server": HTTP API server mode
# - "mcp": MCP server mode (stdio transport)
CMD ["npm", "run", "start"]
