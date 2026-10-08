/**
 * xon.ts — the free email search, through XposedOrNot (doc 141 §20).
 *
 * Why a second source: the HIBP email search needs a paid key. XposedOrNot
 * answers the same question for free, with no key, and the iframe calls it
 * directly (measured 07/10: `Access-Control-Allow-Origin: *`, preflight 200).
 *
 * What it costs, said on screen before a search:
 *  - the email leaves to XposedOrNot (same price as HIBP: the email itself);
 *  - its terms ask to credit XposedOrNot wherever its data is shown;
 *  - its dates are YEARS only ("2026"), so a breach it alone knows is placed
 *    and shown at the year, never at a made-up day.
 *
 * Measured 07/10 on a test address: 196 of its 215 breaches match exactly one
 * HIBP breach by domain AND year. Those are replaced by the HIBP entry from
 * the public catalogue (day-precise date, HIBP flags, the same name the
 * timeline and the news already use). The other 19 stay XposedOrNot's own,
 * named `xon:<name>` so they never collide with an HIBP name.
 *
 * An address in no breach answers 200 with `ExposedBreaches: null`: that is
 * "absent", dated. A body it cannot read is an error, never "absent".
 * The email is never logged.
 */
import { normalizeBreach, htmlToText, type Breach } from './breaches';
import type { AccountResult } from './account';

export const XON_URL = 'https://api.xposedornot.com/v1/breach-analytics?email=';
export const XON_HOME = 'https://xposedornot.com/';
export const FETCH_TIMEOUT_MS = 15_000;

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

interface XonDetail {
  breach?: unknown;
  domain?: unknown;
  xposed_date?: unknown;
  xposed_data?: unknown;
  xposed_records?: unknown;
  details?: unknown;
  verified?: unknown;
}

/** One XposedOrNot entry → its HIBP twin when there is exactly one, else its own Breach. */
export function toBreach(x: XonDetail, catalogue: readonly Breach[]): Breach | null {
  const name = typeof x.breach === 'string' ? x.breach.trim() : '';
  if (!name) return null;
  const domain = typeof x.domain === 'string' ? x.domain.trim().toLowerCase() : '';
  const year = typeof x.xposed_date === 'string' || typeof x.xposed_date === 'number' ? String(x.xposed_date).trim() : '';
  const validYear = /^\d{4}$/.test(year) ? year : null;

  if (domain && validYear) {
    const twins = catalogue.filter((b) => b.domain.toLowerCase() === domain && b.breachDate?.slice(0, 4) === validYear);
    if (twins.length === 1) return twins[0]!;
  }

  const base = normalizeBreach({
    Name: `xon:${name}`,
    Title: name,
    Domain: domain,
    // Mid-year, so the dot sits inside its year on the axis; every display
    // reads `datePrecision` and shows the year alone.
    BreachDate: validYear ? `${validYear}-07-01` : undefined,
    PwnCount: typeof x.xposed_records === 'number' ? x.xposed_records : undefined,
    DataClasses: typeof x.xposed_data === 'string' ? x.xposed_data.split(';').map((c) => c.trim()).filter(Boolean) : [],
    Description: typeof x.details === 'string' ? htmlToText(x.details) : '',
    IsVerified: x.verified === 'Yes',
  });
  return base ? { ...base, datePrecision: validYear ? 'year' : 'day' } : null;
}

/** Reads a breach-analytics answer. `undefined` = not an answer we can read. */
export function readXon(json: unknown, catalogue: readonly Breach[]): Breach[] | null | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const exposed = (json as { ExposedBreaches?: unknown }).ExposedBreaches;
  if (exposed === null) return null;
  const details = (exposed as { breaches_details?: unknown } | undefined)?.breaches_details;
  if (!Array.isArray(details)) return undefined;
  const seen = new Set<string>();
  const out: Breach[] = [];
  for (const d of details) {
    const b = toBreach((d ?? {}) as XonDetail, catalogue);
    if (b && !seen.has(b.name)) {
      seen.add(b.name);
      out.push(b);
    }
  }
  return out;
}

/** One email searched on XposedOrNot. Never throws: a failure is a named error. */
export async function lookupXon(
  email: string,
  opts: { fetcher?: Fetcher; now?: () => Date; catalogue?: readonly Breach[] } = {},
): Promise<AccountResult> {
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const now = opts.now ?? (() => new Date());
  let res: Response;
  try {
    res = await fetcher(XON_URL + encodeURIComponent(email), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    console.warn('[breach] free search failed:', timedOut ? 'timeout' : 'network');
    return { kind: 'error', code: timedOut ? 'TIMEOUT' : 'NETWORK' };
  }
  if (res.status === 429) return { kind: 'error', code: 'RATE_LIMITED' };
  if (res.status === 404) return { kind: 'absent', checkedAt: now().toISOString(), via: 'xon' };
  if (!res.ok) {
    console.warn('[breach] free search status', res.status);
    return { kind: 'error', code: 'BAD_RESPONSE' };
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    console.warn('[breach] free search answer is not JSON');
    return { kind: 'error', code: 'BAD_RESPONSE' };
  }
  const breaches = readXon(json, opts.catalogue ?? []);
  if (breaches === undefined) return { kind: 'error', code: 'BAD_RESPONSE' };
  const checkedAt = now().toISOString();
  if (breaches === null || breaches.length === 0) return { kind: 'absent', checkedAt, via: 'xon' };
  return { kind: 'found', breaches, checkedAt, via: 'xon' };
}
