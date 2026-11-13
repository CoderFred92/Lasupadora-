export interface PermissionSet {
  view: boolean;
  create: boolean;
  edit: boolean;
  approve: boolean;
  delete: boolean;
  export: boolean;
  manage: boolean;
}

export interface AuthUser {
  memberId: string;
  membershipNumber: string;
  fullName: string;
  email: string;
  branchId: string;
  subdivisionId: string;
  roles: {
    roleId: string;
    slug: string;
    displayName: string;
    scopeLevel: 'national' | 'branch' | 'subdivision' | 'self' | 'public';
    branchId: string | null;
    subdivisionId: string | null;
  }[];
  permissions: Record<string, PermissionSet>;
  isNationalScope: boolean;
  scopedBranchIds: string[];
  scopedSubdivisionIds: string[];
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  branch_type: string;
  region: string;
  description: string;
  is_active: number;
  active_members?: number;
}

export interface Subdivision {
  id: string;
  branch_id: string;
  branch_name?: string;
  code: string;
  name: string;
  subdivision_type: string;
  town_or_community: string;
  region: string;
  is_active: number;
  active_members?: number;
}

export interface MembershipCategory {
  id: string;
  code: string;
  name: string;
  min_age: number | null;
  max_age: number | null;
  annual_dues_ghs: number;
  monthly_dues_ghs: number;
  eligibility_notes: string;
  requires_policy_confirmation: number;
}

export interface MemberRecord {
  id: string;
  membership_number: string;
  qr_token: string;
  full_name: string;
  date_of_birth: string | null;
  gender: string | null;
  telephone: string;
  email: string;
  residential_address: string | null;
  photo_url: string | null;
  branch_id: string;
  subdivision_id: string;
  category_id: string;
  branch_name: string;
  subdivision_name: string;
  category_name: string;
  annual_dues_ghs: number;
  dues_paid_ghs?: number;
  membership_status: 'Pending' | 'Active' | 'Inactive' | 'Suspended' | 'Transferred' | 'Deceased' | 'Resigned';
  previous_experience: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  registration_date: string;
  card_valid_until: string | null;
}

export interface Publication {
  id: string;
  title: string;
  slug: string;
  category: string;
  tags: string;
  excerpt: string;
  body: string;
  cover_image_url: string | null;
  is_featured: number;
  status: string;
  published_at: string | null;
  author_name?: string;
}

export interface SocietyEvent {
  id: string;
  title: string;
  slug: string;
  description: string;
  event_date: string;
  venue: string;
  branch_id: string | null;
  branch_name?: string | null;
  poster_url: string | null;
  registration_open: number;
  status: string;
  is_public: number;
  organising_committee: string;
  post_event_report: string | null;
  receipt_submission_deadline: string | null;
  receipts_submitted: number;
  registered_count?: number;
  total_registered?: number;
  total_present?: number;
}

export interface MediaItem {
  id: string;
  title: string;
  caption: string | null;
  album_name: string;
  media_type: 'photo' | 'video' | 'poster' | 'document';
  bucket_visibility: 'public' | 'private';
  file_url: string;
  mime_type: string;
  file_size_bytes: number;
  is_archived: number;
  created_at: string;
  uploaded_by_name?: string;
}

export interface LeadershipAppointment {
  id: string;
  member_id: string;
  full_name: string;
  membership_number?: string;
  photo_url?: string | null;
  portfolio: string;
  scope_type: string;
  branch_id: string | null;
  branch_name?: string | null;
  term_number: number;
  term_start: string;
  term_expiry: string;
  handover_deadline?: string | null;
  oath_signed?: number;
  biography: string;
  is_public_approved: number;
  can_act_for_president: number;
  status: string;
}
