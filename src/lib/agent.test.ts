/**
 * The agent's moves in MnemoBreach (doc 149): the timeline's own changes, an
 * email never leaves unmasked, and every refusal names what to call instead.
 */
import { describe, expect, it, vi } from 'vitest';
import { normalizeBreach, type Breach } from './breaches';
import { breachAgentHandlers, catalogueLimit, findBreach, type BreachAgentContext } from './agent';
import { declare, mergeFound, type Findings } from './findings';
import { EMPTY_PROFILE, type Profile } from './profile';
import type { CatalogueSnapshot } from './catalogueStore';

const NOW = new Date('2026-10-12T12:00:00.000Z');
const breach = (over: Record<string, unknown> = {}): Breach => normalizeBreach({
  Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', BreachDate: '2013-10-04', AddedDate: '2013-12-04T00:00:00Z',
  DataClasses: ['Email addresses', 'Passwords'], ...over,
})!;
const adobe = breach();
const linked = breach({ Name: 'LinkedIn', Title: 'LinkedIn', Domain: 'linkedin.com', BreachDate: '2012-05-05', DataClasses: ['Email addresses', 'Phone numbers'] });
const twinA = breach({ Name: 'Twin1', Title: 'Twin', Domain: 'a.com' });
const twinB = breach({ Name: 'Twin2', Title: 'Twin', Domain: 'b.com' });

function setup(findings: Findings = {}, over: Partial<BreachAgentContext> = {}, cat: CatalogueSnapshot = { kind: 'ok', breaches: [adobe, linked, twinA, twinB], fetchedAt: NOW.toISOString() }) {
  let profile: Profile = { ...EMPTY_PROFILE, findings };
  const ctx: BreachAgentContext = {
    get profile() { return { status: 'ready' as const, profile }; },
    updateProfile: vi.fn((change: (p: Profile) => Profile) => { profile = change(profile); return Promise.resolve(true); }),
    catalogue: () => cat,
    loadCatalogue: vi.fn(() => Promise.resolve()),
    unregisterWatch: vi.fn(() => Promise.resolve()),
    now: () => NOW,
    ...over,
  };
  return { ctx, h: breachAgentHandlers(() => ctx), findings: () => profile.findings, profile: () => profile };
}

describe('what an agent reads', () => {
  it('breaches lists the timeline with steps to do, and emails masked, never whole', () => {
    const { h } = setup(mergeFound({}, 'tony.secret@example.com', [adobe], NOW.toISOString()));
    const r = h.breaches();
    expect(r).toMatchObject({ total: 1, open: 1 });
    expect(r.breaches[0]).toMatchObject({ name: 'Adobe', source: 'found', actionsToDo: ['password', 'twoFactor', 'phishing'], handled: false });
    expect(JSON.stringify(r)).not.toContain('tony.secret@example.com');
    expect(r.breaches[0]!.emails).toHaveLength(1);
  });

  it('a profile not read yet, or unreadable, is refused by name', () => {
    expect(() => setup({}, { profile: { status: 'loading', profile: EMPTY_PROFILE } }).h.breaches()).toThrow(/^NOT_READY/);
    expect(() => setup({}, { profile: { status: 'error', profile: EMPTY_PROFILE } }).h.breaches()).toThrow(/^NOT_READY/);
  });

  it('catalogue searches the public list, says what is on the timeline, and clamps its limit', async () => {
    const { h } = setup(declare({}, adobe, NOW.toISOString()));
    const r = await h.catalogue({ query: 'linked' });
    expect(r.breaches.map((b) => b.name)).toEqual(['LinkedIn']);
    expect((await h.catalogue({ query: 'adobe' })).breaches[0]!.onTimeline).toBe(true);
    expect((await h.catalogue({ limit: -3 })).breaches).toHaveLength(1);
    expect(catalogueLimit(-3)).toBe(1);
    expect(catalogueLimit(1000)).toBe(100);
  });

  it('a catalogue not read yet is loaded first, and an unreadable one is said', async () => {
    let snap: CatalogueSnapshot = { kind: 'loading' };
    const load = vi.fn(() => { snap = { kind: 'ok', breaches: [adobe], fetchedAt: NOW.toISOString() }; return Promise.resolve(); });
    const { h } = setup({}, { catalogue: () => snap, loadCatalogue: load });
    expect((await h.catalogue({})).total).toBe(1);
    expect(load).toHaveBeenCalledTimes(1);
    const broken = setup({}, { loadCatalogue: () => Promise.resolve() }, { kind: 'error', code: 'NETWORK' });
    await expect(broken.h.catalogue({})).rejects.toThrow(/^CATALOGUE_UNAVAILABLE.*NETWORK/);
  });
});

