import { describe, it, expect } from 'vitest';
import { translate } from '../i18n/useI18n';

describe('translate', () => {
  it('uses the _one variant for a count of exactly 1, the plain key otherwise', () => {
    expect(translate('news.mine', { count: 1 })).toBe('1 new breach on a service of your timeline:');
    expect(translate('news.mine', { count: 2 })).toBe('2 new breaches on a service of your timeline:');
    expect(translate('news.mine', { count: 0 })).toBe('0 new breaches on a service of your timeline:');
  });

  it('a key with no _one variant keeps working at 1', () => {
    expect(translate('timeline.counts', { count: 1, open: 1, done: 0 })).toBe('1 to handle · 0 handled');
  });

  it('a missing key shows itself, visibly wrong', () => {
    expect(translate('nope.nothing')).toBe('nope.nothing');
  });
});
