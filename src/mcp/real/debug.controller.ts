import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpSessionFactory } from './mcp-session.factory';

// DEV ONLY. Guarded by USE_MOCK_MCP=false; remove before production submission.
@Controller('debug/mcp')
export class McpDebugController {
  constructor(private sessions: McpSessionFactory, private config: ConfigService) {}

  private guard() {
    if (this.config.get('USE_MOCK_MCP') !== 'false') throw new ForbiddenException('real mode only');
  }

  @Get('tools')
  async tools() {
    this.guard();
    const client = await this.sessions.getClient();
    return (await client.listTools()).tools.map((t) => t.name);
  }

  @Get('raw')
  async raw(@Query('tool') tool: string, @Query('addressId') addressId?: string, @Query('query') query?: string) {
    this.guard();
    const client = await this.sessions.getClient();
    const args = tool === 'search_restaurants' ? { addressId, query: query ?? 'biryani' } : {};
    return client.callTool({ name: tool, arguments: args });
  }
}
