-- ============================================================================
-- LASUPADORA 360 — Migration 0003: Repeatable Foundation Seed Data
-- ============================================================================

-- 1. Founding Branches
INSERT INTO public.branches (code, name, branch_type, region, description)
VALUES
  ('TM', 'Tema Branch', 'tema', 'Greater Accra', 'Founding branch serving Tema Communities 1 through 25.'),
  ('OT', 'Outside Tema Branch', 'outside_tema', 'National & Regional', 'Founding branch serving members in towns and regions outside Tema.')
ON CONFLICT (code) DO NOTHING;

-- 2. Tema Communities 1-25 Subdivisions + Outside Tema Founding Towns
DO $$
DECLARE
  v_tema_id UUID;
  v_outside_id UUID;
  i INT;
BEGIN
  SELECT id INTO v_tema_id FROM public.branches WHERE code = 'TM';
  SELECT id INTO v_outside_id FROM public.branches WHERE code = 'OT';

  FOR i IN 1..25 LOOP
    INSERT INTO public.subdivisions (branch_id, code, name, subdivision_type, town_or_community, region)
    VALUES (v_tema_id, 'C' || i, 'Community ' || i, 'community', 'Community ' || i, 'Greater Accra')
    ON CONFLICT (branch_id, code) DO NOTHING;
  END LOOP;

  INSERT INTO public.subdivisions (branch_id, code, name, subdivision_type, town_or_community, region)
  VALUES
    (v_outside_id, 'ASH-01', 'Ashaiman', 'town', 'Ashaiman', 'Greater Accra'),
    (v_outside_id, 'ACC-01', 'Accra Metro (Osu / Jamestown)', 'town', 'Accra', 'Greater Accra'),
    (v_outside_id, 'KUM-01', 'Kumasi Central', 'town', 'Kumasi', 'Ashanti'),
    (v_outside_id, 'TAK-01', 'Sekondi-Takoradi', 'town', 'Takoradi', 'Western'),
    (v_outside_id, 'CAP-01', 'Cape Coast', 'town', 'Cape Coast', 'Central')
  ON CONFLICT (branch_id, code) DO NOTHING;
END $$;

-- 3. Membership Categories (Ages & Dues flagged for Constitutional Policy Confirmation)
INSERT INTO public.membership_categories (code, name, min_age, max_age, annual_dues_ghs, monthly_dues_ghs, eligibility_notes, requires_policy_confirmation)
VALUES
  ('JUNIOR', 'Junior', 8, 17, 60.00, 5.00, 'Youth masqueraders; requires guardian consent if under 18. Age bracket pending constitutional confirmation.', TRUE),
  ('SENIOR', 'Senior', 18, NULL, 180.00, 15.00, 'Full adult ordinary members aged 18+. Dues pending ratification.', TRUE),
  ('OFFICER', 'Officers', 21, NULL, 240.00, 20.00, 'Appointed or elected administrative/executive officers.', TRUE)
ON CONFLICT (code) DO NOTHING;

-- 4. 13 RBAC Roles
INSERT INTO public.roles (slug, display_name, scope_level, is_constitutional_office, description)
VALUES
  ('super_admin', 'Super Administrator', 'national', FALSE, 'Technical configuration and RBAC setup; cannot override constitutional governance votes or financial gates.'),
  ('society_admin', 'Society Administrator', 'national', FALSE, 'General society operations and member register administration.'),
  ('president', 'President', 'national', TRUE, 'Chief Executive Officer of LASUPADORA Masqueraders Society.'),
  ('general_secretary', 'General Secretary', 'national', TRUE, 'Chief Administrative Officer; authorized to act in President absence per approved rules.'),
  ('secretary', 'Secretary', 'national', TRUE, 'Records minutes, correspondence, and official society filings.'),
  ('treasurer', 'Treasurer', 'national', TRUE, 'Custodian of society finances, budgets, receipts, and financial controls.'),
  ('organizer', 'Organizer', 'national', TRUE, 'Coordinates events, logistics, and branch mobilization.'),
  ('costume_coordinator', 'Costume Coordinator', 'national', TRUE, 'Manages masquerade regalia, costumes, and equipment.'),
  ('band_leader', 'Band Leader', 'national', TRUE, 'Directs brass band, drummers, and musical rehearsals.'),
  ('branch_leader', 'Branch Leader', 'branch', TRUE, 'Leads an authorized Branch within branch-scoped permissions.'),
  ('subdivision_officer', 'Subdivision Officer', 'subdivision', FALSE, 'Coordinates a Community or Town Subdivision within subdivision scope.'),
  ('member', 'Member', 'self', FALSE, 'Approved member with personal portal access only.'),
  ('public_applicant', 'Public Applicant', 'public', FALSE, 'Prospective applicant submitting online membership applications.')
