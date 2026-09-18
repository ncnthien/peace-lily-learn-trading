import { Module } from '@nestjs/common';
import { OrderExecutionModule } from '../order-execution/order-execution.module.js';
import { AutomationController } from './automation.controller.js';
import { AutomationRunner } from './automation.runner.js';
import { AutomationService } from './automation.service.js';
import { ProviderRegistry } from './providers/provider.registry.js';
import { TimeProvider } from './providers/time.provider.js';
import { ConditionEvaluator } from './rule-engine/condition.evaluator.js';

@Module({
  imports: [OrderExecutionModule],
  controllers: [AutomationController],
  providers: [
    // The registry must be constructed before providers so they can
    // self-register in their constructors.
    ProviderRegistry,
    TimeProvider,
    ConditionEvaluator,
    AutomationService,
    AutomationRunner,
  ],
  exports: [
    ProviderRegistry,
    ConditionEvaluator,
    AutomationService,
    AutomationRunner,
  ],
})
export class AutomationModule {}
