export type LLMProviderType = 'ollama' | 'openai' | 'minimax';

export interface LLMConfig {
  provider: LLMProviderType;
  model: string;
  api_key?: string;
  tenant_id?: string;
  base_url?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

export interface LLMError extends Error {
  provider?: LLMProviderType;
  statusCode?: number;
}

export abstract class LLMProvider {
  public config: LLMConfig;
  
  constructor(config: LLMConfig) {
    this.config = config;
  }
  
  abstract chat(messages: LLMMessage[]): Promise<LLMResponse>;
  abstract listModels(): Promise<string[]>;
  abstract isAvailable(): Promise<boolean>;
}
