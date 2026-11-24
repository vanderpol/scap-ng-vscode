/**
 * Deterministic Codex effort selection for SCAP-NG authoring.
 *
 * This is intentionally a local heuristic, not an AI call. It only decides
 * whether a bounded request looks simple enough for Low, ordinary enough for
 * Medium, or semantically dense enough to reserve High. Local validation still
 * decides whether the returned Assessment is usable.
 */
import type { CodexReasoningEffort, CodexResolvedReasoningEffort } from './ai-configuration.js';

export interface CodexEffortInput {
  title?: string;
  checkText: string;
  platform?: string;
  ruleYaml?: string;
  candidateYaml?: string;
  reviewMode?: boolean;
}

export interface CodexEffortRecommendation {
  effort: Exclude<CodexResolvedReasoningEffort, 'host'>;
  score: number;
  reason: string;
  signals: string[];
}

function countMatches(value: string, expression: RegExp): number {
  return [...value.matchAll(expression)].length;
}

/** Choose a bounded effort without sending source content anywhere. */
export function recommendCodexReasoningEffort(input: CodexEffortInput): CodexEffortRecommendation {
  const text = `${input.title ?? ''}\n${input.checkText ?? ''}`.replace(/\r\n?/g, '\n');
  const procedure = (input.checkText ?? '').replace(/\r\n?/g, '\n');
  const rule = input.ruleYaml ?? '';
  let score = 0;
  const signals: string[] = [];
  const add = (points: number, signal: string) => { score += points; signals.push(signal); };

  const objectiveSteps = countMatches(procedure, /(?:^|\n)\s*(?:verify|check|ensure|confirm|validate|if|when)\b/gi)
    + countMatches(procedure, /(?:^|\n)\s*\$\s+/g);
  if (objectiveSteps >= 3) add(2, 'multiple objective procedure steps');
  else if (objectiveSteps >= 2) add(1, 'more than one objective procedure step');

  if (/(?:not\s+applicable|applicab(?:le|ility)|platform|operating\s+system|if\s+.*\b(?:used|present|installed|enabled))/i.test(text)) {
    add(2, 'applicability or conditional language');
  }
  if (/(?:organiz|authorized|approved|USNO|DoW|Department\s+of\s+(?:War|the\s+Navy)|<[^>]+>|\binput\b)/i.test(text)) {
    add(2, 'organization-defined value or input');
  }
  if (/(?:\*|\[\^|\.\.\.|for\s+each|every\s+|all\s+|any\s+|multiple|each\s+)/i.test(text)) {
    add(1, 'wildcard or population semantics');
  }
  if (/(?:unless|except|exception|ISSO|ISSM|AO|administrator\s+approval|commented|uncommented|inline\s+comment|omits?|missing|at\s+least|no\s+greater|less\s+than|between)/i.test(text)) {
    add(1, 'edge-case or exception semantics');
  }
  if (input.reviewMode || input.candidateYaml) add(2, 'independent candidate review');
  if (rule.length > 8_000 || /(?:conditions|applicability|evaluate|assessment)/i.test(rule)) add(1, 'Rule context contains structural applicability or evaluation data');
  if (text.length > 3_000) add(1, 'long procedure text');

  // A truly small, single predicate can use Low. Medium remains the normal
  // automatic choice; High is reserved for cases where a correction pass is
  // more valuable than the additional latency.
  const simple = score === 0 && text.length <= 900 && objectiveSteps <= 1
    && /(?:\b(?:file|package|service|unit|directory)\b).{0,80}\b(?:present|installed|active|exists|enabled)\b/i.test(text);
  const effort: CodexEffortRecommendation['effort'] = score >= 3 ? 'high' : simple ? 'low' : 'medium';
  const reason = effort === 'high'
    ? `Automatic selection: High because ${signals.slice(0, 3).join(', ')}${signals.length > 3 ? ', and other complexity signals' : ''}.`
    : effort === 'low'
      ? 'Automatic selection: Low because this is a short, single objective presence/state check with no detected branching or population complexity.'
      : 'Automatic selection: Medium because the procedure is not trivial enough for Low and has no combination of complexity signals that warrants High.';
  return { effort, score, reason, signals };
}

export interface ResolvedCodexEffort {
  effort: CodexResolvedReasoningEffort;
  selection: 'configured' | 'automatic';
  reason?: string;
}

export function resolveCodexReasoningEffort(setting: CodexReasoningEffort | undefined, input: CodexEffortInput): ResolvedCodexEffort {
  if (setting !== 'auto') return { effort: setting ?? 'host', selection: 'configured' };
  const recommendation = recommendCodexReasoningEffort(input);
  return { effort: recommendation.effort, selection: 'automatic', reason: recommendation.reason };
}

/** Conservative planning window shown to authors; provider latency is variable. */
export function effortPlanningSeconds(effort: CodexResolvedReasoningEffort | CodexEffortRecommendation['effort']): number {
  switch (effort) {
    case 'low': return 90;
    case 'medium': return 150;
    case 'high': return 240;
    case 'xhigh':
    case 'max': return 240;
    default: return 240;
  }
}
