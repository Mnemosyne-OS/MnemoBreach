/**
 * AccountCard — the person's identifiers and the search of their OWN emails
 * in known breaches (doc 141 lot 2), in one tile: each email carries its own
 * Search button, so the list is declared and searched in the same place.
 *
 * - Two sources (§20): with no key, the free XposedOrNot, called from the
 *   iframe; with the person's own HIBP key, the host door. The screen names the
 *   one that will answer BEFORE the search, because that is where the email goes.
 * - Nothing calls the host before the person asks for the key door: every host
 *   permission is asked at its first call, and opening a window must not raise
 *   a dialog by itself. The free search needs no host at all.
 * - The key is typed once (`type=password`), sent to the host, the field is
 *   cleared, and no action can return it.
 * - Searches start from the profile only. On the HIBP door the host refuses
 *   anything else; on the free one only the screen holds it (no host to ask).
 * - The free manual route stays offered: HIBP's own site, and its free alert.
 * - "Remember" is a gesture, one chronicle per email, replaced on the next one.
 * - Phone numbers are listed as not searchable yet: the API format for a phone
 *   has never been seen answering, so nothing is sent for them.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/useI18n';
import { TileHead } from './TileHead';
import { lookup, readKeyState, removeKey, saveKey, codeOf, type AccountResult, type KeyState } from '../lib/account';
import { lookupXon, XON_HOME } from '../lib/xon';
import { HIBP_KEY_PAGE, HIBP_NOTIFY_PAGE, HIBP_SEARCH_PAGE, openLink } from '../lib/links';
import { useCatalogue } from '../lib/catalogueStore';
import { chronicleText, forgetAll, remember } from '../lib/memory';
import { maskEmail, maskPhone } from '../lib/mask';
import { removeIdentifier } from '../lib/profile';
import { getProfileSnapshot, updateProfile, useProfile } from '../lib/profileStore';
import { severityOf } from '../lib/breaches';
import { formatBreachDay, formatInstant } from '../lib/format';
import { Reveal } from './Reveal';
import { IdentifierForm } from './IdentifierForm';
import { mergeFound } from '../lib/findings';

type KeyLoad = { kind: 'closed' } | { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; state: KeyState };

interface Row {
  busy: boolean;
  result: AccountResult | null;
  memory: { phase: 'idle' | 'writing' | 'done' | 'error'; unlocked?: boolean; vault?: string; code?: string };
}

const EMPTY_ROW: Row = { busy: false, result: null, memory: { phase: 'idle' } };

export function AccountCard() {
  const { t, lang } = useI18n();
  const snap = useProfile();
  const { profile } = snap;
  const [key, setKey] = useState<KeyLoad>({ kind: 'closed' });
  const [draft, setDraft] = useState('');
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [forgotMsg, setForgotMsg] = useState<string | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);
  const [listMsg, setListMsg] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const cat = useCatalogue();
  /** The paid door answers only once the key is known to be there. */
  const viaKey = key.kind === 'ok' && key.state.present;

  /** True when the host answered: the permission was granted. */
  const loadKey = useCallback(async (): Promise<boolean> => {
    setKey({ kind: 'loading' });
    try {
      setKey({ kind: 'ok', state: await readKeyState() });
      return true;
    } catch (err) {
      const code = codeOf(err);
      console.warn('[breach] key state refused:', code);
      setKey({ kind: 'error', code });
      return false;
    }
  }, []);

  // Re-open the door on later sessions only: the permission was granted then.
  useEffect(() => {
    if (snap.status === 'ready' && profile.doorOpened && key.kind === 'closed') void loadKey();
  }, [snap.status, profile.doorOpened, key.kind, loadKey]);

  async function openDoor() {
    // 🚨 Remembered only when the host ANSWERED. A refused permission is not
    // stored by the gateway, so remembering the door after a "Deny" raised the
    // dialog at every later opening, for someone who had said no.
    const granted = await loadKey();
    if (granted && !getProfileSnapshot().profile.doorOpened) await updateProfile((cur) => ({ ...cur, doorOpened: true }));
  }

  async function onSaveKey(e: FormEvent) {
    e.preventDefault();
    const value = draft;
    setDraft('');
    setKeyMsg(null);
    try {
      const saved = await saveKey(value);
      setKey({ kind: 'ok', state: saved.state });
      if (saved.warning) setKeyMsg(t('account.keyWarning'));
    } catch (err) {
      setKeyMsg(t(`account.errors.${codeOf(err)}`));
    }
  }

  async function onRemoveKey() {
    try {
      setKey({ kind: 'ok', state: await removeKey() });
    } catch (err) {
      setKeyMsg(t(`account.errors.${codeOf(err)}`));
    }
  }

  const patch = (email: string, next: Partial<Row>) =>
    setRows((r) => ({ ...r, [email]: { ...(r[email] ?? EMPTY_ROW), ...next } }));

  async function onSearch(email: string) {
    patch(email, { busy: true, result: null, memory: { phase: 'idle' } });
    // The HIBP door when the person's key is there; otherwise the free one,
    // which reuses the public catalogue to give HIBP's precise entries back.
    const result = viaKey ? await lookup(email) : await lookupXon(email, { catalogue: cat.kind === 'ok' ? cat.breaches : [] });
    patch(email, { busy: false, result });
    // A found result goes on the timeline: this machine's state, not a vault.
    if (result.kind === 'found' && result.breaches.length > 0) {
      // Re-checked at write time: an email removed while its search was in
      // flight must not land on the timeline.
      const ok = await updateProfile((cur) => (cur.emails.includes(email)
        ? { ...cur, findings: mergeFound(cur.findings, email, result.breaches, result.checkedAt) }
        : cur));
      if (!ok) setKeyMsg(t('profile.saveError'));
    }
  }

  async function onRemember(email: string, result: AccountResult) {
    const text = chronicleText(email, result);
    if (!text) return;
    patch(email, { memory: { phase: 'writing' } });
    try {
      // Read the profile at each step, never the render's copy: two searches
      // remembered in a row would otherwise overwrite each other's id.
      const done = await remember(text, getProfileSnapshot().profile.memory[email] ?? null);
      const ok = await updateProfile((cur) => ({ ...cur, memory: { ...cur.memory, [email]: done.id } }));
      patch(email, { memory: ok ? { phase: 'done', unlocked: done.unlocked, vault: done.vault } : { phase: 'error', code: 'FAILED' } });
    } catch (err) {
      patch(email, { memory: { phase: 'error', code: codeOf(err) } });
    }
  }

  async function onForgetAll() {
    const ids = Object.values(getProfileSnapshot().profile.memory);
    try {
      const forgotten = await forgetAll(ids);
      // Only now: a refused forget keeps the ids, so it can be tried again.
      await updateProfile((cur) => ({ ...cur, memory: {} }));
      setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, memory: { phase: 'idle' as const } }])));
      setKeyMsg(null);
      setForgotMsg(forgotten === null ? t('account.forgottenUnknown') : t('account.forgotten', { count: forgotten }));
    } catch (err) {
      console.warn('[breach] forget refused:', codeOf(err));
      setForgotMsg(null);
      setKeyMsg(t('account.errors.FORGET_FAILED'));
    }
  }

  async function onRemove(value: string) {
    setRemoving(value);
    const ok = await updateProfile((cur) => removeIdentifier(cur, value));
    setRemoving(null);
    setListMsg(ok ? null : t('profile.saveError'));
  }

  async function open(url: string) {
    setLinkFailed(!(await openLink(url)));
  }

  const errorText = (code: string) => {
    const known = t(`account.errors.${code}`);
    return known === `account.errors.${code}` ? t('account.errors.FAILED') : known;
  };

  const removeButton = (value: string) => (
    <button
      type="button"
      className="bw-link bw-push"
      disabled={removing !== null}
      onClick={() => { void onRemove(value); }}
    >
      {t('profile.remove')}
    </button>
  );

  return (
    <>
      <section className="bw-card bw-tile is-search">
        <TileHead icon="person" title={t('profile.title')} hint={t('profile.hint')} />
        {snap.status === 'loading' && <p className="bw-muted">{t('profile.loading')}</p>}
        {snap.status === 'error' && <p className="bw-error">{t('profile.loadError')}</p>}
        {snap.status === 'ready' && (
          <>
            <p className="bw-source">{viaKey ? t('account.leaves') : t('account.leavesXon')}</p>
            {viaKey && <p className="bw-muted bw-small">{t('account.sensitiveNote')}</p>}

            {profile.emails.length + profile.phones.length === 0 && <p className="bw-muted">{t('profile.empty')}</p>}
            <ul className="bw-accounts">
              {profile.emails.map((email) => {
                const row = rows[email] ?? EMPTY_ROW;
                const res = row.result;
                return (
                  <li key={email} className="bw-account">
                    <div className="bw-row">
                      <Reveal value={email} masked={maskEmail(email)} />
                      <button
                        type="button"
                        className="bw-btn"
                        disabled={row.busy || key.kind === 'loading'}
                        onClick={() => { void onSearch(email); }}
                      >
                        {row.busy ? t('account.searching') : t('account.search')}
                      </button>
                      {removeButton(email)}
                    </div>
                    {res?.kind === 'found' && (
                      <>
                        <p className="bw-verdict is-bad">{t('account.found', { count: res.breaches.length, when: formatInstant(res.checkedAt, lang) })}</p>
                        <ul className="bw-breaches">
                          {res.breaches.map((b) => (
                            <li key={b.name} className="bw-hit">
                              <span className={`bw-dot sev-${severityOf(b.dataClasses)}`} />
                              <span className="bw-breach-title">{b.title}</span>
                              <span className="bw-breach-date">{formatBreachDay(b.breachDate, lang, b.datePrecision)}</span>
                              <span className="bw-muted bw-small bw-hit-leaked">
                                {(b.fabricated || b.spamList) && <span className="bw-flag-tag">{b.fabricated ? t('catalogue.fabricated') : t('catalogue.spamList')}</span>}
                                {b.dataClasses.join(', ')}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {res?.kind === 'absent' && (
                      <p className="bw-verdict is-neutral">{t('account.absent', { when: formatInstant(res.checkedAt, lang) })}</p>
                    )}
                    {res && res.kind !== 'error' && res.via === 'xon' && (
                      <p className="bw-muted bw-small">
                        {t('account.attributionXon')}{' '}
                        <button type="button" className="bw-link" onClick={() => { void open(XON_HOME); }}>xposedornot.com</button>
                      </p>
                    )}
                    {res?.kind === 'error' && (
                      <p className="bw-error" role="alert">
                        {res.retryAfterSec !== undefined ? t('account.errors.RATE_LIMITED_WAIT', { count: res.retryAfterSec }) : errorText(res.code)}
                      </p>
                    )}
                    {res && res.kind !== 'error' && (
                      <div className="bw-row bw-small">
                        <button
                          type="button"
                          className="bw-link"
                          disabled={row.memory.phase === 'writing'}
                          onClick={() => { void onRemember(email, res); }}
                        >
                          {row.memory.phase === 'writing' ? t('account.remembering') : t('account.remember')}
                        </button>
                        {row.memory.phase === 'done' && (
                          <span className="bw-muted">{row.memory.unlocked ? t('account.remembered') : t('account.rememberedWalled')}</span>
                        )}
                        {row.memory.phase === 'error' && <span className="bw-error">{errorText(row.memory.code ?? 'FAILED')}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
              {profile.phones.map((phone) => (
                <li key={phone} className="bw-account">
                  <div className="bw-row">
                    <Reveal value={phone} masked={maskPhone(phone)} />
                    {removeButton(phone)}
                  </div>
                </li>
              ))}
            </ul>
            {profile.phones.length > 0 && <p className="bw-muted bw-small">{t('account.phonesLater')}</p>}
            {listMsg && <p className="bw-error" role="alert">{listMsg}</p>}
            <IdentifierForm />
            {forgotMsg && <p className="bw-muted bw-small" role="status">{forgotMsg}</p>}
            {Object.keys(profile.memory).length > 0 && (
              <button type="button" className="bw-link" onClick={() => { void onForgetAll(); }}>
                {t('account.forgetAll', { count: Object.keys(profile.memory).length })}
              </button>
            )}
          </>
        )}
      </section>

      {snap.status === 'ready' && (
        <section className="bw-card bw-tile is-options">
          <div className="bw-sub">
            <TileHead icon="key" level={3} title={t('account.keyTitle')} />
            {key.kind === 'closed' && (
              <>
                <p className="bw-muted bw-small">{t('account.keyWhy')}</p>
                <button type="button" className="bw-btn" onClick={() => { void openDoor(); }}>{t('account.open')}</button>
              </>
            )}
            {key.kind === 'loading' && <p className="bw-muted">{t('account.keyLoading')}</p>}
            {key.kind === 'error' && (
              <div className="bw-row">
                <p className="bw-error">{errorText(key.code)}</p>
                <button type="button" className="bw-btn" onClick={() => { void loadKey(); }}>{t('catalogue.retry')}</button>
              </div>
            )}
            {key.kind === 'ok' && !key.state.present && (
              <form className="bw-row" onSubmit={(e) => { void onSaveKey(e); }}>
                <input
                  className="bw-input"
                  type="password"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('account.keyPlaceholder')}
                  autoComplete="off"
                />
                <button type="submit" className="bw-btn" disabled={!draft.trim()}>{t('account.keySave')}</button>
                <p className="bw-muted bw-small bw-full">{t('account.keyWhere')}</p>
              </form>
            )}
            {key.kind === 'ok' && key.state.present && (
              <div className="bw-row bw-small">
                <span className="bw-muted">
                  {key.state.savedAt === null ? t('account.keySaved') : t('account.keySavedAt', { when: formatInstant(new Date(key.state.savedAt).toISOString(), lang) })}
                  {key.state.seal === 'plaintext' && ` ${t('account.keyPlaintext')}`}
                </span>
                <button type="button" className="bw-link" onClick={() => { void onRemoveKey(); }}>{t('account.keyRemove')}</button>
              </div>
            )}
            {!viaKey && (
              <div className="bw-pills">
                <button type="button" className="bw-pill" onClick={() => { void open(HIBP_KEY_PAGE); }}>
                  {t('account.keyGet')}<span aria-hidden="true"> ↗</span>
                </button>
              </div>
            )}
            {keyMsg && <p className="bw-error" role="alert">{keyMsg}</p>}
          </div>

          <div className="bw-sub">
            <TileHead icon="external" level={3} title={t('account.manualTitle')} hint={t('account.manualHint')} />
            <div className="bw-pills">
              <button type="button" className="bw-pill" onClick={() => { void open(HIBP_SEARCH_PAGE); }}>{t('account.manualSearch')}<span aria-hidden="true"> ↗</span></button>
              <button type="button" className="bw-pill" onClick={() => { void open(HIBP_NOTIFY_PAGE); }}>{t('account.manualNotify')}<span aria-hidden="true"> ↗</span></button>
            </div>
            {linkFailed && <p className="bw-error" role="alert">{t('account.linkFailed')}</p>}
          </div>
        </section>
      )}
    </>
  );
}
