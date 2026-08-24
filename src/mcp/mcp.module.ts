import { Module } from '@nestjs/common';
import { MockSwiggyMcpClient } from './mock-swiggy-mcp.client';

export const SWIGGY_MCP_CLIENT = 'SWIGGY_MCP_CLIENT';

@Module({
  providers: [
    {
      provide: SWIGGY_MCP_CLIENT,
      // Swap this for a real client factory once you have MCP credentials:
      // useFactory: (config: ConfigService) => new RealSwiggyMcpClient(config),
      useClass: MockSwiggyMcpClient,
    },
  ],
  exports: [SWIGGY_MCP_CLIENT],
})
export class McpModule {}
