import { SuggestionsService } from './suggestions.service';
import { AccountProfileService } from './account-profile.service';
import { RankingService } from '../ranking/ranking.service';
import { ReorderRankingService } from '../ranking/reorder-ranking.service';
import { AccountOrder, RestaurantResult } from '../mcp/mcp-client.interface';

function makeRestaurant(id: string, cuisine: string): RestaurantResult {
  return { restaurantId: id, name: `Restaurant ${id}`, cuisine, avgPrice: 300, isOpen: true, etaMinutes: 25, rating: 4.0 };
}

// History: r1 ordered twice (repeat customer, 'Chicken Biryani'), r6 ordered once
// ('Noodles'). Both are "known" restaurants — Discovery must exclude them.
const orderA: AccountOrder = {
  orderId: 'o_a',
  restaurantId: 'r1',
  restaurantName: 'Bawarchi Biryani House',
  orderTotal: 300,
  orderedAt: new Date('2026-08-20T20:00:00'),
  isActiveOrder: false,
  reorderItems: [{ menuItemId: 'm1', name: 'Chicken Biryani', quantity: 1 }],
};

const orderB: AccountOrder = {
  orderId: 'o_b',
  restaurantId: 'r1',
  restaurantName: 'Bawarchi Biryani House',
  orderTotal: 340,
  orderedAt: new Date('2026-08-10T20:00:00'),
  isActiveOrder: false,
  reorderItems: [{ menuItemId: 'm1', name: 'Chicken Biryani', quantity: 2 }],
};

const orderC: AccountOrder = {
  orderId: 'o_c',
  restaurantId: 'r6',
  restaurantName: 'Wok This Way',
  orderTotal: 400,
  orderedAt: new Date('2026-08-15T13:00:00'),
  isActiveOrder: false,
  reorderItems: [{ menuItemId: 'm2', name: 'Noodles', quantity: 1 }],
};

const fakeMcp = {
  getAddresses: async () => [{ addressId: 'addr_home', label: 'Home' }],
  getOrderHistory: async () => [orderB, orderA, orderC],
  searchRestaurants: async ({ query }: { query: string }): Promise<RestaurantResult[]> => {
    if (query === 'chicken biryani') {
      // New restaurants matching the dish keyword — not in history.
      return [makeRestaurant('r2', 'biryani'), makeRestaurant('r7', 'biryani')];
    }
    if (query === 'noodles') {
      return [makeRestaurant('r7', 'chinese')];
    }
    if (query === 'popular') {
      // Includes known restaurants (r1, r6) to prove Discovery excludes them,
      // plus a wider pool of new ones.
      return [
        makeRestaurant('r1', 'biryani'),
        makeRestaurant('r6', 'chinese'),
        makeRestaurant('r2', 'biryani'),
        makeRestaurant('r7', 'chinese'),
        makeRestaurant('r9', 'italian'),
        makeRestaurant('r10', 'thai'),
      ];
    }
    // Meal-time default query (varies with the clock) — nothing dish-specific here.
    return [];
  },
  buildCart: async () => ({ restaurantId: 'r1', restaurantName: 'Bawarchi', items: [], total: 0 }),
  placeOrder: async () => ({ orderId: 'o1', status: 'placed', etaMinutes: 30 }),
} as any;

const fakePreferences = {
  getProfile: async () => ({
    cuisineCounts: {},
    avgOrderValue: 0,
    timeSlotCounts: {},
    recentRestaurantIds: [],
    rejectedRestaurantIds: [],
  }),
  recordFeedback: async () => undefined,
} as any;

function buildService() {
  return new SuggestionsService(
    fakeMcp,
    fakePreferences,
    new RankingService(),
    new AccountProfileService(fakeMcp, fakePreferences),
    new ReorderRankingService(),
  );
}

describe('SuggestionsService', () => {
  it('returns reorder picks (with items) and discover picks that exclude known restaurants', async () => {
    const svc = buildService();
    const out = await svc.getTopSuggestions('dj');

    expect(out.reorder.length).toBeGreaterThan(0);
    expect(out.reorder.some((r) => r.items.length > 0)).toBe(true);
    // Reorder is built purely from account history — r1 and r6 are the only restaurants.
    expect(out.reorder.map((r) => r.restaurantId).sort()).toEqual(['r1', 'r6']);

    expect(out.discover.length).toBeLessThanOrEqual(5);
    const discoverIds = out.discover.map((s) => s.restaurant.restaurantId);
    // r1 and r6 are in the user's order history — Discovery must not resurface them,
    // even though the 'popular' fallback search returns them.
    expect(discoverIds).not.toContain('r1');
    expect(discoverIds).not.toContain('r6');
  });

  it('returns empty reorder/discover when there is no resolvable address', async () => {
    const noAddressMcp = { ...fakeMcp, getAddresses: async () => [] } as any;
    const svc = new SuggestionsService(
      noAddressMcp,
      fakePreferences,
      new RankingService(),
      new AccountProfileService(noAddressMcp, fakePreferences),
      new ReorderRankingService(),
    );
    const out = await svc.getTopSuggestions('dj');
    expect(out).toEqual({ reorder: [], discover: [] });
  });
});
