import type { ChatProvider, ModelRef } from './types.js';

class ProviderRegistry {
  private providers = new Map<string, ChatProvider>();

  register(provider: ChatProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): ChatProvider | undefined {
    return this.providers.get(id);
  }

  list(): ChatProvider[] {
    return Array.from(this.providers.values());
  }

  getAllModels(): ModelRef[] {
    return this.list().flatMap((p) => p.models);
  }
}

export const providerRegistry = new ProviderRegistry();