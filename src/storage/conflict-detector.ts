import { MetadataStore } from '../storage/metadata-store.js';
import { CodingRule } from '../types/rule.js';

interface Conflict {
  rule1: CodingRule;
  rule2: CodingRule;
  type: 'contradictory' | 'overlapping';
  description: string;
}

const CONTRADICTION_PATTERNS = [
  {
    positive: /\b(use|always|need|must|require)\b/i,
    negative: /\b(avoid|never|don't|don't use|not|don't have)\b/i,
  },
  {
    positive: /\basync\b/i,
    negative: /\bsync\b/i,
  },
  {
    positive: /\bjoin\b/i,
    negative: /\bseparate\b.*\bquer(y|ies)\b/i,
  },
  {
    positive: /\bcache\b/i,
    negative: /\bno.*\bcache\b/i,
  },
  {
    positive: /\btransaction\b/i,
    negative: /\bno.*\btransaction\b/i,
  },
];

export class ConflictDetector {
  private store: MetadataStore;

  constructor(store: MetadataStore) {
    this.store = store;
  }

  async detectConflicts(newRule: CodingRule): Promise<Conflict[]> {
    const allRules = await this.store.getAllRules({
      scope: newRule.metadata.scope,
      project_name: newRule.metadata.project_name,
      tech_stack: newRule.metadata.tech_stack,
    });

    const conflicts: Conflict[] = [];

    for (const existing of allRules) {
      if (existing.id === newRule.id) continue;

      const conflict = this.checkConflict(newRule, existing);
      if (conflict) {
        conflicts.push(conflict);
      }
    }

    return conflicts;
  }

  private checkConflict(rule1: CodingRule, rule2: CodingRule): Conflict | null {
    // Check for contradictory patterns
    const text1 = `${rule1.context.what_is_right} ${rule1.context.what_was_wrong}`;
    const text2 = `${rule2.context.what_is_right} ${rule2.context.what_was_wrong}`;

    // Pattern-based contradiction detection
    for (const pattern of CONTRADICTION_PATTERNS) {
      const hasPositive1 = pattern.positive.test(text1);
      const hasNegative2 = pattern.negative.test(text2);
      const hasPositive2 = pattern.positive.test(text2);
      const hasNegative1 = pattern.negative.test(text1);

      if ((hasPositive1 && hasNegative2) || (hasPositive2 && hasNegative1)) {
        return {
          rule1,
          rule2,
          type: 'contradictory',
          description: `Potential contradiction: one rule suggests "${text1.substring(0, 50)}..." while another suggests "${text2.substring(0, 50)}..."`,
        };
      }
    }

    // Check for exact opposite recommendations
    const right1 = rule1.context.what_is_right.toLowerCase();
    const right2 = rule2.context.what_is_right.toLowerCase();
    const wrong1 = rule1.context.what_was_wrong.toLowerCase();
    const wrong2 = rule2.context.what_was_wrong.toLowerCase();

    // Check if one says "use X" and other says "use Y" for same context
    if (this.isOppositeRecommendation(right1, right2)) {
      // Check if they're about same topic
      if (this.areRelatedTopics(rule1, rule2)) {
        return {
          rule1,
          rule2,
          type: 'contradictory',
          description: `Contradictory recommendations: "${rule1.title}" vs "${rule2.title}"`,
        };
      }
    }

    // Check for significant overlap
    const overlap = this.calculateOverlap(rule1, rule2);
    if (overlap > 0.7 && overlap < 0.95) {
      return {
        rule1,
        rule2,
        type: 'overlapping',
        description: `Highly similar rules (${Math.round(overlap * 100)}% overlap): "${rule1.title}" and "${rule2.title}"`,
      };
    }

    return null;
  }

  private isOppositeRecommendation(text1: string, text2: string): boolean {
    const keywords1 = text1.split(/\s+/).filter(w => w.length > 3);
    const keywords2 = text2.split(/\s+/).filter(w => w.length > 3);

    // Check if keywords from one appear in the "wrong" section of other
    for (const kw of keywords1) {
      if (keywords2.includes(kw)) {
        if (this.wrong2Contains(text2, kw)) return true;
      }
    }

    return false;
  }

  private wrong2Contains(text: string, keyword: string): boolean {
    const wrongTexts = [
      'wrong', 'incorrect', 'not correct', 'avoid', 'not', 'no',
      'should not', 'do not', "don't", 'never', 'bad', 'problem'
    ];
    return wrongTexts.some(w => text.includes(w));
  }

  private areRelatedTopics(rule1: CodingRule, rule2: CodingRule): boolean {
    // Check if tags overlap
    const tagOverlap = rule1.metadata.tags.filter(t => 
      rule2.metadata.tags.includes(t)
    );
    if (tagOverlap.length > 0) return true;

    // Check if tech stack overlaps
    const techOverlap = rule1.metadata.tech_stack.filter(t => 
      rule2.metadata.tech_stack.includes(t)
    );
    if (techOverlap.length > 0) return true;

    // Check if file paths overlap
    const pathOverlap = rule1.metadata.file_paths.filter(fp =>
      rule2.metadata.file_paths.some(rfp => rfp.includes(fp) || fp.includes(rfp))
    );
    return pathOverlap.length > 0;
  }

  private calculateOverlap(rule1: CodingRule, rule2: CodingRule): number {
    let score = 0;

    // Title similarity
    const titleSim = this.stringSimilarity(rule1.title, rule2.title);
    score += titleSim * 0.3;

    // Tag overlap
    if (rule1.metadata.tags.length > 0 || rule2.metadata.tags.length > 0) {
      const tagOverlap = rule1.metadata.tags.filter(t =>
        rule2.metadata.tags.includes(t)
      ).length;
      const tagUnion = new Set([...rule1.metadata.tags, ...rule2.metadata.tags]).size;
      score += (tagOverlap / tagUnion) * 0.3;
    }

    // Tech stack overlap
    if (rule1.metadata.tech_stack.length > 0 || rule2.metadata.tech_stack.length > 0) {
      const techOverlap = rule1.metadata.tech_stack.filter(t =>
        rule2.metadata.tech_stack.includes(t)
      ).length;
      const techUnion = new Set([...rule1.metadata.tech_stack, ...rule2.metadata.tech_stack]).size;
      score += (techOverlap / techUnion) * 0.2;
    }

    // File path overlap
    if (rule1.metadata.file_paths.length > 0 || rule2.metadata.file_paths.length > 0) {
      const pathOverlap = rule1.metadata.file_paths.filter(fp =>
        rule2.metadata.file_paths.some(rfp => rfp.includes(fp) || fp.includes(rfp))
      ).length;
      const pathUnion = new Set([...rule1.metadata.file_paths, ...rule2.metadata.file_paths]).size;
      score += (pathOverlap / pathUnion) * 0.2;
    }

    return score;
  }

  private stringSimilarity(a: string, b: string): number {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    
    if (aLower === bLower) return 1;
    if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.8;
    
    const aWords = new Set(aLower.split(/\s+/));
    const bWords = new Set(bLower.split(/\s+/));
    
    const intersection = new Set([...aWords].filter(x => bWords.has(x)));
    const union = new Set([...aWords, ...bWords]);
    
    return intersection.size / union.size;
  }
}