ON CONFLICT (slug) DO NOTHING;

-- 5. Default RBAC Module Permission Matrix
WITH perm_seed(role_slug, module, can_view, can_create, can_edit, can_approve, can_delete, can_export, can_manage) AS (
  VALUES
    -- super_admin (technical & config; governance/finance approvals isolated)
    ('super_admin', 'membership',   TRUE,  TRUE,  TRUE,  FALSE, FALSE, TRUE,  TRUE),
    ('super_admin', 'applications', TRUE,  TRUE,  TRUE,  FALSE, FALSE, TRUE,  TRUE),
    ('super_admin', 'branches',     TRUE,  TRUE,  TRUE,  TRUE,  FALSE, TRUE,  TRUE),
    ('super_admin', 'leadership',   TRUE,  TRUE,  TRUE,  FALSE, FALSE, TRUE,  TRUE),
    ('super_admin', 'rbac',         TRUE,  TRUE,  TRUE,  TRUE,  FALSE, TRUE,  TRUE),
    ('super_admin', 'finance',      TRUE,  FALSE, FALSE, FALSE, FALSE, TRUE,  FALSE),
    ('super_admin', 'events',       TRUE,  TRUE,  TRUE,  FALSE, FALSE, TRUE,  TRUE),
    ('super_admin', 'publications', TRUE,  TRUE,  TRUE,  FALSE, FALSE, TRUE,  TRUE),
    ('super_admin', 'gallery',      TRUE,  TRUE,  TRUE,  FALSE, FALSE, TRUE,  TRUE),
    ('super_admin', 'governance',   TRUE,  FALSE, FALSE, FALSE, FALSE, TRUE,  FALSE),
    ('super_admin', 'reports',      TRUE,  FALSE, FALSE, FALSE, FALSE, TRUE,  TRUE),
    ('super_admin', 'inquiries',    TRUE,  TRUE,  TRUE,  FALSE, FALSE, TRUE,  TRUE),
    -- society_admin
    ('society_admin', 'membership',   TRUE, TRUE,  TRUE,  TRUE,  FALSE, TRUE, TRUE),
    ('society_admin', 'applications', TRUE, TRUE,  TRUE,  TRUE,  FALSE, TRUE, TRUE),
    ('society_admin', 'branches',     TRUE, TRUE,  TRUE,  FALSE, FALSE, TRUE, TRUE),
    ('society_admin', 'leadership',   TRUE, TRUE,  TRUE,  FALSE, FALSE, TRUE, TRUE),
    ('society_admin', 'rbac',         TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE),
    ('society_admin', 'finance',      TRUE, TRUE,  FALSE, FALSE, FALSE, TRUE, FALSE),
    ('society_admin', 'events',       TRUE, TRUE,  TRUE,  TRUE,  FALSE, TRUE, TRUE),
    ('society_admin', 'publications', TRUE, TRUE,  TRUE,  TRUE,  FALSE, TRUE, TRUE),
    ('society_admin', 'gallery',      TRUE, TRUE,  TRUE,  TRUE,  FALSE, TRUE, TRUE),
    ('society_admin', 'governance',   TRUE, TRUE,  TRUE,  FALSE, FALSE, TRUE, TRUE),
    ('society_admin', 'reports',      TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, TRUE),
    ('society_admin', 'inquiries',    TRUE, TRUE,  TRUE,  TRUE,  FALSE, TRUE, TRUE),
    -- president
    ('president', 'membership',   TRUE, FALSE, TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('president', 'applications', TRUE, TRUE,  TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('president', 'branches',     TRUE, TRUE,  TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('president', 'leadership',   TRUE, TRUE,  TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('president', 'rbac',         TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE),
    ('president', 'finance',      TRUE, FALSE, FALSE, TRUE, FALSE, TRUE, FALSE),
    ('president', 'events',       TRUE, TRUE,  TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('president', 'publications', TRUE, TRUE,  TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('president', 'gallery',      TRUE, TRUE,  TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('president', 'governance',   TRUE, TRUE,  TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('president', 'reports',      TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, TRUE),
    ('president', 'inquiries',    TRUE, TRUE,  TRUE,  TRUE, FALSE, TRUE, TRUE),
    -- general_secretary
    ('general_secretary', 'membership',   TRUE, TRUE, TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('general_secretary', 'applications', TRUE, TRUE, TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('general_secretary', 'branches',     TRUE, TRUE, TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('general_secretary', 'leadership',   TRUE, TRUE, TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('general_secretary', 'rbac',         TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE),
    ('general_secretary', 'finance',      TRUE, TRUE, FALSE, TRUE, FALSE, TRUE, FALSE),
    ('general_secretary', 'events',       TRUE, TRUE, TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('general_secretary', 'publications', TRUE, TRUE, TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('general_secretary', 'gallery',      TRUE, TRUE, TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('general_secretary', 'governance',   TRUE, TRUE, TRUE,  TRUE, FALSE, TRUE, TRUE),
    ('general_secretary', 'reports',      TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, TRUE),
    ('general_secretary', 'inquiries',    TRUE, TRUE, TRUE,  TRUE, FALSE, TRUE, TRUE),
    -- secretary
    ('secretary', 'membership',   TRUE, TRUE,  TRUE,  FALSE, FALSE, TRUE,  FALSE),
    ('secretary', 'applications', TRUE, TRUE,  TRUE,  FALSE, FALSE, TRUE,  FALSE),
    ('secretary', 'branches',     TRUE, FALSE, FALSE, FALSE, FALSE, TRUE,  FALSE),
    ('secretary', 'leadership',   TRUE, TRUE,  TRUE,  FALSE, FALSE, TRUE,  FALSE),
    ('secretary', 'publications', TRUE, TRUE,  TRUE,  TRUE,  FALSE, TRUE,  TRUE),
    ('secretary', 'gallery',      TRUE, TRUE,  TRUE,  FALSE, FALSE, FALSE, FALSE),
    ('secretary', 'governance',   TRUE, TRUE,  TRUE,  FALSE, FALSE, TRUE,  TRUE),
    ('secretary', 'events',       TRUE, TRUE,  TRUE,  FALSE, FALSE, TRUE,  FALSE),
    ('secretary', 'reports',      TRUE, FALSE, FALSE, FALSE, FALSE, TRUE,  FALSE),
    ('secretary', 'inquiries',    TRUE, TRUE,  TRUE,  TRUE,  FALSE, TRUE,  TRUE),
    -- treasurer
    ('treasurer', 'membership', TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE),
    ('treasurer', 'finance',    TRUE, TRUE,  TRUE,  TRUE,  FALSE, TRUE, TRUE),
    ('treasurer', 'events',     TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE),
    ('treasurer', 'governance', TRUE, TRUE,  FALSE, FALSE, FALSE, TRUE, FALSE),
    ('treasurer', 'reports',    TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, TRUE),
    -- organizer
    ('organizer', 'membership', TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE),
    ('organizer', 'events',     TRUE, TRUE,  TRUE,  TRUE,  FALSE, TRUE,  TRUE),
    ('organizer', 'gallery',    TRUE, TRUE,  TRUE,  FALSE, FALSE, FALSE, TRUE),
    ('organizer', 'finance',    TRUE, TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE),
    ('organizer', 'reports',    TRUE, FALSE, FALSE, FALSE, FALSE, TRUE,  FALSE),
    -- costume_coordinator
    ('costume_coordinator', 'events',  TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE),
    ('costume_coordinator', 'gallery', TRUE, TRUE,  TRUE, FALSE, FALSE, FALSE, TRUE),
    ('costume_coordinator', 'finance', TRUE, TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE),
    -- band_leader
    ('band_leader', 'events',     TRUE, TRUE,  TRUE,  FALSE, FALSE, FALSE, FALSE),
    ('band_leader', 'gallery',    TRUE, TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE),
    ('band_leader', 'membership', TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE),
    -- branch_leader (scoped to branch_id)
    ('branch_leader', 'membership',   TRUE, TRUE,  TRUE,  FALSE, FALSE, TRUE, TRUE),
    ('branch_leader', 'applications', TRUE, TRUE,  TRUE,  TRUE,  FALSE, TRUE, FALSE),
    ('branch_leader', 'branches',     TRUE, FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE),
    ('branch_leader', 'events',       TRUE, TRUE,  TRUE,  FALSE, FALSE, TRUE, TRUE),
    ('branch_leader', 'finance',      TRUE, TRUE,  FALSE, FALSE, FALSE, TRUE, FALSE),
    ('branch_leader', 'gallery',      TRUE, TRUE,  TRUE,  FALSE, FALSE, FALSE, FALSE),
    ('branch_leader', 'governance',   TRUE, TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE),
    ('branch_leader', 'reports',      TRUE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE),
    ('branch_leader', 'inquiries',    TRUE, TRUE,  TRUE,  FALSE, FALSE, FALSE, FALSE),
    -- subdivision_officer (scoped to subdivision_id)
    ('subdivision_officer', 'membership',   TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE),
    ('subdivision_officer', 'applications', TRUE, TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE),
    ('subdivision_officer', 'events',       TRUE, FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE),
    ('subdivision_officer', 'finance',      TRUE, TRUE,  FALSE, FALSE, FALSE, FALSE, FALSE)
)
INSERT INTO public.role_permissions (role_id, module, can_view, can_create, can_edit, can_approve, can_delete, can_export, can_manage)
SELECT r.id, ps.module, ps.can_view, ps.can_create, ps.can_edit, ps.can_approve, ps.can_delete, ps.can_export, ps.can_manage
FROM perm_seed ps
JOIN public.roles r ON r.slug = ps.role_slug
ON CONFLICT (role_id, module) DO NOTHING;

-- 6. Configurable Constitutional & Financial Governance Policies
INSERT INTO public.governance_policies (key, category, label, value_json, requires_constitutional_confirmation)
VALUES
  ('term_limits', 'leadership', 'Executive Term Limits & Handover Rules', '{"max_years_per_term": 2, "max_consecutive_terms": 2, "handover_days": 14, "oath_required": true}'::JSONB, TRUE),
  ('financial_controls', 'finance', 'Financial Accountability Rules (GHS)', '{"currency": "GHS", "no_budget_no_approval": true, "no_accounts_no_next_funding": true, "budget_submission_weeks_before_event": 4, "receipt_submission_days_after_event": 7}'::JSONB, TRUE),
  ('application_fields', 'membership', 'Configurable Application Form Fields', '{"require_dob": true, "require_gender": false, "require_photo": true, "require_address": true, "require_emergency_contact": true, "require_supporting_doc": false, "allow_officer_exception": false}'::JSONB, TRUE),
  ('voting_rules', 'governance', 'Constitutional Quorum & Approval Thresholds', '{"quorum_percentage": 50, "simple_majority_percent": 51, "constitutional_amendment_percent": 67}'::JSONB, TRUE)
ON CONFLICT (key) DO NOTHING;
