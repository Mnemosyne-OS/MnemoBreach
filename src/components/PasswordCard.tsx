/**
 * PasswordCard — test one password against Pwned Passwords (k-anonymity).
 *
 * The field is cleared as soon as an answer (or a failure) comes back: the
 * password lives in this component's state for the length of one request and
 * is never saved, logged or shown again. "Absent" is dated and never "safe".
 */
import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/useI18n';
import { TileHead } from './TileHead';
import { checkPassword, type PasswordCheck } from '../lib/pwned';
import { formatInstant } from '../lib/format';

export function PasswordCard() {
  const { t, lang } = useI18n();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PasswordCheck | null>(null);

  async function onCheck(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      setResult(await checkPassword(value));
    } finally {
      setValue('');
      setBusy(false);
    }
  }

  return (
    <section className="bw-card bw-tile is-password">
      <TileHead icon="lock" title={t('password.title')} hint={t('password.hint')} />
      <form className="bw-row" onSubmit={(e) => { void onCheck(e); }}>
        <input
          className="bw-input"
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('password.placeholder')}
          autoComplete="off"
        />
        <button type="submit" className="bw-btn" disabled={busy || !value}>
          {busy ? t('password.checking') : t('password.check')}
        </button>
      </form>
      {result?.kind === 'found' && (
        <p className="bw-verdict is-bad" role="status">
          {t('password.found', { count: result.count === 1 ? 1 : result.count.toLocaleString(lang) })}
        </p>
      )}
      {result?.kind === 'absent' && (
        <p className="bw-verdict is-neutral" role="status">
          {t('password.absent', { when: formatInstant(result.checkedAt, lang) })}
        </p>
      )}
      {result?.kind === 'error' && <p className="bw-error" role="alert">{t(`password.errors.${result.code}`)}</p>}
    </section>
  );
}
