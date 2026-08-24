import { Injectable } from '@nestjs/common';
import {
  PlaceOrderParams,
  PlaceOrderResult,
  RestaurantResult,
  SearchRestaurantsParams,
  SwiggyMcpClient,
} from './mcp-client.interface';

const MOCK_RESTAURANTS: RestaurantResult[] = [
  { restaurantId: 'r1', name: 'Bawarchi Biryani House', cuisine: 'biryani', avgPrice: 350, isOpen: true, etaMinutes: 32, rating: 4.3 },
  { restaurantId: 'r2', name: 'Wok This Way', cuisine: 'chinese', avgPrice: 420, isOpen: true, etaMinutes: 28, rating: 4.1 },
  { restaurantId: 'r3', name: 'Punjab Grill Express', cuisine: 'north_indian', avgPrice: 500, isOpen: true, etaMinutes: 40, rating: 4.4 },
  { restaurantId: 'r4', name: 'Sushi Yama', cuisine: 'japanese', avgPrice: 650, isOpen: false, etaMinutes: 0, rating: 4.6 },
  { restaurantId: 'r5', name: 'Pizza Republic', cuisine: 'italian', avgPrice: 380, isOpen: true, etaMinutes: 25, rating: 4.0 },
  { restaurantId: 'r6', name: 'South Spice', cuisine: 'south_indian', avgPrice: 220, isOpen: true, etaMinutes: 20, rating: 4.5 },
  { restaurantId: 'r7', name: 'Thai Basil Kitchen', cuisine: 'thai', avgPrice: 480, isOpen: true, etaMinutes: 35, rating: 4.2 },
  { restaurantId: 'r8', name: 'Momo Point', cuisine: 'tibetan', avgPrice: 180, isOpen: true, etaMinutes: 22, rating: 4.3 },
];

/**
 * Stands in for the real Swiggy Food MCP server (mcp.swiggy.com/food).
 * Behaviour mirrors the documented shape: { success, data } responses,
 * simple filtering, and a couple of tools (search_restaurants, place_order).
 * Delete this file and drop in a real MCP client once you have access —
 * the SwiggyMcpClient interface is the only contract the rest of the app relies on.
 */
@Injectable()
export class MockSwiggyMcpClient implements SwiggyMcpClient {
  async searchRestaurants(params: SearchRestaurantsParams): Promise<RestaurantResult[]> {
    await this.fakeLatency();
    return MOCK_RESTAURANTS.filter((r) => {
      if (params.cuisine && r.cuisine !== params.cuisine) return false;
      if (params.maxPrice && r.avgPrice > params.maxPrice) return false;
      return true;
    });
  }

  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    await this.fakeLatency();
    return {
      orderId: `mock-${Date.now()}`,
      status: 'placed',
      etaMinutes: 30,
    };
  }

  private fakeLatency() {
    return new Promise((resolve) => setTimeout(resolve, 150));
  }
}
