import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { db } from './db.ts';

function normalizeUrl(raw: string | undefined): string {
  return (raw || '')
    .trim()
    .replace(/\/rest\/v1\/?$/i, '')
    .replace(/\/+$/, '');
}

export function getSupabaseConfig() {
  const url = normalizeUrl(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const serviceKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ''
  ).trim();
  return {
    url,
    anonKey,
    serviceKey,
    isConfigured: Boolean(url && (serviceKey || anonKey) && !url.includes('your-project-ref')),
    hasAdminKey: Boolean(url && serviceKey && !serviceKey.includes('your-supabase-service-role-key')),
  };
}

let cachedAdminClient: SupabaseClient | null = null;
let cachedPublicClient: SupabaseClient | null = null;
let lastAdminKey = '';
let lastSyncError: string | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  const cfg = getSupabaseConfig();
  if (!cfg.hasAdminKey) return null;
  if (!cachedAdminClient || lastAdminKey !== cfg.serviceKey) {
    cachedAdminClient = createClient(cfg.url, cfg.serviceKey, { auth: { persistSession: false } });
    lastAdminKey = cfg.serviceKey;
  }
  return cachedAdminClient;
}

export function getSupabasePublic(): SupabaseClient | null {
  const cfg = getSupabaseConfig();
  if (!cfg.isConfigured) return null;
  if (!cachedPublicClient) {
    cachedPublicClient = createClient(cfg.url, cfg.serviceKey || cfg.anonKey, { auth: { persistSession: false } });
  }
  return cachedPublicClient;
}

export async function testSupabaseHealth() {
  const cfg = getSupabaseConfig();
  const supabaseEnvNames = Object.keys(process.env).filter((k) => /supa|sb_/i.test(k));
  if (!cfg.isConfigured) {
    return {
      configured: false,
      connected: false,
      adminEnabled: false,
      supabaseEnvNames,
      error: 'Supabase URL or key not configured',
    };
  }

  const pub = getSupabasePublic()!;
  const { data: branches, error: pubErr } = await pub.from('branches').select('id').limit(5);
  if (pubErr) {
    return {
      configured: true,
      connected: false,
      adminEnabled: false,
      supabaseEnvNames,
      projectUrl: cfg.url,
      error: pubErr.message,
    };
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return {
      configured: true,
      connected: true,
      adminEnabled: false,
      supabaseEnvNames,
      projectUrl: cfg.url,
      branchesCount: branches?.length ?? 0,
    };
  }

  const [
    { error: memErr, count: membersCount },
    { data: buckets, error: bucketErr },
    { count: leadershipCount },
    { count: eventsCount },
    { count: publicationsCount },
    { count: mediaCount },
    { count: campaignsCount },
    { count: budgetsCount },
    { count: paymentsCount },
    { count: auditCount },
  ] = await Promise.all([
    admin.from('members').select('id', { count: 'exact', head: true }),
    admin.storage.listBuckets(),
    admin.from('leadership_appointments').select('id', { count: 'exact', head: true }),
    admin.from('events').select('id', { count: 'exact', head: true }),
    admin.from('publications').select('id', { count: 'exact', head: true }),
    admin.from('media_items').select('id', { count: 'exact', head: true }),
    admin.from('fundraising_campaigns').select('id', { count: 'exact', head: true }),
    admin.from('budgets').select('id', { count: 'exact', head: true }),
    admin.from('financial_payments').select('id', { count: 'exact', head: true }),
    admin.from('audit_logs').select('id', { count: 'exact', head: true }),
  ]);

  return {
    configured: true,
    connected: true,
    adminEnabled: !memErr && !bucketErr,
    adminError: memErr?.message || bucketErr?.message || null,
    lastSyncError,
    supabaseEnvNames,
    projectUrl: cfg.url,
    branchesCount: branches?.length ?? 0,
    bucketsCount: buckets?.length ?? 0,
    tableCounts: {
      members: membersCount ?? 0,
      leadership_appointments: leadershipCount ?? 0,
      events: eventsCount ?? 0,
      publications: publicationsCount ?? 0,
      media_items: mediaCount ?? 0,
      fundraising_campaigns: campaignsCount ?? 0,
      budgets: budgetsCount ?? 0,
      financial_payments: paymentsCount ?? 0,
      audit_logs: auditCount ?? 0,
    },
  };
}

// ----------------------------------------------------------------------------
// ID RESOLUTION HELPERS (Local SQLite UUIDs -> Remote Supabase UUIDs)
// ----------------------------------------------------------------------------
async function resolveBranchId(localBranchId: string | null | undefined): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!admin || !localBranchId) return null;
  const row = db.prepare(`SELECT code, name, branch_type, region, description, is_active FROM branches WHERE id = ?`).get(localBranchId) as
    | { code: string; name: string; branch_type: string; region: string; description: string | null; is_active: number }
    | undefined;
  if (!row) return null;
  const { data } = await admin.from('branches').select('id').eq('code', row.code).maybeSingle();
  if (data?.id) return data.id;
  const { data: inserted } = await admin
    .from('branches')
    .upsert(
      {
        code: row.code,
        name: row.name,
        branch_type: row.branch_type,
        region: row.region,
        description: row.description,
        is_active: Boolean(row.is_active),
      },
      { onConflict: 'code' }
    )
    .select('id')
    .single();
  return inserted?.id ?? null;
}

