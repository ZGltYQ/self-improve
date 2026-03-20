import { LLMProvider, LLMConfig, LLMMessage, LLMResponse, LLMProviderType } from '../types.js';
import { OllamaProvider } from './local-ollama.js';
import { OpenAIProvider } from './api-openai.js';
import { MiniMaxProvider } from './api-minimax.js';
import { loadLLMConfig } from '../config.js';

export class LLMService {
  private providers: Map<LLMProviderType, LLMProvider> = new Map();
  private primaryProvider: LLMProviderType;
  private fallbackOrder: LLMProviderType[];
  private config: LLMConfig;

  constructor(config?: LLMConfig) {
    this.config = config || loadLLMConfig();
    this.primaryProvider = this.config.provider;
    
    this.fallbackOrder = ['ollama', 'openai', 'minimax'].filter(
      p => p !== this.primaryProvider
    ) as LLMProviderType[];
  }

  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.config.provider, provider);
  }

  setFallbackOrder(order: LLMProviderType[]): void {
    this.fallbackOrder = order;
  }

  async chat(messages: LLMMessage[], useFallback: boolean = true): Promise<LLMResponse> {
    const errors: Error[] = [];

    const providersToTry = useFallback
      ? [this.primaryProvider, ...this.fallbackOrder]
      : [this.primaryProvider];

    for (const providerType of providersToTry) {
      const provider = this.getProvider(providerType);
      if (!provider) continue;

      try {
        const isAvailable = await provider.isAvailable();
        if (!isAvailable) continue;

        return await provider.chat(messages);
      } catch (error) {
        errors.push(error as Error);
        console.error(`Provider ${providerType} failed:`, (error as Error).message);
      }
    }

    throw new Error(
      `All LLM providers failed. Errors: ${errors.map(e => e.message).join('; ')}`
    );
  }

  getProvider(type?: LLMProviderType): LLMProvider | null {
    const providerType = type || this.primaryProvider;
    
    if (this.providers.has(providerType)) {
      return this.providers.get(providerType)!;
    }

    let provider: LLMProvider | null = null;
    
    switch (providerType) {
      case 'ollama':
        provider = new OllamaProvider(this.config as any);
        break;
      case 'openai':
        provider = new OpenAIProvider(this.config as any);
        break;
      case 'minimax':
        provider = new MiniMaxProvider(this.config as any);
        break;
    }

    if (provider) {
      this.providers.set(providerType, provider);
    }

    return provider;
  }

  async getAvailableProviders(): Promise<LLMProviderType[]> {
    const available: LLMProviderType[] = [];
    
    for (const type of ['ollama', 'openai', 'minimax'] as LLMProviderType[]) {
      const provider = this.getProvider(type);
      if (provider && await provider.isAvailable()) {
        available.push(type);
      }
    }

    return available;
  }

  getConfig(): LLMConfig {
    return { ...this.config };
  }

  getPrimaryProvider(): LLMProviderType {
    return this.primaryProvider;
  }
}

let llmServiceInstance: LLMService | null = null;

export function getLLMService(config?: LLMConfig): LLMService {
  if (!llmServiceInstance) {
    llmServiceInstance = new LLMService(config);
  }
  return llmServiceInstance;
}

export function initializeLLMService(config?: LLMConfig): LLMService {
  llmServiceInstance = new LLMService(config);
  return llmServiceInstance;
}
