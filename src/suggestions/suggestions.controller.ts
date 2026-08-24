import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SuggestionsService } from './suggestions.service';

@Controller('suggestions')
export class SuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  // GET /suggestions?userId=dj&addressId=addr_home
  @Get()
  async getSuggestions(@Query('userId') userId: string, @Query('addressId') addressId?: string) {
    const results = await this.suggestionsService.getTopSuggestions(userId, addressId);
    return {
      count: results.length,
      suggestions: results.map((s) => ({
        restaurant: s.restaurant.name,
        cuisine: s.restaurant.cuisine,
        etaMinutes: s.restaurant.etaMinutes,
        avgPrice: s.restaurant.avgPrice,
        reason: s.reason,
        isExplorePick: s.isExplorePick,
        score: Number(s.score.toFixed(3)),
      })),
    };
  }

  // POST /suggestions/accept  { userId, restaurantId, itemIds }
  @Post('accept')
  async accept(@Body() body: { userId: string; restaurantId: string; itemIds: string[] }) {
    return this.suggestionsService.acceptSuggestion(body.userId, body.restaurantId, body.itemIds || []);
  }

  // POST /suggestions/skip  { userId, restaurantId }
  @Post('skip')
  async skip(@Body() body: { userId: string; restaurantId: string }) {
    return this.suggestionsService.skipSuggestion(body.userId, body.restaurantId);
  }
}
