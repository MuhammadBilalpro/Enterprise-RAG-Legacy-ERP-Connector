# Atlas — Enterprise RAG & Legacy ERP Connector

A runnable learning MVP connecting text-layer PDF invoices, Slack JSON exports, and a legacy SQL invoice database to role-aware retrieval and a confirmed invoice-review action. Includes a browser dashboard and Roman Urdu learning material.

## Start locally

Requires Node.js 24 or later. From this folder:

```powershell
npm ci
npm run demo
```

Open **http://localhost:3000**. Demo accounts:

| Username | Password | Access |
|---|---|---|
| admin | admin-demo-2026 | All sources; ingestion, deletion, audit |
| finance | finance-demo-2026 | Employee + finance sources; review requests |
| employee | employee-demo-2026 | Employee sources |

These public credentials are only for local fictional data. The demo binds to localhost and stores its data under `data/demo`. Normal startup uses `data`.

1. Sign in as admin and click **Sync demo ERP**.
2. Upload `samples/handbook.txt` as plain text with **All employees** access.
3. Upload `samples/slack-channel.json` as Slack JSON with **Finance + admin** access.
4. Search `overdue Acme invoice`. Inspect source citations and request an invoice review.
5. Sign out, sign in as employee, and repeat. Finance sources disappear from retrieval and listings.
6. Search `remote work policy` as employee; the handbook remains available.

## Docker

Install Docker with Compose, copy `.env.example` to `.env`, and replace all three password placeholders. Then:

```powershell
docker compose up --build -d
```

Open http://localhost:3000. A named volume retains the databases. `docker compose down` stops the service without deleting that volume. Port publishing is restricted to localhost. For remote use, configure a TLS reverse proxy, trusted network access, and `COOKIE_SECURE=true`.

Accounts are initialized only on first creation. Changing environment passwords does **not** rotate passwords in an existing database. This MVP has no user-management/reset UI. Do not delete a production database to rotate credentials; implement a proper admin rotation flow first.

For normal Node startup with `.env`:

```powershell
node --env-file=.env src/server.js
```

## What works

- PDF text extraction (100 pages / 5 MB upload limit), plain text, Slack message exports.
- Unicode/whitespace cleanup, overlapping chunks, provenance, exact-content deduplication.
- Read-only SQLite ERP adapter with a fixed query; currency stored as integer cents upstream.
- BM25 lexical ranking, with role filtering **before** ranking and model context construction.
- Optional Ollama-generated answers grounded in retrieved excerpts; default mode is extractive.
- Server-side sessions, scrypt password hashes, role checks on every protected API.
- Confirmed and idempotent invoice-review requests, audit metadata, cascading document deletion.
- Responsive dashboard, Docker configuration, automated security and connector tests.

## Optional generative RAG

Run an Ollama server you control and install a model appropriate for your machine. Set `OLLAMA_URL` and `OLLAMA_MODEL` to that server and its exact installed model name, then restart Atlas. A local Node process normally uses `http://localhost:11434`; a Docker Desktop container can use `http://host.docker.internal:11434`. Linux Docker networking needs separate configuration.

The server calls Ollama's [chat API](https://docs.ollama.com/api/chat) with authorized evidence. No model or model download is bundled. Connection failures fall back to excerpts. Generated answers need verification; prompts cannot guarantee accurate citations or immunity to prompt injection. The model has no action tools or SQL access.

## Tests and learning docs

```powershell
npm test
```

If a restricted environment blocks child processes, use `node --test --test-isolation=none`.

Read these in order:

1. [Roman Urdu fundamentals](docs/01-FUNDAMENTALS-ROMAN-URDU.md)
2. [Architecture and code walkthrough](docs/02-ARCHITECTURE.md)
3. [Hands-on exercises and interview explanation](docs/03-PRACTICE-AND-INTERVIEW.md)
4. [Security, privacy, and production gaps](docs/04-SECURITY-AND-PRODUCTION.md)
5. [API reference](docs/05-API.md)
6. [Verification record and remaining checks](docs/06-VERIFICATION.md)

## Honest scope

This is a single-organization prototype, not a production ERP integration or a compliance certification. The Slack connector imports JSON exports; it does not connect to Slack OAuth or sync permissions. ERP sync imports snapshots from a seeded SQLite database, not SAP/Oracle/PostgreSQL. Changed source records create new snapshots; old versions must be deleted to avoid stale retrieval. There is no OCR, semantic embedding index, autonomous planning, payment execution, or completed-review workflow. Production work is detailed in the security guide.
