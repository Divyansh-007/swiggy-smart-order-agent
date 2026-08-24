import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from './schemas/order.schema';
import { Feedback, FeedbackSchema } from './schemas/feedback.schema';
import { PreferencesService } from './preferences.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Feedback.name, schema: FeedbackSchema },
    ]),
  ],
  providers: [PreferencesService],
  exports: [PreferencesService],
})
export class PreferencesModule {}
