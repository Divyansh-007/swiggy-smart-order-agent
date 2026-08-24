import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type FeedbackDocument = Feedback & Document;

@Schema({ timestamps: true })
export class Feedback {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  restaurantId: string;

  // 'accepted' | 'skipped'
  @Prop({ required: true })
  action: string;

  @Prop()
  suggestedAt: Date;
}

export const FeedbackSchema = SchemaFactory.createForClass(Feedback);
