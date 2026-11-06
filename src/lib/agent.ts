/**
 * agent.ts — what an agent may do in MnemoBreach (doc 149), declared in
 * `mnemo-plugin.json` › agentActions and served by BreachAgentActions while
 * the window is open.
 *
 * Each write is the change the person's own button makes (`declare`,
 * `undeclare`, `toggleAction` from lib/findings) through the same
 * `updateProfile` queue, so the timeline redraws as for a click.
 *
 * Privacy (doc 141 §8): an answer never carries a full identifier. Emails are
 * masked as on screen; the search of an email is NOT exposed (it sends the
 * address to a third party, and that stays a gesture of the person).
 */
import { findNamed, type Named } from './agentFind';
import { searchBreaches, type Breach } from './breaches';
import type { CatalogueSnapshot } from './catalogueStore';
import { actionsFor, declare, isHandled, timeline, toggleAction, undeclare, type ActionId, type Finding, type Findings } from './findings';
import { maskEmail } from './mask';
import { diffCatalogue, knownNames } from './news';
import type { Profile } from './profile';
import type { ProfileSnapshot } from './profileStore';

export interface BreachAgentContext {
  profile: ProfileSnapshot;
  /** The profile store's queued write (lib/profileStore). False = not saved. */
  updateProfile: (change: (current: Profile) => Profile) => Promise<boolean>;
  catalogue: () => CatalogueSnapshot;
  /** Reads the public catalogue unless it is already read (the card's own load). */
  loadCatalogue: () => Promise<void>;
  /** Takes the background watch off, as the card's « turn off » does (lib/watch). */
  unregisterWatch: () => Promise<void>;
  now: () => Date;
}

/** New breaches named in a `news` answer before « and N more ». */
export const NEWS_SHOWN = 20;

