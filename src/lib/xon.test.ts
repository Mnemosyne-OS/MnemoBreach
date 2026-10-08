import { describe, it, expect, vi } from 'vitest';
import { normalizeBreach } from './breaches';
import { lookupXon, readXon, toBreach, XON_URL } from './xon';
import { formatBreachDay } from './format';
import { chronicleText } from './memory';

// Shapes copied from the real answers measured on 07/10 (test address).
const DETAIL = {
  breach: 'McKesson', domain: 'mckesson.com', xposed_date: '2026', xposed_records: 6832822, verified: 'Yes',
  xposed_data: 'Email addresses;Names;Phone numbers;Physical addresses;Dates of birth;Genders',
  details: 'McKesson, a healthcare company, was targeted in August 2026.',
};
const HIBP = normalizeBreach({ Name: 'McKesson', Title: 'McKesson', Domain: 'mckesson.com', BreachDate: '2026-08-21', DataClasses: ['Email addresses', 'Names'] })!;
const T0 = () => new Date('2026-10-07T00:00:00Z');

describe('toBreach', () => {
  it('one HIBP twin (same domain, same year) replaces the entry: day-precise, HIBP name', () => {
    expect(toBreach(DETAIL, [HIBP])).toBe(HIBP);
  });

  it('no twin: its own entry, named apart, known at the year only', () => {
    const b = toBreach(DETAIL, [])!;
    expect(b.name).toBe('xon:McKesson');
    expect(b.datePrecision).toBe('year');
    expect(b.dataClasses).toContain('Phone numbers');
    expect(b.pwnCount).toBe(6832822);
    expect(formatBreachDay(b.breachDate, 'en', b.datePrecision)).toBe('2026');
  });

  it('two twins in the same year is ambiguous: never guessed', () => {
    const other = { ...HIBP, name: 'McKesson2' };
    expect(toBreach(DETAIL, [HIBP, other])!.name).toBe('xon:McKesson');
  });

  it('a twin in another year is not a twin', () => {
    expect(toBreach({ ...DETAIL, xposed_date: '2019' }, [HIBP])!.name).toBe('xon:McKesson');
  });

  it('no year: no date at all, never a made-up one', () => {
    const b = toBreach({ ...DETAIL, xposed_date: 'soon' }, [])!;
    expect(b.breachDate).toBeNull();
  });

  it('an entry with no name is dropped', () => {
    expect(toBreach({ ...DETAIL, breach: '' }, [])).toBeNull();
  });
});

describe('readXon', () => {
  it('ExposedBreaches null is "absent"; a shape it cannot read is undefined, never absent', () => {
    expect(readXon({ ExposedBreaches: null }, [])).toBeNull();
    expect(readXon({ nothing: 1 }, [])).toBeUndefined();
    expect(readXon('x', [])).toBeUndefined();
  });

  it('twins are not listed twice', () => {
    expect(readXon({ ExposedBreaches: { breaches_details: [DETAIL, DETAIL] } }, [HIBP])).toEqual([HIBP]);
  });
});

describe('lookupXon', () => {
  it('sends the encoded email to XposedOrNot, and says which source answered', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ExposedBreaches: { breaches_details: [DETAIL] } }))));
    const r = await lookupXon('a+b@x.io', { fetcher, now: T0 });
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe(`${XON_URL}a%2Bb%40x.io`);
    expect(r).toMatchObject({ kind: 'found', via: 'xon' });
  });

  it('absent is dated and credited', async () => {
    const r = await lookupXon('a@x.io', { fetcher: () => Promise.resolve(new Response(JSON.stringify({ ExposedBreaches: null }))), now: T0 });
    expect(r).toEqual({ kind: 'absent', checkedAt: '2026-10-07T00:00:00.000Z', via: 'xon' });
  });

  it('a network failure, a 429 and garbage are errors, never "absent"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await lookupXon('a@x.io', { fetcher: () => Promise.reject(new TypeError('x')) })).toEqual({ kind: 'error', code: 'NETWORK' });
    expect(await lookupXon('a@x.io', { fetcher: () => Promise.resolve(new Response('', { status: 429 })) })).toEqual({ kind: 'error', code: 'RATE_LIMITED' });
    expect(await lookupXon('a@x.io', { fetcher: () => Promise.resolve(new Response('<html>')) })).toEqual({ kind: 'error', code: 'BAD_RESPONSE' });
    expect(await lookupXon('a@x.io', { fetcher: () => Promise.resolve(new Response('{}')) })).toEqual({ kind: 'error', code: 'BAD_RESPONSE' });
  });

  it('never puts the email in a log line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await lookupXon('secret.person@x.io', { fetcher: () => Promise.reject(new TypeError('secret.person@x.io')) });
    await lookupXon('secret.person@x.io', { fetcher: () => Promise.resolve(new Response('', { status: 500 })) });
    for (const call of warn.mock.calls) expect(JSON.stringify(call)).not.toContain('secret.person');
  });

  it('the remembered chronicle names XposedOrNot and gives the year alone', () => {
    const b = toBreach(DETAIL, [])!;
    const text = chronicleText('a@x.io', { kind: 'found', breaches: [b], checkedAt: '2026-10-07T00:00:00.000Z', via: 'xon' })!;
    expect(text).toContain('source: XposedOrNot');
    expect(text).toContain('breached in 2026');
    expect(text).not.toContain('2026-07-01');
  });
});
