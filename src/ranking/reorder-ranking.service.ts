import { Injectable } from '@nestjs/common';
import { ReorderItem } from '../mcp/mcp-client.interface';
import { AccountProfile, RestaurantMeta } from '../suggestions/account-profile.service';

export interface ReorderSuggestion {
  restaurantId: string;
  name: string;
  items: ReorderItem[];
  score: number;
  reason: string; // e.g. "Ordered 4× — your go-to; last time 6 days ago"
}

const WEIGHTS = {
  frequency: 0.4, // count / maxCount across the profile's restaurants
  recency: 0.25, // more-recently ordered -> higher
  priceFit: 0.2, // closeness of restaurant's avgValue to the user's overall avgOrderValue
  rejection: 0.3, // penalty when the restaurant is in rejectedRestaurantIds
};

interface Scored {
  restaurant: RestaurantMeta;
  score: number;
  reason: string;
}

@Injectable()
export class ReorderRankingService {
  /**
   * Ranks the user's past restaurants for re-ordering. Restaurants with no
   * reorderItems are skipped (nothing to auto-reorder) unless that would
   * drop the result below topN, in which case they're included with a note.
   */
  rank(profile: AccountProfile, _currentTimeSlot: string, topN = 5): ReorderSuggestion[] {
    const restaurants = profile.restaurants;
    if (restaurants.length === 0) return [];

    const maxCount = Math.max(...restaurants.map((r) => r.count)) || 1;

    const lastOrderedTimes = restaurants.map((r) => r.lastOrderedAt.getTime());
    const minTime = Math.min(...lastOrderedTimes);
    const maxTime = Math.max(...lastOrderedTimes);
    const timeRange = maxTime - minTime;

    const scored: Scored[] = restaurants.map((r) => {
      const frequency = r.count / maxCount;

      const recencyBoost = timeRange > 0 ? (r.lastOrderedAt.getTime() - minTime) / timeRange : 1;

      const priceFit = profile.avgOrderValue
        ? 1 - Math.min(Math.abs(r.avgValue - profile.avgOrderValue) / profile.avgOrderValue, 1)
        : 0.5;

      const rejectionPenalty = profile.rejectedRestaurantIds.includes(r.restaurantId) ? 1 : 0;

      const score =
        WEIGHTS.frequency * frequency +
        WEIGHTS.recency * recencyBoost +
        WEIGHTS.priceFit * priceFit -
        WEIGHTS.rejection * rejectionPenalty;

      const reason = this.explain(r, frequency, recencyBoost, priceFit);

      return { restaurant: r, score, reason };
    });

    scored.sort((a, b) => b.score - a.score);

    const withItems = scored.filter((s) => s.restaurant.reorderItems.length > 0);

    let selected: Scored[];
    if (withItems.length >= topN) {
      selected = withItems.slice(0, topN);
    } else {
      const withoutItems = scored.filter((s) => s.restaurant.reorderItems.length === 0);
      const needed = topN - withItems.length;
      const backfill = withoutItems.slice(0, needed).map((s) => ({
        ...s,
        reason: `${s.reason} (nothing saved to auto-reorder — you'll need to pick items)`,
      }));
      selected = [...withItems, ...backfill].sort((a, b) => b.score - a.score);
    }

    return selected.slice(0, topN).map((s) => ({
      restaurantId: s.restaurant.restaurantId,
      name: s.restaurant.name,
      items: s.restaurant.reorderItems,
      score: s.score,
      reason: s.reason,
    }));
  }

  private explain(r: RestaurantMeta, frequency: number, recencyBoost: number, priceFit: number): string {
    const contributions = [
      { label: `Ordered ${r.count}× — your go-to`, value: WEIGHTS.frequency * frequency },
      { label: 'Last ordered recently', value: WEIGHTS.recency * recencyBoost },
      { label: 'Fits your usual spend', value: WEIGHTS.priceFit * priceFit },
    ];
    contributions.sort((a, b) => b.value - a.value);
    return contributions[0].label;
  }
}
