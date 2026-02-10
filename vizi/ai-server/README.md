# Vizi AI Table Builder (Postgres)

This server exposes endpoints used by the Vizi `/ai` page to generate and apply PostgreSQL DDL.

## Setup
1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:
   - `npm install` (inside `ai-server/`)
3. Start:
   - `npm start` (inside `ai-server/`)

From repo root you can run:
- `npm run ai-server`

## Endpoints
- `POST /api/ai/table-preview`
  - body: `{ "prompt": "...", "history": [{ "role": "user|assistant", "content": "..." }] }`
  - returns: `{ "sql": "...", "summary": "..." }`
- `POST /api/ai/apply`
  - body: `{ "sql": "CREATE TABLE ..." }`

Only `CREATE TABLE` and `CREATE INDEX` statements are allowed to apply.