async function resolveSubdivisionId(localSubId: string | null | undefined): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!admin || !localSubId) return null;
  const row = db
    .prepare(`SELECT branch_id, code, name, subdivision_type, town_or_community, region, is_active FROM subdivisions WHERE id = ?`)
    .get(localSubId) as
    | {
        branch_id: string;
        code: string;
        name: string;
        subdivision_type: string;
        town_or_community: string;
        region: string;
        is_active: number;
      }
    | undefined;
  if (!row) return null;
  const sbBranchId = await resolveBranchId(row.branch_id);
  if (!sbBranchId) return null;
  const { data } = await admin.from('subdivisions').select('id').eq('branch_id', sbBranchId).eq('code', row.code).maybeSingle();
  if (data?.id) return data.id;
  const { data: inserted } = await admin
    .from('subdivisions')
    .upsert(
      {
        branch_id: sbBranchId,
        code: row.code,
        name: row.name,
        subdivision_type: row.subdivision_type,
        town_or_community: row.town_or_community,
        region: row.region,
        is_active: Boolean(row.is_active),
      },
      { onConflict: 'branch_id,code' }
    )
    .select('id')
    .single();
  return inserted?.id ?? null;
}

async function resolveCategoryId(localCatId: string | null | undefined): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!admin || !localCatId) return null;
  const row = db.prepare(`SELECT code FROM membership_categories WHERE id = ?`).get(localCatId) as { code: string } | undefined;
  if (!row) return null;
  const { data } = await admin.from('membership_categories').select('id').eq('code', row.code).maybeSingle();
  return data?.id ?? null;
}

async function resolveRoleId(localRoleId: string | null | undefined): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!admin || !localRoleId) return null;
  const row = db.prepare(`SELECT slug FROM roles WHERE id = ?`).get(localRoleId) as { slug: string } | undefined;
  if (!row) return null;
  const { data } = await admin.from('roles').select('id').eq('slug', row.slug).maybeSingle();
  return data?.id ?? null;
}

async function resolveMemberId(localMemberId: string | null | undefined): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!admin || !localMemberId) return null;
  const row = db.prepare(`SELECT * FROM members WHERE id = ?`).get(localMemberId) as Record<string, string | null> | undefined;
  if (!row) return null;

  if (row.qr_token) {
    const { data: byQr } = await admin.from('members').select('id').eq('qr_token', row.qr_token).maybeSingle();
    if (byQr?.id) return byQr.id;
  }

  const { data: existing } = await admin.from('members').select('id').eq('membership_number', row.membership_number!).maybeSingle();
  if (existing?.id) return existing.id;

  if (row.email) {
    const { data: byEmail } = await admin.from('members').select('id').eq('email', row.email).maybeSingle();
    if (byEmail?.id) return byEmail.id;
  }

  const [sbBranchId, sbSubId, sbCatId] = await Promise.all([
    resolveBranchId(row.branch_id),
    resolveSubdivisionId(row.subdivision_id),
    resolveCategoryId(row.category_id),
  ]);
  if (!sbBranchId || !sbSubId || !sbCatId) return null;

  const { data: inserted } = await admin
    .from('members')
    .upsert(
      {
        membership_number: row.membership_number,
        qr_token: row.qr_token,
        full_name: row.full_name,
        date_of_birth: row.date_of_birth || null,
        gender: row.gender || null,
        telephone: row.telephone,
        email: row.email || null,
        residential_address: row.residential_address || null,
        photo_storage_path: row.photo_url || null,
        branch_id: sbBranchId,
        subdivision_id: sbSubId,
        category_id: sbCatId,
        membership_status: row.membership_status || 'Active',
        previous_experience: row.previous_experience || null,
        emergency_contact_name: row.emergency_contact_name || null,
        emergency_contact_phone: row.emergency_contact_phone || null,
        registration_date: row.registration_date || new Date().toISOString().slice(0, 10),
        approved_at: row.approved_at || null,
        card_valid_until: row.card_valid_until || null,
      },
      { onConflict: 'membership_number' }
    )
    .select('id')
    .single();
  return inserted?.id ?? null;
}

async function resolveEventId(localEventId: string | null | undefined): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!admin || !localEventId) return null;
  const row = db.prepare(`SELECT * FROM events WHERE id = ?`).get(localEventId) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  const { data: existing } = await admin.from('events').select('id').eq('slug', String(row.slug)).maybeSingle();
  if (existing?.id) return existing.id;
  const sbBranchId = await resolveBranchId(row.branch_id as string | null);
  const sbCreatorId = await resolveMemberId(row.created_by as string | null);
  const { data: inserted } = await admin
    .from('events')
    .upsert(
      {
        title: row.title,
        slug: row.slug,
        description: row.description || '',
        event_date: row.event_date,
        end_date: row.end_date || null,
        venue: row.venue,
        branch_id: sbBranchId,
        poster_path: row.poster_url || null,
        registration_open: Boolean(row.registration_open),
        status: row.status || 'Upcoming',
        is_public: Boolean(row.is_public),
        organising_committee: JSON.parse(String(row.organising_committee || '[]')),
        post_event_report: row.post_event_report || null,
        receipt_submission_deadline: row.receipt_submission_deadline || null,
        receipts_submitted: Boolean(row.receipts_submitted),
        created_by: sbCreatorId,
      },
      { onConflict: 'slug' }
    )
    .select('id')
    .single();
  return inserted?.id ?? null;
}

async function resolveBudgetId(localBudgetId: string | null | undefined): Promise<string | null> {
  const admin = getSupabaseAdmin();
  if (!admin || !localBudgetId) return null;
  const row = db.prepare(`SELECT * FROM budgets WHERE id = ?`).get(localBudgetId) as Record<string, string | number | null> | undefined;
  if (!row) return null;
  const sbSubmitterId = await resolveMemberId(row.submitted_by as string);
  if (!sbSubmitterId) return null;
  const { data: existing } = await admin
    .from('budgets')
    .select('id')
    .eq('title', String(row.title))
    .eq('submitted_by', sbSubmitterId)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const [sbEventId, sbBranchId, sbApproverId] = await Promise.all([
    resolveEventId(row.event_id as string | null),
    resolveBranchId(row.branch_id as string | null),
    resolveMemberId(row.approved_by as string | null),
  ]);
  const { data: inserted } = await admin
    .from('budgets')
    .insert({
      title: row.title,
      event_id: sbEventId,
      branch_id: sbBranchId,
      fiscal_year: Number(row.fiscal_year || 2026),
      requested_amount_ghs: Number(row.requested_amount_ghs),
      approved_amount_ghs: row.approved_amount_ghs != null ? Number(row.approved_amount_ghs) : null,
      line_items: JSON.parse(String(row.line_items || '[]')),
      submitted_by: sbSubmitterId,
      four_week_rule_compliant: Boolean(row.four_week_rule_compliant),
      status: row.status || 'Submitted',
      approved_by: sbApproverId,
      approved_at: row.approved_at || null,
      review_notes: row.review_notes || null,
    })
    .select('id')
    .single();
  return inserted?.id ?? null;
}

