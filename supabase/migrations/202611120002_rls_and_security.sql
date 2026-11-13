-- ============================================================================
-- LASUPADORA 360 — Migration 0002: Row Level Security (RLS), Storage & QR RPC
-- ============================================================================

-- Helper functions executed with SECURITY DEFINER + fixed search_path
CREATE OR REPLACE FUNCTION public.current_member_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.members WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_permission(p_module TEXT, p_action TEXT)
RETURNS BOOLEAN
LANGUAGE PLPGSQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := public.current_member_id();
  v_allowed BOOLEAN := FALSE;
BEGIN
  IF v_member_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.member_roles mr
    JOIN public.role_permissions rp ON rp.role_id = mr.role_id
    WHERE mr.member_id = v_member_id
      AND mr.is_active = TRUE
      AND rp.module = p_module
      AND (
        (p_action = 'view' AND rp.can_view) OR
        (p_action = 'create' AND rp.can_create) OR
        (p_action = 'edit' AND rp.can_edit) OR
        (p_action = 'approve' AND rp.can_approve) OR
        (p_action = 'delete' AND rp.can_delete) OR
        (p_action = 'export' AND rp.can_export) OR
        (p_action = 'manage' AND rp.can_manage)
      )
  ) INTO v_allowed;

  RETURN v_allowed;
END;
$$;

CREATE OR REPLACE FUNCTION public.in_member_scope(p_branch_id UUID, p_subdivision_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.member_roles mr
    JOIN public.roles r ON r.id = mr.role_id
    WHERE mr.member_id = public.current_member_id()
      AND mr.is_active = TRUE
      AND (
        r.scope_level = 'national'
        OR (r.scope_level = 'branch' AND mr.branch_id = p_branch_id)
        OR (r.scope_level = 'subdivision' AND mr.subdivision_id = p_subdivision_id)
      )
  );
$$;

