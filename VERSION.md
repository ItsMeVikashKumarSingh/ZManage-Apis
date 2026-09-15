# ZManage-APIs Changelog

## [0.3.2] - 2026-09-15
### Rate Limiting Integration, Rule 8.4 Iconography Compliance & Version Alignment
- **Rate Limiting Security Plugin (`app.ts`, `auth.ts`)**:
  - Registered `@fastify/rate-limit` with global IP limits (120 req/min) and sanitization of error responses to prevent system leakage.
  - Implemented strict route-level rate limiting on `/api/v1/auth/login` (10 req/min) against brute-force attacks.
- **Rule 8.4 Iconography & Emoji Sanitization (`aiController.ts`, `app.ts`)**:
  - Sanitized all heuristic fallback strings in `aiController.ts`, replacing emojis (`📄`, `📅`, `👥`, `💰`, `📦`, `👋`) with structured Markdown headers.
  - Standardized console startup logs in `app.ts` to use clean text tags `[Server]` and `[Documentation]`.
- **Elimination of Hardcoded Fallback IDs (`auth.ts`, `aiController.ts`)**:
  - Removed hardcoded fallback UUID from auth token return in `auth.ts`.
  - Removed hardcoded client ID from booking filters in `aiController.ts` to ensure strict tenant data isolation.
- **Version Harmonization & Auth Prefix (`package.json`, `swagger.ts`, `app.ts`, `auth.ts`)**:
  - Synchronized package version to `0.3.2` across `package.json`, root route, and OpenAPI documentation (`swagger.ts`).
  - Standardized fallback token generation prefix to `zm_auth_${userId}`.

## [0.3.1] - 2026-09-13
### Zorvik AI Multimodal PDF Analysis & Payload Hardening
- **Multimodal Document & PDF Inspection (`aiController.ts`)**:
  - Enhanced system prompt with explicit document-inspection directives when files are attached, ensuring the AI prioritizes analyzing attached documents rather than summarizing studio inventory/shoots.
  - Formatted file payloads with both `base64` and `data` properties for full compatibility with Zorvik-AI microservice.
  - Increased AI request timeout to 25s for document analysis.
  - Added filter to reject upstream provider budget error messages.
  - Added failover across configured Zorvik AI microservice endpoints.
- **Fastify Payload Limit Hardening (`app.ts`)**:
  - Increased `bodyLimit` to 15MB (`15 * 1024 * 1024`) to support high-resolution images and multi-page PDFs.

## [0.3.0] - 2026-09-13
### Zorvik-AI Microservice Integration & Automated Allocation Recommendations
- **Zorvik-AI Integration Route (`/api/v1/ai/recommend-allocation`, `aiController.ts`)**:
  - Connects to the `Zorvik-AI` microservice via `ZORVIK_AI_URL` with multi-tenant header resolution (`x-tenant-id`).
  - Gathers available hardware gear, composite kits, and crew roster for the active tenant.
  - Generates optimal gear packages (cameras, lenses, lighting, audio, drones) and crew shift assignments.
  - Includes a fault-tolerant heuristic fallback ensuring zero downtime when the AI microservice is warming up or unreachable.
  - Implements non-blocking audit logging (`AI_RECOMMENDATION_GENERATED`) in `management.tbl_audit_logs`.
- **Studio Copilot Natural Language Route (`/api/v1/ai/ask-assistant`, `aiController.ts`)**:
  - Aggregates comprehensive, real-time studio telemetry across active shoots, confirmed client bookings, hardware inventory statuses, active crew technician rosters, and pending/settled contractor payouts.
  - Answers open-ended studio questions with live context grounding via `https://ai.zorviktech.com/api/v1/chat`.
  - Non-blocking audit logging (`AI_STUDIO_QUERY_ANSWERED`).
- **Configuration (`env.ts`, `.env`)**:
  - Configured `ZORVIK_AI_URL` environment variable pointing to production service `https://ai.zorviktech.com/api/v1`.

## [0.2.0] - 2026-09-13
### Storage Vaults, Equipment Kits, Consumables & Maintenance Lifecycle
- **Storage Locations / Vaults API (`/api/v1/vaults`, `vaultsController.ts`)**:
  - Full CRUD operations for physical vaults, production vans, and storage hubs.
  - Aggregates assigned asset, kit, and consumable counts per vault.
  - Mandatory audit logging on vault creation, update, and deletion.
