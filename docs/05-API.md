# API reference

API responses are JSON. Authenticated calls need the `session` cookie returned by login. POST and DELETE require `Content-Type: application/json` and `X-Requested-With: erp-dashboard`. Browser requests must be same-origin.

| Method | Path | Required access | Behavior |
|---|---|---|---|
| GET | `/api/health` | Public | Liveness response |
| POST | `/api/login` | Public | Username/password to session cookie |
| GET | `/api/me` | Signed in | Current ID, username, role |
| POST | `/api/logout` | Signed in | Invalidate session |
| GET | `/api/documents` | Signed in | Role-filtered source metadata |
| POST | `/api/ask` | Signed in | Authorized retrieval and optional answer |
| POST | `/api/ingest` | Admin | Import text, PDF, or Slack JSON |
| POST | `/api/sync` | Admin | Import seeded legacy ERP snapshots |
| GET | `/api/tasks` | Signed in | Tasks whose documents are accessible |
| POST | `/api/tasks` | Finance/admin | Confirmed review of visible PDF/ERP source |
| DELETE | `/api/documents/:id` | Admin | Delete source/chunks/linked tasks |
| GET | `/api/audit` | Admin | Latest 100 audit events |

## Examples

Login:

```json
{"username":"finance","password":"finance-demo-2026"}
```

Search:

```json
{"query":"overdue Acme invoice"}
```

Search response includes `mode` (`local-extractive` or `ollama-rag`), `answer`, optional `warning`, and `results`. Each result has `document_id`, `chunk_id`, `position`, `title`, `source`, `text`, and `score`. Positions are zero-based in the API. Scores are ranking values, not probabilities.

Text ingestion:

```json
{"title":"Remote work policy","source":"text","role":"employee","text":"Employees may work remotely three days each week with manager agreement."}
```

Slack ingestion:

```json
{"title":"Finance channel export","source":"slack","role":"finance","slack":[{"user":"U_DEMO","ts":"1791936000.0","text":"Acme delivery update: shipment arrives Friday."}]}
```

PDF ingestion uses the same title/role fields, `source: "pdf"`, and `base64` containing encoded file bytes (without a data-URL prefix).

Review action:

```json
{"documentId":1,"confirm":true}
```

Repeated requests return the existing task. `confirm` records explicit client intent; it is not a cryptographic approval signature or a substitute for organizational authorization.

Errors use `{"error":"message"}`. Empty search is a successful 200 response with no results. A direct request for an inaccessible review source returns a generic unavailable error rather than its content.
