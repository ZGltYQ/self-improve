import { MetadataStore } from '../storage/metadata-store.js';
import { CodingRule } from '../types/rule.js';
import { StoreCorrectionInput } from '../types/mcp-types.js';

function sanitizeInput(str: string): string {
  return str
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
    .slice(0, 10000);
}

function validateInput(input: StoreCorrectionInput): void {
  const required = ['title', 'description', 'what_is_right', 'why', 'scope'];
  for (const field of required) {
    const value = input[field as keyof StoreCorrectionInput];
    if (!value || typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  
  if (input.title.length > 200) {
    throw new Error('Title must be 200 characters or less');
  }
  
  if (input.scope === 'project' && !input.project_name) {
    throw new Error('project_name is required when scope is "project"');
  }
}

export async function storeCorrection(
  store: MetadataStore,
  input: StoreCorrectionInput
): Promise<CodingRule> {
  validateInput(input);
  
  const now = new Date().toISOString();
  
  const rule: CodingRule = {
    id: store.generateId(),
    title: sanitizeInput(input.title),
    description: sanitizeInput(input.description),
    context: {
      what_was_wrong: input.what_was_wrong ? sanitizeInput(input.what_was_wrong) : '',
      what_is_right: sanitizeInput(input.what_is_right),
      why: sanitizeInput(input.why),
    },
    metadata: {
      file_paths: (input.file_paths || []).map(sanitizeInput).slice(0, 50),
      tech_stack: (input.tech_stack || []).map(sanitizeInput).slice(0, 20),
      tags: (input.tags || []).map(sanitizeInput).slice(0, 20),
      scope: input.scope,
      project_name: input.project_name ? sanitizeInput(input.project_name) : undefined,
    },
    examples: [],
    statistics: {
      created_at: now,
      last_used: now,
      usage_count: 0,
      violation_count: 0,
    },
  };

  if (input.bad_example || input.good_example) {
    rule.examples.push({
      bad: input.bad_example ? sanitizeInput(input.bad_example) : undefined,
      good: input.good_example ? sanitizeInput(input.good_example) : '',
    });
  }

  await store.saveRule(rule);

  return rule;
}
