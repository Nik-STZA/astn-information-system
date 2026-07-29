# Finance module API. Kept separate from the AfricanSTN API image so the
# module can be lifted out without untangling a shared build.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
