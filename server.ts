import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  db,
  generateActivationCode,
  hashPassword,
  initSchema,
  logAudit,
  signSessionToken,
  uid,
  uploadsPrivateDir,
  uploadsPublicDir,
  verifyPassword,
} from './src/server/db.ts';
import { seedIfEmpty } from './src/server/seed.ts';
import {
  attachAuth,
  canAccessScope,
  loadAuthContext,
  requireAuth,
  requirePermission,
  type AuthedRequest,
} from './src/server/auth.ts';
import {
  ensureSupabaseSeeded,
  getSupabaseConfig,
  getSupabasePublic,
  syncApplicationToSupabase,
  syncAuditToSupabase,
  syncBranchToSupabase,
  syncBudgetToSupabase,
  syncDuesScheduleToSupabase,
  syncEventAttendanceToSupabase,
  syncEventToSupabase,
  syncExpenditureToSupabase,
  syncGovernanceMeetingToSupabase,
  syncGovernancePolicyToSupabase,
  syncGovernanceProposalToSupabase,
  syncInquiryToSupabase,
  syncLeadershipToSupabase,
  syncMediaItemToSupabase,
  syncMemberRoleToSupabase,
  syncMemberToSupabase,
  syncMemberTransferToSupabase,
  syncPaymentToSupabase,
  syncPublicationToSupabase,
  syncRbacPermissionToSupabase,
  syncSubdivisionToSupabase,
  syncUploadToSupabaseStorage,
  testSupabaseHealth,
} from './src/server/supabaseSync.ts';

dotenv.config();

initSchema();
seedIfEmpty();

function getExpectedMembershipPrefix(branchId: string, subdivisionId: string | null | undefined): string {
  const branch = db.prepare(`SELECT code, branch_type FROM branches WHERE id = ?`).get(branchId) as
    | { code: string; branch_type: string }
    | undefined;
  if (!branch) return 'LSMS-';
  if (branch.code === 'TM' || branch.branch_type === 'tema') {
    const sub = subdivisionId
      ? (db.prepare(`SELECT code, name FROM subdivisions WHERE id = ?`).get(subdivisionId) as
          | { code: string; name: string }
          | undefined)
      : undefined;
    const match = sub?.code?.match(/^C(\d+)$/i) || sub?.name?.match(/Community\s+(\d+)/i);
    if (match) {
      const num = parseInt(match[1], 10);
      return `LSMS-TM-${String(num).padStart(2, '0')}-`;
    }
    return 'LSMS-TM-';
  }
  if (branch.code === 'OT' || branch.branch_type === 'outside_tema') {
    return 'LSMS-OT-';
  }
  return `LSMS-${branch.code.toUpperCase()}-`;
}

function normalizeMembershipId(
  raw: string,
  branchId: string,
  subdivisionId: string | null | undefined
): { valid: true; value: string } | { valid: false; error: string } {
  const trimmed = String(raw || '').trim();
  const expectedPrefix = getExpectedMembershipPrefix(branchId, subdivisionId);
  if (!trimmed) {
    return { valid: false, error: 'Membership ID cannot be empty.' };
  }
  if (!trimmed.toUpperCase().startsWith(expectedPrefix.toUpperCase())) {
    return {
      valid: false,
      error: `Membership ID for this branch/community must start with "${expectedPrefix}" (e.g. ${expectedPrefix}001).`,
    };
  }
  const suffix = trimmed.slice(expectedPrefix.length);
  const meaningfulSuffix = suffix.replace(/^[-_/.\s]+/, '').trim();
  if (!meaningfulSuffix) {
    return {
      valid: false,
      error: `Please enter an identifier after "${expectedPrefix}" (e.g. ${expectedPrefix}001).`,
    };
  }
  return { valid: true, value: `${expectedPrefix}${suffix}` };
}

function generateNextUniqueLsmsId(branchId: string, subdivisionId: string | null | undefined): string {
  const prefix = getExpectedMembershipPrefix(branchId, subdivisionId);
  let n = 1;
  while (true) {
    const candidate = `${prefix}${String(n).padStart(3, '0')}`;
    const exists = db.prepare(`SELECT id FROM members WHERE UPPER(membership_number) = UPPER(?)`).get(candidate);
    if (!exists) return candidate;
    n += 1;
  }
}

// Migrate existing members whose IDs do not match their branch/community prefix (e.g. LSMS-TM-0001 -> LSMS-TM-01-001, LSMS-OT-0005 -> LSMS-OT-001)
const allExistingMembers = db
  .prepare(`SELECT id, membership_number, branch_id, subdivision_id FROM members ORDER BY registration_date ASC, membership_number ASC`)
  .all() as { id: string; membership_number: string; branch_id: string; subdivision_id: string }[];
const migratedPairs: { id: string; oldNum: string }[] = [];
for (const m of allExistingMembers) {
  const expectedPrefix = getExpectedMembershipPrefix(m.branch_id, m.subdivision_id);
  const isLegacyOutside = expectedPrefix === 'LSMS-OT-' && /^(LSP|LSMS)-OT-\d{4}$/i.test(m.membership_number);
  const needsCommunityPrefix = !m.membership_number.startsWith(expectedPrefix) || isLegacyOutside;
  if (needsCommunityPrefix) {
    const nextNum = generateNextUniqueLsmsId(m.branch_id, m.subdivision_id);
    db.prepare(`UPDATE members SET membership_number = ?, updated_at = datetime('now') WHERE id = ?`).run(nextNum, m.id);
    migratedPairs.push({ id: m.id, oldNum: m.membership_number });
  }
}

void ensureSupabaseSeeded().then(async () => {
  for (const pair of migratedPairs) {
    await syncMemberToSupabase(pair.id, pair.oldNum);
  }
  const superAdminRow = db
    .prepare(
      `SELECT m.id FROM members m
       JOIN member_roles mr ON mr.member_id = m.id
       JOIN roles r ON r.id = mr.role_id
       WHERE r.slug = 'super_admin'
       LIMIT 1`
    )
    .get() as { id: string } | undefined;
  if (superAdminRow) void syncMemberToSupabase(superAdminRow.id);
});

function recordAudit(
  actorMemberId: string | null,
  action: string,
  targetTable: string,
  targetId: string | null,
  details: Record<string, unknown> = {}
) {
  logAudit(actorMemberId, action, targetTable, targetId, details);
  void syncAuditToSupabase(actorMemberId, action, targetTable, {
    ...details,
    ...(targetId ? { local_target_id: targetId } : {}),
  });
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '12mb' }));
app.use(attachAuth);

// Serve approved public uploads cleanly
app.use('/uploads/public', express.static(uploadsPublicDir));

// Protected private uploads (requires authentication & view permission on finance/applications/membership)
app.get('/uploads/private/:filename', requireAuth, (req: AuthedRequest, res) => {
  const filename = path.basename(req.params.filename);
  const fullPath = path.join(uploadsPrivateDir, filename);
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'Private document not found' });
    return;
  }
  const allowed =
    req.auth?.permissions.membership?.view ||
    req.auth?.permissions.applications?.view ||
    req.auth?.permissions.finance?.view ||
    req.auth?.permissions.gallery?.view;
  if (!allowed) {
    res.status(403).json({ error: 'Forbidden: restricted private storage bucket' });
    return;
  }
  res.sendFile(fullPath);
});

// ----------------------------------------------------------------------------
// 1. PUBLIC WEBSITE & ZERO-PII QR VERIFICATION ENDPOINTS
// ----------------------------------------------------------------------------
app.get('/api/public/overview', (_req, res) => {
  const branches = db.prepare(`SELECT * FROM branches WHERE is_active = 1 ORDER BY branch_type, name`).all();
  const subdivisions = db
    .prepare(`SELECT * FROM subdivisions WHERE is_active = 1 ORDER BY branch_id, CAST(REPLACE(code, 'C', '') AS INTEGER), name`)
    .all();
  const categories = db.prepare(`SELECT * FROM membership_categories WHERE is_active = 1 ORDER BY annual_dues_ghs ASC`).all();
  const leadership = db
    .prepare(
      `SELECT l.id, l.portfolio, l.scope_type, l.term_start, l.term_expiry, l.biography, l.can_act_for_president, l.status,
              m.full_name, m.photo_url, b.name AS branch_name
       FROM leadership_appointments l
       JOIN members m ON m.id = l.member_id
       LEFT JOIN branches b ON b.id = l.branch_id
       WHERE l.is_public_approved = 1 AND l.status IN ('Active', 'Acting')
       ORDER BY CASE WHEN l.scope_type = 'national' THEN 0 ELSE 1 END, l.created_at`
    )
    .all();
  const publications = db
    .prepare(
      `SELECT p.*, m.full_name AS author_name
       FROM publications p
       LEFT JOIN members m ON m.id = p.author_id
       WHERE p.status = 'Published'
       ORDER BY p.is_featured DESC, p.published_at DESC`
    )
    .all();
  const events = db
    .prepare(
      `SELECT e.*, b.name AS branch_name,
              (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id) AS registered_count
       FROM events e
       LEFT JOIN branches b ON b.id = e.branch_id
       WHERE e.is_public = 1 AND e.status <> 'Draft'
       ORDER BY e.event_date DESC`
    )
    .all();
  const gallery = db
    .prepare(`SELECT * FROM media_items WHERE bucket_visibility = 'public' AND is_archived = 0 ORDER BY created_at DESC`)
    .all();
  const policiesRows = db.prepare(`SELECT key, label, value_json, requires_constitutional_confirmation, confirmed FROM governance_policies`).all() as {
    key: string;
    label: string;
    value_json: string;
    requires_constitutional_confirmation: number;
    confirmed: number;
  }[];
  const policies: Record<string, unknown> = {};
  for (const row of policiesRows) {
    policies[row.key] = {
      label: row.label,
      value: JSON.parse(row.value_json),
      requiresConstitutionalConfirmation: Boolean(row.requires_constitutional_confirmation),
      confirmed: Boolean(row.confirmed),
    };
  }
  const campaigns = db
    .prepare(
      `SELECT fc.*, COALESCE((SELECT SUM(fp.amount_ghs) FROM financial_payments fp WHERE fp.campaign_id = fc.id AND fp.verification_status = 'Verified'), 0) AS raised_ghs
       FROM fundraising_campaigns fc WHERE fc.status = 'Active'`
    )
    .all();

  res.json({ branches, subdivisions, categories, leadership, publications, events, gallery, policies, campaigns });
});

app.get('/api/health/supabase', async (_req, res) => {
  const health = await testSupabaseHealth();
  if (health.configured && !health.connected) {
    res.status(502).json(health);
    return;
  }
  res.json(health);
});

