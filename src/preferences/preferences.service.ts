import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument } from './schemas/order.schema';
import { Feedback, FeedbackDocument } from './schemas/feedback.schema';

export interface PreferenceProfile {
  cuisineCounts: Record<string, number>;
  avgOrderValue: number;
  timeSlotCounts: Record<string, number>;
  recentRestaurantIds: string[]; // ordered most-recent-first, used for repeat-fatigue penalty
  rejectedRestaurantIds: string[]; // skipped in last N suggestions
}

@Injectable()
export class PreferencesService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Feedback.name) private feedbackModel: Model<FeedbackDocument>,
  ) {}

  async recordOrder(order: Omit<Order, never>) {
    return this.orderModel.create(order);
  }

  async recordFeedback(
    userId: string,
    restaurantId: string,
    action: 'accepted' | 'skipped',
  ): Promise<{ recorded: boolean; note?: string }> {
    try {
      await this.feedbackModel.create({ userId, restaurantId, action, suggestedAt: new Date() });
      return { recorded: true };
    } catch (e) {
      process.stderr.write(`[preferences] feedback not persisted: ${(e as Error).message}\n`);
      return { recorded: false, note: 'feedback not persisted (store offline)' };
    }
  }

  /**
   * Builds a lightweight preference profile from raw order history.
   * Deliberately simple (counts + averages) — the ranking engine does
   * the actual scoring. This just gives it clean inputs.
   */
  async getProfile(userId: string): Promise<PreferenceProfile> {
    const empty: PreferenceProfile = {
      cuisineCounts: {},
      avgOrderValue: 0,
      timeSlotCounts: {},
      recentRestaurantIds: [],
      rejectedRestaurantIds: [],
    };
    try {
      const orders = await this.orderModel.find({ userId }).sort({ orderedAt: -1 }).limit(200).exec();

      const cuisineCounts: Record<string, number> = {};
      const timeSlotCounts: Record<string, number> = {};
      let totalValue = 0;
      for (const o of orders) {
        cuisineCounts[o.cuisine] = (cuisineCounts[o.cuisine] || 0) + 1;
        timeSlotCounts[o.timeSlot] = (timeSlotCounts[o.timeSlot] || 0) + 1;
        totalValue += o.orderValue;
      }

      const recentFeedback = await this.feedbackModel
        .find({ userId, action: 'skipped' })
        .sort({ createdAt: -1 })
        .limit(20)
        .exec();

      return {
        cuisineCounts,
        avgOrderValue: orders.length ? Math.round(totalValue / orders.length) : 0,
        timeSlotCounts,
        recentRestaurantIds: orders.slice(0, 10).map((o) => o.restaurantId),
        rejectedRestaurantIds: recentFeedback.map((f) => f.restaurantId),
      };
    } catch (e) {
      process.stderr.write(`[preferences] profile read failed, degrading: ${(e as Error).message}\n`);
      return empty;
    }
  }
}
