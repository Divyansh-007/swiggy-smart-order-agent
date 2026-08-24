import { OAuthStateStore } from './oauth-state.store';

describe('OAuthStateStore', () => {
  it('round-trips tokens and reports authenticated', () => {
    const s = new OAuthStateStore();
    expect(s.isAuthenticated()).toBe(false);
    s.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    expect(s.isAuthenticated()).toBe(true);
    expect(s.tokens?.access_token).toBe('abc');
  });

  it('stores code verifier and pending auth url', () => {
    const s = new OAuthStateStore();
    s.codeVerifier = 'v';
    s.pendingAuthUrl = new URL('https://mcp.swiggy.com/auth/authorize?x=1');
    expect(s.codeVerifier).toBe('v');
    expect(s.pendingAuthUrl?.searchParams.get('x')).toBe('1');
  });

  it('clear wipes everything', () => {
    const s = new OAuthStateStore();
    s.tokens = { access_token: 'abc', token_type: 'Bearer' } as any;
    s.state = 'csrf-token';
    s.clear();
    expect(s.isAuthenticated()).toBe(false);
    expect(s.state).toBeUndefined();
  });

  it('stores the CSRF state token', () => {
    const s = new OAuthStateStore();
    expect(s.state).toBeUndefined();
    s.state = 'csrf-token';
    expect(s.state).toBe('csrf-token');
  });
});
