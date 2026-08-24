import { SwiggyOAuthProvider } from './swiggy-oauth.provider';
import { OAuthStateStore } from './oauth-state.store';

const config = {
  get: (k: string) =>
    ({ SWIGGY_OAUTH_REDIRECT_URI: 'http://localhost:3000/oauth/callback' } as Record<string, string>)[k],
} as any;

describe('SwiggyOAuthProvider', () => {
  it('exposes redirect url and honest client metadata', () => {
    const p = new SwiggyOAuthProvider(config, new OAuthStateStore());
    expect(p.redirectUrl).toBe('http://localhost:3000/oauth/callback');
    expect(p.clientMetadata.grant_types).toEqual(['authorization_code']); // no refresh_token in v1
    expect(p.clientMetadata.redirect_uris).toContain('http://localhost:3000/oauth/callback');
  });

  it('redirectToAuthorization stashes the url instead of navigating', async () => {
    const store = new OAuthStateStore();
    const p = new SwiggyOAuthProvider(config, store);
    await p.redirectToAuthorization(new URL('https://mcp.swiggy.com/auth/authorize?code_challenge=x'));
    expect(store.pendingAuthUrl?.searchParams.get('code_challenge')).toBe('x');
  });

  it('persists code verifier and tokens through the store', async () => {
    const store = new OAuthStateStore();
    const p = new SwiggyOAuthProvider(config, store);
    await p.saveCodeVerifier('ver');
    expect(await p.codeVerifier()).toBe('ver');
    await p.saveTokens({ access_token: 't', token_type: 'Bearer' } as any);
    expect((await p.tokens())?.access_token).toBe('t');
  });
});
