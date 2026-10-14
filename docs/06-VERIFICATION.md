# Verification record

Verified on 14 October 2026 using Node.js 24.19.0 on Windows.

- `npm test`: 7 tests passed, 0 failed.
- PDF test creates a valid text-layer PDF and verifies extracted invoice text; malformed signatures are rejected.
- Tests cover session expiry, incorrect credentials, unauthorized retrieval, direct action attempts, ingestion roles, duplicate ingestion/actions, deletion cascades, read-only ERP import, CSRF-header requirements, and HTTP logout.
- Ollama adapter tests use a mock response and simulated connection failure. No actual model inference was tested.
- Browser checks: admin sign-in, ERP sync, source listing, cited invoice search, in-app confirmation dialog, pending review task and reuse of the same review ID.
- Browser preview was inspected at the app's narrow panel width. A full desktop/mobile device matrix was not tested.
- Dependency install audit reported zero known vulnerabilities at installation time; this is not a security certification.
- Docker was not installed on the verification machine. Dockerfile/Compose are supplied, but image build and container startup remain unverified.

The running demo contains two fictional ERP invoices and a pending review for INV-1001. Demo data is stored under the ignored `data/demo` directory.