- **Consumables API (`/api/v1/consumables`, `consumablesController.ts`)**:
  - CRUD operations for non-serialized stock (tapes, batteries, backdrops, fluids).
  - Dynamic `is_low_stock` detection comparing stock quantity against `min_reorder_level`.
  - Atomic stock adjustments (`/adjust-stock`) with audit logging of action, amount, and reason.
- **Equipment Kits & Bundles API (`/api/v1/kits`, `kitsController.ts`)**:
  - Composite kit template management with itemized child specifications and quantities.
  - Tracking of total kits owned count (`total_kits_count`).
  - Automatic `KIT-XXX` auto-code sequence generation and audit logging.
- **Asset Lifecycle & Location Enhancements (`assetsController.ts`)**:
  - Added support for `location_id` filtering and location name joins.
  - Added support for optional maintenance tracking (`is_maintenance_applicable`, `maintenance_interval_days`, `next_service_due`).
  - Added support for optional straight-line depreciation attributes with real-time calculated book value.

## [0.1.13] - 2026-09-13
### Payouts Summary Metrics Fix (`payoutsController.ts`)
- **Metric Calculations**:
  - Updated `getPayoutsSummary` to compute transaction counts (`pending_count`, `settled_count`).
  - Added `settled_total` alongside `paid_total` alias in response summary.
  - Added support for both `paid` and `settled` payout statuses in summary reduction.

## [0.1.12] - 2026-09-12
### Multi-Note Inspection History & Direct Notes API (`assetsController.ts`)
- **Persistent Notes & Return Inspection History (`specs.notes_history`)**:
  - Implemented structured chronological note preservation inside native `specs.notes_history` JSONB array on `zmanage.assets`.
  - In `updateAsset` and `checkinAsset`, new inspection notes are prepended without overwriting historical notes.
  - Automatically captures note text, condition at inspection, action type (`return_inspection`, `maintenance`), and ISO timestamp.
- **Direct Asset Notes Endpoint (`routes/assets.ts`)**:
  - Added `POST /api/v1/assets/:id/notes` allowing operators to log maintenance notes and inspection findings directly.
  - Fires `ASSET_NOTE_ADDED` audit event into `management.tbl_audit_logs`.
- **Extended Asset History API**:
  - `GET /api/v1/assets/:id/history` now returns `notes_history: AssetNoteRecord[]` alongside shoot allocations.

## [0.1.11] - 2026-09-12
### Centralized Audit Logging System & Activity Logs API
- **Centralized Audit Logger (`src/utils/auditLogger.ts`)**:
  - Implemented `recordAuditLog` and `logAuditEvent` writing immutable event records to `management.tbl_audit_logs` per Rule 3.1.
  - Automatically captures IP addresses (handling proxy headers), user-agent strings, timestamps, client context, and JSON metadata.
  - Fully asynchronous and non-blocking: errors during logging are safely isolated so business workflows are never interrupted.
- **Audit Logs Query API (`src/controllers/auditLogsController.ts`, `src/routes/auditLogs.ts`)**:
  - Implemented `GET /api/v1/audit-logs` supporting category filtering (`ASSET`, `WORKER`, `ALLOCATION`, `PAYOUT`, `BOOKING`), action filtering, text search, pagination, and real-time aggregate metrics.
- **Comprehensive Controller Instrumentation**:
  - Instrumented `assetsController.ts`: logs `ASSET_CREATED`, `ASSET_UPDATED`, `ASSET_CHECKOUT`, `ASSET_CHECKIN` (with return condition & return inspection notes), and `ASSET_DELETED`.
  - Instrumented `workersController.ts`: logs `WORKER_ONBOARDED`, `WORKER_UPDATED`, and `WORKER_REMOVED`.
  - Instrumented `allocationsController.ts`: logs `SHOOT_ALLOCATED`, `SHOOT_CANCELLED`, and `OFFLINE_BOOKING_CREATED`.
  - Instrumented `payoutsController.ts`: logs `PAYOUT_LOGGED` and `PAYOUT_SETTLED`.

## [0.1.10] - 2026-09-12
### CORS Preflight Method Allowance & Robust Asset Update Payload Sanitization
- **CORS Preflight Configuration (`app.ts`)**:
  - Explicitly configured `@fastify/cors` with `methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']` and `allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Publishable-Key', 'x-tenant-id', 'x-publishable-key', 'Accept']`.
  - Resolved browser preflight failure (`CORS error: Method PATCH is not allowed by Access-Control-Allow-Methods`) which was blocking asset updates from the web console.
