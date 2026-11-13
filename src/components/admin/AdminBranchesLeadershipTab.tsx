import React, { useEffect, useState } from 'react';
import { Camera, RefreshCw, Upload, X } from 'lucide-react';
import { apiFetch, formatDate } from '../../lib/api';
import type { AuthUser, Branch, LeadershipAppointment, MemberRecord, Subdivision } from '../../types';

export const AdminBranchesLeadershipTab: React.FC<{ user: AuthUser }> = ({ user }) => {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [subdivisions, setSubdivisions] = useState<Subdivision[]>([]);
  const [appointments, setAppointments] = useState<LeadershipAppointment[]>([]);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [newBranch, setNewBranch] = useState({ code: '', name: '', branch_type: 'outside_tema', region: '', description: '' });
  const [newSub, setNewSub] = useState({ branch_id: '', code: '', name: '', subdivision_type: 'town', town_or_community: '', region: '' });
  const [newLead, setNewLead] = useState({
    member_id: '',
    portfolio: 'Secretary',
    scope_type: 'national',
    branch_id: '',
    term_number: 1,
    term_start: '2026-01-01',
    term_expiry: '2027-12-31',
    oath_signed: true,
    is_public_approved: true,
    can_act_for_president: false,
    biography: '',
  });
  const [newLeadPhoto, setNewLeadPhoto] = useState<{ filename: string; mimeType: string; dataBase64: string } | null>(null);

  // Edit / Replace Leader Modal state
  const [editingLead, setEditingLead] = useState<LeadershipAppointment | null>(null);
  const [editMode, setEditMode] = useState<'edit' | 'replace'>('edit');
  const [editForm, setEditForm] = useState({
    member_id: '',
    portfolio: '',
    term_start: '',
    term_expiry: '',
    term_number: 1,
    biography: '',
    oath_signed: true,
    is_public_approved: true,
    can_act_for_president: false,
    status: 'Active',
  });
  const [editPhotoFile, setEditPhotoFile] = useState<{ filename: string; mimeType: string; dataBase64: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const loadAll = async () => {
    setErr(null);
    try {
      if (user.permissions.branches?.view) {
        const bRes = await apiFetch<{ branches: Branch[]; subdivisions: Subdivision[] }>('/api/admin/branches');
        setBranches(bRes.branches);
        setSubdivisions(bRes.subdivisions);
        if (bRes.branches[0] && !newSub.branch_id) {
          setNewSub((p) => ({ ...p, branch_id: bRes.branches[0].id }));
        }
      }
      if (user.permissions.leadership?.view) {
        const lRes = await apiFetch<{ appointments: LeadershipAppointment[] }>('/api/admin/leadership');
        setAppointments(lRes.appointments);
      }
      if (user.permissions.membership?.view) {
        const mRes = await apiFetch<{ members: MemberRecord[] }>('/api/admin/members');
        setMembers(mRes.members);
        if (mRes.members[0] && !newLead.member_id) {
          setNewLead((p) => ({ ...p, member_id: mRes.members[0].id }));
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const readPickedImage = (
    file: File | undefined,
    setter: React.Dispatch<React.SetStateAction<{ filename: string; mimeType: string; dataBase64: string } | null>>
  ) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setter({ filename: file.name, mimeType: file.type, dataBase64: String(reader.result || '') });
    };
    reader.readAsDataURL(file);
  };

  const uploadPublicPortrait = async (fileObj: { filename: string; mimeType: string; dataBase64: string }) => {
    const res = await apiFetch<{ url: string }>('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ ...fileObj, visibility: 'public' }),
    });
    return res.url;
  };

  const quickUploadRowPhoto = async (lead: LeadershipAppointment, file: File | undefined) => {
    if (!file) return;
    setErr(null);
    setMsg(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const url = await uploadPublicPortrait({
          filename: file.name,
          mimeType: file.type,
          dataBase64: String(reader.result || ''),
        });
        await apiFetch(`/api/admin/leadership/${lead.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ photo_url: url }),
        });
        setMsg(`Updated official portrait for ${lead.full_name} (${lead.portfolio}).`);
        await loadAll();
      } catch (e) {
        setErr((e as Error).message);
      }
    };
    reader.readAsDataURL(file);
  };

  const openModal = (lead: LeadershipAppointment, mode: 'edit' | 'replace') => {
    setEditingLead(lead);
    setEditMode(mode);
    setEditPhotoFile(null);
    setEditForm({
      member_id: mode === 'replace' ? members.find((m) => m.id !== lead.member_id)?.id || lead.member_id : lead.member_id,
      portfolio: lead.portfolio,
      term_start: mode === 'replace' ? new Date().toISOString().slice(0, 10) : lead.term_start,
      term_expiry: lead.term_expiry,
      term_number: lead.term_number || 1,
      biography: mode === 'replace' ? '' : lead.biography || '',
      oath_signed: mode === 'replace' ? true : Boolean(lead.oath_signed),
      is_public_approved: Boolean(lead.is_public_approved),
      can_act_for_president: Boolean(lead.can_act_for_president),
      status: lead.status || 'Active',
    });
  };

  const saveEditOrReplace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLead) return;
    setSavingEdit(true);
    setErr(null);
    setMsg(null);
    try {
      let uploadedPhotoUrl: string | undefined;
      if (editPhotoFile) {
        uploadedPhotoUrl = await uploadPublicPortrait(editPhotoFile);
      }

      if (editMode === 'replace') {
        await apiFetch('/api/admin/leadership', {
          method: 'POST',
          body: JSON.stringify({
            member_id: editForm.member_id,
            portfolio: editForm.portfolio,
            scope_type: editingLead.scope_type,
            branch_id: editingLead.branch_id,
            term_number: editForm.term_number,
            term_start: editForm.term_start,
            term_expiry: editForm.term_expiry,
            oath_signed: editForm.oath_signed,
            is_public_approved: editForm.is_public_approved,
            can_act_for_president: editForm.can_act_for_president,
            biography: editForm.biography,
            photo_url: uploadedPhotoUrl,
            replace_appointment_id: editingLead.id,
          }),
        });
        setMsg(`New leader appointed to ${editForm.portfolio}. Outgoing term marked Completed.`);
      } else {
        await apiFetch(`/api/admin/leadership/${editingLead.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            member_id: editForm.member_id,
            portfolio: editForm.portfolio,
            term_start: editForm.term_start,
            term_expiry: editForm.term_expiry,
            biography: editForm.biography,
            oath_signed: editForm.oath_signed,
            is_public_approved: editForm.is_public_approved,
            can_act_for_president: editForm.can_act_for_president,
            status: editForm.status,
            ...(uploadedPhotoUrl ? { photo_url: uploadedPhotoUrl } : {}),
          }),
        });
        setMsg(`Updated ${editForm.portfolio} leadership record.`);
      }
      setEditingLead(null);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingEdit(false);
    }
  };

  const createBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch('/api/admin/branches', { method: 'POST', body: JSON.stringify(newBranch) });
      setMsg('New branch created.');
      setNewBranch({ code: '', name: '', branch_type: 'outside_tema', region: '', description: '' });
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const createSubdivision = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch('/api/admin/subdivisions', { method: 'POST', body: JSON.stringify(newSub) });
      setMsg('New subdivision added.');
      setNewSub({ ...newSub, code: '', name: '', town_or_community: '' });
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const createLeadership = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      let photo_url: string | undefined;
      if (newLeadPhoto) {
        photo_url = await uploadPublicPortrait(newLeadPhoto);
      }
      await apiFetch('/api/admin/leadership', { method: 'POST', body: JSON.stringify({ ...newLead, photo_url }) });
      setMsg('Leadership appointment recorded with 14-day handover deadline.');
      setNewLeadPhoto(null);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const toggleSubActive = async (sub: Subdivision) => {
    await apiFetch(`/api/admin/subdivisions/${sub.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: sub.is_active ? false : true }),
    });
    await loadAll();
  };

  const canEditLeadership = Boolean(user.permissions.leadership?.edit);
  const canCreateLeadership = Boolean(user.permissions.leadership?.create);

  return (
    <div className="space-y-8">
      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-[#146B3A]">{msg}</div>}
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-[#AD220B]">{err}</div>}

      {/* Executive & Branch Leadership Management */}
      {user.permissions.leadership?.view && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-display text-xl font-bold text-[#10242F]">Executive &amp; Branch Leadership Portfolios</h2>
              <p className="text-xs text-slate-600">
                Upload or replace leader portraits anytime, or appoint a new leader to any office (2-year max term · max 2 consecutive terms · 14-day handover).
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Portrait</th>
                  <th className="px-4 py-3 font-semibold">Portfolio</th>
                  <th className="px-4 py-3 font-semibold">Office Holder</th>
                  <th className="px-4 py-3 font-semibold">Term / Handover</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  {canEditLeadership && <th className="px-4 py-3 font-semibold text-right">Portrait &amp; Position</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {appointments.map((a) => {
                  const initials = a.full_name
                    .split(' ')
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();
                  return (
                    <tr key={a.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        {a.photo_url ? (
                          <img
                            src={a.photo_url}
                            alt={a.full_name}
                            referrerPolicy="no-referrer"
                            className="h-12 w-12 rounded-lg border border-slate-200 object-cover object-top"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 font-display text-xs font-bold text-[#053559]">
                            {initials}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-[#AD220B]">{a.portfolio}</p>
                        <p className="text-[11px] text-slate-500">{a.branch_name || 'National Executive'}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#10242F]">{a.full_name}</p>
                        <p className="font-mono-tabular text-[11px] text-slate-500">{a.membership_number}</p>
                      </td>
                      <td className="px-4 py-3 font-mono-tabular">
                        <p>Term {a.term_number}: {formatDate(a.term_start)} – {formatDate(a.term_expiry)}</p>
                        <p className="text-[11px] text-slate-500">Handover by {formatDate(a.handover_deadline)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold ${a.status === 'Active' || a.status === 'Acting' ? 'text-[#146B3A]' : 'text-slate-500'}`}>
                          {a.status}
                        </span>
                        <p className="text-[11px] text-slate-500">
                          {a.is_public_approved ? 'Publicly Visible' : 'Hidden from Public'}
                        </p>
                      </td>
                      {canEditLeadership && (
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                          <label className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#10242F] hover:bg-slate-50 cursor-pointer">
                            <Camera className="h-3 w-3" />
                            <span>{a.photo_url ? 'Change Photo' : 'Upload Photo'}</span>
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              onChange={(e) => quickUploadRowPhoto(a, e.target.files?.[0])}
                              className="hidden"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => openModal(a, 'edit')}
                            className="rounded border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-[#053559] hover:bg-slate-50 cursor-pointer"
                          >
                            Edit
                          </button>
                          {canCreateLeadership && (a.status === 'Active' || a.status === 'Acting') && (
                            <button
                              type="button"
                              onClick={() => openModal(a, 'replace')}
                              className="inline-flex items-center gap-1 rounded bg-[#BD5016] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#9D4010] cursor-pointer"
                            >
                              <RefreshCw className="h-3 w-3" />
                              Replace Leader
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {canCreateLeadership && (
            <form onSubmit={createLeadership} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-sm font-bold text-[#10242F]">Appoint Executive or Branch Leader</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <select value={newLead.member_id} onChange={(e) => setNewLead({ ...newLead, member_id: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  {members.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.membership_number})</option>)}
                </select>
                <select value={newLead.portfolio} onChange={(e) => setNewLead({ ...newLead, portfolio: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  {['President', 'General Secretary', 'Secretary', 'Treasurer', 'Organizer', 'Costume Coordinator', 'Band Leader', 'Branch Leader'].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <select value={newLead.term_number} onChange={(e) => setNewLead({ ...newLead, term_number: Number(e.target.value) })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  <option value={1}>Term 1 (2 Years Max)</option>
                  <option value={2}>Term 2 (Final Consecutive Term)</option>
                </select>
                <input type="date" value={newLead.term_start} onChange={(e) => setNewLead({ ...newLead, term_start: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                <input type="date" value={newLead.term_expiry} onChange={(e) => setNewLead({ ...newLead, term_expiry: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                <input type="text" placeholder="Short biography" value={newLead.biography} onChange={(e) => setNewLead({ ...newLead, biography: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="inline-flex items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>{newLeadPhoto ? newLeadPhoto.filename : 'Upload Leader Portrait (Optional)'}</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => readPickedImage(e.target.files?.[0], setNewLeadPhoto)} className="hidden" />
                </label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={newLead.oath_signed} onChange={(e) => setNewLead({ ...newLead, oath_signed: e.target.checked })} /> Leadership Oath Signed</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={newLead.is_public_approved} onChange={(e) => setNewLead({ ...newLead, is_public_approved: e.target.checked })} /> Approved for Public Website</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={newLead.can_act_for_president} onChange={(e) => setNewLead({ ...newLead, can_act_for_president: e.target.checked })} /> Authorized to Act for President</label>
                <button type="submit" className="ml-auto rounded-lg bg-[#BD5016] px-4 py-2 font-semibold text-white cursor-pointer">Save Appointment</button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* Branches & Subdivisions */}
      {user.permissions.branches?.view && (
        <section className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="font-display text-xl font-bold text-[#10242F]">Branches &amp; Subdivisions</h2>
            <div className="space-y-4">
              {branches.map((b) => {
                const subs = subdivisions.filter((s) => s.branch_id === b.id);
                return (
                  <div key={b.id} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-[#10242F]">{b.name} ({b.code})</p>
                        <p className="text-xs text-slate-500">{b.region} · {b.active_members || 0} active members</p>
                      </div>
                      <span className="text-xs font-semibold text-[#146B3A]">{b.is_active ? 'Active' : 'Inactive'}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3 text-[11px]">
                      {subs.map((s) => (
                        <div key={s.id} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 border border-slate-100">
                          <span className={s.is_active ? 'text-[#10242F]' : 'line-through text-slate-400'}>{s.name}</span>
                          {user.permissions.branches?.edit && (
                            <button type="button" onClick={() => toggleSubActive(s)} className="text-[10px] text-[#053559] hover:underline cursor-pointer">
                              {s.is_active ? 'Disable' : 'Enable'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {user.permissions.branches?.create && (
            <div className="lg:col-span-5 space-y-6">
              <form onSubmit={createSubdivision} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-bold text-[#10242F]">Add Subdivision / Town / Community</h3>
                <select value={newSub.branch_id} onChange={(e) => setNewSub({ ...newSub, branch_id: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" required placeholder="Code (e.g. KOF-01)" value={newSub.code} onChange={(e) => setNewSub({ ...newSub, code: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                  <input type="text" required placeholder="Subdivision Name" value={newSub.name} onChange={(e) => setNewSub({ ...newSub, name: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                </div>
                <input type="text" placeholder="Region (e.g. Eastern Region)" value={newSub.region} onChange={(e) => setNewSub({ ...newSub, region: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                <button type="submit" className="w-full rounded-lg bg-[#10242F] py-2 text-xs font-semibold text-white cursor-pointer">Add Subdivision</button>
              </form>

              <form onSubmit={createBranch} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-bold text-[#10242F]">Expand Organisation: Create Branch</h3>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" required placeholder="Code (e.g. WR)" value={newBranch.code} onChange={(e) => setNewBranch({ ...newBranch, code: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                  <input type="text" required placeholder="Branch Name" value={newBranch.name} onChange={(e) => setNewBranch({ ...newBranch, name: e.target.value })} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                </div>
                <input type="text" placeholder="Region" value={newBranch.region} onChange={(e) => setNewBranch({ ...newBranch, region: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                <button type="submit" className="w-full rounded-lg border border-slate-300 py-2 text-xs font-semibold text-[#10242F] hover:bg-slate-50 cursor-pointer">Create Branch</button>
              </form>
            </div>
          )}
        </section>
      )}

      {/* Edit / Replace Leader Modal */}
      {editingLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={saveEditOrReplace} className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg font-bold text-[#10242F]">
                {editMode === 'replace' ? `Appoint New Leader — ${editingLead.portfolio}` : `Edit ${editingLead.portfolio} Profile`}
              </h3>
              <button type="button" onClick={() => setEditingLead(null)} className="p-1 text-slate-500 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>

            {editMode === 'replace' && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Outgoing officer <strong>{editingLead.full_name}</strong> will be archived as <strong>Completed</strong> in leadership history while the incoming leader assumes office.
              </p>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-[#10242F]">Office Holder</label>
                <select
                  value={editForm.member_id}
                  onChange={(e) => setEditForm({ ...editForm, member_id: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name} ({m.membership_number})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#10242F]">Term Start</label>
                  <input type="date" value={editForm.term_start} onChange={(e) => setEditForm({ ...editForm, term_start: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </div>
                <div>
                  <label className="block font-semibold text-[#10242F]">Term Expiry</label>
                  <input type="date" value={editForm.term_expiry} onChange={(e) => setEditForm({ ...editForm, term_expiry: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-[#10242F]">Approved Public Biography</label>
                <textarea rows={3} value={editForm.biography} onChange={(e) => setEditForm({ ...editForm, biography: e.target.value })} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
              </div>

              <div>
                <label className="block font-semibold text-[#10242F]">Official Portrait Photo (PNG, JPG, WEBP)</label>
                <label className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 p-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">
                  <Camera className="h-4 w-4" />
                  <span>{editPhotoFile ? editPhotoFile.filename : 'Select New Portrait Photo (Optional)'}</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => readPickedImage(e.target.files?.[0], setEditPhotoFile)} className="hidden" />
                </label>
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={editForm.oath_signed} onChange={(e) => setEditForm({ ...editForm, oath_signed: e.target.checked })} /> Oath Signed</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={editForm.is_public_approved} onChange={(e) => setEditForm({ ...editForm, is_public_approved: e.target.checked })} /> Show on Public Website</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={editForm.can_act_for_president} onChange={(e) => setEditForm({ ...editForm, can_act_for_president: e.target.checked })} /> Acting Authority</label>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingEdit}
              className="w-full rounded-lg bg-[#BD5016] py-2.5 text-xs font-semibold text-white hover:bg-[#9D4010] disabled:opacity-50 cursor-pointer"
            >
              {savingEdit ? 'Saving...' : editMode === 'replace' ? 'Confirm Leader Replacement' : 'Save Leadership Changes'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
