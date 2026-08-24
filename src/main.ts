import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Smart Order Agent running on http://localhost:${port}`);
  console.log(`Try: GET http://localhost:${port}/suggestions?userId=dj&lat=28.6&lng=77.2`);
}
bootstrap();
