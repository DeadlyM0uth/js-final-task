# Образ приложения: Node.js 22 LTS без лишних зависимостей.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Сначала зависимости — слой кэшируется, пока не менялся package-lock.json.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts

# Права на чтение независимо от режима файлов в репозитории.
RUN chmod -R a+rX /app

# Приложение не должно работать от root.
USER node
EXPOSE 3000

CMD ["node", "src/server.js"]
