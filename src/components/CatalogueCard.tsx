/**
 * CatalogueCard — every public breach, most recent first, with year headers.
 *
 * Read once per session (the answer is public and cached for a month by HIBP).
 * Fake-data and spam-list entries are listed apart, never mixed with real
 * breaches (doc 141 §6). The description is plain text: no third-party markup.
 */
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { TileHead } from './TileHead';
import { searchBreaches, severityOf, splitFlagged, yearOf, type Breach } from '../lib/breaches';
import { loadCatalogue, useCatalogue } from '../lib/catalogueStore';
import { formatBreachDay, formatDay, formatInstant } from '../lib/format';
import { declare } from '../lib/findings';
import { updateProfile, useProfile } from '../lib/profileStore';

const PAGE = 60;

function BreachRow({ breach, open, onToggle }: { breach: Breach; open: boolean; onToggle: () => void }) {
  const { t, lang } = useI18n();
  const snap = useProfile();
  const onTimeline = !!snap.profile.findings[breach.name];
  const [saveFailed, setSaveFailed] = useState(false);

  async function onDeclare() {
    const at = new Date().toISOString();
    setSaveFailed(!(await updateProfile((cur) => ({ ...cur, findings: declare(cur.findings, breach, at) }))));
  }
  const severity = severityOf(breach.dataClasses);
  return (
    <li className={`bw-breach${open ? ' is-open' : ''}`}>
      <button type="button" className="bw-breach-head" onClick={onToggle} aria-expanded={open}>
        <span className={`bw-dot sev-${severity}`} title={t(`severity.${severity}`)} />
        <span className="bw-breach-title">{breach.title}</span>
        <span className="bw-breach-domain">{breach.domain}</span>
        <span className="bw-breach-date">{formatBreachDay(breach.breachDate, lang)}</span>
      </button>
      {open && (
        <div className="bw-breach-body">
          <dl>
            <dt>{t('catalogue.breachDate')}</dt><dd>{formatBreachDay(breach.breachDate, lang)}</dd>
            <dt>{t('catalogue.addedDate')}</dt><dd>{formatDay(breach.addedDate, lang)}</dd>
            <dt>{t('catalogue.accounts')}</dt>
            <dd>{breach.pwnCount === null ? t('catalogue.unknown') : breach.pwnCount.toLocaleString(lang)}</dd>
            <dt>{t('catalogue.leaked')}</dt>
            <dd>{breach.dataClasses.length ? breach.dataClasses.join(', ') : t('catalogue.unknown')}</dd>
          </dl>
          {(breach.fabricated || breach.spamList) && (
            <p className="bw-flag">{breach.fabricated ? t('catalogue.fabricated') : t('catalogue.spamList')}</p>
          )}
          {breach.description && <p className="bw-desc">{breach.description}</p>}
          {snap.status === 'ready' && (
            onTimeline
              ? <p className="bw-muted bw-small">{t('catalogue.onTimeline')}</p>
              : <button type="button" className="bw-link" onClick={() => { void onDeclare(); }}>{t('catalogue.declare')}</button>
          )}
          {saveFailed && <p className="bw-error">{t('profile.saveError')}</p>}
        </div>
      )}
    </li>
  );
}

export function CatalogueCard() {
  const { t, lang } = useI18n();
  const load = useCatalogue();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [openName, setOpenName] = useState<string | null>(null);

  useEffect(() => { void loadCatalogue(); }, []);

  const { real, flagged } = useMemo(
    () => splitFlagged(load.kind === 'ok' ? searchBreaches(load.breaches, query) : []),
    [load, query],
  );

  const shown = real.slice(0, limit);
  const total = load.kind === 'ok' ? load.breaches.length : 0;

  return (
    <section className="bw-card bw-tile is-catalogue">
      <TileHead icon="book" title={t('catalogue.title')} />

      {load.kind === 'loading' && <p className="bw-muted">{t('catalogue.loading')}</p>}
      {load.kind === 'error' && (
        <div className="bw-row">
          <p className="bw-error">{t('catalogue.error')} {t(`catalogue.errors.${load.code}`)}</p>
          <button type="button" className="bw-btn" onClick={() => { void loadCatalogue(true); }}>{t('catalogue.retry')}</button>
        </div>
      )}
      {load.kind === 'ok' && (
        <>
          <input
            className="bw-input"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
            placeholder={t('catalogue.search')}
            spellCheck={false}
          />
          <p className="bw-muted bw-small">
            {t('catalogue.count', { shown: real.length.toLocaleString(lang), total: total.toLocaleString(lang) })}
            {' · '}
            {t('catalogue.readAt', { when: formatInstant(load.fetchedAt, lang) })}
          </p>
          <div className="bw-legend">
            {(['password', 'sensitive', 'contact', 'other', 'email'] as const).map((s) => (
              <span key={s}><span className={`bw-dot sev-${s}`} />{t(`severity.${s}`)}</span>
            ))}
          </div>

          {real.length === 0 && flagged.length === 0 && <p className="bw-muted">{t('catalogue.none')}</p>}

          <ul className="bw-breaches">
            {shown.map((b, i) => {
              const year = yearOf(b);
              const prev = i > 0 ? yearOf(shown[i - 1]!) : undefined;
              return (
                <li key={b.name} className="bw-year-group">
                  {year !== prev && <h3 className="bw-year">{year ?? t('catalogue.undated')}</h3>}
                  <ul>
                    <BreachRow
                      breach={b}
                      open={openName === b.name}
                      onToggle={() => setOpenName(openName === b.name ? null : b.name)}
                    />
                  </ul>
                </li>
              );
            })}
          </ul>
          {real.length > limit && (
            <button type="button" className="bw-btn bw-more" onClick={() => setLimit(limit + PAGE)}>{t('catalogue.more')}</button>
          )}

          {flagged.length > 0 && (
            <details className="bw-flagged">
              <summary>{t('catalogue.flaggedTitle')} ({flagged.length})</summary>
              <ul className="bw-breaches">
                {flagged.map((b) => (
                  <BreachRow
                    key={b.name}
                    breach={b}
                    open={openName === b.name}
                    onToggle={() => setOpenName(openName === b.name ? null : b.name)}
                  />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
