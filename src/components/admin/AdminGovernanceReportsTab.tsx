import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, FileSpreadsheet, UserPlus } from 'lucide-react';
import { apiFetch, formatDate, formatGHS } from '../../lib/api';
import { exportTableToPDF, exportToExcel } from '../../lib/exportUtils';
import type { AuthUser, Branch, MemberRecord } from '../../types';

const CHART_COLORS = ['#053559', '#BD5016', '#AD220B', '#146B3A', '#E48947'];

export const AdminGovernanceReportsTab: React.FC<{
  user: AuthUser;
  branches: Branch[];
  mode: 'governance' | 'rbac' | 'reports';
}> = ({ user, branches, mode }) => {
  const [govData, setGovData] = useState<{
    meetings: Record<string, string | number>[];
    proposals: Record<string, string | number>[];
    actionPoints: Record<string, string | number>[];
    policies: { key: string; category: string; label: string; value_json: string; requires_constitutional_confirmation: number; confirmed: number }[];
    inquiries: Record<string, string | number>[];
  } | null>(null);

  const [rbacData, setRbacData] = useState<{
    roles: { id: string; slug: string; display_name: string; scope_level: string; is_constitutional_office: number; description: string }[];
    permissions: { role_id: string; module: string; can_view: number; can_create: number; can_edit: number; can_approve: number; can_export: number; can_manage: number }[];
    assignments: {
      id: string;
      member_id: string;
      role_id: string;
      branch_id: string | null;
      subdivision_id: string | null;
      is_active: number;
      full_name: string;
      membership_number: string;
      email: string | null;
      role_name: string;
      role_slug: string;
      branch_name: string | null;
      subdivision_name: string | null;
    }[];
  } | null>(null);

  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [assignForm, setAssignForm] = useState({ member_id: '', role_id: '', branch_id: '' });

  const [secretariatForm, setSecretariatForm] = useState({
    secretariat_address: '',
    secretariat_email: '',
    secretariat_phone: '',
    office_hours: '',
    show_demo_notice: true,
    demo_notice_text: '',
  });
  const [savingSecretariat, setSavingSecretariat] = useState(false);

  const [reports, setReports] = useState<{
    membersByBranch: { branch_name: string; total_members: number; active_members: number }[];
    membersByCategory: { category_name: string; member_count: number }[];
    financeByCategory: { payment_category: string; total_ghs: number; tx_count: number }[];
    financeByBranch: { branch_name: string; income_ghs: number; expenditure_ghs: number }[];
    eventAttendance: { title: string; event_date: string; registered: number; present: number }[];
  } | null>(null);

  const [propForm, setPropForm] = useState({ title: '', proposal_type: 'Motion', description: '' });
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadData = async () => {
    setErr(null);
    try {
      if (mode === 'governance' && user.permissions.governance?.view) {
        const g = await apiFetch<typeof govData>('/api/admin/governance');
        setGovData(g);
        const secPol = g?.policies.find((p) => p.key === 'secretariat_settings');
        if (secPol) {
          try {
            const parsed = JSON.parse(secPol.value_json);
            setSecretariatForm({
              secretariat_address: String(parsed.secretariat_address || ''),
              secretariat_email: String(parsed.secretariat_email || ''),
              secretariat_phone: String(parsed.secretariat_phone || ''),
              office_hours: String(parsed.office_hours || ''),
              show_demo_notice: parsed.show_demo_notice !== false,
              demo_notice_text: String(parsed.demo_notice_text || ''),
            });
          } catch {}
        }
      }
      if (mode === 'rbac' && user.permissions.rbac?.view) {
        const [r, mRes] = await Promise.all([
          apiFetch<typeof rbacData>('/api/admin/rbac'),
          user.permissions.membership?.view
            ? apiFetch<{ members: MemberRecord[] }>('/api/admin/members')
            : Promise.resolve({ members: [] as MemberRecord[] }),
        ]);
        setRbacData(r);
        setMembers(mRes.members || []);
        if (r?.roles[0] && !selectedRoleId) setSelectedRoleId(r.roles[0].id);
        setAssignForm((prev) => ({
          member_id: prev.member_id || mRes.members?.[0]?.id || '',
          role_id: prev.role_id || r?.roles[0]?.id || '',
          branch_id: prev.branch_id,
        }));
      }
      if (mode === 'reports' && user.permissions.reports?.view) {
        const rep = await apiFetch<typeof reports>('/api/admin/reports');
        setReports(rep);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    loadData();
  }, [mode]);

  const submitProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch('/api/admin/governance/proposals', { method: 'POST', body: JSON.stringify(propForm) });
      setMsg('Motion submitted for Council voting.');
      setPropForm({ title: '', proposal_type: 'Motion', description: '' });
      await loadData();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const castVote = async (proposalId: string, choice: 'for' | 'against' | 'abstain') => {
    setErr(null);
    try {
      await apiFetch(`/api/admin/governance/proposals/${proposalId}/vote`, {
        method: 'POST',
        body: JSON.stringify({ choice }),
      });
      setMsg(`Vote (${choice}) recorded in immutable ledger.`);
      await loadData();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const decideProposal = async (proposalId: string, status: 'Approved' | 'Rejected') => {
    setErr(null);
    try {
      await apiFetch(`/api/admin/governance/proposals/${proposalId}/decide`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setMsg(`Proposal marked ${status}.`);
      await loadData();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const togglePermission = async (role_id: string, module: string, field: string, currentVal: number) => {
    setErr(null);
    try {
      await apiFetch('/api/admin/rbac/permission', {
        method: 'PATCH',
        body: JSON.stringify({ role_id, module, field, value: !currentVal }),
      });
      await loadData();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const assignUserRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignForm.member_id || !assignForm.role_id) return;
    setErr(null);
    setMsg(null);
    try {
      await apiFetch('/api/admin/rbac/assign', {
        method: 'POST',
        body: JSON.stringify({
          member_id: assignForm.member_id,
          role_id: assignForm.role_id,
          branch_id: assignForm.branch_id || null,
        }),
      });
      setMsg('Authorised user role assignment saved.');
      await loadData();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const toggleRoleAssignment = async (assignmentId: string, currentActive: number) => {
    setErr(null);
    setMsg(null);
    try {
      await apiFetch(`/api/admin/rbac/assignments/${assignmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !currentActive }),
      });
      setMsg(currentActive ? 'Role assignment revoked.' : 'Role assignment reactivated.');
      await loadData();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const confirmPolicy = async (key: string, confirmed: boolean) => {
    setErr(null);
    try {
      await apiFetch(`/api/admin/governance/policies/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ confirmed }),
      });
      setMsg(`Policy "${key}" updated.`);
      await loadData();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const saveSecretariatSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSecretariat(true);
    setErr(null);
    setMsg(null);
    try {
      await apiFetch('/api/admin/governance/policies/secretariat_settings', {
        method: 'PATCH',
        body: JSON.stringify({ value_json: secretariatForm }),
      });
      setMsg('Public Secretariat details and demonstration notice settings saved.');
      await loadData();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingSecretariat(false);
    }
  };

  const canEditSecretariat = Boolean(
    user.permissions.rbac?.manage || user.permissions.governance?.edit || user.permissions.governance?.approve
  );

  return (
    <div className="space-y-6">
      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-[#146B3A]">{msg}</div>}
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-[#AD220B]">{err}</div>}

      {/* GOVERNANCE MODULE */}
      {mode === 'governance' && govData && (
        <div className="space-y-8">
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8 space-y-4">
              <h2 className="font-display text-xl font-bold text-[#10242F]">Proposals, Motions &amp; Constitutional Resolutions</h2>
              {govData.proposals.map((p) => (
                <div key={String(p.id)} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-500">
                        <span className="font-mono-tabular font-bold text-[#AD220B]">{p.reference_code}</span> · {p.proposal_type} · Proposed by {p.submitted_by_name}
                      </p>
                      <h3 className="mt-1 text-base font-bold text-[#10242F]">{p.title}</h3>
                    </div>
                    <span className="text-xs font-bold text-[#053559]">{p.status}</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{p.description}</p>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs">
                    <span className="font-mono-tabular text-slate-600">
                      For: <strong>{p.votes_for}</strong> · Against: <strong>{p.votes_against}</strong> · Abstain: <strong>{p.votes_abstain}</strong>
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {p.status === 'Voting Open' && !p.current_user_voted && (
                        <>
                          <button type="button" onClick={() => castVote(String(p.id), 'for')} className="rounded bg-[#146B3A] px-2.5 py-1 font-semibold text-white cursor-pointer">Vote For</button>
                          <button type="button" onClick={() => castVote(String(p.id), 'against')} className="rounded border border-red-300 px-2.5 py-1 font-semibold text-[#AD220B] cursor-pointer">Against</button>
                          <button type="button" onClick={() => castVote(String(p.id), 'abstain')} className="rounded border border-slate-300 px-2.5 py-1 font-semibold cursor-pointer">Abstain</button>
                        </>
                      )}
                      {user.permissions.governance?.approve && p.status === 'Voting Open' && (
                        <>
                          <button type="button" onClick={() => decideProposal(String(p.id), 'Approved')} className="rounded bg-[#053559] px-2.5 py-1 font-semibold text-white cursor-pointer">Ratify Resolution</button>
                          <button type="button" onClick={() => decideProposal(String(p.id), 'Rejected')} className="rounded border border-slate-300 px-2.5 py-1 font-semibold cursor-pointer">Reject</button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="lg:col-span-4 space-y-6">
              {canEditSecretariat && (
                <form onSubmit={saveSecretariatSettings} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <div>
                    <h3 className="text-sm font-bold text-[#10242F]">Public Secretariat &amp; Demo Notice</h3>
                    <p className="text-[11px] text-slate-500">
                      Controls official contact details on the public Contact page and Footer, plus Stage 1 demonstration notices.
                    </p>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <label className="block font-semibold text-[#10242F]">Secretariat Address</label>
                      <input
                        type="text"
                        required
                        value={secretariatForm.secretariat_address}
                        onChange={(e) => setSecretariatForm({ ...secretariatForm, secretariat_address: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-[#10242F]">Official Email</label>
                      <input
                        type="email"
                        required
                        value={secretariatForm.secretariat_email}
                        onChange={(e) => setSecretariatForm({ ...secretariatForm, secretariat_email: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-[#10242F]">Secretariat Telephone</label>
                      <input
                        type="text"
                        value={secretariatForm.secretariat_phone}
                        onChange={(e) => setSecretariatForm({ ...secretariatForm, secretariat_phone: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-[#10242F]">Office Hours</label>
                      <input
                        type="text"
                        value={secretariatForm.office_hours}
                        onChange={(e) => setSecretariatForm({ ...secretariatForm, office_hours: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5"
                      />
                    </div>
                    <label className="flex items-center gap-2 pt-1 font-semibold text-[#10242F]">
                      <input
                        type="checkbox"
                        checked={secretariatForm.show_demo_notice}
                        onChange={(e) => setSecretariatForm({ ...secretariatForm, show_demo_notice: e.target.checked })}
                      />
                      Show Demonstration-in-Development Notice on Public Site
                    </label>
                    <textarea
                      rows={2}
                      value={secretariatForm.demo_notice_text}
                      onChange={(e) => setSecretariatForm({ ...secretariatForm, demo_notice_text: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-[11px]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingSecretariat}
                    className="w-full rounded-lg bg-[#053559] py-2 text-xs font-semibold text-white hover:bg-[#10242F] disabled:opacity-50 cursor-pointer"
                  >
                    {savingSecretariat ? 'Saving...' : 'Save Secretariat Settings'}
                  </button>
                </form>
              )}

              {user.permissions.governance?.create && (
                <form onSubmit={submitProposal} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                  <h3 className="text-sm font-bold text-[#10242F]">Submit Motion or Proposal</h3>
                  <input type="text" required placeholder="Motion Title *" value={propForm.title} onChange={(e) => setPropForm({ ...propForm, title: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                  <select value={propForm.proposal_type} onChange={(e) => setPropForm({ ...propForm, proposal_type: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                    {['Motion', 'Policy Amendment', 'Resolution', 'Budget Ratification', 'Appointment'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <textarea rows={3} required placeholder="Full motion text & rationale *" value={propForm.description} onChange={(e) => setPropForm({ ...propForm, description: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                  <button type="submit" className="w-full rounded-lg bg-[#BD5016] py-2 text-xs font-semibold text-white cursor-pointer">Submit for Council Vote</button>
                </form>
              )}

              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-bold text-[#10242F]">Configurable Constitutional Policies</h3>
                <p className="text-[11px] text-slate-500">Rules unconfirmed by the Constitution are flagged clearly for Society ratification.</p>
                <div className="divide-y divide-slate-100 text-xs">
                  {govData.policies
                    .filter((pol) => pol.key !== 'secretariat_settings')
                    .map((pol) => (
                      <div key={pol.key} className="py-2.5 space-y-1">
                        <div className="flex justify-between gap-2">
                          <span className="font-semibold text-[#10242F]">{pol.label}</span>
                          <span className={pol.confirmed ? 'text-[#146B3A] font-semibold' : 'text-amber-700 font-semibold'}>
                            {pol.confirmed ? 'Confirmed' : 'Pending Ratification'}
                          </span>
                        </div>
                        <p className="font-mono-tabular text-[11px] text-slate-500 break-all">{pol.value_json}</p>
                        {(user.permissions.rbac?.manage || user.permissions.governance?.approve) && !pol.confirmed && (
                          <button type="button" onClick={() => confirmPolicy(pol.key, true)} className="text-[11px] font-semibold text-[#053559] hover:underline cursor-pointer">
                            Mark Constitutionally Confirmed
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>

          {/* Meetings, Action Points & Inquiries */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-lg font-bold text-[#10242F]">Meetings &amp; Action Points</h3>
              <div className="mt-3 divide-y divide-slate-100 text-xs">
                {govData.meetings.map((m) => (
                  <div key={String(m.id)} className="py-3">
                    <p className="font-bold text-[#10242F]">{m.title}</p>
                    <p className="text-slate-500 font-mono-tabular">{formatDate(String(m.scheduled_at))} · {m.venue} · Quorum {m.quorum_required}</p>
                  </div>
                ))}
                {govData.actionPoints.map((ap) => (
                  <div key={String(ap.id)} className="py-3 flex justify-between">
                    <div>
                      <p className="font-semibold">{ap.title}</p>
                      <p className="text-slate-500">Assigned: {ap.assigned_to_name} · Due {formatDate(String(ap.due_date))}</p>
                    </div>
                    <span className="font-semibold text-[#053559]">{ap.status}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-lg font-bold text-[#10242F]">Member Feedback &amp; Public Inquiries</h3>
              <div className="mt-3 divide-y divide-slate-100 text-xs">
                {govData.inquiries.map((inq) => (
                  <div key={String(inq.id)} className="py-3 space-y-1">
                    <div className="flex justify-between">
                      <span className="font-bold text-[#10242F]">{inq.subject}</span>
                      <span className="text-[#AD220B] font-semibold">{inq.submission_type}</span>
                    </div>
                    <p className="text-slate-600">{inq.message}</p>
                    <p className="text-[11px] text-slate-400">From: {inq.sender_name} · Status: {inq.status}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RBAC MATRIX & AUTHORISED USERS MODULE */}
      {mode === 'rbac' && rbacData && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="font-display text-xl font-bold text-[#10242F]">Role-Based Access Control (13 Roles)</h2>
                <p className="text-xs text-slate-600">
                  Permissions are enforced server-side. Super Administrator manages technical configuration without overriding constitutional votes or financial gates.
                </p>
              </div>
              <select value={selectedRoleId} onChange={(e) => setSelectedRoleId(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold">
                {rbacData.roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.display_name} ({r.scope_level} scope)</option>
                ))}
              </select>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Module</th>
                    {['View', 'Create', 'Edit', 'Approve', 'Export', 'Manage'].map((col) => (
                      <th key={col} className="px-3 py-2.5 font-semibold text-center">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rbacData.permissions
                    .filter((p) => p.role_id === selectedRoleId)
                    .map((p) => (
                      <tr key={p.module}>
                        <td className="px-3 py-2.5 font-semibold capitalize text-[#10242F]">{p.module}</td>
                        {(['can_view', 'can_create', 'can_edit', 'can_approve', 'can_export', 'can_manage'] as const).map((field) => (
                          <td key={field} className="px-3 py-2.5 text-center">
                            <input
                              type="checkbox"
                              disabled={!user.permissions.rbac?.manage}
                              checked={Boolean(p[field])}
                              onChange={() => togglePermission(p.role_id, p.module, field, p[field])}
                              className="h-4 w-4 rounded border-slate-300 accent-[#BD5016] cursor-pointer"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div>
                <h3 className="font-display text-lg font-bold text-[#10242F]">Authorised Users &amp; Role Assignments</h3>
                <p className="text-xs text-slate-600">
                  Lists every member holding administrative, executive, branch, or portal access roles.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Member</th>
                      <th className="px-3 py-2.5 font-semibold">Role</th>
                      <th className="px-3 py-2.5 font-semibold">Scope</th>
                      <th className="px-3 py-2.5 font-semibold">Status</th>
                      {user.permissions.rbac?.manage && <th className="px-3 py-2.5 font-semibold text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rbacData.assignments.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-[#10242F]">{a.full_name}</p>
                          <p className="font-mono-tabular text-[11px] text-slate-500">{a.membership_number}</p>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-[#053559]">{a.role_name}</td>
                        <td className="px-3 py-2.5 text-slate-600">{a.branch_name || a.subdivision_name || 'National'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`font-semibold ${a.is_active ? 'text-[#146B3A]' : 'text-slate-400'}`}>
                            {a.is_active ? 'Active' : 'Revoked'}
                          </span>
                        </td>
                        {user.permissions.rbac?.manage && (
                          <td className="px-3 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => toggleRoleAssignment(a.id, a.is_active)}
                              className={`rounded border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${
                                a.is_active
                                  ? 'border-red-200 text-[#AD220B] hover:bg-red-50'
                                  : 'border-emerald-200 text-[#146B3A] hover:bg-emerald-50'
                              }`}
                            >
                              {a.is_active ? 'Revoke' : 'Reactivate'}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {user.permissions.rbac?.manage && (
              <form onSubmit={assignUserRole} className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3 h-fit">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4 text-[#BD5016]" />
                  <h3 className="text-sm font-bold text-[#10242F]">Assign Role to Member</h3>
                </div>
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-semibold text-[#10242F]">Select Member *</label>
                    <select
                      required
                      value={assignForm.member_id}
                      onChange={(e) => setAssignForm({ ...assignForm, member_id: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    >
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name} ({m.membership_number})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-[#10242F]">Role *</label>
                    <select
                      required
                      value={assignForm.role_id}
                      onChange={(e) => setAssignForm({ ...assignForm, role_id: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    >
                      {rbacData.roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.display_name} ({r.scope_level})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-[#10242F]">Branch Scope (Optional)</label>
                    <select
                      value={assignForm.branch_id}
                      onChange={(e) => setAssignForm({ ...assignForm, branch_id: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                    >
                      <option value="">National / Unscoped</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button type="submit" className="w-full rounded-lg bg-[#BD5016] py-2 text-xs font-semibold text-white hover:bg-[#9D4010] cursor-pointer">
                  Assign Role
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* REPORTS & ANALYTICS MODULE */}
      {mode === 'reports' && reports && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
            <div>
              <h2 className="font-display text-xl font-bold text-[#10242F]">Reports &amp; Organisational Analytics</h2>
              <p className="text-xs text-slate-600">Live aggregations across membership, verified GHS income, expenditure, and event attendance.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  exportToExcel(
                    'LASUPADORA-Analytics-Report',
                    'Branch Finance',
                    reports.financeByBranch.map((f) => ({
                      Branch: f.branch_name,
                      'Verified Income (GHS)': f.income_ghs,
                      'Approved Expenditure (GHS)': f.expenditure_ghs,
                    }))
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold cursor-pointer"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel
              </button>
              <button
                type="button"
                onClick={() =>
                  exportTableToPDF(
                    'LASUPADORA-Analytics-Report',
                    'Branch Financial & Membership Report',
                    'Official Summary',
                    ['Branch', 'Verified Income', 'Expenditure'],
                    reports.financeByBranch.map((f) => [f.branch_name, formatGHS(f.income_ghs), formatGHS(f.expenditure_ghs)])
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#10242F] px-3 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" /> Export PDF
              </button>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-sm font-bold text-[#10242F]">Verified Income vs Expenditure by Branch (GHS)</h3>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={reports.financeByBranch}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="branch_name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="income_ghs" name="Income (GHS)" fill="#146B3A" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="expenditure_ghs" name="Expenditure (GHS)" fill="#AD220B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="text-sm font-bold text-[#10242F]">Membership Distribution by Category</h3>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={reports.membersByCategory} dataKey="member_count" nameKey="category_name" cx="50%" cy="50%" outerRadius={85} label>
                      {reports.membersByCategory.map((_entry, idx) => (
                        <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Event Title</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold text-right">Registered</th>
                  <th className="px-4 py-3 font-semibold text-right">Present</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reports.eventAttendance.map((ev) => (
                  <tr key={ev.title}>
                    <td className="px-4 py-3 font-semibold text-[#10242F]">{ev.title}</td>
                    <td className="px-4 py-3 font-mono-tabular">{formatDate(ev.event_date)}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular">{ev.registered}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-semibold text-[#146B3A]">{ev.present}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
