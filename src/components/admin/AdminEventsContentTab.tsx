import React, { useEffect, useState } from 'react';
import { Calendar, Image as ImageIcon, Newspaper, Pencil, Upload, X } from 'lucide-react';
import { apiFetch, formatDate } from '../../lib/api';
import type { AuthUser, Branch, MediaItem, MemberRecord, Publication, SocietyEvent } from '../../types';

interface PickedFile {
  filename: string;
  mimeType: string;
  dataBase64: string;
}

function toDatetimeLocalValue(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const AdminEventsContentTab: React.FC<{
  user: AuthUser;
  branches: Branch[];
  initialSubTab?: 'events' | 'publications' | 'gallery';
}> = ({ user, branches, initialSubTab = 'events' }) => {
  const [subTab, setSubTab] = useState<'events' | 'publications' | 'gallery'>(initialSubTab);
  const [events, setEvents] = useState<SocietyEvent[]>([]);
  const [registrations, setRegistrations] = useState<Record<string, string>[]>([]);
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [publications, setPublications] = useState<Publication[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>('');
  const [checkinMemberId, setCheckinMemberId] = useState<string>('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Create forms
  const [evtForm, setEvtForm] = useState({
    title: '',
    event_date: '',
    venue: '',
    branch_id: '',
    description: '',
    poster_url: '',
  });
  const [evtPosterFile, setEvtPosterFile] = useState<PickedFile | null>(null);

  const [pubForm, setPubForm] = useState({
    title: '',
    category: 'Announcement',
    excerpt: '',
    body: '',
    cover_image_url: '',
    status: 'Published',
    is_featured: false,
  });
  const [pubCoverFile, setPubCoverFile] = useState<PickedFile | null>(null);

  const [mediaForm, setMediaForm] = useState({
    title: '',
    caption: '',
    album_name: 'General Archive',
    media_type: 'photo',
    bucket_visibility: 'public' as 'public' | 'private',
  });
  const [uploadFile, setUploadFile] = useState<PickedFile | null>(null);

  // Edit modals
  const [editingPub, setEditingPub] = useState<Publication | null>(null);
  const [editPubForm, setEditPubForm] = useState({
    title: '',
    category: 'Announcement',
    status: 'Published',
    excerpt: '',
    body: '',
    cover_image_url: '',
    is_featured: false,
  });
  const [editPubCoverFile, setEditPubCoverFile] = useState<PickedFile | null>(null);
  const [savingPubEdit, setSavingPubEdit] = useState(false);

  const [editingEvent, setEditingEvent] = useState<SocietyEvent | null>(null);
  const [editEventForm, setEditEventForm] = useState({
    title: '',
    event_date: '',
    venue: '',
    branch_id: '',
    status: 'Upcoming',
    description: '',
    poster_url: '',
    registration_open: true,
    is_public: true,
  });
  const [editEventPosterFile, setEditEventPosterFile] = useState<PickedFile | null>(null);
  const [savingEventEdit, setSavingEventEdit] = useState(false);

  const [editingMedia, setEditingMedia] = useState<MediaItem | null>(null);
  const [editMediaForm, setEditMediaForm] = useState({
    title: '',
    album_name: '',
    caption: '',
    bucket_visibility: 'public' as 'public' | 'private',
    file_url: '',
  });
  const [editMediaFile, setEditMediaFile] = useState<PickedFile | null>(null);
  const [savingMediaEdit, setSavingMediaEdit] = useState(false);

  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab]);

  const loadAll = async () => {
    setErr(null);
    try {
      if (user.permissions.events?.view) {
        const ev = await apiFetch<{ events: SocietyEvent[]; registrations: Record<string, string>[] }>('/api/admin/events');
        setEvents(ev.events);
        setRegistrations(ev.registrations);
        if (ev.events[0] && !selectedEventId) setSelectedEventId(ev.events[0].id);
      }
      if (user.permissions.membership?.view) {
        const m = await apiFetch<{ members: MemberRecord[] }>('/api/admin/members');
        setMembers(m.members);
        if (m.members[0] && !checkinMemberId) setCheckinMemberId(m.members[0].id);
      }
      if (user.permissions.publications?.view) {
        const p = await apiFetch<{ publications: Publication[] }>('/api/admin/publications');
        setPublications(p.publications);
      }
      if (user.permissions.gallery?.view) {
        const g = await apiFetch<{ items: MediaItem[] }>('/api/admin/gallery');
        setMedia(g.items);
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const pickFile = (file: File | undefined, setter: React.Dispatch<React.SetStateAction<PickedFile | null>>) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setter({
        filename: file.name,
        mimeType: file.type,
        dataBase64: String(reader.result || ''),
      });
    };
    reader.readAsDataURL(file);
  };

  const uploadPublicAsset = async (file: PickedFile) => {
    return apiFetch<{ url: string; mimeType: string; sizeBytes: number }>('/api/uploads', {
      method: 'POST',
      body: JSON.stringify({ ...file, visibility: 'public' }),
    });
  };

  const createEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      let posterUrl = evtForm.poster_url.trim();
      if (evtPosterFile) {
        const up = await uploadPublicAsset(evtPosterFile);
        posterUrl = up.url;
      }
      await apiFetch('/api/admin/events', {
        method: 'POST',
        body: JSON.stringify({ ...evtForm, poster_url: posterUrl || undefined }),
      });
      setMsg('Event created and published to calendar.');
      setEvtForm({ title: '', event_date: '', venue: '', branch_id: '', description: '', poster_url: '' });
      setEvtPosterFile(null);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const openEditEvent = (ev: SocietyEvent) => {
    setEditingEvent(ev);
    setEditEventPosterFile(null);
    setEditEventForm({
      title: ev.title || '',
      event_date: toDatetimeLocalValue(ev.event_date),
      venue: ev.venue || '',
      branch_id: ev.branch_id || '',
      status: ev.status || 'Upcoming',
      description: ev.description || '',
      poster_url: ev.poster_url || '',
      registration_open: Boolean(ev.registration_open),
      is_public: Boolean(ev.is_public),
    });
  };

  const saveEditEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEvent) return;
    setSavingEventEdit(true);
    setErr(null);
    setMsg(null);
    try {
      let posterUrl = editEventForm.poster_url.trim();
      if (editEventPosterFile) {
        const up = await uploadPublicAsset(editEventPosterFile);
        posterUrl = up.url;
      }
      await apiFetch(`/api/admin/events/${editingEvent.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...editEventForm,
          poster_url: posterUrl,
        }),
      });
      setMsg(`Updated event "${editEventForm.title}".`);
      setEditingEvent(null);
      setEditEventPosterFile(null);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingEventEdit(false);
    }
  };

  const markAttendance = async (memberId: string, attendance_status: string) => {
    if (!selectedEventId) return;
    await apiFetch(`/api/admin/events/${selectedEventId}/attendance`, {
      method: 'POST',
      body: JSON.stringify({ member_id: memberId, attendance_status }),
    });
    setMsg(`Attendance recorded as ${attendance_status}.`);
    await loadAll();
  };

  const createPub = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      let coverUrl = pubForm.cover_image_url.trim();
      if (pubCoverFile) {
        const up = await uploadPublicAsset(pubCoverFile);
        coverUrl = up.url;
      }
      await apiFetch('/api/admin/publications', {
        method: 'POST',
        body: JSON.stringify({ ...pubForm, cover_image_url: coverUrl || undefined }),
      });
      setMsg('Publication saved.');
      setPubForm({
        title: '',
        category: 'Announcement',
        excerpt: '',
        body: '',
        cover_image_url: '',
        status: 'Published',
        is_featured: false,
      });
      setPubCoverFile(null);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const openEditPub = (pub: Publication) => {
    setEditingPub(pub);
    setEditPubCoverFile(null);
    setEditPubForm({
      title: pub.title || '',
      category: pub.category || 'Announcement',
      status: pub.status || 'Published',
      excerpt: pub.excerpt || '',
      body: pub.body || '',
      cover_image_url: pub.cover_image_url || '',
      is_featured: Boolean(pub.is_featured),
    });
  };

  const saveEditPub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPub) return;
    setSavingPubEdit(true);
    setErr(null);
    setMsg(null);
    try {
      let coverUrl = editPubForm.cover_image_url.trim();
      if (editPubCoverFile) {
        const up = await uploadPublicAsset(editPubCoverFile);
        coverUrl = up.url;
      }
      await apiFetch(`/api/admin/publications/${editingPub.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...editPubForm,
          cover_image_url: coverUrl,
        }),
      });
      setMsg(`Updated publication "${editPubForm.title}".`);
      setEditingPub(null);
      setEditPubCoverFile(null);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingPubEdit(false);
    }
  };

  const togglePubStatus = async (pub: Publication, status: string) => {
    await apiFetch(`/api/admin/publications/${pub.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await loadAll();
  };

  const uploadMediaItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) {
      setErr('Please choose a file (PNG, JPEG, WEBP, or PDF) first.');
      return;
    }
    setErr(null);
    setMsg(null);
    try {
      const up = await apiFetch<{ url: string; mimeType: string; sizeBytes: number }>('/api/uploads', {
        method: 'POST',
        body: JSON.stringify({ ...uploadFile, visibility: mediaForm.bucket_visibility }),
      });
      await apiFetch('/api/admin/gallery', {
        method: 'POST',
        body: JSON.stringify({
          ...mediaForm,
          file_url: up.url,
          mime_type: up.mimeType,
          file_size_bytes: up.sizeBytes,
        }),
      });
      setMsg(`Uploaded to ${mediaForm.bucket_visibility} bucket.`);
      setMediaForm({ ...mediaForm, title: '', caption: '' });
      setUploadFile(null);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const openEditMedia = (item: MediaItem) => {
    setEditingMedia(item);
    setEditMediaFile(null);
    setEditMediaForm({
      title: item.title || '',
      album_name: item.album_name || '',
      caption: item.caption || '',
      bucket_visibility: item.bucket_visibility || 'public',
      file_url: item.file_url || '',
    });
  };

  const saveEditMedia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMedia) return;
    setSavingMediaEdit(true);
    setErr(null);
    setMsg(null);
    try {
      let fileUrl = editMediaForm.file_url.trim();
      let mimeType: string | undefined;
      let sizeBytes: number | undefined;
      if (editMediaFile) {
        const up = await apiFetch<{ url: string; mimeType: string; sizeBytes: number }>('/api/uploads', {
          method: 'POST',
          body: JSON.stringify({ ...editMediaFile, visibility: editMediaForm.bucket_visibility }),
        });
        fileUrl = up.url;
        mimeType = up.mimeType;
        sizeBytes = up.sizeBytes;
      }
      await apiFetch(`/api/admin/gallery/${editingMedia.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...editMediaForm,
          file_url: fileUrl,
          ...(mimeType ? { mime_type: mimeType } : {}),
          ...(sizeBytes ? { file_size_bytes: sizeBytes } : {}),
        }),
      });
      setMsg(`Updated media item "${editMediaForm.title}".`);
      setEditingMedia(null);
      setEditMediaFile(null);
      await loadAll();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingMediaEdit(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1 w-fit">
        {user.permissions.events?.view && (
          <button
            type="button"
            onClick={() => setSubTab('events')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${subTab === 'events' ? 'bg-white text-[#10242F] shadow-sm' : 'text-slate-600'}`}
          >
            <Calendar className="h-3.5 w-3.5" /> Events &amp; Attendance
          </button>
        )}
        {user.permissions.publications?.view && (
          <button
            type="button"
            onClick={() => setSubTab('publications')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${subTab === 'publications' ? 'bg-white text-[#10242F] shadow-sm' : 'text-slate-600'}`}
          >
            <Newspaper className="h-3.5 w-3.5" /> News &amp; Announcements
          </button>
        )}
        {user.permissions.gallery?.view && (
          <button
            type="button"
            onClick={() => setSubTab('gallery')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer ${subTab === 'gallery' ? 'bg-white text-[#10242F] shadow-sm' : 'text-slate-600'}`}
          >
            <ImageIcon className="h-3.5 w-3.5" /> Media Library
          </button>
        )}
      </div>

      {msg && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-[#146B3A]">{msg}</div>}
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-[#AD220B]">{err}</div>}

      {/* EVENTS & ATTENDANCE */}
      {subTab === 'events' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-4">
            {events.map((ev) => (
              <div key={ev.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {ev.poster_url && (
                      <img
                        src={ev.poster_url}
                        alt={ev.title}
                        referrerPolicy="no-referrer"
                        className="h-16 w-24 shrink-0 rounded-lg border border-slate-200 object-cover bg-slate-100"
                      />
                    )}
                    <div>
                      <p className="text-xs text-slate-500 font-mono-tabular">
                        {formatDate(ev.event_date)} · {ev.branch_name || 'All Branches'} · {ev.status}
                      </p>
                      <h3 className="mt-1 text-sm font-bold text-[#10242F]">{ev.title}</h3>
                      <p className="text-xs text-slate-600">{ev.venue}</p>
                    </div>
                  </div>
                  <div className="text-right font-mono-tabular text-xs">
                    <p className="font-bold text-[#053559]">{ev.total_present || 0} / {ev.total_registered || 0} Present</p>
                  </div>
                </div>
                {user.permissions.events?.edit && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3 text-xs">
                    <button
                      type="button"
                      onClick={() => openEditEvent(ev)}
                      className="inline-flex items-center gap-1 rounded border border-[#053559]/40 bg-[#053559]/5 px-2.5 py-1 font-semibold text-[#053559] hover:bg-[#053559]/10 cursor-pointer"
                    >
                      <Pencil className="h-3 w-3" /> Edit Event &amp; Poster
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEventId(ev.id)}
                      className="rounded border border-slate-300 px-2.5 py-1 font-semibold hover:bg-slate-50 cursor-pointer"
                    >
                      Manage Attendance
                    </button>
                    {ev.status === 'Upcoming' && (
                      <button
                        type="button"
                        onClick={() => apiFetch(`/api/admin/events/${ev.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'Completed' }) }).then(loadAll)}
                        className="rounded border border-slate-300 px-2.5 py-1 font-semibold hover:bg-slate-50 cursor-pointer"
                      >
                        Mark Completed
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="lg:col-span-5 space-y-6">
            {selectedEventId && user.permissions.events?.edit && (
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-bold text-[#10242F]">Check-In Attendance Register</h3>
                <select value={selectedEventId} onChange={(e) => setSelectedEventId(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
                <div className="flex gap-2">
                  <select value={checkinMemberId} onChange={(e) => setCheckinMemberId(e.target.value)} className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                    {members.map((m) => <option key={m.id} value={m.id}>{m.full_name} ({m.membership_number})</option>)}
                  </select>
                  <button type="button" onClick={() => markAttendance(checkinMemberId, 'Present')} className="rounded-lg bg-[#146B3A] px-3 py-2 text-xs font-semibold text-white cursor-pointer">
                    Mark Present
                  </button>
                </div>
                <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto text-xs">
                  {registrations.filter((r) => r.event_id === selectedEventId).map((r) => (
                    <div key={r.id} className="py-2 flex justify-between">
                      <span>{r.full_name} ({r.membership_number})</span>
                      <span className="font-semibold text-[#053559]">{r.attendance_status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {user.permissions.events?.create && (
              <form onSubmit={createEvent} className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
                <h3 className="text-sm font-bold text-[#10242F]">Create Society Event</h3>
                <input type="text" required placeholder="Event Title *" value={evtForm.title} onChange={(e) => setEvtForm({ ...evtForm, title: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                <input type="datetime-local" required value={evtForm.event_date} onChange={(e) => setEvtForm({ ...evtForm, event_date: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                <input type="text" required placeholder="Venue *" value={evtForm.venue} onChange={(e) => setEvtForm({ ...evtForm, venue: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                <select value={evtForm.branch_id} onChange={(e) => setEvtForm({ ...evtForm, branch_id: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  <option value="">All Branches (National)</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <textarea rows={2} placeholder="Description" value={evtForm.description} onChange={(e) => setEvtForm({ ...evtForm, description: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <label className="block text-[11px] font-semibold text-[#10242F]">Event Poster / Banner Image</label>
                  {(evtPosterFile?.dataBase64 || evtForm.poster_url) && (
                    <img
                      src={evtPosterFile?.dataBase64 || evtForm.poster_url}
                      alt="Event poster preview"
                      referrerPolicy="no-referrer"
                      className="aspect-[16/9] w-full rounded-lg border border-slate-200 object-cover bg-white"
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#10242F] hover:bg-slate-100 cursor-pointer">
                      <Upload className="h-3.5 w-3.5" />
                      <span>{evtPosterFile ? evtPosterFile.filename : 'Upload Poster Image'}</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pickFile(e.target.files?.[0], setEvtPosterFile)} className="hidden" />
                    </label>
                    <input
                      type="text"
                      placeholder="Or paste poster URL (optional)"
                      value={evtForm.poster_url}
                      onChange={(e) => setEvtForm({ ...evtForm, poster_url: e.target.value })}
                      className="flex-1 min-w-[140px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                  </div>
                </div>
                <button type="submit" className="w-full rounded-lg bg-[#BD5016] py-2 text-xs font-semibold text-white cursor-pointer">Create Event</button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* PUBLICATIONS CMS */}
      {subTab === 'publications' && (
        <div className="grid gap-6 lg:grid-cols-12">
          {user.permissions.publications?.create && (
            <form onSubmit={createPub} className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-5 space-y-3 h-fit">
              <h3 className="text-sm font-bold text-[#10242F]">Publish News or Announcement</h3>
              <input type="text" required placeholder="Headline *" value={pubForm.title} onChange={(e) => setPubForm({ ...pubForm, title: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <div className="grid grid-cols-2 gap-2">
                <select value={pubForm.category} onChange={(e) => setPubForm({ ...pubForm, category: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  {['Announcement', 'News', 'Featured Story', 'Cultural Note', 'Archive'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={pubForm.status} onChange={(e) => setPubForm({ ...pubForm, status: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  {['Draft', 'Scheduled', 'Published', 'Archived'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <input type="text" placeholder="Short summary excerpt" value={pubForm.excerpt} onChange={(e) => setPubForm({ ...pubForm, excerpt: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <textarea rows={4} required placeholder="Full article content *" value={pubForm.body} onChange={(e) => setPubForm({ ...pubForm, body: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <label className="block text-[11px] font-semibold text-[#10242F]">Cover Image (Accompanies News / Information)</label>
                {(pubCoverFile?.dataBase64 || pubForm.cover_image_url) && (
                  <img
                    src={pubCoverFile?.dataBase64 || pubForm.cover_image_url}
                    alt="Cover preview"
                    referrerPolicy="no-referrer"
                    className="aspect-[16/9] w-full rounded-lg border border-slate-200 object-cover bg-white"
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#10242F] hover:bg-slate-100 cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{pubCoverFile ? pubCoverFile.filename : 'Upload Cover Image'}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pickFile(e.target.files?.[0], setPubCoverFile)} className="hidden" />
                  </label>
                  <input
                    type="text"
                    placeholder="Or paste image URL (e.g. /media/...)"
                    value={pubForm.cover_image_url}
                    onChange={(e) => setPubForm({ ...pubForm, cover_image_url: e.target.value })}
                    className="flex-1 min-w-[140px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={pubForm.is_featured} onChange={(e) => setPubForm({ ...pubForm, is_featured: e.target.checked })} /> Feature on Home Page</label>
              <button type="submit" className="w-full rounded-lg bg-[#10242F] py-2 text-xs font-semibold text-white cursor-pointer">Save Publication</button>
            </form>
          )}
          <div className={`${user.permissions.publications?.create ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-3`}>
            {publications.map((p) => (
              <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-5 flex flex-wrap sm:flex-nowrap items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  {p.cover_image_url && (
                    <img
                      src={p.cover_image_url}
                      alt={p.title}
                      referrerPolicy="no-referrer"
                      className="h-16 w-24 shrink-0 rounded-lg border border-slate-200 object-cover bg-slate-100"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500">{p.category} · <strong>{p.status}</strong> {p.is_featured === 1 ? '· Featured' : ''}</p>
                    <h4 className="mt-1 text-sm font-bold text-[#10242F]">{p.title}</h4>
                    <p className="mt-1 text-xs text-slate-600 line-clamp-2">{p.excerpt}</p>
                  </div>
                </div>
                {user.permissions.publications?.edit && (
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditPub(p)}
                      className="inline-flex items-center gap-1 rounded border border-[#053559]/40 bg-[#053559]/5 px-2.5 py-1 text-[11px] font-semibold text-[#053559] hover:bg-[#053559]/10 cursor-pointer"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                    {p.status !== 'Published' && (
                      <button type="button" onClick={() => togglePubStatus(p, 'Published')} className="rounded bg-[#146B3A] px-2.5 py-1 text-[11px] font-semibold text-white cursor-pointer">Publish</button>
                    )}
                    {p.status === 'Published' && (
                      <button type="button" onClick={() => togglePubStatus(p, 'Archived')} className="rounded border border-slate-300 px-2.5 py-1 text-[11px] font-semibold cursor-pointer">Archive</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MEDIA LIBRARY (PUBLIC VS PRIVATE BUCKETS) */}
      {subTab === 'gallery' && (
        <div className="grid gap-6 lg:grid-cols-12">
          {user.permissions.gallery?.create && (
            <form onSubmit={uploadMediaItem} className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-5 space-y-3 h-fit">
              <h3 className="text-sm font-bold text-[#10242F]">Upload Media / Document</h3>
              <p className="text-[11px] text-slate-500">Private files are protected behind authenticated RBAC endpoints and never exposed publicly.</p>
              <input type="text" required placeholder="Title *" value={mediaForm.title} onChange={(e) => setMediaForm({ ...mediaForm, title: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <input type="text" placeholder="Album Name" value={mediaForm.album_name} onChange={(e) => setMediaForm({ ...mediaForm, album_name: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <input type="text" placeholder="Caption (Optional)" value={mediaForm.caption} onChange={(e) => setMediaForm({ ...mediaForm, caption: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <div className="grid grid-cols-2 gap-2">
                <select value={mediaForm.media_type} onChange={(e) => setMediaForm({ ...mediaForm, media_type: e.target.value })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  <option value="photo">Photo</option>
                  <option value="poster">Poster</option>
                  <option value="document">Document</option>
                </select>
                <select value={mediaForm.bucket_visibility} onChange={(e) => setMediaForm({ ...mediaForm, bucket_visibility: e.target.value as 'public' | 'private' })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
                  <option value="public">Public Bucket</option>
                  <option value="private">Private Bucket</option>
                </select>
              </div>
              <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 p-4 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer">
                <Upload className="h-4 w-4" />
                <span>{uploadFile ? uploadFile.filename : 'Select PNG, JPG, WEBP, or PDF (Max 5MB)'}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => pickFile(e.target.files?.[0], setUploadFile)} className="hidden" />
              </label>
              <button type="submit" className="w-full rounded-lg bg-[#BD5016] py-2 text-xs font-semibold text-white cursor-pointer">Upload &amp; Save</button>
            </form>
          )}
          <div className={`${user.permissions.gallery?.create ? 'lg:col-span-8' : 'lg:col-span-12'} grid gap-4 sm:grid-cols-2`}>
            {media.map((m) => (
              <div key={m.id} className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
                {m.mime_type.startsWith('image/') && (
                  <img src={m.file_url} alt={m.title} referrerPolicy="no-referrer" className="aspect-[4/3] w-full object-cover" />
                )}
                <div className="p-4 text-xs flex-1 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-slate-500">
                      {m.album_name} · <strong className={m.bucket_visibility === 'private' ? 'text-[#AD220B]' : 'text-[#146B3A]'}>{m.bucket_visibility.toUpperCase()}</strong>
                    </p>
                    <p className="mt-1 font-bold text-[#10242F]">{m.title}</p>
                    {m.caption && <p className="mt-0.5 text-slate-600">{m.caption}</p>}
                  </div>
                  {user.permissions.gallery?.edit && (
                    <button
                      type="button"
                      onClick={() => openEditMedia(m)}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-[#053559] hover:bg-slate-50 cursor-pointer shrink-0"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit Publication Modal */}
      {editingPub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={saveEditPub} className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-lg font-bold text-[#10242F]">Edit News / Information</h3>
              <button type="button" onClick={() => setEditingPub(null)} className="p-1 text-slate-500 hover:text-black cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-[#10242F]">Headline *</label>
                <input
                  type="text"
                  required
                  value={editPubForm.title}
                  onChange={(e) => setEditPubForm({ ...editPubForm, title: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#10242F]">Category</label>
                  <select
                    value={editPubForm.category}
                    onChange={(e) => setEditPubForm({ ...editPubForm, category: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    {['Announcement', 'News', 'Featured Story', 'Cultural Note', 'Archive'].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-[#10242F]">Publication Status</label>
                  <select
                    value={editPubForm.status}
                    onChange={(e) => setEditPubForm({ ...editPubForm, status: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    {['Draft', 'Scheduled', 'Published', 'Archived'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Short Summary Excerpt</label>
                <input
                  type="text"
                  value={editPubForm.excerpt}
                  onChange={(e) => setEditPubForm({ ...editPubForm, excerpt: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Full Article / Information Content *</label>
                <textarea
                  rows={5}
                  required
                  value={editPubForm.body}
                  onChange={(e) => setEditPubForm({ ...editPubForm, body: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <label className="block font-semibold text-[#10242F]">Cover Image (Accompanies News / Information)</label>
                {(editPubCoverFile?.dataBase64 || editPubForm.cover_image_url) && (
                  <img
                    src={editPubCoverFile?.dataBase64 || editPubForm.cover_image_url}
                    alt={editPubForm.title}
                    referrerPolicy="no-referrer"
                    className="aspect-[16/9] max-h-48 w-full rounded-lg border border-slate-200 object-cover bg-white"
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#10242F] hover:bg-slate-100 cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{editPubCoverFile ? editPubCoverFile.filename : 'Upload Replacement Image'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => pickFile(e.target.files?.[0], setEditPubCoverFile)}
                      className="hidden"
                    />
                  </label>
                  <input
                    type="text"
                    placeholder="Image URL (e.g. /media/... or https://...)"
                    value={editPubForm.cover_image_url}
                    onChange={(e) => setEditPubForm({ ...editPubForm, cover_image_url: e.target.value })}
                    className="flex-1 min-w-[180px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  />
                  {(editPubCoverFile || editPubForm.cover_image_url) && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditPubCoverFile(null);
                        setEditPubForm({ ...editPubForm, cover_image_url: '' });
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[11px] font-semibold text-[#AD220B] hover:bg-red-50 cursor-pointer"
                    >
                      Clear Image
                    </button>
                  )}
                </div>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editPubForm.is_featured}
                  onChange={(e) => setEditPubForm({ ...editPubForm, is_featured: e.target.checked })}
                />
                Feature on Home Page
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setEditingPub(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingPubEdit}
                className="rounded-lg bg-[#10242F] px-5 py-2 text-xs font-semibold text-white hover:bg-[#193545] disabled:opacity-50 cursor-pointer"
              >
                {savingPubEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Event Modal */}
      {editingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={saveEditEvent} className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-lg font-bold text-[#10242F]">Edit Society Event &amp; Poster</h3>
              <button type="button" onClick={() => setEditingEvent(null)} className="p-1 text-slate-500 hover:text-black cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block font-semibold text-[#10242F]">Event Title *</label>
                  <input
                    type="text"
                    required
                    value={editEventForm.title}
                    onChange={(e) => setEditEventForm({ ...editEventForm, title: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#10242F]">Date &amp; Time *</label>
                  <input
                    type="datetime-local"
                    required
                    value={editEventForm.event_date}
                    onChange={(e) => setEditEventForm({ ...editEventForm, event_date: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#10242F]">Venue *</label>
                  <input
                    type="text"
                    required
                    value={editEventForm.venue}
                    onChange={(e) => setEditEventForm({ ...editEventForm, venue: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#10242F]">Branch</label>
                  <select
                    value={editEventForm.branch_id}
                    onChange={(e) => setEditEventForm({ ...editEventForm, branch_id: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="">All Branches (National)</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-[#10242F]">Status</label>
                  <select
                    value={editEventForm.status}
                    onChange={(e) => setEditEventForm({ ...editEventForm, status: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    {['Upcoming', 'Ongoing', 'Completed', 'Cancelled'].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end gap-4 pb-2">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={editEventForm.registration_open}
                      onChange={(e) => setEditEventForm({ ...editEventForm, registration_open: e.target.checked })}
                    />
                    Registration Open
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={editEventForm.is_public}
                      onChange={(e) => setEditEventForm({ ...editEventForm, is_public: e.target.checked })}
                    />
                    Publicly Visible
                  </label>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Description</label>
                <textarea
                  rows={3}
                  value={editEventForm.description}
                  onChange={(e) => setEditEventForm({ ...editEventForm, description: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <label className="block font-semibold text-[#10242F]">Event Poster / Banner Image</label>
                {(editEventPosterFile?.dataBase64 || editEventForm.poster_url) && (
                  <img
                    src={editEventPosterFile?.dataBase64 || editEventForm.poster_url}
                    alt={editEventForm.title}
                    referrerPolicy="no-referrer"
                    className="aspect-[16/9] max-h-48 w-full rounded-lg border border-slate-200 object-cover bg-white"
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#10242F] hover:bg-slate-100 cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    <span>{editEventPosterFile ? editEventPosterFile.filename : 'Upload Poster Image'}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => pickFile(e.target.files?.[0], setEditEventPosterFile)}
                      className="hidden"
                    />
                  </label>
                  <input
                    type="text"
                    placeholder="Poster image URL..."
                    value={editEventForm.poster_url}
                    onChange={(e) => setEditEventForm({ ...editEventForm, poster_url: e.target.value })}
                    className="flex-1 min-w-[180px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setEditingEvent(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEventEdit}
                className="rounded-lg bg-[#BD5016] px-5 py-2 text-xs font-semibold text-white hover:bg-[#9D4010] disabled:opacity-50 cursor-pointer"
              >
                {savingEventEdit ? 'Saving...' : 'Save Event Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Media Item Modal */}
      {editingMedia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={saveEditMedia} className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-lg font-bold text-[#10242F]">Edit Media / Replace Image</h3>
              <button type="button" onClick={() => setEditingMedia(null)} className="p-1 text-slate-500 hover:text-black cursor-pointer">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-[#10242F]">Title *</label>
                <input
                  type="text"
                  required
                  value={editMediaForm.title}
                  onChange={(e) => setEditMediaForm({ ...editMediaForm, title: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-[#10242F]">Album Name</label>
                  <input
                    type="text"
                    value={editMediaForm.album_name}
                    onChange={(e) => setEditMediaForm({ ...editMediaForm, album_name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-[#10242F]">Visibility</label>
                  <select
                    value={editMediaForm.bucket_visibility}
                    onChange={(e) => setEditMediaForm({ ...editMediaForm, bucket_visibility: e.target.value as 'public' | 'private' })}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="public">Public Bucket</option>
                    <option value="private">Private Bucket</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-semibold text-[#10242F]">Caption</label>
                <input
                  type="text"
                  value={editMediaForm.caption}
                  onChange={(e) => setEditMediaForm({ ...editMediaForm, caption: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <label className="block font-semibold text-[#10242F]">Replace Image / File</label>
                {(editMediaFile?.dataBase64 || editMediaForm.file_url) && (
                  <img
                    src={editMediaFile?.dataBase64 || editMediaForm.file_url}
                    alt={editMediaForm.title}
                    referrerPolicy="no-referrer"
                    className="aspect-[16/9] max-h-40 w-full rounded-lg border border-slate-200 object-cover bg-white"
                  />
                )}
                <label className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-[#10242F] hover:bg-slate-100 cursor-pointer">
                  <Upload className="h-3.5 w-3.5" />
                  <span>{editMediaFile ? editMediaFile.filename : 'Upload Replacement File'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    onChange={(e) => pickFile(e.target.files?.[0], setEditMediaFile)}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
              <button type="button" onClick={() => setEditingMedia(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 cursor-pointer">
                Cancel
              </button>
              <button type="submit" disabled={savingMediaEdit} className="rounded-lg bg-[#BD5016] px-5 py-2 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer">
                {savingMediaEdit ? 'Saving...' : 'Save Media Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
