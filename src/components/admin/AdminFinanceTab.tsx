import React, { useEffect, useState } from 'react';
import { Check, Download, ShieldAlert, X } from 'lucide-react';
import { apiFetch, formatDate, formatGHS } from '../../lib/api';
import { exportTableToPDF } from '../../lib/exportUtils';
import type { AuthUser, Branch, MemberRecord, SocietyEvent } from '../../types';

export const AdminFinanceTab: React.FC<{
  user: AuthUser;
  branches: Branch[];
}> = ({ user, branches }) => {
  const [subTab, setSubTab] = useState<'payments' | 'budgets' | 'expenditures' | 'schedules'>('payments');
  const [data, setData] = useState<{
    schedules: Record<string, string | number>[];
    campaigns: Record<string, string | number>[];
    payments: Record<string, string | number>[];
    budgets: Record<string, string | number>[];
    expenditures: Record<string, string | number>[];
  } | null>(null);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [events, setEvents] = useState<SocietyEvent[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [payForm, setPayForm] = useState({
    member_id: '',
    branch_id: branches[0]?.id || '',
    payment_category: 'Dues',
    amount_ghs: '',
    payment_method: 'Mobile Money',
    reference_number: '',
    notes: '',
  });
  const [budgetForm, setBudgetForm] = useState({ title: '', event_id: '', branch_id: branches[0]?.id || '', requested_amount_ghs: '' });
  const [expForm, setExpForm] = useState({ budget_id: '', branch_id: branches[0]?.id || '', description: '', amount_ghs: '', payee: '' });

  const canApprove = Boolean(user.permissions.finance?.approve);
  const canCreate = Boolean(user.permissions.finance?.create);

  const loadAll = async () => {
    setErr(null);
    try {
      const f = await apiFetch<typeof data>('/api/admin/finance');
      setData(f);
      if (f?.budgets[0] && !expForm.budget_id) {
        const approved = f.budgets.find((b) => b.status === 'Approved');
        if (approved) setExpForm((p) => ({ ...p, budget_id: String(approved.id) }));
      }
      if (user.permissions.membership?.view) {
        const m = await apiFetch<{ members: MemberRecord[] }>('/api/admin/members');
        setMembers(m.members);
        if (m.members[0] && !payForm.member_id) setPayForm((p) => ({ ...p, member_id: m.members[0].id }));
      }
      if (user.permissions.events?.view) {
        const e = await apiFetch<{ events: SocietyEvent[] }>('/api/admin/events');
        setEvents(e.events);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const recordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      const res = await apiFetch<{ receipt_number: string }>('/api/admin/finance/payments', {
        method: 'POST',
        body: JSON.stringify(payForm),
      });
      setMsg(`Payment logged (${res.receipt_number}) as Pending Verification.`);
      setPayForm({ ...payForm, amount_ghs: '', reference_number: '', notes: '' });
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const verifyPayment = async (id: string, verification_status: 'Verified' | 'Rejected') => {
    setErr(null);
    try {
      await apiFetch(`/api/admin/finance/payments/${id}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ verification_status }),
      });
      setMsg(`Payment marked ${verification_status}.`);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const submitBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      const res = await apiFetch<{ four_week_rule_compliant: boolean }>('/api/admin/finance/budgets', {
        method: 'POST',
        body: JSON.stringify(budgetForm),
      });
      setMsg(
        res.four_week_rule_compliant
          ? 'Budget submitted (4-week pre-event submission rule compliant).'
          : 'Budget submitted — Flagged: Submitted less than 4 weeks before event date.'
      );
      setBudgetForm({ ...budgetForm, title: '', requested_amount_ghs: '' });
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const decideBudget = async (id: string, status: 'Approved' | 'Rejected', requested: number) => {
    setErr(null);
    try {
      await apiFetch(`/api/admin/finance/budgets/${id}/decision`, {
        method: 'PATCH',
        body: JSON.stringify({ status, approved_amount_ghs: requested }),
      });
      setMsg(`Budget ${status}.`);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const submitExpenditure = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      const res = await apiFetch<{ receipt_due_date: string }>('/api/admin/finance/expenditures', {
        method: 'POST',
        body: JSON.stringify(expForm),
      });
      setMsg(`Expenditure request logged. Supporting receipts due within 7 days (${res.receipt_due_date}).`);
      setExpForm({ ...expForm, description: '', amount_ghs: '', payee: '' });
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const updateExpenditure = async (id: string, payload: Record<string, unknown>) => {
    setErr(null);
    try {
      await apiFetch(`/api/admin/finance/expenditures/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setMsg('Expenditure accountability record updated.');
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!data) return <div className="p-6 text-xs text-slate-500">Loading financial records (GHS)...</div>;

  return (
    <div className="space-y-6">
      {/* Constitutional Financial Controls Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-3 text-xs">
          <ShieldAlert className="h-4 w-4 text-[#AD220B] shrink-0" />
          <span>
            <strong>Enforced Controls (GHS):</strong> No budget = No approval · No accounts = No next funding · 4-week pre-event budgets · 7-day receipt accountability.
          </span>
        </div>
        <button
          type="button"
          onClick={() =>
            exportTableToPDF(
              'LASUPADORA-Financial-Ledger',
              'Verified Payments & Dues Statement (GHS)',
              `Records: ${data.payments.length}`,
              ['Receipt', 'Member', 'Category', 'Method', 'Date', 'Amount (GHS)', 'Status'],
              data.payments.map((p) => [
                String(p.receipt_number),
                String(p.member_name || 'Society'),
                String(p.payment_category),
                String(p.payment_method),
                String(p.payment_date),
                formatGHS(p.amount_ghs),
                String(p.verification_status),
              ])
            )
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#10242F] hover:bg-slate-50 cursor-pointer"
        >
          <Download className="h-3.5 w-3.5" />
          Export Ledger PDF
        </button>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1 w-fit">
        {[
          { id: 'payments', label: `Payments & Verification (${data.payments.length})` },
          { id: 'budgets', label: `Budgets (${data.budgets.length})` },
          { id: 'expenditures', label: `Expenditures & 7-Day Receipts (${data.expenditures.length})` },
          { id: 'schedules', label: 'Dues & Campaigns' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id as typeof subTab)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${
              subTab === t.id ? 'bg-white text-[#10242F] shadow-sm' : 'text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-[#146B3A]">{msg}</div>}
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-[#AD220B]">{err}</div>}

      {/* PAYMENTS */}
      {subTab === 'payments' && (
        <div className="grid gap-6 lg:grid-cols-12">
          {canCreate && (
            <form onSubmit={recordPayment} className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3 h-fit">
              <h3 className="text-sm font-bold text-[#10242F]">Record Payment (GHS)</h3>
              <select value={payForm.member_id} onChange={(e) => setPayForm({ ...payForm, member_id: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                {members.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.membership_number})</option>)}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <select value={payForm.payment_category} onChange={(e) => setPayForm({ ...payForm, payment_category: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  {['Dues', 'Donation', 'Fundraising', 'Registration Fee', 'Other'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={payForm.payment_method} onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  {['Mobile Money', 'Bank Transfer', 'Cash', 'Cheque'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <input type="number" step="0.01" required placeholder="Amount (GHS)" value={payForm.amount_ghs} onChange={(e) => setPayForm({ ...payForm, amount_ghs: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular" />
              <input type="text" required placeholder="Reference Number *" value={payForm.reference_number} onChange={(e) => setPayForm({ ...payForm, reference_number: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular" />
              <input type="text" placeholder="Notes" value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <button type="submit" className="w-full rounded-lg bg-[#BD5016] py-2 text-xs font-semibold text-white cursor-pointer">Log Payment (Pending Verification)</button>
            </form>
          )}

          <div className={`${canCreate ? 'lg:col-span-8' : 'lg:col-span-12'} rounded-xl border border-slate-200 bg-white overflow-x-auto`}>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Receipt</th>
                  <th className="px-4 py-3 font-semibold">Member / Ref</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  {canApprove && <th className="px-4 py-3 font-semibold text-right">Verify</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.payments.map((p) => (
                  <tr key={String(p.id)}>
                    <td className="px-4 py-3 font-mono-tabular font-semibold">{p.receipt_number}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#10242F]">{p.member_name || 'Society'}</p>
                      <p className="text-[11px] text-slate-500 font-mono-tabular">{p.payment_method} · {p.reference_number}</p>
                    </td>
                    <td className="px-4 py-3">{p.payment_category}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-semibold">{formatGHS(p.amount_ghs)}</td>
                    <td className="px-4 py-3 font-semibold">
                      <span className={p.verification_status === 'Verified' ? 'text-[#146B3A]' : p.verification_status === 'Rejected' ? 'text-[#AD220B]' : 'text-amber-700'}>
                        {p.verification_status}
                      </span>
                    </td>
                    {canApprove && (
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                        {p.verification_status === 'Pending Verification' && (
                          <>
                            <button type="button" onClick={() => verifyPayment(String(p.id), 'Verified')} className="inline-flex items-center gap-0.5 rounded bg-[#146B3A] px-2 py-1 text-[11px] font-semibold text-white cursor-pointer">
                              <Check className="h-3 w-3" /> Verify
                            </button>
                            <button type="button" onClick={() => verifyPayment(String(p.id), 'Rejected')} className="inline-flex items-center gap-0.5 rounded border border-red-300 px-2 py-1 text-[11px] font-semibold text-[#AD220B] cursor-pointer">
                              <X className="h-3 w-3" /> Reject
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* BUDGETS */}
      {subTab === 'budgets' && (
        <div className="grid gap-6 lg:grid-cols-12">
          {canCreate && (
            <form onSubmit={submitBudget} className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3 h-fit">
              <h3 className="text-sm font-bold text-[#10242F]">Submit Event / Branch Budget</h3>
              <input type="text" required placeholder="Budget Title *" value={budgetForm.title} onChange={(e) => setBudgetForm({ ...budgetForm, title: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <select value={budgetForm.event_id} onChange={(e) => setBudgetForm({ ...budgetForm, event_id: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                <option value="">General Operations (No Event)</option>
                {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title} ({formatDate(ev.event_date)})</option>)}
              </select>
              <select value={budgetForm.branch_id} onChange={(e) => setBudgetForm({ ...budgetForm, branch_id: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input type="number" step="0.01" required placeholder="Requested Amount (GHS)" value={budgetForm.requested_amount_ghs} onChange={(e) => setBudgetForm({ ...budgetForm, requested_amount_ghs: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular" />
              <button type="submit" className="w-full rounded-lg bg-[#10242F] py-2 text-xs font-semibold text-white cursor-pointer">Submit Budget for Approval</button>
            </form>
          )}

          <div className={`${canCreate ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-3`}>
            {data.budgets.map((b) => (
              <div key={String(b.id)} className="rounded-xl border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-slate-500">
                    <span>{b.branch_name || 'National'}</span>
                    <span aria-hidden="true"> · </span>
                    <span className={b.four_week_rule_compliant ? 'text-[#146B3A]' : 'text-[#AD220B] font-semibold'}>
                      {b.four_week_rule_compliant ? '4-Week Rule Compliant' : 'Submitted <4 Weeks Before Event'}
                    </span>
                  </div>
                  <h4 className="mt-1 text-sm font-bold text-[#10242F]">{b.title}</h4>
                  <p className="mt-1 font-mono-tabular text-xs text-slate-600">
                    Requested: {formatGHS(b.requested_amount_ghs)} · Approved: {formatGHS(b.approved_amount_ghs || 0)} · Spent: {formatGHS(b.spent_ghs)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#053559]">{b.status}</span>
                  {canApprove && b.status === 'Submitted' && (
                    <>
                      <button type="button" onClick={() => decideBudget(String(b.id), 'Approved', Number(b.requested_amount_ghs))} className="rounded bg-[#146B3A] px-3 py-1.5 text-xs font-semibold text-white cursor-pointer">Approve</button>
                      <button type="button" onClick={() => decideBudget(String(b.id), 'Rejected', 0)} className="rounded border border-red-300 px-3 py-1.5 text-xs font-semibold text-[#AD220B] cursor-pointer">Reject</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* EXPENDITURES & 7-DAY RECEIPT ACCOUNTABILITY */}
      {subTab === 'expenditures' && (
        <div className="grid gap-6 lg:grid-cols-12">
          {canCreate && (
            <form onSubmit={submitExpenditure} className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3 h-fit">
              <h3 className="text-sm font-bold text-[#10242F]">Request Expenditure</h3>
              <p className="text-[11px] text-slate-500">
                Blocked automatically if linked budget is unapproved or if branch has overdue receipts past 7 days.
              </p>
              <select required value={expForm.budget_id} onChange={(e) => setExpForm({ ...expForm, budget_id: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                <option value="">Select Approved Budget...</option>
                {data.budgets.map((b) => <option key={String(b.id)} value={String(b.id)}>{b.title} ({b.status})</option>)}
              </select>
              <select value={expForm.branch_id} onChange={(e) => setExpForm({ ...expForm, branch_id: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <input type="text" required placeholder="Expense Description *" value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <input type="text" required placeholder="Payee *" value={expForm.payee} onChange={(e) => setExpForm({ ...expForm, payee: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <input type="number" step="0.01" required placeholder="Amount (GHS)" value={expForm.amount_ghs} onChange={(e) => setExpForm({ ...expForm, amount_ghs: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular" />
              <button type="submit" className="w-full rounded-lg bg-[#BD5016] py-2 text-xs font-semibold text-white cursor-pointer">Request Disbursement</button>
            </form>
          )}

          <div className={`${canCreate ? 'lg:col-span-8' : 'lg:col-span-12'} rounded-xl border border-slate-200 bg-white overflow-x-auto`}>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Expense / Budget</th>
                  <th className="px-4 py-3 font-semibold">Payee</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                  <th className="px-4 py-3 font-semibold">7-Day Receipt Due</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  {canApprove && <th className="px-4 py-3 font-semibold text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.expenditures.map((ex) => (
                  <tr key={String(ex.id)}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[#10242F]">{ex.description}</p>
                      <p className="text-[11px] text-slate-500">{ex.budget_title}</p>
                    </td>
                    <td className="px-4 py-3">{ex.payee}</td>
                    <td className="px-4 py-3 text-right font-mono-tabular font-semibold">{formatGHS(ex.amount_ghs)}</td>
                    <td className="px-4 py-3 font-mono-tabular">
                      <span className={ex.receipt_submitted ? 'text-[#146B3A]' : 'text-[#AD220B] font-semibold'}>
                        {ex.receipt_submitted ? 'Receipt Verified' : `Due ${formatDate(String(ex.receipt_due_date))}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold">{ex.status}</td>
                    {canApprove && (
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                        {ex.status === 'Pending Approval' && (
                          <button type="button" onClick={() => updateExpenditure(String(ex.id), { status: 'Approved' })} className="rounded bg-[#053559] px-2 py-1 text-[11px] font-semibold text-white cursor-pointer">
                            Approve
                          </button>
                        )}
                        {!ex.receipt_submitted && (
                          <button type="button" onClick={() => updateExpenditure(String(ex.id), { receipt_submitted: true, status: 'Accounted' })} className="rounded bg-[#146B3A] px-2 py-1 text-[11px] font-semibold text-white cursor-pointer">
                            Mark Receipt Filed
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DUES SCHEDULES & CAMPAIGNS */}
      {subTab === 'schedules' && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-display text-lg font-bold text-[#10242F]">Configured Dues Schedules</h3>
            <div className="mt-4 divide-y divide-slate-100 text-xs">
              {data.schedules.map((s) => (
                <div key={String(s.id)} className="py-3 flex justify-between">
                  <div>
                    <p className="font-bold text-[#10242F]">{s.title}</p>
                    <p className="text-slate-500">{s.category_name} · Due {formatDate(String(s.due_date))}</p>
                  </div>
                  <span className="font-mono-tabular font-bold text-[#AD220B]">{formatGHS(s.amount_ghs)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h3 className="font-display text-lg font-bold text-[#10242F]">Fundraising Campaigns</h3>
            <div className="mt-4 space-y-4 text-xs">
              {data.campaigns.map((c) => (
                <div key={String(c.id)} className="rounded-lg border border-slate-200 p-4">
                  <p className="font-bold text-[#10242F]">{c.title}</p>
                  <p className="mt-1 text-slate-600">{c.description}</p>
                  <p className="mt-2 font-mono-tabular font-semibold text-[#146B3A]">
                    Raised: {formatGHS(c.raised_ghs)} / Target: {formatGHS(c.target_amount_ghs)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
