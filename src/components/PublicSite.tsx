import React, { useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  MapPin,
  Menu,
  X,
} from 'lucide-react';
import { OfficialLogo } from './OfficialLogo';
import { PasswordInput } from './PasswordInput';
import { PWAInstallButton } from './PWAControls';
import { apiFetch, formatDate, formatGHS } from '../lib/api';
import type {
  AuthUser,
  Branch,
  LeadershipAppointment,
  MediaItem,
  MembershipCategory,
  Publication,
  SocietyEvent,
  Subdivision,
} from '../types';

type PublicSection = 'home' | 'about' | 'events' | 'gallery' | 'apply' | 'contact';

interface PublicOverviewPayload {
  branches: Branch[];
  subdivisions: Subdivision[];
  categories: MembershipCategory[];
  leadership: LeadershipAppointment[];
  publications: Publication[];
  events: SocietyEvent[];
  gallery: MediaItem[];
  policies: Record<string, { label: string; value: Record<string, unknown>; confirmed: boolean }>;
  campaigns: {
    id: string;
    title: string;
    description: string;
    target_amount_ghs: number;
    raised_ghs: number;
  }[];
}

interface PublicSiteProps {
  user: AuthUser | null;
  onGoMemberLogin: () => void;
  onGoAdminLogin: () => void;
  onGoMemberPortal: () => void;
  onGoPortal: () => void;
  onHiddenAdminAccess?: () => void;
}

