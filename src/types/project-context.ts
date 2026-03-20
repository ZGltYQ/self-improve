export type ContextCategory =
  | 'architecture'
  | 'service'
  | 'dependency'
  | 'convention'
  | 'deployment'
  | 'integration'
  | 'general';

export interface ProjectContextEntry {
  id: string;
  project_name: string;
  category: ContextCategory;
  title: string;
  content: string;
  related_services?: string[];
  tags?: string[];
  updated_at: string;
}

export interface ContextSearchResult {
  entry: ProjectContextEntry;
  similarity: number;
}
