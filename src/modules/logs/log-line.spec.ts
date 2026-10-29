import { idToSinceSeconds, isAfterId, LogLineFactory } from './log-line';

describe('LogLineFactory', () => {
  it('numbers lines that share a timestamp', () => {
    const factory = new LogLineFactory();
    const ts = '2026-10-29T10:42:01.221234567Z';
    const a = factory.create({ timestamp: ts, text: 'a' });
    const b = factory.create({ timestamp: ts, text: 'b' });
    const c = factory.create({
      timestamp: '2026-10-29T10:42:01.300000000Z',
      text: 'ERROR c',
    });

    expect([a.id, b.id, c.id]).toEqual([
      `${ts}#0`,
      `${ts}#1`,
      '2026-10-29T10:42:01.300000000Z#0',
    ]);
    expect(a.ts).toBe('2026-10-29T10:42:01.221Z');
    expect(c.level).toBe('ERROR');
  });
});

describe('isAfterId', () => {
  const id = (ts: string, n = 0) => `2026-10-29T10:42:${ts}Z#${n}`;

  it('orders by timestamp, then sequence', () => {
    expect(isAfterId(id('02.000000000'), id('01.999999999'))).toBe(true);
    expect(isAfterId(id('01.000000000', 1), id('01.000000000', 0))).toBe(true);
    expect(isAfterId(id('01.000000000', 0), id('01.000000000', 0))).toBe(false);
    expect(isAfterId(id('00.500000000'), id('01.000000000'))).toBe(false);
  });

  it('accepts everything without a reference', () => {
    expect(isAfterId(id('01.000000000'), undefined)).toBe(true);
  });
});

describe('idToSinceSeconds', () => {
  it('floors to the whole second', () => {
    expect(idToSinceSeconds('2026-10-29T10:42:01.999999999Z#3')).toBe(
      Date.UTC(2026, 9, 29, 10, 42, 1) / 1000,
    );
    expect(idToSinceSeconds('garbage')).toBeNull();
  });
});
