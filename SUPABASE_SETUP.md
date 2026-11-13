# LASUPADORA 360 — Practical Supabase & Deployment Setup Guide

This guide explains in plain, practical steps how to connect LASUPADORA 360 to your own Supabase cloud account for permanent production hosting.

## Step 1: Create Your Free or Pro Supabase Project
1. Visit **supabase.com** and sign in.
2. Click **New Project**, choose your organisation, name it `lasupadora-360`, select a nearby region (e.g. **London / eu-west-2** or **Frankfurt / eu-central-1**), and set a strong database password (save it securely).

## Step 2: Run the Version-Controlled Database Migrations
Open **SQL Editor** inside your Supabase Dashboard and run the three files in `/supabase/migrations/` in exact numerical order:
1. `202611120001_initial_schema.sql` — Creates all tables, `GHS` numeric columns, unique membership numbers, and foreign keys.
2. `202611120002_rls_and_security.sql` — Activates Row Level Security (RLS), branch/subdivision data boundaries, and the zero-PII QR verification function.
3. `202611120003_seed_foundation.sql` — Loads **Tema Branch** (Communities 1–25), **Outside Tema Branch**, the 13 RBAC roles, and configurable constitutional policies.

*(Alternatively, with the Supabase CLI installed, run `supabase link --project-ref YOUR_REF` followed by `supabase db push`.)*

## Step 3: Create Two Storage Buckets in Supabase
Go to **Storage → New Bucket**:
1. **`public-media`** → Check **Public bucket = ON** (used for approved event posters, news photos, and public gallery albums).
2. **`private-documents`** → Keep **Public bucket = OFF** (used for member ID photos, supporting application documents, and financial expense receipts).

## Step 4: Add Your Keys to Environment Variables (Secrets)
In **Supabase Dashboard → Project Settings → API**, copy:
- **Project URL** → set as `VITE_SUPABASE_URL` and `SUPABASE_URL`
- **anon / public key** → set as `VITE_SUPABASE_ANON_KEY`
- **service_role key** (keep secret!) → set as `SUPABASE_SERVICE_ROLE_KEY`

## Step 5: Deploy Sensitive Edge Functions
Using the Supabase CLI:
```bash
supabase functions deploy approve-application
supabase functions deploy verify-qr-card
supabase functions deploy record-financial-transaction
```

## Step 6: Install as an Android App (PWA)
Open the live LASUPADORA 360 website in **Chrome on Android**, tap **Install App** in the navigation menu (or Chrome's **Add to Home screen**), and the platform installs with the official LASUPADORA icon and offline shell caching.
