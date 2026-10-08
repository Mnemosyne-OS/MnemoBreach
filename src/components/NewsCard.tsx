/**
 * NewsCard — what is new since your last visit, and the opt-in background
 * watch of the services on your timeline (doc 141 lot 4).
 *
 * - The diff is local and silent; the first visit only remembers.
 * - The watch is asked for by a gesture, with its price said first: HIBP sees
 *   which services are watched, never an email. Turning it off unregisters it.
 * - When the timeline's services change, the watch is re-registered (only when
 *   the set changes, never on every render).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { TileHead } from './TileHead';
import { useCatalogue } from '../lib/catalogueStore';
import { declare } from '../lib/findings';
import { diffCatalogue, knownNames, watchPlan, WATCH_INTERVAL_MIN } from '../lib/news';
import { updateProfile, useProfile } from '../lib/profileStore';
import { clearInbox, readInbox, registerWatch, unregisterWatch, type WatchItem, type WatchStatus } from '../lib/watch';
import { codeOf } from '../lib/account';
import { formatBreachDay, formatInstant } from '../lib/format';
import type { Breach } from '../lib/breaches';

const SHOW_OTHERS = 20;
/** One empty list for every render, so the memos below do not recompute. */
const NO_BREACHES: Breach[] = [];

type Inbox = { kind: 'idle' } | { kind: 'error'; code: string } | { kind: 'ok'; items: WatchItem[]; status: WatchStatus | null };

