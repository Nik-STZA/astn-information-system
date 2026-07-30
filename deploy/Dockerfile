FROM node:20-slim

WORKDIR /app

# Install dependencies first (cached layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy all JS server files in one layer (avoids cache issues with individual COPYs)
COPY *.js ./
RUN ls -la /app/server*.js && echo "--- All server files copied ---"

EXPOSE 8080

CMD ["node", "server.js"]
