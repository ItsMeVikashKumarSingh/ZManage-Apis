# ZResource-APIs

Multi-Tenant Internal Resource, Asset Inventory, Team Scheduling & Worker Payouts Microservice for Zorvik Tech.

## Core Features
- **Hardware & Gear Inventory**:
  - Full tracking for camera bodies, lenses, drones, lighting kits, and audio gear.
  - Serial number tracking, physical condition grading (`excellent`, `good`, `fair`, `damaged`, `in_repair`).
  - Check-out and check-in return condition audits.
- **Internal Team & Crew Scheduling**:
  - Staff and freelance photographers, cinematographers, drone pilots, and editors.
  - Day rates, half-day rates, and hourly overtime rates.
  - 1-Tap Team Onboarding importing users from `auth_service.tbl_client_users` with selective controls.
- **Zero-Collision Booking Engine**:
  - PostgreSQL RPC functions preventing physical assets or human crew from being double-booked on overlapping shoot windows.
- **Worker Payouts & Compensation Ledger**:
  - Auto-calculates gig pay, overtime, and bonuses.
  - Tracks settlement status (`pending`, `approved`, `paid`) with bank UTR and UPI references.
- **Multi-Tenant & Multi-Channel Authentication**:
  - `X-Tenant-ID`: Managed portal requests with domain origin verification.
  - `X-Publishable-Key`: Client-side mobile applications with bundle ID verification.
  - `Authorization: Bearer <sk_live_...>`: Server-to-server headless ERP integrations.

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
```bash
cp .env.example .env
```

### 3. Run Development Server
```bash
npm run dev
```

Interactive Swagger documentation runs at `http://localhost:4003/documentation`.
