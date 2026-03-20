import { LLMProvider, LLMMessage, LLMResponse } from '../types.js';

interface MiniMaxTokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

export class MiniMaxProvider extends LLMProvider {
  private apiKey: string;
  private tenantId: string;
  private model: string;
  private temperature?: number;
  private maxTokens?: number;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: { api_key?: string; tenant_id?: string; model: string; temperature?: number; max_tokens?: number }) {
    super({ provider: 'minimax', model: config.model });
    this.apiKey = config.api_key || '';
    this.tenantId = config.tenant_id || '';
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.max_tokens;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await fetch('https://api.minimax.chat/v1/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.tenantId,
        client_secret: this.apiKey,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MiniMax token error: ${response.status} - ${error}`);
    }

    const data = await response.json() as MiniMaxTokenResponse;
    
    if (!data.access_token) {
      throw new Error('MiniMax: No access token received');
    }

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + ((data.expires_in || 7200) * 1000) - 60000;
    
    return this.accessToken!;
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    const token = await this.getAccessToken();

    const groupId = 'default';
    
    const response = await fetch(`https://api.minimax.chat/v1/text/chatcompletion_v2?GroupId=${groupId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
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
      throw new Error(`MiniMax API error: ${response.status} - ${error}`);
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
    return [
      'abab6.5s-chat',
      'abab6.5g-chat',
      'abab6.5speech-chat',
      'abab5.5s-chat',
      'abab5.5g-chat',
    ];
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey || !this.tenantId) return false;
    try {
      await this.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }
}
