# Finance module API. Kept separate from the AfricanSTN API image so the
# module can be lifted out without untangling a shared build.
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# lib/ holds the tested decision logic. Copying server.js alone left
# require("./lib/xero") unresolvable and the container failed to start.
COPY server.js ./
COPY lib ./lib
# The same image runs the agent runner as the Cloud Run Job agent-runner
# (node runner.js, RUNNER_ONCE=1), started by this service when a run is queued.
COPY runner.js ./
# The agents' roles and standard procedures, read by lib/agent-procedures.js.
# They stay in this image: clients receive outputs, never the procedures.
COPY agents ./agents

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