// ----------------------------------------------------------------------------
// BOOTSTRAP SEED SYNC (Idempotent push of seeded baseline if remote empty)
// ----------------------------------------------------------------------------
let bootstrapDone = false;

export async function ensureSupabaseSeeded(): Promise<void> {
  if (bootstrapDone) return;
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    lastSyncError = null;
    const [
      { count: memCount },
      { count: leadCount },
      { count: evtCount },
      { count: pubCount },
      { count: mediaCount },
      { count: campaignCount },
      { count: bdgCount },
      { count: payCount },
    ] = await Promise.all([
      admin.from('members').select('id', { count: 'exact', head: true }),
      admin.from('leadership_appointments').select('id', { count: 'exact', head: true }),
      admin.from('events').select('id', { count: 'exact', head: true }),
      admin.from('publications').select('id', { count: 'exact', head: true }),
      admin.from('media_items').select('id', { count: 'exact', head: true }),
      admin.from('fundraising_campaigns').select('id', { count: 'exact', head: true }),
      admin.from('budgets').select('id', { count: 'exact', head: true }),
      admin.from('financial_payments').select('id', { count: 'exact', head: true }),
    ]);

    const localMembers = db
      .prepare(`SELECT id, qr_token, membership_number, email, full_name FROM members`)
      .all() as { id: string; qr_token: string; membership_number: string; email: string | null; full_name: string }[];

    if ((memCount ?? 0) === 0) {
      for (const m of localMembers) await resolveMemberId(m.id);
    } else {
      // Match existing remote members cleanly by membership_number or email first,
      // updating their qr_token & fields rather than deleting active FK-linked rows.
      const localNumSet = new Set(localMembers.map((m) => m.membership_number.toUpperCase()));
      const localEmailSet = new Set(localMembers.map((m) => (m.email || '').toLowerCase()).filter(Boolean));
      const { data: remoteMembers } = await admin.from('members').select('id, qr_token, membership_number, email, full_name');
      if (remoteMembers) {
        const canonicalByKey = new Map<string, string>();
        for (const rm of remoteMembers) {
          const numKey = (rm.membership_number || '').toUpperCase();
          const emailKey = (rm.email || '').toLowerCase();
          if (numKey && localNumSet.has(numKey) && !canonicalByKey.has(`num:${numKey}`)) {
            canonicalByKey.set(`num:${numKey}`, rm.id);
          }
          if (emailKey && localEmailSet.has(emailKey) && !canonicalByKey.has(`email:${emailKey}`)) {
            canonicalByKey.set(`email:${emailKey}`, rm.id);
          }
        }
        // Only remove remote rows that are duplicate or orphaned when a canonical replacement row exists
        for (const rm of remoteMembers) {
          const numKey = (rm.membership_number || '').toUpperCase();
          const emailKey = (rm.email || '').toLowerCase();
          const isMatchedNum = numKey && localNumSet.has(numKey) && canonicalByKey.get(`num:${numKey}`) === rm.id;
          const isMatchedEmail = emailKey && localEmailSet.has(emailKey) && canonicalByKey.get(`email:${emailKey}`) === rm.id;
          if (isMatchedNum || isMatchedEmail) continue;

          const replacementId =
            (numKey ? canonicalByKey.get(`num:${numKey}`) : undefined) ||
            (emailKey ? canonicalByKey.get(`email:${emailKey}`) : undefined) ||
            null;
          if (!replacementId) continue;

          await admin.from('member_roles').delete().eq('member_id', rm.id);
          await admin.from('event_registrations').delete().eq('member_id', rm.id);
          await admin.from('notifications').delete().eq('member_id', rm.id);
          await admin.from('profile_change_requests').delete().eq('member_id', rm.id);
          await admin.from('audit_logs').update({ actor_member_id: replacementId }).eq('actor_member_id', rm.id);
          await admin.from('members').update({ approved_by: null }).eq('approved_by', rm.id);
          await admin.from('member_roles').update({ assigned_by: null }).eq('assigned_by', rm.id);
          await admin.from('membership_applications').update({ created_by_officer_id: null }).eq('created_by_officer_id', rm.id);
          await admin.from('membership_applications').update({ reviewing_officer_id: null }).eq('reviewing_officer_id', rm.id);
          await admin.from('membership_applications').update({ approved_member_id: null }).eq('approved_member_id', rm.id);
          await admin.from('application_decision_history').update({ actor_member_id: replacementId }).eq('actor_member_id', rm.id);
          await admin.from('member_feedback_and_inquiries').update({ member_id: replacementId }).eq('member_id', rm.id);
          await admin.from('member_feedback_and_inquiries').update({ responded_by: replacementId }).eq('responded_by', rm.id);
          await admin.from('events').update({ created_by: replacementId }).eq('created_by', rm.id);
          await admin.from('publications').update({ author_id: replacementId }).eq('author_id', rm.id);
          await admin.from('publications').update({ approved_by: replacementId }).eq('approved_by', rm.id);
          await admin.from('media_items').update({ uploaded_by: replacementId }).eq('uploaded_by', rm.id);
          await admin.from('dues_schedules').update({ created_by: replacementId }).eq('created_by', rm.id);
          await admin.from('fundraising_campaigns').update({ created_by: replacementId }).eq('created_by', rm.id);
          await admin.from('governance_meetings').update({ created_by: replacementId }).eq('created_by', rm.id);
          await admin.from('governance_policies').update({ updated_by: replacementId }).eq('updated_by', rm.id);
          await admin.from('financial_payments').update({ recording_officer_id: replacementId }).eq('recording_officer_id', rm.id);
          await admin.from('financial_payments').update({ verified_by_id: replacementId }).eq('verified_by_id', rm.id);
          await admin.from('leadership_appointments').update({ member_id: replacementId }).eq('member_id', rm.id);
          await admin.from('leadership_appointments').update({ appointed_by: replacementId }).eq('appointed_by', rm.id);
          await admin.from('member_transfers').update({ member_id: replacementId }).eq('member_id', rm.id);
          await admin.from('member_transfers').update({ approved_by: replacementId }).eq('approved_by', rm.id);
          await admin.from('financial_payments').update({ member_id: replacementId }).eq('member_id', rm.id);
          await admin.from('budgets').update({ submitted_by: replacementId }).eq('submitted_by', rm.id);
          await admin.from('budgets').update({ approved_by: replacementId }).eq('approved_by', rm.id);
          await admin.from('expenditures').update({ requested_by: replacementId }).eq('requested_by', rm.id);
          await admin.from('expenditures').update({ approved_by: replacementId }).eq('approved_by', rm.id);
          await admin.from('governance_proposals').update({ submitted_by: replacementId }).eq('submitted_by', rm.id);
          await admin.from('governance_proposals').update({ reviewed_by: replacementId }).eq('reviewed_by', rm.id);
          await admin.from('governance_proposals').update({ decided_by: replacementId }).eq('decided_by', rm.id);
          await admin.from('governance_votes').delete().eq('member_id', rm.id);
          await admin.from('governance_action_points').update({ assigned_to: replacementId }).eq('assigned_to', rm.id);
          await admin.from('members').delete().eq('id', rm.id);
        }
      }
      for (const m of localMembers) {
        await syncMemberToSupabase(m.id);
      }
    }

    if ((leadCount ?? 0) === 0) {
      const leads = db.prepare(`SELECT id FROM leadership_appointments`).all() as { id: string }[];
      for (const l of leads) await syncLeadershipToSupabase(l.id);
    }

    if ((evtCount ?? 0) === 0) {
      const events = db.prepare(`SELECT id FROM events`).all() as { id: string }[];
      for (const e of events) await resolveEventId(e.id);
    }

    if ((pubCount ?? 0) === 0) {
      const pubs = db.prepare(`SELECT id FROM publications`).all() as { id: string }[];
      for (const p of pubs) await syncPublicationToSupabase(p.id);
    }

    if ((mediaCount ?? 0) === 0) {
      const media = db.prepare(`SELECT id FROM media_items`).all() as { id: string }[];
      for (const m of media) await syncMediaItemToSupabase(m.id);
    }

    if ((campaignCount ?? 0) === 0) {
      const campaigns = db.prepare(`SELECT * FROM fundraising_campaigns`).all() as Record<string, string | number | null>[];
      for (const c of campaigns) {
        const sbBranchId = await resolveBranchId(c.branch_id as string | null);
        await admin.from('fundraising_campaigns').insert({
          title: c.title,
          description: c.description || null,
          target_amount_ghs: Number(c.target_amount_ghs),
          start_date: c.start_date,
          end_date: c.end_date || null,
          branch_id: sbBranchId,
          status: c.status || 'Active',
        });
      }
    }

    // Ensure secretariat_settings policy exists remotely if absent
    await syncGovernancePolicyToSupabase('secretariat_settings');

    if ((bdgCount ?? 0) === 0) {
      const budgets = db.prepare(`SELECT id FROM budgets`).all() as { id: string }[];
      for (const b of budgets) await resolveBudgetId(b.id);
    }

    if ((payCount ?? 0) === 0) {
      const payments = db.prepare(`SELECT id FROM financial_payments`).all() as { id: string }[];
      for (const pay of payments) await syncPaymentToSupabase(pay.id);
    }
    bootstrapDone = true;
  } catch (err) {
    lastSyncError = (err as Error).message;
  }
}

