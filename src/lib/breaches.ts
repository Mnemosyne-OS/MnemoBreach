/**
 * breaches.ts — the public catalogue of known breaches (HIBP `/breaches`).
 *
 * Free, no key, nothing about the person is sent. Measured 2026-10-07: 200,
 * ~1.1 MB of JSON, `Access-Control-Allow-Origin: *`, so the iframe fetches it
 * directly. It is kept in memory for the session only: the host's durable
 * state refuses past 256 KB, and the list is public anyway.
 *
 * Every field is re-read defensively. A date HIBP does not give is ABSENT
 * (null), never the 1st of January; a count it does not give is null, never 0.
 * The description is HTML on the wire and becomes plain text here, so the
 * screen never injects markup from a third party.
 */

export const BREACHES_URL = 'https://haveibeenpwned.com/api/v3/breaches';
export const FETCH_TIMEOUT_MS = 15_000;

export interface Breach {
  name: string;
  title: string;
  domain: string;
  /** YYYY-MM-DD, or null when HIBP gives none or an unreadable one. */
  breachDate: string | null;
  /** YYYY-MM-DD of the day HIBP published it, or null. */
  addedDate: string | null;
  pwnCount: number | null;
  dataClasses: string[];
  description: string;
  verified: boolean;
  /** Flagged by HIBP as fake data; shown apart, never mixed with real ones. */
  fabricated: boolean;
  spamList: boolean;
  retired: boolean;
  /** HIBP `IsStealerLog` / `IsMalware`: data taken by malware on a computer,
   *  not from a service. Changing "this service's" password means nothing. */
  infection: boolean;
  /** `year` for a date only known at the year (XposedOrNot, §20): shown as the year alone. */
  datePrecision: 'day' | 'year';
}

/**
 * The worst kind of data a breach exposed, for the colour of its dot.
 * password > sensitive > contact > other > email. 🚨 `email` means ONLY the
 * email leaked (decision 07/10: the old 3 tiers called 109 breaches "email
 * only" that also leaked driving licences, card data or sexual orientation).
 */
export type Severity = 'password' | 'sensitive' | 'contact' | 'other' | 'email';

/** Classes that cannot be changed like a password: identity, money, health, intimacy.
 *  Matched on HIBP's own class names, measured on the 07/10 catalogue (71 breaches). */
const SENSITIVE = /credit card|bank account|government|passport|driver'?s licen|social security|national id|tax (?:file )?number|sexual|health|medical|ethnicit|religio|criminal|biometric|private messages/i;

const DAY = /^(\d{4}-\d{2}-\d{2})/;

function dayOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = DAY.exec(v);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[1] ? null : m[1];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML description → plain text. Tags dropped, entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** One raw entry → a Breach, or null when it has no name to show. */
export function normalizeBreach(raw: unknown): Breach | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.Name === 'string' ? r.Name.trim() : '';
  if (!name) return null;
  const title = typeof r.Title === 'string' && r.Title.trim() ? r.Title.trim() : name;
  const count = typeof r.PwnCount === 'number' && Number.isFinite(r.PwnCount) && r.PwnCount >= 0 ? r.PwnCount : null;
  return {
    name,
    title,
    domain: typeof r.Domain === 'string' ? r.Domain.trim() : '',
    breachDate: dayOf(r.BreachDate),
    addedDate: dayOf(r.AddedDate),
    pwnCount: count,
    dataClasses: Array.isArray(r.DataClasses) ? r.DataClasses.filter((c): c is string => typeof c === 'string') : [],
    description: typeof r.Description === 'string' ? htmlToText(r.Description) : '',
    verified: r.IsVerified === true,
    fabricated: r.IsFabricated === true,
    spamList: r.IsSpamList === true,
    retired: r.IsRetired === true,
    infection: r.IsStealerLog === true || r.IsMalware === true,
    datePrecision: 'day',
  };
}

/** Most recent breach first; entries without a date go last, by title. */
export function compareBreaches(a: Breach, b: Breach): number {
  if (a.breachDate && b.breachDate && a.breachDate !== b.breachDate) return a.breachDate < b.breachDate ? 1 : -1;
  if (a.breachDate && !b.breachDate) return -1;
  if (!a.breachDate && b.breachDate) return 1;
  return a.title.localeCompare(b.title);
}

/** Whole answer → sorted list. Returns null when the body is not a list. */
export function normalizeBreaches(raw: unknown): Breach[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map(normalizeBreach).filter((b): b is Breach => b !== null).sort(compareBreaches);
}

export function severityOf(dataClasses: readonly string[]): Severity {
  const set = new Set(dataClasses.map((c) => c.toLowerCase()));
  if (set.has('passwords') || set.has('password hints')) return 'password';
  if (dataClasses.some((c) => SENSITIVE.test(c))) return 'sensitive';
  if (set.has('phone numbers') || set.has('physical addresses')) return 'contact';
  if (set.size > 0 && [...set].every((c) => c === 'email addresses')) return 'email';
  return 'other';
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Case- and accent-insensitive match on title, name and domain. */
export function searchBreaches(list: readonly Breach[], query: string): Breach[] {
  const q = fold(query.trim());
  if (!q) return [...list];
  return list.filter((b) => fold(`${b.title} ${b.name} ${b.domain}`).includes(q));
}

/** Real breaches and the ones HIBP flags as fake or spam lists, kept apart. */
export function splitFlagged(list: readonly Breach[]): { real: Breach[]; flagged: Breach[] } {
  const real: Breach[] = [];
  const flagged: Breach[] = [];
  for (const b of list) (b.fabricated || b.spamList ? flagged : real).push(b);
  return { real, flagged };
}

/** Year of the breach, or null. Used for the year headers of the list. */
export function yearOf(b: Breach): string | null {
  return b.breachDate ? b.breachDate.slice(0, 4) : null;
}

export type CatalogueResult =
  | { kind: 'ok'; breaches: Breach[]; fetchedAt: string }
  | { kind: 'error'; code: 'TIMEOUT' | 'NETWORK' | 'RATE_LIMITED' | 'BAD_RESPONSE' };

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchCatalogue(opts: { fetcher?: Fetcher; now?: () => Date } = {}): Promise<CatalogueResult> {
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const now = opts.now ?? (() => new Date());
  let res: Response;
  try {
    res = await fetcher(BREACHES_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.warn('[breach] catalogue fetch failed:', timedOut ? 'timeout' : 'network');
    return { kind: 'error', code: timedOut ? 'TIMEOUT' : 'NETWORK' };
  }
  if (res.status === 429) return { kind: 'error', code: 'RATE_LIMITED' };
  if (!res.ok) {
    console.warn('[breach] catalogue status', res.status);
    return { kind: 'error', code: 'BAD_RESPONSE' };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    console.warn('[breach] catalogue is not JSON:', err instanceof Error ? err.message : String(err));
    return { kind: 'error', code: 'BAD_RESPONSE' };
  }
  const breaches = normalizeBreaches(json);
  if (!breaches) return { kind: 'error', code: 'BAD_RESPONSE' };
  return { kind: 'ok', breaches, fetchedAt: now().toISOString() };
}
