import 'reflect-metadata';
import mongoose from 'mongoose';
import { Order, OrderSchema } from './preferences/schemas/order.schema';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/smart-order-agent';
const USER_ID = process.env.DEFAULT_USER_ID || 'dj';

function daysAgo(n: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function timeSlotFor(hour: number): string {
  if (hour >= 6 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 18) return 'evening_snack';
  if (hour >= 18 && hour < 23) return 'dinner';
  return 'late_night';
}

const seedOrders = [
  { restaurantId: 'r1', restaurantName: 'Bawarchi Biryani House', cuisine: 'biryani', orderValue: 340, daysBack: 2, hour: 21 },
  { restaurantId: 'r1', restaurantName: 'Bawarchi Biryani House', cuisine: 'biryani', orderValue: 360, daysBack: 9, hour: 20 },
  { restaurantId: 'r3', restaurantName: 'Punjab Grill Express', cuisine: 'north_indian', orderValue: 520, daysBack: 5, hour: 20 },
  { restaurantId: 'r6', restaurantName: 'South Spice', cuisine: 'south_indian', orderValue: 210, daysBack: 1, hour: 9 },
  { restaurantId: 'r6', restaurantName: 'South Spice', cuisine: 'south_indian', orderValue: 230, daysBack: 8, hour: 8 },
  { restaurantId: 'r2', restaurantName: 'Wok This Way', cuisine: 'chinese', orderValue: 410, daysBack: 4, hour: 21 },
  { restaurantId: 'r1', restaurantName: 'Bawarchi Biryani House', cuisine: 'biryani', orderValue: 350, daysBack: 16, hour: 21 },
  { restaurantId: 'r8', restaurantName: 'Momo Point', cuisine: 'tibetan', orderValue: 170, daysBack: 3, hour: 17 },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  const OrderModel = mongoose.model(Order.name, OrderSchema);

  await OrderModel.deleteMany({ userId: USER_ID });

  const docs = seedOrders.map((o) => {
    const orderedAt = daysAgo(o.daysBack, o.hour);
    return {
      userId: USER_ID,
      restaurantId: o.restaurantId,
      restaurantName: o.restaurantName,
      cuisine: o.cuisine,
      orderValue: o.orderValue,
      orderedAt,
      dayOfWeek: orderedAt.getDay(),
      timeSlot: timeSlotFor(o.hour),
    };
  });

  await OrderModel.insertMany(docs);
  console.log(`Seeded ${docs.length} orders for userId="${USER_ID}"`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
