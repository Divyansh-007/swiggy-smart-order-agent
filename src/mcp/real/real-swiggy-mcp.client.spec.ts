import { UnauthorizedException } from '@nestjs/common';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { RealSwiggyMcpClient } from './real-swiggy-mcp.client';

function makeSessions(callTool: (...args: any[]) => Promise<any>) {
  return {
    getClient: jest.fn().mockResolvedValue({ callTool }),
    reset: jest.fn(),
    beginAuth: jest.fn(),
    completeAuth: jest.fn(),
  } as any;
}

function makeStore() {
  return {
    clear: jest.fn(),
    isAuthenticated: jest.fn().mockReturnValue(true),
  } as any;
}

describe('RealSwiggyMcpClient', () => {
  it('clears the OAuth session and resets on a real UnauthorizedError, throwing a 401', async () => {
    const callTool = jest.fn().mockRejectedValue(new UnauthorizedError('x'));
    const sessions = makeSessions(callTool);
    const store = makeStore();
    const client = new RealSwiggyMcpClient(sessions, store);

    let caught: any;
    try {
      await client.getAddresses();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UnauthorizedException);
    expect(caught.message).toMatch(/re-authenticate/i);
    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(sessions.reset).toHaveBeenCalledTimes(1);
  });

  it('rethrows a not-yet-authenticated UnauthorizedException from getClient() without clearing anything', async () => {
    const callTool = jest.fn();
    const sessions = {
      getClient: jest.fn().mockRejectedValue(new UnauthorizedException('Not authenticated — visit /oauth/login')),
      reset: jest.fn(),
      beginAuth: jest.fn(),
      completeAuth: jest.fn(),
    } as any;
    const store = makeStore();
    const client = new RealSwiggyMcpClient(sessions, store);

    await expect(client.getAddresses()).rejects.toBeInstanceOf(UnauthorizedException);
    expect(callTool).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
    expect(sessions.reset).not.toHaveBeenCalled();
  });

  it('does NOT clear the session on a -32001 timeout', async () => {
    const callTool = jest.fn().mockRejectedValue({ code: -32001, message: 'Request timed out' });
    const sessions = makeSessions(callTool);
    const store = makeStore();
    const client = new RealSwiggyMcpClient(sessions, store);

    await expect(client.getAddresses()).rejects.toBeTruthy();
    expect(store.clear).not.toHaveBeenCalled();
    expect(sessions.reset).not.toHaveBeenCalled();
  });

  it('throws on an MCP-standard isError result', async () => {
    const callTool = jest.fn().mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'boom' }],
    });
    const sessions = makeSessions(callTool);
    const store = makeStore();
    const client = new RealSwiggyMcpClient(sessions, store);

    await expect(client.getAddresses()).rejects.toThrow(/boom/);
  });

  it('maps a successful envelope through getAddresses', async () => {
    const callTool = jest.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ success: true, data: [{ addressId: 'a', label: 'Home' }] }),
        },
      ],
    });
    const sessions = makeSessions(callTool);
    const store = makeStore();
    const client = new RealSwiggyMcpClient(sessions, store);

    const addresses = await client.getAddresses();
    expect(addresses).toEqual([{ addressId: 'a', label: 'Home', displayText: undefined }]);
  });

  it('getOrderHistory maps get_food_orders payload to AccountOrder[]', async () => {
    const callTool = jest.fn().mockResolvedValue({
      structuredContent: {
        orders: [
          {
            orderId: 'o1', restaurantId: 'r1', restaurantName: 'Bawarchi',
            orderTotal: '₹340', orderedTime: '2026-08-20T21:00:00.000Z', isActiveOrder: false,
            actions: [{ reorderMeta: { orderItems: [{ menu_item_id: 'm1', name: 'Biryani', quantity: 1 }] } }],
          },
        ],
      },
    });
    const client = new RealSwiggyMcpClient(makeSessions(callTool), makeStore());
    const orders = await client.getOrderHistory('addr_home');
    expect(callTool).toHaveBeenCalledWith({ name: 'get_food_orders', arguments: { addressId: 'addr_home' } });
    expect(orders[0]).toMatchObject({ orderId: 'o1', orderTotal: 340, reorderItems: [{ menuItemId: 'm1', name: 'Biryani', quantity: 1 }] });
  });

  it('getRestaurantCuisines maps get_food_order_details to snake-cased cuisines', async () => {
    const callTool = jest.fn().mockResolvedValue({
      structuredContent: { order: { restaurant_cuisine: ['Biryani', 'North Indian'] } },
    });
    const client = new RealSwiggyMcpClient(makeSessions(callTool), makeStore());
    const cuisines = await client.getRestaurantCuisines('o1');
    expect(callTool).toHaveBeenCalledWith({ name: 'get_food_order_details', arguments: { orderId: 'o1' } });
    expect(cuisines).toEqual(['biryani', 'north_indian']);
  });

  it('buildCart calls update_food_cart then get_food_cart with the correct real args, and maps the cart response', async () => {
    const calls: { name: string; arguments: any }[] = [];
    const callTool = jest.fn().mockImplementation(async ({ name, arguments: args }) => {
      calls.push({ name, arguments: args });
      if (name === 'update_food_cart') {
        return { structuredContent: { success: true, data: {} } };
      }
      return {
        structuredContent: {
          success: true,
          data: {
            restaurant: { id: 'r1', name: 'Bawarchi' },
            items: [{ menu_item_id: 'm1', name: 'Chicken Biryani', quantity: 2, final_price: 400 }],
            pricing: { item_total: 400, to_pay: 445 },
          },
        },
      };
    });
    const client = new RealSwiggyMcpClient(makeSessions(callTool), makeStore());

    const cart = await client.buildCart({
      restaurantId: 'r1',
      addressId: 'addr_home',
      items: [{ menuItemId: 'm1', quantity: 2 }],
    });

    expect(calls[0]).toEqual({
      name: 'update_food_cart',
      arguments: {
        restaurantId: 'r1',
        addressId: 'addr_home',
        cartItems: [{ menu_item_id: 'm1', quantity: 2 }],
      },
    });
    expect(calls[1]).toEqual({
      name: 'get_food_cart',
      arguments: { addressId: 'addr_home' },
    });
    expect(cart).toEqual({
      restaurantId: 'r1',
      restaurantName: 'Bawarchi',
      items: [{ name: 'Chicken Biryani', quantity: 2, price: 400 }],
      itemTotal: 400,
      toPay: 445,
    });
  });

  it('getRestaurantMenu calls get_restaurant_menu with restaurantId/addressId and maps the menu envelope', async () => {
    const callTool = jest.fn().mockResolvedValue({
      structuredContent: {
        success: true,
        data: {
          categories: [
            {
              items: [
                { id: 'm1', name: 'Chole', price: 196, inStock: 1, isVeg: true, hasVariants: false, hasAddons: false },
                { id: 'm2', name: 'Combo', price: 400, inStock: 0, hasVariants: true },
              ],
            },
          ],
        },
      },
    });
    const client = new RealSwiggyMcpClient(makeSessions(callTool), makeStore());

    const menu = await client.getRestaurantMenu('r1', 'addr_home');

    expect(callTool).toHaveBeenCalledWith({
      name: 'get_restaurant_menu',
      arguments: { restaurantId: 'r1', addressId: 'addr_home' },
    });
    expect(menu).toEqual([
      { menuItemId: 'm1', name: 'Chole', price: 196, inStock: true, isVeg: true, hasVariants: false, hasAddons: false },
      { menuItemId: 'm2', name: 'Combo', price: 400, inStock: false, isVeg: undefined, hasVariants: true, hasAddons: false },
    ]);
  });

  it('buildCart passes restaurantName through to both calls when provided', async () => {
    const calls: { name: string; arguments: any }[] = [];
    const callTool = jest.fn().mockImplementation(async ({ name, arguments: args }) => {
      calls.push({ name, arguments: args });
      return { structuredContent: { success: true, data: {} } };
    });
    const client = new RealSwiggyMcpClient(makeSessions(callTool), makeStore());

    await client.buildCart({
      restaurantId: 'r1',
      addressId: 'addr_home',
      items: [{ menuItemId: 'm1', quantity: 1 }],
      restaurantName: 'Bawarchi',
    });

    expect(calls[0].arguments.restaurantName).toBe('Bawarchi');
    expect(calls[1].arguments.restaurantName).toBe('Bawarchi');
  });
});
