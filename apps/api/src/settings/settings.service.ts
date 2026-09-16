import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<{ key: string; value: unknown }> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return { key, value: row === null ? null : row.value };
  }

  async put(key: string, value: unknown): Promise<{ key: string; value: unknown }> {
    const json = value as Prisma.InputJsonValue;
    const row = await this.prisma.setting.upsert({
      where: { key },
      update: { value: json },
      create: { key, value: json },
    });
    return { key, value: row.value };
  }
}
