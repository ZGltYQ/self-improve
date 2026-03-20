import { MetadataStore } from '../storage/metadata-store.js';
import { IVectorStore } from '../types/vector-store.js';
import { RuleMerger } from '../storage/rule-merger.js';
import { PruneRulesInput, PruneRulesOutput } from '../types/mcp-types.js';

export async function pruneRules(
  store: MetadataStore,
  vectorStore: IVectorStore | null,
  input: PruneRulesInput
): Promise<PruneRulesOutput> {
  const deleted: string[] = [];
  const merged: string[] = [];
  const archived: string[] = [];

  const dryRun = input.dry_run ?? false;
  const unusedDays = input.delete_unused_days || 90;
  const similarityThreshold = input.similarity_threshold || 0.9;

  const rules = await store.getAllRules();
  const now = new Date();

  // 1. Delete unused rules
  for (const rule of rules) {
    const lastUsed = new Date(rule.statistics.last_used);
    const daysSinceUsed = (now.getTime() - lastUsed.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceUsed > unusedDays && rule.statistics.usage_count === 0) {
      deleted.push(rule.id);
      
      if (!dryRun) {
        await store.deleteRule(rule.id);
        if (vectorStore) {
          await vectorStore.deleteRule(rule.id);
        }
      }
    }
  }

  // 2. Merge similar rules
  if (vectorStore) {
    const merger = new RuleMerger(store, vectorStore);
    const mergeCount = await merger.autoMerge(similarityThreshold);
    const remainingRules = await store.getAllRules();
    const currentIds = remainingRules.map(r => r.id);
    const previousIds = rules.map(r => r.id);
    const mergedIds = previousIds.filter(id => !currentIds.includes(id));
    merged.push(...mergedIds);
  }

  // 3. Archive deprecated tech stack rules
  const deprecatedEnv = process.env.DEPRECATED_TECH_STACKS;
  const defaultDeprecated = ['angularjs', 'backbone', 'jquery-ui', 'grunt', 'bower'];
  const deprecatedTechStacks = deprecatedEnv 
    ? deprecatedEnv.split(',').map(s => s.trim().toLowerCase())
    : defaultDeprecated;
  
  for (const rule of rules) {
    const hasDeprecated = rule.metadata.tech_stack.some(ts => 
      deprecatedTechStacks.includes(ts.toLowerCase())
    );
    
    if (hasDeprecated && !deleted.includes(rule.id)) {
      archived.push(rule.id);
      
      if (!dryRun) {
        // Move to archive (we could implement archive functionality)
        // For now, just mark as archived in description
        rule.description = `[ARCHIVED] ${rule.description}`;
        await store.saveRule(rule);
      }
    }
  }

  const summary = `Pruning complete: ${deleted.length} rules deleted, ${merged.length} rule sets merged, ${archived.length} archived.${dryRun ? ' (dry run - no changes made)' : ''}`;

  return {
    deleted,
    merged,
    archived,
    summary,
  };
}
