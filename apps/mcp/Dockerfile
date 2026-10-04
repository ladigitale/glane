# Glane Claude connector (MCP relay). Build from the repo root:
#   docker build -f apps/mcp/Dockerfile -t glane-mcp .
FROM node:22-alpine AS build
WORKDIR /src
COPY . .
RUN yarn install --frozen-lockfile --ignore-scripts --network-timeout 600000 \
 && yarn --cwd apps/mcp build

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY --from=build /src/apps/mcp/dist/main.mjs ./main.mjs
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "main.mjs"]
