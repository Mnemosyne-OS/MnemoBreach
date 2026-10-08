/**
 * IdentifierForm — the person declares one of their own identifiers.
 *
 * Lives at the bottom of the identifiers tile (AccountCard), under the list it
 * feeds. A refused identifier says why; a failed save is said, and the list
 * stays what it was (never the one the screen wanted).
 */
import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/useI18n';
import { addIdentifier, MAX_PER_KIND } from '../lib/profile';
import { getProfileSnapshot, updateProfile } from '../lib/profileStore';

export function IdentifierForm() {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const r = addIdentifier(getProfileSnapshot().profile, draft);
    if (!r.ok) {
      setMessage(t(`profile.errors.${r.code}`, { max: MAX_PER_KIND }));
      return;
    }
    setMessage(null);
    const value = draft;
    setBusy(true);
    // Applied again to the profile as it is at write time; the check above
    // only chose the message.
    const ok = await updateProfile((cur) => { const again = addIdentifier(cur, value); return again.ok ? again.profile : cur; });
    setBusy(false);
    if (ok) setDraft('');
    else setMessage(t('profile.saveError'));
  }

  return (
    <>
      <form className="bw-row bw-add" onSubmit={(e) => { void onAdd(e); }}>
        <input
          className="bw-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('profile.placeholder')}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="bw-btn" disabled={busy || !draft.trim()}>{t('profile.add')}</button>
      </form>
      {message && <p className="bw-error" role="alert">{message}</p>}
    </>
  );
}
