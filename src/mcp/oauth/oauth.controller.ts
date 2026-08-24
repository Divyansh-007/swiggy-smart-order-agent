import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { McpSessionFactory } from '../real/mcp-session.factory';
import { OAuthStateStore } from './oauth-state.store';

/**
 * Browser bridge for the Swiggy MCP OAuth 2.1 + PKCE flow. The SDK's `OAuthClientProvider`
 * can't navigate a browser itself (it runs server-side), so these routes stand in for the
 * user-agent redirect: `/oauth/login` kicks off the SDK-driven flow and 302s the browser to
 * Swiggy, `/oauth/callback` receives the authorization code Swiggy redirects back with, and
 * `/oauth/status` reports whether we're currently authenticated.
 */
@Controller('oauth')
export class OAuthController {
  constructor(private sessions: McpSessionFactory, private store: OAuthStateStore) {}

  @Get('login')
  async login(@Res() res: Response) {
    const url = await this.sessions.beginAuth();
    return res.redirect(url.toString());
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    if (!code) return res.status(400).send('Missing authorization code');
    // CSRF check: the state we handed Swiggy in /oauth/login must come back unchanged.
    // Single-use — cleared as soon as it's matched so it can't be replayed.
    if (!state || state !== this.store.state) {
      return res.status(400).send('Invalid or missing state parameter');
    }
    this.store.state = undefined;
    await this.sessions.completeAuth(code);
    return res.send('Swiggy MCP connected. Close this tab and hit /suggestions.');
  }

  @Get('status')
  status() {
    return { authenticated: this.store.isAuthenticated() };
  }
}
