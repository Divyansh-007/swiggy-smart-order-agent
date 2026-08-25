import { toAccountOrders } from './order-history.adapter';

// Fixtures mirror Swiggy's documented order-history structure with SYNTHETIC
// values only (real payloads carry PII). Reconcile field names on live capture.
describe('order-history adapters', () => {
  // Mirrors the LIVE get_food_orders shape captured 2026-08-24: reorder items use
  // `itemId` (string), and orderedTime is a yearless "Month DD, H:MM AM/PM" string.
  it('maps a live-shaped order: ₹ total, yearless date, itemId reorder items', () => {
    const data = {
      orders: [
        {
          orderId: '245403687192395',
          restaurantId: '25178',
          restaurantName: 'BTW',
          orderTotal: '₹377',
          orderedTime: 'August 11, 1:11 PM',
          isActiveOrder: false,
          actions: [
            {
              type: 'PAST_ORDER_CTA_ENUM_REORDER',
              reorderMeta: {
                orderItems: [{ itemId: '204856612', name: 'Ghewar Mawa 50 GM', isVeg: '1', quantity: '1' }],
              },
            },
          ],
        },
      ],
    };
    const [o] = toAccountOrders(data);
    expect(o).toMatchObject({
      orderId: '245403687192395',
      restaurantId: '25178',
      orderTotal: 377,
      isActiveOrder: false,
      reorderItems: [{ menuItemId: '204856612', name: 'Ghewar Mawa 50 GM', quantity: 1 }],
    });
    // yearless "August 11, 1:11 PM" must resolve to the correct month/hour, NOT year 2001
    expect(o.orderedAt.getMonth()).toBe(7); // August
    expect(o.orderedAt.getDate()).toBe(11);
    expect(o.orderedAt.getHours()).toBe(13); // 1:11 PM
    expect(o.orderedAt.getFullYear()).toBeGreaterThanOrEqual(2025);
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

});
