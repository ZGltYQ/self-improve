import { MetadataStore } from './metadata-store.js';
import { IVectorStore } from '../types/vector-store.js';
import { CodingRule, QueryContext, SearchResult } from '../types/rule.js';

export class ContextBuilder {
  private store: MetadataStore;
  private vectorStore: IVectorStore | null;

  constructor(store: MetadataStore, vectorStore?: IVectorStore | null) {
    this.store = store;
    this.vectorStore = vectorStore || null;
  }

  async buildContext(query: QueryContext): Promise<string> {
    const limit = 5;
    
    let rules: SearchResult[];

    if (this.vectorStore) {
      const queryText = [
        query.current_code || '',
        query.current_file || '',
        query.tech_stack?.join(' ') || '',
        query.error_message || '',
      ].join('. ');

      rules = await this.vectorStore.search(queryText, {
        scope: query.project_name ? 'project' : undefined,
        project_name: query.project_name,
        tech_stack: query.tech_stack,
      }, limit);
    } else {
      // Fallback to metadata search
      const allRules = await this.store.getAllRules({
        project_name: query.project_name,
        tech_stack: query.tech_stack,
      });

      rules = allRules.slice(0, limit).map(r => ({
        rule: r,
        similarity: 0.5,
      }));
    }

    if (rules.length === 0) {
      return '';
    }

    return this.formatRulesForLLM(rules);
  }

  private formatRulesForLLM(results: SearchResult[]): string {
    const sections: string[] = [
      '## Project-Specific Rules (Learned from Past Corrections)',
      '',
    ];

    for (const { rule, similarity } of results) {
      const confidence = Math.round(similarity * 100);
      const scope = rule.metadata.scope === 'project' 
        ? `[${rule.metadata.project_name}]` 
        : '[global]';
      
      sections.push(`### ${scope} ${rule.title}`);
      sections.push(rule.description);
      sections.push('');

      if (rule.examples.length > 0) {
        if (rule.examples[0].bad) {
          sections.push(`❌ **Avoid:**`);
          sections.push('```');
          sections.push(rule.examples[0].bad);
          sections.push('```');
          sections.push('');
        }
        
        sections.push(`✅ **Use:**`);
        sections.push('```');
        sections.push(rule.examples[0].good);
        sections.push('```');
        sections.push('');
      }

      sections.push(`**Why:** ${rule.context.why}`);
      sections.push(`**Confidence:** ${confidence}%`);
      
      if (rule.metadata.tags.length > 0) {
        sections.push(`**Tags:** ${rule.metadata.tags.join(', ')}`);
      }
      
      sections.push('');
      sections.push('---');
      sections.push('');
    }

    return sections.join('\n');
  }

  async getRulesForFile(filePath: string, projectName?: string): Promise<string> {
    const query: QueryContext = {
      current_file: filePath,
      project_name: projectName,
    };

    return this.buildContext(query);
  }
}
