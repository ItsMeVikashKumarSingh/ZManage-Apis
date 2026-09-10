# ZResource-APIs Changelog

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
