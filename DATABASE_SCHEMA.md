# LASUPADORA 360 — Database Architecture & Schema Documentation

## 1. Logo & Visual Identity Foundation
- **Official Asset**: `/public/assets/aistudio/IMG_202604101_090333122_c0dbe07b.png` (`960 x 1280` RGBA PNG with transparency).
- **Extracted Principal HEX Colours**:
  - Deep Midnight Navy Ink: `#10242F`
  - Harlequin Royal Navy: `#053559` / `#084B6F`
  - Heritage Vermilion Red: `#AD220B`
  - Vibrant Masquerade Orange: `#BD5016`
  - Warm Marigold Ochre: `#E48947`
  - Crown Feather Forest Green: `#146B3A`
  - Pure Crisp Surface White: `#FFFFFF`

## 2. System Architecture Overview
1. **Frontend (React + TypeScript + Vite + PWA)**:
   - Installable Android & Desktop Progressive Web App (`vite-plugin-pwa`).
   - Strict separation between Public Website, Public QR Verification, Member Portal, and Role-Scoped Admin Console.
2. **Backend API & Security Layer**:
   - **Production Target**: Supabase PostgreSQL, Supabase Auth, Supabase Storage (`public-media` & `private-documents`), Supabase Row Level Security (RLS), and Supabase Edge Functions (`/supabase/functions/*`).
   - **Live Integrated Server (`server.ts`)**: Express backend enforcing `HttpOnly` signed session cookies, `scrypt` password hashing, server-side RBAC checks, branch/subdivision scoping, financial control gates, and an embedded relational SQLite database (`data/lasupadora.db` with `PRAGMA foreign_keys = ON`) mirroring the exact PostgreSQL schema when Supabase environment keys are not yet attached.
3. **Future Native Android App Readiness**:
   - All business logic, validation, financial controls, and QR verification reside in server endpoints and Supabase Edge Functions/RPCs so a future Kotlin/React Native Android app connects directly to the exact same API and database without rebuilding backend rules.

## 3. Core Tables & Relationships
- `branches (1) ──< (N) subdivisions`: **Tema Branch** (`C1`–`C25`) and **Outside Tema Branch** (towns/regions).
- `branches & subdivisions (1) ──< (N) members`: Every member belongs to one branch and one subdivision, with `UNIQUE(membership_number)` and `UNIQUE(qr_token)`.
- `membership_categories (1) ──< (N) members`: Configurable `Junior`, `Senior`, and `Officers` categories.
- `membership_applications (1) ──< (N) application_decision_history`: Tracks both `public_web` and `officer_assisted` submissions, status transitions, and atomic approval linking `approved_member_id`.
- `members (1) ──< (N) member_transfers`: Auditable branch/subdivision transfer history.
- `roles (M) ──< member_roles >── (N) members` & `roles (1) ──< (N) role_permissions`: 13-role RBAC matrix scoped to `national`, `branch`, `subdivision`, `self`, or `public`.
- `leadership_appointments`: Links `members` to executive portfolios with term start/expiry (default 2 years, max 2 consecutive terms, 14-day handover, oath tracking).
- `events (1) ──< (N) event_registrations` & `events (1) ──< (0..1) budgets`: Event planning, committee assignments, and check-in attendance.
- `budgets (1) ──< (N) expenditures` & `financial_payments`: All monetary columns use `NUMERIC(12,2)` in `GHS`. Enforces **No budget = No approval** and **No accounts = No next funding** (7-day receipt rule, 4-week pre-event budget rule).
- `publications`, `media_items`, `governance_meetings`, `governance_proposals`, `governance_votes`, `governance_action_points`, `member_feedback_and_inquiries`, `notifications`, and `audit_logs`.

## 4. Migration Management
All database structural changes live in `/supabase/migrations/` with timestamped version prefixes (`202611120001_...`, `202611120002_...`, `202611120003_...`). Every migration uses `IF NOT EXISTS` and `ON CONFLICT DO NOTHING` where repeatable, and never drops or overwrites production data silently.
