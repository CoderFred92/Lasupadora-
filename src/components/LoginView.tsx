import React, { useState } from 'react';
import { ArrowLeft, KeyRound, Lock, Mail, Shield, UserCheck } from 'lucide-react';
import { OfficialLogo } from './OfficialLogo';
import { PasswordInput } from './PasswordInput';
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
  const [memberAuthView, setMemberAuthView] = useState<'signin' | 'activate'>('signin');
  const [activationCode, setActivationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = mode === 'admin';
  const isActivate = !isAdmin && memberAuthView === 'activate';
  const accounts = isAdmin ? ADMIN_TEST_ACCOUNTS : MEMBER_TEST_ACCOUNTS;

  const handleModeSwitch = (nextMode: LoginMode) => {
    setIdentifier('');
    setPassword('');
    setActivationCode('');
    setNewPassword('');
    setConfirmNewPassword('');
    setMemberAuthView('signin');
    setError(null);
    onSwitchMode(nextMode);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isActivate) {
        if (newPassword.length < 8) {
          setError('New password must be at least 8 characters long.');
          setLoading(false);
          return;
        }
        if (newPassword !== confirmNewPassword) {
          setError('New password and confirmation password do not match.');
          setLoading(false);
          return;
        }
        const actRes = await apiFetch<{ success: boolean; token?: string; user?: AuthUser | null }>('/api/auth/activate', {
          method: 'POST',
          body: JSON.stringify({
            identifier,
            activation_code: activationCode,
            new_password: newPassword,
            confirm_password: confirmNewPassword,
          }),
        });
        if (actRes.token) {
          setAuthToken(actRes.token);
        }
        await onSuccess('member');
        return;
      }

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
    setMemberAuthView('signin');
    setIdentifier(email);
    setPassword('Lasupadora2026!');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] px-4 py-6 sm:py-12">
      <div className="mx-auto max-w-4xl grid gap-6 sm:gap-8 lg:grid-cols-12 items-start">
        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-5 sm:p-8 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#10242F] cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Public Website
            </button>

            {isAdmin ? (
              <button
                type="button"
                onClick={() => handleModeSwitch('member')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#053559] hover:text-[#BD5016] cursor-pointer"
              >
                <UserCheck className="h-3.5 w-3.5" />
                Switch to Member Login
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleModeSwitch('admin')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#BD5016] hover:text-[#10242F] cursor-pointer"
              >
                <Shield className="h-3.5 w-3.5" />
                Switch to Admin Login
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
                  {isAdmin ? 'Executive & Officer Access' : isActivate ? 'First-Time Account Activation' : 'Society Member Self-Service'}
                </span>
              </div>
              <h1 className="mt-1 font-display text-2xl font-bold text-[#10242F]">
                {isAdmin ? 'Administrator Sign In' : isActivate ? 'Activate Member Account' : 'Member Portal Sign In'}
              </h1>
              <p className="text-sm text-slate-600">
                {isAdmin
                  ? 'Sign in with an Administrator, Executive, or Branch Officer account to open the Administrator Dashboard.'
                  : isActivate
                    ? 'Enter your Membership ID or Email and the one-time activation code issued by your Branch Officer to set your password.'
                    : 'Sign in with your email or membership number to access your digital ID card, dues history, and events.'}
              </p>
            </div>
          </div>

          {!isAdmin && (
            <div className="mt-6 flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => {
                  setMemberAuthView('signin');
                  setError(null);
                }}
                className={`flex-1 rounded-md py-2 transition-colors cursor-pointer ${
                  memberAuthView === 'signin' ? 'bg-white text-[#10242F] shadow-sm' : 'text-slate-600 hover:text-[#10242F]'
                }`}
              >
                Sign In with Password
              </button>
              <button
                type="button"
                onClick={() => {
                  setMemberAuthView('activate');
                  setError(null);
                }}
                className={`flex-1 rounded-md py-2 transition-colors cursor-pointer ${
                  memberAuthView === 'activate' ? 'bg-white text-[#10242F] shadow-sm' : 'text-slate-600 hover:text-[#10242F]'
                }`}
              >
                Activate Account / Set Password
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
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

            {isActivate ? (
              <>
                <div>
                  <label className="block text-xs font-semibold text-[#10242F]">One-Time Activation Code *</label>
                  <div className="relative mt-1.5">
                    <KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      required
                      value={activationCode}
                      onChange={(e) => setActivationCode(e.target.value.toUpperCase())}
                      placeholder="e.g. ACT-7K9M-2P4X"
                      className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm font-mono-tabular text-[#10242F] focus:border-[#053559] focus:outline-none"
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-[#10242F]">New Password * (min. 8 chars)</label>
                    <PasswordInput
                      key={`activate-new-${mode}`}
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Choose password"
                      containerClassName="mt-1.5"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#10242F] focus:border-[#053559] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#10242F]">Confirm New Password *</label>
                    <PasswordInput
                      key={`activate-confirm-${mode}`}
                      required
                      minLength={8}
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      placeholder="Confirm password"
                      containerClassName="mt-1.5"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#10242F] focus:border-[#053559] focus:outline-none"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-[#10242F]">Password</label>
                <PasswordInput
                  key={`signin-password-${mode}`}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  containerClassName="mt-1.5"
                  leftIcon={<Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 text-sm text-[#10242F] focus:border-[#053559] focus:outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full rounded-lg px-4 py-3 text-sm font-semibold text-white disabled:opacity-50 transition-colors cursor-pointer ${
                isAdmin ? 'bg-[#BD5016] hover:bg-[#9D4010]' : 'bg-[#053559] hover:bg-[#10242F]'
              }`}
            >
              {loading
                ? isActivate
                  ? 'Activating Account...'
                  : 'Signing in...'
                : isAdmin
                  ? 'Sign In to Administrator Dashboard'
                  : isActivate
                    ? 'Activate Account & Sign In'
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
