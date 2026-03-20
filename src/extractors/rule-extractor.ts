import { LLMService } from '../llm/providers/factory.js';
import { LLMMessage } from '../llm/types.js';
import { DetectedCorrection } from './correction-detector.js';
import { StoreCorrectionInput } from '../types/mcp-types.js';
import { QueryContext } from '../types/rule.js';

const RULE_EXTRACTION_PROMPT = `You are a coding rule extractor. Given a correction made by a user to an LLM's code, extract a structured coding rule.

Respond ONLY with valid JSON (no markdown formatting), with this structure:
{
  "title": "Brief title (max 60 chars)",
  "description": "Detailed description of the rule",
  "what_was_wrong": "What the LLM did wrong",
  "what_is_right": "What the correct approach is",
  "why": "Why this is important",
  "applicable_files": ["file patterns this applies to"],
  "tech_stack": ["technologies this applies to"],
  "tags": ["relevant tags"]
}

Guidelines:
- Title should be actionable and specific
- Include specific code patterns if visible
- Keep tech_stack specific (e.g., "typescript", "ocpp", "sequelize")
- Tags should be general categories

Example:
{
  "title": "Always validate transaction ID before stopping",
  "description": "When handling RemoteStopTransaction, validate that the transaction exists and is active",
  "what_was_wrong": "Just accepting the stop request without checking transaction status",
  "what_is_right": "Check transaction existence and status before processing stop",
  "why": "Prevents errors and ensures proper state management",
  "applicable_files": ["**/ocpp/**", "**/transaction*"],
  "tech_stack": ["typescript", "ocpp"],
  "tags": ["validation", "transactions"]
}

Now extract the rule from this correction:`;

export class RuleExtractor {
  private llm: LLMService;

  constructor(llm: LLMService) {
    this.llm = llm;
  }

  async extract(
    correction: DetectedCorrection,
    context: QueryContext
  ): Promise<{ partial_rule: Partial<StoreCorrectionInput>; confidence: number }> {
    const messages: LLMMessage[] = [
      { role: 'system', content: RULE_EXTRACTION_PROMPT },
    ];

    let userContent = `Correction: "${correction.user_message}"`;

    if (correction.assistant_code) {
      userContent += `\n\nPrevious code (that was wrong):\n\`\`\`\n${correction.assistant_code}\n\`\`\``;
    }

    if (correction.user_fix) {
      userContent += `\n\nUser's fix:\n\`\`\`\n${correction.user_fix}\n\`\`\``;
    }

    if (context.current_file) {
      userContent += `\n\nFile being edited: ${context.current_file}`;
    }

    if (context.tech_stack?.length) {
      userContent += `\n\nTech stack: ${context.tech_stack.join(', ')}`;
    }

    if (context.project_name) {
      userContent += `\n\nProject: ${context.project_name}`;
    }

    messages.push({ role: 'user', content: userContent });

    try {
      const response = await this.llm.chat(messages);
      const extracted = this.parseLLMResponse(response.content);
      
      return {
        partial_rule: this.convertToStoreInput(extracted, context),
        confidence: correction.confidence * 0.7, // Reduce confidence for LLM extraction
      };
    } catch (error) {
      console.error('Rule extraction failed:', error);
      // Fallback to heuristic extraction
      return {
        partial_rule: this.fallbackExtract(correction, context),
        confidence: correction.confidence * 0.5,
      };
    }
  }

  private parseLLMResponse(content: string): any {
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Try to find valid JSON within
        const starts = content.indexOf('{');
        const ends = content.lastIndexOf('}');
        if (starts !== -1 && ends !== -1) {
          try {
            return JSON.parse(content.substring(starts, ends + 1));
          } catch {
            // Fall through to default
          }
        }
      }
    }
    return null;
  }

  private convertToStoreInput(
    extracted: any,
    context: QueryContext
  ): Partial<StoreCorrectionInput> {
    if (!extracted) {
      return {};
    }

    return {
      title: extracted.title || 'Untitled Rule',
      description: extracted.description || '',
      what_was_wrong: extracted.what_was_wrong || '',
      what_is_right: extracted.what_is_right || '',
      why: extracted.why || '',
      file_paths: extracted.applicable_files || [],
      tech_stack: extracted.tech_stack || context.tech_stack || [],
      tags: extracted.tags || [],
      scope: context.project_name ? 'project' : 'global',
      project_name: context.project_name,
    };
  }

  private fallbackExtract(
    correction: DetectedCorrection,
    context: QueryContext
  ): Partial<StoreCorrectionInput> {
    // Simple heuristic extraction when LLM fails
    const title = correction.user_fix
      ? `Code correction (${context.current_file || 'unknown file'})`
      : 'Correction pattern';

    return {
      title,
      description: correction.user_message.substring(0, 200),
      what_was_wrong: correction.assistant_code?.substring(0, 200) || 'Unknown',
      what_is_right: correction.user_fix || correction.user_message.substring(0, 200),
      why: 'Extracted from user correction',
      file_paths: context.current_file ? [context.current_file] : [],
      tech_stack: context.tech_stack || [],
      tags: ['auto-detected'],
      scope: context.project_name ? 'project' : 'global',
      project_name: context.project_name,
    };
  }
}
