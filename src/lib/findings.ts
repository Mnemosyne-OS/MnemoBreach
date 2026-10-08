/**
 * findings.ts — the breaches that concern THIS person, and what they did about
 * them (doc 141 §5-6, lot 3). Pure: no host, no React.
 *
 * Two sources, never mixed up on screen:
 *  - `found`: a search of one of the person's emails answered with this breach
 *    (lot 2). Carries which emails.
 *  - `declared`: the person said "I had an account here" from the catalogue.
 *    That is how the timeline works without an HIBP key.
 *
 * Four dates per finding: breached and made public (from HIBP), first seen here
 * (measured: when the search found it or the person declared it), and the
 * person's actions (declared, dated). 🎭 A date nobody gave is ABSENT, never
 * the 1st of January and never "now".
 *
 * Held in the cartridge's durable state on this machine, never in a vault (the
 * memory chronicle of lot 2 is separate and masked).
 */
import { severityOf, type Breach, type Severity } from './breaches';

export type FindingSource = 'found' | 'declared';

/** Things a person can do after a breach. Which apply depends on what leaked. */
export type ActionId = 'password' | 'twoFactor' | 'phishing' | 'calls' | 'mail' | 'antivirus' | 'allPasswords';

export interface Finding {
  name: string;
  title: string;
  domain: string;
  breachDate: string | null;
  addedDate: string | null;
  dataClasses: string[];
  source: FindingSource;
  /** Emails a search found in it. Empty for a declared finding. */
  emails: string[];
  /** ISO instant this machine first knew about it for this person. */
  firstSeenAt: string;
  /** ISO instant each action was marked done. Absent = not done. */
  actions: Partial<Record<ActionId, string>>;
  /** HIBP flags this entry as fake data or a spam list: shown apart, always. */
  flag: 'fabricated' | 'spamList' | null;
  /** Taken by malware on a computer (stealer log), not from a service. */
  infection: boolean;
  /** `year` when the source only knows the year (XposedOrNot, doc 141 §20). */
  datePrecision: 'day' | 'year';
}

export type Findings = Record<string, Finding>;

const ACTION_IDS: readonly ActionId[] = ['password', 'twoFactor', 'phishing', 'calls', 'mail', 'antivirus', 'allPasswords'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The state cap is 256 KB; this keeps findings far under it. */
export const MAX_FINDINGS = 300;

function isInstant(v: unknown): v is string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Re-reads a stored blob. Anything unreadable is dropped, never guessed. */
export function normalizeFindings(raw: unknown): Findings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Findings = {};
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_FINDINGS) break;
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    const name = typeof r.name === 'string' && r.name ? r.name : '';
    if (!name || name !== key) continue;
    if (r.source !== 'found' && r.source !== 'declared') continue;
    if (!isInstant(r.firstSeenAt)) continue;
    const actions: Partial<Record<ActionId, string>> = {};
    if (r.actions && typeof r.actions === 'object') {
      for (const id of ACTION_IDS) {
        const at = (r.actions as Record<string, unknown>)[id];
        if (isInstant(at)) actions[id] = at;
      }
    }
    out[name] = {
      name,
      title: typeof r.title === 'string' && r.title ? r.title : name,
      domain: typeof r.domain === 'string' ? r.domain : '',
      breachDate: typeof r.breachDate === 'string' && DAY.test(r.breachDate) ? r.breachDate : null,
      addedDate: typeof r.addedDate === 'string' && DAY.test(r.addedDate) ? r.addedDate : null,
      dataClasses: strList(r.dataClasses),
      source: r.source,
      emails: [...new Set(strList(r.emails))],
      firstSeenAt: r.firstSeenAt,
      actions,
      flag: r.flag === 'fabricated' || r.flag === 'spamList' ? r.flag : null,
      infection: r.infection === true,
      datePrecision: r.datePrecision === 'year' ? 'year' : 'day',
    };
  }
  return out;
}

