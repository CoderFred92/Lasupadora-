import React, { useEffect, useState } from 'react';
import { ArrowRightLeft, Camera, CreditCard, Download, FileSpreadsheet, Pencil, Search, UserPlus, X } from 'lucide-react';
import { apiFetch, formatDate, formatGHS } from '../../lib/api';
import { exportTableToPDF, exportToExcel } from '../../lib/exportUtils';
import { MembershipIDCard } from '../MembershipIDCard';
import type { AuthUser, Branch, MemberRecord, MembershipCategory, Subdivision } from '../../types';

function getExpectedMembershipPrefix(
  branchId: string,
  subdivisionId: string | null | undefined,
  branches: Branch[],
  subdivisions: Subdivision[]
): string {
  const branch = branches.find((b) => b.id === branchId);
  if (!branch) return 'LSMS-';
  if (branch.code === 'TM' || branch.branch_type === 'tema') {
    const sub = subdivisions.find((s) => s.id === subdivisionId);
    const match = sub?.code?.match(/^C(\d+)$/i) || sub?.name?.match(/Community\s+(\d+)/i);
    if (match) {
      return `LSMS-TM-${String(parseInt(match[1], 10)).padStart(2, '0')}-`;
    }
    return 'LSMS-TM-';
  }
  if (branch.code === 'OT' || branch.branch_type === 'outside_tema') {
    return 'LSMS-OT-';
  }
  return `LSMS-${branch.code.toUpperCase()}-`;
}

function stripPrefix(value: string, prefix: string): string {
  const trimmed = value.trim();
  if (trimmed.toUpperCase().startsWith(prefix.toUpperCase())) {
    return trimmed.slice(prefix.length);
  }
  if (/^lsms-?/i.test(trimmed)) {
    return trimmed.replace(/^lsms-(?:tm-\d{1,2}-|ot-)?/i, '');
  }
  return trimmed;
}

function buildPrefixedId(suffix: string, prefix: string): string {
  return `${prefix}${stripPrefix(suffix, prefix)}`;
}

interface ApplicationRecord {
  id: string;
  application_ref: string;
  source: string;
  full_name: string;
  date_of_birth: string | null;
  telephone: string;
  email: string | null;
  residential_address: string | null;
  preferred_branch_id: string;
  preferred_subdivision_id: string;
  requested_category_id: string;
  branch_name: string;
  subdivision_name: string;
  category_name: string;
  status: string;
  review_comments: string | null;
  submitted_at: string;
}