// ----------------------------------------------------------------------------
// SERVER-SIDE ADMIN SYNC OPERATIONS
// ----------------------------------------------------------------------------
export async function syncUploadToSupabaseStorage(params: {
  buffer: Buffer;
  objectName: string;
  mimeType: string;
  isPublic: boolean;
}): Promise<{ publicUrl: string | null; bucket: string; path: string } | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;
  const bucket = params.isPublic ? 'public-media' : 'private-documents';
  const objectPath = `${params.isPublic ? 'uploads' : 'records'}/${params.objectName}`;
  const { error } = await admin.storage.from(bucket).upload(objectPath, params.buffer, {
    contentType: params.mimeType,
    upsert: true,
  });
  if (error) return null;
  if (params.isPublic) {
    const { data } = admin.storage.from(bucket).getPublicUrl(objectPath);
    return { publicUrl: data.publicUrl, bucket, path: objectPath };
  }
  return { publicUrl: null, bucket, path: objectPath };
}

const memberSyncQueues = new Map<string, Promise<void>>();

export function syncMemberToSupabase(localMemberId: string, previousMembershipNumber?: string): Promise<void> {
  const prev = memberSyncQueues.get(localMemberId) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => runSyncMemberToSupabase(localMemberId, previousMembershipNumber));
  memberSyncQueues.set(localMemberId, next);
  return next;
}

