import { setDefaultResultOrder } from 'node:dns';
import { NestFactory } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module.js';

setDefaultResultOrder('ipv4first');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // ZodValidationPipe reads `@Body(Dto)`, `@Query(Dto)`, `@Param(Dto)`
  // where the Dto is a `createZodDto(Schema)` class. It throws a 400 Bad
  // Request on failure. The standard NestJS ValidationPipe (class-validator)
  // is intentionally NOT used — Zod owns validation end-to-end.
  app.useGlobalPipes(new ZodValidationPipe());
  const corsOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins.length > 0 ? corsOrigins : true });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}
await bootstrap();
