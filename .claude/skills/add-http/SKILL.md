---
name: add-http
description: Use when NanoClaw needs to receive task delegations from FastAPI via webhooks or when asynchronous callbacks for task results are failing or need implementation.
---

# HTTP Channel Skill

## Overview
Adds HTTP channel support to NanoClaw for receiving task delegations from FastAPI Director and sending results back via callback using a stateless JID-based routing mechanism.

## When to Use
### Symptoms
- NanoClaw is not receiving tasks dispatched by the FastAPI Director.
- Webhook endpoints (`/api/webhooks/fastapi`) are returning 404 or connection errors.
- Task results are not reaching the FastAPI callback URL.
- JID encoding/decoding errors (e.g., "invalid JID format" for HTTP types).

### Use Cases
- Implementing the **Director-Artisan pattern** for long-running agent tasks.
- Setting up a stateless communication bridge between FastAPI and NanoClaw.
- Enabling asynchronous, fire-and-forget task delegation with dynamic callbacks.

## Core Pattern
### Stateless JID Encoding
The skill embeds the base64-encoded callback URL directly into the JID to maintain statelessness across process restarts.
- **JID Format**: `http:{base64(callback_url)}`
- **Logic**: Extract `callback_url` from the JID when the task is complete to send the response.

### Minimal Dependency Webhook
Uses Node.js `node:http` to implement a lightweight server that:
1. Validates the payload.
2. Dispatches the task to the group queue.
3. Returns `202 Accepted` immediately.

## Quick Reference
### Ingress Schema (`POST /api/webhooks/fastapi`)
```json
{
  "task": "string",
  "task_id": "string",
  "session_id": "string",
  "callback_url": "string",
  "context": {}
}
```

### Egress Schema (`POST {callback_url}`)
```json
{
  "task_id": "string",
  "status": "success" | "failed",
  "summary": "string"
}
```

## Implementation
### Components
- **HTTP Channel** (`src/channels/http.ts`): native HTTP server and JID handling.
- **Tests** (`src/channels/http.test.ts`): Comprehensive unit and integration tests.
- **Registry** (`src/channels/index.ts`): Auto-registers the channel on import.

### Commands
```bash
# Verify implementation
npm test -- src/channels/http.test.ts
```

## Common Mistakes
- **Missing HTTP_PORT**: The channel is silently disabled if `HTTP_PORT` is not in the environment.
- **Base64 Padding**: Incorrectly padding or stripping base64 during JID construction.
- **Retry Logic**: Attempting to implement retries for callbacks; the PRD mandates logging only to prevent loops.

## Real-World Impact
- Provides a robust, stateless bridge for multi-service agent architectures.
- Ensures reliable task delivery even if the NanoClaw process restarts during execution.
