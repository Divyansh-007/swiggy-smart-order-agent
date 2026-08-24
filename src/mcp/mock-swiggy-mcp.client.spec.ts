import { MockSwiggyMcpClient } from './mock-swiggy-mcp.client';

describe('MockSwiggyMcpClient', () => {
  const c = new MockSwiggyMcpClient();

  it('returns at least one saved address', async () => {
    const a = await c.getAddresses();
    expect(a[0].addressId).toBeTruthy();
  });

  it('search filters to a query and includes open flag', async () => {
    const r = await c.searchRestaurants({ addressId: 'addr_home', query: 'biryani' });
    expect(r.every((x) => typeof x.isOpen === 'boolean')).toBe(true);
    expect(r.some((x) => x.cuisine === 'biryani')).toBe(true);
  });

  it('normalizes underscores/spaces so a natural-language query matches a snake_case cuisine slug', async () => {
    const r = await c.searchRestaurants({ addressId: 'addr_home', query: 'south indian' });
    expect(r.some((x) => x.cuisine === 'south_indian')).toBe(true);
  });
});
