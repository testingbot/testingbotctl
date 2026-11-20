import { meter, relativeTime } from '../../src/ui/format';

describe('relativeTime', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  it.each([
    ['2026-11-20T11:59:50Z', 'just now'],
    ['2026-11-20T11:55:00Z', '5m ago'],
    ['2026-11-20T09:00:00Z', '3h ago'],
    ['2026-11-18T12:00:00Z', '2d ago'],
    ['2026-10-01T12:00:00Z', '2026-10-01'],
    ['not a date', 'not a date'],
  ])('%s → %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });
});

describe('meter', () => {
  it('fills in proportion and caps the width', () => {
    expect(meter(2, 5)).toBe('▰▰▱▱▱');
    expect(meter(0, 3)).toBe('▱▱▱');
    expect(meter(9, 5)).toBe('▰▰▰▰▰');
    expect(meter(25, 50)).toBe('▰▰▰▰▰▱▱▱▱▱');
    expect(meter(1, 0)).toBe('');
  });
});
