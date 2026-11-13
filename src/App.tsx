import { useEffect, useState } from 'react';
import { PublicSite } from './components/PublicSite';
import { LoginView, type LoginMode } from './components/LoginView';
import { AdminDashboard } from './components/AdminDashboard';
import { QRVerificationView } from './components/QRVerificationView';
import { OfflineIndicator } from './components/PWAControls';
import { apiFetch, setAuthToken } from './lib/api';
import type { AuthUser } from './types';

type AppRoute = 'public' | 'login_member' | 'login_admin' | 'portal' | 'verify';

function hasAdminPermissions(authUser: AuthUser | null): boolean {
  if (!authUser) return false;
  return Object.keys(authUser.permissions).some((mod) => mod !== 'self' && authUser.permissions[mod]?.view);
}

function isAdminEntryUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '').toLowerCase();
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.toLowerCase();
  return (
    path === '/admin' ||
    path.startsWith('/admin/') ||
    path === '/administrator' ||
    params.has('admin') ||
    hash === '#admin' ||
    hash === '#/admin'
  );
}

function clearAdminEntryUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let changed = false;
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  if (path === '/admin' || path.startsWith('/admin/') || path === '/administrator') {
    url.pathname = '/';
    changed = true;
  }
  if (url.searchParams.has('admin')) {
    url.searchParams.delete('admin');
    changed = true;
  }
  const hash = url.hash.toLowerCase();
  if (hash === '#admin' || hash === '#/admin') {
    url.hash = '';
    changed = true;
  }
  if (changed) {
    window.history.replaceState({}, '', url.toString());
  }
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>('public');
  const [portalEntryTab, setPortalEntryTab] = useState<'overview' | 'my_portal'>('overview');
  const [verifyToken, setVerifyToken] = useState<string>('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [booting, setBooting] = useState(true);

  const loadSession = async () => {
    try {
      const res = await apiFetch<{ authenticated: boolean; user: AuthUser | null }>('/api/auth/session');
      setUser(res.user);
      return res.user;
    } catch {
      setUser(null);
      return null;
    }
  };

  const openHiddenAdminAccess = (currentUser: AuthUser | null = user) => {
    if (hasAdminPermissions(currentUser)) {
      setPortalEntryTab('overview');
      setRoute('portal');
    } else {
      setRoute('login_admin');
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const vToken = params.get('verify');
    if (vToken) {
      setVerifyToken(vToken);
      setRoute('verify');
      setBooting(false);
      return;
    }

    const requestedAdmin = isAdminEntryUrl();
    loadSession()
      .then((sessionUser) => {
        if (requestedAdmin) {
          openHiddenAdminAccess(sessionUser);
        }
      })
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    const onUrlChange = () => {
      if (isAdminEntryUrl()) {
        openHiddenAdminAccess(user);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const isAltShortcut = e.altKey && e.shiftKey && e.key.toLowerCase() === 'a';
      const isCtrlAltShortcut = e.ctrlKey && e.altKey && e.key.toLowerCase() === 'a';
      const isLegacyShortcut = (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a';
      if (isAltShortcut || isCtrlAltShortcut || isLegacyShortcut) {
        e.preventDefault();
        openHiddenAdminAccess(user);
      }
    };
    window.addEventListener('hashchange', onUrlChange);
    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('hashchange', onUrlChange);
      window.removeEventListener('popstate', onUrlChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [user]);

  const handleLoginSuccess = async (_mode: LoginMode) => {
    const loggedIn = await loadSession();
    if (loggedIn) {
      clearAdminEntryUrl();
      setPortalEntryTab(hasAdminPermissions(loggedIn) ? 'overview' : 'my_portal');
      setRoute('portal');
    }
  };

  const handleLogout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthToken(null);
    setUser(null);
    clearAdminEntryUrl();
    setRoute('public');
  };

  const handleGoPublic = () => {
    clearAdminEntryUrl();
    setRoute('public');
  };

  const openVerify = (token: string) => {
    setVerifyToken(token);
    setRoute('verify');
    const url = new URL(window.location.href);
    url.searchParams.set('verify', token);
    window.history.pushState({}, '', url.toString());
  };

  const exitVerify = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('verify');
    window.history.pushState({}, '', url.toString());
    setRoute(user ? 'portal' : 'public');
  };

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FA] text-sm text-slate-600">
        Initialising LASUPADORA 360...
      </div>
    );
  }

  return (
    <>
      {route === 'verify' && <QRVerificationView token={verifyToken} onBack={exitVerify} />}

      {route === 'public' && (
        <PublicSite
          user={user}
          onGoMemberLogin={() => setRoute('login_member')}
          onGoAdminLogin={() => openHiddenAdminAccess(user)}
          onGoPortal={() => {
            setPortalEntryTab(hasAdminPermissions(user) ? 'overview' : 'my_portal');
            setRoute('portal');
          }}
          onHiddenAdminAccess={() => openHiddenAdminAccess(user)}
        />
      )}

      {(route === 'login_member' || route === 'login_admin') && (
        <LoginView
          mode={route === 'login_admin' ? 'admin' : 'member'}
          onSwitchMode={(next) => setRoute(next === 'admin' ? 'login_admin' : 'login_member')}
          onSuccess={handleLoginSuccess}
          onBack={handleGoPublic}
        />
      )}

      {route === 'portal' && user && (
        <AdminDashboard
          user={user}
          initialTab={portalEntryTab}
          onLogout={handleLogout}
          onGoPublic={handleGoPublic}
          onOpenVerify={openVerify}
        />
      )}

      {route === 'portal' && !user && (
        <LoginView
          mode="member"
          onSwitchMode={(next) => setRoute(next === 'admin' ? 'login_admin' : 'login_member')}
          onSuccess={handleLoginSuccess}
          onBack={handleGoPublic}
        />
      )}

      <OfflineIndicator />
    </>
  );
}
