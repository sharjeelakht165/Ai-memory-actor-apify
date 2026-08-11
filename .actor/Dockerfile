FROM apify/actor-node:22

# Copy package files
COPY package*.json ./

# Install production dependencies only (dist/ is pre-compiled and committed)
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && rm -rf ~/.npm

# Copy source code and pre-compiled dist/
COPY . ./

# Expose port for HTTP server mode
EXPOSE 3000

# The actor mode is controlled by the ACTOR_MODE environment variable:
# - "actor": Standard Apify actor input/output mode (batch, one-shot)
# - "server": HTTP API server mode with REST + /mcp Streamable HTTP endpoint (default, standby)
# - "mcp": MCP server mode (stdio transport, local only)
ENV ACTOR_MODE=actor

# Run the batch entry point via npm start
CMD npm start --silent
