import { Injectable } from '@nestjs/common';
import {
  BuildCartParams, CartSummary, PlaceOrderResult, RestaurantResult,
  SearchRestaurantsParams, SwiggyAddress, SwiggyMcpClient,
} from './mcp-client.interface';

const MOCK_RESTAURANTS: RestaurantResult[] = [
  { restaurantId: 'r1', name: 'Bawarchi Biryani House', cuisine: 'biryani', avgPrice: 350, isOpen: true, etaMinutes: 32, rating: 4.3, distanceKm: 2.1 },
  { restaurantId: 'r2', name: 'Wok This Way', cuisine: 'chinese', avgPrice: 420, isOpen: true, etaMinutes: 28, rating: 4.1, distanceKm: 3.0 },
  { restaurantId: 'r3', name: 'Punjab Grill Express', cuisine: 'north_indian', avgPrice: 500, isOpen: true, etaMinutes: 40, rating: 4.4, distanceKm: 5.2 },
  { restaurantId: 'r4', name: 'Sushi Yama', cuisine: 'japanese', avgPrice: 650, isOpen: false, etaMinutes: 0, rating: 4.6, distanceKm: 6.0 },
  { restaurantId: 'r5', name: 'Pizza Republic', cuisine: 'italian', avgPrice: 380, isOpen: true, etaMinutes: 25, rating: 4.0, distanceKm: 1.4 },
  { restaurantId: 'r6', name: 'South Spice', cuisine: 'south_indian', avgPrice: 220, isOpen: true, etaMinutes: 20, rating: 4.5, distanceKm: 1.1 },
  { restaurantId: 'r7', name: 'Thai Basil Kitchen', cuisine: 'thai', avgPrice: 480, isOpen: true, etaMinutes: 35, rating: 4.2, distanceKm: 4.4 },
  { restaurantId: 'r8', name: 'Momo Point', cuisine: 'tibetan', avgPrice: 180, isOpen: true, etaMinutes: 22, rating: 4.3, distanceKm: 2.8 },
];

@Injectable()
export class MockSwiggyMcpClient implements SwiggyMcpClient {
  async getAddresses(): Promise<SwiggyAddress[]> {
    await this.latency();
    return [
      { addressId: 'addr_home', label: 'Home', displayText: 'Home, Sector 21' },
      { addressId: 'addr_work', label: 'Work', displayText: 'Work, Cyber Hub' },
    ];
  }

  async searchRestaurants(params: SearchRestaurantsParams): Promise<RestaurantResult[]> {
    await this.latency();
    const q = params.query?.toLowerCase().trim();
    if (!q || q === 'popular' || q === 'best food') return MOCK_RESTAURANTS;
    return MOCK_RESTAURANTS.filter(
      (r) => r.cuisine.includes(q) || r.name.toLowerCase().includes(q),
    );
  }

  async buildCart(params: BuildCartParams): Promise<CartSummary> {
    await this.latency();
    const r = MOCK_RESTAURANTS.find((x) => x.restaurantId === params.restaurantId);
    return {
      restaurantId: params.restaurantId,
      restaurantName: r?.name ?? 'Unknown',
      items: params.items.map((i) => ({ name: `item-${i.itemId}`, quantity: i.quantity, price: 200 })),
      total: params.items.reduce((s, i) => s + 200 * i.quantity, 0),
    };
  }

  async placeOrder(): Promise<PlaceOrderResult> {
    await this.latency();
    return { orderId: `mock-${Date.now()}`, status: 'placed', etaMinutes: 30 };
  }

  private latency() {
    return new Promise((r) => setTimeout(r, 50));
  }
}
