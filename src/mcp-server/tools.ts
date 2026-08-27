import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { UnauthorizedException } from '@nestjs/common';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';

interface SuggestionsServiceLike {
  getTopSuggestions(userId: string, addressId?: string): Promise<unknown>;
  surpriseToCart(userId: string, addressId?: string): Promise<unknown>;
  acceptSuggestion(userId: string, restaurantId: string, itemIds: string[]): Promise<unknown>;
  skipSuggestion(userId: string, restaurantId: string): Promise<unknown>;
}

export interface ToolDeps {
  suggestions: SuggestionsServiceLike;
  mcpClient: { getAddresses: () => Promise<unknown[]> };
  authenticate: () => Promise<{ authenticated: boolean; message: string }>;
  fixedUserId: string;
}

export function okResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const AUTH_HINT = 'Not authenticated with Swiggy — call the `authenticate` tool first.';

export async function withAuthErrors(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return okResult(await fn());
  } catch (e) {
    if (e instanceof UnauthorizedException || e instanceof UnauthorizedError) {
      return errorResult(AUTH_HINT);
    }
    return errorResult((e as Error).message);
  }
}

type Handler = (args: any) => Promise<CallToolResult>;

/** Handlers isolated from the transport so they can be unit-tested directly. */
export function buildHandlers(deps: ToolDeps): Record<string, Handler> {
  const uid = deps.fixedUserId;
  return {
    authenticate: () => withAuthErrors(() => deps.authenticate()),
    get_suggestions: ({ addressId }) =>
      withAuthErrors(() => deps.suggestions.getTopSuggestions(uid, addressId)),
    surprise_cart: ({ addressId }) =>
      withAuthErrors(() => deps.suggestions.surpriseToCart(uid, addressId)),
    list_addresses: () => withAuthErrors(() => deps.mcpClient.getAddresses()),
    accept_suggestion: ({ restaurantId, itemIds }) =>
      withAuthErrors(() => deps.suggestions.acceptSuggestion(uid, restaurantId, itemIds)),
    skip_suggestion: ({ restaurantId }) =>
      withAuthErrors(() => deps.suggestions.skipSuggestion(uid, restaurantId)),
  };
}

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const h = buildHandlers(deps);

  server.registerTool(
    'authenticate',
    {
      title: 'Authenticate with Swiggy',
      description: 'One-time browser login to Swiggy (phone + OTP). No-op if already signed in.',
      inputSchema: {},
    },
    h.authenticate,
  );

  server.registerTool(
    'get_suggestions',
    {
      title: 'Get food suggestions',
      description: 'Two ranked top-5 lists from your Swiggy order history: { reorder, discover }.',
      inputSchema: { addressId: z.string().optional().describe('Swiggy address id; defaults to your first saved address') },
    },
    h.get_suggestions,
  );

  server.registerTool(
    'surprise_cart',
    {
      title: 'Surprise me — fill my cart',
      description: 'Randomly picks one suggestion, adds a single item to your real Swiggy cart, and stops at the cart (no order placed).',
      inputSchema: { addressId: z.string().optional() },
    },
    h.surprise_cart,
  );

  server.registerTool(
    'list_addresses',
    {
      title: 'List saved Swiggy addresses',
      description: 'Your saved Swiggy delivery addresses.',
      inputSchema: {},
    },
    h.list_addresses,
  );

  server.registerTool(
    'accept_suggestion',
    {
      title: 'Record an accepted suggestion',
      description: 'Positive feedback that tunes future ranking.',
      inputSchema: { restaurantId: z.string(), itemIds: z.array(z.string()) },
    },
    h.accept_suggestion,
  );

  server.registerTool(
    'skip_suggestion',
    {
      title: 'Record a skipped suggestion',
      description: 'Negative feedback that tunes future ranking.',
      inputSchema: { restaurantId: z.string() },
    },
    h.skip_suggestion,
  );
}
