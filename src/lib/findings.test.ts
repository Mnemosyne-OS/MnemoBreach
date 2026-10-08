import { describe, it, expect } from 'vitest';
import { normalizeBreach, type Breach } from './breaches';
import {
  actionsFor, crossings, declare, firstActionAt, forgetEmail, isHandled, mergeFound, normalizeFindings,
  spanParts, timeline, toggleAction, undeclare, type Findings,
} from './findings';

const T0 = '2026-10-07T12:00:00.000Z';
const breach = (over: Record<string, unknown> = {}): Breach => normalizeBreach({
  Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', BreachDate: '2013-10-04', AddedDate: '2013-12-04T00:00:00Z',
  DataClasses: ['Email addresses', 'Passwords'], ...over,
})!;

describe('mergeFound / declare', () => {
  it('a search adds the breach with the email and the first-seen instant', () => {
    const f = mergeFound({}, 'a@x.io', [breach()], T0);
    expect(f.Adobe).toMatchObject({ source: 'found', emails: ['a@x.io'], firstSeenAt: T0 });
  });

  it('a second email in the same breach joins it, the first date stays', () => {
    let f = mergeFound({}, 'a@x.io', [breach()], T0);
    f = mergeFound(f, 'b@x.io', [breach()], '2026-10-08T00:00:00.000Z');
    expect(f.Adobe!.emails).toEqual(['a@x.io', 'b@x.io']);
    expect(f.Adobe!.firstSeenAt).toBe(T0);
  });

  it('a declared breach later found becomes found and keeps its date and actions', () => {
    let f = declare({}, breach(), '2026-01-01T00:00:00.000Z');
    f = toggleAction(f, 'Adobe', 'password', '2026-02-01T00:00:00.000Z');
    f = mergeFound(f, 'a@x.io', [breach()], T0);
    expect(f.Adobe).toMatchObject({ source: 'found', firstSeenAt: '2026-01-01T00:00:00.000Z', emails: ['a@x.io'] });
    expect(f.Adobe!.actions.password).toBe('2026-02-01T00:00:00.000Z');
  });

  it('declaring a breach already there changes nothing', () => {
    const f = mergeFound({}, 'a@x.io', [breach()], T0);
    expect(declare(f, breach(), '2027-01-01T00:00:00.000Z')).toBe(f);
  });

  it('only a declared finding can be taken back; a found one is evidence', () => {
    const d = declare({}, breach(), T0);
    expect(undeclare(d, 'Adobe')).toEqual({});
    const found = mergeFound({}, 'a@x.io', [breach()], T0);
    expect(undeclare(found, 'Adobe')).toBe(found);
  });

  it('forgetting an email drops it, and a found finding left empty disappears', () => {
    let f = mergeFound({}, 'a@x.io', [breach()], T0);
    f = mergeFound(f, 'a@x.io', [breach({ Name: 'Other', Title: 'Other' })], T0);
    f = mergeFound(f, 'b@x.io', [breach({ Name: 'Other', Title: 'Other' })], T0);
    f = declare(f, breach({ Name: 'Mine', Title: 'Mine' }), T0);
    const g = forgetEmail(f, 'a@x.io');
    expect(Object.keys(g).sort()).toEqual(['Mine', 'Other']);
    expect(g.Other!.emails).toEqual(['b@x.io']);
  });
});

describe('actions', () => {
  it('apply according to what leaked; 2FA always applies', () => {
    const f = mergeFound({}, 'a@x.io', [breach({ DataClasses: ['Email addresses', 'Passwords', 'Phone numbers', 'Physical addresses'] })], T0).Adobe!;
    expect(actionsFor(f)).toEqual(['password', 'twoFactor', 'phishing', 'calls', 'mail']);
    const g = mergeFound({}, 'a@x.io', [breach({ DataClasses: ['IP addresses'] })], T0).Adobe!;
    expect(actionsFor(g)).toEqual(['twoFactor']);
  });

  it('toggling marks then unmarks, dated; handled only when all are done', () => {
    let f: Findings = mergeFound({}, 'a@x.io', [breach()], T0);
    f = toggleAction(f, 'Adobe', 'password', '2026-10-08T00:00:00.000Z');
    expect(isHandled(f.Adobe!)).toBe(false);
    f = toggleAction(f, 'Adobe', 'twoFactor', '2026-10-09T00:00:00.000Z');
    f = toggleAction(f, 'Adobe', 'phishing', '2026-10-09T00:00:00.000Z');
    expect(isHandled(f.Adobe!)).toBe(true);
    expect(firstActionAt(f.Adobe!)).toBe('2026-10-08T00:00:00.000Z');
    f = toggleAction(f, 'Adobe', 'password', '2026-10-10T00:00:00.000Z');
    expect(f.Adobe!.actions.password).toBeUndefined();
  });
});

describe('normalizeFindings', () => {
  it('keeps a valid record and drops the unreadable, never guessing a date', () => {
    const good = mergeFound({}, 'a@x.io', [breach()], T0);
    const raw = {
      ...JSON.parse(JSON.stringify(good)),
      Bad1: { name: 'Bad1', source: 'found', firstSeenAt: 'yesterday' },
      Bad2: { name: 'Other', source: 'found', firstSeenAt: T0 },
      Bad3: { name: 'Bad3', source: 'guess', firstSeenAt: T0 },
      Odd: { name: 'Odd', source: 'declared', firstSeenAt: T0, breachDate: '2013', actions: { password: 'never', twoFactor: T0, hack: T0 } },
    };
    const f = normalizeFindings(raw);
    expect(Object.keys(f).sort()).toEqual(['Adobe', 'Odd']);
    expect(f.Odd!.breachDate).toBeNull();
    expect(f.Odd!.actions).toEqual({ twoFactor: T0 });
    expect(normalizeFindings([1])).toEqual({});
  });
});

