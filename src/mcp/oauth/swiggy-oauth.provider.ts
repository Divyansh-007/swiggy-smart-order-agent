import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { OAuthStateStore } from './oauth-state.store';

@Injectable()
export class SwiggyOAuthProvider implements OAuthClientProvider {
  constructor(private config: ConfigService, private store: OAuthStateStore) {}

  get redirectUrl(): string {
    return (
      this.config.get<string>('SWIGGY_OAUTH_REDIRECT_URI') ??
      'http://localhost:3000/oauth/callback'
    );
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'smart-order-agent',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code'], // v1.0 issues no refresh tokens
      response_types: ['code'],
      scope: 'mcp:tools mcp:resources mcp:prompts',
    };
  }

  state(): string {
    return randomBytes(16).toString('base64url');
  }

  clientInformation(): OAuthClientInformationFull | undefined {
    return this.store.clientInfo;
  }
  saveClientInformation(info: OAuthClientInformationFull): void {
    this.store.clientInfo = info;
  }

  tokens(): OAuthTokens | undefined {
    return this.store.tokens;
  }
  saveTokens(tokens: OAuthTokens): void {
    this.store.tokens = tokens;
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.store.codeVerifier = codeVerifier;
  }
  codeVerifier(): string {
    if (!this.store.codeVerifier) throw new Error('No PKCE code verifier stored');
    return this.store.codeVerifier;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    // Don't navigate here (we're server-side). Stash it; the /oauth/login route 302s the user.
    this.store.pendingAuthUrl = authorizationUrl;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    switch (scope) {
      case 'all':
        this.store.clear();
        break;
      case 'client':
        this.store.clientInfo = undefined;
        break;
      case 'tokens':
        this.store.tokens = undefined;
        break;
      case 'verifier':
        this.store.codeVerifier = undefined;
        break;
      case 'discovery':
        // The store holds no discovery state.
        break;
    }
  }
}
