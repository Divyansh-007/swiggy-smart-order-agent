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
});
