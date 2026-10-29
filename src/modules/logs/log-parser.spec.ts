import { detectLogLevel } from './log-parser';

describe('detectLogLevel', () => {
  it.each([
    'psycopg2.OperationalError: connection to server at "postgres" failed',
    'Traceback (most recent call last): File "/app/api/checkout.py"',
    'redis.exceptions.ConnectionError: Error 111',
    'Unhandled exception in worker',
    '[gunicorn] 103.xx.xx.77 "POST /api/checkout HTTP/1.1" 500 61ms',
    'tees.co.id 1.2.3.4 "POST /api/checkout HTTP/2.0" 502 212',
    '2026/10/29 10:42:00 [error] 29#29: upstream timed out',
    '{"level":"error","msg":"boom"}',
    'ERROR something broke',
    'status=503 path=/api',
  ])('ERROR: %s', (line) => {
    expect(detectLogLevel(line)).toBe('ERROR');
  });

  it.each([
    'WARN slow query 1.82s',
    '# WARNING memory usage 92% of maxmemory',
    'tees.co.id 1.2.3.4 "GET /wp-login.php HTTP/1.1" 404 153 "-"',
    'ratelimit status=429 for 1.2.3.4',
    'level=warn msg="disk almost full"',
  ])('WARN: %s', (line) => {
    expect(detectLogLevel(line)).toBe('WARN');
  });

  it.each([
    '[gunicorn] 103.xx.xx.40 "GET /api/products HTTP/1.1" 200 38ms',
    'db.pool connection restored',
    // Angka 5xx/4xx di luar posisi status HTTP bukan status.
    'request took 500ms',
    'loaded 404 products, order id=503',
    'worker exited with code 1',
  ])('INFO: %s', (line) => {
    expect(detectLogLevel(line)).toBe('INFO');
  });
});
