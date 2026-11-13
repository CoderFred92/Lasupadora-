-- ============================================================================
-- LASUPADORA 360 — Migration 0001: Initial Relational Schema (PostgreSQL)
-- Clean rebuild avoiding legacy duplicate fields and enforcing full integrity.
-- Default currency: Ghana Cedi (GHS) using NUMERIC(12,2).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. ORGANISATIONAL HIERARCHY (LASUPADORA -> Branch -> Subdivision -> Member)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(16) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL UNIQUE,
  branch_type VARCHAR(32) NOT NULL CHECK (branch_type IN ('tema', 'outside_tema', 'diaspora', 'other')),
  region VARCHAR(100) NOT NULL DEFAULT 'Greater Accra',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subdivisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  code VARCHAR(24) NOT NULL,
  name VARCHAR(120) NOT NULL,
  subdivision_type VARCHAR(32) NOT NULL CHECK (subdivision_type IN ('community', 'town', 'zone')),
  town_or_community VARCHAR(120) NOT NULL,
  region VARCHAR(100) NOT NULL DEFAULT 'Greater Accra',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (branch_id, code),
  UNIQUE (branch_id, name)
);

CREATE INDEX IF NOT EXISTS idx_subdivisions_branch ON public.subdivisions(branch_id);

-- ----------------------------------------------------------------------------
-- 2. ROLE-BASED ACCESS CONTROL (RBAC) & CONFIGURABLE POLICIES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL UNIQUE,
  scope_level VARCHAR(24) NOT NULL CHECK (scope_level IN ('national', 'branch', 'subdivision', 'self', 'public')),
  is_constitutional_office BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  module VARCHAR(64) NOT NULL,
  can_view BOOLEAN NOT NULL DEFAULT FALSE,
  can_create BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  can_export BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_id, module)
);

CREATE TABLE IF NOT EXISTS public.governance_policies (
  key VARCHAR(80) PRIMARY KEY,
  category VARCHAR(48) NOT NULL,
  label VARCHAR(160) NOT NULL,
  value_json JSONB NOT NULL,
  requires_constitutional_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed_by_resolution_id UUID,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 3. MEMBERSHIP APPLICATIONS & APPROVED MEMBERS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL UNIQUE,
  min_age INT CHECK (min_age IS NULL OR min_age >= 0),
  max_age INT CHECK (max_age IS NULL OR max_age >= 0),
  annual_dues_ghs NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (annual_dues_ghs >= 0),
  monthly_dues_ghs NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (monthly_dues_ghs >= 0),
  eligibility_notes TEXT,
  requires_policy_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS public.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  membership_number VARCHAR(32) NOT NULL UNIQUE,
  qr_token VARCHAR(64) NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 48),
  full_name VARCHAR(160) NOT NULL,
  date_of_birth DATE,
  gender VARCHAR(24),
  telephone VARCHAR(32) NOT NULL,
  email VARCHAR(160) UNIQUE,
  residential_address TEXT,
  photo_storage_path TEXT,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  subdivision_id UUID NOT NULL REFERENCES public.subdivisions(id) ON DELETE RESTRICT,
  category_id UUID NOT NULL REFERENCES public.membership_categories(id) ON DELETE RESTRICT,
  membership_status VARCHAR(24) NOT NULL DEFAULT 'Active'
    CHECK (membership_status IN ('Pending', 'Active', 'Inactive', 'Suspended', 'Transferred', 'Deceased', 'Resigned')),
  previous_experience TEXT,
  emergency_contact_name VARCHAR(120),
  emergency_contact_phone VARCHAR(32),
  registration_date DATE NOT NULL DEFAULT CURRENT_DATE,
  approved_by UUID REFERENCES public.members(id),
  approved_at TIMESTAMPTZ,
  card_valid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_members_branch_subdivision ON public.members(branch_id, subdivision_id);
CREATE INDEX IF NOT EXISTS idx_members_status ON public.members(membership_status);
CREATE INDEX IF NOT EXISTS idx_members_qr_token ON public.members(qr_token);

CREATE TABLE IF NOT EXISTS public.auth_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id UUID UNIQUE REFERENCES public.members(id) ON DELETE SET NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  full_name VARCHAR(160) NOT NULL DEFAULT '',
  avatar_url TEXT,
  primary_role_slug VARCHAR(64) NOT NULL DEFAULT 'member' REFERENCES public.roles(slug) ON DELETE RESTRICT,
  default_branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_sign_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_profiles_member ON public.auth_profiles(member_id);

