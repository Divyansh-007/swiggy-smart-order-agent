import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SuggestionsModule } from './suggestions/suggestions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGO_URI') ?? 'mongodb://localhost:27017/smart-order-agent',
        // stdio server must not hang or crash when Mongo is absent — fail fast,
        // don't buffer commands forever; PreferencesService degrades gracefully.
        serverSelectionTimeoutMS: 2000,
        bufferCommands: false,
        connectionFactory: (connection: any) => {
          connection.on('error', (err: Error) =>
            process.stderr.write(`[mongo] connection error (feedback disabled): ${err.message}\n`),
          );
          return connection;
        },
      }),
    }),
    SuggestionsModule,
  ],
})
export class AppModule {}
