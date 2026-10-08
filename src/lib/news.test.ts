import { describe, it, expect } from 'vitest';
import { normalizeBreach, type Breach } from './breaches';
import { declare } from './findings';
import { diffCatalogue, HIBP_DOMAIN_URL, knownNames, MAX_WATCH_TARGETS, WATCH_LABEL, watchPlan } from './news';

const T0 = '2026-10-07T00:00:00.000Z';
const b = (name: string, domain: string, date = '2020-01-01'): Breach =>
  normalizeBreach({ Name: name, Title: name, Domain: domain, BreachDate: date, DataClasses: ['Email addresses'] })!;

describe('diffCatalogue', () => {
  it('the first observation announces nothing', () => {
    expect(diffCatalogue([], [b('A', 'a.com'), b('B', 'b.com')], {})).toEqual({ first: true, mine: [], others: [] });
  });

  it('new names only, split by whether the service is on the timeline', () => {
    const findings = declare({}, b('Chess', 'chess.com', '2023-11-08'), T0);
    const d = diffCatalogue(['Chess', 'Old'], [b('Chess', 'chess.com'), b('Old', 'old.com'), b('Chess2026', 'Chess.com'), b('Zara', 'zara.com')], findings);
    expect(d.first).toBe(false);
    expect(d.mine.map((x) => x.name)).toEqual(['Chess2026']);
    expect(d.others.map((x) => x.name)).toEqual(['Zara']);
  });

  it('a new breach with no domain is never "on your timeline"', () => {
    const findings = declare({}, b('NoDomain', '', '2020-01-01'), T0);
    expect(diffCatalogue(['X'], [b('Fresh', '')], findings).mine).toEqual([]);
  });

  it('knownNames keeps every name', () => {
    expect(knownNames([b('A', 'a.com'), b('B', 'b.com')])).toEqual(['A', 'B']);
  });
});

describe('watchPlan', () => {
  it('one json target per distinct domain, reading Name and Title from a root array', () => {
    let f = declare({}, b('Chess', 'chess.com', '2023-11-08'), T0);
    f = declare(f, b('Chess2026', 'Chess.com', '2026-08-03'), T0);
    f = declare(f, b('Adobe', 'adobe.com', '2013-10-04'), T0);
    const p = watchPlan(f);
    expect(p.targets.map((t) => t.url)).toEqual([`${HIBP_DOMAIN_URL}chess.com`, `${HIBP_DOMAIN_URL}adobe.com`]);
    expect(p.targets[0]!.spec).toEqual({ mode: 'json', arrayPath: '', idField: 'Name', labelField: 'Title' });
    expect(p.skipped).toBe(0);
  });

  it('never sends anything but the domain: no email in any url', () => {
    const f = declare({}, b('Weird', 'a b&c.com'), T0);
    expect(watchPlan(f).targets[0]!.url).toBe(`${HIBP_DOMAIN_URL}a%20b%26c.com`);
  });

  it('keeps the most recent services under the cap and says how many are left out', () => {
    let f = {};
    for (let i = 0; i < MAX_WATCH_TARGETS + 3; i++) f = declare(f, b(`S${i}`, `s${i}.com`, `20${String(10 + i).padStart(2, '0')}-01-01`), T0);
    const p = watchPlan(f);
    expect(p.targets).toHaveLength(MAX_WATCH_TARGETS);
    expect(p.skipped).toBe(3);
    expect(p.targets[0]!.url).toBe(`${HIBP_DOMAIN_URL}s${MAX_WATCH_TARGETS + 2}.com`);
  });

  it('the signature ignores order and changes with the set', () => {
    const a = declare(declare({}, b('A', 'a.com', '2020-01-01'), T0), b('B', 'b.com', '2021-01-01'), T0);
    const c = declare(declare({}, b('B', 'b.com', '2021-01-01'), T0), b('A', 'a.com', '2020-01-01'), T0);
    expect(watchPlan(a).signature).toBe(watchPlan(c).signature);
    expect(watchPlan(declare(a, b('C', 'c.com'), T0)).signature).not.toBe(watchPlan(a).signature);
  });

  it('the notification label never names the service', () => {
    const p = watchPlan(declare({}, b('Dating', 'dating.example'), T0));
    expect(p.targets[0]!.label).toBe(WATCH_LABEL);
    expect(p.targets[0]!.label).not.toContain('dating');
  });

  it('no domain on the timeline: no target', () => {
    expect(watchPlan({}).targets).toEqual([]);
  });
});
