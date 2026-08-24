import { SuggestionsService } from './suggestions.service';

const fakeMcp = {
  getAddresses: async () => [{ addressId: 'addr_home', label: 'Home' }],
  searchRestaurants: async () => [
    { restaurantId: 'r1', name: 'Bawarchi', cuisine: 'biryani', avgPrice: 350, isOpen: true, etaMinutes: 30, rating: 4.3 },
  ],
  buildCart: async () => ({ restaurantId: 'r1', restaurantName: 'Bawarchi', items: [], total: 0 }),
  placeOrder: async () => ({ orderId: 'o1', status: 'placed', etaMinutes: 30 }),
} as any;

const fakePrefs = {
  getProfile: async () => ({
    cuisineCounts: { biryani: 3 }, avgOrderValue: 350,
    timeSlotCounts: { dinner: 3 }, recentRestaurantIds: [], rejectedRestaurantIds: [],
  }),
  recordFeedback: async () => undefined,
} as any;

import { RankingService } from '../ranking/ranking.service';

function makeRestaurant(id: string, cuisine: string): any {
  return { restaurantId: id, name: `Restaurant ${id}`, cuisine, avgPrice: 300, isOpen: true, etaMinutes: 25, rating: 4.0 };
}

describe('SuggestionsService', () => {
  it('resolves an address and returns ranked suggestions', async () => {
    const svc = new SuggestionsService(fakeMcp, fakePrefs, new RankingService());
    const out = await svc.getTopSuggestions('dj');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].restaurant.restaurantId).toBe('r1');
  });

  it('widens the net with a popular search when the personalized queries come up short', async () => {
    const widenMcp = {
      getAddresses: async () => [{ addressId: 'addr_home', label: 'Home' }],
      searchRestaurants: async ({ query }: { query: string }) => {
        if (query === 'popular') {
          return [
            makeRestaurant('r1', 'biryani'),
            makeRestaurant('r2', 'chinese'),
            makeRestaurant('r3', 'north_indian'),
            makeRestaurant('r4', 'italian'),
            makeRestaurant('r5', 'south_indian'),
            makeRestaurant('r6', 'thai'),
          ];
        }
        // Personalized cuisine query — only 1 match, not enough to reach topN on its own.
        return [makeRestaurant('r1', 'biryani')];
      },
      buildCart: async () => ({ restaurantId: 'r1', restaurantName: 'Bawarchi', items: [], total: 0 }),
      placeOrder: async () => ({ orderId: 'o1', status: 'placed', etaMinutes: 30 }),
    } as any;

    const svc = new SuggestionsService(widenMcp, fakePrefs, new RankingService());
    const out = await svc.getTopSuggestions('dj');
    expect(out.length).toBe(5);
  });
});
