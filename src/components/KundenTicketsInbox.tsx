import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useKundenTickets } from '../hooks/useKundenTickets';
import { KundenTicketsLiveSnapshot } from './KundenTicketsLiveSnapshot';
import type {
  KundenTicket,
  KundenTicketNote,
  KundenTicketStatus,
} from '../types/kundenTickets';

interface KundenTicketsInboxProps {
  isOpen: boolean;
  onClose: () => void;
}

const STATUS_ORDER: KundenTicketStatus[] = ['new', 'in_review', 'resolved'];

const toDate = (value: any): Date | null => {
  try {
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
};

const formatTicketDate = (value: any) => {
  const date = toDate(value);
  if (!date) return '-';
  return date.toLocaleString();
};

const formatRelative = (value: any, t: (key: string, opts?: any) => string): string => {
  const date = toDate(value);
  if (!date) return '-';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('kundenTickets.justNow');
  if (minutes < 60) return t('kundenTickets.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('kundenTickets.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('kundenTickets.daysAgo', { count: days });
};

const STATUS_PILL_CLASSES: Record<KundenTicketStatus, string> = {
  new: 'border-info/40 bg-info/15 text-info',
  in_review: 'border-warning/40 bg-warning/15 text-warning',
  resolved: 'border-success/40 bg-success/15 text-success',
};

const STATUS_DOT_CLASSES: Record<KundenTicketStatus, string> = {
  new: 'bg-info',
  in_review: 'bg-warning',
  resolved: 'bg-success',
};

/**
 * Should the global keydown handler ignore the event because the user is
 * typing into a form field? We always want plain text input to behave normally
 * — keyboard shortcuts only kick in when nothing is focused.
 */
const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

// ─── Internal notes thread ──────────────────────────────────────────────
const NotesThread: React.FC<{
  notes: KundenTicketNote[];
  onAdd: (text: string) => Promise<boolean>;
}> = ({ notes, onAdd }) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => a.createdAt - b.createdAt),
    [notes],
  );

  const handleSubmit = async () => {
    if (!draft.trim() || isSaving) return;
    setIsSaving(true);
    const ok = await onAdd(draft);
    setIsSaving(false);
    if (ok) setDraft('');
  };

  return (
    <section className="rounded-theme border border-border bg-muted/20">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
        aria-expanded={isOpen}
      >
        <h4 className="text-sm font-semibold text-foreground">
          {t('kundenTickets.notes.title', { count: notes.length })}
        </h4>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {isOpen ? (
        <div className="space-y-3 border-t border-border px-4 py-3">
          {sortedNotes.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('kundenTickets.notes.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {sortedNotes.map((note) => (
                <li key={note.id} className="rounded-theme border border-border bg-card p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {note.authorName || t('kundenTickets.notes.anonymous')}
                    </span>
                    {note.authorRole ? (
                      <span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                        {note.authorRole}
                      </span>
                    ) : null}
                    <span>{new Date(note.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-foreground">{note.text}</p>
                </li>
              ))}
            </ul>
          )}

          <div>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('kundenTickets.notes.placeholder') as string}
              rows={2}
              className="w-full resize-y rounded-theme border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!draft.trim() || isSaving}
                className="rounded-theme bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? t('kundenTickets.notes.saving') : t('kundenTickets.notes.add')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
};