export const AdminMembershipTab: React.FC<{
  user: AuthUser;
  branches: Branch[];
  subdivisions: Subdivision[];
  categories: MembershipCategory[];
  onOpenVerify: (token: string) => void;
}> = ({ user, branches, subdivisions, categories, onOpenVerify }) => {
  const [subView, setSubView] = useState<'register' | 'applications' | 'transfers'>('register');
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [transfers, setTransfers] = useState<Record<string, string>[]>([]);
  const [profileRequests, setProfileRequests] = useState<Record<string, string>[]>([]);
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [branchFilter, setBranchFilter] = useState('All');

  const [selectedCardMember, setSelectedCardMember] = useState<MemberRecord | null>(null);
  const [editingMember, setEditingMember] = useState<MemberRecord | null>(null);
  const [editMemberForm, setEditMemberForm] = useState({
    full_name: '',
    membership_number: '',
    email: '',
    telephone: '',
    date_of_birth: '',
    gender: '',
    residential_address: '',
    category_id: '',
    membership_status: 'Active',
    card_valid_until: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    previous_experience: '',
    photo_url: '',
  });
  const [editPhotoFile, setEditPhotoFile] = useState<{ filename: string; mimeType: string; dataBase64: string } | null>(null);
  const [savingMemberEdit, setSavingMemberEdit] = useState(false);

  const [transferMember, setTransferMember] = useState<MemberRecord | null>(null);
  const [transferForm, setTransferForm] = useState({ to_branch_id: '', to_subdivision_id: '', reason: '' });
  const [showOfficerReg, setShowOfficerReg] = useState(false);
  const [officerForm, setOfficerForm] = useState({
    full_name: '',
    date_of_birth: '',
    telephone: '',
    email: '',
    residential_address: '',
    preferred_branch_id: branches[0]?.id || '',
    preferred_subdivision_id: subdivisions[0]?.id || '',
    requested_category_id: categories[0]?.id || '',
  });
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [customMemberIds, setCustomMemberIds] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const canApproveApps = Boolean(user.permissions.applications?.approve);
  const canCreateApps = Boolean(user.permissions.applications?.create);
  const canEditMembers = Boolean(user.permissions.membership?.edit);
  const canExportMembers = Boolean(user.permissions.membership?.export);

  const loadAll = async () => {
    setErr(null);
    try {
      const mRes = await apiFetch<{
        members: MemberRecord[];
        transfers: Record<string, string>[];
        profileRequests: Record<string, string>[];
      }>('/api/admin/members');
      setMembers(mRes.members);
      setTransfers(mRes.transfers);
      setProfileRequests(mRes.profileRequests);

      if (user.permissions.applications?.view) {
        const aRes = await apiFetch<{ applications: ApplicationRecord[] }>('/api/admin/applications');
        setApplications(aRes.applications);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const filteredMembers = members.filter((m) => {
    const matchesSearch =
      m.full_name.toLowerCase().includes(search.toLowerCase()) ||
      m.membership_number.toLowerCase().includes(search.toLowerCase()) ||
      (m.email || '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || m.membership_status === statusFilter;
    const matchesBranch = branchFilter === 'All' || m.branch_id === branchFilter;
    return matchesSearch && matchesStatus && matchesBranch;
  });

  const handleStatusChange = async (memberId: string, membership_status: string) => {
    setErr(null);
    setMsg(null);
    try {
      await apiFetch(`/api/admin/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ membership_status }),
      });
      setMsg('Member status updated.');
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const openEditMember = (m: MemberRecord) => {
    setEditingMember(m);
    setEditPhotoFile(null);
    setEditMemberForm({
      full_name: m.full_name || '',
      membership_number: m.membership_number || '',
      email: m.email || '',
      telephone: m.telephone || '',
      date_of_birth: m.date_of_birth || '',
      gender: m.gender || '',
      residential_address: m.residential_address || '',
      category_id: m.category_id || '',
      membership_status: m.membership_status || 'Active',
      card_valid_until: m.card_valid_until || '',
      emergency_contact_name: m.emergency_contact_name || '',
      emergency_contact_phone: m.emergency_contact_phone || '',
      previous_experience: m.previous_experience || '',
      photo_url: m.photo_url || '',
    });
  };

  const handleEditMemberPhotoPick = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setEditPhotoFile({
        filename: file.name,
        mimeType: file.type,
        dataBase64: String(reader.result || ''),
      });
    };
    reader.readAsDataURL(file);
  };

  const handleEditMemberSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;
    setSavingMemberEdit(true);
    setErr(null);
    setMsg(null);
    try {
      let nextPhotoUrl = editMemberForm.photo_url;
      if (editPhotoFile) {
        const up = await apiFetch<{ url: string }>('/api/uploads', {
          method: 'POST',
          body: JSON.stringify({ ...editPhotoFile, visibility: 'public' }),
        });
        nextPhotoUrl = up.url;
      }

      await apiFetch(`/api/admin/members/${editingMember.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...editMemberForm,
          photo_url: nextPhotoUrl,
        }),
      });
      setMsg(`Updated member record for ${editMemberForm.full_name} (${editMemberForm.membership_number}).`);
      setEditingMember(null);
      setEditPhotoFile(null);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingMemberEdit(false);
    }
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferMember) return;
    setErr(null);
    try {
      await apiFetch(`/api/admin/members/${transferMember.id}/transfer`, {
        method: 'POST',
        body: JSON.stringify(transferForm),
      });
      setMsg(`Transferred ${transferMember.full_name} and logged permanent transfer record.`);
      setTransferMember(null);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleApplicationDecision = async (app: ApplicationRecord, decision: 'Approved' | 'Corrections Requested' | 'Rejected') => {
    setErr(null);
    setMsg(null);
    const prefix = getExpectedMembershipPrefix(app.preferred_branch_id, app.preferred_subdivision_id, branches, subdivisions);
    const suffix = (customMemberIds[app.id] || '').trim();
    if (decision === 'Approved' && suffix && !suffix.replace(/^[-_/.\s]+/, '').trim()) {
      setErr(`Please enter an identifier after "${prefix}", or leave the suffix blank to auto-generate one.`);
      return;
    }
    try {
      const res = await apiFetch<{ createdMember?: { membership_number: string } }>(`/api/admin/applications/${app.id}/decision`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          comments: reviewComments[app.id] || '',
          ...(decision === 'Approved' && suffix ? { membership_number: buildPrefixedId(suffix, prefix) } : {}),
        }),
      });
      setMsg(
        decision === 'Approved' && res.createdMember
          ? `Application approved! Issued permanent Membership ID ${res.createdMember.membership_number}.`
          : `Application updated to ${decision}.`
      );
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleOfficerCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const res = await apiFetch<{ application_ref: string }>('/api/admin/applications/officer-assisted', {
        method: 'POST',
        body: JSON.stringify(officerForm),
      });
      setMsg(`Officer-assisted application ${res.application_ref} logged for standard approval review.`);
      setShowOfficerReg(false);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const exportMembersExcel = () => {
    exportToExcel(
      'LASUPADORA-Members-Register',
      'Members',
      filteredMembers.map((m) => ({
        'Membership No': m.membership_number,
        'Full Name': m.full_name,
        Branch: m.branch_name,
        Subdivision: m.subdivision_name,
        Category: m.category_name,
        Status: m.membership_status,
        Telephone: m.telephone,
        'Dues Paid (GHS)': m.dues_paid_ghs || 0,
        'Registered Date': m.registration_date,
      }))
    );
  };

  const exportMembersPDF = () => {
    exportTableToPDF(
      'LASUPADORA-Members-Register',
      'Official Membership Register',
      `Filtered count: ${filteredMembers.length}`,
      ['Member No', 'Full Name', 'Branch', 'Subdivision', 'Category', 'Status', 'Dues Paid'],
      filteredMembers.map((m) => [
        m.membership_number,
        m.full_name,
        m.branch_name,
        m.subdivision_name,
        m.category_name,
        m.membership_status,
        formatGHS(m.dues_paid_ghs || 0),
      ])
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1">
          {[
            { id: 'register', label: `Membership Register (${members.length})` },
            { id: 'applications', label: `Applications (${applications.filter((a) => a.status !== 'Approved' && a.status !== 'Rejected').length} Open)` },
            { id: 'transfers', label: `Transfers & Change Requests (${transfers.length})` },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubView(t.id as typeof subView)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                subView === t.id ? 'bg-white text-[#10242F] shadow-sm' : 'text-slate-600 hover:text-[#10242F]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canCreateApps && (
            <button
              type="button"
              onClick={() => setShowOfficerReg(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#BD5016] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#9D4010] cursor-pointer"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Officer-Assisted Registration
            </button>
          )}
          {canExportMembers && (
            <>
              <button
                type="button"
                onClick={exportMembersExcel}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#10242F] hover:bg-slate-50 cursor-pointer"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Excel
              </button>
              <button
                type="button"
                onClick={exportMembersPDF}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#10242F] hover:bg-slate-50 cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                PDF
              </button>
            </>
          )}
        </div>
      </div>

      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-[#146B3A]">{msg}</div>}
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-[#AD220B]">{err}</div>}

      {/* REGISTER VIEW */}
      {subView === 'register' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, membership no., or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs"
              />
            </div>
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            >
              <option value="All">All Authorized Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
            >
              {['All', 'Active', 'Pending', 'Inactive', 'Suspended', 'Transferred', 'Resigned', 'Deceased'].map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Member No.</th>
                  <th className="px-4 py-3 font-semibold">Full Name</th>
                  <th className="px-4 py-3 font-semibold">Branch / Subdivision</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold text-right">Dues Paid</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMembers.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono-tabular font-semibold text-[#AD220B]">{m.membership_number}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#10242F]">{m.full_name}</p>
                      <p className="text-[11px] text-slate-500">{m.telephone}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#10242F]">{m.branch_name}</p>
                      <p className="text-[11px] text-slate-500">{m.subdivision_name}</p>
                    </td>
                    <td className="px-4 py-3">{m.category_name}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-semibold">{formatGHS(m.dues_paid_ghs || 0)}</td>
                    <td className="px-4 py-3">
                      {canEditMembers ? (
                        <select
                          value={m.membership_status}
                          onChange={(e) => handleStatusChange(m.id, e.target.value)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold"
                        >
                          {['Pending', 'Active', 'Inactive', 'Suspended', 'Transferred', 'Resigned', 'Deceased'].map((s) => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-semibold">{m.membership_status}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedCardMember(m)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-[#053559] hover:bg-slate-50 cursor-pointer"
                      >
                        <CreditCard className="h-3 w-3" />
                        ID Card
                      </button>
                      {canEditMembers && (
                        <>
                          <button
                            type="button"
                            onClick={() => openEditMember(m)}
                            className="inline-flex items-center gap-1 rounded border border-[#053559]/40 bg-[#053559]/5 px-2 py-1 text-[11px] font-semibold text-[#053559] hover:bg-[#053559]/10 cursor-pointer"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTransferMember(m);
                              const firstSub = subdivisions.find((s) => s.branch_id === m.branch_id);
                              setTransferForm({ to_branch_id: m.branch_id, to_subdivision_id: firstSub?.id || '', reason: '' });
                            }}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-[#10242F] hover:bg-slate-50 cursor-pointer"
                          >
                            <ArrowRightLeft className="h-3 w-3" />
                            Transfer
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* APPLICATIONS REVIEW QUEUE */}
      {subView === 'applications' && (
        <div className="space-y-4">
          {applications.map((a) => (
            <div key={a.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs text-slate-500">
                    <span className="font-mono-tabular font-bold text-[#AD220B]">{a.application_ref}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{a.source === 'officer_assisted' ? 'Officer-Assisted' : 'Public Online'}</span>
                    <span aria-hidden="true"> · </span>
                    <span>Submitted {formatDate(a.submitted_at)}</span>
                  </div>
                  <h3 className="mt-1 text-base font-bold text-[#10242F]">{a.full_name}</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    {a.branch_name} ({a.subdivision_name}) · Category: <strong>{a.category_name}</strong> · Tel: {a.telephone}
                  </p>
                  {a.review_comments && (
                    <p className="mt-2 text-xs text-slate-600">Review note: {a.review_comments}</p>
                  )}
                </div>
                <span
                  className={`text-xs font-bold ${
                    a.status === 'Approved'
                      ? 'text-[#146B3A]'
                      : a.status === 'Rejected'
                      ? 'text-[#AD220B]'
                      : 'text-[#BD5016]'
                  }`}
                >
                  {a.status}
                </span>
              </div>

              {canApproveApps && a.status !== 'Approved' && a.status !== 'Rejected' && (() => {
                const expectedPrefix = getExpectedMembershipPrefix(a.preferred_branch_id, a.preferred_subdivision_id, branches, subdivisions);
                return (
                  <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
                        <span className="bg-slate-100 px-2.5 py-1.5 text-xs font-mono-tabular font-bold text-[#AD220B] border-r border-slate-300 select-none">
                          {expectedPrefix}
                        </span>
                        <input
                          type="text"
                          placeholder="001 (Optional custom suffix)"
                          value={customMemberIds[a.id] || ''}
                          onChange={(e) => setCustomMemberIds({ ...customMemberIds, [a.id]: stripPrefix(e.target.value, expectedPrefix) })}
                          className="w-44 px-2.5 py-1.5 text-xs font-mono-tabular text-[#10242F] focus:outline-none"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Optional review comment or correction instruction..."
                        value={reviewComments[a.id] || ''}
                        onChange={(e) => setReviewComments({ ...reviewComments, [a.id]: e.target.value })}
                        className="flex-1 min-w-[200px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-slate-500">
                        Required prefix: <strong>{expectedPrefix}</strong>. Enter any custom suffix above or leave blank for auto-numbering (e.g. {expectedPrefix}001).
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleApplicationDecision(a, 'Approved')}
                          className="rounded-lg bg-[#146B3A] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0f542d] cursor-pointer"
                        >
                          Approve &amp; Issue Member ID
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplicationDecision(a, 'Corrections Requested')}
                          className="rounded-lg border border-amber-500 px-3.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 cursor-pointer"
                        >
                          Request Corrections
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApplicationDecision(a, 'Rejected')}
                          className="rounded-lg border border-red-300 px-3.5 py-1.5 text-xs font-semibold text-[#AD220B] hover:bg-red-50 cursor-pointer"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {/* TRANSFERS & PROFILE CHANGE REQUESTS */}
      {subView === 'transfers' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-display text-lg font-bold text-[#10242F]">Recorded Branch &amp; Subdivision Transfers</h3>
            <div className="mt-4 divide-y divide-slate-100 text-xs">
              {transfers.length === 0 ? (
                <p className="text-slate-500">No transfers recorded yet.</p>
              ) : (
                transfers.map((t) => (
                  <div key={t.id} className="py-3">
                    <p className="font-bold text-[#10242F]">
                      {t.full_name} ({t.membership_number})
                    </p>
                    <p className="mt-0.5 text-slate-600">
                      {t.from_branch} ({t.from_subdivision}) → <strong>{t.to_branch} ({t.to_subdivision})</strong>
                    </p>
                    <p className="mt-0.5 text-slate-500">Reason: {t.reason} · Approved by {t.approved_by_name}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-display text-lg font-bold text-[#10242F]">Member Profile Amendment Queue</h3>
            <div className="mt-4 divide-y divide-slate-100 text-xs">
              {profileRequests.length === 0 ? (
                <p className="text-slate-500">No pending official change requests.</p>
              ) : (
                profileRequests.map((pr) => (
                  <div key={pr.id} className="py-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-[#10242F]">{pr.full_name} ({pr.membership_number})</p>
                      <p className="mt-0.5 text-slate-600">{pr.requested_changes}</p>
                    </div>
                    <span className="font-semibold text-[#053559]">{pr.status}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ID Card Preview Modal */}
      {selectedCardMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-display text-lg font-bold text-[#10242F]">Official Digital Membership ID</h3>
              <button type="button" onClick={() => setSelectedCardMember(null)} className="p-1 text-slate-500 hover:text-black cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <MembershipIDCard member={selectedCardMember} onOpenVerify={onOpenVerify} />
          </div>
        </div>
      )}

      {/* Branch Transfer Modal */}
      {transferMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={handleTransferSubmit} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-display text-lg font-bold text-[#10242F]">Transfer {transferMember.full_name}</h3>
              <button type="button" onClick={() => setTransferMember(null)} className="p-1 text-slate-500 cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
            <div>
              <label className="block text-xs font-semibold">Destination Branch</label>
              <select
                value={transferForm.to_branch_id}
                onChange={(e) => {
                  const bId = e.target.value;
                  const first = subdivisions.find((s) => s.branch_id === bId);
                  setTransferForm({ ...transferForm, to_branch_id: bId, to_subdivision_id: first?.id || '' });
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              >
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold">Destination Subdivision</label>
              <select
                value={transferForm.to_subdivision_id}
                onChange={(e) => setTransferForm({ ...transferForm, to_subdivision_id: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              >
                {subdivisions.filter((s) => s.branch_id === transferForm.to_branch_id).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold">Transfer Reason *</label>
              <input
                type="text"
                required
                value={transferForm.reason}
                onChange={(e) => setTransferForm({ ...transferForm, reason: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <button type="submit" className="w-full rounded-lg bg-[#BD5016] py-2.5 text-xs font-semibold text-white cursor-pointer">
              Confirm Branch Transfer
            </button>
          </form>
        </div>
      )}

      {/* Edit Member Modal */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={handleEditMemberSubmit} className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-display text-lg font-bold text-[#10242F]">Edit Member Profile &amp; ID</h3>
                <p className="text-[11px] text-slate-500">
                  Update the member&apos;s official name, Membership ID, contact information, and status. Branch moves are logged via Transfer.
                </p>
              </div>
              <button type="button" onClick={() => setEditingMember(null)} className="p-1 text-slate-500 hover:text-black cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <div>
                <label className="block font-semibold text-[#10242F]">Full Name *</label>
                <input
                  type="text"
                  required
                  value={editMemberForm.full_name}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, full_name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              {(() => {
                const editPrefix = getExpectedMembershipPrefix(editingMember.branch_id, editingMember.subdivision_id, branches, subdivisions);
                const suffixVal = stripPrefix(editMemberForm.membership_number, editPrefix);
                const fullId = buildPrefixedId(suffixVal, editPrefix);
                return (
                  <div>
                    <label className="block font-semibold text-[#10242F]">
                      Membership ID * ({editingMember.branch_name} · {editingMember.subdivision_name})
                    </label>
                    <div className="mt-1 flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
                      <span className="bg-slate-100 px-3 py-2 font-mono-tabular font-bold text-[#AD220B] border-r border-slate-300 select-none shrink-0">
                        {editPrefix}
                      </span>
                      <input
                        type="text"
                        required
                        placeholder="001"
                        value={suffixVal}
                        onChange={(e) =>
                          setEditMemberForm({
                            ...editMemberForm,
                            membership_number: buildPrefixedId(e.target.value, editPrefix),
                          })
                        }
                        className="w-full px-3 py-2 font-mono-tabular font-semibold text-[#10242F] focus:outline-none"
                      />
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Full ID: <span className="font-mono-tabular font-semibold text-[#AD220B]">{fullId}</span>
                    </p>
                  </div>
                );
              })()}
              <div>
                <label className="block font-semibold text-[#10242F]">Telephone *</label>
                <input
                  type="tel"
                  required
                  value={editMemberForm.telephone}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, telephone: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Email Address</label>
                <input
                  type="email"
                  value={editMemberForm.email}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, email: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Date of Birth</label>
                <input
                  type="date"
                  value={editMemberForm.date_of_birth}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, date_of_birth: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Gender</label>
                <select
                  value={editMemberForm.gender}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, gender: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  <option value="">Not specified</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Membership Category</label>
                <select
                  value={editMemberForm.category_id}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, category_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Membership Status</label>
                <select
                  value={editMemberForm.membership_status}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, membership_status: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  {['Pending', 'Active', 'Inactive', 'Suspended', 'Transferred', 'Resigned', 'Deceased'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Residential Address</label>
                <input
                  type="text"
                  value={editMemberForm.residential_address}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, residential_address: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">ID Card Valid Until</label>
                <input
                  type="date"
                  value={editMemberForm.card_valid_until}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, card_valid_until: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Emergency Contact Name</label>
                <input
                  type="text"
                  value={editMemberForm.emergency_contact_name}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, emergency_contact_name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Emergency Contact Phone</label>
                <input
                  type="tel"
                  value={editMemberForm.emergency_contact_phone}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, emergency_contact_phone: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold text-[#10242F]">Previous Masquerading Experience / Notes</label>
                <input
                  type="text"
                  value={editMemberForm.previous_experience}
                  onChange={(e) => setEditMemberForm({ ...editMemberForm, previous_experience: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <label className="block font-semibold text-[#10242F]">Member Photo (ID Card &amp; Profile)</label>
                <div className="flex flex-wrap items-center gap-3">
                  {(editPhotoFile?.dataBase64 || editMemberForm.photo_url) && (
                    <img
                      src={editPhotoFile?.dataBase64 || editMemberForm.photo_url}
                      alt={editMemberForm.full_name}
                      referrerPolicy="no-referrer"
                      className="h-14 w-14 rounded-lg border border-slate-200 object-cover object-top bg-white"
                    />
                  )}
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#10242F] hover:bg-slate-100 cursor-pointer">
                    <Camera className="h-3.5 w-3.5" />
                    <span>{editPhotoFile ? editPhotoFile.filename : 'Upload Photo'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => handleEditMemberPhotoPick(e.target.files?.[0])}
                      className="hidden"
                    />
                  </label>
                  <input
                    type="text"
                    placeholder="Or paste photo URL..."
                    value={editMemberForm.photo_url}
                    onChange={(e) => setEditMemberForm({ ...editMemberForm, photo_url: e.target.value })}
                    className="flex-1 min-w-[180px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setEditingMember(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingMemberEdit}
                className="rounded-lg bg-[#BD5016] px-5 py-2 text-xs font-semibold text-white hover:bg-[#9D4010] disabled:opacity-50 cursor-pointer"
              >
                {savingMemberEdit ? 'Saving...' : 'Save Member Details'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Officer-Assisted Registration Modal */}
      {showOfficerReg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={handleOfficerCreate} className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-display text-lg font-bold text-[#10242F]">Officer-Assisted Registration</h3>
              <button type="button" onClick={() => setShowOfficerReg(false)} className="p-1 text-slate-500 cursor-pointer"><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-slate-600">
              Submitted into the standard review queue; does not bypass formal membership approval.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <input type="text" required placeholder="Full Name *" value={officerForm.full_name} onChange={(e) => setOfficerForm({ ...officerForm, full_name: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <input type="tel" required placeholder="Telephone *" value={officerForm.telephone} onChange={(e) => setOfficerForm({ ...officerForm, telephone: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <input type="date" value={officerForm.date_of_birth} onChange={(e) => setOfficerForm({ ...officerForm, date_of_birth: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <input type="email" placeholder="Email (Optional)" value={officerForm.email} onChange={(e) => setOfficerForm({ ...officerForm, email: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <select
                value={officerForm.preferred_branch_id}
                onChange={(e) => {
                  const bId = e.target.value;
                  const first = subdivisions.find((s) => s.branch_id === bId);
                  setOfficerForm({ ...officerForm, preferred_branch_id: bId, preferred_subdivision_id: first?.id || '' });
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
              >
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <select value={officerForm.preferred_subdivision_id} onChange={(e) => setOfficerForm({ ...officerForm, preferred_subdivision_id: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                {subdivisions.filter((s) => s.branch_id === officerForm.preferred_branch_id).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <select value={officerForm.requested_category_id} onChange={(e) => setOfficerForm({ ...officerForm, requested_category_id: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="submit" className="w-full rounded-lg bg-[#BD5016] py-2.5 text-xs font-semibold text-white cursor-pointer">
              Submit Application for Review
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
