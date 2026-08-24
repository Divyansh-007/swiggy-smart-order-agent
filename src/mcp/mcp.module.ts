import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockSwiggyMcpClient } from './mock-swiggy-mcp.client';
import { RealSwiggyMcpClient } from './real/real-swiggy-mcp.client';
import { McpSessionFactory } from './real/mcp-session.factory';
import { OAuthStateStore } from './oauth/oauth-state.store';
import { SwiggyOAuthProvider } from './oauth/swiggy-oauth.provider';
import { OAuthController } from './oauth/oauth.controller';

export const SWIGGY_MCP_CLIENT = 'SWIGGY_MCP_CLIENT';

@Module({
  controllers: [OAuthController],
  providers: [
    OAuthStateStore,
    SwiggyOAuthProvider,
    McpSessionFactory,
    MockSwiggyMcpClient,
    RealSwiggyMcpClient,
    {
      provide: SWIGGY_MCP_CLIENT,
      inject: [ConfigService, MockSwiggyMcpClient, RealSwiggyMcpClient],
      useFactory: (config: ConfigService, mock: MockSwiggyMcpClient, real: RealSwiggyMcpClient) =>
        config.get('USE_MOCK_MCP') === 'false' ? real : mock,
    },
  ],
  exports: [SWIGGY_MCP_CLIENT, OAuthStateStore],
})
export class McpModule {}