// Zero-PII QR verification: strictly minimal validation data only
app.get('/api/public/verify/:token', async (req, res) => {
  const card = db
    .prepare(
      `SELECT m.membership_number, m.full_name, m.photo_url, m.membership_status, m.card_valid_until,
              b.name AS branch_name, c.name AS category_name
       FROM members m
       JOIN branches b ON b.id = m.branch_id
       JOIN membership_categories c ON c.id = m.category_id
       WHERE m.qr_token = ?`
    )
    .get(req.params.token) as {
      membership_number: string;
      full_name: string;
      photo_url: string | null;
      membership_status: string;
      card_valid_until: string | null;
      branch_name: string;
      category_name: string;
    } | undefined;

  const supabasePublic = getSupabasePublic();
  if (!card && supabasePublic) {
    const { data } = await supabasePublic.rpc('verify_member_qr', { p_qr_token: req.params.token });
    if (Array.isArray(data) && data.length > 0) {
      const remote = data[0] as {
        membership_number: string;
        full_name: string;
        branch_name: string;
        category_name: string;
        membership_status: string;
        card_valid_until: string | null;
        is_valid: boolean;
      };
      res.json({
        verified: true,
        isValid: remote.is_valid,
        card: { ...remote, photo_url: null },
      });
      return;
    }
  }

  if (!card) {
    res.status(404).json({ verified: false, error: 'Membership credential token was not found in the official register.' });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const isValid = card.membership_status === 'Active' && (!card.card_valid_until || card.card_valid_until >= today);
  res.json({ verified: true, isValid, card });
});

app.post('/api/public/applications', async (req, res) => {
  try {
    const policyRow = db.prepare(`SELECT value_json FROM governance_policies WHERE key = 'application_fields'`).get() as { value_json: string } | undefined;
    const fieldRules = policyRow ? JSON.parse(policyRow.value_json) : {};

    const {
      full_name,
      date_of_birth,
      gender,
      telephone,
      email,
      password,
      confirm_password,
      residential_address,
      photo_url,
      preferred_branch_id,
      preferred_subdivision_id,
      requested_category_id,
      previous_experience,
      emergency_contact_name,
      emergency_contact_phone,
      supporting_doc_url,
      declaration_accepted,
      privacy_consent_accepted,
    } = req.body;

    if (!full_name?.trim() || !telephone?.trim() || !preferred_branch_id || !preferred_subdivision_id || !requested_category_id) {
      res.status(400).json({ error: 'Full name, telephone, branch, subdivision, and membership category are required.' });
      return;
    }
    if (!declaration_accepted || !privacy_consent_accepted) {
      res.status(400).json({ error: 'You must accept the Society Declaration and Privacy Consent to submit an application.' });
      return;
    }
    if (fieldRules.require_dob && !date_of_birth) {
      res.status(400).json({ error: 'Date of birth is required by current Society policy.' });
      return;
    }
    if (fieldRules.require_address && !residential_address?.trim()) {
      res.status(400).json({ error: 'Residential address is required by current Society policy.' });
      return;
    }
    if (fieldRules.require_emergency_contact && (!emergency_contact_name?.trim() || !emergency_contact_phone?.trim())) {
      res.status(400).json({ error: 'Emergency contact name and telephone are required.' });
      return;
    }

    let passwordHash: string | null = null;
    if (password !== undefined && String(password).length > 0) {
      if (String(password).length < 8) {
        res.status(400).json({ error: 'Portal password must be at least 8 characters long.' });
        return;
      }
      if (confirm_password !== undefined && String(password) !== String(confirm_password)) {
        res.status(400).json({ error: 'Password and confirmation password do not match.' });
        return;
      }
      passwordHash = hashPassword(String(password));
    }

    if (email) {
      const existingMember = db.prepare(`SELECT id FROM members WHERE LOWER(email) = LOWER(?)`).get(email.trim());
      if (existingMember) {
        res.status(409).json({ error: 'A member record with this email address already exists.' });
        return;
      }
    }

    const id = uid();
    const ref = `APP-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    db.exec('BEGIN');
    db.prepare(
      `INSERT INTO membership_applications (
        id, application_ref, source, full_name, date_of_birth, gender, telephone, email, password_hash, residential_address,
        photo_url, preferred_branch_id, preferred_subdivision_id, requested_category_id, previous_experience,
        emergency_contact_name, emergency_contact_phone, supporting_doc_url, declaration_accepted, privacy_consent_accepted, status
      ) VALUES (?, ?, 'public_web', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'Pending Review')`
    ).run(
      id,
      ref,
      full_name.trim(),
      date_of_birth || null,
      gender || null,
      telephone.trim(),
      email?.trim() || null,
      passwordHash,
      residential_address?.trim() || null,
      photo_url || null,
      preferred_branch_id,
      preferred_subdivision_id,
      requested_category_id,
      previous_experience?.trim() || null,
      emergency_contact_name?.trim() || null,
      emergency_contact_phone?.trim() || null,
      supporting_doc_url || null
    );
    db.prepare(
      `INSERT INTO application_decision_history (id, application_id, previous_status, new_status, notes) VALUES (?, ?, NULL, 'Pending Review', 'Submitted via Public Online Application Portal')`
    ).run(uid(), id);
    db.exec('COMMIT');

    let supabaseSynced = false;
    const supabaseClient = getSupabasePublic();
    if (supabaseClient) {
      try {
        const localBranch = db.prepare(`SELECT code FROM branches WHERE id = ?`).get(preferred_branch_id) as { code: string } | undefined;
        const localSub = db.prepare(`SELECT code FROM subdivisions WHERE id = ?`).get(preferred_subdivision_id) as { code: string } | undefined;
        const localCat = db.prepare(`SELECT code FROM membership_categories WHERE id = ?`).get(requested_category_id) as { code: string } | undefined;
        if (localBranch && localSub && localCat) {
          const [{ data: sbBranch }, { data: sbCat }] = await Promise.all([
            supabaseClient.from('branches').select('id').eq('code', localBranch.code).single(),
            supabaseClient.from('membership_categories').select('id').eq('code', localCat.code).single(),
          ]);
          if (sbBranch && sbCat) {
            const { data: sbSub } = await supabaseClient
              .from('subdivisions')
              .select('id')
              .eq('branch_id', sbBranch.id)
              .eq('code', localSub.code)
              .single();
            if (sbSub) {
              const { error: sbErr } = await supabaseClient.from('membership_applications').insert({
                application_ref: ref,
                source: 'public_web',
                full_name: full_name.trim(),
                date_of_birth: date_of_birth || null,
                gender: gender || null,
                telephone: telephone.trim(),
                email: email?.trim() || null,
                residential_address: residential_address?.trim() || null,
                photo_storage_path: photo_url || null,
                preferred_branch_id: sbBranch.id,
                preferred_subdivision_id: sbSub.id,
                requested_category_id: sbCat.id,
                previous_experience: previous_experience?.trim() || null,
                emergency_contact_name: emergency_contact_name?.trim() || null,
                emergency_contact_phone: emergency_contact_phone?.trim() || null,
                supporting_doc_path: supporting_doc_url || null,
                declaration_accepted: true,
                privacy_consent_accepted: true,
                status: 'Pending Review',
              });
              if (!sbErr) supabaseSynced = true;
            }
          }
        }
      } catch {
        // Non-blocking fallback when offline
      }
    }

    res.status(201).json({ id, application_ref: ref, status: 'Pending Review', has_password: Boolean(passwordHash), supabaseSynced });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    res.status(400).json({ error: (err as Error).message });
  }
});

function normalizePhoneDigits(phone: string | null | undefined): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('233') && digits.length >= 12) return digits.slice(-9);
  if (digits.startsWith('0') && digits.length === 10) return digits.slice(-9);
  return digits.slice(-9);
}

app.post('/api/public/applications/status', (req, res) => {
  const { application_ref, telephone } = req.body as { application_ref?: string; telephone?: string };
  if (!application_ref?.trim() || !telephone?.trim()) {
    res.status(400).json({ error: 'Application reference (e.g. APP-2026-1234) and telephone number are required.' });
    return;
  }
  const appRow = db
    .prepare(
      `SELECT a.application_ref, a.full_name, a.telephone, a.status, a.review_comments, a.submitted_at, a.reviewed_at, a.approved_member_id,
              b.name AS branch_name, s.name AS subdivision_name, c.name AS category_name
       FROM membership_applications a
       JOIN branches b ON b.id = a.preferred_branch_id
       JOIN subdivisions s ON s.id = a.preferred_subdivision_id
       JOIN membership_categories c ON c.id = a.requested_category_id
       WHERE UPPER(a.application_ref) = UPPER(?)`
    )
    .get(application_ref.trim()) as
    | {
        application_ref: string;
        full_name: string;
        telephone: string;
        status: string;
        review_comments: string | null;
        submitted_at: string;
        reviewed_at: string | null;
        approved_member_id: string | null;
        branch_name: string;
        subdivision_name: string;
        category_name: string;
      }
    | undefined;

  if (!appRow || normalizePhoneDigits(appRow.telephone) !== normalizePhoneDigits(telephone)) {
    res.status(404).json({ error: 'No matching application was found for that reference and telephone number.' });
    return;
  }

  let membershipNumber: string | null = null;
  let needsActivation = false;
  if (appRow.status === 'Approved' && appRow.approved_member_id) {
    const memberRow = db
      .prepare(`SELECT membership_number, password_hash, activation_code_hash FROM members WHERE id = ?`)
      .get(appRow.approved_member_id) as
      | { membership_number: string; password_hash: string | null; activation_code_hash: string | null }
      | undefined;
    if (memberRow) {
      membershipNumber = memberRow.membership_number;
      needsActivation = !memberRow.password_hash && Boolean(memberRow.activation_code_hash);
    }
  }

  res.json({
    application_ref: appRow.application_ref,
    applicant_name: appRow.full_name,
    status: appRow.status,
    branch_name: appRow.branch_name,
    subdivision_name: appRow.subdivision_name,
    category_name: appRow.category_name,
    review_comments: appRow.review_comments,
    submitted_at: appRow.submitted_at,
    reviewed_at: appRow.reviewed_at,
    membership_number: membershipNumber,
    needs_activation: needsActivation,
  });
});

app.post('/api/public/contact', async (req, res) => {
  const { sender_name, sender_email, subject, message } = req.body;
  if (!sender_name?.trim() || !subject?.trim() || !message?.trim()) {
    res.status(400).json({ error: 'Name, subject, and message are required.' });
    return;
  }
  const id = uid();
  db.prepare(
    `INSERT INTO member_feedback_and_inquiries (id, sender_name, sender_email, submission_type, subject, message, status) VALUES (?, ?, ?, 'Public Contact', ?, ?, 'Received')`
  ).run(id, sender_name.trim(), sender_email?.trim() || null, subject.trim(), message.trim());

  let supabaseSynced = false;
  const supabaseClient = getSupabasePublic();
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from('member_feedback_and_inquiries').insert({
        sender_name: sender_name.trim(),
        sender_email: sender_email?.trim() || null,
        submission_type: 'Public Contact',
        subject: subject.trim(),
        message: message.trim(),
        status: 'Received',
      });
      if (!error) supabaseSynced = true;
    } catch {
      // Non-blocking fallback when offline
    }
  }

  res.status(201).json({ id, supabaseSynced, message: 'Your inquiry has been logged for the Society Secretariat.' });
});

// ----------------------------------------------------------------------------
// 2. AUTHENTICATION ENDPOINTS
// ----------------------------------------------------------------------------
app.post('/api/auth/login', (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier?.trim() || !password) {
    res.status(400).json({ error: 'Email or membership number and password are required.' });
    return;
  }
  const member = db
    .prepare(
      `SELECT id, password_hash, activation_code_hash, membership_status FROM members WHERE LOWER(email) = LOWER(?) OR UPPER(membership_number) = UPPER(?)`
    )
    .get(identifier.trim(), identifier.trim()) as
    | { id: string; password_hash: string | null; activation_code_hash: string | null; membership_status: string }
    | undefined;

  if (member && !member.password_hash && member.activation_code_hash) {
    res.status(403).json({
      error: 'Your membership account has been approved! Use "Activate Account / Set Password" with your one-time activation code first.',
    });
    return;
  }

  if (!member || !verifyPassword(password, member.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials.' });
    return;
  }
  if (member.membership_status === 'Suspended' || member.membership_status === 'Deceased') {
    res.status(403).json({ error: `Account is currently ${member.membership_status}. Contact the Secretariat.` });
    return;
  }

  const token = signSessionToken({ memberId: member.id, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const cookieFlags = isHttps ? 'SameSite=None; Secure; HttpOnly' : 'SameSite=Lax; HttpOnly';
  res.setHeader('Set-Cookie', `lasupadora_session=${encodeURIComponent(token)}; Path=/; ${cookieFlags}; Max-Age=${7 * 24 * 60 * 60}`);
  recordAudit(member.id, 'AUTH_LOGIN', 'members', member.id);
  const user = loadAuthContext(member.id);
  res.json({ success: true, token, user });
});

app.post('/api/auth/activate', (req, res) => {
  const { identifier, activation_code, new_password, confirm_password } = req.body as {
    identifier?: string;
    activation_code?: string;
    new_password?: string;
    confirm_password?: string;
  };
  if (!identifier?.trim() || !activation_code?.trim() || !new_password) {
    res.status(400).json({ error: 'Email or Membership ID, activation code, and new password are required.' });
    return;
  }
  if (new_password.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    return;
  }
  if (confirm_password !== undefined && new_password !== confirm_password) {
    res.status(400).json({ error: 'New password and confirmation password do not match.' });
    return;
  }

  const member = db
    .prepare(
      `SELECT id, membership_status, activation_code_hash, activation_expires_at
       FROM members
       WHERE LOWER(email) = LOWER(?) OR UPPER(membership_number) = UPPER(?)`
    )
    .get(identifier.trim(), identifier.trim()) as
    | {
        id: string;
        membership_status: string;
        activation_code_hash: string | null;
        activation_expires_at: string | null;
      }
    | undefined;

  if (!member || !member.activation_code_hash) {
    res.status(400).json({ error: 'Invalid identifier or no active activation code is on file for this account.' });
    return;
  }
  if (member.membership_status === 'Suspended' || member.membership_status === 'Deceased') {
    res.status(403).json({ error: `Account is currently ${member.membership_status}. Contact the Secretariat.` });
    return;
  }
  if (member.activation_expires_at && new Date(member.activation_expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) {
    res.status(400).json({ error: 'This activation code has expired. Request a new activation code from your Branch Administrator.' });
    return;
  }
  if (!verifyPassword(activation_code.trim().toUpperCase(), member.activation_code_hash)) {
    res.status(401).json({ error: 'Incorrect activation code. Please check the code provided by your officer.' });
    return;
  }

  db.prepare(
    `UPDATE members
     SET password_hash = ?, activation_code_hash = NULL, activation_expires_at = NULL, must_change_password = 0, updated_at = datetime('now')
     WHERE id = ?`
  ).run(hashPassword(new_password), member.id);

  recordAudit(member.id, 'AUTH_ACCOUNT_ACTIVATED', 'members', member.id);
  const token = signSessionToken({ memberId: member.id, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const cookieFlags = isHttps ? 'SameSite=None; Secure; HttpOnly' : 'SameSite=Lax; HttpOnly';
  res.setHeader('Set-Cookie', `lasupadora_session=${encodeURIComponent(token)}; Path=/; ${cookieFlags}; Max-Age=${7 * 24 * 60 * 60}`);
  const user = loadAuthContext(member.id);
  res.json({ success: true, token, user });
});

app.post('/api/auth/logout', (req: AuthedRequest, res) => {
  if (req.auth) recordAudit(req.auth.memberId, 'AUTH_LOGOUT', 'members', req.auth.memberId);
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const cookieFlags = isHttps ? 'SameSite=None; Secure; HttpOnly' : 'SameSite=Lax; HttpOnly';
  res.setHeader('Set-Cookie', `lasupadora_session=; Path=/; ${cookieFlags}; Max-Age=0`);
  res.json({ success: true });
});

app.get('/api/auth/session', (req: AuthedRequest, res) => {
  if (!req.auth) {
    res.json({ authenticated: false, user: null });
    return;
  }
  const unreadCount = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM notifications WHERE member_id = ? AND is_read = 0`).get(req.auth.memberId) as { cnt: number }
  ).cnt;
  res.json({ authenticated: true, user: req.auth, unreadNotifications: unreadCount });
});

