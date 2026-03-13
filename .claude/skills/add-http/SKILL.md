---
name: add-http
description: Use when NanoClaw needs to receive task delegations from FastAPI via webhooks or when asynchronous callbacks for task results are failing or need implementation.
---

# Add HTTP Channel (FastAPI Director-Artisan Bridge)

This skill adds an HTTP webhook channel to NanoClaw so the FastAPI Director can delegate long-running tasks and receive async callbacks.

## Phase 1: Pre-flight

### Check if already applied

Check if `src/channels/http.ts` exists. If it does, skip to Phase 3 (Setup). The code changes are already in place.

## Phase 2: Apply Code Changes

### Ensure skill remote

```bash
git remote -v
```

The skill lives on a branch in the user's fork. `origin` should already point to it. If `origin` does not point to `https://github.com/yw0nam/nanoclaw.git`, add it explicitly:

```bash
git remote add backend-http https://github.com/yw0nam/nanoclaw.git
# Then use 'backend-http' instead of 'origin' in the commands below.
```

### Merge the skill branch

```bash
git fetch origin skill/backend-http
git merge origin/skill/backend-http || {
  git checkout --theirs package-lock.json
  git add package-lock.json
  git merge --continue
}
```

This merges in:
- `src/channels/http.ts` — stateless webhook server (JID format: `http:{base64(callback_url)}`)
- `src/channels/http.test.ts` — unit and integration tests
- `import './http.js'` added to the channel barrel file `src/channels/index.ts`
- No new npm dependencies (uses Node.js built-in `node:http`)

If the merge reports conflicts, resolve them by reading the conflicted files and understanding the intent of both sides. The `src/channels/index.ts` barrel file must keep all channel imports alphabetically ordered.

### Validate code changes

```bash
npm run build
npx vitest run src/channels/http.test.ts
```

All tests must pass and build must be clean before proceeding.

## Phase 3: Setup

### Configure environment

Add to `.env`:

```bash
HTTP_PORT=4000
```

The channel is silently disabled if `HTTP_PORT` is not set — no crash, just no listener.

> **Note**: NanoClaw's credential proxy already uses port 3001. Use a different port (e.g. 4000) for HTTP_PORT.

Sync to container environment:

```bash
mkdir -p data/env && cp .env data/env/env
```

### Build and restart

```bash
npm run build
# macOS:
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
# Linux:
# systemctl --user restart nanoclaw
```

## Phase 4: Verify

### Test the webhook

```bash
curl -s -X POST http://localhost:4000/api/webhooks/fastapi \
  -H 'Content-Type: application/json' \
  -d '{"task":"hello","task_id":"t1","session_id":"s1","callback_url":"http://localhost:5500/v1/callback/nanoclaw/s1","context":{}}'
```

Expected: HTTP 202 with `{"status":"accepted","task_id":"t1"}`.

### Check logs

```bash
tail -f logs/nanoclaw.log
```

## Architecture Reference

### Ingress (`POST /api/webhooks/fastapi`)

```json
{ "task": "string", "task_id": "string", "session_id": "string", "callback_url": "string", "context": {} }
```

Returns `202 Accepted` immediately (fire-and-forget). The agent result is POSTed to `callback_url` when done.

### Egress (`POST {callback_url}`)

```json
{ "task_id": "string", "status": "done" | "failed", "summary": "string" }
```

### JID Encoding

Callback URL is embedded in the JID so NanoClaw stays stateless across restarts:

```
JID = "http:" + base64url(callback_url)
```

## Common Mistakes

- **Missing HTTP_PORT**: Channel silently disabled — no error on startup.
- **Port collision**: Don't use 3001 (credential proxy). Use 4000 or another free port.
- **Retry logic**: Don't add retries for callbacks — log-only to prevent feedback loops.

## Removal

1. Delete `src/channels/http.ts` and `src/channels/http.test.ts`
2. Remove `import './http.js'` from `src/channels/index.ts`
3. Remove `HTTP_PORT` from `.env`
4. Rebuild: `npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw` (macOS) or `systemctl --user restart nanoclaw` (Linux)
