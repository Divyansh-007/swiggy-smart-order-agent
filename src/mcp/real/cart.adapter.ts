// Written against DOCUMENTED update_food_cart/get_food_cart schema; reconcile against live payloads (Task 4).
import { CartSummary } from '../mcp-client.interface';

/**
 * Maps get_food_cart's payload to a domain CartSummary.
 * Real Swiggy shape (per docs): the cart payload lives under `data.data` —
 * `{ cart_id, restaurant:{id,name,area?}, items:[{menu_item_id,name,quantity,subtotal,total,final_price,in_stock?}],
 *   item_count, pricing:{item_total,delivery_charge,taxes_and_charges,to_pay}, offers }`.
 * Handles both the `.data`-nested shape and the inner object passed directly.
 */
export function toCartSummary(data: unknown): CartSummary {
  const c = (data as any)?.data ?? data ?? {};
  const items = (c.items ?? []).map((i: any) => ({
    name: i.name,
    quantity: Number(i.quantity ?? 1),
    price: Number(i.final_price ?? i.total ?? i.subtotal ?? 0),
  }));
  const pricing = c.pricing ?? {};
  return {
    restaurantId: c.restaurant?.id ?? '',
    restaurantName: c.restaurant?.name ?? '',
    items,
    itemTotal: Number(pricing.item_total ?? 0),
    toPay: Number(pricing.to_pay ?? pricing.item_total ?? 0),
  };
}
