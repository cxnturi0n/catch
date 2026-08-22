# End-to-end tests (Playwright)

Drive the real UI against a running stack.

```bash
# terminal 1–3 (from repo root)
cd deploy && docker compose up -d db
cd backend && npm run dev:api          # NODE_ENV=development exposes /dev/outbox
cd frontend && npm run dev

# then
cd e2e && npm install && npm run install-browsers   # first time
npm test                                             # or: npm run ui
```

`E2E_BASE_URL` overrides `http://localhost:5173`. Verification and reset
links are read from the backend's in-memory outbox (`GET /api/dev/outbox`,
development only) — no mail provider needed.
