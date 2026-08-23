# Multi-stage build. The same image runs the API or the worker depending on
# the command given by docker-compose (start:api / start:worker).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install -g npm@11 && npm ci
COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/package.json ./
COPY --chown=app:app help ./help
USER app
EXPOSE 3000
CMD ["node", "dist/api.js"]
