import { Injectable } from '@nestjs/common';
import { RestaurantResult } from '../mcp/mcp-client.interface';
import { PreferenceProfile } from '../preferences/preferences.service';

export interface RankedSuggestion {
  restaurant: RestaurantResult;
  score: number;
  reason: string;
  isExplorePick: boolean;
}

const WEIGHTS = {
  frequency: 0.35,
  timeMatch: 0.2,
  priceFit: 0.2,
  recencyPenalty: 0.15, // ordered very recently -> slight down-rank, avoid repeat fatigue
  rejectionPenalty: 0.25,
};

@Injectable()
export class RankingService {
  /**
   * Ranks live, open restaurants against the user's profile and returns
   * the top N, reserving one slot for an "explore" pick (same cuisine
   * cluster as the top match, but not something the user has ordered before).
   */
  rank(
    candidates: RestaurantResult[],
    profile: PreferenceProfile,
    currentTimeSlot: string,
    topN = 5,
  ): RankedSuggestion[] {
    const openCandidates = candidates.filter((c) => c.isOpen);
    const totalOrders = Object.values(profile.cuisineCounts).reduce((a, b) => a + b, 0) || 1;

    const scored = openCandidates.map((r) => {
      const frequencyScore = (profile.cuisineCounts[r.cuisine] || 0) / totalOrders;

      const timeMatchScore =
        (profile.timeSlotCounts[currentTimeSlot] || 0) /
        (Object.values(profile.timeSlotCounts).reduce((a, b) => a + b, 0) || 1);

      const priceFitScore = profile.avgOrderValue
        ? 1 - Math.min(Math.abs(r.avgPrice - profile.avgOrderValue) / profile.avgOrderValue, 1)
        : 0.5;

      const recencyIndex = profile.recentRestaurantIds.indexOf(r.restaurantId);
      const recencyPenalty = recencyIndex === -1 ? 0 : 1 - recencyIndex / profile.recentRestaurantIds.length;

      const rejectionPenalty = profile.rejectedRestaurantIds.includes(r.restaurantId) ? 1 : 0;

      const score =
        WEIGHTS.frequency * frequencyScore +
        WEIGHTS.timeMatch * timeMatchScore +
        WEIGHTS.priceFit * priceFitScore -
        WEIGHTS.recencyPenalty * recencyPenalty -
        WEIGHTS.rejectionPenalty * rejectionPenalty +
        r.rating / 50; // small tie-breaker nudge from rating, out of 5 -> max +0.1

      return { restaurant: r, score, frequencyScore, isNewToUser: recencyIndex === -1 && frequencyScore === 0 };
    });

    scored.sort((a, b) => b.score - a.score);

    const known = scored.filter((s) => !s.isNewToUser);
    const novel = scored.filter((s) => s.isNewToUser);

    const picks: RankedSuggestion[] = [];

    // Fill up to topN - 1 with known/history-matched picks
    for (const s of known.slice(0, topN - 1)) {
      picks.push({
        restaurant: s.restaurant,
        score: s.score,
        reason: this.explain(s.restaurant, s.frequencyScore, currentTimeSlot),
        isExplorePick: false,
      });
    }

    // Reserve last slot for an explore pick from the same cuisine as the #1 known pick, if available
    const topCuisine = known[0]?.restaurant.cuisine;
    const explorePick =
      novel.find((s) => s.restaurant.cuisine === topCuisine) || novel[0] || known[topN - 1];

    if (explorePick && picks.length < topN) {
      picks.push({
        restaurant: explorePick.restaurant,
        score: explorePick.score,
        reason: `New pick — similar to what you usually order, worth trying`,
        isExplorePick: true,
      });
    }

    // Backfill if we still have fewer than topN (small candidate pool)
    for (const s of scored) {
      if (picks.length >= topN) break;
      if (!picks.find((p) => p.restaurant.restaurantId === s.restaurant.restaurantId)) {
        picks.push({
          restaurant: s.restaurant,
          score: s.score,
          reason: this.explain(s.restaurant, s.frequencyScore, currentTimeSlot),
          isExplorePick: false,
        });
      }
    }

    return picks.slice(0, topN);
  }

  private explain(r: RestaurantResult, frequencyScore: number, timeSlot: string): string {
    if (frequencyScore > 0.25) return `You order ${r.cuisine.replace('_', ' ')} often — a regular favorite`;
    if (frequencyScore > 0) return `Matches your usual ${r.cuisine.replace('_', ' ')} preference`;
    return `Fits your ${timeSlot.replace('_', ' ')} pattern, ${r.etaMinutes} min away`;
  }
}
