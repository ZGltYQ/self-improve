import { MetadataStore } from '../storage/metadata-store.js';
import { IVectorStore } from '../types/vector-store.js';
import { ContextStore } from '../storage/context-store.js';
import { CodingRule, SearchResult, RuleFilter } from '../types/rule.js';
import { ContextSearchResult } from '../types/project-context.js';
import { QueryRulesInput, QueryRulesOutput } from '../types/mcp-types.js';

/** Maximum characters for context entries in the response to prevent overflow */
const MAX_CONTEXT_CHARS = 2000;
/** Maximum characters for rules in the response */
const MAX_RULES_CHARS = 3000;
/** Max context entries to return alongside rules */
const MAX_CONTEXT_ENTRIES = 3;

export async function queryRules(
  store: MetadataStore,
  vectorStore: IVectorStore | null,
  contextStore: ContextStore,
  input: QueryRulesInput
): Promise<QueryRulesOutput> {
  const limit = input.limit || 5;
  const useVectorSearch = vectorStore !== null;

  // Build search query from context
  const queryParts = [input.query];
  
  if (input.current_file) {
    queryParts.push(input.current_file);
  }
  if (input.tech_stack?.length) {
    queryParts.push(...input.tech_stack);
  }
  
  const queryText = queryParts.join('. ');

  let ruleResults: SearchResult[];

  if (useVectorSearch) {
    // Use vector similarity search — don't filter by scope so both global
    // and project-specific rules are returned
    const filters: RuleFilter = {
      project_name: input.project_name,
      tech_stack: input.tech_stack,
    };

    ruleResults = await vectorStore.search(queryText, filters, limit);
  } else {
    // Fallback to keyword matching
    ruleResults = await keywordSearch(store, input, limit);
  }

  // Update usage statistics
  for (const result of ruleResults) {
    const rule = result.rule;
    rule.statistics.usage_count += 1;
    rule.statistics.last_used = new Date().toISOString();
    await store.updateRule(rule.id, {
      statistics: rule.statistics,
    });
  }

  // Search for relevant project context entries when project_name is provided
  let contextResults: ContextSearchResult[] = [];

  if (input.project_name) {
    if (vectorStore) {
      contextResults = await vectorStore.searchContextEntries(
        queryText,
        input.project_name,
        undefined, // no category filter for general find_rules
        MAX_CONTEXT_ENTRIES
      );
    } else {
      // Fallback: keyword search within project context
      const kwEntries = await contextStore.keywordSearch(
        input.project_name,
        input.query,
        undefined,
        MAX_CONTEXT_ENTRIES
      );
      contextResults = kwEntries.map(entry => ({ entry, similarity: 0.5 }));
    }

    // If keyword/vector search found nothing but project has context,
    // return the most recent entries as general project info
    if (contextResults.length === 0) {
      const allEntries = await contextStore.getByProject(input.project_name);
      if (allEntries.length > 0) {
        contextResults = allEntries
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          .slice(0, MAX_CONTEXT_ENTRIES)
          .map(entry => ({ entry, similarity: 0.3 }));
      }
    }
  }

  // Apply token budget to context entries to prevent overflow
  const trimmedContext = applyTokenBudget(contextResults, MAX_CONTEXT_CHARS);

  // Apply token budget to rules
  const trimmedRules = applyRulesBudget(ruleResults, MAX_RULES_CHARS);

  return {
    context: trimmedContext,
    rules: trimmedRules,
  };
}

/**
 * Trim context entries to fit within the character budget.
 * Prioritizes entries with higher similarity scores.
 */
function applyTokenBudget(
  results: ContextSearchResult[],
  maxChars: number
): ContextSearchResult[] {
  let charCount = 0;
  const trimmed: ContextSearchResult[] = [];

  for (const result of results) {
    const entryChars = result.entry.title.length + result.entry.content.length;
    if (charCount + entryChars > maxChars && trimmed.length > 0) break;
    charCount += entryChars;
    trimmed.push(result);
  }

  return trimmed;
}

/**
 * Trim rule results to fit within the character budget.
 */
function applyRulesBudget(
  results: SearchResult[],
  maxChars: number
): SearchResult[] {
  let charCount = 0;
  const trimmed: SearchResult[] = [];

  for (const result of results) {
    const ruleChars =
      result.rule.title.length +
      result.rule.description.length +
      result.rule.context.what_is_right.length +
      (result.rule.context.what_was_wrong?.length || 0);
    if (charCount + ruleChars > maxChars && trimmed.length > 0) break;
    charCount += ruleChars;
    trimmed.push(result);
  }

  return trimmed;
}

async function keywordSearch(
  store: MetadataStore,
  input: QueryRulesInput,
  limit: number
): Promise<SearchResult[]> {
  const rules = await store.getAllRules();

  const queryLower = input.query.toLowerCase();
  
  const scored = rules.map(rule => {
    let score = 0;
    
    // Title match
    if (rule.title.toLowerCase().includes(queryLower)) score += 10;
    
    // Description match
    if (rule.description.toLowerCase().includes(queryLower)) score += 5;
    
    // Context match
    if (rule.context.what_was_wrong.toLowerCase().includes(queryLower)) score += 5;
    if (rule.context.what_is_right.toLowerCase().includes(queryLower)) score += 5;
    
    // Tag match
    if (rule.metadata.tags.some((t: string) => t.toLowerCase().includes(queryLower))) score += 3;
    
    // Tech stack match
    if (input.tech_stack?.length) {
      const techMatch = input.tech_stack.filter(ts => 
        rule.metadata.tech_stack.includes(ts)
      ).length;
      score += techMatch * 2;
    }
    
    // File path match
    if (input.current_file) {
      const fileMatch = rule.metadata.file_paths.some((fp: string) => 
        input.current_file!.includes(fp) || fp.includes(input.current_file!)
      );
      if (fileMatch) score += 8;
    }
    
    // Project match
    if (input.project_name && rule.metadata.project_name === input.project_name) {
      score += 5;
    }
    
    // Boost by usage count
    score += Math.log10(rule.statistics.usage_count + 1) * 2;

    return { rule, score };
  });

  const filtered = scored
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return filtered.map(r => ({
    rule: r.rule,
    similarity: Math.min(r.score / 30, 1),
  }));
}
