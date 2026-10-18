import { describe, expect, it } from 'vitest';

import {
  describeRecurrence,
  formatRecurrence,
  matchesRecurrence,
  nextOccurrence,
  parseRecurrence,
} from '@/lib/recurrence';

describe('formatRecurrence / parseRecurrence', () => {
  it('round-trips every supported shape', () => {
    const rules = [
      'FREQ=DAILY',
      'FREQ=DAILY;INTERVAL=3',
      'FREQ=WEEKLY',
      'FREQ=WEEKLY;BYDAY=MO,TH',
      'FREQ=MONTHLY;BYMONTHDAY=15',
      'FREQ=YEARLY',
    ];

    for (const rule of rules) {
      expect(formatRecurrence(parseRecurrence(rule)!)).toBe(rule);
    }
  });

  it('ignores an unparseable rule instead of throwing', () => {
    expect(parseRecurrence(null)).toBeNull();
    expect(parseRecurrence('')).toBeNull();
    expect(parseRecurrence('FREQ=HOURLY')).toBeNull();
    expect(parseRecurrence('basura')).toBeNull();
  });

  it('rejects INTERVAL=0 and negative values', () => {
    expect(parseRecurrence('FREQ=DAILY;INTERVAL=0')?.interval).toBe(1);
    expect(parseRecurrence('FREQ=DAILY;INTERVAL=-2')?.interval).toBe(1);
  });

  it('sorts BYDAY so the stored value is stable', () => {
    expect(formatRecurrence(parseRecurrence('FREQ=WEEKLY;BYDAY=TH,MO')!)).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TH',
    );
  });
});

describe('describeRecurrence', () => {
  it('reads naturally in Spanish', () => {
    expect(describeRecurrence({ freq: 'DAILY', interval: 1 })).toBe('todos los días');
    expect(describeRecurrence({ freq: 'DAILY', interval: 3 })).toBe('cada 3 días');
    expect(describeRecurrence({ freq: 'WEEKLY', interval: 1 })).toBe('todas las semanas');
    expect(describeRecurrence({ freq: 'WEEKLY', interval: 1, byDay: [1] })).toBe('cada lunes');
    expect(describeRecurrence({ freq: 'WEEKLY', interval: 1, byDay: [1, 4] })).toBe(
      'los lunes, jueves',
    );
    expect(describeRecurrence({ freq: 'WEEKLY', interval: 2, byDay: [1] })).toBe(
      'cada 2 semanas, cada lunes',
    );
    expect(describeRecurrence({ freq: 'MONTHLY', interval: 1 })).toBe('todos los meses');
    expect(describeRecurrence({ freq: 'YEARLY', interval: 1 })).toBe('todos los años');
  });
});

describe('nextOccurrence', () => {
  it('moves a daily task to the following day', () => {
    expect(nextOccurrence({ freq: 'DAILY', interval: 1 }, '2026-01-15')).toBe('2026-01-16');
  });

  it('respects the interval', () => {
    expect(nextOccurrence({ freq: 'DAILY', interval: 3 }, '2026-01-15')).toBe('2026-01-18');
  });

  it('never returns a date on or before `after`', () => {
    // A daily task due yesterday, completed today, must land tomorrow — not
    // today, which would make it look like it was never done.
    expect(nextOccurrence({ freq: 'DAILY', interval: 1 }, '2026-01-14', '2026-01-15')).toBe(
      '2026-01-16',
    );
    expect(nextOccurrence({ freq: 'DAILY', interval: 1 }, '2026-01-01', '2026-01-20')).toBe(
      '2026-01-21',
    );
  });

  it('picks the next matching weekday for weekly rules', () => {
    // 2026-01-15 is a Thursday.
    expect(nextOccurrence({ freq: 'WEEKLY', interval: 1 }, '2026-01-15')).toBe('2026-01-22');
    expect(nextOccurrence({ freq: 'WEEKLY', interval: 1, byDay: [1, 4] }, '2026-01-15')).toBe(
      '2026-01-19',
    );
    expect(nextOccurrence({ freq: 'WEEKLY', interval: 1, byDay: [1] }, '2026-01-19')).toBe(
      '2026-01-26',
    );
  });

  it('clamps monthly rules to short months', () => {
    expect(nextOccurrence({ freq: 'MONTHLY', interval: 1 }, '2026-01-15')).toBe('2026-02-15');
    expect(
      nextOccurrence({ freq: 'MONTHLY', interval: 1, byMonthDay: 31 }, '2026-01-31'),
    ).toBe('2026-02-28');
    // 2028 is a leap year.
    expect(
      nextOccurrence({ freq: 'MONTHLY', interval: 1, byMonthDay: 31 }, '2028-01-31'),
    ).toBe('2028-02-29');
  });

  it('advances yearly rules without shifting the day', () => {
    expect(nextOccurrence({ freq: 'YEARLY', interval: 1 }, '2026-03-15')).toBe('2027-03-15');
  });
});

describe('matchesRecurrence', () => {
  it('checks the weekday for weekly rules', () => {
    const rule = { freq: 'WEEKLY' as const, interval: 1, byDay: [1] };
    expect(matchesRecurrence(rule, '2026-01-19')).toBe(true); // Monday
    expect(matchesRecurrence(rule, '2026-01-20')).toBe(false); // Tuesday
  });

  it('checks the day of month for monthly rules', () => {
    const rule = { freq: 'MONTHLY' as const, interval: 1, byMonthDay: 15 };
    expect(matchesRecurrence(rule, '2026-01-15')).toBe(true);
    expect(matchesRecurrence(rule, '2026-01-16')).toBe(false);
  });
});
