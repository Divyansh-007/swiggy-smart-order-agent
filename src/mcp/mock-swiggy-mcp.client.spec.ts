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

  it('returns synthetic order history newest-first with reorder items', async () => {
    const orders = await c.getOrderHistory('addr_home');
    expect(orders.length).toBeGreaterThan(1);
    expect(orders[0].orderedAt.getTime()).toBeGreaterThanOrEqual(orders[1].orderedAt.getTime());
    expect(orders[0].reorderItems[0].menuItemId).toBeTruthy();
  });

  it('returns cuisines for an order', async () => {
    expect(await c.getRestaurantCuisines('mock-ord-1')).toContain('biryani');
  });

  it('buildCart echoes items with a synthetic price and computes itemTotal/toPay', async () => {
    const cart = await c.buildCart({
      restaurantId: 'r1',
      addressId: 'addr_home',
      items: [
        { menuItemId: 'r1-biryani-1', quantity: 2 },
        { menuItemId: 'r1-starter-1', quantity: 1 },
      ],
    });
    expect(cart.restaurantId).toBe('r1');
    expect(cart.restaurantName).toBe('Bawarchi Biryani House');
    expect(cart.items).toEqual([
      { name: 'item-r1-biryani-1', quantity: 2, price: 200 },
      { name: 'item-r1-starter-1', quantity: 1, price: 200 },
    ]);
    expect(cart.itemTotal).toBe(600);
    expect(cart.toPay).toBe(630);
  });

  it('getRestaurantMenu returns a synthetic menu with in-stock simple items plus out-of-stock/variant items to filter out', async () => {
    const menu = await c.getRestaurantMenu('r1', 'addr_home');
    expect(menu.length).toBeGreaterThan(0);

    const pickable = menu.filter((i) => i.inStock && !i.hasVariants && !i.hasAddons);
    expect(pickable.length).toBeGreaterThan(0);
    expect(pickable.every((i) => i.menuItemId && i.name && i.price > 0)).toBe(true);

    expect(menu.some((i) => i.inStock === false)).toBe(true);
    expect(menu.some((i) => i.hasVariants === true)).toBe(true);
  });

  it('getRestaurantMenu falls back to a default menu for an unknown restaurantId', async () => {
    const menu = await c.getRestaurantMenu('unknown-id', 'addr_home');
    expect(menu.length).toBeGreaterThan(0);
    expect(menu.some((i) => i.inStock && !i.hasVariants && !i.hasAddons)).toBe(true);
    expect(menu.some((i) => i.inStock === false)).toBe(true);
    expect(menu.some((i) => i.hasVariants === true)).toBe(true);
  });

  it('buildCart prefers an explicit restaurantName over the mock lookup', async () => {
    const cart = await c.buildCart({
      restaurantId: 'unknown-id',
      addressId: 'addr_home',
      items: [{ menuItemId: 'x', quantity: 1 }],
      restaurantName: 'Custom Name',
    });
    expect(cart.restaurantName).toBe('Custom Name');
  });
});
