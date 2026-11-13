import React, { useEffect, useState } from 'react';
import { Bell, Calendar, CreditCard, MessageSquare, Shield, UserCheck } from 'lucide-react';
import { MembershipIDCard } from './MembershipIDCard';
import { apiFetch, formatDate, formatGHS } from '../lib/api';
import type { MemberRecord, SocietyEvent } from '../types';

interface MemberPortalPayload {
  profile: MemberRecord;
  payments: {
    id: string;
    receipt_number: string;
    payment_category: string;
    amount_ghs: number;
    payment_date: string;
    payment_method: string;
    reference_number: string;
    verification_status: string;
    notes: string;
  }[];
  duesSummary: {
    annualDuesGhs: number;
    verifiedPaidGhs: number;
    outstandingBalanceGhs: number;
  };
  registrations: {
    id: string;
    event_id: string;
    title: string;
    event_date: string;
    venue: string;
    attendance_status: string;
  }[];
  inquiries: {
    id: string;
    submission_type: string;
    subject: string;
    message: string;
    status: string;
    response_text: string | null;
    created_at: string;
  }[];
  notifications: {
    id: string;
    title: string;
    body: string;
    is_read: number;
    created_at: string;
  }[];
}

export const MemberPortal: React.FC<{ onOpenVerify: (token: string) => void }> = ({ onOpenVerify }) => {
  const [tab, setTab] = useState<'profile' | 'idcard' | 'dues' | 'events' | 'feedback'>('profile');
  const [portal, setPortal] = useState<MemberPortalPayload | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<SocietyEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [profileForm, setProfileForm] = useState({
    telephone: '',
    residential_address: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    requested_official_note: '',
  });

  const [payClaim, setPayClaim] = useState({
    amount_ghs: '',
    payment_category: 'Dues',
    payment_method: 'Mobile Money',
    reference_number: '',
    notes: '',
  });

  const [inqForm, setInqForm] = useState({
    submission_type: 'Suggestion',
    subject: '',
    message: '',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [p, pub] = await Promise.all([
        apiFetch<MemberPortalPayload>('/api/member/portal'),
        apiFetch<{ events: SocietyEvent[] }>('/api/public/overview'),
      ]);
      setPortal(p);
      setUpcomingEvents(pub.events.filter((e) => e.status === 'Upcoming'));
      setProfileForm({
        telephone: p.profile.telephone || '',
        residential_address: p.profile.residential_address || '',
        emergency_contact_name: p.profile.emergency_contact_name || '',
        emergency_contact_phone: p.profile.emergency_contact_phone || '',
        requested_official_note: '',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      await apiFetch('/api/member/profile-change', {
        method: 'POST',
        body: JSON.stringify(profileForm),
      });
      setFeedbackMsg('Contact details updated. Any official record change note has been queued for Secretariat approval.');
      await loadData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handlePaymentClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch<{ receipt_number: string }>('/api/member/payments/submit', {
        method: 'POST',
        body: JSON.stringify(payClaim),
      });
      setFeedbackMsg(`Payment reference logged (${res.receipt_number}). Status remains Pending Verification until confirmed by the Treasurer.`);
      setPayClaim({ amount_ghs: '', payment_category: 'Dues', payment_method: 'Mobile Money', reference_number: '', notes: '' });
      await loadData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleRegisterEvent = async (eventId: string) => {
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      await apiFetch(`/api/member/events/${eventId}/register`, { method: 'POST' });
      setFeedbackMsg('Successfully registered for the upcoming event.');
      await loadData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleInquirySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedbackMsg(null);
    try {
      await apiFetch('/api/member/inquiries', {
        method: 'POST',
        body: JSON.stringify(inqForm),
      });
      setFeedbackMsg('Your submission has been recorded for Executive review.');
      setInqForm({ submission_type: 'Suggestion', subject: '', message: '' });
      await loadData();
    } catch (err) {
      setErrorMsg((err as Error).message);
    }
  };

  const markRead = async (id: string) => {
    await apiFetch(`/api/member/notifications/${id}/read`, { method: 'POST' });
    await loadData();
  };

  if (loading || !portal) {
    return <div className="p-8 text-sm text-slate-500">Loading your personal Member Portal...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#10242F]">Personal Member Portal</h1>
          <p className="text-xs text-slate-600">
            {portal.profile.membership_number} · {portal.profile.branch_name} ({portal.profile.subdivision_name})
          </p>
        </div>

        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1">
          {[
            { id: 'profile', label: 'My Profile', icon: UserCheck },
            { id: 'idcard', label: 'Digital ID Card', icon: Shield },
            { id: 'dues', label: 'Dues & Payments', icon: CreditCard },
            { id: 'events', label: 'Events & Attendance', icon: Calendar },
            { id: 'feedback', label: 'Inquiries & Notices', icon: MessageSquare },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id as typeof tab);
                setFeedbackMsg(null);
                setErrorMsg(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                tab === t.id ? 'bg-white text-[#10242F] shadow-sm' : 'text-slate-600 hover:text-[#10242F]'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {feedbackMsg && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-[#146B3A]">
          {feedbackMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-[#AD220B]">
          {errorMsg}
        </div>
      )}

      {/* PROFILE TAB */}
      {tab === 'profile' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#10242F]">Official Membership Summary</h2>
            <dl className="divide-y divide-slate-100 text-xs">
              <div className="flex justify-between py-2.5"><dt className="text-slate-500">Full Name</dt><dd className="font-semibold text-[#10242F]">{portal.profile.full_name}</dd></div>
              <div className="flex justify-between py-2.5"><dt className="text-slate-500">Membership Number</dt><dd className="font-mono-tabular font-semibold text-[#AD220B]">{portal.profile.membership_number}</dd></div>
              <div className="flex justify-between py-2.5"><dt className="text-slate-500">Status</dt><dd className="font-semibold text-[#146B3A]">{portal.profile.membership_status}</dd></div>
              <div className="flex justify-between py-2.5"><dt className="text-slate-500">Branch</dt><dd className="font-medium">{portal.profile.branch_name}</dd></div>
              <div className="flex justify-between py-2.5"><dt className="text-slate-500">Subdivision</dt><dd className="font-medium">{portal.profile.subdivision_name}</dd></div>
              <div className="flex justify-between py-2.5"><dt className="text-slate-500">Category</dt><dd className="font-medium">{portal.profile.category_name}</dd></div>
              <div className="flex justify-between py-2.5"><dt className="text-slate-500">Registered</dt><dd className="font-mono-tabular">{formatDate(portal.profile.registration_date)}</dd></div>
            </dl>
          </div>

          <form onSubmit={handleSaveProfile} className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#10242F]">Update Personal Contact Information</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-[#10242F]">Telephone</label>
                <input
                  type="text"
                  value={profileForm.telephone}
                  onChange={(e) => setProfileForm({ ...profileForm, telephone: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#10242F]">Residential Address</label>
                <input
                  type="text"
                  value={profileForm.residential_address}
                  onChange={(e) => setProfileForm({ ...profileForm, residential_address: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#10242F]">Emergency Contact Name</label>
                <input
                  type="text"
                  value={profileForm.emergency_contact_name}
                  onChange={(e) => setProfileForm({ ...profileForm, emergency_contact_name: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#10242F]">Emergency Contact Phone</label>
                <input
                  type="text"
                  value={profileForm.emergency_contact_phone}
                  onChange={(e) => setProfileForm({ ...profileForm, emergency_contact_phone: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#10242F]">
                Official Record Amendment Request (Requires Administrative Approval)
              </label>
              <input
                type="text"
                placeholder="e.g. Request name correction or branch transfer..."
                value={profileForm.requested_official_note}
                onChange={(e) => setProfileForm({ ...profileForm, requested_official_note: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-[#BD5016] px-5 py-2.5 text-xs font-semibold text-white hover:bg-[#9D4010] cursor-pointer"
            >
              Save Profile Updates
            </button>
          </form>
        </div>
      )}

      {/* DIGITAL ID CARD TAB */}
      {tab === 'idcard' && (
        <div className="rounded-xl border border-slate-200 bg-white p-8">
          <MembershipIDCard member={portal.profile} onOpenVerify={onOpenVerify} />
        </div>
      )}

      {/* DUES & PAYMENTS TAB */}
      {tab === 'dues' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs text-slate-500">Annual Dues ({portal.profile.category_name})</p>
              <p className="mt-1 font-mono-tabular text-2xl font-bold text-[#10242F]">{formatGHS(portal.duesSummary.annualDuesGhs)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs text-slate-500">Verified Payments</p>
              <p className="mt-1 font-mono-tabular text-2xl font-bold text-[#146B3A]">{formatGHS(portal.duesSummary.verifiedPaidGhs)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <p className="text-xs text-slate-500">Outstanding Balance</p>
              <p className="mt-1 font-mono-tabular text-2xl font-bold text-[#AD220B]">{formatGHS(portal.duesSummary.outstandingBalanceGhs)}</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <form onSubmit={handlePaymentClaim} className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <h3 className="font-display text-lg font-bold text-[#10242F]">Submit Payment Reference</h3>
              <p className="text-xs text-slate-500">
                Submitted references enter <strong>Pending Verification</strong> and are only credited after Treasurer confirmation.
              </p>
              <div>
                <label className="block text-xs font-semibold">Amount (GHS) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={payClaim.amount_ghs}
                  onChange={(e) => setPayClaim({ ...payClaim, amount_ghs: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold">Payment Method</label>
                <select
                  value={payClaim.payment_method}
                  onChange={(e) => setPayClaim({ ...payClaim, payment_method: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="Mobile Money">Mobile Money</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold">Transaction Reference *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. MTN-882910"
                  value={payClaim.reference_number}
                  onChange={(e) => setPayClaim({ ...payClaim, reference_number: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono-tabular"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-[#BD5016] py-2.5 text-xs font-semibold text-white hover:bg-[#9D4010] cursor-pointer"
              >
                Log Payment for Verification
              </button>
            </form>

            <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-200 px-6 py-4">
                <h3 className="font-display text-lg font-bold text-[#10242F]">Personal Payment History</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Receipt</th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Method / Ref</th>
                      <th className="px-4 py-3 font-semibold text-right">Amount</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {portal.payments.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 font-mono-tabular font-semibold">{p.receipt_number}</td>
                        <td className="px-4 py-3 font-mono-tabular">{formatDate(p.payment_date)}</td>
                        <td className="px-4 py-3">
                          {p.payment_method} · <span className="font-mono-tabular">{p.reference_number}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono-tabular font-semibold">{formatGHS(p.amount_ghs)}</td>
                        <td className="px-4 py-3 font-semibold">
                          <span className={p.verification_status === 'Verified' ? 'text-[#146B3A]' : p.verification_status === 'Rejected' ? 'text-[#AD220B]' : 'text-amber-700'}>
                            {p.verification_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EVENTS & ATTENDANCE TAB */}
      {tab === 'events' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="font-display text-lg font-bold text-[#10242F]">Upcoming Events Open for Registration</h2>
            <div className="mt-4 divide-y divide-slate-100">
              {upcomingEvents.map((evt) => {
                const isRegistered = portal.registrations.some((r) => r.event_id === evt.id);
                return (
                  <div key={evt.id} className="py-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-[#10242F]">{evt.title}</p>
                      <p className="text-xs text-slate-500 mt-0.5 font-mono-tabular">
                        {formatDate(evt.event_date)} · {evt.venue}
                      </p>
                    </div>
                    {isRegistered ? (
                      <span className="text-xs font-semibold text-[#146B3A] whitespace-nowrap">Registered</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleRegisterEvent(evt.id)}
                        className="rounded-lg bg-[#BD5016] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#9D4010] whitespace-nowrap cursor-pointer"
                      >
                        Register
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="font-display text-lg font-bold text-[#10242F]">My Event Attendance History</h2>
            <div className="mt-4 divide-y divide-slate-100">
              {portal.registrations.map((reg) => (
                <div key={reg.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="font-semibold text-[#10242F]">{reg.title}</p>
                    <p className="text-slate-500 font-mono-tabular">{formatDate(reg.event_date)} · {reg.venue}</p>
                  </div>
                  <span className="font-semibold text-[#053559]">{reg.attendance_status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* INQUIRIES, CONSTRUCTIVE CRITICISM & NOTIFICATIONS TAB */}
      {tab === 'feedback' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <form onSubmit={handleInquirySubmit} className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="font-display text-lg font-bold text-[#10242F]">Submit Inquiry or Constructive Feedback</h2>
            <p className="text-xs text-slate-600">
              LASUPADORA upholds every member&apos;s right to express opinions and offer constructive criticism.
            </p>
            <div>
              <label className="block text-xs font-semibold">Submission Type</label>
              <select
                value={inqForm.submission_type}
                onChange={(e) => setInqForm({ ...inqForm, submission_type: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="Suggestion">Suggestion</option>
                <option value="Inquiry">Inquiry</option>
                <option value="Constructive Criticism">Constructive Criticism</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold">Subject *</label>
              <input
                type="text"
                required
                value={inqForm.subject}
                onChange={(e) => setInqForm({ ...inqForm, subject: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold">Message *</label>
              <textarea
                rows={4}
                required
                value={inqForm.message}
                onChange={(e) => setInqForm({ ...inqForm, message: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-[#10242F] py-2.5 text-xs font-semibold text-white hover:bg-[#053559] cursor-pointer"
            >
              Submit to Secretariat
            </button>
          </form>

          <div className="lg:col-span-7 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-[#BD5016]" />
                <h3 className="font-display text-lg font-bold text-[#10242F]">Personal Notifications</h3>
              </div>
              <div className="mt-3 divide-y divide-slate-100">
                {portal.notifications.length === 0 ? (
                  <p className="py-4 text-xs text-slate-500">No notifications.</p>
                ) : (
                  portal.notifications.map((n) => (
                    <div key={n.id} className="py-3 flex items-start justify-between gap-4">
                      <div>
                        <p className={`text-xs ${n.is_read ? 'text-slate-600' : 'font-bold text-[#10242F]'}`}>{n.title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{n.body}</p>
                      </div>
                      {!n.is_read && (
                        <button
                          type="button"
                          onClick={() => markRead(n.id)}
                          className="text-[11px] font-semibold text-[#BD5016] hover:underline shrink-0 cursor-pointer"
                        >
                          Mark read
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="font-display text-lg font-bold text-[#10242F]">My Submitted Feedback</h3>
              <div className="mt-3 divide-y divide-slate-100">
                {portal.inquiries.map((inq) => (
                  <div key={inq.id} className="py-3 text-xs">
                    <div className="flex justify-between">
                      <span className="font-bold text-[#10242F]">{inq.subject}</span>
                      <span className="font-semibold text-[#053559]">{inq.status}</span>
                    </div>
                    <p className="mt-1 text-slate-600">{inq.message}</p>
                    {inq.response_text && (
                      <p className="mt-2 rounded bg-slate-50 p-2 text-slate-700">
                        <strong>Response:</strong> {inq.response_text}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