async function runSyncMemberToSupabase(localMemberId: string, previousMembershipNumber?: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM members WHERE id = ?`).get(localMemberId) as Record<string, string | null> | undefined;
    if (!row) return;
    const [sbBranchId, sbSubId, sbCatId] = await Promise.all([
      resolveBranchId(row.branch_id),
      resolveSubdivisionId(row.subdivision_id),
      resolveCategoryId(row.category_id),
    ]);
    if (!sbBranchId || !sbSubId || !sbCatId) return;

    const payload = {
      membership_number: row.membership_number,
      qr_token: row.qr_token,
      full_name: row.full_name,
      date_of_birth: row.date_of_birth || null,
      gender: row.gender || null,
      telephone: row.telephone,
      email: row.email || null,
      residential_address: row.residential_address || null,
      photo_storage_path: row.photo_url || null,
      branch_id: sbBranchId,
      subdivision_id: sbSubId,
      category_id: sbCatId,
      membership_status: row.membership_status || 'Active',
      previous_experience: row.previous_experience || null,
      emergency_contact_name: row.emergency_contact_name || null,
      emergency_contact_phone: row.emergency_contact_phone || null,
      card_valid_until: row.card_valid_until || null,
      updated_at: new Date().toISOString(),
    };

    let existingId: string | null = null;
    if (row.qr_token) {
      const { data: byQr } = await admin.from('members').select('id').eq('qr_token', row.qr_token).maybeSingle();
      if (byQr?.id) existingId = byQr.id;
    }
    if (!existingId && previousMembershipNumber && previousMembershipNumber !== row.membership_number) {
      const { data: byOld } = await admin.from('members').select('id').eq('membership_number', previousMembershipNumber).maybeSingle();
      if (byOld?.id) existingId = byOld.id;
    }
    if (!existingId && row.membership_number) {
      const { data: byCur } = await admin.from('members').select('id').eq('membership_number', row.membership_number).maybeSingle();
      if (byCur?.id) existingId = byCur.id;
    }
    if (!existingId && row.email) {
      const { data: byEmail } = await admin.from('members').select('id').eq('email', row.email).maybeSingle();
      if (byEmail?.id) existingId = byEmail.id;
    }

    if (existingId) {
      const { error } = await admin.from('members').update(payload).eq('id', existingId);
      if (error) lastSyncError = error.message;
      return;
    }

    const { error } = await admin.from('members').insert(payload);
    if (error) lastSyncError = error.message;
  } catch (err) {
    lastSyncError = (err as Error).message;
  }
}

export async function syncMemberTransferToSupabase(params: {
  localMemberId: string;
  fromBranchId: string;
  fromSubdivisionId: string;
  toBranchId: string;
  toSubdivisionId: string;
  reason: string;
  approvedByLocalId: string;
}) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const [sbMemberId, sbFromB, sbFromS, sbToB, sbToS, sbApprover] = await Promise.all([
      resolveMemberId(params.localMemberId),
      resolveBranchId(params.fromBranchId),
      resolveSubdivisionId(params.fromSubdivisionId),
      resolveBranchId(params.toBranchId),
      resolveSubdivisionId(params.toSubdivisionId),
      resolveMemberId(params.approvedByLocalId),
    ]);
    if (!sbMemberId || !sbFromB || !sbFromS || !sbToB || !sbToS || !sbApprover) return;
    await admin.from('member_transfers').insert({
      member_id: sbMemberId,
      from_branch_id: sbFromB,
      from_subdivision_id: sbFromS,
      to_branch_id: sbToB,
      to_subdivision_id: sbToS,
      reason: params.reason,
      approved_by: sbApprover,
    });
    await syncMemberToSupabase(params.localMemberId);
  } catch {}
}

export async function syncApplicationToSupabase(localAppId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM membership_applications WHERE id = ?`).get(localAppId) as Record<string, string | null> | undefined;
    if (!row) return;
    const [sbBranchId, sbSubId, sbCatId, sbOfficerId, sbReviewerId, sbApprovedMemberId] = await Promise.all([
      resolveBranchId(row.preferred_branch_id),
      resolveSubdivisionId(row.preferred_subdivision_id),
      resolveCategoryId(row.requested_category_id),
      resolveMemberId(row.created_by_officer_id),
      resolveMemberId(row.reviewing_officer_id),
      resolveMemberId(row.approved_member_id),
    ]);
    if (!sbBranchId || !sbSubId || !sbCatId) return;

    await admin.from('membership_applications').upsert(
      {
        application_ref: row.application_ref,
        source: row.source,
        created_by_officer_id: sbOfficerId,
        full_name: row.full_name,
        date_of_birth: row.date_of_birth || null,
        gender: row.gender || null,
        telephone: row.telephone,
        email: row.email || null,
        residential_address: row.residential_address || null,
        photo_storage_path: row.photo_url || null,
        preferred_branch_id: sbBranchId,
        preferred_subdivision_id: sbSubId,
        requested_category_id: sbCatId,
        previous_experience: row.previous_experience || null,
        emergency_contact_name: row.emergency_contact_name || null,
        emergency_contact_phone: row.emergency_contact_phone || null,
        supporting_doc_path: row.supporting_doc_url || null,
        declaration_accepted: true,
        privacy_consent_accepted: true,
        status: row.status,
        reviewing_officer_id: sbReviewerId,
        reviewed_at: row.reviewed_at || null,
        review_comments: row.review_comments || null,
        approved_member_id: sbApprovedMemberId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'application_ref' }
    );
  } catch {}
}

