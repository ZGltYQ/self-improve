import { RuleFilter } from './rule.js';
import { ContextCategory, ContextSearchResult } from './project-context.js';

export interface StoreCorrectionInput {
  title: string;
  description: string;
  what_was_wrong?: string;
  what_is_right: string;
  why: string;
  file_paths?: string[];
  tech_stack?: string[];
  tags?: string[];
  scope: 'global' | 'project';
  project_name?: string;
  bad_example?: string;
  good_example: string;
}

export interface QueryRulesInput {
  query: string;
  current_file?: string;
  tech_stack?: string[];
  project_name?: string;
  limit?: number;
}

export interface ListRulesInput {
  scope?: 'global' | 'project';
  project_name?: string;
  tech_stack?: string[];
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface DeleteRuleInput {
  id: string;
}

export interface AnalyzeCorrectionsInput {
  conversation: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  current_file?: string;
  tech_stack?: string[];
  project_name?: string;
}

export interface AnalyzeCorrectionsOutput {
  detected_corrections: Array<{
    confidence: number;
    user_message: string;
    assistant_code?: string;
    user_fix?: string;
    indicators: string[];
  }>;
  suggested_rules: Array<{
    partial_rule: Partial<StoreCorrectionInput>;
    confidence: number;
  }>;
}

export interface GetStatisticsOutput {
  total_rules: number;
  by_category: Record<string, number>;
  by_tech_stack: Record<string, number>;
  most_used: Array<{
    rule: {
      id: string;
      title: string;
    };
    usage_count: number;
  }>;
  least_used: Array<{
    rule: {
      id: string;
      title: string;
    };
    usage_count: number;
    days_since_created: number;
  }>;
  recent_additions: Array<{
    id: string;
    title: string;
    created_at: string;
  }>;
}

export interface PruneRulesInput {
  dry_run?: boolean;
  delete_unused_days?: number;
  similarity_threshold?: number;
}

export interface PruneRulesOutput {
  deleted: string[];
  merged: string[];
  archived: string[];
  summary: string;
}

export interface SetProjectContextInput {
  project_name: string;
  category: ContextCategory;
  title: string;
  content: string;
  related_services?: string[];
  tags?: string[];
}

export interface GetProjectContextInput {
  project_name: string;
  category?: ContextCategory;
  query?: string;
  limit?: number;
}

export interface QueryRulesOutput {
  context: ContextSearchResult[];
  rules: import('./rule.js').SearchResult[];
}

export interface LLMConfig {
  provider: 'ollama' | 'openai' | 'minimax';
  model: string;
  api_key?: string;
  tenant_id?: string;
  base_url?: string;
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
