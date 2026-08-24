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

describe('SuggestionsService', () => {
  it('resolves an address and returns ranked suggestions', async () => {
    const svc = new SuggestionsService(fakeMcp, fakePrefs, new RankingService());
    const out = await svc.getTopSuggestions('dj');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].restaurant.restaurantId).toBe('r1');
  });
});
