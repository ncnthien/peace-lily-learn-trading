import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get(':key')
  get(@Param('key') key: string) {
    return this.settings.get(key);
  }

  @Put(':key')
  put(@Param('key') key: string, @Body() body: { value?: unknown }) {
    return this.settings.put(key, body?.value ?? null);
  }
}
