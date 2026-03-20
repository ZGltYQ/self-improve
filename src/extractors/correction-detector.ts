export interface DetectedCorrection {
  confidence: number;
  user_message: string;
  assistant_code?: string;
  user_fix?: string;
  indicators: string[];
  previous_assistant_message?: string;
}

const CORRECTION_KEYWORDS = [
  'no', 'wrong', 'instead', 'actually', "don't", 'never', 
  'not correct', 'incorrect', 'that is wrong', 'you should',
  'use', 'should be', 'needs to be', 'must be', 'have to',
  'cannot', 'can\'t', 'avoid', 'should not', 'do not',
  'try again', 'fix this', 'fix the', 'error', 'failed',
  'this doesn\'t work', 'this is broken', 'doesn\'t work',
  'properly', 'the right way', 'correct way', 'better to',
  'prefer', 'recommend', 'use X not Y', 'X not Y',
];

const CODE_REPLACE_PATTERNS = [
  /```(?:\w+)?\n([\s\S]*?)```/g,
  /`([\s\S]*?)`/g,
];

export class CorrectionDetector {
  detect(
    conversation: Array<{ role: 'user' | 'assistant'; content: string }>
  ): DetectedCorrection[] {
    const corrections: DetectedCorrection[] = [];
    let lastAssistantMessage = '';

    for (let i = conversation.length - 1; i >= 0; i--) {
      const msg = conversation[i];

      if (msg.role === 'assistant') {
        lastAssistantMessage = msg.content;
        continue;
      }

      if (msg.role === 'user') {
        const result = this.analyzeUserMessage(msg.content, lastAssistantMessage);
        if (result.confidence > 0.3) {
          corrections.unshift({
            ...result,
            previous_assistant_message: lastAssistantMessage,
          });
        }
        lastAssistantMessage = '';
      }
    }

    return corrections;
  }

  private analyzeUserMessage(
    userMessage: string,
    previousAssistantMessage: string
  ): Omit<DetectedCorrection, 'previous_assistant_message'> {
    const indicators: string[] = [];
    const userLower = userMessage.toLowerCase();

    // Keyword-based detection
    const keywordMatches = CORRECTION_KEYWORDS.filter(
      kw => userLower.includes(kw)
    );
    if (keywordMatches.length > 0) {
      indicators.push(`keywords: ${keywordMatches.slice(0, 3).join(', ')}`);
    }

    // Negation patterns
    const negationPatterns = [
      /\b(no|not|never|don't|cannot|can't)\b/i,
      /\b(wrong|incorrect|error|fail)\b/i,
      /\b(instead|rather|but)\b/i,
      /\bshould\s+(not|be|use|have)\b/i,
    ];

    const hasNegation = negationPatterns.some(p => p.test(userMessage));
    if (hasNegation) {
      indicators.push('negation detected');
    }

    // Code replacement pattern (user shows code)
    const hasCodeExample = /```[\s\S]*?```/.test(userMessage);
    if (hasCodeExample) {
      indicators.push('code example provided');
    }

    // Check for comparison pattern
    const hasComparison = /(?:not|vs\.?|rather than|instead of|use\s+\w+\s+not)/i.test(userMessage);
    if (hasComparison) {
      indicators.push('comparison pattern');
    }

    // Short-circuit for high-confidence patterns
    const highConfidencePatterns = [
      /no,?\s*(use|use\s+[\w.]+)/i,
      /(?:use|try)\s+`[^`]+`\s+(?:instead|not|rather)/i,
      /```(?:\w+)?\n[^}]+\n```.*(instead|not|but)/is,
    ];

    for (const pattern of highConfidencePatterns) {
      if (pattern.test(userMessage)) {
        indicators.push('high-confidence pattern');
        break;
      }
    }

    // Calculate confidence
    let confidence = 0;
    
    if (keywordMatches.length > 0) confidence += 0.2;
    if (hasNegation) confidence += 0.3;
    if (hasCodeExample) confidence += 0.25;
    if (hasComparison) confidence += 0.2;
    if (indicators.includes('high-confidence pattern')) confidence += 0.3;
    if (indicators.includes('code example provided')) confidence += 0.15;

    // Extract code snippets if present
    let userFix: string | undefined;
    const codeMatches = userMessage.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (codeMatches) {
      userFix = codeMatches[1].trim();
    }

    return {
      confidence: Math.min(confidence, 1),
      user_message: userMessage,
      assistant_code: this.extractCodeSnippet(previousAssistantMessage),
      user_fix: userFix,
      indicators,
    };
  }

  private extractCodeSnippet(text: string): string | undefined {
    const match = text.match(/```(?:\w+)?\n([\s\S]*?)```/);
    return match ? match[1].trim() : undefined;
  }
}
