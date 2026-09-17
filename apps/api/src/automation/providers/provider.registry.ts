import { Injectable, Logger } from '@nestjs/common';
import { Provider } from './provider.abstract.js';

/**
 * Maps provider `kind` strings to their concrete Provider instance.
 * Providers self-register in their constructors, so adding a new one means
 * just adding it to AutomationModule's providers list.
 */
@Injectable()
export class ProviderRegistry {
  private readonly logger = new Logger(ProviderRegistry.name);
  private readonly byKind = new Map<string, Provider<unknown, unknown>>();

  register<TConfig, TRawSignal>(provider: Provider<TConfig, TRawSignal>): void {
    if (this.byKind.has(provider.kind)) {
      throw new Error(
        `Provider "${provider.kind}" is already registered`,
      );
    }
    this.byKind.set(provider.kind, provider as Provider<unknown, unknown>);
    this.logger.log(`Registered provider: ${provider.kind}`);
  }

  get<TConfig, TRawSignal>(kind: string): Provider<TConfig, TRawSignal> | undefined {
    return this.byKind.get(kind) as Provider<TConfig, TRawSignal> | undefined;
  }

  list(): Array<Provider<unknown, unknown>> {
    return [...this.byKind.values()];
  }

  kinds(): string[] {
    return [...this.byKind.keys()];
  }
}
