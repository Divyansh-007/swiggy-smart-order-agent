import { BadRequestException } from '@nestjs/common';
import { SuggestionsService } from './suggestions.service';
import { AccountProfileService } from './account-profile.service';
import { RankingService } from '../ranking/ranking.service';
import { ReorderRankingService } from '../ranking/reorder-ranking.service';
import { AccountOrder, MenuItem, RestaurantResult } from '../mcp/mcp-client.interface';

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

  it('discover surfaces open new places even when dish/meal searches return closed ones', async () => {
    // Regression: closed candidates from the dish/meal queries used to fill `byId`
    // past topN, suppressing the 'popular' top-up; RankingService then dropped them
    // all on its isOpen filter, leaving discover empty. Only orderable (open)
    // candidates should count toward the top-up decision.
    const closed = (id: string, c: string): RestaurantResult => ({ ...makeRestaurant(id, c), isOpen: false });
    const mcp = {
      ...fakeMcp,
      searchRestaurants: async ({ query }: { query: string }): Promise<RestaurantResult[]> => {
        // Dish keyword 'chicken biryani' -> 5 CLOSED new places (enough to fill byId to topN).
        if (query === 'chicken biryani') {
          return ['c1', 'c2', 'c3', 'c4', 'c5'].map((id) => closed(id, 'biryani'));
        }
        if (query === 'noodles') return [closed('c6', 'chinese')];
        if (query === 'popular') {
          // The broad fallback DOES have open new places to offer.
          return [makeRestaurant('o1', 'biryani'), makeRestaurant('o2', 'thai'), makeRestaurant('o3', 'italian')];
        }
        return []; // meal-default query
      },
    } as any;
    const svc = new SuggestionsService(
      mcp,
      fakePreferences,
      new RankingService(),
      new AccountProfileService(mcp, fakePreferences),
      new ReorderRankingService(),
    );

    const out = await svc.getTopSuggestions('dj');

    // The 'popular' top-up must have fired, so discover is not empty...
    expect(out.discover.length).toBeGreaterThan(0);
    // ...and every discovered place is open (orderable — surprise_cart depends on this)...
    expect(out.discover.every((s) => s.restaurant.isOpen)).toBe(true);
    // ...and none of the closed dish-keyword places leak through.
    expect(out.discover.map((s) => s.restaurant.restaurantId)).not.toContain('c1');
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

describe('SuggestionsService.surpriseToCart', () => {
  // Deterministic "picker" — always the first element — so pool/item selection
  // is reproducible in tests instead of relying on Math.random().
  const first = <T>(a: T[]): T => a[0];

  function buildCartSpy() {
    return jest.fn(async (params: any) => ({
      restaurantId: params.restaurantId,
      restaurantName: params.restaurantName ?? 'Restaurant',
      items: params.items.map((i: any) => ({ name: i.menuItemId, quantity: i.quantity, price: 100 })),
      itemTotal: 100 * params.items.length,
      toPay: 100 * params.items.length,
    }));
  }

  it('reorder pick: adds the reordered item to cart and never places the order', async () => {
    const buildCart = buildCartSpy();
    const placeOrder = jest.fn();
    const mcp = { ...fakeMcp, buildCart, placeOrder } as any;
    const svc = new SuggestionsService(
      mcp,
      fakePreferences,
      new RankingService(),
      new AccountProfileService(mcp, fakePreferences),
      new ReorderRankingService(),
    );

    const result = await svc.surpriseToCart('dj', undefined, first);

    // r1 (Bawarchi) outranks r6 on frequency/recency — reorder[0] is r1, whose
    // most-recent order's only reorderItem is m1 "Chicken Biryani".
    expect(result.picked.list).toBe('reorder');
    expect(result.picked.restaurantId).toBe('r1');
    expect(result.picked.item.menuItemId).toBe('m1');
    expect(buildCart).toHaveBeenCalledWith({
      restaurantId: 'r1',
      addressId: 'addr_home',
      items: [{ menuItemId: 'm1', quantity: 1 }],
      restaurantName: 'Bawarchi Biryani House',
    });
    expect(result.cart).toEqual(await buildCart.mock.results[0].value);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('discover pick (no order history): picks an in-stock, variant/addon-free menu item and never places the order', async () => {
    const fakeMenu: MenuItem[] = [
      { menuItemId: 'x0', name: 'Build Your Own Thali', price: 300, inStock: true, hasVariants: true, hasAddons: false },
      { menuItemId: 'x1', name: 'Veg Fried Rice', price: 180, inStock: true, hasVariants: false, hasAddons: false },
      { menuItemId: 'x2', name: 'Paneer Tikka', price: 220, inStock: true, hasVariants: false, hasAddons: false },
      { menuItemId: 'x3', name: 'Out of Stock Item', price: 150, inStock: false, hasVariants: false, hasAddons: false },
    ];
    const buildCart = buildCartSpy();
    const placeOrder = jest.fn();
    const getRestaurantMenu = jest.fn(async () => fakeMenu);
    const mcp = {
      ...fakeMcp,
      getOrderHistory: async () => [], // no history -> reorder is empty -> pool is discover-only
      getRestaurantMenu,
      buildCart,
      placeOrder,
    } as any;
    const svc = new SuggestionsService(
      mcp,
      fakePreferences,
      new RankingService(),
      new AccountProfileService(mcp, fakePreferences),
      new ReorderRankingService(),
    );

    const result = await svc.surpriseToCart('dj', undefined, first);

    expect(result.picked.list).toBe('discover');
    expect(getRestaurantMenu).toHaveBeenCalledWith(result.picked.restaurantId, 'addr_home');
    // Simple candidates are filtered to inStock && !hasVariants && !hasAddons,
    // in menu order — the deterministic "first" picker selects x1.
    expect(result.picked.item.menuItemId).toBe('x1');
    expect(buildCart).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: result.picked.restaurantId,
        addressId: 'addr_home',
        items: [{ menuItemId: 'x1', quantity: 1 }],
      }),
    );
    expect(result.cart).toEqual(await buildCart.mock.results[0].value);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('reorder pick with no saved reorderItems falls through to the menu (still tagged "reorder")', async () => {
    // ReorderRankingService backfills restaurants with reorderItems:[] when
    // fewer than topN restaurants have items — this order has none, so the
    // resulting ReorderSuggestion.items is [], and surpriseToCart must fall
    // through to picking from that restaurant's menu instead.
    const emptyItemsOrder: AccountOrder = {
      orderId: 'o_r9',
      restaurantId: 'r9',
      restaurantName: 'Spice Route',
      orderTotal: 250,
      orderedAt: new Date('2026-08-18T19:00:00'),
      isActiveOrder: false,
      reorderItems: [],
    };
    const fakeMenu: MenuItem[] = [
      { menuItemId: 'y0', name: 'Combo Platter', price: 300, inStock: true, hasVariants: true, hasAddons: false },
      { menuItemId: 'y1', name: 'Chilli Chicken', price: 240, inStock: true, hasVariants: false, hasAddons: false },
      { menuItemId: 'y2', name: 'Out of Stock', price: 150, inStock: false, hasVariants: false, hasAddons: false },
    ];
    const buildCart = buildCartSpy();
    const placeOrder = jest.fn();
    const getRestaurantMenu = jest.fn(async () => fakeMenu);
    const mcp = {
      ...fakeMcp,
      getOrderHistory: async () => [emptyItemsOrder], // sole restaurant -> reorder[0] with items:[]
      getRestaurantMenu,
      buildCart,
      placeOrder,
    } as any;
    const svc = new SuggestionsService(
      mcp,
      fakePreferences,
      new RankingService(),
      new AccountProfileService(mcp, fakePreferences),
      new ReorderRankingService(),
    );

    const result = await svc.surpriseToCart('dj', undefined, first);

    expect(result.picked.list).toBe('reorder');
    expect(result.picked.restaurantId).toBe('r9');
    expect(getRestaurantMenu).toHaveBeenCalledWith('r9', 'addr_home');
    // Simple candidates filtered to inStock && !hasVariants && !hasAddons, in
    // menu order — the deterministic "first" picker selects y1 (not y0/y2).
    expect(result.picked.item.menuItemId).toBe('y1');
    expect(buildCart).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'r9',
        addressId: 'addr_home',
        items: [{ menuItemId: 'y1', quantity: 1 }],
      }),
    );
    expect(result.cart).toEqual(await buildCart.mock.results[0].value);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('rejects with BadRequestException when there is no resolvable address', async () => {
    const noAddressMcp = { ...fakeMcp, getAddresses: async () => [] } as any;
    const svc = new SuggestionsService(
      noAddressMcp,
      fakePreferences,
      new RankingService(),
      new AccountProfileService(noAddressMcp, fakePreferences),
      new ReorderRankingService(),
    );

    await expect(svc.surpriseToCart('dj')).rejects.toThrow(BadRequestException);
    await expect(svc.surpriseToCart('dj')).rejects.toThrow('No saved Swiggy address');
  });

  it('rejects with BadRequestException when there are no suggestions to pick from', async () => {
    const emptyMcp = {
      ...fakeMcp,
      getOrderHistory: async () => [], // reorder empty (no restaurants)
      searchRestaurants: async () => [], // discover empty (no candidates, any query)
    } as any;
    const svc = new SuggestionsService(
      emptyMcp,
      fakePreferences,
      new RankingService(),
      new AccountProfileService(emptyMcp, fakePreferences),
      new ReorderRankingService(),
    );

    await expect(svc.surpriseToCart('dj')).rejects.toThrow(BadRequestException);
    await expect(svc.surpriseToCart('dj')).rejects.toThrow('No suggestions to pick from');
  });

  it('rejects with BadRequestException when the picked (discover) restaurant has no orderable items', async () => {
    const buildCart = buildCartSpy();
    const placeOrder = jest.fn();
    const mcp = {
      ...fakeMcp,
      getOrderHistory: async () => [], // reorder empty -> pool is discover-only
      getRestaurantMenu: async () => [], // no items at all on the picked restaurant
      buildCart,
      placeOrder,
    } as any;
    const svc = new SuggestionsService(
      mcp,
      fakePreferences,
      new RankingService(),
      new AccountProfileService(mcp, fakePreferences),
      new ReorderRankingService(),
    );

    await expect(svc.surpriseToCart('dj', undefined, first)).rejects.toThrow(BadRequestException);
    await expect(svc.surpriseToCart('dj', undefined, first)).rejects.toThrow('no orderable items');
    expect(buildCart).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
  });
});
