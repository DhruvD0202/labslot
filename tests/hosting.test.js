import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { getConfig } from '../server/config.js';

test('a configured proxy keeps sign-in limits per client and ignores forged address prefixes', async () => {
  // Missing fields fail validation before any DB call. This test exercises the
  // real auth limiter and Express IP parsing without needing database fixtures.
  const pool = { query() { throw new Error('This request must not reach the database.'); } };
  const app = createApp(pool, { production: true, jwtSecret: 'test-secret-that-is-at-least-32-characters', trustProxyHops: 1 });
  const attempt = forwarded => request(app).post('/api/auth/login').set('X-Forwarded-For', forwarded).send({});
  for (let i = 0; i < 30; i++) await attempt('198.51.100.10').expect(400);
  await attempt('198.51.100.10').expect(429);
  // An attacker prepending a different address cannot reset the nearest hop.
  await attempt('203.0.113.200, 198.51.100.10').expect(429);
  await attempt('198.51.100.11').expect(400);
});

test('proxy configuration rejects unbounded or malformed values', () => {
  const saved = Object.fromEntries(['DATABASE_URL', 'JWT_SECRET', 'TRUST_PROXY_HOPS'].map(key => [key, process.env[key]]));
  try {
    process.env.DATABASE_URL = 'postgresql://example.invalid/labslot';
    process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters';
    for (const invalid of ['true', '-1', '1.5', '6', 'not-a-number']) {
      process.env.TRUST_PROXY_HOPS = invalid;
      assert.throws(getConfig, /TRUST_PROXY_HOPS/);
    }
    delete process.env.TRUST_PROXY_HOPS;
    assert.equal(getConfig().trustProxyHops, 0);
    process.env.TRUST_PROXY_HOPS = '1';
    assert.equal(getConfig().trustProxyHops, 1);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
