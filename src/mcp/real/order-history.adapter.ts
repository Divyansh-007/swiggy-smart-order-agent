// RECONCILED against LIVE get_food_orders payloads (captured 2026-08-24).
// Key live-vs-doc differences the capture caught:
//   - reorder item id field is `itemId` (docs said menu_item_id/item_id).
//   - orderedTime is "Month DD, H:MM AM/PM" with NO year (JS mis-parses the year).
import { AccountOrder, ReorderItem } from '../mcp-client.interface';

/** Swiggy sends money as a display string ("₹340" / "₹1,200"); pull the integer out. */
function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/\d+/);
    return m ? Number(m[0]) : 0;
  }
  return 0;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * get_food_orders' `orderedTime` is a yearless display string ("August 11, 1:11 PM").
 * `new Date()` mis-guesses the year (→ 2001), which would wreck recency ranking, so parse
 * it explicitly and assume the most-recent past occurrence. Full/ISO dates fall back to native.
 */
function parseOrderedAt(v: unknown): Date {
  if (typeof v === 'string') {
    const m = v.trim().match(/^([A-Za-z]{3,})\s+(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (m) {
      const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      if (mi >= 0) {
        let hour = Number(m[3]) % 12;
        if (m[5] && m[5].toUpperCase() === 'PM') hour += 12;
        const now = new Date();
        let cand = new Date(now.getFullYear(), mi, Number(m[2]), hour, Number(m[4]));
        // yearless → if it lands in the future, it must be last year's order
        if (cand.getTime() > now.getTime() + 24 * 3600 * 1000) {
          cand = new Date(now.getFullYear() - 1, mi, Number(m[2]), hour, Number(m[4]));
        }
        return cand;
      }
    }
  }
  const d = new Date(v as any);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

/** Pull the exact re-add items out of the order's reorder action (empty if none). */
function reorderItemsOf(order: any): ReorderItem[] {
  const action = (order.actions ?? []).find((a: any) => a?.reorderMeta?.orderItems?.length);
  const items = action?.reorderMeta?.orderItems ?? [];
  return items
    .map((i: any) => ({
      menuItemId: i.itemId ?? i.menu_item_id ?? i.item_id ?? '',
      name: i.name ?? '',
      quantity: Number(i.quantity ?? 1),
    }))
    .filter((i: ReorderItem) => i.menuItemId);
}

export function toAccountOrders(data: unknown): AccountOrder[] {
  const arr = (data as any)?.orders ?? (Array.isArray(data) ? data : []);
  return arr.map((o: any) => ({
    orderId: o.orderId ?? o.order_id,
    restaurantId: o.restaurantId ?? o.restaurant_id,
    restaurantName: o.restaurantName ?? o.restaurant_name ?? '',
    orderTotal: parseAmount(o.orderTotal ?? o.order_total),
    orderedAt: parseOrderedAt(o.orderedTime ?? o.order_time),
    isActiveOrder: !!o.isActiveOrder,
    reorderItems: reorderItemsOf(o),
  }));
}
