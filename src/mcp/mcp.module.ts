import { Module } from '@nestjs/common';
import { MockSwiggyMcpClient } from './mock-swiggy-mcp.client';
import { OAuthStateStore } from './oauth/oauth-state.store';
import { SwiggyOAuthProvider } from './oauth/swiggy-oauth.provider';
import { OAuthController } from './oauth/oauth.controller';
import { McpSessionFactory } from './real/mcp-session.factory';

export const SWIGGY_MCP_CLIENT = 'SWIGGY_MCP_CLIENT';

// INTERIM registration (Task 2.4): wires up the OAuth browser-bridge pieces alongside the
// existing mock client. Task 3.5 rewrites this module to make SWIGGY_MCP_CLIENT switch
// between the mock and a real MCP-client wrapper (built on McpSessionFactory) based on
// USE_MOCK_MCP — don't add that switch here.
@Module({
  controllers: [OAuthController],
  providers: [
    {
      provide: SWIGGY_MCP_CLIENT,
      // Swap this for a real client factory once you have MCP credentials:
      // useFactory: (config: ConfigService) => new RealSwiggyMcpClient(config),
      useClass: MockSwiggyMcpClient,
    },
    OAuthStateStore,
    SwiggyOAuthProvider,
    McpSessionFactory,
  ],
  exports: [SWIGGY_MCP_CLIENT, OAuthStateStore],
})
export class McpModule {}
