import { Module } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { PreferencesModule } from '../preferences/preferences.module';
import { RankingModule } from '../ranking/ranking.module';
import { SuggestionsService } from './suggestions.service';
import { SuggestionsController } from './suggestions.controller';

@Module({
  imports: [McpModule, PreferencesModule, RankingModule],
  controllers: [SuggestionsController],
  providers: [SuggestionsService],
})
export class SuggestionsModule {}
