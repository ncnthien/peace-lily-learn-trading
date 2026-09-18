import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import {
  CreateAutomationInputSchema,
  UpdateAutomationInputSchema,
} from '@workspace/shared';
import { AutomationService } from './automation.service.js';

/**
 * Zod DTOs — the schema is the source of truth; the DTO class exists so
 * NestJS's ZodValidationPipe (registered globally in main.ts) can read
 * the schema off the @Body() parameter type via reflection. The TS
 * shape of a DTO instance is identical to `z.infer<typeof Schema>`.
 */
class CreateAutomationDto extends createZodDto(CreateAutomationInputSchema) {}
class UpdateAutomationDto extends createZodDto(UpdateAutomationInputSchema) {}

@Controller('automation')
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  list(@Query('accountId') accountId?: string) {
    return this.automation.list(
      accountId !== undefined ? { accountId } : {},
    );
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.automation.getById(id);
  }

  @Post()
  create(@Body() body: CreateAutomationDto) {
    return this.automation.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateAutomationDto,
  ) {
    return this.automation.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.automation.remove(id);
  }
}
