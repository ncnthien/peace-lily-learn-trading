import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { OrderExecutionModule } from '../order-execution/order-execution.module.js';
import { ActionExecutor } from './action-executor.js';
import { AutomationController } from './automation.controller.js';
import { AutomationRunner } from './automation.runner.js';
import { AutomationService } from './automation.service.js';
import { ProviderRegistry } from './providers/provider.registry.js';
import { SRProvider } from './providers/sr.provider.js';
import { TimeProvider } from './providers/time.provider.js';
import { WaveProvider } from './providers/wave.provider.js';
import { ConditionEvaluator } from './rule-engine/condition.evaluator.js';

@Module({
  imports: [OrderExecutionModule, MarketDataModule],
  controllers: [AutomationController],
  providers: [
    // The registry must be constructed before providers so they can
    // self-register in their constructors.
    ProviderRegistry,
    TimeProvider,
    SRProvider,
    WaveProvider,
    ConditionEvaluator,
    AutomationService,
    ActionExecutor,
    AutomationRunner,
  ],
  exports: [
    ProviderRegistry,
    ConditionEvaluator,
    AutomationService,
    ActionExecutor,
    AutomationRunner,
  ],
})
export class AutomationModule {}
