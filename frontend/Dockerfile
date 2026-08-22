# Builds the SPA and serves it with Caddy. VITE_* values are baked at build
# time, so pass them as --build-arg (see deploy/docker-compose.yml).
FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL=/api
ARG VITE_APP_ENV=production
ENV VITE_API_URL=$VITE_API_URL VITE_APP_ENV=$VITE_APP_ENV
COPY package.json package-lock.json ./
RUN npm install -g npm@11 && npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine AS runtime
COPY --from=build /app/dist /srv/web
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
