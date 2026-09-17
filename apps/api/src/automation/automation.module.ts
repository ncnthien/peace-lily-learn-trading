import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller.js';
import { AutomationService } from './automation.service.js';
import { ConfluenceEvaluator } from './confluence/confluence.evaluator.js';
import { ProviderRegistry } from './providers/provider.registry.js';
import { TimeProvider } from './providers/time.provider.js';

@Module({
  providers: [
    // The registry must be constructed before providers so they can
    // self-register in their constructors.
    ProviderRegistry,
    TimeProvider,
    ConfluenceEvaluator,
    AutomationService,
    AutomationController,
  ],
  exports: [
    ProviderRegistry,
    ConfluenceEvaluator,
    AutomationService,
  ],
})
export class AutomationModule {}