/** HIBP's flag, fake data winning over spam list when both are set. */
export function flagOf(b: Breach): Finding['flag'] {
  if (b.fabricated) return 'fabricated';
  return b.spamList ? 'spamList' : null;
}

function fromBreach(b: Breach, source: FindingSource, at: string): Finding {
  return {
    name: b.name, title: b.title, domain: b.domain, breachDate: b.breachDate, addedDate: b.addedDate,
    dataClasses: [...b.dataClasses], source, emails: [], firstSeenAt: at, actions: {}, flag: flagOf(b),
    infection: b.infection,
    datePrecision: b.datePrecision,
  };
}

/**
 * Folds one email's search result in. A breach already declared becomes
 * `found` (a search is stronger evidence than a memory) and keeps its first
 * date and its actions. A 404 removes nothing: it says "not found today",
 * not "never was".
 */
export function mergeFound(findings: Findings, email: string, breaches: readonly Breach[], at: string): Findings {
  const next: Findings = { ...findings };
  for (const b of breaches) {
    const prev = next[b.name];
    if (!prev && Object.keys(next).length >= MAX_FINDINGS) continue;
    const base = prev ?? fromBreach(b, 'found', at);
    next[b.name] = {
      ...base,
      // Fresher catalogue fields win; the person's own history never moves.
      title: b.title, domain: b.domain, breachDate: b.breachDate, addedDate: b.addedDate, dataClasses: [...b.dataClasses], flag: flagOf(b), infection: b.infection, datePrecision: b.datePrecision,
      source: 'found',
      emails: base.emails.includes(email) ? base.emails : [...base.emails, email],
    };
  }
  return next;
}

/** "I had an account here." A breach already on the timeline is left as is. */
export function declare(findings: Findings, b: Breach, at: string): Findings {
  if (findings[b.name] || Object.keys(findings).length >= MAX_FINDINGS) return findings;
  return { ...findings, [b.name]: fromBreach(b, 'declared', at) };
}

/** Takes a declared finding back. A found one is evidence and stays. */
export function undeclare(findings: Findings, name: string): Findings {
  if (findings[name]?.source !== 'declared') return findings;
  const next = { ...findings };
  delete next[name];
  return next;
}

/** Drops an email from every finding (the person removed it from the profile).
 *  A found finding left with no email goes back to nothing, not to "declared". */
export function forgetEmail(findings: Findings, email: string): Findings {
  const next: Findings = {};
  for (const [k, f] of Object.entries(findings)) {
    if (f.source === 'declared') { next[k] = f; continue; }
    const emails = f.emails.filter((e) => e !== email);
    if (emails.length > 0) next[k] = { ...f, emails };
  }
  return next;
}

/**
 * The actions that make sense for what leaked. 2FA always does.
 * An infection (stealer log, malware) has no service: the machine was read, so
 * the answer is an antivirus and EVERY password, never "this service's".
 */
export function actionsFor(f: Finding): ActionId[] {
  const set = new Set(f.dataClasses.map((c) => c.toLowerCase()));
  const out: ActionId[] = [];
  if (f.infection) out.push('antivirus', 'allPasswords');
  else if (set.has('passwords') || set.has('password hints')) out.push('password');
  out.push('twoFactor');
  if (set.has('email addresses')) out.push('phishing');
  if (set.has('phone numbers')) out.push('calls');
  if (set.has('physical addresses')) out.push('mail');
  return out;
}

export function toggleAction(findings: Findings, name: string, id: ActionId, at: string): Findings {
  const f = findings[name];
  if (!f) return findings;
  const actions = { ...f.actions };
  if (actions[id]) delete actions[id];
  else actions[id] = at;
  return { ...findings, [name]: { ...f, actions } };
}

/** Done when every action that applies is marked. */
export function isHandled(f: Finding): boolean {
  return actionsFor(f).every((id) => f.actions[id]);
}

/** The first action the person marked, or null. */
export function firstActionAt(f: Finding): string | null {
  const all = Object.values(f.actions).filter(isInstant).sort();
  return all[0] ?? null;
}