describe('what an agent changes', () => {
  it('declare puts it on the timeline through the profile store', async () => {
    const { ctx, h, findings } = setup();
    expect(await h.declare({ name: 'linkedin' })).toEqual({ name: 'LinkedIn', onTimeline: true });
    expect(findings().LinkedIn).toMatchObject({ source: 'declared' });
    expect(ctx.updateProfile).toHaveBeenCalledTimes(1);
  });

  it('a title naming two breaches is AMBIGUOUS, never the first; an unknown one is NOT_FOUND', async () => {
    const { ctx, h } = setup();
    await expect(h.declare({ name: 'Twin' })).rejects.toThrow('AMBIGUOUS: "Twin" names several breaches: Twin (Twin1), Twin (Twin2); say which');
    // The repair call is told where to look, not 12 names out of 900.
    await expect(h.declare({ name: 'Nope' })).rejects.toThrow('NO_BREACH: no breach named "Nope"; call catalogue with words of its name or its domain to find it');
    expect(ctx.updateProfile).not.toHaveBeenCalled();
    expect(findBreach([adobe], 'ADOBE').name).toBe('Adobe');
  });

  it('a refused save is said, never reported done', async () => {
    const { h } = setup({}, { updateProfile: () => Promise.resolve(false) });
    await expect(h.declare({ name: 'Adobe' })).rejects.toThrow(/^WRITE_FAILED/);
  });

  it('undeclare takes a declared breach off; a found one is evidence and stays', async () => {
    const { h, findings } = setup(declare(mergeFound({}, 'a@x.io', [linked], NOW.toISOString()), adobe, NOW.toISOString()));
    expect(await h.undeclare({ name: 'Adobe' })).toEqual({ name: 'Adobe', onTimeline: false });
    expect(findings().Adobe).toBeUndefined();
    await expect(h.undeclare({ name: 'LinkedIn' })).rejects.toThrow(/^FOUND/);
    expect(findings().LinkedIn).toBeDefined();
    await expect(h.undeclare({ name: 'Ghost' })).rejects.toThrow('NO_BREACH: no breach named "Ghost"; breaches on the timeline: LinkedIn');
  });

  it('markAction sets the step, twice in a row stays done, and false takes it back', async () => {
    const { ctx, h, findings } = setup(declare({}, adobe, NOW.toISOString()));
    await h.markAction({ name: 'Adobe', action: 'password' });
    expect(findings().Adobe!.actions.password).toBe(NOW.toISOString());
    await h.markAction({ name: 'Adobe', action: 'password' });
    expect(findings().Adobe!.actions.password).toBe(NOW.toISOString());
    expect(ctx.updateProfile).toHaveBeenCalledTimes(1);
    await h.markAction({ name: 'Adobe', action: 'password', done: false });
    expect(findings().Adobe!.actions.password).toBeUndefined();
  });

  it('a step that does not apply to that breach is refused with the ones that do', async () => {
    const { h } = setup(declare({}, adobe, NOW.toISOString()));
    await expect(h.markAction({ name: 'Adobe', action: 'calls' })).rejects.toThrow(/^NOT_APPLICABLE.*password, twoFactor, phishing/);
  });
});