export async function syncBranchToSupabase(localBranchId: string) {
  await resolveBranchId(localBranchId);
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM branches WHERE id = ?`).get(localBranchId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    await admin
      .from('branches')
      .update({
        name: row.name,
        region: row.region,
        description: row.description,
        is_active: Boolean(row.is_active),
        updated_at: new Date().toISOString(),
      })
      .eq('code', String(row.code));
  } catch {}
}

export async function syncSubdivisionToSupabase(localSubId: string) {
  await resolveSubdivisionId(localSubId);
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM subdivisions WHERE id = ?`).get(localSubId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    const sbBranchId = await resolveBranchId(row.branch_id as string);
    if (!sbBranchId) return;
    await admin
      .from('subdivisions')
      .update({
        name: row.name,
        town_or_community: row.town_or_community,
        region: row.region,
        is_active: Boolean(row.is_active),
        updated_at: new Date().toISOString(),
      })
      .eq('branch_id', sbBranchId)
      .eq('code', String(row.code));
  } catch {}
}

export async function syncLeadershipToSupabase(localAppointmentId: string, replaceLocalAppointmentId?: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    if (replaceLocalAppointmentId) {
      const oldRow = db
        .prepare(`SELECT member_id, portfolio, term_start FROM leadership_appointments WHERE id = ?`)
        .get(replaceLocalAppointmentId) as { member_id: string; portfolio: string; term_start: string } | undefined;
      if (oldRow) {
        const sbOldMemberId = await resolveMemberId(oldRow.member_id);
        if (sbOldMemberId) {
          await admin
            .from('leadership_appointments')
            .update({ status: 'Completed', is_public_approved: false })
            .eq('member_id', sbOldMemberId)
            .eq('portfolio', oldRow.portfolio)
            .eq('term_start', oldRow.term_start);
        }
      }
    }

    const row = db.prepare(`SELECT * FROM leadership_appointments WHERE id = ?`).get(localAppointmentId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    await syncMemberToSupabase(String(row.member_id));

    const [sbMemberId, sbBranchId, sbAppointerId] = await Promise.all([
      resolveMemberId(String(row.member_id)),
      resolveBranchId(row.branch_id as string | null),
      resolveMemberId(row.appointed_by as string | null),
    ]);
    if (!sbMemberId) return;

    const memberPhoto = db.prepare(`SELECT photo_url FROM members WHERE id = ?`).get(String(row.member_id)) as { photo_url: string | null } | undefined;
    const { data: existing } = await admin
      .from('leadership_appointments')
      .select('id')
      .eq('member_id', sbMemberId)
      .eq('portfolio', String(row.portfolio))
      .eq('term_start', String(row.term_start))
      .maybeSingle();

    const payload: Record<string, unknown> = {
      member_id: sbMemberId,
      portfolio: row.portfolio,
      scope_type: row.scope_type || 'national',
      branch_id: sbBranchId,
      term_number: Number(row.term_number || 1),
      term_start: row.term_start,
      term_expiry: row.term_expiry,
      handover_deadline: row.handover_deadline || null,
      oath_signed: Boolean(row.oath_signed),
      oath_signed_at: row.oath_signed_at || null,
      portrait_storage_path: memberPhoto?.photo_url || null,
      biography: row.biography || '',
      is_public_approved: Boolean(row.is_public_approved),
      can_act_for_president: Boolean(row.can_act_for_president),
      status: row.status || 'Active',
      appointed_by: sbAppointerId,
    };

    let writeRes = existing?.id
      ? await admin.from('leadership_appointments').update(payload).eq('id', existing.id)
      : await admin.from('leadership_appointments').insert(payload);

    if (writeRes.error && writeRes.error.message.includes('portrait_storage_path')) {
      const { portrait_storage_path: _omit, ...fallbackPayload } = payload;
      writeRes = existing?.id
        ? await admin.from('leadership_appointments').update(fallbackPayload).eq('id', existing.id)
        : await admin.from('leadership_appointments').insert(fallbackPayload);
    }

    if (writeRes.error) {
      lastSyncError = `leadership write: ${writeRes.error.message}`;
    } else {
      lastSyncError = null;
    }
  } catch (err) {
    lastSyncError = `leadership sync: ${(err as Error).message}`;
  }
}

export async function syncRbacPermissionToSupabase(localRoleId: string, module: string, field: string, value: boolean) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const sbRoleId = await resolveRoleId(localRoleId);
    if (!sbRoleId) return;
    await admin
      .from('role_permissions')
      .upsert({ role_id: sbRoleId, module, [field]: Boolean(value), updated_at: new Date().toISOString() }, { onConflict: 'role_id,module' });
  } catch {}
}

export async function syncMemberRoleToSupabase(
  localMemberId: string,
  localRoleId: string,
  localBranchId?: string | null,
  localSubId?: string | null,
  isActive = true
) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const [sbMemberId, sbRoleId, sbBranchId, sbSubId] = await Promise.all([
      resolveMemberId(localMemberId),
      resolveRoleId(localRoleId),
      resolveBranchId(localBranchId),
      resolveSubdivisionId(localSubId),
    ]);
    if (!sbMemberId || !sbRoleId) return;
    const { data: existing } = await admin
      .from('member_roles')
      .select('id')
      .eq('member_id', sbMemberId)
      .eq('role_id', sbRoleId)
      .maybeSingle();
    if (existing?.id) {
      await admin
        .from('member_roles')
        .update({ branch_id: sbBranchId, subdivision_id: sbSubId, is_active: Boolean(isActive) })
        .eq('id', existing.id);
    } else {
      await admin.from('member_roles').insert({
        member_id: sbMemberId,
        role_id: sbRoleId,
        branch_id: sbBranchId,
        subdivision_id: sbSubId,
        is_active: Boolean(isActive),
      });
    }
  } catch {}
}

