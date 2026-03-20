import { LLMProvider, LLMMessage, LLMResponse } from '../types.js';

export class OpenAIProvider extends LLMProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private temperature?: number;
  private maxTokens?: number;

  constructor(config: { base_url?: string; api_key?: string; model: string; temperature?: number; max_tokens?: number }) {
    super({ provider: 'openai', model: config.model });
    this.baseUrl = config.base_url || 'https://api.openai.com/v1';
    this.apiKey = config.api_key || '';
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.max_tokens;
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as any;
    
    return {
      content: data.choices?.[0]?.message?.content || '',
      model: data.model || this.model,
      usage: data.usage ? {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
      } : undefined,
    };
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (!response.ok) return [];
      const data = await response.json() as any;
      return data.data?.map((m: any) => m.id) || [];
    } catch {
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        method: 'HEAD',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
