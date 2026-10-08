/**
 * TimelineCard — your breaches on one axis, and what you did about them
 * (doc 141 §5-7, lot 3).
 *
 * Per row: a dot on the day of the breach (colour = worst data that leaked),
 * a diamond on the day it was made public, a ring on the day this machine
 * knew, and a check on your first action. The bar runs from the breach to that
 * action, or to today in the warning colour when nothing was done yet: the
 * gap between the theft and your reaction is the information.
 *
 * Privacy (doc 141 §8): the axis shows services and dates only, never an
 * identifier. The detail shows how many of your addresses, masked.
 * The same facts are written as text under the axis, so nothing is only a shape.
 * A crossing that names many services shows the first few and the count of the
 * rest; the full list is one press away, never dropped.
 */
import { useMemo, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { TileHead } from './TileHead';
import {
  actionsFor, crossings, isHandled, spanParts, timeline, toggleAction, undeclare, type Finding,
} from '../lib/findings';
import { updateProfile, useProfile } from '../lib/profileStore';
import { formatBreachDay, formatDay, formatInstant } from '../lib/format';
import { maskEmail } from '../lib/mask';
import { Reveal } from './Reveal';

const W = 1000;
const ROW = 30;
const TOP = 26;
/** Names shown in a crossing sentence before "and N more". */
const NAMES_SHOWN = 5;

export function TimelineCard() {
  const { t, lang } = useI18n();
  // Fixed for the life of the card: a new Date per render would recompute the
  // axis on every keystroke elsewhere on the page.
  const [now] = useState(() => new Date());
  const snap = useProfile();
  const { findings } = snap.profile;
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [allNames, setAllNames] = useState(false);

  const line = useMemo(() => timeline(findings, now), [findings, now]);
  const cross = useMemo(() => crossings(findings), [findings]);
  const all = Object.values(findings);
  const open = all.filter((f) => !isHandled(f)).length;

  const span = (days: number) => {
    const { unit, n } = spanParts(days);
    return t(`timeline.span.${unit}_${n === 1 ? 'one' : 'other'}`, { n });
  };

  async function save(change: (current: typeof findings) => typeof findings) {
    const ok = await updateProfile((cur) => ({ ...cur, findings: change(cur.findings) }));
    setMessage(ok ? null : t('profile.saveError'));
  }

  /** The first names and the count of the others, unless the list is open. */
  const names = (list: Finding[]) => {
    const titles = list.map((f) => f.title);
    if (allNames || titles.length <= NAMES_SHOWN + 1) return titles.join(', ');
    return `${titles.slice(0, NAMES_SHOWN).join(', ')} ${t('timeline.andMore', { count: titles.length - NAMES_SHOWN })}`;
  };
  const longest = Math.max(cross.multiEmail.length, cross.contactWithEmail.length);

  if (snap.status !== 'ready') return null;

  const sel: Finding | undefined = selected ? findings[selected] : undefined;
  const height = TOP + line.rows.length * ROW + 8;
  const years = line.fromYear !== null && line.toYear !== null ? line.toYear - line.fromYear + 1 : 0;
  const step = years > 16 ? 4 : years > 8 ? 2 : 1;

  return (
    <section className="bw-card bw-tile is-timeline">
      <TileHead icon="timeline" title={t('timeline.title')} />
      {all.length === 0 ? (
        <p className="bw-muted">{t('timeline.empty')}</p>
      ) : (
        <>
          <p className="bw-muted bw-small">{t('timeline.counts', { open, done: all.length - open })}</p>

          {(cross.multiEmail.length > 0 || cross.contactWithEmail.length > 0) && (
            <div className="bw-cross">
              {cross.multiEmail.length > 0 && (
                <p>{t('timeline.crossMulti', { count: cross.multiEmail.length, names: names(cross.multiEmail) })}</p>
              )}
              {cross.contactWithEmail.length > 0 && (
                <p>{t('timeline.crossContact', { count: cross.contactWithEmail.length, names: names(cross.contactWithEmail) })}</p>
              )}
              {longest > NAMES_SHOWN + 1 && (
                <button type="button" className="bw-link" aria-expanded={allNames} onClick={() => setAllNames(!allNames)}>
                  {allNames ? t('timeline.hideNames') : t('timeline.showNames', { count: longest })}
                </button>
              )}
            </div>
          )}

          {line.rows.length > 0 && (
            <>
              <div className="bw-legend">
                <span><span className="bw-dot sev-password" />{t('timeline.legend.breach')}</span>
                <span><span className="bw-mark-diamond" />{t('timeline.legend.added')}</span>
                <span><span className="bw-mark-ring" />{t('timeline.legend.seen')}</span>
                <span><span className="bw-mark-check">✓</span>{t('timeline.legend.action')}</span>
              </div>
              <div className="bw-timeline-scroll">
                <svg className="bw-timeline" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={t('timeline.title')}>
                  {Array.from({ length: years }, (_, i) => line.fromYear! + i).filter((_y, i) => i % step === 0).map((y) => {
                    const x = ((y - line.fromYear!) / years) * W;
                    return (
                      <g key={y}>
                        <line x1={x} x2={x} y1={TOP - 6} y2={height} className="bw-tl-grid" />
                        <text x={x + 3} y={12} className="bw-tl-year">{y}</text>
                      </g>
                    );
                  })}
                  {line.rows.map((r, i) => {
                    const y = TOP + i * ROW + ROW / 2;
                    const endX = r.endX * W;
                    const isSel = r.finding.name === selected;
                    return (
                      <g
                        key={r.finding.name}
                        className={`bw-tl-row${isSel ? ' is-sel' : ''}`}
                        onClick={() => setSelected(isSel ? null : r.finding.name)}
                        role="button"
                        tabIndex={0}
                        aria-label={r.finding.title}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelected(isSel ? null : r.finding.name); }}
                      >
                        <rect x={0} y={y - ROW / 2} width={W} height={ROW} className="bw-tl-hit" />
                        <line x1={r.breachX * W} x2={endX} y1={y} y2={y} className={r.actionX === null ? 'bw-tl-bar is-open' : 'bw-tl-bar is-closed'} />
                        <circle cx={r.breachX * W} cy={y} r={6} className={`bw-tl-dot sev-${r.severity}`} />
                        {r.addedX !== null && (
                          <rect x={r.addedX * W - 4} y={y - 4} width={8} height={8} transform={`rotate(45 ${r.addedX * W} ${y})`} className="bw-tl-added" />
                        )}
                        <circle cx={r.seenX * W} cy={y} r={5} className="bw-tl-seen" />
                        {r.actionX !== null && <text x={r.actionX * W} y={y + 4} textAnchor="middle" className="bw-tl-check">✓</text>}
                        <text x={Math.min(r.breachX * W + 10, W - 4)} y={y - 8} textAnchor={r.breachX > 0.8 ? 'end' : 'start'} className="bw-tl-label">
                          {r.finding.title}{r.finding.flag ? ` · ${r.finding.flag === 'fabricated' ? t('catalogue.fabricated') : t('catalogue.spamList')}` : ''}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </>
          )}

          <ul className="bw-findings">
            {[...line.rows.map((r) => r.finding), ...line.undated].map((f) => {
              const row = line.rows.find((r) => r.finding.name === f.name);
              return (
                <li key={f.name}>
                  <button type="button" className={`bw-finding-head${selected === f.name ? ' is-sel' : ''}`} onClick={() => setSelected(selected === f.name ? null : f.name)} aria-expanded={selected === f.name}>
                    <span className={`bw-dot ${isHandled(f) ? 'is-handled' : 'is-open'}`} />
                    <span className="bw-breach-title">
                      {f.title}
                      {f.flag && <span className="bw-flag-tag">{f.flag === 'fabricated' ? t('catalogue.fabricated') : t('catalogue.spamList')}</span>}
                    </span>
                    <span className="bw-breach-date">{f.breachDate ? formatBreachDay(f.breachDate, lang, f.datePrecision) : t('timeline.undated')}</span>
                  </button>
                  {row && (
                    <p className="bw-muted bw-small bw-finding-line">
                      {t('timeline.learned', { span: span(row.learnedAfterDays) })}
                      {' '}
                      {row.actionX === null ? t('timeline.exposedOpen', { span: span(row.exposedDays) }) : t('timeline.exposedClosed', { span: span(row.exposedDays) })}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          {sel && (
            <div className="bw-finding-body">
              <h3>{sel.title}</h3>
              {sel.flag && <p className="bw-flag">{sel.flag === 'fabricated' ? t('catalogue.fabricated') : t('catalogue.spamList')}</p>}
              <dl>
                <dt>{t('catalogue.breachDate')}</dt><dd>{formatBreachDay(sel.breachDate, lang, sel.datePrecision)}</dd>
                <dt>{t('catalogue.addedDate')}</dt><dd>{formatDay(sel.addedDate, lang)}</dd>
                <dt>{t('timeline.seenOn')}</dt><dd>{formatInstant(sel.firstSeenAt, lang)}</dd>
                <dt>{t('catalogue.leaked')}</dt><dd>{sel.dataClasses.length ? sel.dataClasses.join(', ') : t('catalogue.unknown')}</dd>
              </dl>
              <p className="bw-small">
                {sel.source === 'found' ? t('timeline.sourceFound', { count: sel.emails.length }) : t('timeline.sourceDeclared')}
              </p>
              {sel.emails.length > 0 && (
                <div className="bw-row bw-small">
                  {sel.emails.map((e) => <Reveal key={e} value={e} masked={maskEmail(e)} />)}
                </div>
              )}
              <h4>{t('timeline.todo')}</h4>
              <ul className="bw-actions">
                {actionsFor(sel).map((id) => {
                  const at = sel.actions[id];
                  return (
                    <li key={id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={!!at}
                          onChange={() => { const at = new Date().toISOString(); void save((f) => toggleAction(f, sel.name, id, at)); }}
                        />
                        <span>{t(`timeline.action.${id}`)}</span>
                        {at && <span className="bw-muted bw-small"> · {t('timeline.doneAt', { when: formatInstant(at, lang) })}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {sel.source === 'declared' && (
                <button type="button" className="bw-link" onClick={() => { setSelected(null); const name = sel.name; void save((f) => undeclare(f, name)); }}>
                  {t('timeline.undeclare')}
                </button>
              )}
            </div>
          )}
          {message && <p className="bw-error" role="alert">{message}</p>}
        </>
      )}
    </section>
  );
}