export function NewsCard() {
  const { t, lang } = useI18n();
  const cat = useCatalogue();
  const snap = useProfile();
  const { profile } = snap;
  const [showOthers, setShowOthers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [inbox, setInbox] = useState<Inbox>({ kind: 'idle' });
  // The first visit stays a first visit for the whole session: once the list
  // is remembered the diff reads "nothing new since your last visit, a second
  // ago", a last visit that was this one.
  const [firstVisit, setFirstVisit] = useState(false);

  const ready = snap.status === 'ready' && cat.kind === 'ok';
  const breaches = cat.kind === 'ok' ? cat.breaches : NO_BREACHES;
  const byName = useMemo(() => new Map(breaches.map((b) => [b.name, b])), [breaches]);
  const diff = useMemo(() => diffCatalogue(profile.knownBreaches, breaches, profile.findings), [profile.knownBreaches, breaches, profile.findings]);
  const plan = useMemo(() => watchPlan(profile.findings), [profile.findings]);

  // First visit: remember the list, announce nothing.
  useEffect(() => {
    if (!ready || !diff.first) return;
    const names = knownNames(breaches);
    const at = new Date().toISOString();
    setFirstVisit(true);
    void updateProfile((cur) => ({ ...cur, knownBreaches: names, knownAt: at })).then((ok) => {
      // Said, not swallowed: unsaved, every open would be a "first visit"
      // again and no new breach would ever be shown.
      if (!ok) setMessage(t('profile.saveError'));
    });
  }, [ready, diff.first, breaches, t]);

  const refreshInbox = useCallback(async () => {
    try {
      setInbox({ kind: 'ok', ...(await readInbox()) });
    } catch (err) {
      setInbox({ kind: 'error', code: codeOf(err) });
    }
  }, []);

  // The watch was turned on in an earlier session: read what it found, and
  // re-register only if the services on the timeline changed since.
  useEffect(() => {
    if (snap.status !== 'ready' || !profile.watchOn) return;
    void refreshInbox();
    if (plan.signature === profile.watchSig) return;
    // 🚨 The timeline emptied: stop sending HIBP services the person removed.
    // Keeping the old registration would ask about them every day, forever.
    const sync = plan.targets.length > 0 ? registerWatch(plan, WATCH_INTERVAL_MIN) : unregisterWatch();
    sync
      .then(() => updateProfile((cur) => ({ ...cur, watchSig: plan.signature })))
      .catch((err: unknown) => setMessage(t(`account.errors.${codeOf(err)}`)));
  }, [snap.status, profile.watchOn, profile.watchSig, plan, refreshInbox, t]);

  async function markSeen() {
    const names = knownNames(breaches);
    const at = new Date().toISOString();
    const ok = await updateProfile((cur) => ({ ...cur, knownBreaches: names, knownAt: at }));
    setMessage(ok ? null : t('profile.saveError'));
  }

  async function addToTimeline(b: Breach) {
    const at = new Date().toISOString();
    const ok = await updateProfile((cur) => ({ ...cur, findings: declare(cur.findings, b, at) }));
    setMessage(ok ? null : t('profile.saveError'));
  }

  async function turnOn() {
    setBusy(true);
    try {
      await registerWatch(plan, WATCH_INTERVAL_MIN);
      await updateProfile((cur) => ({ ...cur, watchOn: true, watchSig: plan.signature }));
      setMessage(null);
    } catch (err) {
      setMessage(t(`account.errors.${codeOf(err)}`));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      await unregisterWatch();
      await updateProfile((cur) => ({ ...cur, watchOn: false, watchSig: '' }));
      setInbox({ kind: 'idle' });
      setMessage(null);
    } catch (err) {
      setMessage(t(`account.errors.${codeOf(err)}`));
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(ids: string[]) {
    try {
      await clearInbox(ids);
      await refreshInbox();
    } catch (err) {
      setMessage(t(`account.errors.${codeOf(err)}`));
    }
  }

  if (snap.status !== 'ready') return null;

  const row = (b: Breach) => {
    const on = !!profile.findings[b.name];
    return (
      <li key={b.name} className="bw-news-row">
        <span className="bw-breach-title">{b.title}</span>
        <span className="bw-breach-date">{formatBreachDay(b.breachDate, lang)}</span>
        {on
          ? <span className="bw-muted bw-small">{t('catalogue.onTimeline')}</span>
          : <button type="button" className="bw-link" onClick={() => { void addToTimeline(b); }}>{t('catalogue.declare')}</button>}
      </li>
    );
  };

  const items = inbox.kind === 'ok' ? inbox.items : [];
  const status = inbox.kind === 'ok' ? inbox.status : null;

  return (
    <section className="bw-card bw-tile is-news">
      <TileHead icon="bell" title={t('news.title')} />

      {cat.kind === 'loading' && <p className="bw-muted">{t('catalogue.loading')}</p>}
      {cat.kind === 'error' && <p className="bw-error">{t('news.noCatalogue')}</p>}
      {ready && (diff.first || firstVisit) && <p className="bw-muted">{t('news.first')}</p>}
      {ready && !diff.first && !firstVisit && (
        <>
          <p className="bw-muted bw-small">
            {profile.knownAt ? t('news.since', { when: formatInstant(profile.knownAt, lang) }) : t('news.sinceUnknown')}
          </p>
          {diff.mine.length + diff.others.length === 0 ? (
            <p className="bw-muted">{t('news.none')}</p>
          ) : (
            <>
              {diff.mine.length > 0 && (
                <div className="bw-cross">
                  <p>{t('news.mine', { count: diff.mine.length })}</p>
                  <ul className="bw-news">{diff.mine.map(row)}</ul>
                </div>
              )}
              {diff.others.length > 0 && (
                <>
                  <button type="button" className="bw-link" onClick={() => setShowOthers(!showOthers)} aria-expanded={showOthers}>
                    {t('news.others', { count: diff.others.length })}
                  </button>
                  {showOthers && (
                    <ul className="bw-news">
                      {diff.others.slice(0, SHOW_OTHERS).map(row)}
                      {diff.others.length > SHOW_OTHERS && <li className="bw-muted bw-small">{t('news.more', { count: diff.others.length - SHOW_OTHERS })}</li>}
                    </ul>
                  )}
                </>
              )}
              <div className="bw-row">
                <button type="button" className="bw-btn" onClick={() => { void markSeen(); }}>{t('news.markSeen')}</button>
              </div>
            </>
          )}
        </>
      )}

      <h3 className="bw-subtitle">{t('news.watchTitle')}</h3>
      {plan.targets.length === 0 && !profile.watchOn ? (
        <p className="bw-muted bw-small">{t('news.watchNothing')}</p>
      ) : !profile.watchOn ? (
        <>
          <p className="bw-hint">{t('news.watchPrice', { count: plan.targets.length })}</p>
          <button type="button" className="bw-btn" disabled={busy} onClick={() => { void turnOn(); }}>{t('news.watchOn')}</button>
        </>
      ) : (
        <>
          <p className="bw-muted bw-small">
            {t('news.watchActive', { count: plan.targets.length })}
            {' · '}
            {status?.lastError
              ? t('news.watchError', { code: status.lastError })
              : status?.lastRunAt ? t('news.watchLastRun', { when: formatInstant(status.lastRunAt, lang) }) : t('news.watchNotYet')}
          </p>
          {plan.targets.length === 0 && <p className="bw-muted bw-small">{t('news.watchEmpty')}</p>}
          {plan.skipped > 0 && <p className="bw-muted bw-small">{t('news.watchSkipped', { count: plan.skipped })}</p>}
          <p className="bw-muted bw-small">{t('news.watchOnlyOpen')}</p>
          {inbox.kind === 'error' && <p className="bw-error">{t(`account.errors.${inbox.code}`)}</p>}
          {items.length > 0 && (
            <>
              <p>{t('news.inbox', { count: items.length })}</p>
              <ul className="bw-news">
                {items.map((it) => {
                  const b = byName.get(it.id);
                  return b ? row(b) : (
                    <li key={it.id} className="bw-news-row">
                      <span className="bw-breach-title">{it.label ?? it.id}</span>
                      <span className="bw-breach-date">{formatInstant(it.at, lang)}</span>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="bw-link" onClick={() => { void dismiss(items.map((i) => i.id)); }}>{t('news.inboxSeen')}</button>
            </>
          )}
          <div className="bw-row">
            <button type="button" className="bw-link" disabled={busy} onClick={() => { void turnOff(); }}>{t('news.watchOff')}</button>
          </div>
        </>
      )}
      {message && <p className="bw-error" role="alert">{message}</p>}
    </section>
  );
}
