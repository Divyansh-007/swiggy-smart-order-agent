import { Injectable } from '@nestjs/common';
import {
  AccountOrder, BuildCartParams, CartSummary, PlaceOrderResult, RestaurantResult,
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

// restaurantId -> snake_cased cuisine tags (get_food_order_details -> restaurant_cuisine[]).
// The first entry always matches the restaurant's primary `cuisine` in MOCK_RESTAURANTS.
const MOCK_CUISINES: Record<string, string[]> = {
  r1: ['biryani', 'hyderabadi'],
  r2: ['chinese', 'asian'],
  r3: ['north_indian', 'punjabi'],
  r4: ['japanese', 'sushi'],
  r5: ['italian', 'pizza'],
  r6: ['south_indian', 'tiffin'],
  r7: ['thai', 'asian'],
  r8: ['tibetan', 'momos'],
};

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

// Synthetic order history, NEWEST-FIRST. r1 (Bawarchi Biryani House) repeats 3x and
// r6 (South Spice) repeats 2x so reorder-frequency ranking has signal. Every
// restaurantId/cuisine here lines up with MOCK_RESTAURANTS / MOCK_CUISINES above so
// Discovery search still finds the suggested restaurant afterwards.
const MOCK_ORDERS: AccountOrder[] = [
  {
    orderId: 'mock-ord-1',
    restaurantId: 'r1',
    restaurantName: 'Bawarchi Biryani House',
    orderTotal: 350,
    orderedAt: daysAgo(1),
    isActiveOrder: false,
    reorderItems: [{ menuItemId: 'r1-biryani-1', name: 'Chicken Biryani', quantity: 2 }],
  },
  {
    orderId: 'mock-ord-2',
    restaurantId: 'r6',
    restaurantName: 'South Spice',
    orderTotal: 220,
    orderedAt: daysAgo(2),
    isActiveOrder: false,
    reorderItems: [{ menuItemId: 'r6-thali-1', name: 'South Indian Thali', quantity: 1 }],
  },
  {
    orderId: 'mock-ord-3',
    restaurantId: 'r1',
    restaurantName: 'Bawarchi Biryani House',
    orderTotal: 450,
    orderedAt: daysAgo(4),
    isActiveOrder: false,
    reorderItems: [
      { menuItemId: 'r1-biryani-1', name: 'Chicken Biryani', quantity: 1 },
      { menuItemId: 'r1-starter-1', name: 'Chicken 65', quantity: 1 },
    ],
  },
  {
    orderId: 'mock-ord-4',
    restaurantId: 'r5',
    restaurantName: 'Pizza Republic',
    orderTotal: 380,
    orderedAt: daysAgo(6),
    isActiveOrder: false,
    reorderItems: [{ menuItemId: 'r5-pizza-1', name: 'Margherita Pizza', quantity: 1 }],
  },
  {
    orderId: 'mock-ord-5',
    restaurantId: 'r6',
    restaurantName: 'South Spice',
    orderTotal: 240,
    orderedAt: daysAgo(9),
    isActiveOrder: false,
    reorderItems: [],
  },
  {
    orderId: 'mock-ord-6',
    restaurantId: 'r1',
    restaurantName: 'Bawarchi Biryani House',
    orderTotal: 500,
    orderedAt: daysAgo(13),
    isActiveOrder: false,
    reorderItems: [{ menuItemId: 'r1-biryani-2', name: 'Mutton Biryani', quantity: 1 }],
  },
  {
    orderId: 'mock-ord-7',
    restaurantId: 'r3',
    restaurantName: 'Punjab Grill Express',
    orderTotal: 500,
    orderedAt: daysAgo(18),
    isActiveOrder: false,
    reorderItems: [],
  },
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
    // Real Swiggy's fuzzy search doesn't care about snake_case vs natural language
    // ("south indian" should still match a "south_indian" cuisine slug) — normalize
    // both sides the same way before comparing.
    const norm = (s: string) => s.toLowerCase().replace(/_/g, ' ').trim();
    const nq = norm(q);
    return MOCK_RESTAURANTS.filter(
      (r) => norm(r.cuisine).includes(nq) || norm(r.name).includes(nq),
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

  async getOrderHistory(addressId: string): Promise<AccountOrder[]> {
    await this.latency();
    // Synthetic history is address-agnostic in the mock; addressId is accepted to
    // match the real client's signature (get_food_orders takes an address).
    void addressId;
    return MOCK_ORDERS;
  }

  async getRestaurantCuisines(orderId: string): Promise<string[]> {
    await this.latency();
    const order = MOCK_ORDERS.find((o) => o.orderId === orderId);
    if (!order) return [];
    return MOCK_CUISINES[order.restaurantId] ?? [];
  }

  private latency() {
    return new Promise((r) => setTimeout(r, 50));
  }
}
