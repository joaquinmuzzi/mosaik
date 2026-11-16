# Mosaik's server (MOSAIK_MODE=server), for Railway or any Docker host. The database lives in /data, which
# must be a volume; the server needs PUBLIC_URL and, until the account exists, SETUP_TOKEN.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/hub/package.json packages/hub/
COPY packages/web/package.json packages/web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    MOSAIK_MODE=server \
    HUB_DB_PATH=/data/mosaik.db
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/hub/package.json packages/hub/
COPY packages/web/package.json packages/web/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/hub/dist packages/hub/dist
COPY --from=build /app/packages/hub/migrations packages/hub/migrations
COPY --from=build /app/packages/web/dist packages/web/dist
EXPOSE 7300
CMD ["node", "packages/hub/dist/main.js"]
