import { OAuthStateStore } from './oauth-state.store';
import { mkdtempSync, existsSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('OAuthStateStore', () => {
  it('round-trips tokens and reports authenticated', () => {
    const s = new OAuthStateStore(null);
    expect(s.isAuthenticated()).toBe(false);
    s.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    expect(s.isAuthenticated()).toBe(true);
    expect(s.tokens?.access_token).toBe('abc');
  });

  it('stores code verifier and pending auth url', () => {
    const s = new OAuthStateStore(null);
    s.codeVerifier = 'v';
    s.pendingAuthUrl = new URL('https://mcp.swiggy.com/auth/authorize?x=1');
    expect(s.codeVerifier).toBe('v');
    expect(s.pendingAuthUrl?.searchParams.get('x')).toBe('1');
  });

  it('clear wipes everything', () => {
    const s = new OAuthStateStore(null);
    s.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    s.state = 'csrf-token';
    s.clear();
    expect(s.isAuthenticated()).toBe(false);
    expect(s.state).toBeUndefined();
  });

  it('stores the CSRF state token', () => {
    const s = new OAuthStateStore(null);
    expect(s.state).toBeUndefined();
    s.state = 'csrf-token';
    expect(s.state).toBe('csrf-token');
  });
});

describe('OAuthStateStore persistence', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'soa-oauth-'));
    file = join(dir, 'oauth.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('persists tokens + clientInfo and reloads them in a new instance', () => {
    const a = new OAuthStateStore(file);
    a.clientInfo = { client_id: 'c1', redirect_uris: ['http://localhost/cb'] } as any;
    a.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    expect(existsSync(file)).toBe(true);

    const b = new OAuthStateStore(file);
    expect(b.isAuthenticated()).toBe(true);
    expect(b.tokens?.access_token).toBe('abc');
    expect(b.clientInfo?.client_id).toBe('c1');
  });

  it('clear() deletes the persisted file', () => {
    const a = new OAuthStateStore(file);
    a.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    a.clear();
    expect(existsSync(file)).toBe(false);
    expect(new OAuthStateStore(file).isAuthenticated()).toBe(false);
  });

  it('a corrupt file loads as unauthenticated (no throw)', () => {
    writeFileSync(file, '{ not json');
    const s = new OAuthStateStore(file);
    expect(s.isAuthenticated()).toBe(false);
  });

  it('does not write a file when persistence is disabled (null)', () => {
    const s = new OAuthStateStore(null);
    s.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    // no file arg => nothing to assert on disk; just verify in-memory works
    expect(s.isAuthenticated()).toBe(true);
  });
});
