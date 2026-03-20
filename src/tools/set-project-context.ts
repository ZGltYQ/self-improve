import { ContextStore } from '../storage/context-store.js';
import { IVectorStore } from '../types/vector-store.js';
import { ProjectContextEntry } from '../types/project-context.js';
import { SetProjectContextInput } from '../types/mcp-types.js';

const VALID_CATEGORIES = [
  'architecture', 'service', 'dependency',
  'convention', 'deployment', 'integration', 'general',
] as const;

function sanitizeInput(str: string): string {
  return str
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .trim()
    .slice(0, 10000);
}

function validateInput(input: SetProjectContextInput): void {
  if (!input.project_name?.trim()) {
    throw new Error('project_name is required');
  }
  if (!input.title?.trim()) {
    throw new Error('title is required');
  }
  if (!input.content?.trim()) {
    throw new Error('content is required');
  }
  if (!input.category?.trim()) {
    throw new Error('category is required');
  }
  if (!VALID_CATEGORIES.includes(input.category as any)) {
    throw new Error(
      `Invalid category "${input.category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`
    );
  }
  if (input.title.length > 200) {
    throw new Error('title must be 200 characters or less');
  }
}

export async function setProjectContext(
  contextStore: ContextStore,
  vectorStore: IVectorStore | null,
  input: SetProjectContextInput
): Promise<ProjectContextEntry> {
  validateInput(input);

  const entry = await contextStore.upsertEntry(
    sanitizeInput(input.project_name),
    sanitizeInput(input.title),
    {
      category: input.category,
      content: sanitizeInput(input.content),
      related_services: (input.related_services || []).map(sanitizeInput).slice(0, 30),
      tags: (input.tags || []).map(sanitizeInput).slice(0, 20),
    }
  );

  // Add/update embedding in vector store for RAG search
  if (vectorStore) {
    // Delete old embedding if it existed, then add fresh
    await vectorStore.deleteContextEntry(entry.id);
    await vectorStore.addContextEntry(entry);
  }

  return entry;
}
