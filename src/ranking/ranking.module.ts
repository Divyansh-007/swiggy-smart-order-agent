import { Module } from '@nestjs/common';
import { RankingService } from './ranking.service';
import { ReorderRankingService } from './reorder-ranking.service';

@Module({
  providers: [RankingService, ReorderRankingService],
  exports: [RankingService, ReorderRankingService],
})
export class RankingModule {}
