import { describe, it, expect } from 'vitest';
import { formatBreachDay, formatDay } from './format';

describe('formatBreachDay', () => {
  it('a date on the 1st is shown at the month, never a made-up day', () => {
    expect(formatBreachDay('2015-03-01', 'en')).toBe('March 2015');
    expect(formatBreachDay('2015-03-01', 'fr')).toBe('mars 2015');
  });

  it('any other day is shown in full, and absent stays a dash', () => {
    expect(formatBreachDay('2013-10-04', 'en')).toBe(formatDay('2013-10-04', 'en'));
    expect(formatBreachDay(null, 'en')).toBe('—');
    expect(formatBreachDay('nonsense-01', 'en')).toBe('—');
  });
});
