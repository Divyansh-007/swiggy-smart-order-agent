import { ReorderRankingService } from './reorder-ranking.service';
import { AccountProfile, RestaurantMeta } from '../suggestions/account-profile.service';

function baseProfile(restaurants: RestaurantMeta[], rejectedRestaurantIds: string[] = []): AccountProfile {
  return {
    cuisineCounts: {},
    avgOrderValue: 320,
    timeSlotCounts: {},
    recentRestaurantIds: restaurants.map((r) => r.restaurantId),
    rejectedRestaurantIds,
    restaurants,
  };
}

const restaurantA: RestaurantMeta = {
  restaurantId: 'r_a',
  name: 'Bawarchi Biryani House',
  count: 4,
  lastOrderedAt: new Date('2026-08-24T20:00:00'),
  avgValue: 320,
  reorderItems: [{ menuItemId: 'm1', name: 'Chicken Biryani', quantity: 1 }],
};

const restaurantB: RestaurantMeta = {
  restaurantId: 'r_b',
  name: 'Wok This Way',
  count: 1,
  lastOrderedAt: new Date('2026-01-05T20:00:00'),
  avgValue: 400,
  reorderItems: [{ menuItemId: 'm2', name: 'Noodles', quantity: 1 }],
};

describe('ReorderRankingService', () => {
  it('ranks a frequent, recently-ordered restaurant above an infrequent, old one', () => {
    const svc = new ReorderRankingService();
    const profile = baseProfile([restaurantB, restaurantA]); // deliberately out of order

    const result = svc.rank(profile, 'dinner');

    expect(result[0].restaurantId).toBe('r_a');
    expect(result[0].items).toEqual(restaurantA.reorderItems);
    expect(result[1].restaurantId).toBe('r_b');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('down-ranks a restaurant that is in rejectedRestaurantIds', () => {
    const svc = new ReorderRankingService();

    // Without rejection, r_b would normally trail r_a but still score reasonably;
    // compare its score with vs. without being rejected to confirm the penalty applies.
    const profileNoReject = baseProfile([restaurantA, restaurantB], []);
    const profileRejected = baseProfile([restaurantA, restaurantB], ['r_b']);

    const withoutRejection = svc.rank(profileNoReject, 'dinner').find((s) => s.restaurantId === 'r_b')!;
    const withRejection = svc.rank(profileRejected, 'dinner').find((s) => s.restaurantId === 'r_b')!;

    expect(withRejection.score).toBeLessThan(withoutRejection.score);

    // And a rejected restaurant with a middling score should rank below a
    // clearly better, non-rejected one.
    const result = svc.rank(profileRejected, 'dinner');
    expect(result[0].restaurantId).toBe('r_a');
  });

  it('respects topN', () => {
    const svc = new ReorderRankingService();
    const profile = baseProfile([restaurantA, restaurantB]);

    const result = svc.rank(profile, 'dinner', 1);

    expect(result).toHaveLength(1);
    expect(result[0].restaurantId).toBe('r_a');
  });

  it('skips restaurants with no reorderItems unless needed to fill topN', () => {
    const svc = new ReorderRankingService();
    const emptyItemsRestaurant: RestaurantMeta = {
      ...restaurantB,
      restaurantId: 'r_c',
      name: 'No Reorder Co',
      reorderItems: [],
    };

    // With enough candidates that do have reorderItems, the empty one is skipped.
    const plentyProfile = baseProfile([restaurantA, restaurantB, emptyItemsRestaurant]);
    const plentyResult = svc.rank(plentyProfile, 'dinner', 2);
    expect(plentyResult.map((s) => s.restaurantId)).not.toContain('r_c');

    // But if topN can't be filled otherwise, it's included with a note.
    const scarceProfile = baseProfile([restaurantA, emptyItemsRestaurant]);
    const scarceResult = svc.rank(scarceProfile, 'dinner', 2);
    expect(scarceResult).toHaveLength(2);
    const included = scarceResult.find((s) => s.restaurantId === 'r_c')!;
    expect(included).toBeDefined();
    expect(included.reason).toMatch(/nothing saved to auto-reorder/i);
  });
});
