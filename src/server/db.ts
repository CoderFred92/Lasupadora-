import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.VERCEL
  ? path.resolve('/tmp', 'lasupadora-data')
  : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const uploadsPublicDir = path.resolve(dataDir, 'uploads', 'public');
export const uploadsPrivateDir = path.resolve(dataDir, 'uploads', 'private');
fs.mkdirSync(uploadsPublicDir, { recursive: true });
fs.mkdirSync(uploadsPrivateDir, { recursive: true });

const dbPath = path.resolve(dataDir, 'lasupadora.db');
export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      branch_type TEXT NOT NULL CHECK (branch_type IN ('tema', 'outside_tema', 'diaspora', 'other')),
      region TEXT NOT NULL DEFAULT 'Greater Accra',
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subdivisions (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      subdivision_type TEXT NOT NULL CHECK (subdivision_type IN ('community', 'town', 'zone')),
      town_or_community TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT 'Greater Accra',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (branch_id, code),
      UNIQUE (branch_id, name)
    );

    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL UNIQUE,
      scope_level TEXT NOT NULL CHECK (scope_level IN ('national', 'branch', 'subdivision', 'self', 'public')),
      is_constitutional_office INTEGER NOT NULL DEFAULT 0,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      id TEXT PRIMARY KEY,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      module TEXT NOT NULL,
      can_view INTEGER NOT NULL DEFAULT 0,
      can_create INTEGER NOT NULL DEFAULT 0,
      can_edit INTEGER NOT NULL DEFAULT 0,
      can_approve INTEGER NOT NULL DEFAULT 0,
      can_delete INTEGER NOT NULL DEFAULT 0,
      can_export INTEGER NOT NULL DEFAULT 0,
      can_manage INTEGER NOT NULL DEFAULT 0,
      UNIQUE (role_id, module)
    );

    CREATE TABLE IF NOT EXISTS governance_policies (
      key TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      label TEXT NOT NULL,
      value_json TEXT NOT NULL,
      requires_constitutional_confirmation INTEGER NOT NULL DEFAULT 1,
      confirmed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS membership_categories (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      min_age INTEGER,
      max_age INTEGER,
      annual_dues_ghs REAL NOT NULL DEFAULT 0,
      monthly_dues_ghs REAL NOT NULL DEFAULT 0,
      eligibility_notes TEXT,
      requires_policy_confirmation INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      membership_number TEXT NOT NULL UNIQUE,
      qr_token TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      date_of_birth TEXT,
      gender TEXT,
      telephone TEXT NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT,
      residential_address TEXT,
      photo_url TEXT,
      branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      subdivision_id TEXT NOT NULL REFERENCES subdivisions(id) ON DELETE RESTRICT,
      category_id TEXT NOT NULL REFERENCES membership_categories(id) ON DELETE RESTRICT,
      membership_status TEXT NOT NULL DEFAULT 'Active'
        CHECK (membership_status IN ('Pending', 'Active', 'Inactive', 'Suspended', 'Transferred', 'Deceased', 'Resigned')),
      previous_experience TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      registration_date TEXT NOT NULL DEFAULT (date('now')),
      approved_by TEXT REFERENCES members(id),
      approved_at TEXT,
      card_valid_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS member_roles (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      branch_id TEXT REFERENCES branches(id) ON DELETE RESTRICT,
      subdivision_id TEXT REFERENCES subdivisions(id) ON DELETE RESTRICT,
      is_active INTEGER NOT NULL DEFAULT 1,
      assigned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS membership_applications (
      id TEXT PRIMARY KEY,
      application_ref TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL CHECK (source IN ('public_web', 'officer_assisted')),
      created_by_officer_id TEXT REFERENCES members(id),
      full_name TEXT NOT NULL,
      date_of_birth TEXT,
      gender TEXT,
      telephone TEXT NOT NULL,
      email TEXT,
      residential_address TEXT,
      photo_url TEXT,
      preferred_branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
      preferred_subdivision_id TEXT NOT NULL REFERENCES subdivisions(id) ON DELETE RESTRICT,
      requested_category_id TEXT NOT NULL REFERENCES membership_categories(id) ON DELETE RESTRICT,
      previous_experience TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      supporting_doc_url TEXT,
      declaration_accepted INTEGER NOT NULL DEFAULT 1 CHECK (declaration_accepted = 1),
      privacy_consent_accepted INTEGER NOT NULL DEFAULT 1 CHECK (privacy_consent_accepted = 1),
      status TEXT NOT NULL DEFAULT 'Pending Review'
        CHECK (status IN ('Pending Review', 'Corrections Requested', 'Approved', 'Rejected')),
      reviewing_officer_id TEXT REFERENCES members(id),
      reviewed_at TEXT,
      review_comments TEXT,
      approved_member_id TEXT UNIQUE REFERENCES members(id),
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS application_decision_history (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES membership_applications(id) ON DELETE CASCADE,
      previous_status TEXT,
      new_status TEXT NOT NULL,
      actor_member_id TEXT REFERENCES members(id),
      notes TEXT,
      decided_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS member_transfers (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      from_branch_id TEXT NOT NULL REFERENCES branches(id),
      from_subdivision_id TEXT NOT NULL REFERENCES subdivisions(id),
      to_branch_id TEXT NOT NULL REFERENCES branches(id),
      to_subdivision_id TEXT NOT NULL REFERENCES subdivisions(id),
      reason TEXT NOT NULL,
      approved_by TEXT NOT NULL REFERENCES members(id),
      transferred_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profile_change_requests (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      requested_changes TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
      reviewed_by TEXT REFERENCES members(id),
      review_notes TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS leadership_appointments (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
      portfolio TEXT NOT NULL,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('national', 'branch', 'subdivision')),
      branch_id TEXT REFERENCES branches(id),
      subdivision_id TEXT REFERENCES subdivisions(id),
      term_number INTEGER NOT NULL DEFAULT 1,
      term_start TEXT NOT NULL,
      term_expiry TEXT NOT NULL,
      handover_deadline TEXT,
      oath_signed INTEGER NOT NULL DEFAULT 0,
      oath_signed_at TEXT,
      biography TEXT,
      is_public_approved INTEGER NOT NULL DEFAULT 0,
      can_act_for_president INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'Stepped Down', 'Acting')),
      appointed_by TEXT REFERENCES members(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      event_date TEXT NOT NULL,
      end_date TEXT,
      venue TEXT NOT NULL,
      branch_id TEXT REFERENCES branches(id),
      poster_url TEXT,
      registration_open INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Draft', 'Upcoming', 'Completed', 'Archived', 'Cancelled')),
      is_public INTEGER NOT NULL DEFAULT 1,
      organising_committee TEXT NOT NULL DEFAULT '[]',
      post_event_report TEXT,
      receipt_submission_deadline TEXT,
      receipts_submitted INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES members(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS event_registrations (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      attendance_status TEXT NOT NULL DEFAULT 'Registered' CHECK (attendance_status IN ('Registered', 'Present', 'Absent', 'Excused')),
      checked_in_by TEXT REFERENCES members(id),
      checked_in_at TEXT,
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (event_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS dues_schedules (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category_id TEXT NOT NULL REFERENCES membership_categories(id),
      period_label TEXT NOT NULL,
      amount_ghs REAL NOT NULL CHECK (amount_ghs >= 0),
      due_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fundraising_campaigns (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      target_amount_ghs REAL NOT NULL CHECK (target_amount_ghs > 0),
      start_date TEXT NOT NULL,
      end_date TEXT,
      branch_id TEXT REFERENCES branches(id),
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'Closed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      event_id TEXT REFERENCES events(id) ON DELETE RESTRICT,
      branch_id TEXT REFERENCES branches(id),
      fiscal_year INTEGER NOT NULL DEFAULT 2026,
      requested_amount_ghs REAL NOT NULL CHECK (requested_amount_ghs > 0),
      approved_amount_ghs REAL,
      line_items TEXT NOT NULL DEFAULT '[]',
      submitted_by TEXT NOT NULL REFERENCES members(id),
      submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
      four_week_rule_compliant INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Draft', 'Submitted', 'Approved', 'Rejected', 'Closed')),
      approved_by TEXT REFERENCES members(id),
      approved_at TEXT,
      review_notes TEXT
    );

    CREATE TABLE IF NOT EXISTS financial_payments (
      id TEXT PRIMARY KEY,
      receipt_number TEXT NOT NULL UNIQUE,
      member_id TEXT REFERENCES members(id) ON DELETE RESTRICT,
      dues_schedule_id TEXT REFERENCES dues_schedules(id),
      campaign_id TEXT REFERENCES fundraising_campaigns(id),
      branch_id TEXT REFERENCES branches(id),
      payment_category TEXT NOT NULL CHECK (payment_category IN ('Dues', 'Donation', 'Fundraising', 'Registration Fee', 'Other')),
      amount_ghs REAL NOT NULL CHECK (amount_ghs > 0),
      currency TEXT NOT NULL DEFAULT 'GHS',
      payment_date TEXT NOT NULL DEFAULT (date('now')),
      payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'Bank Transfer', 'Mobile Money', 'Cheque', 'Verified Gateway')),
      reference_number TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'Pending Verification'
        CHECK (verification_status IN ('Pending Verification', 'Verified', 'Rejected')),
      recording_officer_id TEXT REFERENCES members(id),
      verified_by_id TEXT REFERENCES members(id),
      verified_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS expenditures (
      id TEXT PRIMARY KEY,
      budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE RESTRICT,
      branch_id TEXT REFERENCES branches(id),
      description TEXT NOT NULL,
      amount_ghs REAL NOT NULL CHECK (amount_ghs > 0),
      currency TEXT NOT NULL DEFAULT 'GHS',
      expense_date TEXT NOT NULL DEFAULT (date('now')),
      payee TEXT NOT NULL,
      receipt_url TEXT,
      receipt_submitted INTEGER NOT NULL DEFAULT 0,
      receipt_due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending Approval'
        CHECK (status IN ('Pending Approval', 'Approved', 'Disbursed', 'Accounted', 'Rejected')),
      requested_by TEXT NOT NULL REFERENCES members(id),
      approved_by TEXT REFERENCES members(id),
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS publications (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL CHECK (category IN ('Announcement', 'News', 'Featured Story', 'Archive', 'Cultural Note')),
      tags TEXT NOT NULL DEFAULT '[]',
      excerpt TEXT NOT NULL,
      body TEXT NOT NULL,
      cover_image_url TEXT,
      is_featured INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Scheduled', 'Published', 'Archived')),
      scheduled_for TEXT,
      published_at TEXT,
      author_id TEXT REFERENCES members(id),
      approved_by TEXT REFERENCES members(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      caption TEXT,
      album_name TEXT NOT NULL DEFAULT 'General Archive',
      media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video', 'poster', 'document')),
      bucket_visibility TEXT NOT NULL CHECK (bucket_visibility IN ('public', 'private')),
      file_url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL,
      event_id TEXT REFERENCES events(id),
      is_archived INTEGER NOT NULL DEFAULT 0,
      uploaded_by TEXT REFERENCES members(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS governance_meetings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      meeting_type TEXT NOT NULL CHECK (meeting_type IN ('Executive Council', 'General Assembly', 'Branch Meeting', 'Committee')),
      branch_id TEXT REFERENCES branches(id),
      scheduled_at TEXT NOT NULL,
      venue TEXT NOT NULL,
      agenda TEXT NOT NULL,
      minutes_text TEXT,
      quorum_required INTEGER NOT NULL DEFAULT 5,
      attendees_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled', 'Held', 'Adjourned', 'Archived')),
      created_by TEXT REFERENCES members(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS governance_proposals (
      id TEXT PRIMARY KEY,
      reference_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      proposal_type TEXT NOT NULL CHECK (proposal_type IN ('Motion', 'Policy Amendment', 'Resolution', 'Budget Ratification', 'Appointment')),
      description TEXT NOT NULL,
      meeting_id TEXT REFERENCES governance_meetings(id),
      submitted_by TEXT NOT NULL REFERENCES members(id),
      status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Under Review', 'Voting Open', 'Approved', 'Rejected')),
      votes_for INTEGER NOT NULL DEFAULT 0,
      votes_against INTEGER NOT NULL DEFAULT 0,
      votes_abstain INTEGER NOT NULL DEFAULT 0,
      reviewed_by TEXT REFERENCES members(id),
      decided_by TEXT REFERENCES members(id),
      decision_notes TEXT,
      decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS governance_votes (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL REFERENCES governance_proposals(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
      vote_choice TEXT NOT NULL CHECK (vote_choice IN ('for', 'against', 'abstain')),
      cast_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (proposal_id, member_id)
    );

    CREATE TABLE IF NOT EXISTS governance_action_points (
      id TEXT PRIMARY KEY,
      proposal_id TEXT REFERENCES governance_proposals(id) ON DELETE SET NULL,
      meeting_id TEXT REFERENCES governance_meetings(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      assigned_to TEXT NOT NULL REFERENCES members(id),
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Completed', 'Overdue')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS member_feedback_and_inquiries (
      id TEXT PRIMARY KEY,
      member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
      sender_name TEXT NOT NULL,
      sender_email TEXT,
      submission_type TEXT NOT NULL CHECK (submission_type IN ('Inquiry', 'Suggestion', 'Constructive Criticism', 'Public Contact')),
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Received' CHECK (status IN ('Received', 'In Review', 'Responded', 'Archived')),
      response_text TEXT,
      responded_by TEXT REFERENCES members(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_table TEXT NOT NULL,
      target_id TEXT,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function uid(): string {
  return crypto.randomUUID();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64);
  const hashBuf = Buffer.from(hash, 'hex');
  if (derived.length !== hashBuf.length) return false;
  return crypto.timingSafeEqual(derived, hashBuf);
}

const SESSION_SECRET = process.env.SESSION_SECRET || 'lasupadora-dev-session-secret-change-in-prod';

export function signSessionToken(payload: { memberId: string; exp: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySessionToken(token: string): { memberId: string; exp: number } | null {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!parsed.memberId || !parsed.exp || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function logAudit(
  actorMemberId: string | null,
  action: string,
  targetTable: string,
  targetId: string | null,
  details: Record<string, unknown> = {}
) {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_member_id, action, target_table, target_id, details) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(uid(), actorMemberId, action, targetTable, targetId, JSON.stringify(details));
}
