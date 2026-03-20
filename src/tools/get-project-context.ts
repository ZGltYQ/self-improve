import { ContextStore } from '../storage/context-store.js';
import { IVectorStore } from '../types/vector-store.js';
import { ContextSearchResult } from '../types/project-context.js';
import { GetProjectContextInput } from '../types/mcp-types.js';

export async function getProjectContext(
  contextStore: ContextStore,
  vectorStore: IVectorStore | null,
  input: GetProjectContextInput
): Promise<ContextSearchResult[]> {
  const limit = input.limit || 10;

  if (!input.project_name?.trim()) {
    throw new Error('project_name is required');
  }

  // If a semantic query is provided and vector store is available, use RAG
  if (input.query && vectorStore) {
    const results = await vectorStore.searchContextEntries(
      input.query,
      input.project_name,
      input.category,
      limit
    );

    // If vector search found nothing, fall back to keyword search
    if (results.length === 0) {
      const kwResults = await contextStore.keywordSearch(
        input.project_name,
        input.query,
        input.category,
        limit
      );
      return kwResults.map(entry => ({ entry, similarity: 0.5 }));
    }

    return results;
  }

  // If a query is provided but no vector store, use keyword search
  if (input.query) {
    const kwResults = await contextStore.keywordSearch(
      input.project_name,
      input.query,
      input.category,
      limit
    );
    return kwResults.map(entry => ({ entry, similarity: 0.5 }));
  }

  // No query - return all entries for the project (filtered by category)
  const entries = await contextStore.getByProject(
    input.project_name,
    input.category
  );

  return entries.slice(0, limit).map(entry => ({
    entry,
    similarity: 1.0,
  }));
}