CREATE TABLE IF NOT EXISTS public.member_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  subdivision_id UUID REFERENCES public.subdivisions(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_by UUID REFERENCES public.members(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, role_id, branch_id, subdivision_id)
);

CREATE TABLE IF NOT EXISTS public.membership_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_ref VARCHAR(32) NOT NULL UNIQUE,
  source VARCHAR(32) NOT NULL CHECK (source IN ('public_web', 'officer_assisted')),
  created_by_officer_id UUID REFERENCES public.members(id),
  full_name VARCHAR(160) NOT NULL,
  date_of_birth DATE,
  gender VARCHAR(24),
  telephone VARCHAR(32) NOT NULL,
  email VARCHAR(160),
  residential_address TEXT,
  photo_storage_path TEXT,
  preferred_branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE RESTRICT,
  preferred_subdivision_id UUID NOT NULL REFERENCES public.subdivisions(id) ON DELETE RESTRICT,
  requested_category_id UUID NOT NULL REFERENCES public.membership_categories(id) ON DELETE RESTRICT,
  previous_experience TEXT,
  emergency_contact_name VARCHAR(120),
  emergency_contact_phone VARCHAR(32),
  supporting_doc_path TEXT,
  declaration_accepted BOOLEAN NOT NULL DEFAULT FALSE CHECK (declaration_accepted = TRUE),
  privacy_consent_accepted BOOLEAN NOT NULL DEFAULT FALSE CHECK (privacy_consent_accepted = TRUE),
  status VARCHAR(32) NOT NULL DEFAULT 'Pending Review'
    CHECK (status IN ('Pending Review', 'Corrections Requested', 'Approved', 'Rejected')),
  reviewing_officer_id UUID REFERENCES public.members(id),
  reviewed_at TIMESTAMPTZ,
  review_comments TEXT,
  approved_member_id UUID UNIQUE REFERENCES public.members(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON public.membership_applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_branch ON public.membership_applications(preferred_branch_id);

CREATE TABLE IF NOT EXISTS public.application_decision_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.membership_applications(id) ON DELETE CASCADE,
  previous_status VARCHAR(32),
  new_status VARCHAR(32) NOT NULL,
  actor_member_id UUID REFERENCES public.members(id),
  notes TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.member_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  from_branch_id UUID NOT NULL REFERENCES public.branches(id),
  from_subdivision_id UUID NOT NULL REFERENCES public.subdivisions(id),
  to_branch_id UUID NOT NULL REFERENCES public.branches(id),
  to_subdivision_id UUID NOT NULL REFERENCES public.subdivisions(id),
  reason TEXT NOT NULL,
  approved_by UUID NOT NULL REFERENCES public.members(id),
  transferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.profile_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  requested_changes JSONB NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  reviewed_by UUID REFERENCES public.members(id),
  review_notes TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

-- ----------------------------------------------------------------------------
-- 4. EXECUTIVE & LEADERSHIP MANAGEMENT
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leadership_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  portfolio VARCHAR(80) NOT NULL,
  scope_type VARCHAR(24) NOT NULL CHECK (scope_type IN ('national', 'branch', 'subdivision')),
  branch_id UUID REFERENCES public.branches(id) ON DELETE RESTRICT,
  subdivision_id UUID REFERENCES public.subdivisions(id) ON DELETE RESTRICT,
  term_number INT NOT NULL DEFAULT 1 CHECK (term_number BETWEEN 1 AND 2),
  term_start DATE NOT NULL,
  term_expiry DATE NOT NULL,
  handover_deadline DATE,
  oath_signed BOOLEAN NOT NULL DEFAULT FALSE,
  oath_signed_at TIMESTAMPTZ,
  portrait_storage_path TEXT,
  biography TEXT,
  is_public_approved BOOLEAN NOT NULL DEFAULT FALSE,
  can_act_for_president BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(24) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'Stepped Down', 'Acting')),
  appointed_by UUID REFERENCES public.members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (term_expiry > term_start)
);

