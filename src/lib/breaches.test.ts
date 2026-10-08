import { describe, it, expect } from 'vitest';
import {
  compareBreaches, fetchCatalogue, htmlToText, normalizeBreach, normalizeBreaches,
  searchBreaches, severityOf, splitFlagged, yearOf,
} from './breaches';

// Shape copied from the real answer measured on 2026-10-07 (000webhost entry).
const RAW = {
  Name: '000webhost', Title: '000webhost', Domain: '000webhost.com',
  BreachDate: '2015-03-01', AddedDate: '2015-10-26T23:35:45Z', PwnCount: 14936670,
  Description: 'In approximately March 2015, <a href="http://x">000webhost suffered a breach</a> &amp; more.',
  DataClasses: ['Email addresses', 'IP addresses', 'Names', 'Passwords'],
  IsVerified: true, IsFabricated: false, IsSensitive: false, IsRetired: false, IsSpamList: false,
};

describe('normalizeBreach', () => {
  it('keeps the fields the screen uses, dates as days', () => {
    const b = normalizeBreach(RAW)!;
    expect(b.breachDate).toBe('2015-03-01');
    expect(b.addedDate).toBe('2015-10-26');
    expect(b.pwnCount).toBe(14936670);
    expect(b.description).toBe('In approximately March 2015, 000webhost suffered a breach & more.');
  });

  it('a missing or impossible date is ABSENT, never the 1st of January', () => {
    expect(normalizeBreach({ ...RAW, BreachDate: undefined })!.breachDate).toBeNull();
    expect(normalizeBreach({ ...RAW, BreachDate: '2015-02-30' })!.breachDate).toBeNull();
    expect(normalizeBreach({ ...RAW, AddedDate: 'soon' })!.addedDate).toBeNull();
  });

  it('a missing count is null, never 0', () => {
    expect(normalizeBreach({ ...RAW, PwnCount: undefined })!.pwnCount).toBeNull();
    expect(normalizeBreach({ ...RAW, PwnCount: -1 })!.pwnCount).toBeNull();
  });

  it('an entry without a name is dropped', () => {
    expect(normalizeBreach({ ...RAW, Name: '' })).toBeNull();
    expect(normalizeBreach(null)).toBeNull();
  });

  it('title falls back to the name, never blank', () => {
    expect(normalizeBreach({ ...RAW, Title: '  ' })!.title).toBe('000webhost');
  });
});

describe('htmlToText', () => {
  it('drops tags and decodes entities, so no third-party markup reaches the screen', () => {
    expect(htmlToText('<script>x</script>a &lt;b&gt; &#39;c&#x27;')).toBe("xa <b> 'c'");
  });
});

describe('normalizeBreaches / compareBreaches', () => {
  it('a body that is not a list is null, never an empty catalogue', () => {
    expect(normalizeBreaches({ error: 'x' })).toBeNull();
  });

  it('most recent first, undated last', () => {
    const list = normalizeBreaches([
      { ...RAW, Name: 'old', BreachDate: '2010-01-01' },
      { ...RAW, Name: 'none', BreachDate: null },
      { ...RAW, Name: 'new', BreachDate: '2024-05-01' },
    ])!;
    expect(list.map((b) => b.name)).toEqual(['new', 'old', 'none']);
  });

  it('two undated breaches are ordered by title', () => {
    const a = normalizeBreach({ ...RAW, Name: 'b', Title: 'B', BreachDate: null })!;
    const b = normalizeBreach({ ...RAW, Name: 'a', Title: 'A', BreachDate: null })!;
    expect(compareBreaches(a, b)).toBeGreaterThan(0);
  });
});

describe('severityOf', () => {
  it('password beats contact beats email', () => {
    expect(severityOf(['Email addresses', 'Passwords', 'Phone numbers'])).toBe('password');
    expect(severityOf(['Email addresses', 'Phone numbers'])).toBe('contact');
    expect(severityOf(['Email addresses', 'Physical addresses'])).toBe('contact');
    expect(severityOf(['Email addresses'])).toBe('email');
    expect(severityOf(['IP addresses'])).toBe('other');
  });
});

describe('searchBreaches / splitFlagged / yearOf', () => {
  const list = normalizeBreaches([
    { ...RAW, Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com' },
    { ...RAW, Name: 'Societe', Title: 'Société Générale', Domain: 'sg.fr', IsFabricated: true },
    { ...RAW, Name: 'Spam', Title: 'Spam list', Domain: '', IsSpamList: true, BreachDate: null },
  ])!;

  it('matches title, name or domain, ignoring case and accents', () => {
    expect(searchBreaches(list, 'ADOBE.COM').map((b) => b.name)).toEqual(['Adobe']);
    expect(searchBreaches(list, 'societe').map((b) => b.name)).toEqual(['Societe']);
    expect(searchBreaches(list, '  ')).toHaveLength(3);
  });

  it('fabricated and spam lists are kept apart from real breaches', () => {
    const { real, flagged } = splitFlagged(list);
    expect(real.map((b) => b.name)).toEqual(['Adobe']);
    expect(flagged.map((b) => b.name).sort()).toEqual(['Societe', 'Spam']);
  });

  it('a breach without a date has no year', () => {
    expect(yearOf(list.find((b) => b.name === 'Spam')!)).toBeNull();
    expect(yearOf(list[0]!)).toBe('2015');
  });
});

describe('fetchCatalogue', () => {
  it('ok carries the list and when it was read', async () => {
    const r = await fetchCatalogue({
      fetcher: () => Promise.resolve(new Response(JSON.stringify([RAW]))),
      now: () => new Date('2026-10-07T00:00:00Z'),
    });
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.fetchedAt).toBe('2026-10-07T00:00:00.000Z');
  });

  it('a network failure, a 429, non-JSON and a non-list are each an error', async () => {
    expect(await fetchCatalogue({ fetcher: () => Promise.reject(new TypeError('x')) })).toEqual({ kind: 'error', code: 'NETWORK' });
    expect(await fetchCatalogue({ fetcher: () => Promise.resolve(new Response('', { status: 429 })) })).toEqual({ kind: 'error', code: 'RATE_LIMITED' });
    expect(await fetchCatalogue({ fetcher: () => Promise.resolve(new Response('<html>')) })).toEqual({ kind: 'error', code: 'BAD_RESPONSE' });
    expect(await fetchCatalogue({ fetcher: () => Promise.resolve(new Response('{}')) })).toEqual({ kind: 'error', code: 'BAD_RESPONSE' });
  });
});

describe('severity, five tiers (decision 07/10)', () => {
  it('"email" only when nothing but the email leaked', () => {
    expect(severityOf(['Email addresses'])).toBe('email');
    expect(severityOf(['Email addresses', 'Names'])).toBe('other');
    expect(severityOf([])).toBe('other');
  });

  it('identity, money, health and private life are "sensitive", under passwords only', () => {
    expect(severityOf(['Email addresses', "Driver's licenses"])).toBe('sensitive');
    expect(severityOf(['Email addresses', 'Partial credit card data', 'Phone numbers'])).toBe('sensitive');
    expect(severityOf(['Email addresses', 'Sexual orientations'])).toBe('sensitive');
    expect(severityOf(['Passwords', 'Personal health data'])).toBe('password');
  });

  it('a stealer log or malware entry is an infection', () => {
    expect(normalizeBreach({ ...RAW, IsStealerLog: true })!.infection).toBe(true);
    expect(normalizeBreach({ ...RAW, IsMalware: true })!.infection).toBe(true);
    expect(normalizeBreach(RAW)!.infection).toBe(false);
  });
});