describe('crossings', () => {
  it('names breaches holding several of your emails, and those that leaked contact data', () => {
    let f = mergeFound({}, 'a@x.io', [breach()], T0);
    f = mergeFound(f, 'b@x.io', [breach()], T0);
    f = mergeFound(f, 'a@x.io', [breach({ Name: 'Tel', Title: 'Tel', DataClasses: ['Email addresses', 'Phone numbers'] })], T0);
    f = declare(f, breach({ Name: 'Decl', Title: 'Decl', DataClasses: ['Phone numbers'] }), T0);
    const c = crossings(f);
    expect(c.multiEmail.map((x) => x.name)).toEqual(['Adobe']);
    expect(c.contactWithEmail.map((x) => x.name)).toEqual(['Tel']);
  });
});

describe('timeline', () => {
  const now = new Date('2026-10-07T00:00:00Z');

  it('no dated finding: no axis, never a made-up year', () => {
    const f = declare({}, breach({ BreachDate: null }), T0);
    const t = timeline(f, now);
    expect(t).toMatchObject({ rows: [], fromYear: null, toYear: null });
    expect(t.undated.map((x) => x.name)).toEqual(['Adobe']);
  });

  it('places breach, publication, first-seen and action on one axis, oldest first', () => {
    let f = mergeFound({}, 'a@x.io', [breach(), breach({ Name: 'New', Title: 'New', BreachDate: '2024-01-01', AddedDate: null })], T0);
    f = toggleAction(f, 'Adobe', 'password', '2014-10-04T00:00:00.000Z');
    const t = timeline(f, now);
    expect(t.fromYear).toBe(2013);
    expect(t.toYear).toBe(2026);
    expect(t.rows.map((r) => r.finding.name)).toEqual(['Adobe', 'New']);
    const [a, n] = t.rows;
    expect(a!.breachX).toBeGreaterThan(0);
    expect(a!.addedX!).toBeGreaterThan(a!.breachX);
    expect(a!.actionX!).toBeGreaterThan(a!.addedX!);
    expect(a!.exposedDays).toBe(365);
    expect(n!.addedX).toBeNull();
    expect(n!.actionX).toBeNull();
    expect(a!.endX).toBe(a!.actionX);
    expect(n!.endX).toBeGreaterThan(n!.breachX);
    expect(n!.endX).toBeLessThanOrEqual(1);
    // No action: exposed until today.
    expect(n!.exposedDays).toBe(Math.floor((now.getTime() - Date.parse('2024-01-01T00:00:00Z')) / 86_400_000));
    expect(n!.learnedAfterDays).toBe(Math.floor((Date.parse(T0) - Date.parse('2024-01-01T00:00:00Z')) / 86_400_000));
  });

  it('every position stays inside the axis', () => {
    const f = mergeFound({}, 'a@x.io', [breach({ BreachDate: '2030-01-01' })], T0);
    for (const r of timeline(f, now).rows) {
      for (const v of [r.breachX, r.seenX, r.addedX ?? 0]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('spanParts', () => {
  it('keeps only the largest unit', () => {
    expect(spanParts(2400)).toEqual({ unit: 'years', n: 6 });
    expect(spanParts(95)).toEqual({ unit: 'months', n: 3 });
    expect(spanParts(3)).toEqual({ unit: 'days', n: 3 });
  });
});

describe('HIBP flags on a finding (verification T3)', () => {
  it('a spam list or fake breach keeps its flag, declared or found, and reads back', () => {
    const spam = breach({ Name: 'Spam', Title: 'Spam', IsSpamList: true });
    const fake = breach({ Name: 'Fake', Title: 'Fake', IsFabricated: true, IsSpamList: true });
    let f = declare({}, spam, T0);
    f = mergeFound(f, 'a@x.io', [fake], T0);
    expect(f.Spam!.flag).toBe('spamList');
    expect(f.Fake!.flag).toBe('fabricated');
    expect(normalizeFindings(JSON.parse(JSON.stringify(f))).Spam!.flag).toBe('spamList');
    expect(normalizeFindings({ X: { name: 'X', source: 'declared', firstSeenAt: T0, flag: 'weird' } }).X!.flag).toBeNull();
    expect(mergeFound({}, 'a@x.io', [breach()], T0).Adobe!.flag).toBeNull();
  });
});

describe('infections (decision 07/10)', () => {
  it('a stealer log asks for an antivirus and every password, never "this service"', () => {
    const f = declare({}, breach({ Name: 'Stealer', Title: 'Stealer Logs', Domain: '', IsStealerLog: true }), T0).Stealer!;
    expect(f.infection).toBe(true);
    expect(actionsFor(f)).toEqual(['antivirus', 'allPasswords', 'twoFactor', 'phishing']);
    expect(actionsFor(f)).not.toContain('password');
    expect(normalizeFindings(JSON.parse(JSON.stringify({ Stealer: f }))).Stealer!.infection).toBe(true);
  });
});
