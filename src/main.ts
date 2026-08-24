import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3000;
  const demoUser = process.env.DEFAULT_USER_ID || 'dj';
  await app.listen(port);
  console.log(`Smart Order Agent running on http://localhost:${port}`);
  console.log(`Try: GET http://localhost:${port}/suggestions?userId=${demoUser}`);
  console.log(`  (add &addressId=<id> to target a specific Swiggy address)`);
  console.log(`Real Swiggy mode (USE_MOCK_MCP=false)? Sign in first: http://localhost:${port}/oauth/login`);
}
bootstrap();
