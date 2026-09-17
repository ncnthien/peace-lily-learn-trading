import { Module } from '@nestjs/common';
import { AutomationController } from './automation.controller.js';
import { AutomationService } from './automation.service.js';
import { ProviderRegistry } from './providers/provider.registry.js';
import { TimeProvider } from './providers/time.provider.js';
import { ConditionEvaluator } from './rule-engine/condition.evaluator.js';

@Module({
  providers: [
    // The registry must be constructed before providers so they can
    // self-register in their constructors.
    ProviderRegistry,
    TimeProvider,
    ConditionEvaluator,
    AutomationService,
    AutomationController,
  ],
  exports: [
    ProviderRegistry,
    ConditionEvaluator,
    AutomationService,
  ],
})
export class AutomationModule {}
