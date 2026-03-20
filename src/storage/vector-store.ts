import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CodingRule, SearchResult, RuleFilter } from '../types/rule.js';
import { ProjectContextEntry, ContextSearchResult, ContextCategory } from '../types/project-context.js';
import { EmbeddingService } from './embedding-service.js';

const DEFAULT_VECTOR_DB_PATH = path.join(
  process.env.DATA_DIR || path.join(os.homedir(), '.self-improve'),
  'vector-db'
);

interface VectorRule {
  id: string;
  rule: string;
  embedding: number[];
}

interface VectorContext {
  id: string;
  type: 'context';
  entry: string;
  embedding: number[];
}

export class VectorStore {
  private embeddingService: EmbeddingService;
  private dbPath: string;

  constructor(embeddingService?: EmbeddingService, dbPath?: string) {
    this.embeddingService = embeddingService || new EmbeddingService();
    this.dbPath = dbPath || DEFAULT_VECTOR_DB_PATH;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dbPath, { recursive: true });
  }

  async addRule(rule: CodingRule): Promise<void> {
    const textForEmbedding = this.ruleToText(rule);
    const embedding = await this.embeddingService.embed(textForEmbedding);

    const vectorRule: VectorRule = {
      id: rule.id,
      rule: JSON.stringify(rule),
      embedding,
    };

    await this.storeVectorRule(vectorRule);
  }

  async addRulesBatch(rules: CodingRule[]): Promise<void> {
    const texts = rules.map(r => this.ruleToText(r));
    const embeddings = await this.embeddingService.embedBatch(texts);

    const vectorRules: VectorRule[] = rules.map((rule, i) => ({
      id: rule.id,
      rule: JSON.stringify(rule),
      embedding: embeddings[i],
    }));

    for (const vr of vectorRules) {
      await this.storeVectorRule(vr);
    }
  }

  private ruleToText(rule: CodingRule): string {
    const parts = [
      rule.title,
      rule.description,
      rule.context.what_was_wrong,
      rule.context.what_is_right,
      rule.context.why,
      ...rule.metadata.tags,
      ...rule.metadata.tech_stack,
    ];
    return parts.filter(Boolean).join('. ');
  }

  private async storeVectorRule(vectorRule: VectorRule): Promise<void> {
    const filePath = path.join(this.dbPath, `${vectorRule.id}.vector.json`);
    await fs.writeFile(filePath, JSON.stringify(vectorRule), 'utf-8');
  }

  private async getVectorRule(id: string): Promise<VectorRule | null> {
    try {
      const filePath = path.join(this.dbPath, `${id}.vector.json`);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as VectorRule;
    } catch {
      return null;
    }
  }

  private async getAllVectorRules(): Promise<VectorRule[]> {
    try {
      const files = await fs.readdir(this.dbPath);
      const rules: VectorRule[] = [];
      
      for (const file of files) {
        if (file.endsWith('.vector.json')) {
          const content = await fs.readFile(path.join(this.dbPath, file), 'utf-8');
          rules.push(JSON.parse(content));
        }
      }
      
      return rules;
    } catch {
      return [];
    }
  }

  async search(
    queryText: string,
    filters?: RuleFilter,
    limit: number = 5
  ): Promise<SearchResult[]> {
    const queryEmbedding = await this.embeddingService.embed(queryText);

    const allVectors = await this.getAllVectorRules();

    const scored = allVectors.map(vr => {
      const similarity = this.cosineSimilarity(queryEmbedding, vr.embedding);
      return { vr, similarity };
    });

    const results: SearchResult[] = [];
    
    for (const { vr, similarity } of scored) {
      try {
        const rule = JSON.parse(vr.rule) as CodingRule;
        
        if (filters) {
          if (filters.scope && rule.metadata.scope !== filters.scope) continue;
          if (filters.project_name && rule.metadata.project_name !== filters.project_name) continue;
          if (filters.tech_stack?.length) {
            const hasMatch = filters.tech_stack.some(ts => 
              rule.metadata.tech_stack.includes(ts)
            );
            if (!hasMatch) continue;
          }
          if (filters.tags?.length) {
            const hasMatch = filters.tags.some(tag => 
              rule.metadata.tags.includes(tag)
            );
            if (!hasMatch) continue;
          }
          if (filters.file_paths?.length) {
            const hasMatch = filters.file_paths.some(fp => 
              rule.metadata.file_paths.some(rfp => 
                rfp.includes(fp) || fp.includes(rfp)
              )
            );
            if (!hasMatch) continue;
          }
        }

        results.push({ rule, similarity });
      } catch {
        // Skip invalid entries
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async deleteRule(id: string): Promise<boolean> {
    try {
      const filePath = path.join(this.dbPath, `${id}.vector.json`);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async findSimilar(
    rule: CodingRule,
    threshold: number = 0.85
  ): Promise<CodingRule[]> {
    const results = await this.search(
      this.ruleToText(rule),
      { scope: rule.metadata.scope },
      10
    );

    return results
      .filter(r => r.similarity >= threshold && r.rule.id !== rule.id)
      .map(r => r.rule);
  }

  // --- Context Entry Methods ---

  private contextEntryToText(entry: ProjectContextEntry): string {
    const parts = [
      entry.title,
      entry.content,
      entry.category,
      ...(entry.related_services || []),
      ...(entry.tags || []),
    ];
    return parts.filter(Boolean).join('. ');
  }

  async addContextEntry(entry: ProjectContextEntry): Promise<void> {
    const textForEmbedding = this.contextEntryToText(entry);
    const embedding = await this.embeddingService.embed(textForEmbedding);

    const vectorContext: VectorContext = {
      id: `ctx_${entry.id}`,
      type: 'context',
      entry: JSON.stringify(entry),
      embedding,
    };

    const filePath = path.join(this.dbPath, `${vectorContext.id}.vector.json`);
    await fs.writeFile(filePath, JSON.stringify(vectorContext), 'utf-8');
  }

  async searchContextEntries(
    queryText: string,
    projectName: string,
    category?: ContextCategory,
    limit: number = 5
  ): Promise<ContextSearchResult[]> {
    const queryEmbedding = await this.embeddingService.embed(queryText);

    let files: string[];
    try {
      files = await fs.readdir(this.dbPath);
    } catch {
      return [];
    }

    const results: ContextSearchResult[] = [];

    for (const file of files) {
      if (!file.startsWith('ctx_') || !file.endsWith('.vector.json')) continue;

      try {
        const content = await fs.readFile(path.join(this.dbPath, file), 'utf-8');
        const vc = JSON.parse(content) as VectorContext;
        const entry = JSON.parse(vc.entry) as ProjectContextEntry;

        if (entry.project_name !== projectName) continue;
        if (category && entry.category !== category) continue;

        const similarity = this.cosineSimilarity(queryEmbedding, vc.embedding);
        results.push({ entry, similarity });
      } catch {
        // Skip invalid files
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  async deleteContextEntry(id: string): Promise<boolean> {
    try {
      const filePath = path.join(this.dbPath, `ctx_${id}.vector.json`);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
