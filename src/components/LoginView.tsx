import React, { useState } from 'react';
import { ArrowLeft, KeyRound, Lock, Mail, Shield, UserCheck } from 'lucide-react';
import { OfficialLogo } from './OfficialLogo';
import { apiFetch, setAuthToken } from '../lib/api';
import type { AuthUser } from '../types';

export type LoginMode = 'member' | 'admin';

const ADMIN_TEST_ACCOUNTS = [
  { label: 'President', email: 'president@lasupadora.org', note: 'National executive authority, leadership & approvals' },
  { label: 'General Secretary', email: 'gensec@lasupadora.org', note: 'National admin & acting-president authority' },
  { label: 'Treasurer', email: 'treasurer@lasupadora.org', note: 'GHS dues, budgets & 7-day receipt gates' },
  { label: 'Tema Branch Leader', email: 'tema.leader@lasupadora.org', note: 'Scoped strictly to Tema Communities 1-25' },
  { label: 'Outside Tema Leader', email: 'outside.leader@lasupadora.org', note: 'Scoped strictly to Outside Tema towns' },
];

const MEMBER_TEST_ACCOUNTS = [
  { label: 'Senior Member (Tema)', email: 'member@lasupadora.org', note: 'LSMS-TM-08-001 · Member Portal, digital ID card & dues' },
  { label: 'Senior Member (Accra / Outside Tema)', email: 'adwoa.mansa@lasupadora.org', note: 'LSMS-OT-002 · Regional member self-service portal' },
  { label: 'Junior Member (Tema)', email: 'junior@lasupadora.org', note: 'LSMS-TM-12-001 · Junior category portal & event registration' },
];

export const LoginView: React.FC<{
  mode: LoginMode;
  onSwitchMode: (nextMode: LoginMode) => void;
  onSuccess: (mode: LoginMode) => Promise<void> | void;
  onBack: () => void;
}> = ({ mode, onSwitchMode, onSuccess, onBack }) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = mode === 'admin';
  const accounts = isAdmin ? ADMIN_TEST_ACCOUNTS : MEMBER_TEST_ACCOUNTS;

  const handleModeSwitch = (nextMode: LoginMode) => {
    setIdentifier('');
    setPassword('');
    setError(null);
    onSwitchMode(nextMode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const loginRes = await apiFetch<{ success: boolean; token?: string; user?: AuthUser | null }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });

      if (loginRes.token) {
        setAuthToken(loginRes.token);
      }

      let currentUser = loginRes.user ?? null;
      if (!currentUser) {
        const session = await apiFetch<{ authenticated: boolean; user: AuthUser | null }>('/api/auth/session');
        currentUser = session.user;
      }

      if (!currentUser) {
        setAuthToken(null);
        setError('Unable to establish your session. Please refresh and try again.');
        setLoading(false);
        return;
      }

      if (isAdmin) {
        const hasAdminAccess = Object.keys(currentUser.permissions).some(
          (mod) => mod !== 'self' && currentUser!.permissions[mod]?.view
        );
        if (!hasAdminAccess) {
          setAuthToken(null);
          await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
          setError('This account does not have Administrator or Executive Officer permissions. Please use Member Login.');
          setLoading(false);
          return;
        }
      }

      await onSuccess(mode);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (email: string) => {
    setIdentifier(email);
    setPassword('Lasupadora2026!');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] px-4 py-12">
      <div className="mx-auto max-w-4xl grid gap-8 lg:grid-cols-12 items-start">
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#10242F] cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Public Website
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => handleModeSwitch('member')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#053559] hover:text-[#BD5016] cursor-pointer"
              >
                <UserCheck className="h-3.5 w-3.5" />
                Switch to Member Login
              </button>
            )}
          </div>

          <div className="mt-6 flex items-center gap-4">
            <OfficialLogo size="md" />
            <div>
              <div className="flex items-center gap-2">
                {isAdmin ? (
                  <Shield className="h-4 w-4 text-[#BD5016]" />
                ) : (
                  <UserCheck className="h-4 w-4 text-[#053559]" />
                )}
                <span className={`text-xs font-bold uppercase tracking-wider ${isAdmin ? 'text-[#BD5016]' : 'text-[#053559]'}`}>
                  {isAdmin ? 'Executive & Officer Access' : 'Society Member Self-Service'}
                </span>
              </div>
              <h1 className="mt-1 font-display text-2xl font-bold text-[#10242F]">
                {isAdmin ? 'Administrator Sign In' : 'Member Portal Sign In'}
              </h1>
              <p className="text-sm text-slate-600">
                {isAdmin
                  ? 'Sign in with an Administrator, Executive, or Branch Officer account to open the Administrator Dashboard.'
                  : 'Sign in with your email or membership number to access your digital ID card, dues history, and events.'}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-[#AD220B]">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#10242F]">
                {isAdmin ? 'Officer Email Address or Membership Number' : 'Member Email Address or Membership Number'}
              </label>
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={isAdmin ? 'e.g. frnacole@gmail.com or LSMS-TM-11-001' : 'e.g. member@lasupadora.org or LSMS-TM-08-001'}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-[#10242F] focus:border-[#053559] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#10242F]">Password</label>
              <div className="relative mt-1.5">
                <Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-[#10242F] focus:border-[#053559] focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 transition-colors cursor-pointer ${
                isAdmin ? 'bg-[#BD5016] hover:bg-[#9D4010]' : 'bg-[#053559] hover:bg-[#10242F]'
              }`}
            >
              {loading
                ? 'Signing in...'
                : isAdmin
                  ? 'Sign In to Administrator Dashboard'
                  : 'Sign In to Member Portal'}
            </button>
          </form>
        </div>

        {/* Role-Scoped Test Accounts Drawer for Immediate Verification */}
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#053559]">
            <KeyRound className="h-4 w-4" />
            <span>{isAdmin ? 'Seeded Administrator & Officer Accounts' : 'Seeded Member Accounts'}</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
            {isAdmin
              ? 'Select an officer role below to verify Admin Dashboard permissions and branch scoping.'
              : 'Select a member account below to verify the self-scoped Member Portal and QR ID card.'}{' '}
            Default password: <code className="font-mono-tabular text-[#10242F]">Lasupadora2026!</code>
          </p>
          <div className="mt-4 divide-y divide-slate-100">
            {accounts.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => quickFill(acc.email)}
                className="flex w-full items-center justify-between py-2.5 text-left hover:bg-slate-50 px-2 rounded transition-colors cursor-pointer"
              >
                <div>
                  <p className="text-xs font-semibold text-[#10242F]">{acc.label}</p>
                  <p className="text-[11px] text-slate-500">{acc.note}</p>
                </div>
                <span className={`text-[11px] font-semibold shrink-0 ${isAdmin ? 'text-[#BD5016]' : 'text-[#053559]'}`}>
                  Fill
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
