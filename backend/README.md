# SCTracker Backend

TypeScript/Fastify API for PostgreSQL 15+ with PostGIS. Every tenant-owned table has
row-level security and every application query runs in a transaction with
`app.current_organization`. Mutations relevant to compliance are written to the
append-only audit log.

## Local setup

```powershell
Copy-Item .env.example .env
# Set DATABASE_URL, JWT_SECRET, CONFIG_ENCRYPTION_KEY and bootstrap credentials.
npm install
npm run migrate
npm run dev
```

The migration requires a PostgreSQL role allowed to install `postgis` and `pgcrypto`.
The migration runner establishes the session-level system RLS context before it
executes the migration lock, migration metadata, or migration SQL. This is required
when later migrations update tenant-protected tables through a normal application
database role.
After the first migration, remove `BOOTSTRAP_ADMIN_PASSWORD` from `.env`. The static
admin SPA is served at `http://127.0.0.1:4300/admin/`.

## Provisioned Neon database

The dedicated `sctracker_asteros` database is provisioned in the existing Neon
`sctracker` project on AWS Frankfurt (`aws-eu-central-1`). It contains all
migrations through `003_dds_idempotency_and_plot_geofence.sql`, including
PostGIS, row-level security, audit logging, geofencing, and DDS reconciliation.

Copy the pooled connection string for `sctracker_asteros` from the Neon console
into `DATABASE_URL` in the local `.env`; never commit that value. The initial
system administrator is `arron.johannes@googlemail.com`. Its generated initial
password is stored only in the ignored local `.bootstrap-admin-password` file.

## Authentication and authorization

- Passwords use Argon2id (64 MiB, 3 iterations).
- HS256 access JWTs default to 15 minutes and contain user, role, tenant, and token
  version claims.
- Opaque 256-bit refresh tokens are stored only as SHA-256 hashes, rotate on every
  use, and belong to a revocable token family.
- Roles: `system_admin`, `org_admin`, `reviewer`, `field_agent`, `auditor`.
- Pass `Authorization: Bearer <accessToken>` on all protected routes.
- Success: `{ "data": ... }`; error:
  `{ "error": { "code": "...", "message": "...", "details": ... } }`.

## API contract

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/auth/login` | `{email,password,organizationSlug?}` → tokens, user, organizations, selected organization |
| POST | `/api/v1/auth/refresh` | Rotate `{refreshToken}` and return the same organization selection fields |
| POST | `/api/v1/auth/logout` | Revoke supplied refresh token |
| GET | `/api/v1/auth/me` | Current principal |
| GET | `/api/v1/geofences` | Active geofences for the authenticated organization |
| POST | `/api/v1/sync/push` | Mobile `{deviceId,operations[]}`; returns accepted/conflicts |
| GET | `/api/v1/sync/pull?cursor=0&limit=500` | Ordered tenant changes and next cursor |
| POST | `/api/v1/documents/uploads` | Initiate local upload; requires `Idempotency-Key` |
| PUT | `/api/v1/documents/uploads/:id/content?token=...` | Upload exact raw bytes |
| POST | `/api/v1/documents/uploads/:id/complete` | Verify and complete upload |
| GET | `/api/v1/documents/:id` | Tenant-authenticated download |
| POST/GET | `/api/v1/satellite/analyses[/:id]` | Satellite operation |
| POST/GET | `/api/v1/evidence-packs[/:id]` | Generate/query evidence pack |
| POST/GET | `/api/v1/dds/drafts[/:id]` | Create/query DDS draft |
| POST | `/api/v1/dds/drafts/:id/validate` | Validate draft |
| POST | `/api/v1/dds/drafts/:id/submit` | Submit only after review approval |
| GET/POST/PATCH | `/api/v1/admin/organizations...` | Organizations, users, config, geofences |
| GET | `/api/v1/admin/organizations/:id/reviews` | Geofence and DDS review queue |
| POST | `/api/v1/admin/reviews/:type/:id/decision` | Approve/reject review |
| GET | `/api/v1/admin/organizations/:id/dds-reconciliation` | Uncertain/in-progress DDS submissions requiring an explicit decision |
| POST | `/api/v1/admin/dds-actions/:id/reconcile` | Confirm an external reference or reset a submission as not submitted |
| GET | `/api/v1/admin/organizations/:id/audit-logs` | Tenant audit history |

Operation-creation and DDS action requests require `Idempotency-Key`. A plot outside
all active organization geofences creates a review and returns HTTP 409
`GEOFENCE_REVIEW_REQUIRED`; the exact same idempotent operation remains retryable and
is accepted after approval. The error details are
`{"violations":[{"violationId":"...","operationId":"...","entityId":"..."}]}`;
every entry is derived from the current tenant's batch and identifies the exact plot
outbox operation that caused the violation. Plot objects returned through sync pull or conflict
payloads contain the authoritative `geofenceStatus` (`pending`, `inside`,
`review_required`, or `approved`) and `localGeofenceResult` (`pending`, `inside`, or
`outside`). An approved out-of-fence exception is represented as
`geofenceStatus: "approved"` and `localGeofenceResult: "outside"`.
Any non-approved geofence violation blocks DDS creation, validation, and submission.
Protected mobile calls may send `X-Organization-Id`. If present, it must exactly
match the organization claim in the access token; a mismatch returns HTTP 403
`ORGANIZATION_MISMATCH`. Login and refresh return `organizations: [{id,name}]`
plus `selectedOrganizationId`; organization users receive their one active
organization, while system administrators receive an empty list and `null`.

Satellite and EU API keys are encrypted with AES-256-GCM; their GET representation
contains only `has...` flags. Arbitrary `extra` settings reject secret-like keys.

The EU EUDR V3 adapter defaults to `mock`. Live mode requires HTTPS, denies common
loopback/private targets, disables redirects, enforces a timeout, and XML-escapes
all values. Credentials are AES-256-GCM encrypted at rest. Admin GET responses expose
only `hasUsername`, `hasPassword`, and `hasClientId`, never secret values.

### Durable DDS actions

Migration `003_dds_idempotency_and_plot_geofence.sql` stores every DDS validation
and submission action in `dds_actions`, protected by tenant RLS. An idempotency key
is unique per organization and is permanently bound to one DDS operation and one
action. Repeating the same request returns the stored HTTP result; reusing its key
for another operation or action returns `IDEMPOTENCY_KEY_REUSED`.

Submission is committed as `processing` before the SOAP call begins. A transport
failure, timeout, HTTP 5xx response, unreadable response, or successful response
without a reference is not retried automatically: the action becomes `uncertain`,
the DDS phase becomes `reconciliation_required`, and the API returns
`DDS_RECONCILIATION_REQUIRED`. An administrator must then make one of these audited
decisions:

- `{"decision":"confirm_submitted","externalReference":"...","note":"..."}` confirms
  a reference verified outside SCTracker.
- `{"decision":"reset_not_submitted","note":"..."}` returns the draft to `validated`;
  a later submit must use a new idempotency key.

The Admin SPA exposes only permitted tabs and actions. System and organization
administrators can manage and reconcile; reviewers start on read-only geofences
and can process reviews; auditors start on read-only geofences and can read audit
history. Field agents have no Admin SPA access.

## Validation

```powershell
npm test
npm run typecheck
npm run build
```

Database integration can be smoke-tested after migration with `GET /health`.
