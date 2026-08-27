import { UnauthorizedException } from '@nestjs/common';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { buildHandlers, ToolDeps } from './tools';

function deps(over: Partial<ToolDeps> = {}): ToolDeps {
  return {
    fixedUserId: 'dj',
    authenticate: jest.fn().mockResolvedValue({ authenticated: true, message: 'ok' }),
    mcpClient: { getAddresses: jest.fn().mockResolvedValue([{ addressId: 'a1', label: 'Home' }]) },
    suggestions: {
      getTopSuggestions: jest.fn().mockResolvedValue({ reorder: [{ restaurantId: 'r1' }], discover: [] }),
      surpriseToCart: jest.fn().mockResolvedValue({ picked: { restaurantId: 'r1' }, cart: { toPay: 250 } }),
      acceptSuggestion: jest.fn().mockResolvedValue({ recorded: true }),
      skipSuggestion: jest.fn().mockResolvedValue({ recorded: false, note: 'feedback not persisted (store offline)' }),
    },
    ...over,
  } as ToolDeps;
}

function parse(result: any) {
  return JSON.parse(result.content[0].text);
}

describe('tool handlers', () => {
  it('get_suggestions returns { reorder, discover } and passes the fixed user id', async () => {
    const d = deps();
    const h = buildHandlers(d);
    const res = await h.get_suggestions({ addressId: 'a1' });
    expect(d.suggestions.getTopSuggestions).toHaveBeenCalledWith('dj', 'a1');
    expect(parse(res)).toEqual({ reorder: [{ restaurantId: 'r1' }], discover: [] });
  });

  it('surprise_cart returns { picked, cart }', async () => {
    const res = await buildHandlers(deps()).surprise_cart({});
    expect(parse(res)).toEqual({ picked: { restaurantId: 'r1' }, cart: { toPay: 250 } });
  });

  it('skip_suggestion surfaces the offline note', async () => {
    const res = await buildHandlers(deps()).skip_suggestion({ restaurantId: 'r1' });
    expect(parse(res).recorded).toBe(false);
    expect(parse(res).note).toMatch(/offline/i);
  });

  it('maps UnauthorizedException to a clean auth-error result', async () => {
    const d = deps({
      suggestions: {
        getTopSuggestions: jest.fn().mockRejectedValue(new UnauthorizedException('nope')),
      } as any,
    });
    const res = await buildHandlers(d).get_suggestions({});
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toMatch(/authenticate/i);
  });

  it('maps SDK UnauthorizedError to the auth-error result', async () => {
    const d = deps({
      suggestions: {
        getTopSuggestions: jest.fn().mockRejectedValue(new UnauthorizedError('nope')),
      } as any,
    });
    const res = await buildHandlers(d).get_suggestions({});
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toMatch(/authenticate/i);
  });

  it('list_addresses returns the address array', async () => {
    const res = await buildHandlers(deps()).list_addresses({});
    expect(parse(res)).toEqual([{ addressId: 'a1', label: 'Home' }]);
  });

  it('authenticate returns the auth result payload', async () => {
    const res = await buildHandlers(deps()).authenticate({});
    expect(parse(res)).toEqual({ authenticated: true, message: 'ok' });
  });
});
