import { describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from './runtimeConfig';

const anon = `eyJheader.${btoa(JSON.stringify({ role: 'anon' }))}.signature`;
describe('public runtime configuration', () => {
  it('accepts local loopback and only explicitly approved HTTPS demo hosts', () => {
    expect(validateRuntimeConfig({ mode: 'local', url: 'http://127.0.0.1:55421', publishableKey: anon, allowedDemoHosts: [] }).url).toBe('http://127.0.0.1:55421');
    expect(validateRuntimeConfig({ mode: 'demo_remote', url: 'https://approved.example.invalid', publishableKey: 'sb_publishable_synthetic', allowedDemoHosts: ['approved.example.invalid'] }).url).toBe('https://approved.example.invalid');
  });
  it('rejects remote local mode and unapproved demo before reading the key', () => {
    for (const mode of ['local', 'demo_remote'] as const) {
      expect(() => validateRuntimeConfig({ mode, url: 'https://foreign.example.invalid', get publishableKey(): string { throw Error('secret was read'); }, allowedDemoHosts: [] })).toThrow(/host|loopback/);
    }
  });
  it('rejects administrative keys, unknown JWT roles and malformed public settings without echoing them', () => {
    const service = `eyJheader.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`;
    for (const key of [service, 'sb_secret_private-sentinel', 'not-a-key', `eyJheader.${btoa('{}')}.signature`, '']) {
      expect(() => validateRuntimeConfig({ mode: 'local', url: 'http://localhost:55421', publishableKey: key, allowedDemoHosts: [] })).toThrow(/public key/);
    }
    for (const url of ['http://user:pass@localhost:55421', 'http://localhost:55421/path', 'https://approved.example.invalid.evil', 'http://approved.example.invalid']) {
      expect(() => validateRuntimeConfig({ mode: 'demo_remote', url, publishableKey: anon, allowedDemoHosts: ['approved.example.invalid'] })).toThrow();
    }
  });
});
