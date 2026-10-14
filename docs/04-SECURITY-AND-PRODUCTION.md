# Security, privacy, and production gaps

## Implemented controls

- scrypt password hashing with per-user salts; random server-side sessions stored as token hashes; eight-hour expiry and logout invalidation.
- HttpOnly/SameSite cookies; optional Secure flag for HTTPS; same-origin checks and a required custom header on mutating requests; no cross-origin API allowance.
- Role-based SQL filtering before scoring/model context, and repeated authorization at action/deletion endpoints.
- Parameterized queries; fixed read-only ERP query; no user-defined SQL or source file paths.
- Conservative admin-only default on new uploads; text-safe browser rendering; CSP and frame restrictions.
- Request/extracted-text/page limits; exact deduplication; task uniqueness; audit metadata rather than raw questions/documents.
- Ten failed login attempts per socket IP per 15 minutes in one process. This is a basic demo throttle, not a distributed abuse defense.

## Privacy scope

The EU's principles include data minimisation, storage limitation, and security. RBAC contributes to confidentiality but does not establish overall compliance. See the [European Commission's GDPR principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en) and the [EDPB's basic principles](https://www.edpb.europa.eu/topics/key-gdpr-concepts/basic-principles_en).

This application does not claim GDPR certification. An organization must determine its obligations for its actual processing, sources and deployment.

Extracted text is stored in plaintext SQLite files. Raw uploads are not persisted by the app. There is no PII detection/redaction or encryption-at-rest layer. Session cookies and password hashes are protected separately, but they do not encrypt document content.

Document deletion removes active database rows and cascading chunks/tasks. It is **logical deletion**, not certified secure erasure: SQLite pages, WAL files, browser memory, original upstream records, exports and backups may retain copies. The source connector may reimport an upstream record. Audit actor/target IDs are retained; no automated retention job exists.

Ollama receives question text and authorized excerpts when enabled. Configure only an endpoint you control and have approved for that data. Transport, logging, retention, model hosting and regional processing are deployment responsibilities.

## Before real company data

| Area | Work still required |
|---|---|
| Identity | Corporate OIDC/SSO, MFA policies, account provisioning, revocation, password rotation |
| Permissions | Source ACL import, document/team/tenant scopes, permission change propagation |
| Infrastructure | TLS, hardened proxy, encrypted storage, secrets management, backup/restore drills |
| Parsing | Isolated PDF workers, resource quotas, parser timeouts, OCR and layout-aware extraction |
| Ingestion | Background jobs, retries/dead-letter queue, stable source IDs, updates/deletes, incremental sync |
| Retrieval | Scalable indexes, semantic/hybrid retrieval, relevance evaluation, cross-tenant tests |
| AI | Model evaluation, citation validation, injection testing, approved endpoint/data policy |
| Actions | Review completion lifecycle, approver separation, ERP idempotency keys, transactional outbox |
| Privacy operations | Retention schedule, deletion propagation/backups, subject access/export, incident procedures |
| Observability | Structured redacted logs, metrics, alerts, tamper-resistant audit storage |

## Important failure cases

**Stale ERP snapshots:** changed content creates another indexed source. Both old and new text can match. This demo needs manual removal; production needs stable record IDs and transactional replacement or version-aware retrieval.

**Slack permissions:** an admin classifies an entire export. The connector does not verify Slack channel membership. Misclassification exposes data to the assigned role.

**PDF resource exhaustion:** page and byte limits are not a CPU/memory isolation boundary. A malicious file could still consume resources. Do not expose this parser to arbitrary public uploads.

**Concurrent revocation:** authorization is checked at retrieval time. A source deleted while a model response is in flight may remain in that response. Strict revocation requires revalidation before returning results and session/context cancellation.

**Generated answer quality:** the system prompt asks for grounded answers and citations, but the model may still hallucinate or follow embedded instructions. Tool execution is unavailable to it; human verification is still required.

**Credential operations:** environment variables bootstrap new users only. There is no password reset or role management API. Avoid treating this prototype as an internet-facing identity system.