// ────────────────────────────────────────────────────────────────────────
const KundenTicketsInbox: React.FC<KundenTicketsInboxProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const {
    tickets,
    canRead,
    updateKundenTicketStatus,
    addKundenTicketNote,
    deleteKundenTicket,
  } = useKundenTickets();

  const [statusFilter, setStatusFilter] = useState<'all' | KundenTicketStatus>('all');
  const [search, setSearch] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Tickets we have already auto-flipped from `new` → `in_review` in this
  // session. Without this guard a status push that re-fetches the ticket
  // would re-trigger the transition.
  const autoTransitionedRef = useRef<Set<string>>(new Set());

  useEscapeKey(onClose, { enabled: isOpen });

  const filteredTickets = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const byStatus = statusFilter === 'all' ? true : ticket.status === statusFilter;
      if (!byStatus) return false;
      if (!needle) return true;
      const haystack = [
        ticket.deviceId,
        ticket.stovePassport?.stoveSerial,
        ticket.stovePassport?.modelName,
        ticket.customerQuestion,
        ticket.author?.displayName,
        ticket.author?.email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [search, statusFilter, tickets]);

  const selectedTicket: KundenTicket | null = useMemo(() => {
    if (!selectedTicketId) return filteredTickets[0] || null;
    return filteredTickets.find((ticket) => ticket.id === selectedTicketId) || filteredTickets[0] || null;
  }, [filteredTickets, selectedTicketId]);

  // ── Auto-transition new → in_review on first open ──────────────────
  useEffect(() => {
    if (!selectedTicket) return;
    if (selectedTicket.status !== 'new') return;
    if (autoTransitionedRef.current.has(selectedTicket.id)) return;
    autoTransitionedRef.current.add(selectedTicket.id);
    void updateKundenTicketStatus(selectedTicket.id, 'in_review');
  }, [selectedTicket, updateKundenTicketStatus]);

  // ── Keyboard navigation ────────────────────────────────────────────
  // ↑/↓ — move between tickets in the filtered list.
  // 1/2/3 — set the current ticket's status (new/in_review/resolved).
  // The handler bails out if the user is typing into an input/textarea,
  // so notes editing and search box stay untouched.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (filteredTickets.length === 0) return;
        event.preventDefault();
        const currentIdx = selectedTicket
          ? filteredTickets.findIndex((tk) => tk.id === selectedTicket.id)
          : -1;
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        let nextIdx = currentIdx + direction;
        if (nextIdx < 0) nextIdx = 0;
        if (nextIdx >= filteredTickets.length) nextIdx = filteredTickets.length - 1;
        setSelectedTicketId(filteredTickets[nextIdx].id);
        return;
      }

      if (selectedTicket && (event.key === '1' || event.key === '2' || event.key === '3')) {
        event.preventDefault();
        const map: Record<string, KundenTicketStatus> = { '1': 'new', '2': 'in_review', '3': 'resolved' };
        void updateKundenTicketStatus(selectedTicket.id, map[event.key]);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filteredTickets, isOpen, selectedTicket, updateKundenTicketStatus]);

  const copyToClipboard = useCallback(async (value: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        setCopiedId(value);
        window.setTimeout(() => setCopiedId((prev) => (prev === value ? null : prev)), 1500);
      }
    } catch {
      /* noop */
    }
  }, []);

  const openInClassic = useCallback((deviceId: string) => {
    const url = `${window.location.origin}/?id=${encodeURIComponent(deviceId)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const openInDealerMode = useCallback((deviceId: string) => {
    const url = `${window.location.origin}/haendler?id=${encodeURIComponent(deviceId)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (!selectedTicket) return;
    const confirmed = window.confirm(
      t('kundenTickets.delete.confirm', {
        ref:
          selectedTicket.stovePassport?.stoveSerial ||
          selectedTicket.deviceId.slice(0, 7),
      }) as string,
    );
    if (!confirmed) return;
    const idToRemove = selectedTicket.id;
    const ok = await deleteKundenTicket(idToRemove);
    if (!ok) return;
    autoTransitionedRef.current.delete(idToRemove);
    // Subscription will refresh; clear selection so the list re-anchors.
    setSelectedTicketId(null);
  }, [deleteKundenTicket, selectedTicket, t]);

  const handleAddNote = useCallback(
    async (text: string) => {
      if (!selectedTicket) return false;
      return addKundenTicketNote(selectedTicket.id, text);
    },
    [addKundenTicketNote, selectedTicket],
  );

  if (!isOpen) return null;

  if (!canRead) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-md">
        <div className="w-full max-w-md rounded-theme border border-border bg-card p-5 shadow-theme-lg">
          <h2 className="text-lg font-semibold text-foreground">{t('kundenTickets.inboxTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('kundenTickets.noAccess')}</p>
          <button
            onClick={onClose}
            className="mt-4 rounded-theme border border-border bg-muted px-3 py-2 text-sm hover:bg-accent"
          >
            {t('actions.close')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-theme border border-border bg-card shadow-theme-lg">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t('kundenTickets.inboxTitle')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('kundenTickets.inboxSubtitle')}
              {' · '}
              {t('kundenTickets.countLabel', { count: filteredTickets.length })}
              {' · '}
              <span title={t('kundenTickets.shortcutsHint') as string}>
                ↑↓ · 1/2/3 · Esc
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-theme border border-border bg-muted px-3 py-2 text-sm hover:bg-accent"
          >
            {t('actions.close')}
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[380px_1fr]">
          <aside className="border-r border-border p-4">
            <div className="mb-3 space-y-2">
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    statusFilter === 'all'
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t('kundenTickets.filterAllStatuses')}
                </button>
                {STATUS_ORDER.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      statusFilter === status
                        ? STATUS_PILL_CLASSES[status]
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[status]}`} aria-hidden />
                    {t(`kundenTickets.status.${status}`)}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('kundenTickets.filterDevicePlaceholder') as string}
                className="w-full rounded-theme border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <div className="max-h-[calc(88vh-220px)] space-y-2 overflow-y-auto pr-1">
              {filteredTickets.length === 0 ? (
                <p className="rounded-theme border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                  {t('kundenTickets.empty')}
                </p>
              ) : (
                filteredTickets.map((ticket) => {
                  const isActive = selectedTicket?.id === ticket.id;
                  const authorName = ticket.author?.displayName || ticket.author?.email || '';
                  return (
                    <button
                      key={ticket.id}
                      type="button"
                      onClick={() => setSelectedTicketId(ticket.id)}
                      className={`w-full rounded-theme border p-3 text-left transition-all duration-200 ${
                        isActive
                          ? 'border-primary bg-primary/10 shadow-theme-sm'
                          : 'border-border bg-background hover:border-border/80 hover:bg-muted/70 hover:shadow-theme-sm'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-xs text-muted-foreground" title={ticket.deviceId}>
                          {ticket.stovePassport?.stoveSerial || ticket.deviceId}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_PILL_CLASSES[ticket.status]}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASSES[ticket.status]}`} aria-hidden />
                          {t(`kundenTickets.status.${ticket.status}`)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-foreground">{ticket.customerQuestion || '-'}</p>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>{formatRelative(ticket.createdAt, t)}</span>
                        {authorName && <span className="truncate">{authorName}</span>}
                        {ticket.notes && ticket.notes.length > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            {ticket.notes.length}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-5">
            {selectedTicket ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(selectedTicket.deviceId)}
                        className="inline-flex items-center gap-1 rounded-theme border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted"
                        title={t('kundenTickets.actions.copyDeviceId') as string}
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        <span className="max-w-[240px] truncate">{selectedTicket.deviceId}</span>
                        {copiedId === selectedTicket.deviceId && (
                          <span className="ml-1 text-success">{t('kundenTickets.actions.copied')}</span>
                        )}
                      </button>
                    </div>
                    <h3 className="mt-1 text-lg font-semibold text-foreground">
                      {selectedTicket.stovePassport.modelName}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {formatTicketDate(selectedTicket.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openInDealerMode(selectedTicket.deviceId)}
                      className="inline-flex items-center gap-1 rounded-theme border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 8v4l3 2" />
                      </svg>
                      {t('kundenTickets.actions.openInDealer')}
                    </button>
                    <button
                      type="button"
                      onClick={() => openInClassic(selectedTicket.deviceId)}
                      className="inline-flex items-center gap-1 rounded-theme border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      {t('kundenTickets.actions.openInClassic')}
                    </button>
                    {selectedTicket.author?.email && (
                      <a
                        href={`mailto:${selectedTicket.author.email}?subject=${encodeURIComponent(
                          `[HASE] Ticket ${selectedTicket.stovePassport.stoveSerial}`,
                        )}`}
                        className="inline-flex items-center gap-1 rounded-theme border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {t('kundenTickets.actions.mailAuthor')}
                      </a>
                    )}
                    <select
                      value={selectedTicket.status}
                      onChange={(event) =>
                        updateKundenTicketStatus(selectedTicket.id, event.target.value as KundenTicketStatus)
                      }
                      className={`rounded-theme border px-3 py-1.5 text-xs font-medium ${STATUS_PILL_CLASSES[selectedTicket.status]}`}
                    >
                      {STATUS_ORDER.map((status) => (
                        <option key={status} value={status}>
                          {t(`kundenTickets.status.${status}`)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      className="inline-flex items-center gap-1 rounded-theme border border-destructive/40 bg-destructive/5 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/15"
                      title={t('kundenTickets.delete.button') as string}
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      {t('kundenTickets.delete.button')}
                    </button>
                  </div>
                </div>

                {/* Live device snapshot — passive read on open, with optional active ping. */}
                <KundenTicketsLiveSnapshot
                  deviceId={selectedTicket.deviceId}
                  isAlreadyResolved={selectedTicket.status === 'resolved'}
                  onMarkResolved={() => updateKundenTicketStatus(selectedTicket.id, 'resolved')}
                />

                <NotesThread notes={selectedTicket.notes ?? []} onAdd={handleAddNote} />

                <section className="rounded-theme border border-border bg-muted/20 p-4">
                  <h4 className="text-sm font-semibold text-foreground">{t('kundenTickets.sections.passport')}</h4>
                  <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Ofen-SN</dt>
                    <dd className="font-mono text-foreground">{selectedTicket.stovePassport.stoveSerial}</dd>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Controller-SN</dt>
                    <dd className="font-mono text-foreground">{selectedTicket.stovePassport.controllerSerial}</dd>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Aktuell</dt>
                    <dd className="font-mono text-foreground">
                      {selectedTicket.stovePassport.currentControllerSerial}
                      {selectedTicket.stovePassport.currentControllerSerial &&
                        selectedTicket.stovePassport.currentControllerSerial !== 'Unbekannt' &&
                        selectedTicket.stovePassport.currentControllerSerial !==
                          selectedTicket.stovePassport.controllerSerial && (
                          <span className="ml-2 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
                            getauscht
                          </span>
                        )}
                    </dd>
                  </dl>
                </section>

                <section className="rounded-theme border border-border bg-muted/20 p-4">
                  <h4 className="text-sm font-semibold text-foreground">{t('kundenTickets.sections.status')}</h4>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        selectedTicket.statusSnapshot.health === 'good'
                          ? 'border-info/40 bg-info/15 text-info'
                          : 'border-destructive/40 bg-destructive/15 text-destructive'
                      }`}
                    >
                      {selectedTicket.statusSnapshot.health === 'good' ? 'OK' : 'Auffällig'}
                    </span>
                    <p className="text-sm font-medium text-foreground">{selectedTicket.statusSnapshot.headline}</p>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {selectedTicket.statusSnapshot.details}
                  </p>
                </section>

                <section className="rounded-theme border border-border bg-muted/20 p-4">
                  <h4 className="text-sm font-semibold text-foreground">{t('kundenTickets.sections.customerQuestion')}</h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {selectedTicket.customerQuestion || '-'}
                  </p>
                </section>

                <section className="rounded-theme border border-border bg-muted/20 p-4">
                  <h4 className="text-sm font-semibold text-foreground">{t('kundenTickets.sections.geminiAnswer')}</h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {selectedTicket.geminiAnswer || '-'}
                  </p>
                </section>

                {(selectedTicket.author?.displayName || selectedTicket.author?.email) && (
                  <section className="rounded-theme border border-border bg-muted/20 p-4 text-sm">
                    <h4 className="text-sm font-semibold text-foreground">
                      {t('kundenTickets.sections.author')}
                    </h4>
                    <p className="mt-1 text-muted-foreground">
                      {selectedTicket.author?.displayName || selectedTicket.author?.email}
                      {selectedTicket.author?.displayName && selectedTicket.author?.email && (
                        <span className="ml-1 text-xs">({selectedTicket.author.email})</span>
                      )}
                      {selectedTicket.author?.role && (
                        <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {selectedTicket.author.role}
                        </span>
                      )}
                    </p>
                  </section>
                )}

                <details className="rounded-theme border border-border bg-muted/20 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-foreground">
                    {t('kundenTickets.sections.pageSummary')}
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                    {selectedTicket.pageSummary}
                  </pre>
                </details>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('kundenTickets.empty')}</p>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default KundenTicketsInbox;
