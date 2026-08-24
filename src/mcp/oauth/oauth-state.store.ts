import { Injectable } from '@nestjs/common';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

@Injectable()
export class OAuthStateStore {
  clientInfo: OAuthClientInformationFull | undefined;
  tokens: OAuthTokens | undefined;
  codeVerifier: string | undefined;
  pendingAuthUrl: URL | undefined;

  isAuthenticated(): boolean {
    return !!this.tokens?.access_token;
  }

  clear(): void {
    this.clientInfo = undefined;
    this.tokens = undefined;
    this.codeVerifier = undefined;
    this.pendingAuthUrl = undefined;
  }
}
