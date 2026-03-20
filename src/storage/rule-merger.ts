import { MetadataStore } from '../storage/metadata-store.js';
import { IVectorStore } from '../types/vector-store.js';
import { CodingRule } from '../types/rule.js';

export class RuleMerger {
  private store: MetadataStore;
  private vectorStore: IVectorStore | null;

  constructor(store: MetadataStore, vectorStore?: IVectorStore | null) {
    this.store = store;
    this.vectorStore = vectorStore || null;
  }

  async findSimilar(rule: CodingRule, threshold: number = 0.85): Promise<CodingRule[]> {
    if (!this.vectorStore) {
      return [];
    }

    return this.vectorStore.findSimilar(rule, threshold);
  }

  async merge(rules: CodingRule[]): Promise<CodingRule | null> {
    if (rules.length < 2) return rules[0] || null;

    // Keep the most recently used rule
    const primary = rules.reduce((a, b) => 
      new Date(a.statistics.last_used) > new Date(b.statistics.last_used) ? a : b
    );

    // Merge statistics
    const totalUsage = rules.reduce((sum, r) => sum + r.statistics.usage_count, 0);
    const totalViolations = rules.reduce((sum, r) => sum + r.statistics.violation_count, 0);

    // Merge examples (keep all unique examples)
    const examples = new Map<string, CodingRule['examples'][0]>();
    for (const rule of rules) {
      for (const ex of rule.examples) {
        const key = `${ex.bad || ''}-${ex.good}`;
        examples.set(key, ex);
      }
    }

    // Merge file paths
    const filePaths = new Set<string>();
    for (const rule of rules) {
      rule.metadata.file_paths.forEach(fp => filePaths.add(fp));
    }

    // Merge tags
    const tags = new Set<string>();
    for (const rule of rules) {
      rule.metadata.tags.forEach(tag => tags.add(tag));
    }

    // Update primary rule
    const merged: CodingRule = {
      ...primary,
      statistics: {
        ...primary.statistics,
        usage_count: totalUsage,
        violation_count: totalViolations,
      },
      metadata: {
        ...primary.metadata,
        file_paths: Array.from(filePaths),
        tags: Array.from(tags),
      },
      examples: Array.from(examples.values()),
    };

    // Save merged rule
    await this.store.saveRule(merged);

    // Delete other rules
    for (const rule of rules) {
      if (rule.id !== primary.id) {
        await this.store.deleteRule(rule.id);
        if (this.vectorStore) {
          await this.vectorStore.deleteRule(rule.id);
        }
      }
    }

    return merged;
  }

  async autoMerge(threshold: number = 0.9): Promise<number> {
    const rules = await this.store.getAllRules();
    const merged = new Set<string>();
    let mergeCount = 0;

    for (let i = 0; i < rules.length; i++) {
      if (merged.has(rules[i].id)) continue;

      const similar: CodingRule[] = [rules[i]];

      for (let j = i + 1; j < rules.length; j++) {
        if (merged.has(rules[j].id)) continue;

        // Check if rules are similar enough to merge
        if (this.rulesSimilarEnough(rules[i], rules[j], threshold)) {
          similar.push(rules[j]);
          merged.add(rules[j].id);
        }
      }

      if (similar.length > 1) {
        await this.merge(similar);
        mergeCount++;
      }
    }

    return mergeCount;
  }

  private rulesSimilarEnough(a: CodingRule, b: CodingRule, threshold: number): boolean {
    // Check title similarity
    const titleSimilar = this.stringSimilarity(a.title, b.title);
    if (titleSimilar < threshold) return false;

    // Check tech stack overlap
    const techOverlap = a.metadata.tech_stack.filter(t => 
      b.metadata.tech_stack.includes(t)
    ).length;
    if (techOverlap === 0) return false;

    // Check scope match
    if (a.metadata.scope !== b.metadata.scope) return false;
    if (a.metadata.scope === 'project' && a.metadata.project_name !== b.metadata.project_name) {
      return false;
    }

    return true;
  }

  private stringSimilarity(a: string, b: string): number {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    
    if (aLower === bLower) return 1;
    if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.8;
    
    // Simple Jaccard similarity on words
    const aWords = new Set(aLower.split(/\s+/));
    const bWords = new Set(bLower.split(/\s+/));
    
    const intersection = new Set([...aWords].filter(x => bWords.has(x)));
    const union = new Set([...aWords, ...bWords]);
    
    return intersection.size / union.size;
  }
}
