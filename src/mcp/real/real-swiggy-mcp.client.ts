import { Injectable } from '@nestjs/common';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import {
  BuildCartParams, CartSummary, PlaceOrderResult, RestaurantResult,
  SearchRestaurantsParams, SwiggyAddress, SwiggyMcpClient,
} from '../mcp-client.interface';
import { McpSessionFactory } from './mcp-session.factory';
import { OAuthStateStore } from '../oauth/oauth-state.store';
import { toAddresses, toRestaurants } from './swiggy-response.adapter';

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
      // NOTE: SDK -32001 = RequestTimeout, not auth — do not clear the session on it.
      // Task 3.7 to verify Swiggy's live auth-error surface.
      const unauthorized = e instanceof UnauthorizedError || e?.status === 401;
      if (unauthorized) {
        this.store.clear();
        this.sessions.reset();
        throw new Error('Swiggy session expired — re-authenticate at /oauth/login');
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
    await this.call('update_food_cart', { restaurantId: params.restaurantId, items: params.items });
    const cart = await this.call('get_food_cart', {});
    return {
      restaurantId: params.restaurantId,
      restaurantName: cart?.restaurantName ?? '',
      items: (cart?.items ?? []).map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price })),
      total: Number(cart?.total ?? 0),
    };
  }

  async placeOrder(): Promise<PlaceOrderResult> {
    const order = await this.call('place_food_order', { paymentMethod: 'COD' });
    return {
      orderId: order?.orderId,
      status: order?.status ?? 'placed',
      etaMinutes: Number(order?.etaMinutes ?? 0),
    };
  }
}
