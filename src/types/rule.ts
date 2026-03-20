export interface CodingRule {
  id: string;
  title: string;
  description: string;
  context: {
    what_was_wrong: string;
    what_is_right: string;
    why: string;
  };
  metadata: {
    file_paths: string[];
    tech_stack: string[];
    tags: string[];
    scope: 'global' | 'project';
    project_name?: string;
  };
  examples: {
    bad?: string;
    good: string;
  }[];
  statistics: {
    created_at: string;
    last_used: string;
    usage_count: number;
    violation_count: number;
  };
}

export interface QueryContext {
  current_file?: string;
  current_code?: string;
  tech_stack?: string[];
  error_message?: string;
  recent_changes?: string;
  project_name?: string;
}

export interface RuleFilter {
  scope?: 'global' | 'project';
  project_name?: string;
  tech_stack?: string[];
  tags?: string[];
  file_paths?: string[];
}

export interface SearchResult {
  rule: CodingRule;
  similarity: number;
}
