import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpSessionFactory } from './mcp-session.factory';

// Read-only tools the deferred live-capture steps (brief Steps 3-4) actually need.
// The /raw route only ever proxies these — never a mutating tool like place_food_order.
const CAPTURE_TOOLS = new Set([
  'get_addresses',
  'search_restaurants',
  'get_food_orders',
  'get_food_order_details',
  'get_food_cart',
  'get_restaurant_menu',
]);

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
  async raw(
    @Query('tool') tool: string,
    @Query('addressId') addressId?: string,
    @Query('query') query?: string,
    @Query('orderId') orderId?: string,
    @Query('restaurantId') restaurantId?: string,
  ) {
    this.guard();
    if (!CAPTURE_TOOLS.has(tool)) {
      throw new ForbiddenException(`Only read-only capture tools are allowed: ${[...CAPTURE_TOOLS].join(', ')}`);
    }
    const client = await this.sessions.getClient();
    const args =
      tool === 'search_restaurants' ? { addressId, query: query ?? 'biryani' } :
      tool === 'get_food_orders' ? { addressId } :
      tool === 'get_food_order_details' ? { orderId } :
      tool === 'get_food_cart' ? { addressId } :
      tool === 'get_restaurant_menu' ? { restaurantId, addressId } :
      {};
    return client.callTool({ name: tool, arguments: args });
  }
}
