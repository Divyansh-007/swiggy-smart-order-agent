// NOTE: written against Swiggy's DOCUMENTED order-history schema
// (get_food_orders / get_food_order_details). Reconcile against LIVE payloads
// on the next authenticated OAuth capture — same as swiggy-response.adapter.ts.
import { AccountOrder, ReorderItem } from '../mcp-client.interface';

function snake(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, '_');
}

/** Swiggy sends money as a display string ("₹340" / "₹1,200"); pull the integer out. */
function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const m = v.replace(/,/g, '').match(/\d+/);
    return m ? Number(m[0]) : 0;
  }
  return 0;
}

function parseDate(v: unknown): Date {
  const d = new Date(v as any);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

/** Pull the exact re-add items out of the order's reorder action (empty if none). */
function reorderItemsOf(order: any): ReorderItem[] {
  const action = (order.actions ?? []).find((a: any) => a?.reorderMeta?.orderItems?.length);
  const items = action?.reorderMeta?.orderItems ?? [];
  return items
    .map((i: any) => ({
      menuItemId: i.menu_item_id ?? i.item_id ?? '',
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
    orderedAt: parseDate(o.orderedTime ?? o.order_time),
    isActiveOrder: !!o.isActiveOrder,
    reorderItems: reorderItemsOf(o),
  }));
}

export function cuisinesFromOrderDetails(data: unknown): string[] {
  const cuisines =
    (data as any)?.order?.restaurant_cuisine ?? (data as any)?.restaurant_cuisine ?? [];
  return (cuisines as string[]).map(snake);
}
