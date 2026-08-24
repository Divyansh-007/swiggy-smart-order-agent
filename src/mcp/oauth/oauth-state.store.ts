import { Injectable } from '@nestjs/common';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

@Injectable()
export class OAuthStateStore {
  clientInfo: OAuthClientInformationFull | undefined;
  tokens: OAuthTokens | undefined;
  codeVerifier: string | undefined;
  pendingAuthUrl: URL | undefined;
  /** CSRF state token generated for the in-flight authorization request; validated
   * against the `state` query param on `/oauth/callback` (single-use — cleared on match). */
  state: string | undefined;

  isAuthenticated(): boolean {
    return !!this.tokens?.access_token;
  }

  clear(): void {
    this.clientInfo = undefined;
    this.tokens = undefined;
    this.codeVerifier = undefined;
    this.pendingAuthUrl = undefined;
    this.state = undefined;
  }
}
