import { toCartSummary } from './cart.adapter';

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