- **Route & Controller Hardening (`routes/assets.ts`, `controllers/assetsController.ts`)**:
  - Added dual support for `PATCH /api/v1/assets/:id` and `PUT /api/v1/assets/:id`.
  - Implemented strict payload sanitization in `updateAsset`: safely extracts allowed columns, trims string inputs, converts empty strings to `null` to respect database constraints, and prevents mutation of immutable columns (`id`, `project_id`, `client_id`).

## [0.1.9] - 2026-09-12
### Manual Offline Order Creation & Walk-in Client Bookings
- **Offline Booking Creation Endpoint (`controllers/allocationsController.ts`, `routes/allocations.ts`)**:
  - Implemented `POST /api/v1/allocations/offline-booking` allowing managers to record walk-in, phone, or custom offline client orders.
  - Inserts into `studio.tbl_bookings` with `tb_reference_type: 'OFFLINE_BOOKING'`, structured customer JSON (`source: 'offline'`), package details, venue, event date/time, and agreed payment terms.
  - Enhanced candidate mapper in `getBookingCandidates` to return `is_offline: boolean` so the frontend can immediately tag walk-in bookings with distinctive badges.

## [0.1.8] - 2026-09-12
### 1-Tap Studio Client Booking Synchronization & Discovery
- **Studio Bookings Discovery Endpoint (`controllers/allocationsController.ts`, `routes/allocations.ts`)**:
  - Implemented `GET /api/v1/allocations/sync-candidates` endpoint discovering confirmed client bookings from `studio.tbl_bookings` for the client.
  - Normalizes package titles, client names, phone numbers, event dates, and call times.
  - Cross-references existing active allocations in `zmanage.allocations` to flag already-imported bookings, preventing accidental duplicate allocations.
- **Batch Synchronization Endpoint (`controllers/allocationsController.ts`, `routes/allocations.ts`)**:
  - Implemented `POST /api/v1/allocations/batch-sync` endpoint enabling bulk import of selected studio bookings into `zmanage.allocations`.
  - Automatically embeds studio booking and order references (`[Synced from Studio Booking Ref: ...]`) into allocation notes for audit traceability and idempotency.

## [0.1.7] - 2026-09-12
### Strict RMS Access Verification & Security Middleware Enforcement
- **Project Access Verification (`routes/auth.ts`)**:
  - Implemented `GET /api/v1/auth/verify-access` endpoint: dynamically resolves project by ID/header and verifies `tcp_rms_enabled` status, returning `hasAccess: boolean` and list of other available RMS projects.
  - Fixed database column lookup: corrected `tcp_project_name` to `tcp_name` across all project queries.
  - Enhanced `GET /api/v1/auth/projects` with fallback support for `X-Tenant-ID` header.
- **Tenant Middleware RMS Enforcement (`middleware/clientAuth.ts`)**:
  - Enforced `tcp_rms_enabled !== false` validation across all authentication channels (secret key, session JWT, publishable key, and tenant header).
  - Explicitly rejects requests for disabled RMS projects with `403 Forbidden` (`RMS_DISABLED`).
- **PostgREST Schema Alignment**:
  - Realigned PostgreSQL `authenticator` configuration to `pgrst.db_schemas` including `zmanage`, granting required schema privileges to resolve schema cache introspection.

## [0.1.6] - 2026-09-12
### Real-Time Project Analytics, Multi-Tenant Workspace Switching & Asset/Worker Lifecycle
- **Real-Time Project Analytics (`routes/analytics.ts`, `controllers/analyticsController.ts`)**:
  - Implemented `GET /api/v1/analytics/overview` endpoint calling `fn_get_project_analytics` RPC (with manual SQL fallback) returning total asset inventory, fleet utilization %, active workers, allocations, and financial payouts breakdown.
- **Client Workspace Project Resolution (`routes/auth.ts`)**:
  - Implemented `GET /api/v1/auth/projects` endpoint returning all RMS-enabled projects for the authenticated tenant.
  - Enhanced `POST /api/v1/auth/login` response payload to include all owned client projects.
- **Equipment & Products Vault Lifecycle (`controllers/assetsController.ts`, `routes/assets.ts`)**:
  - Added `DELETE /api/v1/assets/:id` for soft-deletion and archivals.
