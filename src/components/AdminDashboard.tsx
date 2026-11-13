import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  Building2,
  Calendar,
  ChevronRight,
  FileText,
  Home,
  LayoutDashboard,
  LogOut,
  Shield,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { OfficialLogo } from './OfficialLogo';
import { PWAInstallButton } from './PWAControls';
import { MemberPortal } from './MemberPortal';
import { AdminMembershipTab } from './admin/AdminMembershipTab';
import { AdminBranchesLeadershipTab } from './admin/AdminBranchesLeadershipTab';
import { AdminFinanceTab } from './admin/AdminFinanceTab';
import { AdminEventsContentTab } from './admin/AdminEventsContentTab';
import { AdminGovernanceReportsTab } from './admin/AdminGovernanceReportsTab';
import { apiFetch, formatDate, formatGHS } from '../lib/api';
import type { AuthUser, Branch, MembershipCategory, Subdivision } from '../types';

type AdminTabId =
  | 'overview'
  | 'my_portal'
  | 'membership'
  | 'branches_leadership'
  | 'finance'
  | 'events'
  | 'content'
  | 'governance'
  | 'rbac'
  | 'reports';

export const AdminDashboard: React.FC<{
  user: AuthUser;
  initialTab?: 'overview' | 'my_portal';
  onLogout: () => void;
  onGoPublic: () => void;
  onOpenVerify: (token: string) => void;
}> = ({ user, initialTab, onLogout, onGoPublic, onOpenVerify }) => {
  const hasAdminAccess = Object.keys(user.permissions).some(
    (mod) => mod !== 'self' && user.permissions[mod]?.view
  );

  const [tab, setTab] = useState<AdminTabId>(
    initialTab === 'my_portal' ? 'my_portal' : hasAdminAccess ? 'overview' : 'my_portal'
  );
  const [branches, setBranches] = useState<Branch[]>([]);
  const [subdivisions, setSubdivisions] = useState<Subdivision[]>([]);
  const [categories, setCategories] = useState<MembershipCategory[]>([]);
  const [overview, setOverview] = useState<{
    metrics: {
      totalMembers: number;
      activeMembers: number;
      pendingApps: number;
      verifiedIncomeGhs: number;
      totalExpenditureGhs: number;
      upcomingEvents: number;
      openProposals: number;
      pendingPayments: number;
    };
    recentAudit: { id: string; actor_name: string | null; action: string; target_table: string; created_at: string }[];
  } | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  useEffect(() => {
    if (initialTab === 'my_portal') {
      setTab('my_portal');
    } else if (hasAdminAccess) {
      setTab('overview');
    } else {
      setTab('my_portal');
    }
  }, [initialTab, hasAdminAccess]);

  const loadDashboardData = () => {
    apiFetch<{ branches: Branch[]; subdivisions: Subdivision[]; categories: MembershipCategory[] }>('/api/public/overview')
      .then((res) => {
        setBranches(res.branches);
        setSubdivisions(res.subdivisions);
        setCategories(res.categories);
      })
      .catch(() => {});

    if (hasAdminAccess) {
      setOverviewLoading(true);
      setOverviewError(null);
      apiFetch<typeof overview>('/api/admin/overview')
        .then((res) => {
          setOverview(res);
        })
        .catch((err: Error) => {
          setOverviewError(err.message || 'Failed to load Administrator Dashboard metrics.');
        })
        .finally(() => {
          setOverviewLoading(false);
        });
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [hasAdminAccess, tab]);

  const navItems: { id: AdminTabId; label: string; icon: React.ElementType; visible: boolean; summary?: string }[] = [
    { id: 'overview', label: 'Administrator Dashboard', icon: LayoutDashboard, visible: hasAdminAccess },
    { id: 'my_portal', label: 'My Member Portal', icon: UserCheck, visible: true },
    {
      id: 'membership',
      label: 'Members & Applications',
      icon: Users,
      visible: Boolean(user.permissions.membership?.view || user.permissions.applications?.view),
      summary: 'Review applications, manage register, issue ID cards & branch transfers.',
    },
    {
      id: 'branches_leadership',
      label: 'Branches & Leadership',
      icon: Building2,
      visible: Boolean(user.permissions.branches?.view || user.permissions.leadership?.view),
      summary: 'Upload leader portraits, replace officeholders, and manage Tema C1–C25.',
    },
    {
      id: 'finance',
      label: 'Finance & Dues (GHS)',
      icon: Wallet,
      visible: Boolean(user.permissions.finance?.view),
      summary: 'Verify payments, approve 4-week budgets, and enforce 7-day receipts.',
    },
    {
      id: 'events',
      label: 'Events & Attendance',
      icon: Calendar,
      visible: Boolean(user.permissions.events?.view),
      summary: 'Create events, mark participant check-ins, and file post-event reports.',
    },
    {
      id: 'content',
      label: 'News & Media Library',
      icon: FileText,
      visible: Boolean(user.permissions.publications?.view || user.permissions.gallery?.view),
      summary: 'Publish official announcements and manage public vs private media.',
    },
    {
      id: 'governance',
      label: 'Governance & Policies',
      icon: Shield,
      visible: Boolean(user.permissions.governance?.view),
      summary: 'Manage motions, voting, minutes, inquiries, and constitutional policies.',
    },
    {
      id: 'rbac',
      label: 'RBAC Matrix',
      icon: Shield,
      visible: Boolean(user.permissions.rbac?.view),
      summary: 'Configure permissions across all 13 Society roles.',
    },
    {
      id: 'reports',
      label: 'Reports & Analytics',
      icon: BarChart3,
      visible: Boolean(user.permissions.reports?.view),
      summary: 'Charts and 1-click PDF & Excel organisational exports.',
    },
  ];

  const roleLabels = user.roles.map((r) => r.displayName).join(', ');

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#F8F9FA]">
      {/* Sidebar */}
      <aside className="w-full lg:w-72 bg-[#10242F] text-slate-200 flex flex-col shrink-0 no-print">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <OfficialLogo size="xs" framedOnDark />
          <div className="min-w-0">
            <p className="font-display text-sm font-bold text-white truncate">LASUPADORA 360</p>
            <p className="text-[11px] text-[#E48947] font-semibold truncate">{roleLabels}</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3 overflow-x-auto lg:overflow-visible flex lg:flex-col gap-1">
          {navItems
            .filter((item) => item.visible)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tab === item.id
                    ? 'bg-[#BD5016] text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            ))}
        </nav>

        <div className="border-t border-white/10 p-4 space-y-2">
          <PWAInstallButton variant="dark" />
          <button
            type="button"
            onClick={onGoPublic}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10 cursor-pointer"
          >
            <Home className="h-4 w-4" />
            Public Website
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-[#E48947] hover:bg-white/10 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-slate-200 bg-white px-6 py-4 flex flex-wrap items-center justify-between gap-4 no-print">
          <div className="text-xs text-slate-500">
            <span>LASUPADORA 360</span>
            <span aria-hidden="true"> / </span>
            <span className="font-semibold text-[#10242F]">
              {navItems.find((i) => i.id === tab)?.label}
            </span>
          </div>
          <div className="text-right text-xs">
            <p className="font-bold text-[#10242F]">{user.fullName}</p>
            <p className="font-mono-tabular text-[11px] text-slate-500">
              {user.membershipNumber} · {user.isNationalScope ? 'National Scope' : 'Branch/Subdivision Scoped'}
            </p>
          </div>
        </header>

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
          {tab === 'overview' && (
            <div className="space-y-8">
              <div>
                <h1 className="font-display text-2xl font-bold text-[#10242F]">Administrator Dashboard</h1>
                <p className="mt-1 text-xs text-slate-600">
                  Signed in as <strong>{roleLabels}</strong>. Only modules and branch records permitted by your role are unlocked.
                </p>
              </div>

              {overviewError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-[#AD220B] flex flex-wrap items-center justify-between gap-3">
                  <span>{overviewError}</span>
                  <button
                    type="button"
                    onClick={loadDashboardData}
                    className="rounded-lg bg-[#AD220B] px-3 py-1.5 font-semibold text-white hover:bg-[#8E1C09] cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {overviewLoading && !overview ? (
                <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                  Loading live metrics &amp; audit register...
                </div>
              ) : overview ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Active / Total Members</p>
                    <p className="mt-1 font-mono-tabular text-2xl font-bold text-[#10242F]">
                      {overview.metrics.activeMembers} / {overview.metrics.totalMembers}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Pending Applications</p>
                    <p className="mt-1 font-mono-tabular text-2xl font-bold text-[#BD5016]">
                      {overview.metrics.pendingApps}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Verified Income / Pending</p>
                    <p className="mt-1 font-mono-tabular text-2xl font-bold text-[#146B3A]">
                      {formatGHS(overview.metrics.verifiedIncomeGhs)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-amber-700 font-semibold">
                      {overview.metrics.pendingPayments} payment claims awaiting verification
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-5">
                    <p className="text-xs text-slate-500">Approved Expenditure (GHS)</p>
                    <p className="mt-1 font-mono-tabular text-2xl font-bold text-[#053559]">
                      {formatGHS(overview.metrics.totalExpenditureGhs)}
                    </p>
                  </div>
                </div>
              ) : null}

              {/* Direct Quick-Access Module Cards */}
              <div>
                <h2 className="font-display text-lg font-bold text-[#10242F]">Management Modules</h2>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {navItems
                    .filter((item) => item.visible && item.summary)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTab(item.id)}
                        className="group flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-[#BD5016] transition-colors cursor-pointer"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <item.icon className="h-4 w-4 text-[#053559]" />
                            <ChevronRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-[#BD5016]" />
                          </div>
                          <p className="mt-3 text-sm font-bold text-[#10242F]">{item.label}</p>
                          <p className="mt-1 text-xs text-slate-600 leading-relaxed">{item.summary}</p>
                        </div>
                      </button>
                    ))}
                </div>
              </div>

              {overview && (
                <div className="rounded-xl border border-slate-200 bg-white p-6">
                  <h2 className="font-display text-lg font-bold text-[#10242F]">Recent Society Audit Log</h2>
                  <div className="mt-4 divide-y divide-slate-100 text-xs">
                    {overview.recentAudit.map((log) => (
                      <div key={log.id} className="py-2.5 flex flex-wrap justify-between gap-2">
                        <div>
                          <span className="font-mono-tabular font-semibold text-[#053559]">{log.action}</span>
                          <span className="text-slate-500"> · {log.target_table} · by {log.actor_name || 'System'}</span>
                        </div>
                        <span className="font-mono-tabular text-slate-400">{formatDate(log.created_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'my_portal' && <MemberPortal onOpenVerify={onOpenVerify} />}

          {tab === 'membership' && (
            <AdminMembershipTab
              user={user}
              branches={branches}
              subdivisions={subdivisions}
              categories={categories}
              onOpenVerify={onOpenVerify}
            />
          )}

          {tab === 'branches_leadership' && <AdminBranchesLeadershipTab user={user} />}

          {tab === 'finance' && <AdminFinanceTab user={user} branches={branches} />}

          {tab === 'events' && <AdminEventsContentTab user={user} branches={branches} initialSubTab="events" />}

          {tab === 'content' && (
            <AdminEventsContentTab
              user={user}
              branches={branches}
              initialSubTab={user.permissions.publications?.view ? 'publications' : 'gallery'}
            />
          )}

          {tab === 'governance' && <AdminGovernanceReportsTab user={user} branches={branches} mode="governance" />}
          {tab === 'rbac' && <AdminGovernanceReportsTab user={user} branches={branches} mode="rbac" />}
          {tab === 'reports' && <AdminGovernanceReportsTab user={user} branches={branches} mode="reports" />}
        </main>
      </div>
    </div>
  );
};
