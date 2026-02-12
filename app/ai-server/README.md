# VIZI AI (Postgres)

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
  - returns:
    - DDL request: `{ "mode": "ddl", "sql": "...", "summary": "..." }`
    - Records request: `{ "mode": "query", "sql": "SELECT ...", "summary": "...", "columns": [...], "rows": [...], "rowCount": n }`
    - Report request: `{ "mode": "report", "reportName": "...", "sql": "SELECT ...", "summary": "...", "columns": [...], "rows": [...], "rowCount": n }`
    - Non-SQL answer: `{ "mode": "answer", "sql": "", "summary": "..." }`
- `POST /api/ai/apply`
  - body: `{ "sql": "CREATE TABLE ..." }`
- `GET /api/reports`
  - returns saved reports for current user
- `POST /api/reports`
  - body: `{ "id"?: "...", "name": "...", "description"?: "...", "sql": "SELECT ..." }`
  - creates or updates a report
- `POST /api/reports/:id/run`
  - executes saved report query and returns rows
- `DELETE /api/reports/:id`
  - deletes a saved report

Only `CREATE TABLE` and `CREATE INDEX` statements are allowed to apply.
