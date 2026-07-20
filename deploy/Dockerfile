FROM node:20-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy server files
COPY server.js ./
COPY server-listing-routes.js ./
COPY server-pipeline-routes.js ./
COPY server-client-management-routes.js ./
COPY server-agent-routes.js ./
COPY server-remediation-routes.js ./
COPY server-processing-routes.js ./
COPY server-dsar-routes.js ./

EXPOSE 8080

CMD ["node", "server.js"]