// ── The crossing (doc 141 §5) ──────────────────────────────────────────────

export interface Crossing {
  /** Findings where two or more of the person's emails sit together. */
  multiEmail: Finding[];
  /** Found findings that also leaked phone numbers or postal addresses: the
   *  set a convincing scam call or letter is built from. */
  contactWithEmail: Finding[];
}

export function crossings(findings: Findings): Crossing {
  const list = Object.values(findings);
  return {
    multiEmail: list.filter((f) => f.emails.length >= 2),
    contactWithEmail: list.filter((f) => f.source === 'found'
      && f.dataClasses.some((c) => /^(phone numbers|physical addresses)$/i.test(c))),
  };
}

// ── The timeline (doc 141 §6) ──────────────────────────────────────────────

export interface TimelineRow {
  finding: Finding;
  severity: Severity;
  /** 0..1 along the axis; null when the date is absent. */
  breachX: number;
  addedX: number | null;
  seenX: number;
  actionX: number | null;
  /** Where the bar stops: the first action, or today. */
  endX: number;
  /** Whole days from the breach to the first action, or to today when none. */
  exposedDays: number;
  /** Whole days from the breach to the day this machine knew. */
  learnedAfterDays: number;
}

export interface Timeline {
  rows: TimelineRow[];
  /** Findings with no breach date: listed apart, never placed on the axis. */
  undated: Finding[];
  /** First and last year shown on the axis, or null when there is no row. */
  fromYear: number | null;
  toYear: number | null;
}

const DAY_MS = 86_400_000;

function ms(dayOrInstant: string): number {
  return Date.parse(DAY.test(dayOrInstant) ? `${dayOrInstant}T00:00:00Z` : dayOrInstant);
}

/** Lays the dated findings on one axis from Jan 1 of the earliest year to now. */
export function timeline(findings: Findings, now: Date): Timeline {
  const all = Object.values(findings);
  const dated = all.filter((f) => f.breachDate !== null);
  const undated = all.filter((f) => f.breachDate === null).sort((a, b) => a.title.localeCompare(b.title));
  if (dated.length === 0) return { rows: [], undated, fromYear: null, toYear: null };

  const nowMs = now.getTime();
  const fromYear = Math.min(...dated.map((f) => Number(f.breachDate!.slice(0, 4))));
  const toYear = now.getUTCFullYear();
  const start = Date.UTC(fromYear, 0, 1);
  const span = Math.max(Date.UTC(toYear + 1, 0, 1) - start, DAY_MS);
  const x = (t: number) => Math.min(1, Math.max(0, (t - start) / span));

  const rows = dated
    .map((f): TimelineRow => {
      const b = ms(f.breachDate!);
      const act = firstActionAt(f);
      const end = act ? ms(act) : nowMs;
      return {
        finding: f,
        severity: severityOf(f.dataClasses),
        breachX: x(b),
        addedX: f.addedDate ? x(ms(f.addedDate)) : null,
        seenX: x(ms(f.firstSeenAt)),
        actionX: act ? x(ms(act)) : null,
        endX: x(end),
        exposedDays: Math.max(0, Math.floor((end - b) / DAY_MS)),
        learnedAfterDays: Math.max(0, Math.floor((ms(f.firstSeenAt) - b) / DAY_MS)),
      };
    })
    .sort((a, b) => (a.finding.breachDate! < b.finding.breachDate! ? -1 : a.finding.breachDate! > b.finding.breachDate! ? 1 : a.finding.title.localeCompare(b.finding.title)));

  return { rows, undated, fromYear, toYear };
}

/** Years then months then days, the largest unit only: "6 years", "3 months". */
export function spanParts(days: number): { unit: 'years' | 'months' | 'days'; n: number } {
  if (days >= 365) return { unit: 'years', n: Math.floor(days / 365) };
  if (days >= 30) return { unit: 'months', n: Math.floor(days / 30) };
  return { unit: 'days', n: days };
}
