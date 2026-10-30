# ---------- build stage ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# build tools only needed if better-sqlite3 has no prebuilt binary for the platform
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --include=dev
COPY . .
RUN npm run build && npm prune --omit=dev

# ---------- runtime stage ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 DATABASE_PATH=/app/data/workbench.db
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/samples samples
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