-- Zero-PII Public QR Verification Function
CREATE OR REPLACE FUNCTION public.verify_member_qr(p_qr_token TEXT)
RETURNS TABLE (
  membership_number VARCHAR,
  full_name VARCHAR,
  branch_name VARCHAR,
  category_name VARCHAR,
  membership_status VARCHAR,
  card_valid_until DATE,
  is_valid BOOLEAN
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.membership_number,
    m.full_name,
    b.name AS branch_name,
    c.name AS category_name,
    m.membership_status,
    m.card_valid_until,
    (m.membership_status = 'Active' AND (m.card_valid_until IS NULL OR m.card_valid_until >= CURRENT_DATE)) AS is_valid
  FROM public.members m
  JOIN public.branches b ON b.id = m.branch_id
  JOIN public.membership_categories c ON c.id = m.category_id
  WHERE m.qr_token = p_qr_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.verify_member_qr(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_member_qr(TEXT) TO anon, authenticated;

-- Enable RLS across all tables
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subdivisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_decision_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leadership_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dues_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fundraising_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenditures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_action_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_feedback_and_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- PUBLIC READ & SUBMISSION POLICIES (Strictly non-PII)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public read active branches" ON public.branches;
CREATE POLICY "Public read active branches" ON public.branches
  FOR SELECT USING (is_active = TRUE OR public.has_permission('branches', 'view'));

DROP POLICY IF EXISTS "Public read active subdivisions" ON public.subdivisions;
CREATE POLICY "Public read active subdivisions" ON public.subdivisions
  FOR SELECT USING (is_active = TRUE OR public.has_permission('branches', 'view'));

DROP POLICY IF EXISTS "Public read categories" ON public.membership_categories;
CREATE POLICY "Public read categories" ON public.membership_categories
  FOR SELECT USING (is_active = TRUE OR public.has_permission('membership', 'view'));

DROP POLICY IF EXISTS "Public read published publications" ON public.publications;
CREATE POLICY "Public read published publications" ON public.publications
  FOR SELECT USING (status = 'Published' OR public.has_permission('publications', 'view'));

DROP POLICY IF EXISTS "Public read public events" ON public.events;
CREATE POLICY "Public read public events" ON public.events
  FOR SELECT USING ((is_public = TRUE AND status <> 'Draft') OR public.has_permission('events', 'view') OR public.current_member_id() IS NOT NULL);

DROP POLICY IF EXISTS "Public read public media" ON public.media_items;
CREATE POLICY "Public read public media" ON public.media_items
  FOR SELECT USING ((bucket_visibility = 'public' AND is_archived = FALSE) OR public.has_permission('gallery', 'view'));

DROP POLICY IF EXISTS "Public read approved leadership" ON public.leadership_appointments;
CREATE POLICY "Public read approved leadership" ON public.leadership_appointments
  FOR SELECT USING ((is_public_approved = TRUE AND status IN ('Active', 'Acting')) OR public.has_permission('leadership', 'view'));

DROP POLICY IF EXISTS "Public insert online application" ON public.membership_applications;
CREATE POLICY "Public insert online application" ON public.membership_applications
  FOR INSERT WITH CHECK (
    (source = 'public_web' AND status = 'Pending Review')
    OR (public.has_permission('applications', 'create') AND public.in_member_scope(preferred_branch_id, preferred_subdivision_id))
  );

DROP POLICY IF EXISTS "Public insert contact inquiry" ON public.member_feedback_and_inquiries;
CREATE POLICY "Public insert contact inquiry" ON public.member_feedback_and_inquiries
  FOR INSERT WITH CHECK (submission_type = 'Public Contact' OR auth.uid() IS NOT NULL);

-- ----------------------------------------------------------------------------
-- BRANCHES, SUBDIVISIONS, LEADERSHIP & RBAC ADMIN POLICIES
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins manage branches" ON public.branches;
CREATE POLICY "Admins manage branches" ON public.branches
  FOR ALL USING (public.has_permission('branches', 'edit') OR public.has_permission('branches', 'create'))
  WITH CHECK (public.has_permission('branches', 'edit') OR public.has_permission('branches', 'create'));

DROP POLICY IF EXISTS "Admins manage subdivisions" ON public.subdivisions;
CREATE POLICY "Admins manage subdivisions" ON public.subdivisions
  FOR ALL USING (public.has_permission('branches', 'edit') OR public.has_permission('branches', 'create'))
  WITH CHECK (public.has_permission('branches', 'edit') OR public.has_permission('branches', 'create'));

DROP POLICY IF EXISTS "Authenticated read roles and permissions" ON public.roles;
CREATE POLICY "Authenticated read roles and permissions" ON public.roles
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated read role permissions" ON public.role_permissions;
CREATE POLICY "Authenticated read role permissions" ON public.role_permissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "RBAC admins manage permissions" ON public.role_permissions;
CREATE POLICY "RBAC admins manage permissions" ON public.role_permissions
  FOR ALL USING (public.has_permission('rbac', 'manage'))
  WITH CHECK (public.has_permission('rbac', 'manage'));

DROP POLICY IF EXISTS "Leadership officers manage appointments" ON public.leadership_appointments;
CREATE POLICY "Leadership officers manage appointments" ON public.leadership_appointments
  FOR ALL USING (public.has_permission('leadership', 'edit') OR public.has_permission('leadership', 'create'))
  WITH CHECK (public.has_permission('leadership', 'edit') OR public.has_permission('leadership', 'create'));

-- ----------------------------------------------------------------------------
-- MEMBERS, APPLICATIONS, TRANSFERS & PROFILE REQUESTS
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members read own record or scoped admin" ON public.members;
CREATE POLICY "Members read own record or scoped admin" ON public.members
  FOR SELECT USING (
    auth_user_id = auth.uid()
    OR (public.has_permission('membership', 'view') AND public.in_member_scope(branch_id, subdivision_id))
  );

DROP POLICY IF EXISTS "Scoped officers manage members" ON public.members;
CREATE POLICY "Scoped officers manage members" ON public.members
  FOR UPDATE USING (
    (public.has_permission('membership', 'edit') AND public.in_member_scope(branch_id, subdivision_id))
    OR public.has_permission('leadership', 'edit')
  );

DROP POLICY IF EXISTS "Users read own auth profile or admin" ON public.auth_profiles;
CREATE POLICY "Users read own auth profile or admin" ON public.auth_profiles
  FOR SELECT USING (
    id = auth.uid()
    OR public.has_permission('rbac', 'view')
    OR public.has_permission('membership', 'view')
  );

DROP POLICY IF EXISTS "Users update own auth profile" ON public.auth_profiles;
CREATE POLICY "Users update own auth profile" ON public.auth_profiles
  FOR UPDATE USING (id = auth.uid() OR public.has_permission('rbac', 'manage'))
  WITH CHECK (id = auth.uid() OR public.has_permission('rbac', 'manage'));

DROP POLICY IF EXISTS "Officers read scoped applications" ON public.membership_applications;
CREATE POLICY "Officers read scoped applications" ON public.membership_applications
  FOR SELECT USING (
    public.has_permission('applications', 'view')
    AND public.in_member_scope(preferred_branch_id, preferred_subdivision_id)
  );

DROP POLICY IF EXISTS "Officers review scoped applications" ON public.membership_applications;
CREATE POLICY "Officers review scoped applications" ON public.membership_applications
  FOR UPDATE USING (
    public.has_permission('applications', 'edit')
    AND public.in_member_scope(preferred_branch_id, preferred_subdivision_id)
  );

DROP POLICY IF EXISTS "Officers read application decision history" ON public.application_decision_history;
CREATE POLICY "Officers read application decision history" ON public.application_decision_history
  FOR SELECT USING (public.has_permission('applications', 'view'));

DROP POLICY IF EXISTS "Members manage own profile change requests" ON public.profile_change_requests;
CREATE POLICY "Members manage own profile change requests" ON public.profile_change_requests
  FOR ALL USING (
    member_id = public.current_member_id()
    OR public.has_permission('membership', 'approve')
  )
  WITH CHECK (
    member_id = public.current_member_id()
    OR public.has_permission('membership', 'approve')
  );

DROP POLICY IF EXISTS "Scoped officers manage member transfers" ON public.member_transfers;
CREATE POLICY "Scoped officers manage member transfers" ON public.member_transfers
  FOR ALL USING (
    member_id = public.current_member_id()
    OR public.has_permission('membership', 'edit')
  );

DROP POLICY IF EXISTS "Members read own roles or RBAC admins" ON public.member_roles;
CREATE POLICY "Members read own roles or RBAC admins" ON public.member_roles
  FOR SELECT USING (
    member_id = public.current_member_id()
    OR public.has_permission('rbac', 'view')
    OR public.has_permission('membership', 'view')
  );

DROP POLICY IF EXISTS "RBAC admins assign member roles" ON public.member_roles;
CREATE POLICY "RBAC admins assign member roles" ON public.member_roles
  FOR ALL USING (public.has_permission('rbac', 'manage'))
  WITH CHECK (public.has_permission('rbac', 'manage'));

-- ----------------------------------------------------------------------------
-- EVENTS, PUBLICATIONS, MEDIA, FINANCE & GOVERNANCE
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Event officers manage events" ON public.events;
CREATE POLICY "Event officers manage events" ON public.events
  FOR ALL USING (public.has_permission('events', 'edit') OR public.has_permission('events', 'create'))
  WITH CHECK (public.has_permission('events', 'edit') OR public.has_permission('events', 'create'));

DROP POLICY IF EXISTS "Members and officers manage event registrations" ON public.event_registrations;
CREATE POLICY "Members and officers manage event registrations" ON public.event_registrations
  FOR ALL USING (member_id = public.current_member_id() OR public.has_permission('events', 'edit'))
  WITH CHECK (member_id = public.current_member_id() OR public.has_permission('events', 'edit'));

DROP POLICY IF EXISTS "Content officers manage publications" ON public.publications;
CREATE POLICY "Content officers manage publications" ON public.publications
  FOR ALL USING (public.has_permission('publications', 'edit') OR public.has_permission('publications', 'create'))
  WITH CHECK (public.has_permission('publications', 'edit') OR public.has_permission('publications', 'create'));

DROP POLICY IF EXISTS "Gallery officers manage media" ON public.media_items;
CREATE POLICY "Gallery officers manage media" ON public.media_items
  FOR ALL USING (public.has_permission('gallery', 'edit') OR public.has_permission('gallery', 'create') OR public.has_permission('leadership', 'edit'))
  WITH CHECK (public.has_permission('gallery', 'edit') OR public.has_permission('gallery', 'create') OR public.has_permission('leadership', 'edit'));

DROP POLICY IF EXISTS "Authenticated read dues schedules" ON public.dues_schedules;
CREATE POLICY "Authenticated read dues schedules" ON public.dues_schedules
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Finance officers manage dues schedules" ON public.dues_schedules;
CREATE POLICY "Finance officers manage dues schedules" ON public.dues_schedules
  FOR ALL USING (public.has_permission('finance', 'manage'))
  WITH CHECK (public.has_permission('finance', 'manage'));

DROP POLICY IF EXISTS "Public and members read fundraising campaigns" ON public.fundraising_campaigns;
CREATE POLICY "Public and members read fundraising campaigns" ON public.fundraising_campaigns
  FOR SELECT USING (status = 'Active' OR public.has_permission('finance', 'view'));

DROP POLICY IF EXISTS "Finance officers manage campaigns" ON public.fundraising_campaigns;
CREATE POLICY "Finance officers manage campaigns" ON public.fundraising_campaigns
  FOR ALL USING (public.has_permission('finance', 'create') OR public.has_permission('finance', 'manage'))
  WITH CHECK (public.has_permission('finance', 'create') OR public.has_permission('finance', 'manage'));

DROP POLICY IF EXISTS "Members read own payments or finance officer" ON public.financial_payments;
CREATE POLICY "Members read own payments or finance officer" ON public.financial_payments
  FOR SELECT USING (
    member_id = public.current_member_id()
    OR (public.has_permission('finance', 'view') AND (branch_id IS NULL OR public.in_member_scope(branch_id, NULL)))
  );

DROP POLICY IF EXISTS "Members claim payment or finance record" ON public.financial_payments;
CREATE POLICY "Members claim payment or finance record" ON public.financial_payments
  FOR INSERT WITH CHECK (
    (member_id = public.current_member_id() AND verification_status = 'Pending Verification')
    OR public.has_permission('finance', 'create')
  );

DROP POLICY IF EXISTS "Finance officers verify payments" ON public.financial_payments;
CREATE POLICY "Finance officers verify payments" ON public.financial_payments
  FOR UPDATE USING (public.has_permission('finance', 'approve') OR public.has_permission('finance', 'edit'));

DROP POLICY IF EXISTS "Finance officers manage budgets" ON public.budgets;
CREATE POLICY "Finance officers manage budgets" ON public.budgets
  FOR ALL USING (public.has_permission('finance', 'view'))
  WITH CHECK (public.has_permission('finance', 'create') OR public.has_permission('finance', 'approve'));

DROP POLICY IF EXISTS "Finance officers manage expenditures" ON public.expenditures;
CREATE POLICY "Finance officers manage expenditures" ON public.expenditures
  FOR ALL USING (public.has_permission('finance', 'view'))
  WITH CHECK (public.has_permission('finance', 'create') OR public.has_permission('finance', 'approve'));

DROP POLICY IF EXISTS "Authenticated read governance policies" ON public.governance_policies;
CREATE POLICY "Authenticated read governance policies" ON public.governance_policies
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Governance officers manage meetings" ON public.governance_meetings;
CREATE POLICY "Governance officers manage meetings" ON public.governance_meetings
  FOR ALL USING (public.current_member_id() IS NOT NULL)
  WITH CHECK (public.has_permission('governance', 'create') OR public.has_permission('governance', 'edit'));

DROP POLICY IF EXISTS "Members read governance proposals" ON public.governance_proposals;
CREATE POLICY "Members read governance proposals" ON public.governance_proposals
  FOR SELECT USING (public.current_member_id() IS NOT NULL);

DROP POLICY IF EXISTS "Governance officers manage proposals" ON public.governance_proposals;
CREATE POLICY "Governance officers manage proposals" ON public.governance_proposals
  FOR ALL USING (public.has_permission('governance', 'create') OR public.has_permission('governance', 'approve'))
  WITH CHECK (public.has_permission('governance', 'create') OR public.has_permission('governance', 'approve'));

DROP POLICY IF EXISTS "Members cast governance votes" ON public.governance_votes;
CREATE POLICY "Members cast governance votes" ON public.governance_votes
  FOR ALL USING (member_id = public.current_member_id() OR public.has_permission('governance', 'view'))
  WITH CHECK (member_id = public.current_member_id());

DROP POLICY IF EXISTS "Members read governance action points" ON public.governance_action_points;
CREATE POLICY "Members read governance action points" ON public.governance_action_points
  FOR SELECT USING (assigned_to = public.current_member_id() OR public.has_permission('governance', 'view'));

DROP POLICY IF EXISTS "Governance officers manage action points" ON public.governance_action_points;
CREATE POLICY "Governance officers manage action points" ON public.governance_action_points
  FOR ALL USING (public.has_permission('governance', 'edit'))
  WITH CHECK (public.has_permission('governance', 'edit'));

DROP POLICY IF EXISTS "Members read own or managed inquiries" ON public.member_feedback_and_inquiries;
CREATE POLICY "Members read own or managed inquiries" ON public.member_feedback_and_inquiries
  FOR SELECT USING (member_id = public.current_member_id() OR public.has_permission('inquiries', 'view'));

DROP POLICY IF EXISTS "Officers respond to inquiries" ON public.member_feedback_and_inquiries;
CREATE POLICY "Officers respond to inquiries" ON public.member_feedback_and_inquiries
  FOR UPDATE USING (public.has_permission('inquiries', 'edit'));

DROP POLICY IF EXISTS "Members read own notifications" ON public.notifications;
CREATE POLICY "Members read own notifications" ON public.notifications
  FOR ALL USING (member_id = public.current_member_id());

DROP POLICY IF EXISTS "Governance audit read" ON public.audit_logs;
CREATE POLICY "Governance audit read" ON public.audit_logs
  FOR SELECT USING (public.has_permission('governance', 'view') OR public.has_permission('rbac', 'view'));

-- ----------------------------------------------------------------------------
-- SUPABASE STORAGE BUCKETS & POLICIES (Public Media vs Private Documents)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('public-media', 'public-media', TRUE),
  ('private-documents', 'private-documents', FALSE)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read public-media" ON storage.objects;
CREATE POLICY "Public read public-media" ON storage.objects
  FOR SELECT USING (bucket_id = 'public-media');

DROP POLICY IF EXISTS "Officers upload public-media" ON storage.objects;
CREATE POLICY "Officers upload public-media" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'public-media'
    AND (
      public.has_permission('gallery', 'create')
      OR public.has_permission('publications', 'create')
      OR public.has_permission('events', 'create')
      OR public.has_permission('leadership', 'edit')
      OR public.has_permission('leadership', 'create')
    )
  );

DROP POLICY IF EXISTS "Officers update public-media" ON storage.objects;
CREATE POLICY "Officers update public-media" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'public-media'
    AND (
      public.has_permission('gallery', 'edit')
      OR public.has_permission('leadership', 'edit')
    )
  );

DROP POLICY IF EXISTS "Authenticated upload private-documents" ON storage.objects;
CREATE POLICY "Authenticated upload private-documents" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'private-documents'
    AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Authorized read private-documents" ON storage.objects;
CREATE POLICY "Authorized read private-documents" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'private-documents'
    AND (
      public.has_permission('membership', 'view')
      OR public.has_permission('applications', 'view')
      OR public.has_permission('finance', 'view')
    )
  );

-- Auto-create authentication profile & link member record when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID;
BEGIN
  SELECT id INTO v_member_id
  FROM public.members
  WHERE LOWER(email) = LOWER(NEW.email)
  LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.members
    SET auth_user_id = NEW.id, updated_at = NOW()
    WHERE id = v_member_id AND auth_user_id IS NULL;
  END IF;

  INSERT INTO public.auth_profiles (id, member_id, email, full_name)
  VALUES (
    NEW.id,
    v_member_id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    member_id = COALESCE(public.auth_profiles.member_id, EXCLUDED.member_id),
    updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();