export const ACTION_IDS: readonly ActionId[] = ['password', 'twoFactor', 'phishing', 'calls', 'mail', 'antivirus', 'allPasswords'];

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A whole number inside the manifest's bounds, or the default. Clamped, never trusted. */
export function boundedInt(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

/** `catalogue` › limit: 1..100, default 20 (mnemo-plugin.json). */
export const catalogueLimit = (v: unknown): number => boundedInt(v, 20, 1, 100);

function requireProfile(snap: ProfileSnapshot): Findings {
  if (snap.status === 'loading') throw new Error('NOT_READY: MnemoBreach is still reading the saved profile; try again in a moment');
  if (snap.status !== 'ready') throw new Error('NOT_READY: the saved profile could not be read; the person sees it in MnemoBreach');
  return snap.profile.findings;
}

/** One finding as an agent reads it: services and dates, emails masked. */
export function findingLine(f: Finding) {
  const applies = actionsFor(f);
  return {
    name: f.name,
    title: f.title,
    ...(f.domain ? { domain: f.domain } : {}),
    breachDate: f.breachDate,
    source: f.source,
    ...(f.emails.length ? { emails: f.emails.map(maskEmail) } : {}),
    dataClasses: f.dataClasses,
    ...(f.flag ? { flag: f.flag } : {}),
    ...(f.infection ? { infection: true } : {}),
    actionsToDo: applies.filter((id) => !f.actions[id]),
    actionsDone: Object.fromEntries(applies.filter((id) => f.actions[id]).map((id) => [id, f.actions[id]!])),
    handled: isHandled(f),
  };
}

export function breachLine(b: Breach, onTimeline: boolean) {
  return {
    name: b.name,
    title: b.title,
    ...(b.domain ? { domain: b.domain } : {}),
    breachDate: b.breachDate,
    pwnCount: b.pwnCount,
    dataClasses: b.dataClasses,
    ...(b.fabricated ? { flag: 'fabricated' } : b.spamList ? { flag: 'spamList' } : {}),
    onTimeline,
  };
}

/** A breach as a refusal names it: its title, and its name when the two differ (the name is what to pass back). */
const labelOf = (b: { name: string; title: string }) => (b.title && b.title !== b.name ? `${b.title} (${b.name})` : b.name);
const named = <T extends { name: string; title: string; domain?: string }>(b: T): Named<T> => ({
  item: b, id: b.name, names: [b.name, b.title].filter(Boolean), aliases: b.domain ? [b.domain] : [], label: labelOf(b),
});

/**
 * The finding an agent named: its name, or the words a person says (« la fuite
 * Adobe », « linkedin.com »). Several are AMBIGUOUS with their names; none
 * lists what is on the timeline.
 */
export function findFinding(findings: Findings, ref: string): Finding {
  return findNamed(Object.values(findings).map(named), ref, { code: 'NO_BREACH', noun: 'breach', plural: 'breaches on the timeline' });
}

/** The catalogue entry an agent named, by its name or its words; none points to `catalogue` (900 names say nothing). */
export function findBreach(list: readonly Breach[], ref: string): Breach {
  return findNamed(list.map(named), ref, {
    code: 'NO_BREACH', noun: 'breach', plural: 'breaches',
    whereToLook: 'call catalogue with words of its name or its domain to find it',
  });
}

async function readyCatalogue(ctx: BreachAgentContext): Promise<Breach[]> {
  if (ctx.catalogue().kind !== 'ok') await ctx.loadCatalogue();
  const cat = ctx.catalogue();
  if (cat.kind === 'ok') return cat.breaches;
  throw new Error(`CATALOGUE_UNAVAILABLE: the public breach list could not be read (${cat.kind === 'error' ? cat.code : 'still loading'}); try again later`);
}

async function save(ctx: BreachAgentContext, change: (findings: Findings) => Findings): Promise<void> {
  if (!(await ctx.updateProfile((cur) => ({ ...cur, findings: change(cur.findings) })))) {
    throw new Error('WRITE_FAILED: the timeline could not be saved; the person sees it in MnemoBreach');
  }
}

export function breachAgentHandlers(get: () => BreachAgentContext) {
  return {
    // agent-actions:begin
    breaches: () => {
      const ctx = get();
      const findings = requireProfile(ctx.profile);
      const line = timeline(findings, ctx.now());
      const ordered = [...line.rows.map((r) => r.finding), ...line.undated];
      const exposed = new Map(line.rows.map((r) => [r.finding.name, r.exposedDays]));
      const all = ordered.map((f) => ({ ...findingLine(f), ...(exposed.has(f.name) ? { exposedDays: exposed.get(f.name) } : {}) }));
      return { total: all.length, open: all.filter((f) => !f.handled).length, breaches: all };
    },

    catalogue: async (args: Record<string, unknown>) => {
      const ctx = get();
      const findings = requireProfile(ctx.profile);
      const list = await readyCatalogue(ctx);
      const found = searchBreaches(list, str(args.query));
      const limit = catalogueLimit(args.limit);
      return { total: list.length, matching: found.length, breaches: found.slice(0, limit).map((b) => breachLine(b, !!findings[b.name])) };
    },

    declare: async (args: Record<string, unknown>) => {
      const ctx = get();
      const findings = requireProfile(ctx.profile);
      const breach = findBreach(await readyCatalogue(ctx), str(args.name));
      if (findings[breach.name]) return { name: breach.name, onTimeline: true, already: true };
      const at = ctx.now().toISOString();
      if (declare(findings, breach, at) === findings) throw new Error('FULL: the timeline holds its maximum of breaches; the person removes some first');
      await save(ctx, (cur) => declare(cur, breach, at));
      return { name: breach.name, onTimeline: true };
    },

    undeclare: async (args: Record<string, unknown>) => {
      const ctx = get();
      const f = findFinding(requireProfile(ctx.profile), str(args.name));
      if (f.source !== 'declared') throw new Error(`FOUND: "${f.name}" was found by a search of the person's email; it is evidence and stays on the timeline`);
      await save(ctx, (cur) => undeclare(cur, f.name));
      return { name: f.name, onTimeline: false };
    },

    markAction: async (args: Record<string, unknown>) => {
      const ctx = get();
      const f = findFinding(requireProfile(ctx.profile), str(args.name));
      const id = str(args.action) as ActionId;
      const applies = actionsFor(f);
      if (!applies.includes(id)) throw new Error(`NOT_APPLICABLE: for "${f.name}" the actions are ${applies.join(', ')}`);
      const done = args.done !== false;
      // toggleAction flips: only call it when the state must change, so the call is idempotent.
      if (!!f.actions[id] !== done) {
        const at = ctx.now().toISOString();
        await save(ctx, (cur) => (!!cur[f.name]?.actions[id] === done ? cur : toggleAction(cur, f.name, id, at)));
      }
      return { name: f.name, action: id, done };
    },

    markHandled: async (args: Record<string, unknown>) => {
      const ctx = get();
      const f = findFinding(requireProfile(ctx.profile), str(args.name));
      const todo = actionsFor(f).filter((id) => !f.actions[id]);
      if (todo.length) {
        const at = ctx.now().toISOString();
        // Each still-open step, as ticking its box does; one that got ticked meanwhile is left as it is.
        await save(ctx, (cur) => todo.reduce((acc, id) => (acc[f.name] && !acc[f.name]!.actions[id] ? toggleAction(acc, f.name, id, at) : acc), cur));
      }
      return { name: f.name, handled: true, marked: todo };
    },

    news: async () => {
      const ctx = get();
      const snap = ctx.profile;
      const findings = requireProfile(snap);
      const list = await readyCatalogue(ctx);
      const diff = diffCatalogue(snap.profile.knownBreaches, list, findings);
      // The first visit has no memory to compare with: nothing is new, the card remembers the list.
      if (diff.first) return { first: true, mine: [], others: 0 };
      const line = (b: Breach) => ({ name: b.name, title: b.title, breachDate: b.breachDate });
      return {
        first: false,
        ...(snap.profile.knownAt ? { since: snap.profile.knownAt } : {}),
        mine: diff.mine.map(line),
        others: diff.others.length,
        othersShown: diff.others.slice(0, NEWS_SHOWN).map(line),
        watchOn: !!snap.profile.watchOn,
      };
    },

    markNewsSeen: async () => {
      const ctx = get();
      requireProfile(ctx.profile);
      const names = knownNames(await readyCatalogue(ctx));
      const at = ctx.now().toISOString();
      if (!(await ctx.updateProfile((cur) => ({ ...cur, knownBreaches: names, knownAt: at })))) {
        throw new Error('WRITE_FAILED: the news could not be marked as seen; the person sees it in MnemoBreach');
      }
      return { seen: names.length, at };
    },

    watchOff: async () => {
      const ctx = get();
      const snap = ctx.profile;
      requireProfile(snap);
      if (!snap.profile.watchOn) return { watchOn: false, already: true };
      try {
        await ctx.unregisterWatch();
      } catch (err) {
        throw new Error(`WRITE_FAILED: the watch could not be turned off (${err instanceof Error ? err.message : String(err)})`);
      }
      if (!(await ctx.updateProfile((cur) => ({ ...cur, watchOn: false, watchSig: '' })))) {
        throw new Error('WRITE_FAILED: the watch is off but that could not be saved; the person sees it in MnemoBreach');
      }
      return { watchOn: false };
    },
    // agent-actions:end
  };
}
