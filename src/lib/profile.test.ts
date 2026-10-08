import { describe, it, expect } from 'vitest';
import { addIdentifier, normalizeProfile, removeIdentifier, stateOf, EMPTY_PROFILE, MAX_PER_KIND } from './profile';
import { maskEmail, maskPhone, normalizePhone } from './mask';

describe('mask', () => {
  it('an email keeps its first letter and domain', () => {
    expect(maskEmail('tony@gmail.com')).toBe('t***@gmail.com');
  });

  it('a one-letter local part shows no letter at all', () => {
    expect(maskEmail('t@gmail.com')).toBe('***@gmail.com');
  });

  it('a phone keeps its country code and last two digits', () => {
    expect(maskPhone('+33612345678')).toBe('+33 ******* 78');
    expect(maskPhone('0612345678')).toBe('******** 78');
  });

  it('a mask never contains the hidden digits', () => {
    expect(maskPhone('+33612345678')).not.toContain('123456');
  });

  it('normalizePhone keeps + and digits, refuses too short or too long', () => {
    expect(normalizePhone(' +33 6 12-34.56.78 ')).toBe('+33612345678');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('1'.repeat(16))).toBeNull();
  });
});

describe('profile', () => {
  it('re-normalises any blob on read: junk dropped, emails lowercased, duplicates merged', () => {
    expect(normalizeProfile({ emails: ['Tony@Gmail.com', 'tony@gmail.com', 'nope', 3], phones: ['+33 6 12 34 56 78', 'x'] }))
      .toEqual({ emails: ['tony@gmail.com'], phones: ['+33612345678'], memory: {}, doorOpened: false, findings: {}, knownBreaches: [], knownAt: null, watchOn: false, watchSig: '' });
    expect(normalizeProfile('garbage')).toEqual(EMPTY_PROFILE);
  });

  it('caps each kind', () => {
    const many = Array.from({ length: 15 }, (_, i) => `a${i}@x.io`);
    expect(normalizeProfile({ emails: many }).emails).toHaveLength(MAX_PER_KIND);
  });

  it('adds an email or a phone, refuses invalid and duplicate', () => {
    let p = EMPTY_PROFILE;
    const a = addIdentifier(p, 'Tony@Gmail.com');
    expect(a.ok).toBe(true);
    if (a.ok) p = a.profile;
    expect(p.emails).toEqual(['tony@gmail.com']);
    expect(addIdentifier(p, 'tony@gmail.com')).toEqual({ ok: false, code: 'DUPLICATE' });
    expect(addIdentifier(p, 'not an id')).toEqual({ ok: false, code: 'INVALID' });
    const b = addIdentifier(p, '+33 6 12 34 56 78');
    expect(b.ok && b.profile.phones).toEqual(['+33612345678']);
  });

  it('refuses past the cap', () => {
    const full = { emails: Array.from({ length: MAX_PER_KIND }, (_, i) => `a${i}@x.io`), phones: [], memory: {}, doorOpened: false, findings: {}, knownBreaches: [], knownAt: null, watchOn: false, watchSig: '' };
    expect(addIdentifier(full, 'new@x.io')).toEqual({ ok: false, code: 'FULL' });
  });

  it('removes one identifier', () => {
    expect(removeIdentifier({ emails: ['a@x.io', 'b@x.io'], phones: ['+33612345678'], memory: { 'a@x.io': 4 }, doorOpened: true, findings: {}, knownBreaches: [], knownAt: null, watchOn: false, watchSig: '' }, 'a@x.io'))
      .toEqual({ emails: ['b@x.io'], phones: ['+33612345678'], memory: { 'a@x.io': 4 }, doorOpened: true, findings: {}, knownBreaches: [], knownAt: null, watchOn: false, watchSig: '' });
  });

  it('keeps only positive integer chronicle ids in memory', () => {
    expect(normalizeProfile({ emails: [], memory: { 'a@x.io': 7, 'b@x.io': 0, 'c@x.io': '3', d: 1.5 } }).memory)
      .toEqual({ 'a@x.io': 7 });
    expect(normalizeProfile({ memory: [1, 2] }).memory).toEqual({});
  });

  it('lot 4 fields: known names deduped, a bad date is null, the watch only by an explicit true', () => {
    const p = normalizeProfile({ knownBreaches: ['A', 'A', 3, 'B'], knownAt: 'soon', watchOn: 'yes', watchSig: 7 });
    expect(p.knownBreaches).toEqual(['A', 'B']);
    expect(p.knownAt).toBeNull();
    expect(p.watchOn).toBe(false);
    expect(p.watchSig).toBe('');
  });

  it('the door is opened only by an explicit true', () => {
    expect(normalizeProfile({ doorOpened: true }).doorOpened).toBe(true);
    expect(normalizeProfile({ doorOpened: 'yes' }).doorOpened).toBe(false);
    expect(normalizeProfile(null).doorOpened).toBe(false);
  });

  it('reads the host envelope; an empty store is null', () => {
    expect(stateOf({ state: { emails: [] }, updatedAt: 1 })).toEqual({ emails: [] });
    expect(stateOf(null)).toBeNull();
  });
});

describe('removing an identifier reaches the findings (verification M33)', () => {
  it('the email leaves every found breach, and a found breach left empty disappears', () => {
    const p = normalizeProfile({
      emails: ['a@x.io', 'b@x.io'],
      findings: {
        Both: { name: 'Both', source: 'found', emails: ['a@x.io', 'b@x.io'], firstSeenAt: '2026-10-07T00:00:00.000Z' },
        Only: { name: 'Only', source: 'found', emails: ['a@x.io'], firstSeenAt: '2026-10-07T00:00:00.000Z' },
      },
    });
    const next = removeIdentifier(p, 'a@x.io');
    expect(Object.keys(next.findings)).toEqual(['Both']);
    expect(next.findings.Both!.emails).toEqual(['b@x.io']);
  });
});
