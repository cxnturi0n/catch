# Deploy

One-host Docker Compose stack: Caddy edge (TLS) → frontend (static) + api; worker; PostgreSQL.

```bash
cp .env.example .env && chmod 600 .env   # fill in values
docker compose up -d --build
docker compose ps
curl -k https://localhost/api/readyz
```

Frontend and backend are separate images and can be moved to different hosts:
point the edge Caddy `reverse_proxy` targets at the other host and set
`APP_URL` / `VITE_API_URL` accordingly.

Local dev without containers for app code: `docker compose up -d db`, then run
`npm run dev` in `frontend/` and `npm run dev:api` in `backend/`.
