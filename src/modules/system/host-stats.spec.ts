import { cpuPercentBetween, parseMeminfo, parseProcStat } from './host-stats';

describe('host-stats', () => {
  it('computes CPU usage from two /proc/stat samples', () => {
    const first = parseProcStat('cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 2');
    const second = parseProcStat('cpu  150 0 150 750 150 0 0 0 0 0');

    expect(first).toEqual({ idle: 800, total: 1000 });
    // 200 tick berlalu, 100 di antaranya idle/iowait → 50%.
    expect(cpuPercentBetween(first, second!)).toBe(50);
    expect(cpuPercentBetween(null, second!)).toBe(0);
  });

  it('uses MemAvailable for used memory and reports swap', () => {
    const memory = parseMeminfo(
      [
        'MemTotal:        4000000 kB',
        'MemFree:          200000 kB',
        'MemAvailable:    1000000 kB',
        'SwapTotal:        500000 kB',
        'SwapFree:         290000 kB',
      ].join('\n'),
    );

    expect(memory).toEqual({
      totalBytes: 4000000 * 1024,
      usedBytes: 3000000 * 1024,
      swapUsedBytes: 210000 * 1024,
    });
  });
});
