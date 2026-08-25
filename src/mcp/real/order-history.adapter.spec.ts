import { toAccountOrders, cuisinesFromOrderDetails } from './order-history.adapter';

// Fixtures mirror Swiggy's documented order-history structure with SYNTHETIC
// values only (real payloads carry PII). Reconcile field names on live capture.
describe('order-history adapters', () => {
  it('maps an order: parses ₹ total, date, and reorder items', () => {
    const data = {
      orders: [
        {
          orderId: 'ord_1',
          restaurantId: 'r1',
          restaurantName: 'Bawarchi Biryani House',
          orderTotal: '₹340',
          orderedTime: '2026-08-20T21:00:00.000Z',
          isActiveOrder: false,
          actions: [
            {
              type: 'REORDER',
              reorderMeta: {
                orderItems: [{ menu_item_id: 'm1', name: 'Chicken Biryani', quantity: 1 }],
              },
            },
          ],
        },
      ],
    };
    const [o] = toAccountOrders(data);
    expect(o).toMatchObject({
      orderId: 'ord_1',
      restaurantId: 'r1',
      orderTotal: 340,
      isActiveOrder: false,
      reorderItems: [{ menuItemId: 'm1', name: 'Chicken Biryani', quantity: 1 }],
    });
    expect(o.orderedAt instanceof Date).toBe(true);
    expect(isNaN(o.orderedAt.getTime())).toBe(false);
  });

  it('yields empty reorderItems when the order has no reorder action', () => {
    const data = { orders: [{ orderId: 'o2', restaurantId: 'r2', orderTotal: '₹200', orderedTime: '2026-08-19', isActiveOrder: false, actions: [{ type: 'RATE' }] }] };
    expect(toAccountOrders(data)[0].reorderItems).toEqual([]);
  });

  it('falls back to item_id when menu_item_id is absent, and coerces string quantity', () => {
    const data = { orders: [{ orderId: 'o3', restaurantId: 'r3', orderTotal: '₹500', orderedTime: '2026-08-18', isActiveOrder: false, actions: [{ reorderMeta: { orderItems: [{ item_id: 'i9', name: 'Paneer Tikka', quantity: '2' }] } }] }] };
    expect(toAccountOrders(data)[0].reorderItems).toEqual([{ menuItemId: 'i9', name: 'Paneer Tikka', quantity: 2 }]);
  });

  it('parses a thousands-separator total', () => {
    const data = { orders: [{ orderId: 'o4', restaurantId: 'r4', orderTotal: '₹1,200', orderedTime: '2026-08-17', isActiveOrder: false, actions: [] }] };
    expect(toAccountOrders(data)[0].orderTotal).toBe(1200);
  });

  it('extracts snake-cased cuisines from order details', () => {
    expect(cuisinesFromOrderDetails({ order: { restaurant_cuisine: ['Biryani', 'North Indian'] } }))
      .toEqual(['biryani', 'north_indian']);
    // also tolerates a flat shape
    expect(cuisinesFromOrderDetails({ restaurant_cuisine: ['Thai'] })).toEqual(['thai']);
  });
});
