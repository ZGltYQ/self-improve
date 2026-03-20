import { LLMProvider, LLMMessage, LLMResponse, LLMConfig } from '../types.js';

export class OllamaProvider extends LLMProvider {
  private baseUrl: string;
  private model: string;
  private temperature?: number;
  private maxTokens?: number;

  constructor(config: { base_url?: string; model: string; temperature?: number; max_tokens?: number }) {
    super({ provider: 'ollama', model: config.model });
    this.baseUrl = config.base_url || 'http://localhost:11434';
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.max_tokens;
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        stream: false,
        options: {
          temperature: this.temperature,
          num_predict: this.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    
    return {
      content: data.message?.content || '',
      model: this.model,
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json() as any;
      return data.models?.map((m: any) => m.name) || [];
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }
}
