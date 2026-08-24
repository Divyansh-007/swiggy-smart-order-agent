import { Inject, Injectable } from '@nestjs/common';
import { SWIGGY_MCP_CLIENT } from '../mcp/mcp.module';
import { SwiggyMcpClient } from '../mcp/mcp-client.interface';
import { PreferencesService } from '../preferences/preferences.service';
import { RankingService, RankedSuggestion } from '../ranking/ranking.service';

function currentTimeSlot(date = new Date()): string {
  const h = date.getHours();
  if (h >= 6 && h < 11) return 'breakfast';
  if (h >= 11 && h < 15) return 'lunch';
  if (h >= 15 && h < 18) return 'evening_snack';
  if (h >= 18 && h < 23) return 'dinner';
  return 'late_night';
}

@Injectable()
export class SuggestionsService {
  constructor(
    @Inject(SWIGGY_MCP_CLIENT) private mcpClient: SwiggyMcpClient,
    private preferences: PreferencesService,
    private ranking: RankingService,
  ) {}

  async getTopSuggestions(userId: string, lat: number, lng: number): Promise<RankedSuggestion[]> {
    const profile = await this.preferences.getProfile(userId);

    // Cast a wide net first; rank narrows it. Could also filter by profile's
    // top cuisines here to cut down MCP payload size once real data volumes matter.
    const candidates = await this.mcpClient.searchRestaurants({ lat, lng });

    return this.ranking.rank(candidates, profile, currentTimeSlot(), 5);
  }

  async acceptSuggestion(userId: string, restaurantId: string, itemIds: string[]) {
    await this.preferences.recordFeedback(userId, restaurantId, 'accepted');
    return this.mcpClient.placeOrder({ restaurantId, itemIds });
  }

  async skipSuggestion(userId: string, restaurantId: string) {
    return this.preferences.recordFeedback(userId, restaurantId, 'skipped');
  }
}