export const PublicSite: React.FC<PublicSiteProps> = ({
  user,
  onGoMemberLogin,
  onGoAdminLogin,
  onGoMemberPortal,
  onGoPortal,
  onHiddenAdminAccess,
}) => {
  const [section, setSection] = useState<PublicSection>('home');
  const [aboutTab, setAboutTab] = useState<'story' | 'leadership' | 'branches' | 'news'>('story');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [data, setData] = useState<PublicOverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const secretTapRef = React.useRef<{ count: number; lastAt: number }>({ count: 0, lastAt: 0 });

  const handleSecretTrigger = (e: React.MouseEvent) => {
    if (!onHiddenAdminAccess) return;
    if (e.altKey) {
      e.preventDefault();
      secretTapRef.current = { count: 0, lastAt: 0 };
      onHiddenAdminAccess();
      return;
    }
    const now = Date.now();
    const withinWindow = now - secretTapRef.current.lastAt < 1800;
    const nextCount = withinWindow ? secretTapRef.current.count + 1 : 1;
    if (nextCount >= 5) {
      secretTapRef.current = { count: 0, lastAt: 0 };
      onHiddenAdminAccess();
    } else {
      secretTapRef.current = { count: nextCount, lastAt: now };
    }
  };

  const [selectedArticle, setSelectedArticle] = useState<Publication | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<SocietyEvent | null>(null);
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [galleryAlbumFilter, setGalleryAlbumFilter] = useState<string>('All');
  const [newsFilter, setNewsFilter] = useState<string>('All');

  // Online Application Form State
  const [appForm, setAppForm] = useState({
    full_name: '',
    date_of_birth: '',
    gender: '',
    telephone: '',
    email: '',
    password: '',
    confirm_password: '',
    residential_address: '',
    preferred_branch_id: '',
    preferred_subdivision_id: '',
    requested_category_id: '',
    previous_experience: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    declaration_accepted: false,
    privacy_consent_accepted: false,
  });
  const [appSubmitting, setAppSubmitting] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [appResult, setAppResult] = useState<{ application_ref: string; has_password?: boolean } | null>(null);

  // Application Status Check State
  const [statusLookup, setStatusLookup] = useState({ application_ref: '', telephone: '' });
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusResult, setStatusResult] = useState<{
    application_ref: string;
    applicant_name: string;
    status: string;
    branch_name: string;
    subdivision_name: string;
    category_name: string;
    review_comments: string | null;
    membership_number: string | null;
    needs_activation: boolean;
  } | null>(null);

  // Contact Form State
  const [contactForm, setContactForm] = useState({ sender_name: '', sender_email: '', subject: '', message: '' });
  const [contactSuccess, setContactSuccess] = useState<string | null>(null);
  const [contactError, setContactError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<PublicOverviewPayload>('/api/public/overview')
      .then((res) => {
        setData(res);
        if (res.branches.length > 0 && res.categories.length > 0) {
          const defaultBranch = res.branches[0];
          const firstSub = res.subdivisions.find((s) => s.branch_id === defaultBranch.id);
          const seniorCat = res.categories.find((c) => c.code === 'SENIOR') || res.categories[0];
          setAppForm((prev) => ({
            ...prev,
            preferred_branch_id: defaultBranch.id,
            preferred_subdivision_id: firstSub?.id || '',
            requested_category_id: seniorCat.id,
          }));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const navigate = (target: PublicSection, subTab?: 'story' | 'leadership' | 'branches' | 'news') => {
    setSection(target);
    if (subTab) setAboutTab(subTab);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBranchChange = (branchId: string) => {
    const subs = data?.subdivisions.filter((s) => s.branch_id === branchId) || [];
    setAppForm((prev) => ({
      ...prev,
      preferred_branch_id: branchId,
      preferred_subdivision_id: subs[0]?.id || '',
    }));
  };

  const handleAppSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (appForm.password.length < 8) {
      setAppError('Please choose a portal password of at least 8 characters.');
      return;
    }
    if (appForm.password !== appForm.confirm_password) {
      setAppError('Portal password and confirm password do not match.');
      return;
    }
    setAppSubmitting(true);
    setAppError(null);
    try {
      const res = await apiFetch<{ application_ref: string; has_password?: boolean }>('/api/public/applications', {
        method: 'POST',
        body: JSON.stringify(appForm),
      });
      setAppResult(res);
    } catch (err) {
      setAppError((err as Error).message);
    } finally {
      setAppSubmitting(false);
    }
  };

  const handleStatusCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusLoading(true);
    setStatusError(null);
    setStatusResult(null);
    try {
      const res = await apiFetch<{
        application_ref: string;
        applicant_name: string;
        status: string;
        branch_name: string;
        subdivision_name: string;
        category_name: string;
        review_comments: string | null;
        membership_number: string | null;
        needs_activation: boolean;
      }>('/api/public/applications/status', {
        method: 'POST',
        body: JSON.stringify(statusLookup),
      });
      setStatusResult(res);
    } catch (err) {
      setStatusError((err as Error).message);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setContactError(null);
    setContactSuccess(null);
    try {
      const res = await apiFetch<{ message: string }>('/api/public/contact', {
        method: 'POST',
        body: JSON.stringify(contactForm),
      });
      setContactSuccess(res.message);
      setContactForm({ sender_name: '', sender_email: '', subject: '', message: '' });
    } catch (err) {
      setContactError((err as Error).message);
    }
  };

  const appFieldPolicy = (data?.policies?.application_fields?.value || {}) as Record<string, boolean>;
  const secretariatRaw = (data?.policies?.secretariat_settings?.value || {}) as Record<string, unknown>;
  const secretariatAddress =
    typeof secretariatRaw.secretariat_address === 'string' && secretariatRaw.secretariat_address.trim()
      ? secretariatRaw.secretariat_address
      : 'Community 1 Society Hall, Tema, Ghana (Placeholder — Update in Admin)';
  const secretariatEmail =
    typeof secretariatRaw.secretariat_email === 'string' && secretariatRaw.secretariat_email.trim()
      ? secretariatRaw.secretariat_email
      : 'secretariat@lasupadora.org';
  const secretariatPhone =
    typeof secretariatRaw.secretariat_phone === 'string' && secretariatRaw.secretariat_phone.trim()
      ? secretariatRaw.secretariat_phone
      : 'Not yet supplied — Update in Admin';
  const officeHours =
    typeof secretariatRaw.office_hours === 'string' && secretariatRaw.office_hours.trim()
      ? secretariatRaw.office_hours
      : 'Saturdays & Meeting Days (Editable by Admin)';
  const showDemoNotice =
    typeof secretariatRaw.show_demo_notice === 'boolean' ? secretariatRaw.show_demo_notice : true;
  const demoNoticeText =
    typeof secretariatRaw.demo_notice_text === 'string' && secretariatRaw.demo_notice_text.trim()
      ? secretariatRaw.demo_notice_text
      : 'Stage 1 Development Preview: Sample announcements, events, fundraising figures, leadership bios, and contact details are demonstration content in development pending official Secretariat confirmation.';

  const parseCommittee = (raw: string | undefined | null): string[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  };

  const filteredSubdivisions = data?.subdivisions.filter((s) => s.branch_id === appForm.preferred_branch_id) || [];
  const albums = ['All', ...Array.from(new Set((data?.gallery || []).map((g) => g.album_name)))];
  const visibleGallery =
    galleryAlbumFilter === 'All' ? data?.gallery || [] : (data?.gallery || []).filter((g) => g.album_name === galleryAlbumFilter);

  const visibleNews =
    newsFilter === 'All' ? data?.publications || [] : (data?.publications || []).filter((p) => p.category === newsFilter);

  return (
    <div className="min-h-screen flex flex-col overflow-x-hidden bg-[#F8F9FA] text-[#10242F]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-1.5 sm:gap-6 px-2.5 py-2.5 sm:px-6 sm:py-3 lg:px-8">
          {/* Zone 1: Single Brand Wordmark + Official Logo */}
          <button
            type="button"
            onClick={(e) => {
              navigate('home');
              handleSecretTrigger(e);
            }}
            className="flex items-center gap-1.5 sm:gap-3 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <OfficialLogo size="xs" />
            <span className="font-display text-[13px] sm:text-lg font-bold tracking-tight text-[#10242F]">LASUPADORA</span>
          </button>

          {/* Zone 2: 5 concise single-line text nav links */}
          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-600">
            {[
              { id: 'home', label: 'Home' },
              { id: 'about', label: 'Society' },
              { id: 'events', label: 'Events' },
              { id: 'gallery', label: 'Gallery' },
              { id: 'apply', label: 'Membership' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id as PublicSection)}
                className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer ${
                  section === item.id
                    ? 'border-b-2 border-[#BD5016] text-[#10242F] font-semibold'
                    : 'hover:text-[#10242F]'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Member Button & Admin Button (always both visible) */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {user ? (
              <>
                <button
                  type="button"
                  onClick={onGoMemberPortal}
                  className="rounded-lg bg-[#BD5016] px-2 sm:px-3.5 py-1.5 sm:py-2 text-[10.5px] sm:text-xs font-semibold text-white hover:bg-[#9D4010] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Member Portal
                </button>
                <button
                  type="button"
                  onClick={
                    Object.keys(user.permissions).some((m) => m !== 'self' && user.permissions[m]?.view)
                      ? onGoPortal
                      : onGoAdminLogin
                  }
                  className="rounded-lg bg-[#10242F] px-2 sm:px-3.5 py-1.5 sm:py-2 text-[10.5px] sm:text-xs font-semibold text-white hover:bg-[#053559] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {Object.keys(user.permissions).some((m) => m !== 'self' && user.permissions[m]?.view)
                    ? 'Admin Dashboard'
                    : 'Admin Login'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onGoMemberLogin}
                  className="rounded-lg bg-[#BD5016] px-2 sm:px-3.5 py-1.5 sm:py-2 text-[10.5px] sm:text-xs font-semibold text-white hover:bg-[#9D4010] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Member Login
                </button>
                <button
                  type="button"
                  onClick={onGoAdminLogin}
                  className="rounded-lg bg-[#10242F] px-2 sm:px-3.5 py-1.5 sm:py-2 text-[10.5px] sm:text-xs font-semibold text-white hover:bg-[#053559] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Admin Login
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle Menu"
              className="lg:hidden rounded-lg border border-slate-200 p-1.5 sm:p-2 text-[#10242F] cursor-pointer"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="border-t border-slate-200 bg-white px-4 py-4 lg:hidden space-y-2">
            {[
              { id: 'home', label: 'Home' },
              { id: 'about', label: 'About, Leadership & Branches' },
              { id: 'events', label: 'Events' },
              { id: 'gallery', label: 'Gallery' },
              { id: 'apply', label: 'Apply for Membership' },
              { id: 'contact', label: 'Contact Secretariat' },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id as PublicSection)}
                className="block w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[#10242F] hover:bg-slate-50"
              >
                {item.label}
              </button>
            ))}
            <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  if (user) onGoMemberPortal();
                  else onGoMemberLogin();
                }}
                className="w-full rounded-lg bg-[#BD5016] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#9D4010] cursor-pointer"
              >
                {user ? 'Member Portal' : 'Member Login'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  if (user && Object.keys(user.permissions).some((m) => m !== 'self' && user.permissions[m]?.view)) {
                    onGoPortal();
                  } else {
                    onGoAdminLogin();
                  }
                }}
                className="w-full rounded-lg bg-[#10242F] px-3 py-2.5 text-xs font-semibold text-white hover:bg-[#053559] cursor-pointer"
              >
                {user && Object.keys(user.permissions).some((m) => m !== 'self' && user.permissions[m]?.view)
                  ? 'Admin Dashboard'
                  : 'Admin Login'}
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        {loading ? (
          <div className="mx-auto max-w-7xl px-6 py-20 text-center text-sm text-slate-500">
            Loading LASUPADORA Masqueraders Society portal...
          </div>
        ) : (
          <>
            {showDemoNotice && (
              <div className="border-b border-amber-200 bg-amber-50/90 px-4 py-2.5 text-xs text-[#10242F]">
                <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 sm:px-2 lg:px-4">
                  <p className="leading-relaxed">
                    <strong className="font-semibold text-[#AD220B]">Demonstration Content in Development:</strong>{' '}
                    {demoNoticeText}
                  </p>
                </div>
              </div>
            )}
            {/* ==================== HOME SECTION ==================== */}
            {section === 'home' && (
              <div>
                {/* Hero Split */}
                <section className="border-b border-slate-200 bg-white">
                  <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
                    <div className="grid gap-10 lg:grid-cols-12 lg:items-stretch">
                      <div className="lg:col-span-6 flex flex-col justify-between space-y-6">
                        <div className="space-y-5">
                          <div className="flex items-center gap-4">
                            <OfficialLogo size="md" />
                            <div>
                              <p className="text-xs font-semibold tracking-wide text-[#AD220B]">
                                LASUPADORA MASQUERADERS SOCIETY
                              </p>
                              <p className="text-sm font-medium text-slate-600">
                                Wear the Culture. Live the Tradition.
                              </p>
                            </div>
                          </div>

                          <h1
                            className="font-display font-bold tracking-tight text-[#10242F]"
                            style={{ fontSize: 'clamp(2.25rem, 4vw, 3.5rem)', lineHeight: 1.08 }}
                          >
                            Preserving Masquerade Heritage Through Collective Governance
                          </h1>

                          <p className="max-w-xl text-base text-slate-600 leading-relaxed">
                            Founded on equal membership, transparent stewardship, and coastal Ghanaian cultural pride across Tema Communities 1–25 and Outside Tema branches.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 pt-2">
                          <button
                            type="button"
                            onClick={() => navigate('apply')}
                            className="rounded-lg bg-[#BD5016] px-6 py-3 text-sm font-semibold text-white hover:bg-[#9D4010] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Apply for Membership
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate('about', 'story')}
                            className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-[#10242F] hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            Explore Society Charter
                          </button>
                          <PWAInstallButton />
                        </div>
                      </div>

                      <div className="lg:col-span-6">
                        <div className="h-full min-h-[320px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                          <img
                            src="/media/hero_masquerade_procession.jpg"
                            alt="LASUPADORA Masqueraders golden hour procession in Tema"
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Full-width 4-column Institutional Summary Strip */}
                    <div className="mt-12 grid grid-cols-2 gap-6 border-t border-slate-200 pt-8 md:grid-cols-4">
                      <div>
                        <p className="font-mono-tabular text-2xl font-bold text-[#10242F]">
                          {data?.branches.length || 2} Branches
                        </p>
                        <p className="mt-1 text-xs text-slate-600">Tema &amp; Outside Tema</p>
                      </div>
                      <div>
                        <p className="font-mono-tabular text-2xl font-bold text-[#053559]">
                          {data?.subdivisions.length || 30} Subdivisions
                        </p>
                        <p className="mt-1 text-xs text-slate-600">Tema Communities 1–25 &amp; Regional Towns</p>
                      </div>
                      <div>
                        <p className="font-mono-tabular text-2xl font-bold text-[#AD220B]">
                          {data?.events.filter((e) => e.status === 'Upcoming').length || 0} Upcoming
                        </p>
                        <p className="mt-1 text-xs text-slate-600">Parades &amp; Cultural Workshops</p>
                      </div>
                      <div>
                        <p className="font-mono-tabular text-2xl font-bold text-[#146B3A]">GHS Standard</p>
                        <p className="mt-1 text-xs text-slate-600">Audited Budgets &amp; 7-Day Receipts</p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Featured Announcements & News */}
                <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
                  <div className="flex items-end justify-between border-b border-slate-200 pb-4">
                    <div>
                      <h2 className="font-display text-2xl font-bold text-[#10242F]">
                        Society Announcements &amp; News
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        {showDemoNotice
                          ? 'Sample publications and notices in development (editable via Admin Dashboard).'
                          : 'Approved publications released by the Secretariat.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('about', 'news')}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#BD5016] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      All Publications <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="mt-8 grid gap-8 md:grid-cols-3">
                    {(data?.publications || []).slice(0, 3).map((pub) => (
                      <article
                        key={pub.id}
                        onClick={() => setSelectedArticle(pub)}
                        className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-[#053559] cursor-pointer"
                      >
                        <div className="aspect-[4/3] overflow-hidden bg-slate-100">
                          <img
                            src={pub.cover_image_url || '/media/hero_masquerade_procession.jpg'}
                            alt={pub.title}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                          />
                        </div>
                        <div className="flex flex-1 flex-col p-5">
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span className="font-semibold text-[#AD220B]">{pub.category}</span>
                            <span aria-hidden="true">·</span>
                            <span>{formatDate(pub.published_at)}</span>
                          </div>
                          <h3 className="mt-2 font-display text-lg font-bold text-[#10242F] group-hover:text-[#053559]">
                            {pub.title}
                          </h3>
                          <p className="mt-2 flex-1 text-sm text-slate-600 line-clamp-3">{pub.excerpt}</p>
                          <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#053559]">
                            Read Publication <ChevronRight className="h-3.5 w-3.5" />
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                {/* Upcoming Events & Fundraising Spotlight */}
                <section className="border-y border-slate-200 bg-white">
                  <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
                    <div className="grid gap-10 lg:grid-cols-12">
                      <div className="lg:col-span-7">
                        <div className="flex items-end justify-between border-b border-slate-200 pb-4">
                          <h2 className="font-display text-2xl font-bold text-[#10242F]">Upcoming Events</h2>
                          <button
                            type="button"
                            onClick={() => navigate('events')}
                            className="text-xs font-semibold text-[#BD5016] hover:underline cursor-pointer"
                          >
                            Full Calendar
                          </button>
                        </div>
                        <div className="mt-6 divide-y divide-slate-200">
                          {(data?.events || [])
                            .filter((e) => e.status === 'Upcoming')
                            .slice(0, 3)
                            .map((evt) => (
                              <div key={evt.id} className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
                                <img
                                  src={evt.poster_url || '/media/event_tema_carnival.jpg'}
                                  alt={evt.title}
                                  referrerPolicy="no-referrer"
                                  className="h-24 w-32 rounded-lg border border-slate-200 object-cover shrink-0"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <span className="font-semibold text-[#053559]">
                                      {evt.branch_name || 'All Branches'}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono-tabular">{formatDate(evt.event_date)}</span>
                                  </div>
                                  <h3 className="mt-1 text-base font-bold text-[#10242F]">{evt.title}</h3>
                                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                                    <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                    <span>{evt.venue}</span>
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSelectedEvent(evt)}
                                  className="rounded-lg border border-slate-300 px-3.5 py-2 text-xs font-semibold text-[#10242F] hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-center"
                                >
                                  Details
                                </button>
                              </div>
                            ))}
                        </div>
                      </div>

                      {/* Cultural Heritage Campaign + Gallery Preview */}
                      <div className="lg:col-span-5 space-y-6">
                        {(data?.campaigns || []).slice(0, 1).map((camp) => {
                          const pct = Math.min(100, Math.round((camp.raised_ghs / camp.target_amount_ghs) * 100));
                          return (
                            <div key={camp.id} className="rounded-xl border border-slate-200 bg-[#F8F9FA] p-6">
                              <p className="text-xs font-semibold text-[#AD220B]">
                                {showDemoNotice
                                  ? 'Society Fundraising (Demonstration Figure)'
                                  : 'Active Society Fundraising'}
                              </p>
                              <h3 className="mt-1.5 font-display text-xl font-bold text-[#10242F]">{camp.title}</h3>
                              <p className="mt-2 text-xs text-slate-600 leading-relaxed">{camp.description}</p>
                              <div className="mt-4">
                                <div className="flex justify-between text-xs font-semibold">
                                  <span className="font-mono-tabular text-[#146B3A]">
                                    {formatGHS(camp.raised_ghs)} raised
                                  </span>
                                  <span className="font-mono-tabular text-slate-500">
                                    Target {formatGHS(camp.target_amount_ghs)}
                                  </span>
                                </div>
                                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                                  <div
                                    className="h-full bg-[#BD5016] transition-all"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        <div className="rounded-xl border border-slate-200 bg-white p-6">
                          <div className="flex items-center justify-between">
                            <h3 className="font-display text-lg font-bold text-[#10242F]">Media Archive Preview</h3>
                            <button
                              type="button"
                              onClick={() => navigate('gallery')}
                              className="text-xs font-semibold text-[#BD5016] hover:underline cursor-pointer"
                            >
                              Open Gallery
                            </button>
                          </div>
                          <div className="mt-4 grid grid-cols-2 gap-3">
                            {(data?.gallery || []).slice(0, 4).map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => setLightboxItem(item)}
                                className="aspect-[4/3] overflow-hidden rounded-lg border border-slate-200 bg-slate-100 cursor-pointer"
                              >
                                <img
                                  src={item.file_url}
                                  alt={item.title}
                                  referrerPolicy="no-referrer"
                                  className="h-full w-full object-cover hover:scale-105 transition-transform"
                                />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* ==================== SOCIETY / ABOUT / LEADERSHIP / BRANCHES / NEWS ==================== */}
            {section === 'about' && (
              <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
                  <div>
                    <h1 className="font-display text-3xl font-bold text-[#10242F]">
                      LASUPADORA Masqueraders Society
                    </h1>
                    <p className="mt-1 text-sm text-slate-600">
                      Charter, Constitutional Principles, Executive Leadership, Branches, and Publications.
                    </p>
                  </div>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-1 rounded-lg bg-slate-200/70 p-1 max-w-full">
                    {[
                      { id: 'story', label: 'Charter & Values' },
                      { id: 'leadership', label: 'Leadership' },
                      { id: 'branches', label: 'Branches' },
                      { id: 'news', label: 'News & Notices' },
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setAboutTab(t.id as typeof aboutTab)}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          aboutTab === t.id ? 'bg-white text-[#10242F] shadow-sm' : 'text-slate-600 hover:text-[#10242F]'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {aboutTab === 'story' && (
                  <div className="mt-8 grid gap-10 lg:grid-cols-12">
                    <div className="lg:col-span-7 space-y-6">
                      <div className="rounded-xl border border-slate-200 bg-white p-7 space-y-4">
                        <h2 className="font-display text-2xl font-bold text-[#10242F]">Vision, Mission &amp; Heritage</h2>
                        <p className="text-sm text-slate-700 leading-relaxed">
                          <strong>Vision:</strong> To be Ghana&apos;s premier community-owned masquerading cultural society—uniting neighbourhoods through artistry, brass music, youth mentorship, and disciplined civic fellowship.
                        </p>
                        <p className="text-sm text-slate-700 leading-relaxed">
                          <strong>Mission:</strong> Wear the Culture. Live the Tradition. We preserve authentic coastal masquerade craft, nurture disciplined brass and dance ensembles, and govern all resources under transparent constitutional accountability.
                        </p>
                        <div className="border-t border-slate-100 pt-4">
                          <h3 className="text-sm font-bold text-[#053559]">Organisational Hierarchy</h3>
                          <p className="mt-1 font-mono-tabular text-xs text-slate-700">
                            LASUPADORA Society → Branch (Tema / Outside Tema) → Subdivision (Communities 1–25 / Regional Towns) → Member
                          </p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-white p-7">
                        <h2 className="font-display text-2xl font-bold text-[#10242F]">
                          Fundamental Constitutional Principles
                        </h2>
                        <ul className="mt-4 space-y-3 text-sm text-slate-700">
                          <li>01. <strong>Collective Ownership:</strong> No individual, founder, or officer owns LASUPADORA. Leadership positions confer service duties, never personal ownership.</li>
                          <li>02. <strong>Equal Standing:</strong> Foundation members and new entrants hold equal rights and opportunities under the Society&apos;s approved rules.</li>
                          <li>03. <strong>Rule of Law:</strong> No officeholder or technical administrator is above the Society&apos;s Constitution or approved resolutions.</li>
                          <li>04. <strong>Open Expression:</strong> Every member has the protected right to express opinions, propose motions, and offer constructive criticism.</li>
                          <li>05. <strong>Financial Stewardship:</strong> No budget, no approval. No verified accounts, no next funding.</li>
                        </ul>
                      </div>
                    </div>

                    <div className="lg:col-span-5 space-y-6">
                      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
                        <div className="mx-auto flex justify-center py-2">
                          <OfficialLogo size="xl" />
                        </div>
                        <p className="mt-3 text-xs font-semibold text-[#AD220B]">Official Society Emblem</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Maintained unmodified across all official credentials, publications, and governance records.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {aboutTab === 'leadership' && (
                  <div className="mt-8 space-y-6">
                    {showDemoNotice && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 text-xs text-slate-700">
                        <strong>Development Note:</strong> Executive officer biographies and portrait placeholders below are demonstration entries editable by authorised administrators via the Admin Dashboard.
                      </div>
                    )}
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {(data?.leadership || []).map((lead) => {
                      const initials = lead.full_name
                        .split(' ')
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase();
                      return (
                        <div key={lead.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white flex flex-col">
                          {/* Portrait Slot / Placeholder */}
                          <div className="aspect-[4/3] w-full bg-[#F8F9FA] border-b border-slate-200 relative overflow-hidden">
                            {lead.photo_url ? (
                              <img
                                src={lead.photo_url}
                                alt={`${lead.full_name} — ${lead.portfolio}`}
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-cover object-top"
                              />
                            ) : (
                              <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#10242F]/5 via-[#053559]/5 to-[#BD5016]/10 p-6 text-center">
                                <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-[#053559]/20 bg-white font-display text-2xl font-bold text-[#053559]">
                                  {initials}
                                </div>
                                <p className="mt-3 text-xs font-semibold text-[#10242F]">{lead.portfolio}</p>
                                <p className="mt-0.5 text-[11px] text-slate-500">Official Portrait Placeholder</p>
                              </div>
                            )}
                          </div>

                          <div className="flex flex-1 flex-col p-6">
                            <div className="text-xs text-slate-500">
                              <span className="font-semibold text-[#AD220B]">{lead.portfolio}</span>
                              {lead.branch_name && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  <span>{lead.branch_name}</span>
                                </>
                              )}
                            </div>
                            <h3 className="mt-2 font-display text-xl font-bold text-[#10242F]">{lead.full_name}</h3>
                            <p className="mt-2 flex-1 text-sm text-slate-600 leading-relaxed">{lead.biography}</p>
                            <div className="mt-4 border-t border-slate-100 pt-3 flex items-center justify-between text-xs text-slate-500 font-mono-tabular">
                              <span>Term: {formatDate(lead.term_start)} – {formatDate(lead.term_expiry)}</span>
                              {lead.can_act_for_president === 1 && (
                                <span className="font-sans font-semibold text-[#053559]">Acting Authority</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    </div>
                  </div>
                )}

                {aboutTab === 'branches' && (
                  <div className="mt-8 space-y-8">
                    {(data?.branches || []).map((branch) => {
                      const subs = (data?.subdivisions || []).filter((s) => s.branch_id === branch.id);
                      return (
                        <div key={branch.id} className="rounded-xl border border-slate-200 bg-white p-6">
                          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-4">
                            <div>
                              <h2 className="font-display text-2xl font-bold text-[#10242F]">{branch.name}</h2>
                              <p className="mt-1 text-sm text-slate-600">{branch.description}</p>
                            </div>
                            <span className="font-mono-tabular text-xs font-semibold text-[#053559]">
                              Code: {branch.code} · {subs.length} Subdivisions
                            </span>
                          </div>
                          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5">
                            {subs.map((s) => (
                              <div key={s.id} className="rounded-lg border border-slate-200 bg-[#F8F9FA] px-3 py-2 text-xs">
                                <p className="font-semibold text-[#10242F] truncate">{s.name}</p>
                                <p className="text-[11px] text-slate-500 truncate">{s.region}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {aboutTab === 'news' && (
                  <div className="mt-8 space-y-6">
                    <div className="flex flex-wrap gap-2">
                      {['All', 'Announcement', 'News', 'Featured Story', 'Cultural Note', 'Archive'].map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setNewsFilter(cat)}
                          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                            newsFilter === cat
                              ? 'bg-[#10242F] text-white'
                              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                    <div className="grid gap-6 md:grid-cols-2">
                      {visibleNews.map((pub) => (
                        <article
                          key={pub.id}
                          onClick={() => setSelectedArticle(pub)}
                          className="overflow-hidden rounded-xl border border-slate-200 bg-white hover:border-[#053559] cursor-pointer flex flex-col"
                        >
                          <div className="aspect-[16/9] bg-slate-100">
                            <img
                              src={pub.cover_image_url || '/media/hero_masquerade_procession.jpg'}
                              alt={pub.title}
                              referrerPolicy="no-referrer"
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="p-6 flex-1">
                            <div className="text-xs text-slate-500">
                              <span className="font-semibold text-[#AD220B]">{pub.category}</span>
                              <span aria-hidden="true"> · </span>
                              <span>{formatDate(pub.published_at)}</span>
                              {pub.author_name && (
                                <>
                                  <span aria-hidden="true"> · </span>
                                  <span>{pub.author_name}</span>
                                </>
                              )}
                            </div>
                            <h3 className="mt-2 font-display text-xl font-bold text-[#10242F]">{pub.title}</h3>
                            <p className="mt-2 text-sm text-slate-600 leading-relaxed">{pub.excerpt}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ==================== EVENTS SECTION ==================== */}
            {section === 'events' && (
              <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
                <div className="border-b border-slate-200 pb-6">
                  <h1 className="font-display text-3xl font-bold text-[#10242F]">Society Events &amp; Cultural Calendar</h1>
                  <p className="mt-1 text-sm text-slate-600">
                    Upcoming parades, workshops, and completed community gatherings.
                  </p>
                </div>

                <div className="mt-8 grid gap-8 md:grid-cols-2">
                  {(data?.events || []).map((evt) => (
                    <div key={evt.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white flex flex-col">
                      <div className="aspect-[16/9] bg-slate-100">
                        <img
                          src={evt.poster_url || '/media/event_tema_carnival.jpg'}
                          alt={evt.title}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="flex flex-1 flex-col p-6">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-[#AD220B]">{evt.status}</span>
                          <span aria-hidden="true">·</span>
                          <span>{evt.branch_name || 'National Society'}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-tabular">{formatDate(evt.event_date)}</span>
                        </div>
                        <h2 className="mt-2 font-display text-xl font-bold text-[#10242F]">{evt.title}</h2>
                        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                          <MapPin className="h-3.5 w-3.5 text-slate-400" />
                          {evt.venue}
                        </p>
                        <p className="mt-3 flex-1 text-sm text-slate-600 leading-relaxed">{evt.description}</p>
                        {evt.post_event_report && (
                          <div className="mt-4 rounded-lg border border-slate-200 bg-[#F8F9FA] p-3 text-xs text-slate-700">
                            <strong>Highlights:</strong> {evt.post_event_report}
                          </div>
                        )}
                        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-xs">
                          <span className="font-mono-tabular text-slate-500">
                            {evt.registered_count || 0} members registered
                          </span>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedEvent(evt)}
                              className="rounded-lg border border-slate-300 px-3.5 py-2 font-semibold text-[#10242F] hover:bg-slate-50 cursor-pointer"
                            >
                              View Details
                            </button>
                            {evt.status === 'Upcoming' && evt.registration_open === 1 && (
                              <button
                                type="button"
                                onClick={() => (user ? onGoMemberPortal() : onGoMemberLogin())}
                                className="rounded-lg bg-[#BD5016] px-4 py-2 font-semibold text-white hover:bg-[#9D4010] cursor-pointer"
                              >
                                {user ? 'Register in Portal' : 'Member Sign In to Register'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ==================== GALLERY SECTION ==================== */}
            {section === 'gallery' && (
              <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
                <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
                  <div>
                    <h1 className="font-display text-3xl font-bold text-[#10242F]">Public Cultural Gallery</h1>
                    <p className="mt-1 text-sm text-slate-600">
                      Approved public photographs and event archives. Private administrative files remain protected.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {albums.map((alb) => (
                      <button
                        key={alb}
                        type="button"
                        onClick={() => setGalleryAlbumFilter(alb)}
                        className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold cursor-pointer ${
                          galleryAlbumFilter === alb
                            ? 'bg-[#10242F] text-white'
                            : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {alb}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleGallery.map((item) => (
                    <figure
                      key={item.id}
                      onClick={() => setLightboxItem(item)}
                      className="group overflow-hidden rounded-xl border border-slate-200 bg-white cursor-pointer"
                    >
                      <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                        <img
                          src={item.file_url}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      </div>
                      <figcaption className="p-4">
                        <p className="text-xs text-slate-500">
                          {item.album_name} · {item.media_type}
                        </p>
                        <p className="mt-1 text-sm font-bold text-[#10242F]">{item.title}</p>
                        {item.caption && <p className="mt-1 text-xs text-slate-600">{item.caption}</p>}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            {/* ==================== MEMBERSHIP APPLICATION PORTAL ==================== */}
            {section === 'apply' && (
              <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
                <div className="grid gap-10 lg:grid-cols-12">
                  <div className="lg:col-span-8">
                    <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-8">
                      <h1 className="font-display text-3xl font-bold text-[#10242F]">
                        Online Membership Application
                      </h1>
                      <p className="mt-2 text-sm text-slate-600">
                        Submit your application for review by your selected Branch and Subdivision officers. Submitting an application does not automatically grant membership until formally approved.
                      </p>

                      {appResult ? (
                        <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-6">
                          <div className="flex items-center gap-2 text-[#146B3A] font-bold">
                            <CheckCircle2 className="h-5 w-5" />
                            <span>Application Submitted for Review</span>
                          </div>
                          <p className="mt-2 text-sm text-slate-700">
                            Your unique application reference is{' '}
                            <strong className="font-mono-tabular text-[#10242F]">{appResult.application_ref}</strong>.
                            Status: <strong>Pending Review</strong>.
                          </p>
                          <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                            Save your reference number and use the <strong>Check Application Status</strong> box on the right to see when your branch approves your application and view your newly issued <strong>LSMS Membership ID</strong>. Once approved, sign in via <strong>Member Login</strong> using your Email or Membership ID and the password you created.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setAppResult(null);
                              setAppForm((prev) => ({
                                ...prev,
                                full_name: '',
                                telephone: '',
                                email: '',
                                password: '',
                                confirm_password: '',
                                residential_address: '',
                                declaration_accepted: false,
                                privacy_consent_accepted: false,
                              }));
                            }}
                            className="mt-4 rounded-lg bg-[#10242F] px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                          >
                            Submit Another Application
                          </button>
                        </div>
                      ) : (
                        <form onSubmit={handleAppSubmit} className="mt-8 space-y-5">
                          {appError && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-[#AD220B]">
                              {appError}
                            </div>
                          )}

                          <div className="grid gap-5 sm:grid-cols-2">
                            <div>
                              <label className="block text-xs font-semibold text-[#10242F]">Full Name *</label>
                              <input
                                type="text"
                                required
                                value={appForm.full_name}
                                onChange={(e) => setAppForm({ ...appForm, full_name: e.target.value })}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-[#053559] focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#10242F]">
                                Date of Birth {appFieldPolicy.require_dob ? '*' : '(Optional)'}
                              </label>
                              <input
                                type="date"
                                required={Boolean(appFieldPolicy.require_dob)}
                                value={appForm.date_of_birth}
                                onChange={(e) => setAppForm({ ...appForm, date_of_birth: e.target.value })}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-[#053559] focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#10242F]">Telephone Number *</label>
                              <input
                                type="tel"
                                required
                                placeholder="+233 24 000 0000"
                                value={appForm.telephone}
                                onChange={(e) => setAppForm({ ...appForm, telephone: e.target.value })}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-[#053559] focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#10242F]">Email Address</label>
                              <input
                                type="email"
                                value={appForm.email}
                                onChange={(e) => setAppForm({ ...appForm, email: e.target.value })}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-[#053559] focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#10242F]">Preferred Branch *</label>
                              <select
                                required
                                value={appForm.preferred_branch_id}
                                onChange={(e) => handleBranchChange(e.target.value)}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#053559] focus:outline-none"
                              >
                                {(data?.branches || []).map((b) => (
                                  <option key={b.id} value={b.id}>
                                    {b.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#10242F]">Subdivision / Community *</label>
                              <select
                                required
                                value={appForm.preferred_subdivision_id}
                                onChange={(e) => setAppForm({ ...appForm, preferred_subdivision_id: e.target.value })}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#053559] focus:outline-none"
                              >
                                {filteredSubdivisions.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.name} ({s.region})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#10242F]">Membership Category *</label>
                              <select
                                required
                                value={appForm.requested_category_id}
                                onChange={(e) => setAppForm({ ...appForm, requested_category_id: e.target.value })}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#053559] focus:outline-none"
                              >
                                {(data?.categories || []).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name} (Annual Dues: {formatGHS(c.annual_dues_ghs)})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#10242F]">
                                Gender {appFieldPolicy.require_gender ? '*' : '(Optional)'}
                              </label>
                              <select
                                required={Boolean(appFieldPolicy.require_gender)}
                                value={appForm.gender}
                                onChange={(e) => setAppForm({ ...appForm, gender: e.target.value })}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-[#053559] focus:outline-none"
                              >
                                <option value="">Prefer not to say / Select</option>
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-[#10242F]">
                              Residential Address {appFieldPolicy.require_address ? '*' : '(Optional)'}
                            </label>
                            <input
                              type="text"
                              required={Boolean(appFieldPolicy.require_address)}
                              value={appForm.residential_address}
                              onChange={(e) => setAppForm({ ...appForm, residential_address: e.target.value })}
                              placeholder="House / Street / Community Landmark"
                              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-[#053559] focus:outline-none"
                            />
                          </div>

                          <div className="grid gap-5 sm:grid-cols-2">
                            <div>
                              <label className="block text-xs font-semibold text-[#10242F]">
                                Emergency Contact Name {appFieldPolicy.require_emergency_contact ? '*' : ''}
                              </label>
                              <input
                                type="text"
                                required={Boolean(appFieldPolicy.require_emergency_contact)}
                                value={appForm.emergency_contact_name}
                                onChange={(e) => setAppForm({ ...appForm, emergency_contact_name: e.target.value })}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-[#053559] focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-semibold text-[#10242F]">
                                Emergency Contact Telephone {appFieldPolicy.require_emergency_contact ? '*' : ''}
                              </label>
                              <input
                                type="tel"
                                required={Boolean(appFieldPolicy.require_emergency_contact)}
                                value={appForm.emergency_contact_phone}
                                onChange={(e) => setAppForm({ ...appForm, emergency_contact_phone: e.target.value })}
                                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-[#053559] focus:outline-none"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-[#10242F]">
                              Previous Masquerade / Brass / Cultural Experience
                            </label>
                            <textarea
                              rows={2}
                              value={appForm.previous_experience}
                              onChange={(e) => setAppForm({ ...appForm, previous_experience: e.target.value })}
                              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#053559] focus:outline-none"
                            />
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-[#F8F9FA] p-4 space-y-3">
                            <div>
                              <h3 className="text-xs font-bold text-[#053559] uppercase tracking-wider">
                                Member Portal Account Password
                              </h3>
                              <p className="mt-0.5 text-[11px] text-slate-600">
                                Create the password you will use to sign in once your application is approved by your Branch Officers.
                              </p>
                            </div>
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <label className="block text-xs font-semibold text-[#10242F]">Portal Password * (min. 8 characters)</label>
                                <PasswordInput
                                  required
                                  minLength={8}
                                  value={appForm.password}
                                  onChange={(e) => setAppForm({ ...appForm, password: e.target.value })}
                                  placeholder="Choose a strong password"
                                  containerClassName="mt-1"
                                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#053559] focus:outline-none"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-semibold text-[#10242F]">Confirm Portal Password *</label>
                                <PasswordInput
                                  required
                                  minLength={8}
                                  value={appForm.confirm_password}
                                  onChange={(e) => setAppForm({ ...appForm, confirm_password: e.target.value })}
                                  placeholder="Re-enter your password"
                                  containerClassName="mt-1"
                                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#053559] focus:outline-none"
                                />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2.5 border-t border-slate-100 pt-4 text-xs text-slate-700">
                            <label className="flex items-start gap-2.5 cursor-pointer">
                              <input
                                type="checkbox"
                                required
                                checked={appForm.declaration_accepted}
                                onChange={(e) => setAppForm({ ...appForm, declaration_accepted: e.target.checked })}
                                className="mt-0.5 rounded border-slate-300"
                              />
                              <span>
                                <strong>Application Declaration:</strong> I affirm that I will abide by the Constitution, collective values, and disciplinary rules of LASUPADORA Masqueraders Society.
                              </span>
                            </label>
                            <label className="flex items-start gap-2.5 cursor-pointer">
                              <input
                                type="checkbox"
                                required
                                checked={appForm.privacy_consent_accepted}
                                onChange={(e) => setAppForm({ ...appForm, privacy_consent_accepted: e.target.checked })}
                                className="mt-0.5 rounded border-slate-300"
                              />
                              <span>
                                <strong>Privacy Consent:</strong> I consent to the Society securely processing my application record solely for membership administration and QR credential verification.
                              </span>
                            </label>
                          </div>

                          <button
                            type="submit"
                            disabled={appSubmitting}
                            className="rounded-lg bg-[#BD5016] px-6 py-3 text-sm font-semibold text-white hover:bg-[#9D4010] disabled:opacity-50 cursor-pointer"
                          >
                            {appSubmitting ? 'Submitting Application...' : 'Submit Membership Application'}
                          </button>
                        </form>
                      )}
                    </div>
                  </div>

                  {/* Membership Status Check, Categories & FAQs */}
                  <div className="lg:col-span-4 space-y-6">
                    <div className="rounded-xl border border-[#053559]/20 bg-white p-6">
                      <h2 className="font-display text-xl font-bold text-[#10242F]">Check Application Status</h2>
                      <p className="mt-1 text-xs text-slate-600">
                        Already applied? Check approval status and retrieve your issued <strong>LSMS Membership ID</strong>.
                      </p>
                      <form onSubmit={handleStatusCheck} className="mt-4 space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-[#10242F]">Application Reference *</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. APP-2026-1234"
                            value={statusLookup.application_ref}
                            onChange={(e) => setStatusLookup({ ...statusLookup, application_ref: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular focus:border-[#053559] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#10242F]">Telephone Number *</label>
                          <input
                            type="tel"
                            required
                            placeholder="+233 24 000 0000"
                            value={statusLookup.telephone}
                            onChange={(e) => setStatusLookup({ ...statusLookup, telephone: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-[#053559] focus:outline-none"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={statusLoading}
                          className="w-full rounded-lg bg-[#053559] px-4 py-2 text-xs font-semibold text-white hover:bg-[#10242F] disabled:opacity-50 cursor-pointer"
                        >
                          {statusLoading ? 'Checking...' : 'Check Status'}
                        </button>
                      </form>

                      {statusError && (
                        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-[#AD220B]">
                          {statusError}
                        </div>
                      )}

                      {statusResult && (
                        <div className="mt-4 rounded-lg border border-slate-200 bg-[#F8F9FA] p-3.5 text-xs space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[#10242F]">{statusResult.applicant_name}</span>
                            <span
                              className={`font-bold ${
                                statusResult.status === 'Approved'
                                  ? 'text-[#146B3A]'
                                  : statusResult.status === 'Rejected'
                                    ? 'text-[#AD220B]'
                                    : 'text-[#BD5016]'
                              }`}
                            >
                              {statusResult.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600">
                            {statusResult.branch_name} ({statusResult.subdivision_name}) · {statusResult.category_name}
                          </p>
                          {statusResult.review_comments && (
                            <p className="text-[11px] text-slate-600">
                              <strong>Note:</strong> {statusResult.review_comments}
                            </p>
                          )}
                          {statusResult.status === 'Approved' && statusResult.membership_number && (
                            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2.5 space-y-2">
                              <p className="text-[11px] text-[#146B3A]">
                                Issued Membership ID:{' '}
                                <strong className="font-mono-tabular text-[#10242F]">{statusResult.membership_number}</strong>
                              </p>
                              <p className="text-[11px] text-slate-600">
                                {statusResult.needs_activation
                                  ? 'Use "Activate Account / Set Password" on the Member Login page with the activation code from your officer.'
                                  : 'You can now sign in via Member Login using this ID or your email and your password.'}
                              </p>
                              <button
                                type="button"
                                onClick={onGoMemberLogin}
                                className="w-full rounded-md bg-[#146B3A] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0f542d] cursor-pointer"
                              >
                                Go to Member Login
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-6">
                      <h2 className="font-display text-xl font-bold text-[#10242F]">Membership Categories</h2>
                      <div className="mt-4 divide-y divide-slate-100">
                        {(data?.categories || []).map((c) => (
                          <div key={c.id} className="py-3">
                            <div className="flex justify-between text-sm font-bold text-[#10242F]">
                              <span>{c.name}</span>
                              <span className="font-mono-tabular text-[#AD220B]">{formatGHS(c.annual_dues_ghs)}/yr</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-600">{c.eligibility_notes}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-6">
                      <h2 className="font-display text-xl font-bold text-[#10242F]">Frequently Asked Questions</h2>
                      <dl className="mt-4 space-y-4 text-xs">
                        <div>
                          <dt className="font-bold text-[#10242F]">How long does application approval take?</dt>
                          <dd className="mt-1 text-slate-600">
                            Branch officers review applications within 7–14 days. Once approved, a permanent membership number and QR ID card are generated.
                          </dd>
                        </div>
                        <div>
                          <dt className="font-bold text-[#10242F]">Can members without internet access register?</dt>
                          <dd className="mt-1 text-slate-600">
                            Yes. Authorised Subdivision and Branch Officers can submit officer-assisted registrations using the exact same approval workflow.
                          </dd>
                        </div>
                        <div>
                          <dt className="font-bold text-[#10242F]">Can I transfer between Tema and Outside Tema?</dt>
                          <dd className="mt-1 text-slate-600">
                            Yes. Authorised administrators process branch and subdivision transfers with a permanent transfer history.
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ==================== CONTACT SECTION ==================== */}
            {section === 'contact' && (
              <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
                <div className="rounded-xl border border-slate-200 bg-white p-5 sm:p-8">
                  <h1 className="font-display text-3xl font-bold text-[#10242F]">Contact the Secretariat</h1>
                  <p className="mt-1 text-sm text-slate-600">
                    Reach LASUPADORA Masqueraders Society for cultural invitations, partnerships, or membership inquiries.
                  </p>

                  <div className="mt-6 grid gap-4 rounded-xl border border-slate-200 bg-[#F8F9FA] p-4 sm:grid-cols-2 text-xs">
                    <div>
                      <p className="font-semibold text-[#10242F]">Secretariat Address</p>
                      <p className="mt-0.5 text-slate-600">{secretariatAddress}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#10242F]">Official Email</p>
                      <p className="mt-0.5 font-mono-tabular text-slate-600 break-all">{secretariatEmail}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#10242F]">Telephone</p>
                      <p className="mt-0.5 font-mono-tabular text-slate-600">{secretariatPhone}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#10242F]">Office &amp; Meeting Hours</p>
                      <p className="mt-0.5 text-slate-600">{officeHours}</p>
                    </div>
                  </div>

                  <form onSubmit={handleContactSubmit} className="mt-8 space-y-5">
                    {contactSuccess && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-[#146B3A]">
                        {contactSuccess}
                      </div>
                    )}
                    {contactError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-[#AD220B]">
                        {contactError}
                      </div>
                    )}
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-semibold text-[#10242F]">Your Name *</label>
                        <input
                          type="text"
                          required
                          value={contactForm.sender_name}
                          onChange={(e) => setContactForm({ ...contactForm, sender_name: e.target.value })}
                          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#10242F]">Email Address</label>
                        <input
                          type="email"
                          value={contactForm.sender_email}
                          onChange={(e) => setContactForm({ ...contactForm, sender_email: e.target.value })}
                          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#10242F]">Subject *</label>
                      <input
                        type="text"
                        required
                        value={contactForm.subject}
                        onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#10242F]">Message *</label>
                      <textarea
                        rows={4}
                        required
                        value={contactForm.message}
                        onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      className="rounded-lg bg-[#BD5016] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#9D4010] cursor-pointer"
                    >
                      Send Message
                    </button>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Article Reader Modal */}
      {selectedArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedArticle(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 sm:p-8 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="text-xs text-slate-500">
                <span className="font-semibold text-[#AD220B]">{selectedArticle.category}</span>
                <span aria-hidden="true"> · </span>
                <span>{formatDate(selectedArticle.published_at)}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedArticle(null)}
                aria-label="Close Publication"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <h2 className="mt-3 font-display text-2xl font-bold text-[#10242F]">{selectedArticle.title}</h2>
            {selectedArticle.cover_image_url && (
              <img
                src={selectedArticle.cover_image_url}
                alt={selectedArticle.title}
                referrerPolicy="no-referrer"
                className="mt-5 aspect-[16/9] w-full rounded-lg object-cover"
              />
            )}
            <p className="mt-5 text-sm text-slate-700 leading-relaxed whitespace-pre-line">{selectedArticle.body}</p>
          </div>
        </div>
      )}

      {/* Event Details Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedEvent(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 sm:p-8 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-semibold text-[#AD220B]">{selectedEvent.status}</span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-[#053559]">{selectedEvent.branch_name || 'National Society'}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">{formatDate(selectedEvent.event_date)}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                aria-label="Close Event Details"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <h2 className="mt-3 font-display text-2xl font-bold text-[#10242F]">{selectedEvent.title}</h2>
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span>{selectedEvent.venue}</span>
            </p>
            {selectedEvent.poster_url && (
              <img
                src={selectedEvent.poster_url}
                alt={selectedEvent.title}
                referrerPolicy="no-referrer"
                className="mt-5 aspect-[16/9] w-full rounded-lg border border-slate-200 object-cover"
              />
            )}
            <p className="mt-5 text-sm text-slate-700 leading-relaxed whitespace-pre-line">{selectedEvent.description}</p>

            {parseCommittee(selectedEvent.organising_committee).length > 0 && (
              <div className="mt-5 rounded-lg border border-slate-200 bg-[#F8F9FA] p-4">
                <p className="text-xs font-semibold text-[#10242F]">Organising Committee</p>
                <ul className="mt-1.5 list-disc pl-4 text-xs text-slate-600 space-y-1">
                  {parseCommittee(selectedEvent.organising_committee).map((member, idx) => (
                    <li key={idx}>{member}</li>
                  ))}
                </ul>
              </div>
            )}

            {selectedEvent.post_event_report && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-[#F8F9FA] p-4 text-xs text-slate-700">
                <p className="font-semibold text-[#10242F]">Post-Event Report &amp; Highlights</p>
                <p className="mt-1 leading-relaxed">{selectedEvent.post_event_report}</p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs">
              <span className="font-mono-tabular text-slate-500">
                <Calendar className="mr-1.5 inline h-3.5 w-3.5 text-slate-400" />
                {selectedEvent.registered_count || 0} members registered
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {selectedEvent.status === 'Upcoming' && selectedEvent.registration_open === 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedEvent(null);
                      if (user) onGoMemberPortal();
                      else onGoMemberLogin();
                    }}
                    className="rounded-lg bg-[#BD5016] px-4 py-2 font-semibold text-white hover:bg-[#9D4010] cursor-pointer"
                  >
                    {user ? 'Register in Member Portal' : 'Member Sign In to Register'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEvent(null);
                    navigate('events');
                  }}
                  className="rounded-lg border border-slate-300 px-3.5 py-2 font-semibold text-[#10242F] hover:bg-slate-50 cursor-pointer"
                >
                  Full Calendar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Gallery Fullscreen Lightbox */}
      {lightboxItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4" onClick={() => setLightboxItem(null)}>
          <div className="max-w-4xl w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setLightboxItem(null)}
                className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/20 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <img
              src={lightboxItem.file_url}
              alt={lightboxItem.title}
              referrerPolicy="no-referrer"
              className="max-h-[75vh] w-full rounded-lg object-contain bg-black"
            />
            <div className="text-white">
              <p className="text-sm font-bold">{lightboxItem.title}</p>
              {lightboxItem.caption && <p className="text-xs text-slate-300 mt-0.5">{lightboxItem.caption}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Quiet Institutional Footer */}
      <footer className="border-t border-slate-200 bg-[#10242F] text-slate-300">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid gap-8 md:grid-cols-4">
            <div className="space-y-3">
              <OfficialLogo size="sm" framedOnDark />
              <p className="text-sm font-semibold text-white">LASUPADORA Masqueraders Society</p>
              <p className="text-xs text-slate-400">Wear the Culture. Live the Tradition.</p>
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-semibold text-white">Society Navigation</p>
              <button type="button" onClick={() => navigate('about', 'story')} className="block hover:text-white cursor-pointer">Charter &amp; Principles</button>
              <button type="button" onClick={() => navigate('about', 'leadership')} className="block hover:text-white cursor-pointer">Executive Leadership</button>
              <button type="button" onClick={() => navigate('about', 'branches')} className="block hover:text-white cursor-pointer">Tema &amp; Outside Tema Branches</button>
              <button type="button" onClick={() => navigate('apply')} className="block hover:text-white cursor-pointer">Online Membership Application</button>
            </div>

            <div className="space-y-2 text-xs">
              <p className="font-semibold text-white">Secretariat &amp; Contact</p>
              <p>{secretariatAddress}</p>
              <p className="font-mono-tabular break-all">{secretariatEmail}</p>
              <p className="font-mono-tabular">{secretariatPhone}</p>
              <button type="button" onClick={() => navigate('contact')} className="inline-flex items-center gap-1 text-[#E48947] hover:underline cursor-pointer">
                Contact Form <ExternalLink className="h-3 w-3" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="font-semibold text-white">Install Mobile App (PWA)</p>
              <p className="text-slate-400">Install LASUPADORA 360 on Android or desktop for quick member card &amp; event access.</p>
              <PWAInstallButton variant="dark" />
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-[11px] text-slate-400">
            <p onClick={handleSecretTrigger} className="select-none">
              © {new Date().getFullYear()} LASUPADORA Masqueraders Society. Collectively governed by its members.
            </p>
            <p className="font-mono-tabular">Currency: GHS · Official Brand Palette: #10242F / #053559 / #AD220B / #BD5016 / #E48947</p>
          </div>
        </div>
      </footer>
    </div>
  );
};