// ----------------------------------------------------------------------------
// 3. SECURE FILE UPLOAD ENDPOINT (Public vs Private Buckets)
// ----------------------------------------------------------------------------
app.post('/api/uploads', async (req: AuthedRequest, res) => {
  try {
    const { filename, mimeType, dataBase64, visibility } = req.body as {
      filename: string;
      mimeType: string;
      dataBase64: string;
      visibility: 'public' | 'private';
    };

    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
    if (!allowedMimes.includes(mimeType)) {
      res.status(400).json({ error: 'Unsupported file type. Allowed: PNG, JPEG, WEBP, PDF.' });
      return;
    }

    const base64Body = dataBase64.includes(',') ? dataBase64.split(',')[1] : dataBase64;
    const buffer = Buffer.from(base64Body, 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      res.status(400).json({ error: 'File exceeds 5MB limit.' });
      return;
    }

    const safeExt = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
    const cleanBase = path.basename(filename || 'upload', path.extname(filename || '')).replace(/[^a-zA-Z0-9_-]/g, '_');
    const outName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${cleanBase}${safeExt}`;

    const isPublic =
      visibility === 'public' &&
      Boolean(
        req.auth?.permissions.gallery?.create ||
          req.auth?.permissions.gallery?.edit ||
          req.auth?.permissions.publications?.create ||
          req.auth?.permissions.publications?.edit ||
          req.auth?.permissions.events?.create ||
          req.auth?.permissions.events?.edit ||
          req.auth?.permissions.leadership?.create ||
          req.auth?.permissions.leadership?.edit ||
          req.auth?.permissions.membership?.edit
      );
    const targetDir = isPublic ? uploadsPublicDir : uploadsPrivateDir;
    fs.writeFileSync(path.join(targetDir, outName), buffer);

    const localUrl = isPublic ? `/uploads/public/${outName}` : `/uploads/private/${outName}`;
    const sbUpload = await syncUploadToSupabaseStorage({
      buffer,
      objectName: outName,
      mimeType,
      isPublic,
    });
    const url = isPublic && sbUpload?.publicUrl ? sbUpload.publicUrl : localUrl;
    res.status(201).json({
      url,
      localUrl,
      storagePath: sbUpload?.path || null,
      supabaseSynced: Boolean(sbUpload),
      bucket: isPublic ? 'public' : 'private',
      sizeBytes: buffer.length,
      mimeType,
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ----------------------------------------------------------------------------
// 4. SECURE MEMBER PORTAL (Self-Scoped Only)
// ----------------------------------------------------------------------------
app.get('/api/member/portal', requireAuth, (req: AuthedRequest, res) => {
  const mId = req.auth!.memberId;
  const profile = db
    .prepare(
      `SELECT m.id, m.membership_number, m.qr_token, m.full_name, m.date_of_birth, m.gender, m.telephone, m.email,
              m.residential_address, m.photo_url, m.branch_id, m.subdivision_id, m.category_id, m.membership_status,
              m.previous_experience, m.emergency_contact_name, m.emergency_contact_phone, m.registration_date, m.card_valid_until,
              b.name AS branch_name, s.name AS subdivision_name, c.name AS category_name, c.annual_dues_ghs
       FROM members m
       JOIN branches b ON b.id = m.branch_id
       JOIN subdivisions s ON s.id = m.subdivision_id
       JOIN membership_categories c ON c.id = m.category_id
       WHERE m.id = ?`
    )
    .get(mId) as Record<string, unknown>;

  const payments = db
    .prepare(`SELECT * FROM financial_payments WHERE member_id = ? ORDER BY payment_date DESC, created_at DESC`)
    .all(mId);

  const verifiedPaid = (
    db
      .prepare(`SELECT COALESCE(SUM(amount_ghs), 0) AS total FROM financial_payments WHERE member_id = ? AND payment_category = 'Dues' AND verification_status = 'Verified'`)
      .get(mId) as { total: number }
  ).total;
  const annualDues = Number(profile.annual_dues_ghs || 0);
  const outstandingBalanceGhs = Math.max(0, annualDues - verifiedPaid);

  const registrations = db
    .prepare(
      `SELECT er.*, e.title, e.event_date, e.venue, e.status AS event_status
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.member_id = ?
       ORDER BY e.event_date DESC`
    )
    .all(mId);

  const inquiries = db
    .prepare(`SELECT * FROM member_feedback_and_inquiries WHERE member_id = ? ORDER BY created_at DESC`)
    .all(mId);

  const notifications = db
    .prepare(`SELECT * FROM notifications WHERE member_id = ? ORDER BY created_at DESC LIMIT 30`)
    .all(mId);

  const changeRequests = db
    .prepare(`SELECT * FROM profile_change_requests WHERE member_id = ? ORDER BY requested_at DESC`)
    .all(mId);

  res.json({
    profile,
    payments,
    duesSummary: { annualDuesGhs: annualDues, verifiedPaidGhs: verifiedPaid, outstandingBalanceGhs },
    registrations,
    inquiries,
    notifications,
    changeRequests,
  });
});

app.post('/api/member/profile-change', requireAuth, (req: AuthedRequest, res) => {
  const mId = req.auth!.memberId;
  const { telephone, residential_address, emergency_contact_name, emergency_contact_phone, requested_official_note } = req.body;

  // Immediate safe self-service contact updates, while official changes go to admin approval queue
  db.exec('BEGIN');
  db.prepare(
    `UPDATE members SET telephone = COALESCE(?, telephone), residential_address = COALESCE(?, residential_address),
     emergency_contact_name = COALESCE(?, emergency_contact_name), emergency_contact_phone = COALESCE(?, emergency_contact_phone),
     updated_at = datetime('now') WHERE id = ?`
  ).run(telephone || null, residential_address || null, emergency_contact_name || null, emergency_contact_phone || null, mId);

  if (requested_official_note?.trim()) {
    db.prepare(`INSERT INTO profile_change_requests (id, member_id, requested_changes, status) VALUES (?, ?, ?, 'Pending')`).run(
      uid(),
      mId,
      JSON.stringify({ note: requested_official_note.trim() })
    );
  }
  recordAudit(mId, 'MEMBER_SELF_PROFILE_UPDATE', 'members', mId);
  db.exec('COMMIT');
  void syncMemberToSupabase(mId);
  res.json({ success: true });
});

app.post('/api/member/events/:eventId/register', requireAuth, (req: AuthedRequest, res) => {
  const evt = db.prepare(`SELECT id, registration_open, status FROM events WHERE id = ?`).get(req.params.eventId) as
    | { id: string; registration_open: number; status: string }
    | undefined;
  if (!evt || !evt.registration_open || evt.status !== 'Upcoming') {
    res.status(400).json({ error: 'Registration is closed for this event.' });
    return;
  }
  try {
    db.prepare(`INSERT INTO event_registrations (id, event_id, member_id, attendance_status) VALUES (?, ?, ?, 'Registered')`).run(
      uid(),
      evt.id,
      req.auth!.memberId
    );
    void syncEventAttendanceToSupabase(evt.id, req.auth!.memberId, 'Registered');
    res.status(201).json({ success: true });
  } catch {
    res.status(409).json({ error: 'You are already registered for this event.' });
  }
});

app.post('/api/member/payments/submit', requireAuth, (req: AuthedRequest, res) => {
  const { amount_ghs, payment_category, payment_method, reference_number, notes } = req.body;
  const amount = Number(amount_ghs);
  if (!amount || amount <= 0 || !reference_number?.trim()) {
    res.status(400).json({ error: 'Valid GHS amount and transaction reference number are required.' });
    return;
  }
  const receipt = `CLM-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const id = uid();
  // Never mark as Verified solely from a member-submitted reference!
  db.prepare(
    `INSERT INTO financial_payments (id, receipt_number, member_id, branch_id, payment_category, amount_ghs, payment_method, reference_number, verification_status, recording_officer_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending Verification', ?, ?)`
  ).run(
    id,
    receipt,
    req.auth!.memberId,
    req.auth!.branchId,
    payment_category || 'Dues',
    amount,
    payment_method || 'Mobile Money',
    reference_number.trim(),
    req.auth!.memberId,
    notes?.trim() || 'Submitted via Member Portal awaiting Treasurer verification'
  );
  recordAudit(req.auth!.memberId, 'PAYMENT_CLAIM_SUBMITTED', 'financial_payments', id, { amount_ghs: amount, reference_number });
  void syncPaymentToSupabase(id);
  res.status(201).json({ id, receipt_number: receipt, verification_status: 'Pending Verification' });
});

app.post('/api/member/inquiries', requireAuth, (req: AuthedRequest, res) => {
  const { submission_type, subject, message } = req.body;
  if (!subject?.trim() || !message?.trim()) {
    res.status(400).json({ error: 'Subject and message are required.' });
    return;
  }
  const allowedTypes = ['Inquiry', 'Suggestion', 'Constructive Criticism'];
  const type = allowedTypes.includes(submission_type) ? submission_type : 'Inquiry';
  const id = uid();
  db.prepare(
    `INSERT INTO member_feedback_and_inquiries (id, member_id, sender_name, sender_email, submission_type, subject, message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Received')`
  ).run(id, req.auth!.memberId, req.auth!.fullName, req.auth!.email, type, subject.trim(), message.trim());
  void syncInquiryToSupabase(id);
  res.status(201).json({ id });
});

app.post('/api/member/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND member_id = ?`).run(req.params.id, req.auth!.memberId);
  res.json({ success: true });
});

