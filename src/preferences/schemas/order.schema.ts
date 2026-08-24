import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OrderDocument = Order & Document;

@Schema({ timestamps: false })
export class Order {
  @Prop({ required: true, index: true })
  userId: string;

  @Prop({ required: true })
  restaurantId: string;

  @Prop({ required: true })
  restaurantName: string;

  @Prop({ required: true })
  cuisine: string;

  @Prop({ required: true })
  orderValue: number;

  @Prop({ required: true })
  orderedAt: Date;

  // 0 = Sunday .. 6 = Saturday, derived from orderedAt at write time
  @Prop({ required: true })
  dayOfWeek: number;

  // 'breakfast' | 'lunch' | 'evening_snack' | 'dinner' | 'late_night'
  @Prop({ required: true })
  timeSlot: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
