import { LineThrottle } from './sse-throttle';

describe('LineThrottle', () => {
  it('passes up to the limit per second and counts the rest', () => {
    const throttle = new LineThrottle(3);
    const results = [0, 100, 200, 300, 400].map((t) => throttle.accept(t));

    expect(results).toEqual([true, true, true, false, false]);
    expect(throttle.drainSkipped()).toBe(2);
    expect(throttle.drainSkipped()).toBe(0);
  });

  it('opens a new window after a second', () => {
    const throttle = new LineThrottle(1);
    expect(throttle.accept(0)).toBe(true);
    expect(throttle.accept(500)).toBe(false);
    expect(throttle.accept(1000)).toBe(true);
  });
});
