/**
 * Remote vector store backed by Qdrant.
 *
 * Implements the same public surface as the local VectorStore so the rest of
 * the codebase can switch between local / remote via a single env flag.
 *
 * Env vars consumed (via constructor options):
 *   QDRANT_URL          – e.g. http://localhost:6333
 *   QDRANT_API_KEY      – optional, for Qdrant Cloud
 *   QDRANT_COLLECTION   – defaults to "coding-knowledge"
 */

import { CodingRule, SearchResult, RuleFilter } from '../types/rule.js';
import {
  ProjectContextEntry,
  ContextSearchResult,
  ContextCategory,
} from '../types/project-context.js';
import { EmbeddingService } from './embedding-service.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface QdrantConfig {
  url: string;
  apiKey?: string;
  collection?: string;
}

interface QdrantSearchHit {
  id: string;
  score: number;
  payload: Record<string, unknown>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function ruleToText(rule: CodingRule): string {
  return [
    rule.title,
    rule.description,
    rule.context.what_was_wrong,
    rule.context.what_is_right,
    rule.context.why,
    ...rule.metadata.tags,
    ...rule.metadata.tech_stack,
  ]
    .filter(Boolean)
    .join('. ');
}

function contextEntryToText(entry: ProjectContextEntry): string {
  return [
    entry.title,
    entry.content,
    entry.category,
    ...(entry.related_services || []),
    ...(entry.tags || []),
  ]
    .filter(Boolean)
    .join('. ');
}

// ── Store ────────────────────────────────────────────────────────────────

export class RemoteVectorStore {
  private baseUrl: string;
  private apiKey: string | undefined;
  private collection: string;
  private embeddingService: EmbeddingService;

