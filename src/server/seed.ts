import crypto from 'node:crypto';
import { db, hashPassword, uid } from './db.ts';

function ensureSecretariatSettingsPolicy() {
  const defaultSecretariatSettings = {
    secretariat_address: 'Community 1 Society Hall, Tema, Ghana (Placeholder — Update in Admin)',
    secretariat_email: 'secretariat@lasupadora.org',
    secretariat_phone: 'Not yet supplied — Update in Admin',
    office_hours: 'Saturdays & Meeting Days (Editable by Admin)',
    show_demo_notice: true,
    demo_notice_text:
      'Stage 1 Development Preview: Sample announcements, events, fundraising figures, leadership bios, and contact details below are demonstration content in development pending official Secretariat confirmation.',
  };
  db.prepare(
    `INSERT OR IGNORE INTO governance_policies (key, category, label, value_json, requires_constitutional_confirmation, confirmed)
     VALUES (?, ?, ?, ?, 0, 0)`
  ).run(
    'secretariat_settings',
    'operations',
    'Secretariat Contact & Demonstration Notice',
    JSON.stringify(defaultSecretariatSettings)
  );
}

export function seedIfEmpty() {
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM branches').get() as { cnt: number };
  if (countRow.cnt > 0) {
    ensureSecretariatSettingsPolicy();
    // Ensure Super Admin retains configured email without reverting custom Membership IDs
    const existingAdmin = db
      .prepare(
        `SELECT m.id, m.email FROM members m
         JOIN member_roles mr ON mr.member_id = m.id
         JOIN roles r ON r.id = mr.role_id
         WHERE r.slug = 'super_admin'
         LIMIT 1`
      )
      .get() as { id: string; email: string | null } | undefined;
    if (existingAdmin && existingAdmin.email !== 'frnacole@gmail.com') {
      db.prepare(`UPDATE members SET email = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(
        'frnacole@gmail.com',
        hashPassword('Manlibha'),
        existingAdmin.id
      );
    }
    return;
  }

  db.exec('BEGIN');
  try {
    // 1. Branches
    const temaId = uid();
    const outsideId = uid();
    db.prepare(
      `INSERT INTO branches (id, code, name, branch_type, region, description) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(temaId, 'TM', 'Tema Branch', 'tema', 'Greater Accra', 'Founding branch covering Tema Communities 1 through 25.');
    db.prepare(
      `INSERT INTO branches (id, code, name, branch_type, region, description) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(outsideId, 'OT', 'Outside Tema Branch', 'outside_tema', 'National & Regional', 'Founding branch serving towns, communities, and regions outside Tema.');

    // 2. Subdivisions (Tema Communities 1-25 + Outside Tema towns)
    const temaSubIds: Record<number, string> = {};
    const insertSub = db.prepare(
      `INSERT INTO subdivisions (id, branch_id, code, name, subdivision_type, town_or_community, region) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (let i = 1; i <= 25; i++) {
      const sid = uid();
      temaSubIds[i] = sid;
      insertSub.run(sid, temaId, `C${i}`, `Community ${i}`, 'community', `Community ${i}`, 'Greater Accra');
    }
    const ashId = uid();
    const accId = uid();
    const kumId = uid();
    const takId = uid();
    const capId = uid();
    insertSub.run(ashId, outsideId, 'ASH-01', 'Ashaiman', 'town', 'Ashaiman', 'Greater Accra');
    insertSub.run(accId, outsideId, 'ACC-01', 'Accra Metro (Osu / Jamestown)', 'town', 'Accra', 'Greater Accra');
    insertSub.run(kumId, outsideId, 'KUM-01', 'Kumasi Central', 'town', 'Kumasi', 'Ashanti');
    insertSub.run(takId, outsideId, 'TAK-01', 'Sekondi-Takoradi', 'town', 'Takoradi', 'Western');
    insertSub.run(capId, outsideId, 'CAP-01', 'Cape Coast', 'town', 'Cape Coast', 'Central');

    // 3. Membership Categories
    const catJunior = uid();
    const catSenior = uid();
    const catOfficer = uid();
    const insertCat = db.prepare(
      `INSERT INTO membership_categories (id, code, name, min_age, max_age, annual_dues_ghs, monthly_dues_ghs, eligibility_notes, requires_policy_confirmation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertCat.run(catJunior, 'JUNIOR', 'Junior', 8, 17, 60, 5, 'Youth masqueraders aged 8-17 (guardian consent required). Pending Constitutional confirmation.', 1);
    insertCat.run(catSenior, 'SENIOR', 'Senior', 18, null, 180, 15, 'Full ordinary adult members aged 18 and above. Pending Constitutional confirmation.', 1);
    insertCat.run(catOfficer, 'OFFICER', 'Officers', 21, null, 240, 20, 'Serving executive, branch, and committee officers.', 1);

    // 4. 13 Roles + Permission Matrix
    const roleDefs = [
      { slug: 'super_admin', name: 'Super Administrator', scope: 'national', constOffice: 0, desc: 'Technical configuration and RBAC setup; cannot override constitutional governance votes or bypass financial gates.' },
      { slug: 'society_admin', name: 'Society Administrator', scope: 'national', constOffice: 0, desc: 'National membership register, applications, and communications.' },
      { slug: 'president', name: 'President', scope: 'national', constOffice: 1, desc: 'Head of Executive Council; constitutional oversight and approvals.' },
      { slug: 'general_secretary', name: 'General Secretary', scope: 'national', constOffice: 1, desc: 'Chief Administrative Officer; authorized to act in the President absence per Society rules.' },
      { slug: 'secretary', name: 'Secretary', scope: 'national', constOffice: 1, desc: 'Meeting minutes, official records, and correspondence.' },
      { slug: 'treasurer', name: 'Treasurer', scope: 'national', constOffice: 1, desc: 'Dues schedules, payment verification, budgets, and expenditure accountability.' },
      { slug: 'organizer', name: 'Organizer', scope: 'national', constOffice: 1, desc: 'Events, parades, venues, committees, and attendance coordination.' },
      { slug: 'costume_coordinator', name: 'Costume Coordinator', scope: 'national', constOffice: 1, desc: 'Masquerade regalia, costume inventory, and event preparation.' },
      { slug: 'band_leader', name: 'Band Leader', scope: 'national', constOffice: 1, desc: 'Brass band, drummers, and musical rehearsals.' },
      { slug: 'branch_leader', name: 'Branch Leader', scope: 'branch', constOffice: 1, desc: 'Branch-scoped membership, applications, events, and branch finances.' },
      { slug: 'subdivision_officer', name: 'Subdivision Officer', scope: 'subdivision', constOffice: 0, desc: 'Subdivision-scoped community/town member coordination and attendance.' },
      { slug: 'member', name: 'Member', scope: 'self', constOffice: 0, desc: 'Approved member with secure access to personal portal and ID card.' },
      { slug: 'public_applicant', name: 'Public Applicant', scope: 'public', constOffice: 0, desc: 'Public applicant submitting membership requests.' },
    ];

    const roleIds: Record<string, string> = {};
    const insRole = db.prepare(`INSERT INTO roles (id, slug, display_name, scope_level, is_constitutional_office, description) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const r of roleDefs) {
      const id = uid();
      roleIds[r.slug] = id;
      insRole.run(id, r.slug, r.name, r.scope, r.constOffice, r.desc);
    }

    const modules = ['membership', 'applications', 'branches', 'leadership', 'rbac', 'finance', 'events', 'publications', 'gallery', 'governance', 'reports', 'inquiries'];
    const insPerm = db.prepare(
      `INSERT INTO role_permissions (id, role_id, module, can_view, can_create, can_edit, can_approve, can_delete, can_export, can_manage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const grantMatrix: Record<string, Record<string, number[]>> = {
      // [view, create, edit, approve, delete, export, manage]
      super_admin: {
        membership: [1, 1, 1, 0, 0, 1, 1],
        applications: [1, 1, 1, 0, 0, 1, 1],
        branches: [1, 1, 1, 1, 0, 1, 1],
        leadership: [1, 1, 1, 0, 0, 1, 1],
        rbac: [1, 1, 1, 1, 0, 1, 1],
        finance: [1, 0, 0, 0, 0, 1, 0], // Cannot unilaterally approve budgets/expenditures
        events: [1, 1, 1, 0, 0, 1, 1],
        publications: [1, 1, 1, 0, 0, 1, 1],
        gallery: [1, 1, 1, 0, 0, 1, 1],
        governance: [1, 0, 0, 0, 0, 1, 0], // Cannot override constitutional governance
        reports: [1, 0, 0, 0, 0, 1, 1],
        inquiries: [1, 1, 1, 0, 0, 1, 1],
      },
      society_admin: {
        membership: [1, 1, 1, 1, 0, 1, 1],
        applications: [1, 1, 1, 1, 0, 1, 1],
        branches: [1, 1, 1, 0, 0, 1, 1],
        leadership: [1, 1, 1, 0, 0, 1, 1],
        rbac: [1, 0, 0, 0, 0, 0, 0],
        finance: [1, 1, 0, 0, 0, 1, 0],
        events: [1, 1, 1, 1, 0, 1, 1],
        publications: [1, 1, 1, 1, 0, 1, 1],
        gallery: [1, 1, 1, 1, 0, 1, 1],
        governance: [1, 1, 1, 0, 0, 1, 1],
        reports: [1, 0, 0, 0, 0, 1, 1],
        inquiries: [1, 1, 1, 1, 0, 1, 1],
      },
      president: {
        membership: [1, 0, 1, 1, 0, 1, 1],
        applications: [1, 1, 1, 1, 0, 1, 1],
        branches: [1, 1, 1, 1, 0, 1, 1],
        leadership: [1, 1, 1, 1, 0, 1, 1],
        rbac: [1, 0, 0, 0, 0, 0, 0],
        finance: [1, 0, 0, 1, 0, 1, 0],
        events: [1, 1, 1, 1, 0, 1, 1],
        publications: [1, 1, 1, 1, 0, 1, 1],
        gallery: [1, 1, 1, 1, 0, 1, 1],
        governance: [1, 1, 1, 1, 0, 1, 1],
        reports: [1, 0, 0, 0, 0, 1, 1],
        inquiries: [1, 1, 1, 1, 0, 1, 1],
      },
      general_secretary: {
        membership: [1, 1, 1, 1, 0, 1, 1],
        applications: [1, 1, 1, 1, 0, 1, 1],
        branches: [1, 1, 1, 1, 0, 1, 1],
        leadership: [1, 1, 1, 1, 0, 1, 1],
        rbac: [1, 0, 0, 0, 0, 0, 0],
        finance: [1, 1, 0, 1, 0, 1, 0],
        events: [1, 1, 1, 1, 0, 1, 1],
        publications: [1, 1, 1, 1, 0, 1, 1],
        gallery: [1, 1, 1, 1, 0, 1, 1],
        governance: [1, 1, 1, 1, 0, 1, 1],
        reports: [1, 0, 0, 0, 0, 1, 1],
        inquiries: [1, 1, 1, 1, 0, 1, 1],
      },
      secretary: {
        membership: [1, 1, 1, 0, 0, 1, 0],
        applications: [1, 1, 1, 0, 0, 1, 0],
        branches: [1, 0, 0, 0, 0, 1, 0],
        leadership: [1, 1, 1, 0, 0, 1, 0],
        publications: [1, 1, 1, 1, 0, 1, 1],
        gallery: [1, 1, 1, 0, 0, 0, 0],
        governance: [1, 1, 1, 0, 0, 1, 1],
        events: [1, 1, 1, 0, 0, 1, 0],
        reports: [1, 0, 0, 0, 0, 1, 0],
        inquiries: [1, 1, 1, 1, 0, 1, 1],
      },
      treasurer: {
        membership: [1, 0, 0, 0, 0, 1, 0],
        finance: [1, 1, 1, 1, 0, 1, 1],
        events: [1, 0, 0, 0, 0, 1, 0],
        governance: [1, 1, 0, 0, 0, 1, 0],
        reports: [1, 0, 0, 0, 0, 1, 1],
      },
      organizer: {
        membership: [1, 0, 0, 0, 0, 0, 0],
        events: [1, 1, 1, 1, 0, 1, 1],
        gallery: [1, 1, 1, 0, 0, 0, 1],
        finance: [1, 1, 0, 0, 0, 0, 0],
        reports: [1, 0, 0, 0, 0, 1, 0],
      },
      costume_coordinator: {
        events: [1, 0, 1, 0, 0, 0, 0],
        gallery: [1, 1, 1, 0, 0, 0, 1],
        finance: [1, 1, 0, 0, 0, 0, 0],
      },
      band_leader: {
        events: [1, 1, 1, 0, 0, 0, 0],
        gallery: [1, 1, 0, 0, 0, 0, 0],
        membership: [1, 0, 0, 0, 0, 0, 0],
      },
      branch_leader: {
        membership: [1, 1, 1, 0, 0, 1, 1],
        applications: [1, 1, 1, 1, 0, 1, 0],
        branches: [1, 0, 1, 0, 0, 0, 0],
        events: [1, 1, 1, 0, 0, 1, 1],
        finance: [1, 1, 0, 0, 0, 1, 0],
        gallery: [1, 1, 1, 0, 0, 0, 0],
        governance: [1, 1, 0, 0, 0, 0, 0],
        reports: [1, 0, 0, 0, 0, 1, 0],
        inquiries: [1, 1, 1, 0, 0, 0, 0],
      },
      subdivision_officer: {
        membership: [1, 0, 0, 0, 0, 0, 0],
        applications: [1, 1, 0, 0, 0, 0, 0],
        events: [1, 0, 1, 0, 0, 0, 0],
        finance: [1, 1, 0, 0, 0, 0, 0],
      },
    };

    for (const r of roleDefs) {
      const rId = roleIds[r.slug];
      for (const mod of modules) {
        const p = grantMatrix[r.slug]?.[mod] ?? [0, 0, 0, 0, 0, 0, 0];
        insPerm.run(uid(), rId, mod, p[0], p[1], p[2], p[3], p[4], p[5], p[6]);
      }
    }

    // 5. Configurable Constitutional & Financial Governance Policies
    const insPolicy = db.prepare(
      `INSERT INTO governance_policies (key, category, label, value_json, requires_constitutional_confirmation, confirmed) VALUES (?, ?, ?, ?, ?, ?)`
    );
    insPolicy.run('term_limits', 'leadership', 'Executive Term Limits & 14-Day Handover', JSON.stringify({ max_years_per_term: 2, max_consecutive_terms: 2, handover_days: 14, oath_required: true }), 1, 0);
    insPolicy.run('financial_controls', 'finance', 'Financial Control Gates (GHS)', JSON.stringify({ currency: 'GHS', no_budget_no_approval: true, no_accounts_no_next_funding: true, budget_submission_weeks_before_event: 4, receipt_submission_days_after_event: 7 }), 1, 1);
    insPolicy.run('application_fields', 'membership', 'Membership Application Field Rules', JSON.stringify({ require_dob: true, require_gender: false, require_photo: false, require_address: true, require_emergency_contact: true, require_supporting_doc: false, allow_officer_exception: false }), 1, 0);
    insPolicy.run('voting_rules', 'governance', 'Constitutional Quorum & Voting Thresholds', JSON.stringify({ quorum_percentage: 50, simple_majority_percent: 51, constitutional_amendment_percent: 67 }), 1, 0);
    ensureSecretariatSettingsPolicy();

    // 6. Seed Members & Accounts (default password for test accounts: "Lasupadora2026!")
    const passHash = hashPassword('Lasupadora2026!');
    const insMember = db.prepare(
      `INSERT INTO members (id, membership_number, qr_token, full_name, date_of_birth, gender, telephone, email, password_hash, residential_address, branch_id, subdivision_id, category_id, membership_status, previous_experience, emergency_contact_name, emergency_contact_phone, registration_date, approved_at, card_valid_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
    );
    const insMemRole = db.prepare(`INSERT INTO member_roles (id, member_id, role_id, branch_id, subdivision_id) VALUES (?, ?, ?, ?, ?)`);

    const mPres = uid();
    const mGenSec = uid();
    const mTreas = uid();
    const mTemaLeader = uid();
    const mOutsideLeader = uid();
    const mSuperAdmin = uid();
    const mOrg = uid();
    const mCostume = uid();
    const mBand = uid();
    const mOrdinary1 = uid();
    const mOrdinary2 = uid();
    const mJunior1 = uid();

    const token = () => crypto.randomBytes(16).toString('hex');

    insMember.run(mPres, 'LSMS-TM-01-001', token(), 'Nii Armah Mensah', '1984-05-14', 'Male', '+233 24 410 1101', 'president@lasupadora.org', passHash, 'Community 1 Site 4, Tema', temaId, temaSubIds[1], catOfficer, 'Active', '15 years Tema traditional masquerade lead', 'Abena Mensah', '+233 24 410 9901', '2024-01-10', '2027-12-31');
    insMember.run(mGenSec, 'LSMS-TM-04-001', token(), 'Akosua Boateng', '1988-09-22', 'Female', '+233 24 410 1102', 'gensec@lasupadora.org', passHash, 'Community 4 Block B, Tema', temaId, temaSubIds[4], catOfficer, 'Active', '10 years society administration & heritage organizing', 'Kwame Boateng', '+233 24 410 9902', '2024-01-12', '2027-12-31');
    insMember.run(mTreas, 'LSMS-TM-02-001', token(), 'Kofi Osei-Bonsu', '1986-03-08', 'Male', '+233 24 410 1103', 'treasurer@lasupadora.org', passHash, 'Community 2, Tema', temaId, temaSubIds[2], catOfficer, 'Active', 'Chartered accounting & community dues stewardship', 'Efua Osei', '+233 24 410 9903', '2024-01-15', '2027-12-31');
    insMember.run(mTemaLeader, 'LSMS-TM-05-001', token(), 'Samuel Tetteh', '1985-11-30', 'Male', '+233 24 410 1104', 'tema.leader@lasupadora.org', passHash, 'Community 5, Tema', temaId, temaSubIds[5], catOfficer, 'Active', 'Tema carnival procession coordinator', 'Grace Tetteh', '+233 24 410 9904', '2024-02-01', '2027-12-31');
    insMember.run(mOutsideLeader, 'LSMS-OT-001', token(), 'Yaw Addo-Kufuor', '1987-07-19', 'Male', '+233 24 410 1105', 'outside.leader@lasupadora.org', passHash, 'Main Station Road, Ashaiman', outsideId, ashId, catOfficer, 'Active', 'Regional masquerade coordination', 'Esi Addo', '+233 24 410 9905', '2024-02-10', '2027-12-31');
    const superAdminPassHash = hashPassword('Manlibha');
    insMember.run(mSuperAdmin, 'LSMS-TM-11-001', token(), 'Daniel Kwarteng', '1991-02-11', 'Male', '+233 24 410 1106', 'frnacole@gmail.com', superAdminPassHash, 'Community 11, Tema', temaId, temaSubIds[11], catOfficer, 'Active', 'Systems administration & digital governance', 'Mavis Kwarteng', '+233 24 410 9906', '2024-02-15', '2027-12-31');
    insMember.run(mOrg, 'LSMS-TM-07-001', token(), 'Emmanuel Lartey', '1990-06-18', 'Male', '+233 24 410 1107', 'organizer@lasupadora.org', passHash, 'Community 7, Tema', temaId, temaSubIds[7], catOfficer, 'Active', 'Parade logistics & route marshaling', 'Doris Lartey', '+233 24 410 9907', '2024-03-01', '2027-12-31');
    insMember.run(mCostume, 'LSMS-TM-03-001', token(), 'Beatrice Ashie', '1989-12-03', 'Female', '+233 24 410 1108', 'costume@lasupadora.org', passHash, 'Community 3, Tema', temaId, temaSubIds[3], catOfficer, 'Active', 'Master artisan of pleated ruffs and feathered masks', 'Isaac Ashie', '+233 24 410 9908', '2024-03-05', '2027-12-31');
    insMember.run(mBand, 'LSMS-TM-09-001', token(), 'Joseph Nkrumah', '1983-08-25', 'Male', '+233 24 410 1109', 'band@lasupadora.org', passHash, 'Community 9, Tema', temaId, temaSubIds[9], catOfficer, 'Active', 'Brass trumpet & coastal rhythm director', 'Mary Nkrumah', '+233 24 410 9909', '2024-03-10', '2027-12-31');
    insMember.run(mOrdinary1, 'LSMS-TM-08-001', token(), 'Kwabena Owusu', '1996-04-12', 'Male', '+233 24 410 1110', 'member@lasupadora.org', passHash, 'Community 8, Tema', temaId, temaSubIds[8], catSenior, 'Active', '4 years masquerader', 'Comfort Owusu', '+233 24 410 9910', '2025-01-18', '2027-12-31');
    insMember.run(mOrdinary2, 'LSMS-OT-002', token(), 'Adwoa Mansa', '1995-10-05', 'Female', '+233 24 410 1111', 'adwoa.mansa@lasupadora.org', passHash, 'Osu Oxford Street, Accra', outsideId, accId, catSenior, 'Active', 'Cultural dancer & masquerade troupe', 'Kweku Mansa', '+233 24 410 9911', '2025-04-20', '2027-12-31');
    insMember.run(mJunior1, 'LSMS-TM-12-001', token(), 'Kofi Junior Mensah', '2011-01-15', 'Male', '+233 24 410 1112', 'junior@lasupadora.org', passHash, 'Community 12, Tema', temaId, temaSubIds[12], catJunior, 'Active', 'Junior brass percussion apprentice', 'Nii Mensah', '+233 24 410 9912', '2025-09-01', '2027-12-31');

    insMemRole.run(uid(), mPres, roleIds.president, null, null);
    insMemRole.run(uid(), mGenSec, roleIds.general_secretary, null, null);
    insMemRole.run(uid(), mTreas, roleIds.treasurer, null, null);
    insMemRole.run(uid(), mTemaLeader, roleIds.branch_leader, temaId, null);
    insMemRole.run(uid(), mOutsideLeader, roleIds.branch_leader, outsideId, null);
    insMemRole.run(uid(), mSuperAdmin, roleIds.super_admin, null, null);
    insMemRole.run(uid(), mOrg, roleIds.organizer, null, null);
    insMemRole.run(uid(), mCostume, roleIds.costume_coordinator, null, null);
    insMemRole.run(uid(), mBand, roleIds.band_leader, null, null);
    insMemRole.run(uid(), mOrdinary1, roleIds.member, temaId, temaSubIds[8]);
    insMemRole.run(uid(), mOrdinary2, roleIds.member, outsideId, accId);
    insMemRole.run(uid(), mJunior1, roleIds.member, temaId, temaSubIds[12]);

    // 7. Executive & Branch Leadership Appointments
    const insLead = db.prepare(
      `INSERT INTO leadership_appointments (id, member_id, portfolio, scope_type, branch_id, term_number, term_start, term_expiry, handover_deadline, oath_signed, oath_signed_at, biography, is_public_approved, can_act_for_president, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`
    );
    insLead.run(uid(), mPres, 'President', 'national', null, 1, '2025-01-01', '2026-12-31', '2027-01-14', 1, 'Presides over Executive Council meetings and safeguards the constitutional heritage of LASUPADORA Masqueraders Society.', 1, 0, 'Active');
    insLead.run(uid(), mGenSec, 'General Secretary', 'national', null, 1, '2025-01-01', '2026-12-31', '2027-01-14', 1, 'Oversees Society administration, branch coordination, and acts for the President when formally authorized.', 1, 1, 'Active');
    insLead.run(uid(), mTreas, 'Treasurer', 'national', null, 1, '2025-01-01', '2026-12-31', '2027-01-14', 1, 'Stewards Society funds in GHS, enforces budget approvals, and audits seven-day receipt accountability.', 1, 0, 'Active');
    insLead.run(uid(), mOrg, 'Organizer', 'national', null, 1, '2025-01-01', '2026-12-31', '2027-01-14', 1, 'Coordinates Society processions, community routes, and branch mobilization.', 1, 0, 'Active');
    insLead.run(uid(), mCostume, 'Costume Coordinator', 'national', null, 1, '2025-01-01', '2026-12-31', '2027-01-14', 1, 'Directs traditional mask craftsmanship, pleated ruff standards, and regalia preservation.', 1, 0, 'Active');
    insLead.run(uid(), mBand, 'Band Leader', 'national', null, 1, '2025-01-01', '2026-12-31', '2027-01-14', 1, 'Leads brass instrumentation, coastal rhythms, and musical discipline across branches.', 1, 0, 'Active');
    insLead.run(uid(), mTemaLeader, 'Tema Branch Leader', 'branch', temaId, 1, '2025-02-01', '2027-01-31', '2027-02-14', 1, 'Coordinates Tema Communities 1-25 subdivisions and local community engagement.', 1, 0, 'Active');
    insLead.run(uid(), mOutsideLeader, 'Outside Tema Branch Leader', 'branch', outsideId, 1, '2025-02-01', '2027-01-31', '2027-02-14', 1, 'Leads regional town subdivisions across Ashaiman, Accra, Kumasi, Takoradi, and Cape Coast.', 1, 0, 'Active');

    // 8. Pending Applications (for immediate Admin review verification)
    const insApp = db.prepare(
      `INSERT INTO membership_applications (id, application_ref, source, full_name, date_of_birth, gender, telephone, email, residential_address, preferred_branch_id, preferred_subdivision_id, requested_category_id, previous_experience, emergency_contact_name, emergency_contact_phone, status, review_comments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const app1 = uid();
    const app2 = uid();
    insApp.run(app1, 'APP-2026-1001', 'public_web', 'Selorm Dzifa Agbeko', '1998-07-14', 'Female', '+233 55 812 3401', 'selorm.agbeko@example.com', 'Community 6, Tema', temaId, temaSubIds[6], catSenior, 'Performed in coastal cultural festivals', 'Kofi Agbeko', '+233 24 812 3400', 'Pending Review', null);
    insApp.run(app2, 'APP-2026-1002', 'officer_assisted', 'Nana Yaw Peprah', '1993-11-02', 'Male', '+233 20 934 2210', 'ny.peprah@example.com', 'Adum Street, Kumasi', outsideId, kumId, catSenior, 'Brass horn player for 6 years', 'Akua Peprah', '+233 20 934 2211', 'Corrections Requested', 'Please confirm residential landmark and attach emergency phone.');

    db.prepare(`INSERT INTO application_decision_history (id, application_id, previous_status, new_status, actor_member_id, notes) VALUES (?, ?, ?, ?, ?, ?)`).run(
      uid(), app2, 'Pending Review', 'Corrections Requested', mOutsideLeader, 'Requested landmark clarification from Kumasi applicant.'
    );

    // 9. Events & Attendance
    const evt1 = uid();
    const evt2 = uid();
    const evt3 = uid();
    const insEvt = db.prepare(
      `INSERT INTO events (id, title, slug, description, event_date, venue, branch_id, poster_url, registration_open, status, is_public, organising_committee, post_event_report, receipt_submission_deadline, receipts_submitted, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insEvt.run(evt1, 'LASUPADORA Annual Tema Heritage Parade 2026', 'tema-heritage-parade-2026', 'Flagship cultural masquerade procession across Tema Communities 1 through 11 featuring full brass accompaniment, junior apprentices, and traditional regalia display.', '2026-12-26T09:00:00Z', 'Tema Community 1 Centre & Harbour Boulevard', temaId, '/media/event_tema_carnival.jpg', 1, 'Upcoming', 1, JSON.stringify(['Emmanuel Lartey (Organizer)', 'Beatrice Ashie (Costumes)', 'Joseph Nkrumah (Band)']), null, '2027-01-02', 0, mOrg);
    insEvt.run(evt2, 'Regional Masquerade Craft & Rehearsal Clinic', 'regional-craft-clinic-2026', 'Hands-on costume restoration, pleated ruff tailoring, and brass ensemble alignment for Outside Tema subdivisions.', '2026-11-28T10:00:00Z', 'Ashaiman Cultural Grounds', outsideId, '/media/news_youth_rehearsal.jpg', 1, 'Upcoming', 1, JSON.stringify(['Yaw Addo-Kufuor', 'Beatrice Ashie']), null, '2026-12-05', 0, mOutsideLeader);
    insEvt.run(evt3, 'Mid-Year Unity Durbar & Cultural Showcase', 'midyear-unity-durbar-2026', 'Completed mid-year cultural gathering celebrating equal membership fellowship across Tema and Outside Tema branches.', '2026-07-18T11:00:00Z', 'Tema Community 4 Park', temaId, '/media/hero_masquerade_procession.jpg', 0, 'Completed', 1, JSON.stringify(['Emmanuel Lartey', 'Samuel Tetteh']), 'Over 180 masqueraders and supporters participated peacefully. Full accounts settled within 5 days.', '2026-07-25', 1, mOrg);

    db.prepare(`INSERT INTO event_registrations (id, event_id, member_id, attendance_status) VALUES (?, ?, ?, ?)`).run(uid(), evt1, mOrdinary1, 'Registered');
    db.prepare(`INSERT INTO event_registrations (id, event_id, member_id, attendance_status) VALUES (?, ?, ?, ?)`).run(uid(), evt1, mOrdinary2, 'Registered');
    db.prepare(`INSERT INTO event_registrations (id, event_id, member_id, attendance_status, checked_in_by, checked_in_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`).run(uid(), evt3, mOrdinary1, 'Present', mOrg);
    db.prepare(`INSERT INTO event_registrations (id, event_id, member_id, attendance_status, checked_in_by, checked_in_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`).run(uid(), evt3, mPres, 'Present', mOrg);

    // 10. Finance: Dues Schedules, Campaigns, Budgets, Payments, Expenditures (GHS)
    const duesSenior = uid();
    const duesJunior = uid();
    const duesOfficer = uid();
    db.prepare(`INSERT INTO dues_schedules (id, title, category_id, period_label, amount_ghs, due_date) VALUES (?, ?, ?, ?, ?, ?)`).run(duesSenior, '2026 Annual Senior Membership Dues', catSenior, '2026 Annual', 180.00, '2026-12-31');
    db.prepare(`INSERT INTO dues_schedules (id, title, category_id, period_label, amount_ghs, due_date) VALUES (?, ?, ?, ?, ?, ?)`).run(duesJunior, '2026 Annual Junior Membership Dues', catJunior, '2026 Annual', 60.00, '2026-12-31');
    db.prepare(`INSERT INTO dues_schedules (id, title, category_id, period_label, amount_ghs, due_date) VALUES (?, ?, ?, ?, ?, ?)`).run(duesOfficer, '2026 Annual Officer Dues', catOfficer, '2026 Annual', 240.00, '2026-12-31');

    const camp1 = uid();
    db.prepare(`INSERT INTO fundraising_campaigns (id, title, description, target_amount_ghs, start_date, end_date, branch_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      camp1, '2026 Brass Instruments & Costume Heritage Fund', 'Community fundraising to refurbish brass trumpets and craft authentic pleated regalia for youth apprentices.', 15000.00, '2026-06-01', '2026-12-20', null, 'Active'
    );

    const bdg1 = uid();
    const bdg2 = uid();
    db.prepare(
      `INSERT INTO budgets (id, title, event_id, branch_id, fiscal_year, requested_amount_ghs, approved_amount_ghs, line_items, submitted_by, four_week_rule_compliant, status, approved_by, approved_at, review_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
    ).run(
      bdg1, 'Tema Heritage Parade 2026 Budget', evt1, temaId, 2026, 8500.00, 8200.00,
      JSON.stringify([{ item: 'Brass Band Logistics & Water', amount: 3200 }, { item: 'Costume Ruff & Feather Repairs', amount: 3500 }, { item: 'Route Security & First Aid', amount: 1500 }]),
      mOrg, 1, 'Approved', mTreas, 'Submitted >4 weeks ahead of parade; approved by Executive Council.'
    );
    db.prepare(
      `INSERT INTO budgets (id, title, event_id, branch_id, fiscal_year, requested_amount_ghs, approved_amount_ghs, line_items, submitted_by, four_week_rule_compliant, status, approved_by, approved_at, review_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
    ).run(
      bdg2, 'Mid-Year Unity Durbar Budget', evt3, temaId, 2026, 4200.00, 4200.00,
      JSON.stringify([{ item: 'Sound & Canopy', amount: 2200 }, { item: 'Refreshments', amount: 2000 }]),
      mOrg, 1, 'Closed', mTreas, 'Fully reconciled and receipts verified.'
    );

    const insPay = db.prepare(
      `INSERT INTO financial_payments (id, receipt_number, member_id, dues_schedule_id, campaign_id, branch_id, payment_category, amount_ghs, payment_date, payment_method, reference_number, verification_status, recording_officer_id, verified_by_id, verified_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insPay.run(uid(), 'RCP-2026-0001', mPres, duesOfficer, null, temaId, 'Dues', 240.00, '2026-02-05', 'Bank Transfer', 'GCB-8839201', 'Verified', mTreas, mTreas, '2026-02-06', 'Full annual officer dues');
    insPay.run(uid(), 'RCP-2026-0002', mGenSec, duesOfficer, null, temaId, 'Dues', 240.00, '2026-02-12', 'Mobile Money', 'MTN-4492011', 'Verified', mTreas, mTreas, '2026-02-12', 'MoMo verified by Treasurer');
    insPay.run(uid(), 'RCP-2026-0003', mOrdinary1, duesSenior, null, temaId, 'Dues', 120.00, '2026-05-10', 'Mobile Money', 'MTN-7712309', 'Verified', mTreas, mTreas, '2026-05-11', 'Partial annual dues (GHS 60 balance remaining)');
    insPay.run(uid(), 'RCP-2026-0004', mOrdinary1, duesSenior, null, temaId, 'Dues', 60.00, '2026-11-01', 'Mobile Money', 'MTN-9941122', 'Pending Verification', mOrdinary1, null, null, 'Member submitted MoMo reference awaiting Treasurer verification');
    insPay.run(uid(), 'RCP-2026-0005', mOrdinary2, duesSenior, null, outsideId, 'Dues', 180.00, '2026-03-19', 'Cash', 'CASH-OT-019', 'Verified', mOutsideLeader, mTreas, '2026-03-22', 'Paid at Accra Metro branch meeting');
    insPay.run(uid(), 'RCP-2026-0006', mPres, null, camp1, temaId, 'Fundraising', 1200.00, '2026-08-14', 'Bank Transfer', 'GCB-9910023', 'Verified', mTreas, mTreas, '2026-08-15', 'Contribution to Brass & Costume Fund');
    insPay.run(uid(), 'RCP-2026-0007', mOutsideLeader, null, camp1, outsideId, 'Donation', 850.00, '2026-09-02', 'Mobile Money', 'TELE-552019', 'Verified', mTreas, mTreas, '2026-09-03', 'Outside Tema solidarity contribution');

    db.prepare(
      `INSERT INTO expenditures (id, budget_id, branch_id, description, amount_ghs, expense_date, payee, receipt_submitted, receipt_due_date, status, requested_by, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(uid(), bdg2, temaId, 'Canopy, PA System & Water for Mid-Year Unity Durbar', 3950.00, '2026-07-18', 'Tema Civic Rentals Ltd', 1, '2026-07-25', 'Accounted', mOrg, mTreas);

    db.prepare(
      `INSERT INTO expenditures (id, budget_id, branch_id, description, amount_ghs, expense_date, payee, receipt_submitted, receipt_due_date, status, requested_by, approved_by, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(uid(), bdg1, temaId, 'Advance Fabric & Pleated Ruff Material Deposit', 2100.00, '2026-11-05', 'Makola Heritage Textiles', 1, '2026-11-12', 'Accounted', mCostume, mTreas);

    // 11. Publications (News & Announcements)
    const insPub = db.prepare(
      `INSERT INTO publications (id, title, slug, category, tags, excerpt, body, cover_image_url, is_featured, status, published_at, author_id, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`
    );
    insPub.run(
      uid(),
      'Official Call for 2026 Tema Heritage Parade Subdivisions',
      'official-call-2026-tema-heritage-parade',
      'Announcement',
      JSON.stringify(['Tema Branch', 'Parade', 'Communities 1-25']),
      'All 25 Tema Community subdivisions and Outside Tema delegations are invited to confirm parade muster lists by 10 December 2026.',
      'In accordance with LASUPADORA Masqueraders Society cultural calendar and financial accountability standards, all subdivision coordinators must submit participant rosters and verified costume counts ahead of the Boxing Day procession. Only approved event budgets may incur expenses, and all receipts must be submitted within seven days of disbursement.',
      '/media/hero_masquerade_procession.jpg',
      1, 'Published', mGenSec, mPres
    );
    insPub.run(
      uid(),
      'Artisan Workshop Preserves Traditional Pleated Ruff Craftsmanship',
      'artisan-workshop-pleated-ruff-craftsmanship',
      'Featured Story',
      JSON.stringify(['Culture', 'Costumes', 'Youth']),
      'Senior costume makers mentored 24 junior members in traditional mask embroidery and vibrant orange collar pleating.',
      'Last weekend at the Community 3 workshop, Costume Coordinator Beatrice Ashie led an intensive heritage craft clinic passing down hand-stitching techniques for eye masks, crown feathers, and harlequin tunics. Wear the Culture. Live the Tradition.',
      '/media/gallery_costume_craft.jpg',
      1, 'Published', mCostume, mPres
    );
    insPub.run(
      uid(),
      'Outside Tema Branch Expands Ashaiman & Accra Metro Rehearsals',
      'outside-tema-expands-rehearsals',
      'News',
      JSON.stringify(['Outside Tema', 'Ashaiman', 'Accra']),
      'Weekly brass and choreography rehearsals now run concurrently in Ashaiman and Osu to prepare regional contingents.',
      'Members residing outside Tema can now join structured rehearsal sessions coordinated under the Outside Tema Branch leadership, ensuring equal participation and constitutional representation across all regions.',
      '/media/news_youth_rehearsal.jpg',
      0, 'Published', mOutsideLeader, mGenSec
    );

    // 12. Media Gallery Items
    const insMedia = db.prepare(
      `INSERT INTO media_items (id, title, caption, album_name, media_type, bucket_visibility, file_url, mime_type, file_size_bytes, event_id, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insMedia.run(uid(), 'Golden Hour Procession — Tema Community 1', 'Masqueraders in navy, red, and pleated orange regalia alongside the brass band.', '2026 Mid-Year Unity Durbar', 'photo', 'public', '/media/hero_masquerade_procession.jpg', 'image/jpeg', 1030000, evt3, mOrg);
    insMedia.run(uid(), 'Brass Section & Masquerade Dancers', 'Afternoon festival celebration uniting elders and youth in coastal Ghana.', '2026 Mid-Year Unity Durbar', 'photo', 'public', '/media/event_tema_carnival.jpg', 'image/jpeg', 1120000, evt3, mOrg);
    insMedia.run(uid(), 'Youth Mask & Trumpet Preparation', 'Band Leader and apprentices inspecting feathered headpieces before procession.', 'Heritage Rehearsals', 'photo', 'public', '/media/news_youth_rehearsal.jpg', 'image/jpeg', 1100000, evt2, mBand);
    insMedia.run(uid(), 'Handcrafted Masks & Pleated Collar Regalia', 'Traditional embroidered masks, feathers, and orange pleated ruffs on workshop timber.', 'Costume Craft Archive', 'photo', 'public', '/media/gallery_costume_craft.jpg', 'image/jpeg', 960000, null, mCostume);

    // 13. Governance Meetings, Proposals, Action Points & Inquiries
    const mtg1 = uid();
    db.prepare(
      `INSERT INTO governance_meetings (id, title, meeting_type, scheduled_at, venue, agenda, minutes_text, quorum_required, attendees_count, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      mtg1,
      'Q4 2026 Executive Council & Branch Leaders Review',
      'Executive Council',
      '2026-11-22T15:00:00Z',
      'Tema Community 1 Society Hall',
      '1. Parade Budget Compliance\n2. Constitutional Ratification of Junior Age Bracket\n3. Outside Tema Subdivision Expansion',
      'Draft agenda circulated 14 days prior in accordance with Society transparency principles.',
      6, 0, 'Scheduled', mGenSec
    );

    const prop1 = uid();
    const prop2 = uid();
    db.prepare(
      `INSERT INTO governance_proposals (id, reference_code, title, proposal_type, description, meeting_id, submitted_by, status, votes_for, votes_against, votes_abstain, decision_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      prop1, 'MOT-2026-001',
      'Ratify Junior Category Age Bracket (8–17 Years) & Annual Dues (GHS 60)',
      'Policy Amendment',
      'Formal constitutional confirmation of the provisional Junior membership eligibility age bracket (8 to 17 years) and GHS 60 annual dues rate.',
      mtg1, mGenSec, 'Voting Open', 4, 0, 1, 'Open for Executive Council & Branch Leader ratification vote.'
    );
    db.prepare(
      `INSERT INTO governance_proposals (id, reference_code, title, proposal_type, description, meeting_id, submitted_by, status, votes_for, votes_against, votes_abstain, reviewed_by, decided_by, decision_notes, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      prop2, 'RES-2026-004',
      'Enforce Automated Seven-Day Receipt Accountability Lock Across All Branches',
      'Resolution',
      'Confirms that any branch or committee with overdue expense receipts (>7 days) is barred from further disbursements until accounts are reconciled.',
      mtg1, mTreas, 'Approved', 7, 0, 0, mGenSec, mPres, 'Unanimously adopted to protect collective Society accountability.'
    );

    db.prepare(`INSERT INTO governance_action_points (id, proposal_id, meeting_id, title, assigned_to, due_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      uid(), prop1, mtg1, 'Compile Tema C1-C25 Junior Apprentice Roster', mTemaLeader, '2026-12-05', 'In Progress'
    );
    db.prepare(`INSERT INTO governance_action_points (id, proposal_id, meeting_id, title, assigned_to, due_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      uid(), prop2, mtg1, 'Verify Q4 Branch Receipts Before Parade Disbursement', mTreas, '2026-12-10', 'Open'
    );

    db.prepare(
      `INSERT INTO member_feedback_and_inquiries (id, member_id, sender_name, sender_email, submission_type, subject, message, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uid(), mOrdinary1, 'Kwabena Owusu', 'member@lasupadora.org', 'Suggestion',
      'Community 8 Rehearsal Hydration Station',
      'Requesting that parade marshals position shared water points at Community 8 junction during December rehearsals.',
      'In Review'
    );

    db.prepare(
      `INSERT INTO notifications (id, member_id, title, body) VALUES (?, ?, ?, ?)`
    ).run(
      uid(), mOrdinary1, 'Dues Receipt Pending Verification', 'Your GHS 60.00 Mobile Money reference (MTN-9941122) has been logged and awaits Treasurer verification.'
    );

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('Seed error:', err);
  }
}