app.post('/api/member/change-password', requireAuth, (req: AuthedRequest, res) => {
  const { current_password, new_password, confirm_password } = req.body as {
    current_password?: string;
    new_password?: string;
    confirm_password?: string;
  };
  if (!current_password || !new_password) {
    res.status(400).json({ error: 'Current password and new password are required.' });
    return;
  }
  if (new_password.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters long.' });
    return;
  }
  if (confirm_password !== undefined && new_password !== confirm_password) {
    res.status(400).json({ error: 'New password and confirmation password do not match.' });
    return;
  }
  const member = db.prepare(`SELECT password_hash FROM members WHERE id = ?`).get(req.auth!.memberId) as
    | { password_hash: string | null }
    | undefined;
  if (!member || !verifyPassword(current_password, member.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }
  db.prepare(`UPDATE members SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?`).run(
    hashPassword(new_password),
    req.auth!.memberId
  );
  recordAudit(req.auth!.memberId, 'MEMBER_PASSWORD_CHANGED', 'members', req.auth!.memberId);
  res.json({ success: true, message: 'Your portal password has been updated.' });
});

// ----------------------------------------------------------------------------
// 5. ADMIN OVERVIEW & SUPABASE CONFIG STATUS
// ----------------------------------------------------------------------------
app.get('/api/admin/overview', requireAuth, (req: AuthedRequest, res) => {
  void ensureSupabaseSeeded();
  const totalMembers = (db.prepare(`SELECT COUNT(*) AS c FROM members`).get() as { c: number }).c;
  const activeMembers = (db.prepare(`SELECT COUNT(*) AS c FROM members WHERE membership_status = 'Active'`).get() as { c: number }).c;
  const pendingApps = (db.prepare(`SELECT COUNT(*) AS c FROM membership_applications WHERE status IN ('Pending Review', 'Corrections Requested')`).get() as { c: number }).c;
  const verifiedIncomeGhs = (db.prepare(`SELECT COALESCE(SUM(amount_ghs), 0) AS s FROM financial_payments WHERE verification_status = 'Verified'`).get() as { s: number }).s;
  const totalExpenditureGhs = (db.prepare(`SELECT COALESCE(SUM(amount_ghs), 0) AS s FROM expenditures WHERE status IN ('Approved', 'Disbursed', 'Accounted')`).get() as { s: number }).s;
  const upcomingEvents = (db.prepare(`SELECT COUNT(*) AS c FROM events WHERE status = 'Upcoming'`).get() as { c: number }).c;
  const openProposals = (db.prepare(`SELECT COUNT(*) AS c FROM governance_proposals WHERE status IN ('Submitted', 'Under Review', 'Voting Open')`).get() as { c: number }).c;
  const pendingPayments = (db.prepare(`SELECT COUNT(*) AS c FROM financial_payments WHERE verification_status = 'Pending Verification'`).get() as { c: number }).c;

  const recentAudit = db
    .prepare(
      `SELECT a.*, m.full_name AS actor_name
       FROM audit_logs a
       LEFT JOIN members m ON m.id = a.actor_member_id
       ORDER BY a.created_at DESC LIMIT 12`
    )
    .all();

  const sbCfg = getSupabaseConfig();
  res.json({
    metrics: {
      totalMembers,
      activeMembers,
      pendingApps,
      verifiedIncomeGhs,
      totalExpenditureGhs,
      upcomingEvents,
      openProposals,
      pendingPayments,
    },
    recentAudit,
    backendStatus: {
      supabaseConfigured: sbCfg.isConfigured,
      supabaseAdminActive: sbCfg.hasAdminKey,
      engine: sbCfg.hasAdminKey
        ? 'Supabase PostgreSQL (Server-Side Admin Sync Active)'
        : sbCfg.isConfigured
          ? 'Supabase PostgreSQL + Local Sync'
          : 'Embedded Relational SQL (PostgreSQL-Aligned Schema)',
    },
  });
});

// ----------------------------------------------------------------------------
// 6. MEMBERSHIP MANAGEMENT (Scoped by Branch / Subdivision)
// ----------------------------------------------------------------------------
app.get('/api/admin/members', requirePermission('membership', 'view'), (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT m.id, m.membership_number, m.qr_token, m.full_name, m.date_of_birth, m.gender, m.telephone, m.email,
              m.residential_address, m.photo_url, m.branch_id, m.subdivision_id, m.category_id, m.membership_status,
              m.previous_experience, m.emergency_contact_name, m.emergency_contact_phone, m.registration_date, m.card_valid_until,
              b.name AS branch_name, s.name AS subdivision_name, c.name AS category_name, c.annual_dues_ghs,
              COALESCE((SELECT SUM(fp.amount_ghs) FROM financial_payments fp WHERE fp.member_id = m.id AND fp.payment_category = 'Dues' AND fp.verification_status = 'Verified'), 0) AS dues_paid_ghs
       FROM members m
       JOIN branches b ON b.id = m.branch_id
       JOIN subdivisions s ON s.id = m.subdivision_id
       JOIN membership_categories c ON c.id = m.category_id
       ORDER BY m.membership_number ASC`
    )
    .all() as { branch_id: string; subdivision_id: string }[];

  const scoped = rows.filter((r) => canAccessScope(req.auth!, r.branch_id, r.subdivision_id));
  const transfers = db
    .prepare(
      `SELECT t.*, m.full_name, m.membership_number, bf.name AS from_branch, bt.name AS to_branch, sf.name AS from_subdivision, st.name AS to_subdivision, a.full_name AS approved_by_name
       FROM member_transfers t
       JOIN members m ON m.id = t.member_id
       JOIN branches bf ON bf.id = t.from_branch_id
       JOIN branches bt ON bt.id = t.to_branch_id
       JOIN subdivisions sf ON sf.id = t.from_subdivision_id
       JOIN subdivisions st ON st.id = t.to_subdivision_id
       JOIN members a ON a.id = t.approved_by
       ORDER BY t.transferred_at DESC`
    )
    .all();
  const profileRequests = db
    .prepare(
      `SELECT p.*, m.full_name, m.membership_number FROM profile_change_requests p JOIN members m ON m.id = p.member_id ORDER BY p.requested_at DESC`
    )
    .all();

  res.json({ members: scoped, transfers, profileRequests });
});

app.patch('/api/admin/members/:id', requirePermission('membership', 'edit'), (req: AuthedRequest, res) => {
  const existing = db.prepare(`SELECT * FROM members WHERE id = ?`).get(req.params.id) as
    | {
        id: string;
        branch_id: string;
        subdivision_id: string;
        membership_number: string;
        full_name: string;
        email: string | null;
        telephone: string;
        membership_status: string;
      }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Member not found.' });
    return;
  }
  if (!canAccessScope(req.auth!, existing.branch_id, existing.subdivision_id)) {
    res.status(403).json({ error: 'Forbidden: Member is outside your authorized branch/subdivision scope.' });
    return;
  }

  const {
    full_name,
    membership_number,
    email,
    telephone,
    residential_address,
    date_of_birth,
    gender,
    category_id,
    membership_status,
    card_valid_until,
    emergency_contact_name,
    emergency_contact_phone,
    previous_experience,
    photo_url,
  } = req.body as Record<string, string | null | undefined>;

  const nextFullName = full_name !== undefined ? String(full_name || '').trim() : existing.full_name;
  if (!nextFullName) {
    res.status(400).json({ error: 'Member full name cannot be empty.' });
    return;
  }

  let nextMembershipNumber = existing.membership_number;
  if (membership_number !== undefined) {
    const check = normalizeMembershipId(String(membership_number || ''), existing.branch_id, existing.subdivision_id);
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }
    nextMembershipNumber = check.value;
  }

  if (nextMembershipNumber !== existing.membership_number) {
    const dupId = db
      .prepare(`SELECT id FROM members WHERE UPPER(membership_number) = UPPER(?) AND id != ?`)
      .get(nextMembershipNumber, req.params.id);
    if (dupId) {
      res.status(409).json({ error: `Membership ID "${nextMembershipNumber}" is already assigned to another member.` });
      return;
    }
  }

  const normalizedEmail = email !== undefined ? (email?.trim() ? email.trim() : null) : existing.email;
  if (normalizedEmail && normalizedEmail.toLowerCase() !== (existing.email || '').toLowerCase()) {
    const dupEmail = db
      .prepare(`SELECT id FROM members WHERE LOWER(email) = LOWER(?) AND id != ?`)
      .get(normalizedEmail, req.params.id);
    if (dupEmail) {
      res.status(409).json({ error: `Email "${normalizedEmail}" is already registered to another member.` });
      return;
    }
  }

  const nextTelephone = telephone !== undefined ? String(telephone || '').trim() : existing.telephone;
  if (!nextTelephone) {
    res.status(400).json({ error: 'Telephone number cannot be empty.' });
    return;
  }

  db.prepare(
    `UPDATE members SET
      full_name = ?,
      membership_number = ?,
      email = ?,
      telephone = ?,
      residential_address = CASE WHEN ? = 1 THEN ? ELSE residential_address END,
      date_of_birth = CASE WHEN ? = 1 THEN ? ELSE date_of_birth END,
      gender = CASE WHEN ? = 1 THEN ? ELSE gender END,
      category_id = COALESCE(?, category_id),
      membership_status = COALESCE(?, membership_status),
      card_valid_until = CASE WHEN ? = 1 THEN ? ELSE card_valid_until END,
      emergency_contact_name = CASE WHEN ? = 1 THEN ? ELSE emergency_contact_name END,
      emergency_contact_phone = CASE WHEN ? = 1 THEN ? ELSE emergency_contact_phone END,
      previous_experience = CASE WHEN ? = 1 THEN ? ELSE previous_experience END,
      photo_url = CASE WHEN ? = 1 THEN ? ELSE photo_url END,
      updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    nextFullName,
    nextMembershipNumber,
    normalizedEmail,
    nextTelephone,
    residential_address !== undefined ? 1 : 0,
    residential_address?.trim() || null,
    date_of_birth !== undefined ? 1 : 0,
    date_of_birth?.trim() || null,
    gender !== undefined ? 1 : 0,
    gender?.trim() || null,
    category_id || null,
    membership_status || null,
    card_valid_until !== undefined ? 1 : 0,
    card_valid_until?.trim() || null,
    emergency_contact_name !== undefined ? 1 : 0,
    emergency_contact_name?.trim() || null,
    emergency_contact_phone !== undefined ? 1 : 0,
    emergency_contact_phone?.trim() || null,
    previous_experience !== undefined ? 1 : 0,
    previous_experience?.trim() || null,
    photo_url !== undefined ? 1 : 0,
    photo_url?.trim() || null,
    req.params.id
  );

  recordAudit(req.auth!.memberId, 'MEMBER_UPDATED', 'members', req.params.id, {
    previous_membership_number: existing.membership_number,
    membership_number: nextMembershipNumber,
    full_name: nextFullName,
    membership_status: membership_status || existing.membership_status,
  });
  void syncMemberToSupabase(req.params.id, existing.membership_number);
  res.json({ success: true });
});

app.post('/api/admin/members/:id/activation-code', requirePermission('membership', 'edit'), (req: AuthedRequest, res) => {
  const existing = db
    .prepare(`SELECT id, full_name, membership_number, branch_id, subdivision_id, membership_status FROM members WHERE id = ?`)
    .get(req.params.id) as
    | {
        id: string;
        full_name: string;
        membership_number: string;
        branch_id: string;
        subdivision_id: string;
        membership_status: string;
      }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Member not found.' });
    return;
  }
  if (!canAccessScope(req.auth!, existing.branch_id, existing.subdivision_id)) {
    res.status(403).json({ error: 'Member is outside your branch/subdivision authorization scope.' });
    return;
  }
  if (existing.membership_status === 'Suspended' || existing.membership_status === 'Deceased') {
    res.status(400).json({ error: `Cannot issue activation code for a ${existing.membership_status} member.` });
    return;
  }

  const activationCode = generateActivationCode();
  db.prepare(
    `UPDATE members
     SET activation_code_hash = ?, activation_expires_at = datetime('now', '+30 days'), must_change_password = 1, updated_at = datetime('now')
     WHERE id = ?`
  ).run(hashPassword(activationCode), existing.id);

  recordAudit(req.auth!.memberId, 'MEMBER_ACTIVATION_CODE_ISSUED', 'members', existing.id, {
    membership_number: existing.membership_number,
  });

  res.json({
    success: true,
    member_id: existing.id,
    full_name: existing.full_name,
    membership_number: existing.membership_number,
    activation_code: activationCode,
    expires_in_days: 30,
  });
});

app.post('/api/admin/members/:id/transfer', requirePermission('membership', 'edit'), (req: AuthedRequest, res) => {
  const { to_branch_id, to_subdivision_id, reason } = req.body;
  if (!to_branch_id || !to_subdivision_id || !reason?.trim()) {
    res.status(400).json({ error: 'Destination branch, subdivision, and transfer reason are required.' });
    return;
  }
  const existing = db.prepare(`SELECT * FROM members WHERE id = ?`).get(req.params.id) as { branch_id: string; subdivision_id: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Member not found.' });
    return;
  }
  if (!canAccessScope(req.auth!, existing.branch_id, existing.subdivision_id)) {
    res.status(403).json({ error: 'Forbidden: Member is outside your authorized scope.' });
    return;
  }
  db.exec('BEGIN');
  db.prepare(
    `INSERT INTO member_transfers (id, member_id, from_branch_id, from_subdivision_id, to_branch_id, to_subdivision_id, reason, approved_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(uid(), req.params.id, existing.branch_id, existing.subdivision_id, to_branch_id, to_subdivision_id, reason.trim(), req.auth!.memberId);

  db.prepare(`UPDATE members SET branch_id = ?, subdivision_id = ?, updated_at = datetime('now') WHERE id = ?`).run(
    to_branch_id,
    to_subdivision_id,
    req.params.id
  );
  recordAudit(req.auth!.memberId, 'MEMBER_TRANSFERRED', 'member_transfers', req.params.id, { to_branch_id, to_subdivision_id, reason });
  db.exec('COMMIT');
  void syncMemberTransferToSupabase({
    localMemberId: req.params.id,
    fromBranchId: existing.branch_id,
    fromSubdivisionId: existing.subdivision_id,
    toBranchId: to_branch_id,
    toSubdivisionId: to_subdivision_id,
    reason: reason.trim(),
    approvedByLocalId: req.auth!.memberId,
  });
  res.json({ success: true });
});

app.patch('/api/admin/profile-requests/:id', requirePermission('membership', 'approve'), (req: AuthedRequest, res) => {
  const { status, review_notes } = req.body;
  db.prepare(`UPDATE profile_change_requests SET status = ?, reviewed_by = ?, review_notes = ?, reviewed_at = datetime('now') WHERE id = ?`).run(
    status,
    req.auth!.memberId,
    review_notes || null,
    req.params.id
  );
  res.json({ success: true });
});

// ----------------------------------------------------------------------------
// 7. MEMBERSHIP APPLICATIONS & ATOMIC APPROVAL
// ----------------------------------------------------------------------------
app.get('/api/admin/applications', requirePermission('applications', 'view'), (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT a.*, b.name AS branch_name, s.name AS subdivision_name, c.name AS category_name, o.full_name AS reviewing_officer_name
       FROM membership_applications a
       JOIN branches b ON b.id = a.preferred_branch_id
       JOIN subdivisions s ON s.id = a.preferred_subdivision_id
       JOIN membership_categories c ON c.id = a.requested_category_id
       LEFT JOIN members o ON o.id = a.reviewing_officer_id
       ORDER BY a.submitted_at DESC`
    )
    .all() as { preferred_branch_id: string; preferred_subdivision_id: string; id: string }[];

  const scoped = rows.filter((r) => canAccessScope(req.auth!, r.preferred_branch_id, r.preferred_subdivision_id));
  const history = db
    .prepare(
      `SELECT h.*, m.full_name AS actor_name FROM application_decision_history h LEFT JOIN members m ON m.id = h.actor_member_id ORDER BY h.decided_at DESC`
    )
    .all();
  res.json({ applications: scoped, history });
});

