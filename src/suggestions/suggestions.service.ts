import { Inject, Injectable } from '@nestjs/common';
import { SWIGGY_MCP_CLIENT } from '../mcp/mcp.module';
import { RestaurantResult, SwiggyMcpClient } from '../mcp/mcp-client.interface';
import { PreferencesService, PreferenceProfile } from '../preferences/preferences.service';
import { RankingService, RankedSuggestion } from '../ranking/ranking.service';

function currentTimeSlot(date = new Date()): string {
  const h = date.getHours();
  if (h >= 6 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 15 && h < 18) return 'evening_snack';
  if (h >= 18 && h < 23) return 'dinner';
  return 'late_night';
}

const MEAL_DEFAULT_QUERY: Record<string, string> = {
  breakfast: 'south indian',
  lunch: 'thali',
  evening_snack: 'rolls',
  dinner: 'biryani',
  late_night: 'pizza',
};

function searchQueries(profile: PreferenceProfile, slot: string): string[] {
  const top = Object.entries(profile.cuisineCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([cuisine]) => cuisine.replace('_', ' '));
  return top.length ? top : [MEAL_DEFAULT_QUERY[slot] ?? 'popular'];
}

@Injectable()
export class SuggestionsService {
  constructor(
    @Inject(SWIGGY_MCP_CLIENT) private mcpClient: SwiggyMcpClient,
    private preferences: PreferencesService,
    private ranking: RankingService,
  ) {}

  async getTopSuggestions(userId: string, addressId?: string): Promise<RankedSuggestion[]> {
    const profile = await this.preferences.getProfile(userId);
    const slot = currentTimeSlot();

    const resolvedAddressId = addressId ?? (await this.mcpClient.getAddresses())[0]?.addressId;
    if (!resolvedAddressId) return [];

    const topN = 5;
    const byId = new Map<string, RestaurantResult>();
    for (const q of searchQueries(profile, slot)) {
      const results = await this.mcpClient.searchRestaurants({ addressId: resolvedAddressId, query: q });
      for (const r of results) byId.set(r.restaurantId, r);
    }

    // Cast a wide net; rank narrows it. The personalized top-cuisine searches above
    // can come up short (small mock fixtures, narrow real-world matches), so top up
    // the candidate pool with a broad 'popular' search when we don't have enough yet.
    if (byId.size < topN) {
      const popular = await this.mcpClient.searchRestaurants({ addressId: resolvedAddressId, query: 'popular' });
      for (const r of popular) byId.set(r.restaurantId, r);
    }

    return this.ranking.rank([...byId.values()], profile, slot, topN);
  }

  async acceptSuggestion(userId: string, restaurantId: string, _itemIds: string[]) {
    await this.preferences.recordFeedback(userId, restaurantId, 'accepted');
    // Ordering is completed in Phase 4 (buildCart → confirm → placeOrder).
    return { recorded: true };
  }

  async skipSuggestion(userId: string, restaurantId: string) {
    return this.preferences.recordFeedback(userId, restaurantId, 'skipped');
  }
}