- **Team Roster Lifecycle (`controllers/workersController.ts`, `routes/workers.ts`)**:
  - Added `DELETE /api/v1/workers/:id` for soft-deletion.
- **Financial & Compensation Ledger (`controllers/payoutsController.ts`, `routes/payouts.ts`)**:
  - Added `POST /api/v1/payouts` endpoint allowing ad-hoc expense/payout record creation.

## [0.1.5] - 2026-09-12
### Database Schema Realignment to zmanage
- **Database Schema Migration (`controllers/`)**:
  - Realigned all database queries and mutations in `assetsController`, `workersController`, `allocationsController`, and `payoutsController` from schema `zresource` to dedicated schema `zmanage`.
  - Re-routed RPC calls (`fn_check_asset_availability`, `fn_check_worker_availability`, `fn_generate_next_asset_code`) to the `zmanage` execution paths with public wrappers.

## [0.1.4] - 2026-09-12
### Microservice Project & Folder Realignment
- **Service & Folder Realignment**:
  - Renamed workspace directory from `ZResource-APIs` to `ZManage-APIs`.
  - Synchronized package manifest name to `zmanage-apis`.
  - Standardized startup logs, Swagger definitions, health response service identifiers, and environment diagnostics to `ZManage-APIs`.

## [0.1.3] - 2026-09-11
### Enterprise Auto-ID Sequence Generation & RLS Hardening
- **Auto-Code Sequence Generator (`assetsController.ts`)**:
  - Integrated `fn_generate_next_asset_code` RPC: if asset code is not manually provided during registration, automatically generates clean category-based sequential identifiers (`CAM-001`, `LNS-001`, `DRN-001`, `LGT-001`).
- **RLS & Privilege Resolution**:
  - Supported universal backend access policies across `zresource` schema tables, eliminating `new row violates row-level security policy` errors.

## [0.1.2] - 2026-09-11
### Multi-Layer Per-Request Security Validation & ZManage Rebranding
- **Zero-Trust Per-Request Validation Middleware (`src/middleware/clientAuth.ts`)**:
  - Implemented cryptographic Supabase JWT verification on every incoming request (`Authorization: Bearer <token>`) via `supabase.auth.getUser`.
  - Cross-validates tenant identity against `management.tbl_clients` and `management.tbl_client_projects`.
  - Enforces active status checks: rejects disabled or deleted client accounts immediately with `401 Unauthorized`.
  - Maintains full support for `sk_live_...` (custom server integrations) and `pk_live_...` (native mobile / web).
- **Service Rebranding**:
  - Renamed service and welcome endpoint to **ZManage-APIs**.

## [0.1.1] - 2026-09-11
### Client Auth & PostgREST Schema Optimization
- **Standardized Client Login**:
  - Added `POST /api/v1/auth/login` allowing clients to log in using only their standard **Email** and **Password** without needing to supply a manual Tenant ID.
  - Automatically resolves client ownership and primary project from `management.tbl_clients` and `management.tbl_client_projects`.
- **R2 Storage Cleanup**:
  - Removed obsolete `R2_PUBLIC_URL` from `.env` and `src/config/env.ts`.
- **Schema Access**:
  - Integrated `studio.tbl_profiles` fallback for 1-tap candidate discovery.

## [0.1.0] - 2026-09-11
### Initial Architecture & Core Service Scaffolding
- **Core Microservice Engine**:
  - Initialized standalone TypeScript Fastify microservice running serverless on Vercel and Cloudflare Workers.
  - Multi-tenant client authentication supporting `X-Tenant-ID`, `X-Publishable-Key` (`pk_live_...`), and `Authorization: Bearer <sk_live_...>`.
  - Swagger/OpenAPI documentation hosted at `/documentation`.
- **ZResource Operations Controllers**:
  - `assets`: Hardware & equipment inventory (cameras, lenses, drones, serial numbers, condition status, check-out/check-in).
  - `workers`: Team & freelancer roster (photographers, cinematographers, drone pilots, day rates, overtime rates, UPI/bank payout details).
  - `import`: 1-Tap Team Onboarding Engine discovering users from `auth_service.tbl_client_users` with selective checkbox overrides.
  - `allocations`: Shoots and project scheduling integrated with PostgreSQL RPC collision prevention.
  - `payouts`: Worker compensation ledger tracking gig payments, overtime, and settlement UTR numbers.
