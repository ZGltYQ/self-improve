/**
 * Shared interface for vector stores (local file-based and remote Qdrant).
 *
 * All tools and the server reference this interface instead of a concrete
 * implementation so the backend can be swapped via env config.
 */

import { CodingRule, SearchResult, RuleFilter } from './rule.js';
import {
  ProjectContextEntry,
  ContextSearchResult,
  ContextCategory,
} from './project-context.js';

export interface IVectorStore {
  initialize(): Promise<void>;

  // ── Rules ──────────────────────────────────────────────────────────
  addRule(rule: CodingRule): Promise<void>;
  addRulesBatch(rules: CodingRule[]): Promise<void>;
  search(
    queryText: string,
    filters?: RuleFilter,
    limit?: number,
  ): Promise<SearchResult[]>;
  deleteRule(id: string): Promise<boolean>;
  findSimilar(rule: CodingRule, threshold?: number): Promise<CodingRule[]>;

  // ── Context Entries ────────────────────────────────────────────────
  addContextEntry(entry: ProjectContextEntry): Promise<void>;
  searchContextEntries(
    queryText: string,
    projectName: string,
    category?: ContextCategory,
    limit?: number,
  ): Promise<ContextSearchResult[]>;
  deleteContextEntry(id: string): Promise<boolean>;
}
