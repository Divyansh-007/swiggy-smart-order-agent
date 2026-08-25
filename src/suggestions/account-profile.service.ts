import { Inject, Injectable } from '@nestjs/common';
import { SWIGGY_MCP_CLIENT } from '../mcp/mcp.module';
import { AccountOrder, ReorderItem, SwiggyMcpClient } from '../mcp/mcp-client.interface';
import { PreferencesService, PreferenceProfile } from '../preferences/preferences.service';

export interface RestaurantMeta {
  restaurantId: string;
  name: string;
  count: number;
  lastOrderedAt: Date;
  avgValue: number;
  reorderItems: ReorderItem[]; // from the most-recent order at this restaurant
}

export interface AccountProfile extends PreferenceProfile {
  restaurants: RestaurantMeta[]; // distinct, for reorder ranking
}

// Mirrors the boundaries used in src/seed.ts (timeSlotFor) and
// src/suggestions/suggestions.service.ts (currentTimeSlot).
function timeSlotFor(hour: number): string {
  if (hour >= 6 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 18) return 'evening_snack';
  if (hour >= 18 && hour < 23) return 'dinner';
  return 'late_night';
}

@Injectable()
export class AccountProfileService {
  constructor(
    @Inject(SWIGGY_MCP_CLIENT) private mcpClient: SwiggyMcpClient,
    private preferences: PreferencesService,
  ) {}

  async build(userId: string, addressId: string): Promise<AccountProfile> {
    const orders = await this.mcpClient.getOrderHistory(addressId);

    // Group by restaurant, tracking the most-recent order per restaurant
    // (orders are assumed newest-first, but we compare orderedAt to be safe).
    const byRestaurant = new Map<
      string,
      { name: string; orders: AccountOrder[]; mostRecent: AccountOrder }
    >();

    for (const order of orders) {
      const existing = byRestaurant.get(order.restaurantId);
      if (!existing) {
        byRestaurant.set(order.restaurantId, {
          name: order.restaurantName,
          orders: [order],
          mostRecent: order,
        });
      } else {
        existing.orders.push(order);
        if (order.orderedAt.getTime() > existing.mostRecent.orderedAt.getTime()) {
          existing.mostRecent = order;
        }
      }
    }

    const restaurants: RestaurantMeta[] = [...byRestaurant.entries()].map(([restaurantId, entry]) => {
      const totalValue = entry.orders.reduce((sum, o) => sum + o.orderTotal, 0);
      return {
        restaurantId,
        name: entry.name,
        count: entry.orders.length,
        lastOrderedAt: entry.mostRecent.orderedAt,
        avgValue: entry.orders.length ? totalValue / entry.orders.length : 0,
        reorderItems: entry.mostRecent.reorderItems,
      };
    });

    const avgOrderValue = orders.length
      ? orders.reduce((sum, o) => sum + o.orderTotal, 0) / orders.length
      : 0;

    const timeSlotCounts: Record<string, number> = {};
    for (const order of orders) {
      const slot = timeSlotFor(order.orderedAt.getHours());
      timeSlotCounts[slot] = (timeSlotCounts[slot] || 0) + 1;
    }

    // Distinct restaurantIds, newest-first, based on each restaurant's most-recent order.
    const recentRestaurantIds = restaurants
      .slice()
      .sort((a, b) => b.lastOrderedAt.getTime() - a.lastOrderedAt.getTime())
      .map((r) => r.restaurantId);

    // Live get_food_order_details returns no per-order cuisine data, so there's
    // nothing to enrich here. Left empty for the ranking engine to fall back on
    // price-fit/recency instead of cuisine-frequency.
    const cuisineCounts: Record<string, number> = {};

    const { rejectedRestaurantIds } = await this.preferences.getProfile(userId);

    return {
      cuisineCounts,
      avgOrderValue,
      timeSlotCounts,
      recentRestaurantIds,
      rejectedRestaurantIds,
      restaurants,
    };
  }
}
