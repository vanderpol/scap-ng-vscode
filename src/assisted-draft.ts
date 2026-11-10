import { MetadataPack, type Json } from './metadata.js';
import { GuidedCatalog, createGuidedAssessment } from './guided.js';

const schemaBase = 'https://scap-ng.dev/schema/v0.4.0/';

export interface AssistedDraftInput {
  title: string;
  checkText: string;
}

export type AssistedConfidence = 'high' | 'medium' | 'low';
export interface AssistedDraftResult {
  document: Json;
  yaml: string;
  diagnostics: string[];
  confidence: AssistedConfidence;
  assumptions: string[];
  unresolved: string[];
  generatedMode: 'automated' | 'manual';
}

interface Candidate {
  capability: string;
  object: Record<string, Json>;
  fields?: Record<string, Json>;
  assumptions: string[];
  confidence: AssistedConfidence;
}

function slug(value: string, suffix: string): string {
  const result = value.toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 52)
    .replace(/-+$/, '');
  return `${result || 'assisted-assessment'}-${suffix}`;
}
function firstPlatform(pack: MetadataPack): string { return new GuidedCatalog(pack).platforms()[0]?.value ?? 'unknown'; }
function firstClass(pack: MetadataPack): string { return new GuidedCatalog(pack).classes().find(value => value.value === 'compliance')?.value ?? new GuidedCatalog(pack).classes()[0]?.value ?? 'compliance'; }
function cleanText(value: string): string { return value.replace(/\r\n?/g, '\n').trim(); }
function unquote(value: string): string { return value.trim().replace(/^['"]|['"]$/g, ''); }
function hive(value: string): string | undefined {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized === 'HKLM' || normalized === 'HKEYLOCALMACHINE') return 'local_machine';
  if (normalized === 'HKCU' || normalized === 'HKEYCURRENTUSER') return 'current_user';
  if (normalized === 'HKU' || normalized === 'HKEYUSERS') return 'users';
  if (normalized === 'HKCC' || normalized === 'HKEYCURRENTCONFIG') return 'current_config';
  return undefined;
}
function registryCandidate(text: string): Candidate | undefined {
  const upper = text.toUpperCase();
  if (!/(REGISTRY|REGEDIT|HKEY_|HKLM|HKCU|HKU|HKCC)/.test(upper)) return undefined;
  const pathMatch = text.match(/\b((?:HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|HKEY_USERS|HKEY_CURRENT_CONFIG|HKLM|HKCU|HKU|HKCC)\\[^\s\n"']+)/i);
  const path = pathMatch?.[1]?.replace(/[),.;:]+$/, '');
  const parts = path?.split('\\') ?? [];
  const selectedHive = parts.length ? hive(parts.shift() ?? '') : undefined;
  const key = parts.join('\\');
  const nameMatch = text.match(/(?:value|setting|entry|name)\s+(?:named\s+|called\s+)?["'`]?([A-Za-z0-9_. -]+)["'`]?/i);
  const name = nameMatch?.[1]?.trim().replace(/[.,;:]+$/, '');
  if (!selectedHive || !key || !name) return undefined;
  const object: Record<string, Json> = {
    hive: { equals: selectedHive },
    key: { equals: key },
    name: { equals: name }
  };
  const fields: Record<string, Json> = {};
  const valueMatch = text.match(/(?:set|configured|defined|must be|equals?)\b[^.\n]{0,240}?(?:to|as|at|of)\s+[\"'`]?(-?\d+(?:\.\d+)?|enabled|disabled|true|false|yes|no|on|off)[\"'`]?/i) ?? text.match(/(?:must be|equals?)\s+[\"'`]?(-?\d+(?:\.\d+)?|enabled|disabled|true|false|yes|no|on|off)[\"'`]?/i);
  if (valueMatch) {
    const raw = unquote(valueMatch[1]);
    const numeric = /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : undefined;
    fields.value = { equals: numeric ?? raw };
    if (numeric !== undefined) fields.type = { equals: Number.isInteger(numeric) ? 'dword' : 'string' };
  }
  return { capability: 'windows.registry', object, fields: Object.keys(fields).length ? fields : undefined, confidence: fields.value ? 'high' : 'medium', assumptions: [
    'Inferred a Windows registry Object from the registry hive, key, and value name in the pasted text.',
    ...(fields.value ? ['Inferred the expected registry value from a value-setting phrase.'] : ['No unambiguous expected registry value was found; the generated Test is presence-only.'])
  ] };
}
function userRightCandidate(text: string): Candidate | undefined {
  const match = text.match(/\b(SE_[A-Z0-9_]+)\b/);
  if (!match || !/user\s+right|user-right|local security policy|secpol\.msc/i.test(text)) return undefined;
  return { capability: 'windows.userright', object: { userright: { equals: match[1] } }, confidence: 'high', assumptions: ['Inferred the Windows user-right capability and privilege token from the pasted text.'] };
}
function unixFileCandidate(text: string): Candidate | undefined {
  const path = text.match(/(?:^|\s)(\/(?:etc|var|usr|opt|home|bin|sbin|boot|tmp|root)\/[A-Za-z0-9_./-]+)/)?.[1];
  if (!path || !/(?:file|directory|folder|permission|mode|owner|group|path)/i.test(text)) return undefined;
  return { capability: 'unix.file', object: { full_path: { equals: path } }, confidence: 'medium', assumptions: ['Inferred a Unix file Object from an absolute path and file/permission language.', 'The expected file state still needs author review.'] };
}
function annotation(input: AssistedDraftInput, confidence: AssistedConfidence, assumptions: string[], unresolved: string[]): string {
  const lines = [
    '# Assisted Assessment draft — best guess only; review before use.',
    '# Generated by the offline heuristic workflow; no AI or scanner was used.',
    `# Confidence: ${confidence}.`,
    ...assumptions.map(value => `# Assumption: ${value}`),
    ...unresolved.map(value => `# Review needed: ${value}`),
    '# Source check text (preserved for review):'
  ];
  for (const line of cleanText(input.checkText).split('\n')) lines.push(`# ${line}`);
  return lines.join('\n');
}
function packageCandidate(text: string): Candidate | undefined {
  const packageName = text.match(/(?:package|rpm|dpkg)\s+["'`]?([A-Za-z0-9_.+:-]+)["'`]?/i)?.[1];
  if (!packageName || !/(?:package|rpm|dpkg)/i.test(text)) return undefined;
  return { capability: 'linux.rpminfo', object: { name: { equals: packageName } }, confidence: 'low', assumptions: ['Inferred a Linux package Object from package-manager language.', 'Package version/state requirements were not inferred.'] };
}
function candidateFor(input: AssistedDraftInput, pack: MetadataPack): Candidate | undefined {
  const text = input.checkText;
  return registryCandidate(text) ?? userRightCandidate(text) ?? unixFileCandidate(text) ?? packageCandidate(text);
}
function manualDraft(pack: MetadataPack, input: AssistedDraftInput, confidence: AssistedConfidence, assumptions: string[], unresolved: string[]): AssistedDraftResult {
  const title = cleanText(input.title);
  const checkText = cleanText(input.checkText);
  const result = createGuidedAssessment(pack, {
    platform: firstPlatform(pack), id: slug(title, 'assessment'), title,
    mode: 'manual', className: firstClass(pack), procedure: checkText || `Review the requirement: ${title}`,
    response: { type: 'manual-review', choices: [
      { value: 'yes', label: 'Meets requirement', outcome: 'true' },
      { value: 'no', label: 'Does not meet requirement', outcome: 'false' }
    ], allow_comment: true, allow_evidence: true }
  });
  const notes = annotation({ title, checkText }, confidence, assumptions, unresolved);
  return { ...result, yaml: `${notes}\n${result.yaml}`, confidence, assumptions, unresolved, generatedMode: 'manual' };
}

export function createAssistedAssessment(pack: MetadataPack, input: AssistedDraftInput): AssistedDraftResult {
  const title = cleanText(input.title);
  const checkText = cleanText(input.checkText);
  if (!title) throw new Error('Rule title is required.');
  if (!checkText) throw new Error('Paste the check text or procedure before generating a draft.');
  const candidate = candidateFor({ title, checkText }, pack);
  if (!candidate || !pack.manifest.capabilities[candidate.capability]) {
    return manualDraft(pack, { title, checkText }, 'low', [], [
      'No supported automated selector pattern was confidently recognized.',
      'The draft was created as a manual procedure so no scanner semantics were invented.'
    ]);
  }
  const catalog = new GuidedCatalog(pack);
  const required = catalog.objectRequirements(candidate.capability);
  const complete = required.some(branch => branch.fields.every(field => Object.hasOwn(candidate.object, field)));
  if (!complete) {
    return manualDraft(pack, { title, checkText }, 'low', candidate.assumptions, ['The inferred Object does not satisfy a complete schema-required selector branch.']);
  }
  const generated = createGuidedAssessment(pack, {
    platform: firstPlatform(pack), id: slug(title, 'assessment'), title,
    mode: 'automated', className: firstClass(pack), tests: [{
      id: slug(title, 'test'), title, capability: candidate.capability,
      object: candidate.object, fields: candidate.fields, presenceOnly: !candidate.fields
    }]
  });
  if (generated.diagnostics.length) {
    return manualDraft(pack, { title, checkText }, 'low', candidate.assumptions, [
      `The best automated guess failed pinned schema validation: ${generated.diagnostics.join('; ')}`
    ]);
  }
  const unresolved = candidate.fields ? ['Confirm the inferred capability, selectors, datatype, and expected value against the original STIG.'] : ['Add the expected field predicate(s); this draft currently checks only Item presence.'];
  const notes = annotation({ title, checkText }, candidate.confidence, candidate.assumptions, unresolved);
  return { ...generated, yaml: `${notes}\n${generated.yaml}`, confidence: candidate.confidence, assumptions: candidate.assumptions, unresolved, generatedMode: 'automated' };
}
