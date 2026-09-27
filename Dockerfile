# animation-flow: one image serving the API and the built editor.
#   docker compose up --build        (see docker-compose.yml and .env.example)

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
RUN pnpm install --frozen-lockfile
RUN pnpm build
# the API with its production dependencies only (the bundle keeps fastify, pg, PGlite and the canvas library external)
RUN pnpm --filter @af/api deploy --prod --legacy /out

FROM node:22-bookworm-slim
# FFmpeg encodes the rendered frames into MP4
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_DIST=/app/web DATA_DIR=/data
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/web/dist ./web
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
