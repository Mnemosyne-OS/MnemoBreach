/**
 * news.ts — what is NEW since the person last looked (doc 141 lot 4). Pure.
 *
 * Two layers, with two different costs:
 *
 * 1. The local diff, free and silent. On every open the public catalogue is
 *    compared with the names seen at the last "mark as seen". Nothing about the
 *    person leaves the machine: the catalogue is the same file for everyone.
 *    🚨 The first observation announces NOTHING (doc 72 invariant 1): with no
 *    memory, every breach would read as new, an event made up.
 *
 * 2. The background watch, opt-in. One host target per service on the
 *    timeline (`/breaches?domain=`), read once a day even with the window
 *    closed, with an OS notification. Its price is said before it is turned
 *    on: HIBP sees which services are watched (never an email).
 *    Why one target per domain and not the catalogue: the host's json reader
 *    stops at 200 items per body, the catalogue has 1 042 sorted by NAME, so a
 *    new breach late in the alphabet would never be seen (measured 07/10).
 */
import type { Breach } from './breaches';
import type { Findings } from './findings';

export const HIBP_DOMAIN_URL = 'https://haveibeenpwned.com/api/v3/breaches?domain=';
/** The host's cap (doc 72 §Bornes). */
export const MAX_WATCH_TARGETS = 12;
/** Once a day: the catalogue moves a few times a week, HIBP caches for a month. */
export const WATCH_INTERVAL_MIN = 1440;
/** Far above today's 1 042, far under the 256 KB state cap. */
export const MAX_KNOWN = 5000;
/**
 * The notification title the host shows for a target. The SAME for every
 * service (decision 07/10): a notification is read on a lock screen, and the
 * list of services a person watches can say a lot (dating sites).
 */
export const WATCH_LABEL = 'MnemoBreach';
/** Bumped when the shape of a target changes, so old registrations are replaced. */
const PLAN_VERSION = 'v2';

export interface CatalogueDiff {
  /** No memory yet: nothing is announced, the current list becomes the memory. */
  first: boolean;
  /** New breaches on a service that is on the person's timeline. */
  mine: Breach[];
  /** Every other new breach. */
  others: Breach[];
}

/** Domains on the timeline, lower-cased, empty ones dropped. */
export function timelineDomains(findings: Findings): Set<string> {
  return new Set(Object.values(findings).map((f) => f.domain.trim().toLowerCase()).filter(Boolean));
}

export function diffCatalogue(known: readonly string[], catalogue: readonly Breach[], findings: Findings): CatalogueDiff {
  if (known.length === 0) return { first: true, mine: [], others: [] };
  const seen = new Set(known);
  const domains = timelineDomains(findings);
  const mine: Breach[] = [];
  const others: Breach[] = [];
  for (const b of catalogue) {
    if (seen.has(b.name)) continue;
    (b.domain && domains.has(b.domain.toLowerCase()) ? mine : others).push(b);
  }
  return { first: false, mine, others };
}

/** The names to remember after "mark as seen". */
export function knownNames(catalogue: readonly Breach[]): string[] {
  return catalogue.map((b) => b.name).slice(0, MAX_KNOWN);
}

export interface WatchPlan {
  targets: Array<{ url: string; label: string; spec: { mode: 'json'; arrayPath: ''; idField: 'Name'; labelField: 'Title' } }>;
  /** Domains on the timeline left out by the host's cap. Said, never hidden. */
  skipped: number;
  /** Stable text of the target set: re-register only when it changes. */
  signature: string;
}

/**
 * One target per domain on the timeline, most recent breach first, so the cap
 * keeps the services the person dealt with most recently.
 */
export function watchPlan(findings: Findings): WatchPlan {
  const latest = new Map<string, string>();
  for (const f of Object.values(findings)) {
    const d = f.domain.trim().toLowerCase();
    if (!d) continue;
    const date = f.breachDate ?? '';
    if (!latest.has(d) || date > latest.get(d)!) latest.set(d, date);
  }
  const domains = [...latest.entries()].sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] < b[1] ? 1 : -1)).map(([d]) => d);
  const kept = domains.slice(0, MAX_WATCH_TARGETS);
  return {
    targets: kept.map((d) => ({
      url: HIBP_DOMAIN_URL + encodeURIComponent(d),
      label: WATCH_LABEL,
      spec: { mode: 'json', arrayPath: '', idField: 'Name', labelField: 'Title' },
    })),
    skipped: domains.length - kept.length,
    // Empty stays empty: no target is no registration, whatever the version.
    signature: kept.length === 0 ? '' : [PLAN_VERSION, ...[...kept].sort()].join('|'),
  };
}
