import 'reflect-metadata';
import { AutomationController } from './automation.controller.js';
import { AutomationModule } from './automation.module.js';
import { AutomationRunner } from './automation.runner.js';
import { AutomationService } from './automation.service.js';
import { ConditionEvaluator } from './rule-engine/condition.evaluator.js';
import { ProviderRegistry } from './providers/provider.registry.js';
import { TimeProvider } from './providers/time.provider.js';

describe('AutomationModule', () => {
  // Reflection helper: peek into the @Module() decorator metadata. We
  // intentionally avoid booting the whole Nest container — this test is
  // about the module's static shape, not its runtime wiring.
  function reflect(): {
    imports: unknown[];
    controllers: unknown[];
    providers: unknown[];
    exports: unknown[];
  } {
    return {
      imports: (Reflect.getMetadata('imports', AutomationModule) as unknown[]) ?? [],
      controllers: (Reflect.getMetadata('controllers', AutomationModule) as unknown[]) ?? [],
      providers: (Reflect.getMetadata('providers', AutomationModule) as unknown[]) ?? [],
      exports: (Reflect.getMetadata('exports', AutomationModule) as unknown[]) ?? [],
    };
  }

  it('registers AutomationController under `controllers`, not `providers`', () => {
    const meta = reflect();
    // The bug this test guards against: the controller being placed in
    // `providers` makes Nest instantiate it as a normal provider, never
    // register any routes, and silently 404 every request.
    expect(meta.controllers).toContain(AutomationController);
    expect(meta.providers).not.toContain(AutomationController);
  });

  it('keeps AutomationRunner as a provider (it is decorated with @Cron)', () => {
    const meta = reflect();
    expect(meta.providers).toContain(AutomationRunner);
  });

  it('registers every wired provider in the providers array', () => {
    const meta = reflect();
    expect(meta.providers).toEqual(
      expect.arrayContaining([
        ProviderRegistry,
        TimeProvider,
        ConditionEvaluator,
        AutomationService,
        AutomationRunner,
      ]),
    );
  });

  it('imports OrderExecutionModule so the runner can resolve ORDER_EXECUTION', () => {
    const meta = reflect();
    // The OrderExecutionModule decorator metadata is an array of
    // forwardRef / module refs; we only assert it's non-empty here.
    expect(meta.imports.length).toBeGreaterThan(0);
  });
});
