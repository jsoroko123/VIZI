# MESORA AI (Postgres)

This server exposes endpoints used by the Mesora `/ai` page to generate and apply PostgreSQL DDL.

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

## Microsoft Login (Optional)
Microsoft OAuth is already supported by the backend and login page.

1. Create an App Registration in Microsoft Entra ID.
2. Add a Web redirect URI:
   - `http://localhost:5055/api/auth/microsoft/callback`
   - or `https://<your-host>/api/auth/microsoft/callback`
3. Set these in `ai-server/.env`:
   - `MS_OAUTH_TENANT` (e.g. `common`, tenant id, or domain)
   - `MS_OAUTH_CLIENT_ID`
   - `MS_OAUTH_CLIENT_SECRET`
   - `MS_OAUTH_REDIRECT_URI` (optional; auto-derived if omitted)
   - `MS_OAUTH_SCOPES` (default: `openid profile email User.Read`)
4. Restart `ai-server`.

The login page shows **Sign in with Microsoft** automatically when OAuth is configured.
