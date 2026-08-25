import { AccountProfileService } from './account-profile.service';
import { AccountOrder } from '../mcp/mcp-client.interface';

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
  restaurantId: 'r2',
  restaurantName: 'Wok This Way',
  orderTotal: 400,
  orderedAt: new Date('2026-08-15T13:00:00'),
  isActiveOrder: false,
  reorderItems: [{ menuItemId: 'm2', name: 'Noodles', quantity: 1 }],
};

const fakeMcp = {
  getOrderHistory: async () => [orderB, orderA, orderC],
} as any;

const fakePreferences = {
  getProfile: async () => ({
    cuisineCounts: {},
    avgOrderValue: 0,
    timeSlotCounts: {},
    recentRestaurantIds: [],
    rejectedRestaurantIds: ['r9'],
  }),
} as any;

describe('AccountProfileService', () => {
  it('builds a profile grouped by restaurant from real order history', async () => {
    const svc = new AccountProfileService(fakeMcp, fakePreferences);
    const profile = await svc.build('dj', 'addr_home');

    const r1 = profile.restaurants.find((r) => r.restaurantId === 'r1')!;
    const r2 = profile.restaurants.find((r) => r.restaurantId === 'r2')!;

    expect(profile.restaurants).toHaveLength(2);

    // r1 was ordered twice; lastOrderedAt/reorderItems come from the most-recent order (orderA).
    expect(r1.count).toBe(2);
    expect(r1.lastOrderedAt).toEqual(orderA.orderedAt);
    expect(r1.reorderItems).toEqual(orderA.reorderItems);
    expect(r1.avgValue).toBe((300 + 340) / 2);

    expect(r2.count).toBe(1);
    expect(r2.lastOrderedAt).toEqual(orderC.orderedAt);
    expect(r2.reorderItems).toEqual(orderC.reorderItems);
    expect(r2.avgValue).toBe(400);

    // Mean across all 3 orders.
    expect(profile.avgOrderValue).toBe((300 + 340 + 400) / 3);

    // Newest-first distinct restaurant ids (r1's most recent order is newer than r2's).
    expect(profile.recentRestaurantIds).toEqual(['r1', 'r2']);

    // orderA/orderB hour=20 -> dinner, orderC hour=13 -> lunch.
    expect(profile.timeSlotCounts).toEqual({ dinner: 2, lunch: 1 });

    // Live get_food_order_details returns no cuisine data, so this stays empty.
    expect(profile.cuisineCounts).toEqual({});

    // Skip feedback passed through unchanged from PreferencesService.
    expect(profile.rejectedRestaurantIds).toEqual(['r9']);
  });

  it('handles many distinct restaurants without any enrichment calls', async () => {
    const manyOrders: AccountOrder[] = Array.from({ length: 15 }, (_, i) => ({
      orderId: `o_${i}`,
      restaurantId: `r${i}`,
      restaurantName: `Restaurant ${i}`,
      orderTotal: 100,
      orderedAt: new Date(2026, 7, 1 + i, 12, 0, 0),
      isActiveOrder: false,
      reorderItems: [],
    }));

    const mcp = {
      getOrderHistory: async () => manyOrders,
    } as any;

    const svc = new AccountProfileService(mcp, fakePreferences);
    const profile = await svc.build('dj', 'addr_home');

    expect(profile.restaurants).toHaveLength(15);
    expect(profile.cuisineCounts).toEqual({});
  });
});
