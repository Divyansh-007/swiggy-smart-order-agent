import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppModule } from '../app.module';
import { SuggestionsService } from '../suggestions/suggestions.service';
import { McpSessionFactory } from '../mcp/real/mcp-session.factory';
import { OAuthStateStore } from '../mcp/oauth/oauth-state.store';
import { SWIGGY_MCP_CLIENT } from '../mcp/mcp.module';
import { registerTools } from './tools';
import { runAuthentication } from './authenticate';

async function bootstrap(): Promise<void> {
  // Headless: DI container only, no HTTP listener. Logger off — stdout is JSON-RPC.
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  const config = app.get(ConfigService);
  const suggestions = app.get(SuggestionsService, { strict: false });
  const sessions = app.get(McpSessionFactory, { strict: false });
  const store = app.get(OAuthStateStore, { strict: false });
  const mcpClient = app.get<any>(SWIGGY_MCP_CLIENT, { strict: false });

  const isMock = config.get('USE_MOCK_MCP') !== 'false';
  const fixedUserId = config.get<string>('DEFAULT_USER_ID') ?? 'dj';
  const redirectUri = config.get<string>('SWIGGY_OAUTH_REDIRECT_URI');

  const server = new McpServer({ name: 'smart-order-agent', version: '0.1.0' });

  registerTools(server, {
    suggestions,
    mcpClient,
    fixedUserId,
    authenticate: () => runAuthentication({ sessions, store, isMock, redirectUri }),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[smart-order-agent] MCP server ready (mock=${isMock}).\n`);
}

bootstrap().catch((e) => {
  process.stderr.write(`[smart-order-agent] fatal: ${(e as Error).stack ?? e}\n`);
  process.exit(1);
});
