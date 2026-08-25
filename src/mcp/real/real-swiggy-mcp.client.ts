import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  AccountOrder, BuildCartParams, CartSummary, MenuItem, RestaurantResult,
  SearchRestaurantsParams, SwiggyAddress, SwiggyMcpClient,
} from '../mcp-client.interface';
import { McpSessionFactory } from './mcp-session.factory';
import { OAuthStateStore } from '../oauth/oauth-state.store';
import { toAddresses, toRestaurants } from './swiggy-response.adapter';
import { toAccountOrders } from './order-history.adapter';
import { toCartSummary, toMenuItems } from './cart.adapter';

@Injectable()
export class RealSwiggyMcpClient implements SwiggyMcpClient {
  constructor(private sessions: McpSessionFactory, private store: OAuthStateStore) {}

  private unwrap(result: any): any {
    // MCP-standard tool-level failure signal — distinct from Swiggy's own envelope below.
    if (result?.isError === true) {
      throw new Error(result.content?.[0]?.text ?? 'Swiggy tool returned isError');
    }
    // Swiggy tools return { success, data, message } | { success:false, error }
    const raw =
      result?.structuredContent ??
      (typeof result?.content?.[0]?.text === 'string'
        ? JSON.parse(result.content[0].text)
        : result);
    if (raw && raw.success === false) {
      throw new Error(raw.error?.message ?? 'Swiggy tool call failed');
    }
    return raw?.data ?? raw;
  }

  private async call(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const run = async () => {
      const client = await this.sessions.getClient();
      return client.callTool({ name, arguments: args });
    };
    try {
      return this.unwrap(await run());
    } catch (e: any) {
      // Not yet authenticated (McpSessionFactory.getClient() gate) — already a clean 401,
      // nothing to clear since no session was ever established. Rethrow as-is.
      if (e instanceof UnauthorizedException) {
        throw e;
      }
      // NOTE: SDK -32001 = RequestTimeout, not auth — do not clear the session on it.
      // Task 3.7 to verify Swiggy's live auth-error surface.
      const unauthorized = e instanceof UnauthorizedError || e?.status === 401;
      if (unauthorized) {
        this.store.clear();
        this.sessions.reset();
        throw new UnauthorizedException('Swiggy session expired — re-authenticate at /oauth/login');
      }
      throw e;
    }
  }

  async getAddresses(): Promise<SwiggyAddress[]> {
    return toAddresses(await this.call('get_addresses', {}));
  }

  async searchRestaurants(params: SearchRestaurantsParams): Promise<RestaurantResult[]> {
    return toRestaurants(
      await this.call('search_restaurants', {
        addressId: params.addressId,
        query: params.query,
        ...(params.offset ? { offset: params.offset } : {}),
      }),
    );
  }

  async buildCart(params: BuildCartParams): Promise<CartSummary> {
    await this.call('update_food_cart', {
      restaurantId: params.restaurantId,
      addressId: params.addressId,
      cartItems: params.items.map((i) => ({ menu_item_id: i.menuItemId, quantity: i.quantity })),
      ...(params.restaurantName ? { restaurantName: params.restaurantName } : {}),
    });
    const cart = await this.call('get_food_cart', {
      addressId: params.addressId,
      ...(params.restaurantName ? { restaurantName: params.restaurantName } : {}),
    });
    const summary = toCartSummary(cart);
    // Live get_food_cart returns a `restaurant` object with only `deliverySubtitle`
    // (no id, often no name), so thread the identity from the params we built with.
    return {
      ...summary,
      restaurantId: params.restaurantId,
      restaurantName: summary.restaurantName || params.restaurantName || '',
    };
  }

  async getRestaurantMenu(restaurantId: string, addressId: string): Promise<MenuItem[]> {
    return toMenuItems(await this.call('get_restaurant_menu', { restaurantId, addressId }));
  }

  async getOrderHistory(addressId: string): Promise<AccountOrder[]> {
    return toAccountOrders(await this.call('get_food_orders', { addressId }));
  }
}