describe('what the person says, by voice (the orb never reads the app first)', () => {
  it('declare and markAction take the words a person says, and its domain', async () => {
    const { h, findings } = setup();
    expect(await h.declare({ name: 'la fuite Adobe' })).toEqual({ name: 'Adobe', onTimeline: true });
    expect(await h.declare({ name: 'linkedin.com' })).toEqual({ name: 'LinkedIn', onTimeline: true });
    await h.markAction({ name: 'la fuite adobe', action: 'twoFactor' });
    expect(findings().Adobe!.actions.twoFactor).toBe(NOW.toISOString());
  });

  it('a name that says two breaches on the timeline is refused with both, nothing written', async () => {
    const { ctx, h } = setup(declare(declare({}, twinA, NOW.toISOString()), twinB, NOW.toISOString()));
    await expect(h.markAction({ name: 'twin', action: 'password' })).rejects.toThrow(/^AMBIGUOUS: "twin" names several breaches on the timeline: Twin \(Twin1\), Twin \(Twin2\)/);
    await expect(h.markHandled({ name: 'twin' })).rejects.toThrow(/^AMBIGUOUS/);
    expect(ctx.updateProfile).not.toHaveBeenCalled();
    expect((await h.markAction({ name: 'twin2', action: 'password' })).name).toBe('Twin2');
  });

  it('markHandled ticks every step still open in one write, and a handled breach stays as it is', async () => {
    const { ctx, h, findings } = setup(declare({}, adobe, NOW.toISOString()));
    await h.markAction({ name: 'Adobe', action: 'password' });
    expect(await h.markHandled({ name: 'adobe' })).toEqual({ name: 'Adobe', handled: true, marked: ['twoFactor', 'phishing'] });
    expect(Object.keys(findings().Adobe!.actions).sort()).toEqual(['password', 'phishing', 'twoFactor']);
    expect(ctx.updateProfile).toHaveBeenCalledTimes(2);
    expect((await h.markHandled({ name: 'Adobe' })).marked).toEqual([]);
    expect(ctx.updateProfile).toHaveBeenCalledTimes(2);
  });

  it('markHandled on a refused save says so', async () => {
    const { h } = setup(declare({}, adobe, NOW.toISOString()), { updateProfile: () => Promise.resolve(false) });
    await expect(h.markHandled({ name: 'Adobe' })).rejects.toThrow(/^WRITE_FAILED/);
  });

  it('news: nothing on a first visit, then the new ones on a timeline service first', async () => {
    expect(await setup().h.news()).toEqual({ first: true, mine: [], others: 0 });
    const seen = setup(declare({}, linked, NOW.toISOString()));
    const known = { knownBreaches: ['Adobe'], knownAt: '2026-10-01T00:00:00.000Z' };
    await seen.ctx.updateProfile((p) => ({ ...p, ...known }));
    const r = await seen.h.news();
    expect(r).toMatchObject({ first: false, since: known.knownAt, others: 2, watchOn: false });
    expect(r.mine.map((b) => b.name)).toEqual(['LinkedIn']);
  });

  it('markNewsSeen remembers the list as the button does, and a refused save is said', async () => {
    const { h, profile } = setup();
    expect(await h.markNewsSeen()).toEqual({ seen: 4, at: NOW.toISOString() });
    expect(profile().knownBreaches).toEqual(['Adobe', 'LinkedIn', 'Twin1', 'Twin2']);
    const refused = setup({}, { updateProfile: () => Promise.resolve(false) });
    await expect(refused.h.markNewsSeen()).rejects.toThrow(/^WRITE_FAILED/);
  });

  it('watchOff unregisters then saves; off already is a no-op; a refused unregister is said and nothing saved', async () => {
    const on = setup();
    await on.ctx.updateProfile((p) => ({ ...p, watchOn: true, watchSig: 'sig' }));
    expect(await on.h.watchOff()).toEqual({ watchOn: false });
    expect(on.ctx.unregisterWatch).toHaveBeenCalledTimes(1);
    expect(on.profile()).toMatchObject({ watchOn: false, watchSig: '' });
    expect(await on.h.watchOff()).toEqual({ watchOn: false, already: true });

    const broken = setup({}, { unregisterWatch: () => Promise.reject(new Error('HOST_DOWN')) });
    await broken.ctx.updateProfile((p) => ({ ...p, watchOn: true }));
    await expect(broken.h.watchOff()).rejects.toThrow(/^WRITE_FAILED.*HOST_DOWN/);
    expect(broken.profile().watchOn).toBe(true);
  });
});
