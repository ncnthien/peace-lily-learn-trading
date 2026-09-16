import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class AppController {
  @Get()
  getHealth(): { status: string; uptime: number } {
    return { status: 'ok', uptime: process.uptime() };
  }
}
