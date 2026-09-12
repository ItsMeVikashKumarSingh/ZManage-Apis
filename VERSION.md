# ZManage-APIs Changelog

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
