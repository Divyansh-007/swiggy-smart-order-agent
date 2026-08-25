import { toCartSummary, toMenuItems } from './cart.adapter';

describe('toCartSummary', () => {
  const inner = {
    restaurant: { id: 'r1', name: 'BTW' },
    items: [{ name: 'Chole', quantity: 2, final_price: 196 }],
    pricing: { item_total: 196, to_pay: 245 },
  };

  it('maps a get_food_cart payload nested under data', () => {
    const payload = { data: inner };
    expect(toCartSummary(payload)).toEqual({
      restaurantId: 'r1',
      restaurantName: 'BTW',
      items: [{ name: 'Chole', quantity: 2, price: 196 }],
      itemTotal: 196,
      toPay: 245,
    });
  });

  it('maps the inner cart object passed directly (no .data nesting)', () => {
    expect(toCartSummary(inner)).toEqual({
      restaurantId: 'r1',
      restaurantName: 'BTW',
      items: [{ name: 'Chole', quantity: 2, price: 196 }],
      itemTotal: 196,
      toPay: 245,
    });
  });

  it('falls back to item_total when to_pay is missing', () => {
    const c = { ...inner, pricing: { item_total: 100 } };
    expect(toCartSummary(c).toPay).toBe(100);
  });

  it('handles missing/empty input without throwing', () => {
    expect(toCartSummary(undefined)).toEqual({
      restaurantId: '',
      restaurantName: '',
      items: [],
      itemTotal: 0,
      toPay: 0,
    });
  });
});

describe('toMenuItems', () => {
  const inner = {
    categories: [
      {
        items: [
          { id: 'm1', name: 'Chole', price: 196, inStock: 1, isVeg: true, hasVariants: false, hasAddons: false },
          { id: 'm2', name: 'Combo', price: 400, inStock: 0, hasVariants: true },
        ],
      },
    ],
  };

  it('flattens a get_restaurant_menu payload nested under data', () => {
    const payload = { data: inner };
    const items = toMenuItems(payload);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      menuItemId: 'm1',
      name: 'Chole',
      price: 196,
      inStock: true,
      isVeg: true,
      hasVariants: false,
      hasAddons: false,
    });
    expect(items[1]).toEqual({
      menuItemId: 'm2',
      name: 'Combo',
      price: 400,
      inStock: false,
      isVeg: undefined,
      hasVariants: true,
      hasAddons: false,
    });
  });

  it('flattens the inner menu object passed directly (no .data nesting)', () => {
    const items = toMenuItems(inner);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ menuItemId: 'm1', price: 196, inStock: true, hasVariants: false, hasAddons: false });
    expect(items[1]).toMatchObject({ menuItemId: 'm2', inStock: false, hasVariants: true });
  });

  it('handles missing/empty input without throwing', () => {
    expect(toMenuItems(undefined)).toEqual([]);
  });
});
