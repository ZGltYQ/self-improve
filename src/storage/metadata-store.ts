import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { CodingRule, RuleFilter, SearchResult } from '../types/rule.js';

export class MetadataStore {
  private rulesDir: string;

  constructor(dataDir: string) {
    this.rulesDir = path.join(dataDir, 'rules');
  }

  private getRulePath(id: string): string {
    return path.join(this.rulesDir, `${id}.json`);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.rulesDir, { recursive: true });
    await fs.mkdir(path.join(this.rulesDir, 'global'), { recursive: true });
    await fs.mkdir(path.join(this.rulesDir, 'projects'), { recursive: true });
  }

  async saveRule(rule: CodingRule): Promise<void> {
    const filePath = this.getRulePath(rule.id);
    await fs.writeFile(filePath, JSON.stringify(rule, null, 2), 'utf-8');
  }

  async getRule(id: string): Promise<CodingRule | null> {
    try {
      const filePath = this.getRulePath(id);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as CodingRule;
    } catch {
      return null;
    }
  }

  async getAllRules(filter?: RuleFilter): Promise<CodingRule[]> {
    const entries = await fs.readdir(this.rulesDir, { withFileTypes: true });
    const rules: CodingRule[] = [];

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.json')) {
        try {
          const content = await fs.readFile(path.join(this.rulesDir, entry.name), 'utf-8');
          const rule = JSON.parse(content) as CodingRule;
          
          if (this.matchesFilter(rule, filter)) {
            rules.push(rule);
          }
        } catch {
          // Skip invalid files
        }
      }
    }

    return rules;
  }

  private matchesFilter(rule: CodingRule, filter?: RuleFilter): boolean {
    if (!filter) return true;
    
    if (filter.scope && rule.metadata.scope !== filter.scope) return false;
    if (filter.project_name && rule.metadata.project_name !== filter.project_name) return false;
    if (filter.tech_stack?.length) {
      const hasMatch = filter.tech_stack.some(ts => rule.metadata.tech_stack.includes(ts));
      if (!hasMatch) return false;
    }
    if (filter.tags?.length) {
      const hasMatch = filter.tags.some(tag => rule.metadata.tags.includes(tag));
      if (!hasMatch) return false;
    }
    if (filter.file_paths?.length) {
      const hasMatch = filter.file_paths.some(fp => 
        rule.metadata.file_paths.some(rfp => rfp.includes(fp))
      );
      if (!hasMatch) return false;
    }
    
    return true;
  }

  async deleteRule(id: string): Promise<boolean> {
    try {
      const filePath = this.getRulePath(id);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async updateRule(id: string, updates: Partial<CodingRule>): Promise<CodingRule | null> {
    const rule = await this.getRule(id);
    if (!rule) return null;
    
    const updated = { ...rule, ...updates };
    await this.saveRule(updated);
    return updated;
  }

  generateId(): string {
    return uuidv4();
  }
}
