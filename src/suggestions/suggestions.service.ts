import { Inject, Injectable } from '@nestjs/common';
import { SWIGGY_MCP_CLIENT } from '../mcp/mcp.module';
import { RestaurantResult, SwiggyMcpClient } from '../mcp/mcp-client.interface';
import { PreferencesService } from '../preferences/preferences.service';
import { RankingService, RankedSuggestion } from '../ranking/ranking.service';
import { ReorderRankingService, ReorderSuggestion } from '../ranking/reorder-ranking.service';
import { AccountProfileService, AccountProfile } from './account-profile.service';

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

// Strips size/qty noise (parentheticals, trailing unit tokens, "x2") off a raw
// dish name so it reads as a clean search query, e.g. "Chicken Biryani (350-450 GM)"
// -> "chicken biryani".
function cleanDishName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bx\d+\b/g, ' ')
    .replace(/\b\d+\s?(gm|g|ml|l|kg|pc|pcs)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Collects reorderItems[].name across every restaurant in the profile, cleans
// each, and returns the top 3 distinct dish keywords by frequency.
function topDishKeywords(profile: AccountProfile, n = 3): string[] {
  const counts = new Map<string, number>();
  for (const restaurant of profile.restaurants) {
    for (const item of restaurant.reorderItems) {
      const cleaned = cleanDishName(item.name);
      if (!cleaned) continue;
      counts.set(cleaned, (counts.get(cleaned) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([keyword]) => keyword);
}

@Injectable()
export class SuggestionsService {
  constructor(
    @Inject(SWIGGY_MCP_CLIENT) private mcpClient: SwiggyMcpClient,
    private preferences: PreferencesService,
    private ranking: RankingService,
    private accountProfile: AccountProfileService,
    private reorderRanking: ReorderRankingService,
  ) {}

  async getTopSuggestions(
    userId: string,
    addressId?: string,
  ): Promise<{ reorder: ReorderSuggestion[]; discover: RankedSuggestion[] }> {
    const resolvedAddressId = addressId ?? (await this.mcpClient.getAddresses())[0]?.addressId;
    if (!resolvedAddressId) return { reorder: [], discover: [] };

    const profile = await this.accountProfile.build(userId, resolvedAddressId);
    const slot = currentTimeSlot();

    const reorder = this.reorderRanking.rank(profile, slot, 5);
    const discover = await this.discoverNewRestaurants(profile, slot, resolvedAddressId);

    return { reorder, discover };
  }

  private async discoverNewRestaurants(
    profile: AccountProfile,
    slot: string,
    addressId: string,
  ): Promise<RankedSuggestion[]> {
    const topN = 5;
    const queries = [...topDishKeywords(profile, 3), MEAL_DEFAULT_QUERY[slot] ?? 'popular'];

    const byId = new Map<string, RestaurantResult>();
    const known = new Set(profile.recentRestaurantIds);
    const merge = (results: RestaurantResult[]) => {
      for (const r of results) {
        if (known.has(r.restaurantId)) continue;
        byId.set(r.restaurantId, r);
      }
    };

    for (const query of queries) {
      merge(await this.mcpClient.searchRestaurants({ addressId, query }));
    }

    // Dish/meal queries can come up short (small mock fixtures, narrow real-world
    // matches) — top up the candidate pool with a broad 'popular' search, still
    // excluding restaurants the user already knows.
    if (byId.size < topN) {
      merge(await this.mcpClient.searchRestaurants({ addressId, query: 'popular' }));
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