  constructor(embeddingService: EmbeddingService, config: QdrantConfig) {
    this.embeddingService = embeddingService;
    this.baseUrl = config.url.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.collection = config.collection || 'coding-knowledge';
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['api-key'] = this.apiKey;
    return h;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Qdrant ${method} ${path} → ${res.status}: ${text}`);
    }
    return res.json();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Create the collection if it doesn't exist yet.
    try {
      await this.request('GET', `/collections/${this.collection}`);
    } catch {
      await this.request('PUT', `/collections/${this.collection}`, {
        vectors: {
          size: this.embeddingService.getEmbeddingDimension(),
          distance: 'Cosine',
        },
      });

      // Create payload indexes for common filter fields
      const indexFields = [
        { field_name: 'type', field_schema: 'keyword' },
        { field_name: 'scope', field_schema: 'keyword' },
        { field_name: 'project_name', field_schema: 'keyword' },
      ];
      for (const idx of indexFields) {
        try {
          await this.request(
            'PUT',
            `/collections/${this.collection}/index`,
            idx,
          );
        } catch {
          // non-fatal – index may already exist
        }
      }
    }
  }

  // ── Rules ────────────────────────────────────────────────────────────

  async addRule(rule: CodingRule): Promise<void> {
    const embedding = await this.embeddingService.embed(ruleToText(rule));
    await this.request(
      'PUT',
      `/collections/${this.collection}/points`,
      {
        points: [
          {
            id: rule.id,
            vector: embedding,
            payload: {
              type: 'rule',
              rule: JSON.stringify(rule),
              scope: rule.metadata.scope,
              project_name: rule.metadata.project_name || '',
              tech_stack: rule.metadata.tech_stack,
              tags: rule.metadata.tags,
            },
          },
        ],
      },
    );
  }

  async addRulesBatch(rules: CodingRule[]): Promise<void> {
    if (rules.length === 0) return;
    const texts = rules.map(ruleToText);
    const embeddings = await this.embeddingService.embedBatch(texts);

    const points = rules.map((rule, i) => ({
      id: rule.id,
      vector: embeddings[i],
      payload: {
        type: 'rule',
        rule: JSON.stringify(rule),
        scope: rule.metadata.scope,
        project_name: rule.metadata.project_name || '',
        tech_stack: rule.metadata.tech_stack,
        tags: rule.metadata.tags,
      },
    }));

    // Qdrant supports batch upsert natively
    await this.request('PUT', `/collections/${this.collection}/points`, {
      points,
    });
  }

  async search(
    queryText: string,
    filters?: RuleFilter,
    limit: number = 5,
  ): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddingService.embed(queryText);

    // Build Qdrant filter
    const must: unknown[] = [
      { key: 'type', match: { value: 'rule' } },
    ];

    if (filters?.scope) {
      must.push({ key: 'scope', match: { value: filters.scope } });
    }
    if (filters?.project_name) {
      must.push({
        key: 'project_name',
        match: { value: filters.project_name },
      });
    }
    if (filters?.tech_stack?.length) {
      for (const ts of filters.tech_stack) {
        must.push({ key: 'tech_stack', match: { value: ts } });
      }
    }
    if (filters?.tags?.length) {
      for (const tag of filters.tags) {
        must.push({ key: 'tags', match: { value: tag } });
      }
    }

    const response = (await this.request(
      'POST',
      `/collections/${this.collection}/points/search`,
      {
        vector: queryEmbedding,
        filter: { must },
        limit,
        with_payload: true,
      },
    )) as { result: QdrantSearchHit[] };

    return response.result
      .map((hit) => {
        try {
          const rule = JSON.parse(hit.payload.rule as string) as CodingRule;
          return { rule, similarity: hit.score } as SearchResult;
        } catch {
          return null;
        }
      })
      .filter((r): r is SearchResult => r !== null);
  }

  async deleteRule(id: string): Promise<boolean> {
    try {
      await this.request(
        'POST',
        `/collections/${this.collection}/points/delete`,
        { points: [id] },
      );
      return true;
    } catch {
      return false;
    }
  }

  async findSimilar(
    rule: CodingRule,
    threshold: number = 0.85,
  ): Promise<CodingRule[]> {
    const results = await this.search(
      ruleToText(rule),
      { scope: rule.metadata.scope },
      10,
    );
    return results
      .filter((r) => r.similarity >= threshold && r.rule.id !== rule.id)
      .map((r) => r.rule);
  }

  // ── Context Entries ──────────────────────────────────────────────────

  async addContextEntry(entry: ProjectContextEntry): Promise<void> {
    const embedding = await this.embeddingService.embed(
      contextEntryToText(entry),
    );
    await this.request(
      'PUT',
      `/collections/${this.collection}/points`,
      {
        points: [
          {
            id: `ctx_${entry.id}`,
            vector: embedding,
            payload: {
              type: 'context',
              entry: JSON.stringify(entry),
              project_name: entry.project_name,
              category: entry.category,
            },
          },
        ],
      },
    );
  }

  async searchContextEntries(
    queryText: string,
    projectName: string,
    category?: ContextCategory,
    limit: number = 5,
  ): Promise<ContextSearchResult[]> {
    const queryEmbedding = await this.embeddingService.embed(queryText);

    const must: unknown[] = [
      { key: 'type', match: { value: 'context' } },
      { key: 'project_name', match: { value: projectName } },
    ];
    if (category) {
      must.push({ key: 'category', match: { value: category } });
    }

    const response = (await this.request(
      'POST',
      `/collections/${this.collection}/points/search`,
      {
        vector: queryEmbedding,
        filter: { must },
        limit,
        with_payload: true,
      },
    )) as { result: QdrantSearchHit[] };

    return response.result
      .map((hit) => {
        try {
          const entry = JSON.parse(
            hit.payload.entry as string,
          ) as ProjectContextEntry;
          return { entry, similarity: hit.score } as ContextSearchResult;
        } catch {
          return null;
        }
      })
      .filter((r): r is ContextSearchResult => r !== null);
  }

  async deleteContextEntry(id: string): Promise<boolean> {
    try {
      await this.request(
        'POST',
        `/collections/${this.collection}/points/delete`,
        { points: [`ctx_${id}`] },
      );
      return true;
    } catch {
      return false;
    }
  }
}
