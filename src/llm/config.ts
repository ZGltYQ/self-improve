import { LLMConfig, LLMProviderType } from './types.js';

function getEnv(key: string, defaultValue?: string): string | undefined {
  return process.env[key] || defaultValue;
}

export function loadLLMConfig(): LLMConfig {
  const providerStr = getEnv('LLM_PROVIDER', 'ollama') as LLMProviderType;
  
  const config: LLMConfig = {
    provider: providerStr,
    model: getEnv('LLM_MODEL') || getDefaultModel(providerStr),
    temperature: parseFloat(getEnv('LLM_TEMPERATURE', '0.3') || '0.3'),
    max_tokens: parseInt(getEnv('LLM_MAX_TOKENS', '2048') || '2048'),
  };

  // Provider-specific config
  switch (providerStr) {
    case 'ollama':
      config.base_url = getEnv('OLLAMA_HOST', 'http://localhost:11434');
      break;
    case 'openai':
      config.api_key = getEnv('OPENAI_API_KEY');
      config.base_url = getEnv('OPENAI_BASE_URL');
      break;
    case 'minimax':
      config.api_key = getEnv('MINIMAX_API_KEY');
      config.tenant_id = getEnv('MINIMAX_TENANT_ID');
      break;
  }

  return config;
}

function getDefaultModel(provider: LLMProviderType): string {
  switch (provider) {
    case 'ollama':
      return 'llama3.2';
    case 'openai':
      return 'gpt-4o-mini';
    case 'minimax':
      return 'abab6.5s-chat';
    default:
      return 'llama3.2';
  }
}

export function getAvailableProviders(): { id: LLMProviderType; name: string; description: string }[] {
  return [
    { id: 'ollama', name: 'Local Ollama', description: 'Run local LLMs via Ollama' },
    { id: 'openai', name: 'OpenAI API', description: 'Use OpenAI API with API key' },
    { id: 'minimax', name: 'MiniMax API', description: 'Use MiniMax OAuth API' },
  ];
}

export function getProviderConfigSchema(provider: LLMProviderType): Record<string, { required: boolean; description: string }> {
  switch (provider) {
    case 'ollama':
      return {
        OLLAMA_HOST: { required: false, description: 'Ollama host (default: http://localhost:11434)' },
        LLM_MODEL: { required: false, description: 'Model name (default: llama3.2)' },
      };
    case 'openai':
      return {
        OPENAI_API_KEY: { required: true, description: 'OpenAI API key' },
        OPENAI_BASE_URL: { required: false, description: 'OpenAI base URL (for proxies)' },
        LLM_MODEL: { required: false, description: 'Model name (default: gpt-4o-mini)' },
      };
    case 'minimax':
      return {
        MINIMAX_API_KEY: { required: true, description: 'MiniMax API key' },
        MINIMAX_TENANT_ID: { required: true, description: 'MiniMax tenant ID' },
        LLM_MODEL: { required: false, description: 'Model name (default: abab6.5s-chat)' },
      };
    default:
      return {};
  }
}
