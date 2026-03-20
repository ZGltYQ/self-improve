import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ProjectContextEntry, ContextCategory } from '../types/project-context.js';

function deduplicateArray(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}

export class ContextStore {
  private contextsDir: string;

  constructor(dataDir: string) {
    this.contextsDir = path.join(dataDir, 'contexts');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.contextsDir, { recursive: true });
  }

  private getEntryPath(id: string): string {
    return path.join(this.contextsDir, `${id}.json`);
  }

  generateId(): string {
    return uuidv4();
  }

  async saveEntry(entry: ProjectContextEntry): Promise<void> {
    const filePath = this.getEntryPath(entry.id);
    await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  }

  async getEntry(id: string): Promise<ProjectContextEntry | null> {
    try {
      const filePath = this.getEntryPath(id);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as ProjectContextEntry;
    } catch {
      return null;
    }
  }

  async findByProjectAndTitle(
    projectName: string,
    title: string
  ): Promise<ProjectContextEntry | null> {
    const entries = await this.getByProject(projectName);
    const titleLower = title.toLowerCase().trim();
    return entries.find(e => e.title.toLowerCase().trim() === titleLower) || null;
  }

  async getByProject(
    projectName: string,
    category?: ContextCategory
  ): Promise<ProjectContextEntry[]> {
    const allEntries = await this.getAllEntries();
    return allEntries.filter(entry => {
      if (entry.project_name !== projectName) return false;
      if (category && entry.category !== category) return false;
      return true;
    });
  }

  async getAllEntries(): Promise<ProjectContextEntry[]> {
    try {
      const files = await fs.readdir(this.contextsDir);
      const entries: ProjectContextEntry[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await fs.readFile(
            path.join(this.contextsDir, file),
            'utf-8'
          );
          entries.push(JSON.parse(content) as ProjectContextEntry);
        } catch {
          // Skip invalid files
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  async deleteEntry(id: string): Promise<boolean> {
    try {
      await fs.unlink(this.getEntryPath(id));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Upsert a context entry. If an entry with the same project_name + title
   * already exists, merge it (arrays append+dedup, strings replace).
   * Otherwise create a new entry.
   */
  async upsertEntry(
    projectName: string,
    title: string,
    updates: Partial<ProjectContextEntry>
  ): Promise<ProjectContextEntry> {
    const existing = await this.findByProjectAndTitle(projectName, title);

    if (existing) {
      const merged: ProjectContextEntry = {
        ...existing,
        category: updates.category || existing.category,
        content: updates.content || existing.content,
        related_services: deduplicateArray([
          ...(existing.related_services || []),
          ...(updates.related_services || []),
        ]),
        tags: deduplicateArray([
          ...(existing.tags || []),
          ...(updates.tags || []),
        ]),
        // Preserve identity fields
        id: existing.id,
        project_name: projectName,
        title: title,
        updated_at: new Date().toISOString(),
      };
      await this.saveEntry(merged);
      return merged;
    }

    // Create new entry
    const entry: ProjectContextEntry = {
      id: this.generateId(),
      project_name: projectName,
      category: updates.category || 'general',
      title: title,
      content: updates.content || '',
      related_services: updates.related_services || [],
      tags: updates.tags || [],
      updated_at: new Date().toISOString(),
    };
    await this.saveEntry(entry);
    return entry;
  }

  /**
   * Keyword-based search within a project's context entries.
   * Used as fallback when vector store is not available.
   */
  async keywordSearch(
    projectName: string,
    query: string,
    category?: ContextCategory,
    limit: number = 5
  ): Promise<ProjectContextEntry[]> {
    const entries = await this.getByProject(projectName, category);
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

    const scored = entries.map(entry => {
      const searchText = [
        entry.title,
        entry.content,
        entry.category,
        ...(entry.related_services || []),
        ...(entry.tags || []),
      ].join(' ').toLowerCase();

      let score = 0;

      // Full query match
      if (searchText.includes(queryLower)) score += 10;

      // Individual term matches
      for (const term of queryTerms) {
        if (entry.title.toLowerCase().includes(term)) score += 5;
        if (entry.content.toLowerCase().includes(term)) score += 2;
        if (entry.related_services?.some(s => s.toLowerCase().includes(term))) score += 3;
        if (entry.tags?.some(t => t.toLowerCase().includes(term))) score += 2;
      }

      return { entry, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.entry);
  }
}