-- ----------------------------------------------------------------------------
-- 5. EVENTS, REGISTRATIONS & ATTENDANCE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(180) NOT NULL,
  slug VARCHAR(180) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  venue VARCHAR(180) NOT NULL,
  branch_id UUID REFERENCES public.branches(id),
  poster_path TEXT,
  registration_open BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(24) NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Draft', 'Upcoming', 'Completed', 'Archived', 'Cancelled')),
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  organising_committee JSONB NOT NULL DEFAULT '[]'::JSONB,
  post_event_report TEXT,
  receipt_submission_deadline DATE,
  receipts_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES public.members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.event_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  attendance_status VARCHAR(24) NOT NULL DEFAULT 'Registered' CHECK (attendance_status IN ('Registered', 'Present', 'Absent', 'Excused')),
  checked_in_by UUID REFERENCES public.members(id),
  checked_in_at TIMESTAMPTZ,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, member_id)
);

-- ----------------------------------------------------------------------------
-- 6. FINANCE, DUES, BUDGETS & EXPENDITURES (GHS)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dues_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(120) NOT NULL,
  category_id UUID NOT NULL REFERENCES public.membership_categories(id),
  period_label VARCHAR(48) NOT NULL,
  amount_ghs NUMERIC(12,2) NOT NULL CHECK (amount_ghs >= 0),
  due_date DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES public.members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fundraising_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(160) NOT NULL,
  description TEXT,
  target_amount_ghs NUMERIC(12,2) NOT NULL CHECK (target_amount_ghs > 0),
  start_date DATE NOT NULL,
  end_date DATE,
  branch_id UUID REFERENCES public.branches(id),
  status VARCHAR(24) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'Closed')),
  created_by UUID REFERENCES public.members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(160) NOT NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id),
  fiscal_year INT NOT NULL DEFAULT EXTRACT(YEAR FROM NOW())::INT,
  requested_amount_ghs NUMERIC(12,2) NOT NULL CHECK (requested_amount_ghs > 0),
  approved_amount_ghs NUMERIC(12,2) CHECK (approved_amount_ghs IS NULL OR approved_amount_ghs >= 0),
  line_items JSONB NOT NULL DEFAULT '[]'::JSONB,
  submitted_by UUID NOT NULL REFERENCES public.members(id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  four_week_rule_compliant BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(24) NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Draft', 'Submitted', 'Approved', 'Rejected', 'Closed')),
  approved_by UUID REFERENCES public.members(id),
  approved_at TIMESTAMPTZ,
  review_notes TEXT
);

