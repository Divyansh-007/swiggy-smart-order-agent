import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SuggestionsService } from './suggestions.service';

@Controller('suggestions')
export class SuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  // GET /suggestions?userId=dj&addressId=addr_home
  @Get()
  async getSuggestions(@Query('userId') userId: string, @Query('addressId') addressId?: string) {
    const { reorder, discover } = await this.suggestionsService.getTopSuggestions(userId, addressId);
    return {
      reorder: reorder.map((s) => ({
        restaurant: s.name,
        restaurantId: s.restaurantId,
        score: Number(s.score.toFixed(3)),
        reason: s.reason,
        items: s.items.map((i) => ({ menuItemId: i.menuItemId, name: i.name, quantity: i.quantity })),
      })),
      discover: discover.map((s) => ({
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

  // POST /suggestions/surprise-cart  { userId, addressId? }
  @Post('surprise-cart')
  async surpriseCart(@Body() body: { userId: string; addressId?: string }) {
    return this.suggestionsService.surpriseToCart(body.userId, body.addressId);
  }
}