// Officer-assisted registration (subject to same validation & approval workflow)
app.post('/api/admin/applications/officer-assisted', requirePermission('applications', 'create'), (req: AuthedRequest, res) => {
  const {
    full_name,
    date_of_birth,
    gender,
    telephone,
    email,
    residential_address,
    preferred_branch_id,
    preferred_subdivision_id,
    requested_category_id,
    previous_experience,
    emergency_contact_name,
    emergency_contact_phone,
  } = req.body;

  if (!full_name?.trim() || !telephone?.trim() || !preferred_branch_id || !preferred_subdivision_id || !requested_category_id) {
    res.status(400).json({ error: 'All mandatory applicant fields are required.' });
    return;
  }
  if (!canAccessScope(req.auth!, preferred_branch_id, preferred_subdivision_id)) {
    res.status(403).json({ error: 'Cannot create officer-assisted registration outside your branch/subdivision scope.' });
    return;
  }

  const id = uid();
  const ref = `APP-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  db.exec('BEGIN');
  db.prepare(
    `INSERT INTO membership_applications (
      id, application_ref, source, created_by_officer_id, full_name, date_of_birth, gender, telephone, email, residential_address,
      preferred_branch_id, preferred_subdivision_id, requested_category_id, previous_experience, emergency_contact_name, emergency_contact_phone,
      declaration_accepted, privacy_consent_accepted, status
    ) VALUES (?, ?, 'officer_assisted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'Pending Review')`
  ).run(
    id,
    ref,
    req.auth!.memberId,
    full_name.trim(),
    date_of_birth || null,
    gender || null,
    telephone.trim(),
    email?.trim() || null,
    residential_address?.trim() || null,
    preferred_branch_id,
    preferred_subdivision_id,
    requested_category_id,
    previous_experience || null,
    emergency_contact_name || null,
    emergency_contact_phone || null
  );
  db.prepare(
    `INSERT INTO application_decision_history (id, application_id, previous_status, new_status, actor_member_id, notes) VALUES (?, ?, NULL, 'Pending Review', ?, 'Officer-assisted application submitted for standard approval review')`
  ).run(uid(), id, req.auth!.memberId);
  db.exec('COMMIT');
  void syncApplicationToSupabase(id);

  res.status(201).json({ id, application_ref: ref, status: 'Pending Review' });
});

