# ---------------------------------------------------------------- construção
FROM node:22-slim AS construcao
WORKDIR /app

# better-sqlite3 usa binário pré-compilado quando disponível; estas ferramentas
# cobrem o caso em que ele precisa ser compilado na plataforma de destino.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY . .
RUN npm run build

# ------------------------------------------------------------------ execução
FROM node:22-slim AS execucao
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3333
ENV DATABASE_PATH=/app/data/gsti.sqlite

COPY --from=construcao /app/node_modules ./node_modules
COPY --from=construcao /app/package.json ./package.json
COPY --from=construcao /app/server/package.json ./server/package.json
COPY --from=construcao /app/server/dist ./server/dist
COPY --from=construcao /app/web/dist ./web/dist

# O banco fica em volume: o contêiner é descartável, os dados não.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