export async function syncPaymentToSupabase(localPaymentId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM financial_payments WHERE id = ?`).get(localPaymentId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    const [sbMemberId, sbBranchId, sbRecorderId, sbVerifierId] = await Promise.all([
      resolveMemberId(row.member_id as string | null),
      resolveBranchId(row.branch_id as string | null),
      resolveMemberId(row.recording_officer_id as string | null),
      resolveMemberId(row.verified_by_id as string | null),
    ]);
    await admin.from('financial_payments').upsert(
      {
        receipt_number: row.receipt_number,
        member_id: sbMemberId,
        branch_id: sbBranchId,
        payment_category: row.payment_category,
        amount_ghs: Number(row.amount_ghs),
        currency: row.currency || 'GHS',
        payment_date: row.payment_date,
        payment_method: row.payment_method,
        reference_number: row.reference_number,
        verification_status: row.verification_status,
        recording_officer_id: sbRecorderId,
        verified_by_id: sbVerifierId,
        verified_at: row.verified_at || null,
        notes: row.notes || null,
      },
      { onConflict: 'receipt_number' }
    );
  } catch {}
}

export async function syncBudgetToSupabase(localBudgetId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM budgets WHERE id = ?`).get(localBudgetId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    const sbBudgetId = await resolveBudgetId(localBudgetId);
    if (!sbBudgetId) return;
    const sbApproverId = await resolveMemberId(row.approved_by as string | null);
    await admin
      .from('budgets')
      .update({
        status: row.status,
        approved_amount_ghs: row.approved_amount_ghs != null ? Number(row.approved_amount_ghs) : null,
        approved_by: sbApproverId,
        approved_at: row.approved_at || null,
        review_notes: row.review_notes || null,
      })
      .eq('id', sbBudgetId);
  } catch {}
}

export async function syncExpenditureToSupabase(localExpId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM expenditures WHERE id = ?`).get(localExpId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    const [sbBudgetId, sbBranchId, sbRequesterId, sbApproverId] = await Promise.all([
      resolveBudgetId(String(row.budget_id)),
      resolveBranchId(row.branch_id as string | null),
      resolveMemberId(String(row.requested_by)),
      resolveMemberId(row.approved_by as string | null),
    ]);
    if (!sbBudgetId || !sbRequesterId) return;

    const { data: existing } = await admin
      .from('expenditures')
      .select('id')
      .eq('budget_id', sbBudgetId)
      .eq('description', String(row.description))
      .eq('payee', String(row.payee))
      .maybeSingle();

    const payload = {
      budget_id: sbBudgetId,
      branch_id: sbBranchId,
      description: row.description,
      amount_ghs: Number(row.amount_ghs),
      currency: row.currency || 'GHS',
      expense_date: row.expense_date,
      payee: row.payee,
      receipt_storage_path: row.receipt_url || null,
      receipt_submitted: Boolean(row.receipt_submitted),
      receipt_due_date: row.receipt_due_date,
      status: row.status,
      requested_by: sbRequesterId,
      approved_by: sbApproverId,
      approved_at: row.approved_at || null,
    };
    if (existing?.id) {
      await admin.from('expenditures').update(payload).eq('id', existing.id);
    } else {
      await admin.from('expenditures').insert(payload);
    }
  } catch {}
}

export async function syncEventToSupabase(localEventId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM events WHERE id = ?`).get(localEventId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    const sbEventId = await resolveEventId(localEventId);
    if (!sbEventId) return;
    const sbBranchId = await resolveBranchId(row.branch_id as string | null);
    await admin
      .from('events')
      .update({
        title: row.title,
        description: row.description || '',
        event_date: row.event_date,
        venue: row.venue,
        branch_id: sbBranchId,
        poster_path: row.poster_url || null,
        is_public: Boolean(row.is_public),
        status: row.status,
        registration_open: Boolean(row.registration_open),
        post_event_report: row.post_event_report || null,
        receipts_submitted: Boolean(row.receipts_submitted),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sbEventId);
  } catch {}
}

export async function syncEventAttendanceToSupabase(localEventId: string, localMemberId: string, attendanceStatus: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const [sbEventId, sbMemberId] = await Promise.all([resolveEventId(localEventId), resolveMemberId(localMemberId)]);
    if (!sbEventId || !sbMemberId) return;
    await admin.from('event_registrations').upsert(
      {
        event_id: sbEventId,
        member_id: sbMemberId,
        attendance_status: attendanceStatus,
        checked_in_at: attendanceStatus === 'Present' ? new Date().toISOString() : null,
      },
      { onConflict: 'event_id,member_id' }
    );
  } catch {}
}

export async function syncPublicationToSupabase(localPubId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM publications WHERE id = ?`).get(localPubId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    const sbAuthorId = await resolveMemberId(row.author_id as string | null);
    await admin.from('publications').upsert(
      {
        title: row.title,
        slug: row.slug,
        category: row.category,
        tags: JSON.parse(String(row.tags || '[]')),
        excerpt: row.excerpt,
        body: row.body,
        cover_image_path: row.cover_image_url || null,
        is_featured: Boolean(row.is_featured),
        status: row.status,
        scheduled_for: row.scheduled_for || null,
        published_at: row.published_at || null,
        author_id: sbAuthorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'slug' }
    );
  } catch {}
}

export async function syncMediaItemToSupabase(localMediaId: string, previousFileUrl?: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM media_items WHERE id = ?`).get(localMediaId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    const lookupUrl = previousFileUrl || String(row.file_url);
    const { data: existing } = await admin
      .from('media_items')
      .select('id')
      .eq('storage_path', lookupUrl)
      .maybeSingle();

    if (existing?.id) {
      await admin
        .from('media_items')
        .update({
          title: row.title,
          album_name: row.album_name || 'General Archive',
          media_type: row.media_type,
          bucket_visibility: row.bucket_visibility,
          storage_path: row.file_url,
          mime_type: row.mime_type,
          file_size_bytes: Number(row.file_size_bytes || 1024),
          is_archived: Boolean(row.is_archived),
          caption: row.caption || null,
        })
        .eq('id', existing.id);
      return;
    }

    const [sbEventId, sbUploaderId] = await Promise.all([
      resolveEventId(row.event_id as string | null),
      resolveMemberId(row.uploaded_by as string | null),
    ]);
    await admin.from('media_items').insert({
      title: row.title,
      caption: row.caption || null,
      album_name: row.album_name || 'General Archive',
      media_type: row.media_type,
      bucket_visibility: row.bucket_visibility,
      storage_path: row.file_url,
      mime_type: row.mime_type,
      file_size_bytes: Number(row.file_size_bytes || 1024),
      event_id: sbEventId,
      is_archived: Boolean(row.is_archived),
      uploaded_by: sbUploaderId,
    });
  } catch {}
}

