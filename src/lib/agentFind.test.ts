import { describe, expect, it } from 'vitest';
import { findNamed, nameWords, type Named } from './agentFind';

const b = (name: string, title = name, domain = ''): Named<string> => ({ item: name, id: name, names: [name, title], aliases: domain ? [domain] : [], label: title });
const LIST = [b('Adobe', 'Adobe', 'adobe.com'), b('LinkedIn', 'LinkedIn', 'linkedin.com'), b('LinkedInScrape', 'LinkedIn Scraped Data', 'linkedin.com'), b('Dropbox', 'Dropbox', 'dropbox.com'), b('Twin1', 'Twin Shop', 'a.com'), b('Twin2', 'Twin Store', 'b.com')];
const kind = { code: 'NO_BREACH', noun: 'breach', plural: 'breaches' };

describe('a breach named the way a person says it', () => {
  it('folds case, accents, fillers, the web words and a plural', () => {
    expect(nameWords('la fuite LinkedIn')).toEqual(['linkedin']);
    expect(nameWords('www.Dropbox.com')).toEqual(['dropbo']);
    expect(nameWords('la filtración de Dropbox')).toEqual(['dropbo']);
  });

  it('its name, any case, a whole name, or every word of it', () => {
    expect(findNamed(LIST, 'twin1', kind)).toBe('Twin1');
    expect(findNamed(LIST, 'la fuite Adobe', kind)).toBe('Adobe');
    // « LinkedIn » is a whole name: it wins over the entry whose title holds the word.
    expect(findNamed(LIST, 'mon compte LinkedIn', kind)).toBe('LinkedIn');
    expect(findNamed(LIST, 'linkedin scraped', kind)).toBe('LinkedInScrape');
    expect(findNamed(LIST, 'twin shop', kind)).toBe('Twin1');
  });

  it('several matches are refused with their names, never the first taken', () => {
    expect(() => findNamed(LIST, 'twin', kind)).toThrow('AMBIGUOUS: "twin" names several breaches: Twin Shop, Twin Store; say which');
    // Said by the domain: the entry whose NAME it is wins over the other one on that domain.
    expect(findNamed(LIST, 'linkedin.com', kind)).toBe('LinkedIn');
    expect(findNamed(LIST, 'dropbox.com', kind)).toBe('Dropbox');
    // A domain alone, two entries on it, neither named so: refused with both.
    expect(() => findNamed([b('X1', 'Ex One', 'ex.io'), b('X2', 'Ex Two', 'ex.io')], 'ex.io', kind)).toThrow(/^AMBIGUOUS.*Ex One, Ex Two/);
  });

  it('no match lists the names, or says where to look when the list is too long to say', () => {
    expect(() => findNamed(LIST.slice(0, 2), 'Yahoo', kind)).toThrow('NO_BREACH: no breach named "Yahoo"; breaches: Adobe, LinkedIn');
    expect(() => findNamed(LIST, 'Yahoo', { ...kind, whereToLook: 'call catalogue' })).toThrow('NO_BREACH: no breach named "Yahoo"; call catalogue');
    expect(() => findNamed(LIST, 'la fuite', kind)).toThrow(/^NO_BREACH: "la fuite" names no breach/);
    expect(() => findNamed(LIST, '  ', kind)).toThrow(/^BAD_ARG/);
    expect(() => findNamed([], 'adobe', kind)).toThrow('breaches: none');
  });
});