app.post('/api/admin/applications/:id/decision', requirePermission('applications', 'approve'), (req: AuthedRequest, res) => {
  const { decision, comments, branch_id, subdivision_id, category_id, membership_number } = req.body as {
    decision: 'Pending Review' | 'Corrections Requested' | 'Approved' | 'Rejected';
    comments?: string;
    branch_id?: string;
    subdivision_id?: string;
    category_id?: string;
    membership_number?: string;
  };

  const appRow = db.prepare(`SELECT * FROM membership_applications WHERE id = ?`).get(req.params.id) as Record<string, string | null> | undefined;
  if (!appRow) {
    res.status(404).json({ error: 'Application not found.' });
    return;
  }
  if (!canAccessScope(req.auth!, appRow.preferred_branch_id as string, appRow.preferred_subdivision_id as string)) {
    res.status(403).json({ error: 'Application is outside your authorized branch scope.' });
    return;
  }
  if (appRow.status === 'Approved') {
    res.status(400).json({ error: 'This application has already been approved.' });
    return;
  }

  const targetBranchId = branch_id || (appRow.preferred_branch_id as string);
  const targetSubId = subdivision_id || (appRow.preferred_subdivision_id as string);
  const targetCatId = category_id || (appRow.requested_category_id as string);

  let customMembershipNumber: string | null = null;
  if (decision === 'Approved' && membership_number !== undefined && String(membership_number).trim() !== '') {
    const check = normalizeMembershipId(String(membership_number), targetBranchId, targetSubId);
    if (!check.valid) {
      res.status(400).json({ error: check.error });
      return;
    }
    const dupId = db.prepare(`SELECT id FROM members WHERE UPPER(membership_number) = UPPER(?)`).get(check.value);
    if (dupId) {
      res.status(409).json({ error: `Membership ID "${check.value}" is already assigned to another member.` });
      return;
    }
    customMembershipNumber = check.value;
  }

  try {
    db.exec('BEGIN');
    let createdMember: Record<string, unknown> | null = null;

    if (decision === 'Approved') {
      const membershipNumber = customMembershipNumber || generateNextUniqueLsmsId(targetBranchId, targetSubId);
      const qrToken = crypto.randomBytes(16).toString('hex');
      const memberId = uid();

      const applicantPasswordHash = appRow.password_hash || null;
      const activationCode = applicantPasswordHash ? null : generateActivationCode();
      const activationCodeHash = activationCode ? hashPassword(activationCode) : null;
      const activationExpiresAt = activationCode ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ') : null;

      db.prepare(
        `INSERT INTO members (
          id, membership_number, qr_token, full_name, date_of_birth, gender, telephone, email,
          password_hash, activation_code_hash, activation_expires_at, must_change_password,
          residential_address, photo_url, branch_id, subdivision_id, category_id, membership_status,
          previous_experience, emergency_contact_name, emergency_contact_phone, approved_by, approved_at, card_valid_until
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?, datetime('now'), '2027-12-31')`
      ).run(
        memberId,
        membershipNumber,
        qrToken,
        appRow.full_name,
        appRow.date_of_birth,
        appRow.gender,
        appRow.telephone,
        appRow.email || `${membershipNumber.toLowerCase()}@member.lasupadora.org`,
        applicantPasswordHash,
        activationCodeHash,
        activationExpiresAt,
        activationCode ? 1 : 0,
        appRow.residential_address,
        appRow.photo_url,
        targetBranchId,
        targetSubId,
        targetCatId,
        appRow.previous_experience,
        appRow.emergency_contact_name,
        appRow.emergency_contact_phone,
        req.auth!.memberId
      );

      const memberRole = db.prepare(`SELECT id FROM roles WHERE slug = 'member'`).get() as { id: string };
      db.prepare(`INSERT INTO member_roles (id, member_id, role_id, branch_id, subdivision_id) VALUES (?, ?, ?, ?, ?)`).run(
        uid(),
        memberId,
        memberRole.id,
        targetBranchId,
        targetSubId
      );

      db.prepare(
        `UPDATE membership_applications SET status = 'Approved', password_hash = NULL, reviewing_officer_id = ?, reviewed_at = datetime('now'), review_comments = ?, approved_member_id = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(req.auth!.memberId, comments || 'Approved and added to official register', memberId, req.params.id);

      createdMember = {
        id: memberId,
        membership_number: membershipNumber,
        password_set_by_applicant: Boolean(applicantPasswordHash),
        activation_code: activationCode,
      };
    } else {
      db.prepare(
        `UPDATE membership_applications SET status = ?, reviewing_officer_id = ?, reviewed_at = datetime('now'), review_comments = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(decision, req.auth!.memberId, comments || null, req.params.id);
    }

    db.prepare(
      `INSERT INTO application_decision_history (id, application_id, previous_status, new_status, actor_member_id, notes) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uid(), req.params.id, appRow.status as string, decision, req.auth!.memberId, comments || null);

    recordAudit(req.auth!.memberId, `APPLICATION_${decision.toUpperCase().replace(/\s+/g, '_')}`, 'membership_applications', req.params.id, {
      createdMember,
    });
    db.exec('COMMIT');
    if (createdMember?.id) {
      void syncMemberToSupabase(String(createdMember.id)).then(() => syncApplicationToSupabase(req.params.id));
    } else {
      void syncApplicationToSupabase(req.params.id);
    }
    res.json({ success: true, decision, createdMember });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    res.status(400).json({ error: (err as Error).message });
  }
});

// ----------------------------------------------------------------------------
// 8. BRANCHES & SUBDIVISIONS
// ----------------------------------------------------------------------------
app.get('/api/admin/branches', requirePermission('branches', 'view'), (_req, res) => {
  const branches = db
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM members m WHERE m.branch_id = b.id AND m.membership_status = 'Active') AS active_members
       FROM branches b ORDER BY b.branch_type, b.name`
    )
    .all();
  const subdivisions = db
    .prepare(
      `SELECT s.*, b.name AS branch_name, (SELECT COUNT(*) FROM members m WHERE m.subdivision_id = s.id AND m.membership_status = 'Active') AS active_members
       FROM subdivisions s JOIN branches b ON b.id = s.branch_id
       ORDER BY b.name, CAST(REPLACE(s.code, 'C', '') AS INTEGER), s.name`
    )
    .all();
  res.json({ branches, subdivisions });
});

app.post('/api/admin/branches', requirePermission('branches', 'approve'), (req: AuthedRequest, res) => {
  const { code, name, branch_type, region, description } = req.body;
  if (!code?.trim() || !name?.trim()) {
    res.status(400).json({ error: 'Branch code and name are required.' });
    return;
  }
  const id = uid();
  db.prepare(`INSERT INTO branches (id, code, name, branch_type, region, description) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id,
    code.trim().toUpperCase(),
    name.trim(),
    branch_type || 'other',
    region || 'Greater Accra',
    description || ''
  );
  recordAudit(req.auth!.memberId, 'BRANCH_CREATED', 'branches', id, { name });
  void syncBranchToSupabase(id);
  res.status(201).json({ id });
});

app.patch('/api/admin/branches/:id', requirePermission('branches', 'edit'), (req: AuthedRequest, res) => {
  const { name, region, description, is_active } = req.body;
  db.prepare(
    `UPDATE branches SET name = COALESCE(?, name), region = COALESCE(?, region), description = COALESCE(?, description), is_active = COALESCE(?, is_active), updated_at = datetime('now') WHERE id = ?`
  ).run(name || null, region || null, description ?? null, is_active === undefined ? null : is_active ? 1 : 0, req.params.id);
  void syncBranchToSupabase(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/subdivisions', requirePermission('branches', 'create'), (req: AuthedRequest, res) => {
  const { branch_id, code, name, subdivision_type, town_or_community, region } = req.body;
  if (!branch_id || !code?.trim() || !name?.trim()) {
    res.status(400).json({ error: 'Branch, code, and subdivision name are required.' });
    return;
  }
  const id = uid();
  db.prepare(
    `INSERT INTO subdivisions (id, branch_id, code, name, subdivision_type, town_or_community, region) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, branch_id, code.trim().toUpperCase(), name.trim(), subdivision_type || 'town', town_or_community || name.trim(), region || 'Greater Accra');
  recordAudit(req.auth!.memberId, 'SUBDIVISION_CREATED', 'subdivisions', id, { name });
  void syncSubdivisionToSupabase(id);
  res.status(201).json({ id });
});

app.patch('/api/admin/subdivisions/:id', requirePermission('branches', 'edit'), (req: AuthedRequest, res) => {
  const { name, town_or_community, region, is_active } = req.body;
  db.prepare(
    `UPDATE subdivisions SET name = COALESCE(?, name), town_or_community = COALESCE(?, town_or_community), region = COALESCE(?, region), is_active = COALESCE(?, is_active) WHERE id = ?`
  ).run(name || null, town_or_community || null, region || null, is_active === undefined ? null : is_active ? 1 : 0, req.params.id);
  void syncSubdivisionToSupabase(req.params.id);
  res.json({ success: true });
});

// ----------------------------------------------------------------------------
// 9. EXECUTIVE & LEADERSHIP MANAGEMENT
// ----------------------------------------------------------------------------
app.get('/api/admin/leadership', requirePermission('leadership', 'view'), (_req, res) => {
  const appointments = db
    .prepare(
      `SELECT l.*, m.full_name, m.membership_number, m.email, m.photo_url, b.name AS branch_name
       FROM leadership_appointments l
       JOIN members m ON m.id = l.member_id
       LEFT JOIN branches b ON b.id = l.branch_id
       ORDER BY CASE WHEN l.status IN ('Active', 'Acting') THEN 0 ELSE 1 END,
                CASE WHEN l.scope_type = 'national' THEN 0 ELSE 1 END,
                l.term_start DESC`
    )
    .all();
  res.json({ appointments });
});

app.post('/api/admin/leadership', requirePermission('leadership', 'create'), (req: AuthedRequest, res) => {
  const {
    member_id,
    portfolio,
    scope_type,
    branch_id,
    term_number,
    term_start,
    term_expiry,
    oath_signed,
    biography,
    is_public_approved,
    can_act_for_president,
    photo_url,
    replace_appointment_id,
  } = req.body;
  if (!member_id || !portfolio?.trim() || !term_start || !term_expiry) {
    res.status(400).json({ error: 'Member, portfolio, term start, and term expiry are required.' });
    return;
  }
  const policyRow = db.prepare(`SELECT value_json FROM governance_policies WHERE key = 'term_limits'`).get() as { value_json: string } | undefined;
  const rules = policyRow ? JSON.parse(policyRow.value_json) : { max_years_per_term: 2, max_consecutive_terms: 2, handover_days: 14 };
  if (Number(term_number || 1) > rules.max_consecutive_terms) {
    res.status(400).json({ error: `Term limit exceeded: Maximum ${rules.max_consecutive_terms} consecutive terms allowed.` });
    return;
  }

  const expiryDate = new Date(term_expiry);
  expiryDate.setDate(expiryDate.getDate() + Number(rules.handover_days || 14));
  const handoverDeadline = expiryDate.toISOString().slice(0, 10);

  const id = uid();
  db.exec('BEGIN');
  try {
    if (replace_appointment_id) {
      db.prepare(`UPDATE leadership_appointments SET status = 'Completed', is_public_approved = 0 WHERE id = ?`).run(replace_appointment_id);
    }
    if (photo_url) {
      db.prepare(`UPDATE members SET photo_url = ?, updated_at = datetime('now') WHERE id = ?`).run(photo_url, member_id);
    }
    db.prepare(
      `INSERT INTO leadership_appointments (id, member_id, portfolio, scope_type, branch_id, term_number, term_start, term_expiry, handover_deadline, oath_signed, oath_signed_at, biography, is_public_approved, can_act_for_president, appointed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      member_id,
      portfolio.trim(),
      scope_type || 'national',
      branch_id || null,
      Number(term_number || 1),
      term_start,
      term_expiry,
      handoverDeadline,
      oath_signed ? 1 : 0,
      oath_signed ? new Date().toISOString() : null,
      biography || '',
      is_public_approved ? 1 : 0,
      can_act_for_president ? 1 : 0,
      req.auth!.memberId
    );
    recordAudit(req.auth!.memberId, replace_appointment_id ? 'LEADERSHIP_REPLACED' : 'LEADERSHIP_APPOINTED', 'leadership_appointments', id, {
      portfolio,
      member_id,
      replace_appointment_id,
    });
    db.exec('COMMIT');
    void syncLeadershipToSupabase(id, replace_appointment_id);
    res.status(201).json({ id });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    res.status(400).json({ error: (err as Error).message });
  }
});

app.patch('/api/admin/leadership/:id', requirePermission('leadership', 'edit'), (req: AuthedRequest, res) => {
  const { member_id, portfolio, term_start, term_expiry, status, oath_signed, is_public_approved, can_act_for_president, biography, photo_url } = req.body;
  const existing = db.prepare(`SELECT member_id FROM leadership_appointments WHERE id = ?`).get(req.params.id) as { member_id: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Leadership appointment not found.' });
    return;
  }
  const targetMemberId = member_id || existing.member_id;

  db.exec('BEGIN');
  try {
    if (photo_url !== undefined) {
      db.prepare(`UPDATE members SET photo_url = ?, updated_at = datetime('now') WHERE id = ?`).run(photo_url || null, targetMemberId);
    }
    db.prepare(
      `UPDATE leadership_appointments SET
        member_id = COALESCE(?, member_id),
        portfolio = COALESCE(?, portfolio),
        term_start = COALESCE(?, term_start),
        term_expiry = COALESCE(?, term_expiry),
        status = COALESCE(?, status),
        oath_signed = COALESCE(?, oath_signed),
        is_public_approved = COALESCE(?, is_public_approved),
        can_act_for_president = COALESCE(?, can_act_for_president),
        biography = COALESCE(?, biography)
       WHERE id = ?`
    ).run(
      member_id || null,
      portfolio || null,
      term_start || null,
      term_expiry || null,
      status || null,
      oath_signed === undefined ? null : oath_signed ? 1 : 0,
      is_public_approved === undefined ? null : is_public_approved ? 1 : 0,
      can_act_for_president === undefined ? null : can_act_for_president ? 1 : 0,
      biography ?? null,
      req.params.id
    );
    recordAudit(req.auth!.memberId, 'LEADERSHIP_UPDATED', 'leadership_appointments', req.params.id, { photoUpdated: photo_url !== undefined, targetMemberId });
    db.exec('COMMIT');
    void syncLeadershipToSupabase(req.params.id);
    res.json({ success: true });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    res.status(400).json({ error: (err as Error).message });
  }
});

// ----------------------------------------------------------------------------
// 10. RBAC PERMISSION MATRIX & ROLE ASSIGNMENTS
// ----------------------------------------------------------------------------
app.get('/api/admin/rbac', requirePermission('rbac', 'view'), (_req, res) => {
  const roles = db.prepare(`SELECT * FROM roles ORDER BY is_constitutional_office DESC, display_name`).all();
  const permissions = db.prepare(`SELECT * FROM role_permissions`).all();
  const assignments = db
    .prepare(
      `SELECT mr.*, m.full_name, m.membership_number, m.email, r.display_name AS role_name, r.slug AS role_slug, b.name AS branch_name, s.name AS subdivision_name
       FROM member_roles mr
       JOIN members m ON m.id = mr.member_id
       JOIN roles r ON r.id = mr.role_id
       LEFT JOIN branches b ON b.id = mr.branch_id
       LEFT JOIN subdivisions s ON s.id = mr.subdivision_id
       ORDER BY mr.is_active DESC, m.full_name ASC`
    )
    .all();
  res.json({ roles, permissions, assignments });
});

app.patch('/api/admin/rbac/permission', requirePermission('rbac', 'manage'), (req: AuthedRequest, res) => {
  const { role_id, module, field, value } = req.body;
  const allowedFields = ['can_view', 'can_create', 'can_edit', 'can_approve', 'can_delete', 'can_export', 'can_manage'];
  if (!allowedFields.includes(field)) {
    res.status(400).json({ error: 'Invalid permission field.' });
    return;
  }
  db.prepare(`UPDATE role_permissions SET ${field} = ? WHERE role_id = ? AND module = ?`).run(value ? 1 : 0, role_id, module);
  recordAudit(req.auth!.memberId, 'RBAC_PERMISSION_UPDATED', 'role_permissions', role_id, { module, field, value });
  void syncRbacPermissionToSupabase(role_id, module, field, Boolean(value));
  res.json({ success: true });
});

app.post('/api/admin/rbac/assign', requirePermission('rbac', 'manage'), (req: AuthedRequest, res) => {
  const { member_id, role_id, branch_id, subdivision_id } = req.body;
  if (!member_id || !role_id) {
    res.status(400).json({ error: 'Member and role are required.' });
    return;
  }
  const existing = db
    .prepare(`SELECT id FROM member_roles WHERE member_id = ? AND role_id = ? LIMIT 1`)
    .get(member_id, role_id) as { id: string } | undefined;

  let assignmentId: string;
  if (existing) {
    assignmentId = existing.id;
    db.prepare(
      `UPDATE member_roles SET branch_id = ?, subdivision_id = ?, is_active = 1, assigned_at = datetime('now') WHERE id = ?`
    ).run(branch_id || null, subdivision_id || null, assignmentId);
  } else {
    assignmentId = uid();
    db.prepare(`INSERT INTO member_roles (id, member_id, role_id, branch_id, subdivision_id, is_active) VALUES (?, ?, ?, ?, ?, 1)`).run(
      assignmentId,
      member_id,
      role_id,
      branch_id || null,
      subdivision_id || null
    );
  }
  recordAudit(req.auth!.memberId, 'ROLE_ASSIGNED', 'member_roles', assignmentId, { member_id, role_id });
  void syncMemberRoleToSupabase(member_id, role_id, branch_id, subdivision_id, true);
  res.status(201).json({ id: assignmentId });
});

app.patch('/api/admin/rbac/assignments/:id', requirePermission('rbac', 'manage'), (req: AuthedRequest, res) => {
  const { is_active } = req.body as { is_active?: boolean };
  const row = db
    .prepare(
      `SELECT mr.id, mr.member_id, mr.role_id, mr.branch_id, mr.subdivision_id, r.slug AS role_slug
       FROM member_roles mr JOIN roles r ON r.id = mr.role_id
       WHERE mr.id = ?`
    )
    .get(req.params.id) as
    | { id: string; member_id: string; role_id: string; branch_id: string | null; subdivision_id: string | null; role_slug: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'Role assignment not found.' });
    return;
  }
  const nextActive = is_active ? 1 : 0;
  if (row.member_id === req.auth!.memberId && row.role_slug === 'super_admin' && nextActive === 0) {
    res.status(400).json({ error: 'You cannot revoke your own Super Administrator assignment.' });
    return;
  }
  db.prepare(`UPDATE member_roles SET is_active = ? WHERE id = ?`).run(nextActive, row.id);
  recordAudit(req.auth!.memberId, nextActive ? 'ROLE_ASSIGNMENT_ACTIVATED' : 'ROLE_ASSIGNMENT_REVOKED', 'member_roles', row.id, {
    member_id: row.member_id,
    role_id: row.role_id,
  });
  void syncMemberRoleToSupabase(row.member_id, row.role_id, row.branch_id, row.subdivision_id, Boolean(nextActive));
  res.json({ success: true, is_active: Boolean(nextActive) });
});

// ----------------------------------------------------------------------------
// 11. FINANCE & DUES MANAGEMENT (GHS + Constitutional Financial Gates)
// ----------------------------------------------------------------------------
app.get('/api/admin/finance', requirePermission('finance', 'view'), (req: AuthedRequest, res) => {
  const schedules = db
    .prepare(`SELECT ds.*, c.name AS category_name FROM dues_schedules ds JOIN membership_categories c ON c.id = ds.category_id ORDER BY ds.due_date DESC`)
    .all();
  const campaigns = db
    .prepare(
      `SELECT fc.*, COALESCE((SELECT SUM(fp.amount_ghs) FROM financial_payments fp WHERE fp.campaign_id = fc.id AND fp.verification_status = 'Verified'), 0) AS raised_ghs
       FROM fundraising_campaigns fc ORDER BY fc.start_date DESC`
    )
    .all();
  const payments = (
    db
      .prepare(
        `SELECT fp.*, m.full_name AS member_name, m.membership_number, b.name AS branch_name, r.full_name AS recording_officer_name, v.full_name AS verified_by_name
         FROM financial_payments fp
         LEFT JOIN members m ON m.id = fp.member_id
         LEFT JOIN branches b ON b.id = fp.branch_id
         LEFT JOIN members r ON r.id = fp.recording_officer_id
         LEFT JOIN members v ON v.id = fp.verified_by_id
         ORDER BY fp.payment_date DESC, fp.created_at DESC`
      )
      .all() as { branch_id: string | null }[]
  ).filter((p) => !p.branch_id || canAccessScope(req.auth!, p.branch_id, null));

  const budgets = (
    db
      .prepare(
        `SELECT b.*, e.title AS event_title, e.event_date, br.name AS branch_name, s.full_name AS submitted_by_name, a.full_name AS approved_by_name,
                COALESCE((SELECT SUM(ex.amount_ghs) FROM expenditures ex WHERE ex.budget_id = b.id AND ex.status <> 'Rejected'), 0) AS spent_ghs
         FROM budgets b
         LEFT JOIN events e ON e.id = b.event_id
         LEFT JOIN branches br ON br.id = b.branch_id
         JOIN members s ON s.id = b.submitted_by
         LEFT JOIN members a ON a.id = b.approved_by
         ORDER BY b.submitted_at DESC`
      )
      .all() as { branch_id: string | null }[]
  ).filter((b) => !b.branch_id || canAccessScope(req.auth!, b.branch_id, null));

  const expenditures = (
    db
      .prepare(
        `SELECT ex.*, bg.title AS budget_title, br.name AS branch_name, req.full_name AS requested_by_name, app.full_name AS approved_by_name
         FROM expenditures ex
         JOIN budgets bg ON bg.id = ex.budget_id
         LEFT JOIN branches br ON br.id = ex.branch_id
         JOIN members req ON req.id = ex.requested_by
         LEFT JOIN members app ON app.id = ex.approved_by
         ORDER BY ex.expense_date DESC, ex.created_at DESC`
      )
      .all() as { branch_id: string | null }[]
  ).filter((ex) => !ex.branch_id || canAccessScope(req.auth!, ex.branch_id, null));

  res.json({ schedules, campaigns, payments, budgets, expenditures });
});

app.post('/api/admin/finance/payments', requirePermission('finance', 'create'), (req: AuthedRequest, res) => {
  const { member_id, dues_schedule_id, campaign_id, branch_id, payment_category, amount_ghs, payment_date, payment_method, reference_number, notes } = req.body;
  const amount = Number(amount_ghs);
  if (!amount || amount <= 0 || !reference_number?.trim()) {
    res.status(400).json({ error: 'Valid GHS amount and reference number are required.' });
    return;
  }
  const id = uid();
  const receipt = `RCP-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  // Note: New payment entries start as Pending Verification until an approver verifies funds (never auto-marked Verified purely from a ref!)
  db.prepare(
    `INSERT INTO financial_payments (id, receipt_number, member_id, dues_schedule_id, campaign_id, branch_id, payment_category, amount_ghs, payment_date, payment_method, reference_number, verification_status, recording_officer_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Verification', ?, ?)`
  ).run(
    id,
    receipt,
    member_id || null,
    dues_schedule_id || null,
    campaign_id || null,
    branch_id || null,
    payment_category || 'Dues',
    amount,
    payment_date || new Date().toISOString().slice(0, 10),
    payment_method || 'Mobile Money',
    reference_number.trim(),
    req.auth!.memberId,
    notes || ''
  );
  recordAudit(req.auth!.memberId, 'PAYMENT_RECORDED', 'financial_payments', id, { amount, receipt });
  void syncPaymentToSupabase(id);
  res.status(201).json({ id, receipt_number: receipt });
});

app.patch('/api/admin/finance/payments/:id/verify', requirePermission('finance', 'approve'), (req: AuthedRequest, res) => {
  const { verification_status, notes } = req.body;
  if (!['Verified', 'Rejected'].includes(verification_status)) {
    res.status(400).json({ error: 'Verification status must be Verified or Rejected.' });
    return;
  }
  db.prepare(
    `UPDATE financial_payments SET verification_status = ?, verified_by_id = ?, verified_at = datetime('now'), notes = COALESCE(?, notes) WHERE id = ?`
  ).run(verification_status, req.auth!.memberId, notes || null, req.params.id);
  recordAudit(req.auth!.memberId, `PAYMENT_${verification_status.toUpperCase()}`, 'financial_payments', req.params.id);
  void syncPaymentToSupabase(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/finance/budgets', requirePermission('finance', 'create'), (req: AuthedRequest, res) => {
  const { title, event_id, branch_id, requested_amount_ghs, line_items } = req.body;
  const amount = Number(requested_amount_ghs);
  if (!title?.trim() || !amount || amount <= 0) {
    res.status(400).json({ error: 'Budget title and positive GHS amount are required.' });
    return;
  }
  let fourWeekCompliant = 1;
  if (event_id) {
    const evt = db.prepare(`SELECT event_date FROM events WHERE id = ?`).get(event_id) as { event_date: string } | undefined;
    if (evt) {
      const diffDays = (new Date(evt.event_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (diffDays < 28) fourWeekCompliant = 0;
    }
  }
  const id = uid();
  db.prepare(
    `INSERT INTO budgets (id, title, event_id, branch_id, requested_amount_ghs, line_items, submitted_by, four_week_rule_compliant, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Submitted')`
  ).run(id, title.trim(), event_id || null, branch_id || null, amount, JSON.stringify(line_items || []), req.auth!.memberId, fourWeekCompliant);

  recordAudit(req.auth!.memberId, 'BUDGET_SUBMITTED', 'budgets', id, { amount, fourWeekCompliant });
  void syncBudgetToSupabase(id);
  res.status(201).json({ id, four_week_rule_compliant: Boolean(fourWeekCompliant) });
});

app.patch('/api/admin/finance/budgets/:id/decision', requirePermission('finance', 'approve'), (req: AuthedRequest, res) => {
  const { status, approved_amount_ghs, review_notes } = req.body;
  if (!['Approved', 'Rejected'].includes(status)) {
    res.status(400).json({ error: 'Budget decision must be Approved or Rejected.' });
    return;
  }
  db.prepare(
    `UPDATE budgets SET status = ?, approved_amount_ghs = ?, approved_by = ?, approved_at = datetime('now'), review_notes = ? WHERE id = ?`
  ).run(status, status === 'Approved' ? Number(approved_amount_ghs || 0) : null, req.auth!.memberId, review_notes || null, req.params.id);
  recordAudit(req.auth!.memberId, `BUDGET_${status.toUpperCase()}`, 'budgets', req.params.id);
  void syncBudgetToSupabase(req.params.id);
  res.json({ success: true });
});

// Enforces: 1) No budget = No approval, 2) No accounts = No next funding (7-day receipt rule)
app.post('/api/admin/finance/expenditures', requirePermission('finance', 'create'), (req: AuthedRequest, res) => {
  const { budget_id, branch_id, description, amount_ghs, payee } = req.body;
  const amount = Number(amount_ghs);
  if (!budget_id || !description?.trim() || !amount || amount <= 0 || !payee?.trim()) {
    res.status(400).json({ error: 'Approved budget, description, payee, and GHS amount are required.' });
    return;
  }

  // Gate 1: No budget = No approval
  const budget = db.prepare(`SELECT id, status, approved_amount_ghs FROM budgets WHERE id = ?`).get(budget_id) as
    | { id: string; status: string; approved_amount_ghs: number }
    | undefined;
  if (!budget || budget.status !== 'Approved') {
    res.status(400).json({ error: 'Financial Gate Blocked (No Budget = No Approval): Expenditure requires an Approved budget.' });
    return;
  }

  // Check remaining budget allocation
  const spent = (
    db.prepare(`SELECT COALESCE(SUM(amount_ghs), 0) AS s FROM expenditures WHERE budget_id = ? AND status <> 'Rejected'`).get(budget_id) as { s: number }
  ).s;
  if (spent + amount > (budget.approved_amount_ghs || 0)) {
    res.status(400).json({
      error: `Financial Gate Blocked: Request (GHS ${amount.toFixed(2)}) exceeds remaining approved budget balance (GHS ${((budget.approved_amount_ghs || 0) - spent).toFixed(2)}).`,
    });
    return;
  }

  // Gate 2: No accounts = No next funding (overdue unsubmitted receipts > 7 days)
  const today = new Date().toISOString().slice(0, 10);
  if (branch_id) {
    const overdue = db
      .prepare(`SELECT COUNT(*) AS c FROM expenditures WHERE branch_id = ? AND receipt_submitted = 0 AND receipt_due_date < ? AND status <> 'Rejected'`)
      .get(branch_id, today) as { c: number };
    if (overdue.c > 0) {
      res.status(400).json({
        error: 'Financial Gate Blocked (No Accounts = No Next Funding): This branch has overdue expense receipts past the 7-day accountability window.',
      });
      return;
    }
  }

  const due = new Date();
  due.setDate(due.getDate() + 7);
  const id = uid();
  db.prepare(
    `INSERT INTO expenditures (id, budget_id, branch_id, description, amount_ghs, payee, receipt_due_date, status, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending Approval', ?)`
  ).run(id, budget_id, branch_id || null, description.trim(), amount, payee.trim(), due.toISOString().slice(0, 10), req.auth!.memberId);

  recordAudit(req.auth!.memberId, 'EXPENDITURE_REQUESTED', 'expenditures', id, { budget_id, amount });
  void syncExpenditureToSupabase(id);
  res.status(201).json({ id, receipt_due_date: due.toISOString().slice(0, 10) });
});

app.patch('/api/admin/finance/expenditures/:id', requirePermission('finance', 'approve'), (req: AuthedRequest, res) => {
  const { status, receipt_submitted, receipt_url } = req.body;
  db.prepare(
    `UPDATE expenditures SET
      status = COALESCE(?, status),
      receipt_submitted = COALESCE(?, receipt_submitted),
      receipt_url = COALESCE(?, receipt_url),
      approved_by = CASE WHEN ? = 'Approved' THEN ? ELSE approved_by END,
      approved_at = CASE WHEN ? = 'Approved' THEN datetime('now') ELSE approved_at END
     WHERE id = ?`
  ).run(
    status || null,
    receipt_submitted === undefined ? null : receipt_submitted ? 1 : 0,
    receipt_url || null,
    status || null,
    req.auth!.memberId,
    status || null,
    req.params.id
  );
  void syncExpenditureToSupabase(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/finance/dues-schedules', requirePermission('finance', 'manage'), (req: AuthedRequest, res) => {
  const { title, category_id, period_label, amount_ghs, due_date } = req.body;
  const id = uid();
  db.prepare(`INSERT INTO dues_schedules (id, title, category_id, period_label, amount_ghs, due_date) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id,
    title,
    category_id,
    period_label,
    Number(amount_ghs),
    due_date
  );
  void syncDuesScheduleToSupabase(id, req.auth!.memberId);
  res.status(201).json({ id });
});

// ----------------------------------------------------------------------------
// 12. EVENTS & ATTENDANCE MANAGEMENT
// ----------------------------------------------------------------------------
app.get('/api/admin/events', requirePermission('events', 'view'), (_req, res) => {
  const events = db
    .prepare(
      `SELECT e.*, b.name AS branch_name,
              (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id) AS total_registered,
              (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id AND er.attendance_status = 'Present') AS total_present
       FROM events e LEFT JOIN branches b ON b.id = e.branch_id ORDER BY e.event_date DESC`
    )
    .all();
  const registrations = db
    .prepare(
      `SELECT er.*, m.full_name, m.membership_number, b.name AS branch_name, s.name AS subdivision_name
       FROM event_registrations er
       JOIN members m ON m.id = er.member_id
       JOIN branches b ON b.id = m.branch_id
       JOIN subdivisions s ON s.id = m.subdivision_id
       ORDER BY m.full_name`
    )
    .all();
  res.json({ events, registrations });
});

app.post('/api/admin/events', requirePermission('events', 'create'), (req: AuthedRequest, res) => {
  const { title, description, event_date, venue, branch_id, poster_url, organising_committee, is_public } = req.body;
  if (!title?.trim() || !event_date || !venue?.trim()) {
    res.status(400).json({ error: 'Event title, date, and venue are required.' });
    return;
  }
  const id = uid();
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}-${Date.now().toString().slice(-4)}`;
  db.prepare(
    `INSERT INTO events (id, title, slug, description, event_date, venue, branch_id, poster_url, is_public, organising_committee, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title.trim(),
    slug,
    description || '',
    event_date,
    venue.trim(),
    branch_id || null,
    poster_url || '/media/event_tema_carnival.jpg',
    is_public === false ? 0 : 1,
    JSON.stringify(organising_committee || []),
    req.auth!.memberId
  );
  recordAudit(req.auth!.memberId, 'EVENT_CREATED', 'events', id, { title });
  void syncEventToSupabase(id);
  res.status(201).json({ id });
});

app.patch('/api/admin/events/:id', requirePermission('events', 'edit'), (req: AuthedRequest, res) => {
  const {
    title,
    description,
    event_date,
    venue,
    branch_id,
    poster_url,
    is_public,
    status,
    registration_open,
    post_event_report,
    receipts_submitted,
  } = req.body;
  db.prepare(
    `UPDATE events SET
      title = COALESCE(?, title),
      description = CASE WHEN ? = 1 THEN ? ELSE description END,
      event_date = COALESCE(?, event_date),
      venue = COALESCE(?, venue),
      branch_id = CASE WHEN ? = 1 THEN ? ELSE branch_id END,
      poster_url = CASE WHEN ? = 1 THEN ? ELSE poster_url END,
      is_public = COALESCE(?, is_public),
      status = COALESCE(?, status),
      registration_open = COALESCE(?, registration_open),
      post_event_report = COALESCE(?, post_event_report),
      receipts_submitted = COALESCE(?, receipts_submitted)
     WHERE id = ?`
  ).run(
    title?.trim() || null,
    description !== undefined ? 1 : 0,
    description ?? '',
    event_date || null,
    venue?.trim() || null,
    branch_id !== undefined ? 1 : 0,
    branch_id || null,
    poster_url !== undefined ? 1 : 0,
    poster_url?.trim() || '/media/event_tema_carnival.jpg',
    is_public === undefined ? null : is_public ? 1 : 0,
    status || null,
    registration_open === undefined ? null : registration_open ? 1 : 0,
    post_event_report ?? null,
    receipts_submitted === undefined ? null : receipts_submitted ? 1 : 0,
    req.params.id
  );
  recordAudit(req.auth!.memberId, 'EVENT_UPDATED', 'events', req.params.id, { title, status });
  void syncEventToSupabase(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/events/:id/attendance', requirePermission('events', 'edit'), (req: AuthedRequest, res) => {
  const { member_id, attendance_status } = req.body;
  const existing = db.prepare(`SELECT id FROM event_registrations WHERE event_id = ? AND member_id = ?`).get(req.params.id, member_id) as { id: string } | undefined;
  if (existing) {
    db.prepare(`UPDATE event_registrations SET attendance_status = ?, checked_in_by = ?, checked_in_at = datetime('now') WHERE id = ?`).run(
      attendance_status,
      req.auth!.memberId,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO event_registrations (id, event_id, member_id, attendance_status, checked_in_by, checked_in_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).run(uid(), req.params.id, member_id, attendance_status, req.auth!.memberId);
  }
  void syncEventAttendanceToSupabase(req.params.id, member_id, attendance_status);
  res.json({ success: true });
});

// ----------------------------------------------------------------------------
// 13. NEWS, ANNOUNCEMENTS & GALLERY MEDIA
// ----------------------------------------------------------------------------
app.get('/api/admin/publications', requirePermission('publications', 'view'), (_req, res) => {
  const publications = db
    .prepare(`SELECT p.*, m.full_name AS author_name FROM publications p LEFT JOIN members m ON m.id = p.author_id ORDER BY p.created_at DESC`)
    .all();
  res.json({ publications });
});

app.post('/api/admin/publications', requirePermission('publications', 'create'), (req: AuthedRequest, res) => {
  const { title, category, tags, excerpt, body, cover_image_url, is_featured, status, scheduled_for } = req.body;
  if (!title?.trim() || !body?.trim()) {
    res.status(400).json({ error: 'Title and article body are required.' });
    return;
  }
  const id = uid();
  const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}-${Date.now().toString().slice(-4)}`;
  const finalStatus = status || 'Draft';
  db.prepare(
    `INSERT INTO publications (id, title, slug, category, tags, excerpt, body, cover_image_url, is_featured, status, scheduled_for, published_at, author_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title.trim(),
    slug,
    category || 'Announcement',
    JSON.stringify(tags || []),
    excerpt?.trim() || body.slice(0, 140),
    body.trim(),
    cover_image_url || '/media/hero_masquerade_procession.jpg',
    is_featured ? 1 : 0,
    finalStatus,
    scheduled_for || null,
    finalStatus === 'Published' ? new Date().toISOString() : null,
    req.auth!.memberId
  );
  void syncPublicationToSupabase(id);
  res.status(201).json({ id });
});

app.patch('/api/admin/publications/:id', requirePermission('publications', 'edit'), (req: AuthedRequest, res) => {
  const { title, category, tags, excerpt, body, cover_image_url, is_featured, status, scheduled_for } = req.body;
  db.prepare(
    `UPDATE publications SET
      title = COALESCE(?, title),
      category = COALESCE(?, category),
      tags = CASE WHEN ? = 1 THEN ? ELSE tags END,
      excerpt = CASE WHEN ? = 1 THEN ? ELSE excerpt END,
      body = COALESCE(?, body),
      cover_image_url = CASE WHEN ? = 1 THEN ? ELSE cover_image_url END,
      is_featured = COALESCE(?, is_featured),
      status = COALESCE(?, status),
      scheduled_for = CASE WHEN ? = 1 THEN ? ELSE scheduled_for END,
      published_at = CASE WHEN ? = 'Published' AND published_at IS NULL THEN datetime('now') ELSE published_at END
     WHERE id = ?`
  ).run(
    title?.trim() || null,
    category || null,
    tags !== undefined ? 1 : 0,
    JSON.stringify(tags || []),
    excerpt !== undefined ? 1 : 0,
    excerpt?.trim() || '',
    body?.trim() || null,
    cover_image_url !== undefined ? 1 : 0,
    cover_image_url?.trim() || null,
    is_featured === undefined ? null : is_featured ? 1 : 0,
    status || null,
    scheduled_for !== undefined ? 1 : 0,
    scheduled_for || null,
    status || null,
    req.params.id
  );
  recordAudit(req.auth!.memberId, 'PUBLICATION_UPDATED', 'publications', req.params.id, { title, status });
  void syncPublicationToSupabase(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/gallery', requirePermission('gallery', 'view'), (_req, res) => {
  const items = db
    .prepare(`SELECT m.*, u.full_name AS uploaded_by_name FROM media_items m LEFT JOIN members u ON u.id = m.uploaded_by ORDER BY m.created_at DESC`)
    .all();
  res.json({ items });
});

app.post('/api/admin/gallery', requirePermission('gallery', 'create'), (req: AuthedRequest, res) => {
  const { title, caption, album_name, media_type, bucket_visibility, file_url, mime_type, file_size_bytes, event_id } = req.body;
  if (!title?.trim() || !file_url) {
    res.status(400).json({ error: 'Media title and uploaded file URL are required.' });
    return;
  }
  const id = uid();
  db.prepare(
    `INSERT INTO media_items (id, title, caption, album_name, media_type, bucket_visibility, file_url, mime_type, file_size_bytes, event_id, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title.trim(),
    caption || '',
    album_name || 'General Archive',
    media_type || 'photo',
    bucket_visibility || 'public',
    file_url,
    mime_type || 'image/jpeg',
    Number(file_size_bytes || 100000),
    event_id || null,
    req.auth!.memberId
  );
  void syncMediaItemToSupabase(id);
  res.status(201).json({ id });
});

app.patch('/api/admin/gallery/:id', requirePermission('gallery', 'edit'), (req: AuthedRequest, res) => {
  const existing = db.prepare(`SELECT file_url FROM media_items WHERE id = ?`).get(req.params.id) as { file_url: string } | undefined;
  const { title, album_name, media_type, bucket_visibility, is_archived, caption, file_url, mime_type, file_size_bytes } = req.body;
  db.prepare(
    `UPDATE media_items SET
      title = COALESCE(?, title),
      album_name = COALESCE(?, album_name),
      media_type = COALESCE(?, media_type),
      bucket_visibility = COALESCE(?, bucket_visibility),
      is_archived = COALESCE(?, is_archived),
      caption = CASE WHEN ? = 1 THEN ? ELSE caption END,
      file_url = COALESCE(?, file_url),
      mime_type = COALESCE(?, mime_type),
      file_size_bytes = COALESCE(?, file_size_bytes)
     WHERE id = ?`
  ).run(
    title?.trim() || null,
    album_name?.trim() || null,
    media_type || null,
    bucket_visibility || null,
    is_archived === undefined ? null : is_archived ? 1 : 0,
    caption !== undefined ? 1 : 0,
    caption ?? '',
    file_url?.trim() || null,
    mime_type || null,
    file_size_bytes !== undefined ? Number(file_size_bytes) : null,
    req.params.id
  );
  void syncMediaItemToSupabase(req.params.id, existing?.file_url);
  res.json({ success: true });
});

// ----------------------------------------------------------------------------
// 14. GOVERNANCE, PROPOSALS, VOTING, POLICIES & INQUIRIES
// ----------------------------------------------------------------------------
app.get('/api/admin/governance', requirePermission('governance', 'view'), (req: AuthedRequest, res) => {
  const meetings = db.prepare(`SELECT * FROM governance_meetings ORDER BY scheduled_at DESC`).all();
  const proposals = db
    .prepare(
      `SELECT gp.*, s.full_name AS submitted_by_name, d.full_name AS decided_by_name,
              EXISTS(SELECT 1 FROM governance_votes gv WHERE gv.proposal_id = gp.id AND gv.member_id = ?) AS current_user_voted
       FROM governance_proposals gp
       JOIN members s ON s.id = gp.submitted_by
       LEFT JOIN members d ON d.id = gp.decided_by
       ORDER BY gp.created_at DESC`
    )
    .all(req.auth!.memberId);
  const actionPoints = db
    .prepare(
      `SELECT ap.*, m.full_name AS assigned_to_name FROM governance_action_points ap JOIN members m ON m.id = ap.assigned_to ORDER BY ap.due_date ASC`
    )
    .all();
  const policies = db.prepare(`SELECT * FROM governance_policies`).all();
  const inquiries = db.prepare(`SELECT * FROM member_feedback_and_inquiries ORDER BY created_at DESC`).all();
  res.json({ meetings, proposals, actionPoints, policies, inquiries });
});

app.post('/api/admin/governance/meetings', requirePermission('governance', 'create'), (req: AuthedRequest, res) => {
  const { title, meeting_type, scheduled_at, venue, agenda, quorum_required } = req.body;
  const id = uid();
  db.prepare(
    `INSERT INTO governance_meetings (id, title, meeting_type, scheduled_at, venue, agenda, quorum_required, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, title, meeting_type || 'Executive Council', scheduled_at, venue, agenda, Number(quorum_required || 5), req.auth!.memberId);
  void syncGovernanceMeetingToSupabase(id);
  res.status(201).json({ id });
});

app.patch('/api/admin/governance/meetings/:id', requirePermission('governance', 'edit'), (req: AuthedRequest, res) => {
  const { minutes_text, attendees_count, status } = req.body;
  db.prepare(
    `UPDATE governance_meetings SET minutes_text = COALESCE(?, minutes_text), attendees_count = COALESCE(?, attendees_count), status = COALESCE(?, status) WHERE id = ?`
  ).run(minutes_text ?? null, attendees_count ?? null, status || null, req.params.id);
  void syncGovernanceMeetingToSupabase(req.params.id);
  res.json({ success: true });
});

app.post('/api/admin/governance/proposals', requirePermission('governance', 'create'), (req: AuthedRequest, res) => {
  const { title, proposal_type, description, meeting_id } = req.body;
  const id = uid();
  const ref = `MOT-2026-${Math.floor(100 + Math.random() * 900)}`;
  db.prepare(
    `INSERT INTO governance_proposals (id, reference_code, title, proposal_type, description, meeting_id, submitted_by, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'Voting Open')`
  ).run(id, ref, title, proposal_type || 'Motion', description, meeting_id || null, req.auth!.memberId);
  void syncGovernanceProposalToSupabase(id);
  res.status(201).json({ id, reference_code: ref });
});

app.post('/api/admin/governance/proposals/:id/vote', requirePermission('governance', 'view'), (req: AuthedRequest, res) => {
  const { choice } = req.body as { choice: 'for' | 'against' | 'abstain' };
  if (!['for', 'against', 'abstain'].includes(choice)) {
    res.status(400).json({ error: 'Invalid vote choice.' });
    return;
  }
  const prop = db.prepare(`SELECT status FROM governance_proposals WHERE id = ?`).get(req.params.id) as { status: string } | undefined;
  if (!prop || prop.status !== 'Voting Open') {
    res.status(400).json({ error: 'Voting is not currently open on this proposal.' });
    return;
  }
  try {
    db.exec('BEGIN');
    db.prepare(`INSERT INTO governance_votes (id, proposal_id, member_id, vote_choice) VALUES (?, ?, ?, ?)`).run(
      uid(),
      req.params.id,
      req.auth!.memberId,
      choice
    );
    const col = choice === 'for' ? 'votes_for' : choice === 'against' ? 'votes_against' : 'votes_abstain';
    db.prepare(`UPDATE governance_proposals SET ${col} = ${col} + 1 WHERE id = ?`).run(req.params.id);
    recordAudit(req.auth!.memberId, 'GOVERNANCE_VOTE_CAST', 'governance_proposals', req.params.id, { choice });
    db.exec('COMMIT');
    void syncGovernanceProposalToSupabase(req.params.id);
    res.json({ success: true });
  } catch {
    try { db.exec('ROLLBACK'); } catch {}
    res.status(409).json({ error: 'You have already recorded a vote on this motion.' });
  }
});

app.patch('/api/admin/governance/proposals/:id/decide', requirePermission('governance', 'approve'), (req: AuthedRequest, res) => {
  const { status, decision_notes } = req.body;
  if (!['Approved', 'Rejected'].includes(status)) {
    res.status(400).json({ error: 'Invalid resolution outcome.' });
    return;
  }
  db.prepare(
    `UPDATE governance_proposals SET status = ?, decided_by = ?, decision_notes = ?, decided_at = datetime('now') WHERE id = ?`
  ).run(status, req.auth!.memberId, decision_notes || null, req.params.id);
  recordAudit(req.auth!.memberId, `PROPOSAL_${status.toUpperCase()}`, 'governance_proposals', req.params.id);
  void syncGovernanceProposalToSupabase(req.params.id);
  res.json({ success: true });
});

app.patch('/api/admin/governance/policies/:key', requireAuth, (req: AuthedRequest, res) => {
  const isSecretariatSettings = req.params.key === 'secretariat_settings';
  const canEditSecretariat = Boolean(
    req.auth?.permissions.rbac?.manage || req.auth?.permissions.governance?.edit || req.auth?.permissions.governance?.approve
  );
  const canEditConstitutional = Boolean(req.auth?.permissions.rbac?.manage || req.auth?.permissions.governance?.approve);
  if (isSecretariatSettings ? !canEditSecretariat : !canEditConstitutional) {
    res.status(403).json({ error: 'Forbidden: Insufficient permissions to update this Society policy.' });
    return;
  }
  const { value_json, confirmed } = req.body;
  const serializedValue =
    value_json === undefined ? null : typeof value_json === 'string' ? value_json : JSON.stringify(value_json);
  db.prepare(
    `UPDATE governance_policies SET value_json = COALESCE(?, value_json), confirmed = COALESCE(?, confirmed), updated_at = datetime('now') WHERE key = ?`
  ).run(serializedValue, confirmed === undefined ? null : confirmed ? 1 : 0, req.params.key);
  recordAudit(req.auth!.memberId, 'POLICY_UPDATED', 'governance_policies', null, { key: req.params.key, confirmed });
  void syncGovernancePolicyToSupabase(req.params.key, req.auth!.memberId);
  res.json({ success: true });
});

app.patch('/api/admin/inquiries/:id', requirePermission('inquiries', 'edit'), (req: AuthedRequest, res) => {
  const { status, response_text } = req.body;
  db.prepare(`UPDATE member_feedback_and_inquiries SET status = ?, response_text = ?, responded_by = ? WHERE id = ?`).run(
    status || 'Responded',
    response_text || null,
    req.auth!.memberId,
    req.params.id
  );
  void syncInquiryToSupabase(req.params.id);
  res.json({ success: true });
});

// ----------------------------------------------------------------------------
// 15. REPORTS & ANALYTICS
// ----------------------------------------------------------------------------
app.get('/api/admin/reports', requirePermission('reports', 'view'), (_req, res) => {
  const membersByBranch = db
    .prepare(
      `SELECT b.name AS branch_name, COUNT(m.id) AS total_members,
              SUM(CASE WHEN m.membership_status = 'Active' THEN 1 ELSE 0 END) AS active_members
       FROM branches b LEFT JOIN members m ON m.branch_id = b.id GROUP BY b.id`
    )
    .all();

  const membersByCategory = db
    .prepare(
      `SELECT c.name AS category_name, COUNT(m.id) AS member_count
       FROM membership_categories c LEFT JOIN members m ON m.category_id = c.id GROUP BY c.id`
    )
    .all();

  const financeByCategory = db
    .prepare(
      `SELECT payment_category, COALESCE(SUM(amount_ghs), 0) AS total_ghs, COUNT(*) AS tx_count
       FROM financial_payments WHERE verification_status = 'Verified' GROUP BY payment_category`
    )
    .all();

  const financeByBranch = db
    .prepare(
      `SELECT COALESCE(b.name, 'National / Unassigned') AS branch_name,
              COALESCE((SELECT SUM(fp.amount_ghs) FROM financial_payments fp WHERE fp.branch_id = b.id AND fp.verification_status = 'Verified'), 0) AS income_ghs,
              COALESCE((SELECT SUM(ex.amount_ghs) FROM expenditures ex WHERE ex.branch_id = b.id AND ex.status <> 'Rejected'), 0) AS expenditure_ghs
       FROM branches b`
    )
    .all();

  const eventAttendance = db
    .prepare(
      `SELECT e.title, e.event_date,
              (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id) AS registered,
              (SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id AND er.attendance_status = 'Present') AS present
       FROM events e ORDER BY e.event_date DESC`
    )
    .all();

  res.json({ membersByBranch, membersByCategory, financeByCategory, financeByBranch, eventAttendance });
});

// ----------------------------------------------------------------------------
// VITE MIDDLEWARE (DEV) OR STATIC SERVING (PROD) ON PORT 3000
// ----------------------------------------------------------------------------
async function startServer() {
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
        ws: { server: httpServer },
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`LASUPADORA 360 running on http://localhost:${PORT}`);
  });
}

export { app };
export default app;

if (!process.env.VERCEL) {
  startServer();
}