export async function syncDuesScheduleToSupabase(localScheduleId: string, actorLocalId?: string | null) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM dues_schedules WHERE id = ?`).get(localScheduleId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    const [sbCatId, sbCreatorId] = await Promise.all([
      resolveCategoryId(row.category_id as string | null),
      resolveMemberId(actorLocalId || null),
    ]);
    if (!sbCatId) return;
    await admin.from('dues_schedules').insert({
      title: row.title,
      category_id: sbCatId,
      period_label: row.period_label,
      amount_ghs: Number(row.amount_ghs),
      due_date: row.due_date,
      is_active: Boolean(row.is_active ?? 1),
      created_by: sbCreatorId,
    });
  } catch {}
}

export async function syncGovernanceMeetingToSupabase(localMeetingId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM governance_meetings WHERE id = ?`).get(localMeetingId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    const [sbBranchId, sbCreatorId] = await Promise.all([
      resolveBranchId(row.branch_id as string | null),
      resolveMemberId(row.created_by as string | null),
    ]);
    const { data: existing } = await admin
      .from('governance_meetings')
      .select('id')
      .eq('title', String(row.title))
      .eq('scheduled_at', String(row.scheduled_at))
      .maybeSingle();

    const payload = {
      title: row.title,
      meeting_type: row.meeting_type,
      branch_id: sbBranchId,
      scheduled_at: row.scheduled_at,
      venue: row.venue,
      agenda: row.agenda,
      minutes_text: row.minutes_text || null,
      quorum_required: Number(row.quorum_required || 5),
      attendees_count: Number(row.attendees_count || 0),
      status: row.status || 'Scheduled',
      created_by: sbCreatorId,
    };

    if (existing?.id) {
      await admin.from('governance_meetings').update(payload).eq('id', existing.id);
    } else {
      await admin.from('governance_meetings').insert(payload);
    }
  } catch {}
}

export async function syncGovernanceProposalToSupabase(localProposalId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM governance_proposals WHERE id = ?`).get(localProposalId) as Record<string, string | number | null> | undefined;
    if (!row) return;
    const [sbSubmitterId, sbDeciderId] = await Promise.all([
      resolveMemberId(row.submitted_by as string | null),
      resolveMemberId(row.decided_by as string | null),
    ]);
    if (!sbSubmitterId) return;
    await admin.from('governance_proposals').upsert(
      {
        reference_code: row.reference_code,
        title: row.title,
        proposal_type: row.proposal_type,
        description: row.description,
        submitted_by: sbSubmitterId,
        status: row.status,
        votes_for: Number(row.votes_for || 0),
        votes_against: Number(row.votes_against || 0),
        votes_abstain: Number(row.votes_abstain || 0),
        decided_by: sbDeciderId,
        decision_notes: row.decision_notes || null,
        decided_at: row.decided_at || null,
      },
      { onConflict: 'reference_code' }
    );
  } catch {}
}

export async function syncGovernancePolicyToSupabase(policyKey: string, actorLocalId?: string | null) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM governance_policies WHERE key = ?`).get(policyKey) as Record<string, string | number | null> | undefined;
    if (!row) return;
    const sbUpdaterId = await resolveMemberId(actorLocalId || null);
    await admin.from('governance_policies').upsert(
      {
        key: policyKey,
        category: String(row.category || 'operations'),
        label: String(row.label || policyKey),
        value_json: JSON.parse(String(row.value_json || '{}')),
        requires_constitutional_confirmation: Boolean(row.requires_constitutional_confirmation),
        confirmed: Boolean(row.confirmed),
        updated_by: sbUpdaterId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
  } catch {}
}

export async function syncInquiryToSupabase(localInquiryId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const row = db.prepare(`SELECT * FROM member_feedback_and_inquiries WHERE id = ?`).get(localInquiryId) as Record<string, string | null> | undefined;
    if (!row) return;
    const [sbMemberId, sbResponderId] = await Promise.all([
      resolveMemberId(row.member_id),
      resolveMemberId(row.responded_by),
    ]);
    const { data: existing } = await admin
      .from('member_feedback_and_inquiries')
      .select('id')
      .eq('sender_name', String(row.sender_name))
      .eq('subject', String(row.subject))
      .maybeSingle();

    const payload = {
      member_id: sbMemberId,
      sender_name: row.sender_name,
      sender_email: row.sender_email || null,
      submission_type: row.submission_type,
      subject: row.subject,
      message: row.message,
      status: row.status,
      response_text: row.response_text || null,
      responded_by: sbResponderId,
    };

    if (existing?.id) {
      await admin.from('member_feedback_and_inquiries').update(payload).eq('id', existing.id);
    } else {
      await admin.from('member_feedback_and_inquiries').insert(payload);
    }
  } catch {}
}

export async function syncAuditToSupabase(
  actorLocalId: string | null,
  action: string,
  targetTable: string,
  details: Record<string, unknown> = {}
) {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  try {
    const sbActorId = await resolveMemberId(actorLocalId);
    await admin.from('audit_logs').insert({
      actor_member_id: sbActorId,
      action,
      target_table: targetTable,
      details,
    });
  } catch {}
}