CREATE TABLE IF NOT EXISTS public.financial_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number VARCHAR(40) NOT NULL UNIQUE,
  member_id UUID REFERENCES public.members(id) ON DELETE RESTRICT,
  dues_schedule_id UUID REFERENCES public.dues_schedules(id),
  campaign_id UUID REFERENCES public.fundraising_campaigns(id),
  branch_id UUID REFERENCES public.branches(id),
  payment_category VARCHAR(40) NOT NULL CHECK (payment_category IN ('Dues', 'Donation', 'Fundraising', 'Registration Fee', 'Other')),
  amount_ghs NUMERIC(12,2) NOT NULL CHECK (amount_ghs > 0),
  currency CHAR(3) NOT NULL DEFAULT 'GHS',
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method VARCHAR(32) NOT NULL CHECK (payment_method IN ('Cash', 'Bank Transfer', 'Mobile Money', 'Cheque', 'Verified Gateway')),
  reference_number VARCHAR(100) NOT NULL,
  verification_status VARCHAR(24) NOT NULL DEFAULT 'Pending Verification'
    CHECK (verification_status IN ('Pending Verification', 'Verified', 'Rejected')),
  recording_officer_id UUID REFERENCES public.members(id),
  verified_by_id UUID REFERENCES public.members(id),
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_member ON public.financial_payments(member_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.financial_payments(verification_status);

CREATE TABLE IF NOT EXISTS public.expenditures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES public.budgets(id) ON DELETE RESTRICT,
  branch_id UUID REFERENCES public.branches(id),
  description VARCHAR(240) NOT NULL,
  amount_ghs NUMERIC(12,2) NOT NULL CHECK (amount_ghs > 0),
  currency CHAR(3) NOT NULL DEFAULT 'GHS',
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payee VARCHAR(160) NOT NULL,
  receipt_storage_path TEXT,
  receipt_submitted BOOLEAN NOT NULL DEFAULT FALSE,
  receipt_due_date DATE NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'Pending Approval'
    CHECK (status IN ('Pending Approval', 'Approved', 'Disbursed', 'Accounted', 'Rejected')),
  requested_by UUID NOT NULL REFERENCES public.members(id),
  approved_by UUID REFERENCES public.members(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 7. NEWS, ANNOUNCEMENTS, MEDIA GALLERY, GOVERNANCE & AUDIT LOGS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(200) NOT NULL,
  slug VARCHAR(200) NOT NULL UNIQUE,
  category VARCHAR(48) NOT NULL CHECK (category IN ('Announcement', 'News', 'Featured Story', 'Archive', 'Cultural Note')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  excerpt TEXT NOT NULL,
  body TEXT NOT NULL,
  cover_image_path TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(24) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Scheduled', 'Published', 'Archived')),
  scheduled_for TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  author_id UUID REFERENCES public.members(id),
  approved_by UUID REFERENCES public.members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.media_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(160) NOT NULL,
  caption TEXT,
  album_name VARCHAR(120) NOT NULL DEFAULT 'General Archive',
  media_type VARCHAR(24) NOT NULL CHECK (media_type IN ('photo', 'video', 'poster', 'document')),
  bucket_visibility VARCHAR(16) NOT NULL CHECK (bucket_visibility IN ('public', 'private')),
  storage_path TEXT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  event_id UUID REFERENCES public.events(id),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by UUID REFERENCES public.members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.governance_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(180) NOT NULL,
  meeting_type VARCHAR(48) NOT NULL CHECK (meeting_type IN ('Executive Council', 'General Assembly', 'Branch Meeting', 'Committee')),
  branch_id UUID REFERENCES public.branches(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  venue VARCHAR(180) NOT NULL,
  agenda TEXT NOT NULL,
  minutes_text TEXT,
  quorum_required INT NOT NULL DEFAULT 5,
  attendees_count INT NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Held', 'Adjourned', 'Archived')),
  created_by UUID REFERENCES public.members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.governance_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code VARCHAR(32) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  proposal_type VARCHAR(32) NOT NULL CHECK (proposal_type IN ('Motion', 'Policy Amendment', 'Resolution', 'Budget Ratification', 'Appointment')),
  description TEXT NOT NULL,
  meeting_id UUID REFERENCES public.governance_meetings(id),
  submitted_by UUID NOT NULL REFERENCES public.members(id),
  status VARCHAR(24) NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Under Review', 'Voting Open', 'Approved', 'Rejected')),
  votes_for INT NOT NULL DEFAULT 0,
  votes_against INT NOT NULL DEFAULT 0,
  votes_abstain INT NOT NULL DEFAULT 0,
  reviewed_by UUID REFERENCES public.members(id),
  decided_by UUID REFERENCES public.members(id),
  decision_notes TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.governance_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES public.governance_proposals(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  vote_choice VARCHAR(16) NOT NULL CHECK (vote_choice IN ('for', 'against', 'abstain')),
  cast_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (proposal_id, member_id)
);

CREATE TABLE IF NOT EXISTS public.governance_action_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID REFERENCES public.governance_proposals(id) ON DELETE SET NULL,
  meeting_id UUID REFERENCES public.governance_meetings(id) ON DELETE SET NULL,
  title VARCHAR(180) NOT NULL,
  assigned_to UUID NOT NULL REFERENCES public.members(id),
  due_date DATE NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Completed', 'Overdue')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.member_feedback_and_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  sender_name VARCHAR(120) NOT NULL,
  sender_email VARCHAR(160),
  submission_type VARCHAR(32) NOT NULL CHECK (submission_type IN ('Inquiry', 'Suggestion', 'Constructive Criticism', 'Public Contact')),
  subject VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'Received' CHECK (status IN ('Received', 'In Review', 'Responded', 'Archived')),
  response_text TEXT,
  responded_by UUID REFERENCES public.members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_member_id UUID REFERENCES public.members(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  target_table VARCHAR(64) NOT NULL,
  target_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_governance_policies_resolution') THEN
    ALTER TABLE public.governance_policies
      ADD CONSTRAINT fk_governance_policies_resolution
      FOREIGN KEY (confirmed_by_resolution_id) REFERENCES public.governance_proposals(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_governance_policies_updated_by') THEN
    ALTER TABLE public.governance_policies
      ADD CONSTRAINT fk_governance_policies_updated_by
      FOREIGN KEY (updated_by) REFERENCES public.members(id) ON DELETE SET NULL;
  END IF;
END $$;
