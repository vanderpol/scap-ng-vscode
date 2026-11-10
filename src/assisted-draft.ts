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
  testCandidates?: Array<{ title: string; fields?: Record<string, Json>; presenceOnly?: boolean }>;
  evaluate?: 'and' | 'or' | 'one' | 'xor';
  presenceOnly?: boolean;
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
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function unquote(value: string): string { return value.trim().replace(/^['"]|['"]$/g, ''); }
function hive(value: string): string | undefined {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized === 'HKLM' || normalized === 'HKEYLOCALMACHINE') return 'local_machine';
  if (normalized === 'HKCU' || normalized === 'HKEYCURRENTUSER') return 'current_user';
  if (normalized === 'HKU' || normalized === 'HKEYUSERS') return 'users';
  if (normalized === 'HKCC' || normalized === 'HKEYCURRENTCONFIG') return 'current_config';
  return undefined;
}
function auditEventCandidate(text: string): Candidate | undefined {
  if (!/(?:auditpol|audit policy|auditing|audit subcategor)/i.test(text)) return undefined;
  const explicitField = text.match(/(?:^|[\s>])Audit\s+(?!policy\b)([A-Za-z][A-Za-z0-9 /_-]*?)(?=\s+auditing\b|["']\s+(?:is|must)|\s+(?:is|must)\b|\.)/i)?.[1];
  const statusPhrase = text.match(/\b(?:set|configured|enabled)\s+(?:to\s+)?["'`]?((?:success)(?:\s+and\s+failure)?|failure(?:s)?|success(?:es)?)["'`]?/i)?.[1];
  const terminalStatus = text.match(/(?:[-»>]|\bset\s+to)\s*["'`]?((?:success)(?:\s+and\s+failure)?|failure(?:s)?|success(?:es)?)["'`]?\b/i)?.[1];
  const effectiveStatus = statusPhrase ?? terminalStatus;
  const failure = /\bfailure(?:s)?\b|\benabled\s+for\s+failures?\b/i.test(effectiveStatus ?? '') || (!effectiveStatus && /\benabled\s+for\s+failures?\b/i.test(text));
  const success = /\bsuccess(?:es)?\b/i.test(effectiveStatus ?? '') || (!effectiveStatus && /\benabled\s+for\s+success(?:es)?\b/i.test(text));
  const fieldMatch = text.match(/([A-Za-z][A-Za-z0-9 /_-]+?)\s+(?:success(?:es)?|failures?|success\s+and\s+failure)\b/i);
  const rawField = explicitField ?? (fieldMatch ? fieldMatch[1].trim().replace(/[-»>\s]+$/, '').split(/[-»>]/).pop()?.trim() : undefined);
  const field = rawField?.replace(/^audit\s+/i, '').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '').toLowerCase();
  if (!field || field === 'audit' || field === 'policy' || (!failure && !success)) return undefined;
  const both = /success\s+and\s+failure/i.test(effectiveStatus ?? '');
  const values = both ? ['AUDIT_SUCCESS_FAILURE'] : failure && !success
    ? ['AUDIT_FAILURE', 'AUDIT_SUCCESS_FAILURE']
    : ['AUDIT_SUCCESS', 'AUDIT_SUCCESS_FAILURE'];
  return {
    capability: 'windows.auditeventpolicysubcategories', object: {}, evaluate: 'or',
    testCandidates: values.map(value => ({ title: `Audit ${field.replaceAll('_', ' ')} — ${value === 'AUDIT_SUCCESS' ? 'Success' : value === 'AUDIT_FAILURE' ? 'Failure' : 'Success and Failure'}`, fields: { [field]: { equals: value } } })),
    confidence: explicitField || fieldMatch ? 'high' : 'medium', assumptions: [
      `Inferred the Windows AuditPol subcategory field '${field}' from the policy category text.`,
      'Generated alternatives for the required audit outcome and Success-and-Failure coverage.'
    ]
  };
}
function labeledRegistryValue(text: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = text.match(new RegExp(`(?:^|\\r?\\n)\\s*${escaped}\\s*:\\s*([^\\r\\n]*)`, 'im'));
  if (line?.[1]) return line[1].trim().replace(/[.,;:]+$/, '').trim();
  const labels = '(?:Registry\\s+(?:Hive|Path)|Value\\s+(?:Name|Type)|Type|Value)';
  const inline = text.match(new RegExp(`\\b${escaped}\\s*:\\s*([^\\r\\n]*?)(?=\\s+${labels}\\s*:|\\s*$)`, 'i'));
  return inline?.[1]?.trim().replace(/[.,;:]+$/, '').trim();
}
function registryScalar(value: string): Json {
  const raw = unquote(value.trim());
  const hex = raw.match(/^0x[0-9a-f]+/i); if (hex) return Number.parseInt(hex[0], 16);
  const number = raw.match(/^-?\d+(?:\.\d+)?/); if (number) return Number(number[0]);
  if (/^(true|false)\b/i.test(raw)) return raw.toLowerCase().startsWith('true');
  return raw;
}
function registryCandidate(text: string): Candidate | undefined {
  const upper = text.toUpperCase();
  if (!/(REGISTRY|REGEDIT|HKEY_|HKLM|HKCU|HKU|HKCC)/.test(upper)) return undefined;
  const labeledHive = labeledRegistryValue(text, 'Registry Hive');
  const labeledPath = labeledRegistryValue(text, 'Registry Path');
  const labeledName = labeledRegistryValue(text, 'Value Name');
  const labeledType = labeledRegistryValue(text, 'Value Type');
  const labeledValue = labeledRegistryValue(text, 'Value');
  const pathMatch = text.match(/\b((?:HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|HKEY_USERS|HKEY_CURRENT_CONFIG|HKLM|HKCU|HKU|HKCC)\\[^\s\n"']+)/i);
  const inlinePathMatch = text.match(/\b((?:HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER|HKEY_USERS|HKEY_CURRENT_CONFIG|HKLM|HKCU|HKU|HKCC)\\[\s\S]*?)(?=\s+Value\s+Name\s*:|\s+Value\s*:)/i);
  const path = labeledPath || inlinePathMatch?.[1]?.trim() || pathMatch?.[1]?.replace(/[),.;:]+$/, '');
  const parts = path?.replace(/^\\+|\\+$/g, '').split('\\') ?? [];
  const embeddedHive = hive(parts[0] ?? '');
  const selectedHive = hive(labeledHive ?? parts[0] ?? (pathMatch?.[1]?.split('\\')[0] ?? inlinePathMatch?.[1]?.split('\\')[0] ?? ''));
  if (embeddedHive) parts.shift();
  const key = parts.join('\\');
  const nameMatch = text.match(/(?:value|setting|entry|name)\s+(?:named\s+|called\s+)?["'`]?([A-Za-z0-9_. -]+)["'`]?/i);
  const name = labeledName || nameMatch?.[1]?.trim().replace(/[.,;:]+$/, '');
  if (!selectedHive || !key || !name) return undefined;
  const object: Record<string, Json> = {
    hive: { equals: selectedHive },
    key: { equals: key },
    name: { equals: name }
  };
  const fields: Record<string, Json> = {};
  const valueMatch = text.match(/(?:set|configured|defined|must be|equals?)\b[^.\n]{0,240}?(?:to|as|at|of)\s+["'`]?(-?\d+(?:\.\d+)?|enabled|disabled|true|false|yes|no|on|off)["'`]?/i) ?? text.match(/(?:must be|equals?)\s+["'`]?(-?\d+(?:\.\d+)?|enabled|disabled|true|false|yes|no|on|off)["'`]?/i);
  const expected = labeledValue || valueMatch?.[1];
  if (expected !== undefined) {
    const parsed = registryScalar(expected);
    fields.value = { equals: parsed };
    const type = labeledType?.toUpperCase();
    if (type === 'REG_DWORD' || type === 'REG_DWORD_LITTLE_ENDIAN') fields.type = { equals: 'dword' };
    else if (type === 'REG_QWORD' || type === 'REG_QWORD_LITTLE_ENDIAN') fields.type = { equals: 'qword' };
    else if (type === 'REG_MULTI_SZ') fields.type = { equals: 'multi_string' };
    else if (type === 'REG_EXPAND_SZ') fields.type = { equals: 'expand_string' };
    else if (type === 'REG_SZ') fields.type = { equals: 'string' };
    else if (typeof parsed === 'number') fields.type = { equals: Number.isInteger(parsed) ? 'dword' : 'string' };
  }
  const labeled = Boolean(labeledHive && labeledPath && labeledName);
  return { capability: 'windows.registry', object, fields: Object.keys(fields).length ? fields : undefined, confidence: fields.value && labeled ? 'high' : fields.value ? 'medium' : 'medium', assumptions: [
    'Inferred a Windows registry Object from the registry hive, key, and value name in the pasted text.',
    ...(fields.value ? ['Inferred the expected registry value and datatype from the labeled registry fields.'] : ['No unambiguous expected registry value was found; the generated Test is presence-only.'])
  ] };
}
function mappingTokens(pack: MetadataPack, capability: string, key: string): string[] {
  try {
    const uri = pack.manifest.capabilities[capability]?.mapping_uri; if (!uri) return [];
    const mapping: any = pack.resource(uri); return Object.keys(mapping.migration_crosswalk?.[key] ?? {});
  } catch { return []; }
}
function normalizedPhrase(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\busers\b/g, 'user').replace(/\blinks\b/g, 'link').trim(); }
function userRightCandidate(text: string, pack: MetadataPack): Candidate | undefined {
  const explicit = text.match(/\b(SE_[A-Z0-9_]+)\b/)?.[1];
  const tokens = explicit ? [explicit] : mappingTokens(pack, 'windows.userright', 'userright_values');
  const phrase = normalizedPhrase(text);
  const token = explicit ?? tokens
    .filter(value => !['SE_AUDIT_NAME', 'SE_SECURITY_NAME'].includes(value))
    .sort((a, b) => b.length - a.length)
    .find(value => phrase.includes(normalizedPhrase(value.replace(/^SE_|_NAME$/g, '').replaceAll('_', ' '))));
  if (!token || (!explicit && !/user\s+right|user-right|local security policy|security settings/i.test(text))) return undefined;
  const group = text.match(/(?:assigned|granted|allowed)\s+to\s+(?:the\s+)?([A-Za-z][A-Za-z ]*?)(?:\s+group)?\s*(?:\.|,|$)/i)?.[1]?.trim();
  const fields = group ? { trustee_name: { case_insensitive_equals: group } } : undefined;
  return { capability: 'windows.userright', object: { userright: { equals: token } }, fields, presenceOnly: !fields, confidence: explicit || fields ? 'high' : 'medium', assumptions: [
    `Inferred the Windows user-right token ${token} from the labeled privilege phrase.`,
    ...(fields ? [`Inferred the expected trustee name '${group}'.`] : ['No unambiguous trustee condition was found; the generated Test checks Item presence only.'])
  ] };
}
function sysctlCandidate(text: string): Candidate | undefined {
  const command = text.match(/\bsysctl(?:\s+-n)?\s+([A-Za-z][A-Za-z0-9_.]+)/i)?.[1];
  const name = command ?? text.match(/\b([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\s+(?:parameter|variable)/i)?.[1];
  if (!name || !/(?:sysctl|kernel\.|net\.ipv)/i.test(text)) return undefined;
  const value = text.match(new RegExp(`${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')}\\s*=\\s*([^\\s\\n,]+)`, 'i'))?.[1] ?? text.match(/(?:set to|value of|equals?)\s+["'`]?([^\s"'`,.]+)/i)?.[1];
  if (value === undefined) return undefined;
  const parsed: Json = /^-?\d+$/.test(value) ? Number(value) : value;
  return { capability: 'unix.sysctl', object: { name: { equals: name } }, fields: { value: { equals: parsed } }, confidence: 'high', assumptions: ['Inferred a Unix sysctl Object and expected value from the sysctl command/output.'] };
}
function systemdCandidate(text: string): Candidate | undefined {
  const match = text.match(/\bsystemctl\s+(?:is-active|status|is-enabled)\s+([A-Za-z0-9_.@-]+)/i);
  if (!match || !/(?:systemctl|service|daemon)/i.test(text)) return undefined;
  const unit = match[1].endsWith('.service') ? match[1] : `${match[1]}.service`;
  const enabled = /is-enabled|enabled/i.test(text) && !/not enabled|disabled/i.test(text);
  const active = /is-active|active|running/i.test(text) && !/not active|inactive|stopped/i.test(text);
  const property = enabled ? 'UnitFileState' : 'ActiveState';
  const value = enabled ? 'enabled' : active ? 'active' : undefined;
  if (!value) return undefined;
  return { capability: 'linux.systemdunitproperty', object: { unit: { equals: unit }, property: { equals: property } }, fields: { value: { equals: value } }, confidence: 'high', assumptions: ['Inferred a systemd unit, property, and expected state from the systemctl command.'] };
}
function packageCandidate(text: string): Candidate | undefined {
  const packageName = text.match(/(?:dnf\s+(?:list|info)\s+--installed|rpm\s+-q|dpkg\s+-[sl])\s+([A-Za-z0-9_.+:-]+)/i)?.[1]
    ?? text.match(/\b(?:the\s+)?([A-Za-z0-9_.+:-]+)\s+package\s+(?:is\s+)?(?:installed|present|removed)/i)?.[1];
  if (!packageName || !/(?:package|rpm|dpkg|dnf|apt)/i.test(text)) return undefined;
  return { capability: 'linux.rpminfo', object: { package_name: { equals: packageName }, include_file_paths: false }, presenceOnly: true, confidence: 'high', assumptions: ['Inferred a Linux package Object from the package-manager command and package name.', 'The generated Test checks package presence; version/state requirements still need review.'] };
}
function policyCandidate(text: string): Candidate | undefined {
  const lower = text.toLowerCase();
  const isPassword = /password policy|password age|password history|password length|password complexity|reversible encryption/.test(lower);
  const isLockout = /account lockout|lockout duration|lockout threshold|bad logon attempts/.test(lower);
  if (!isPassword && !isLockout) return undefined;
  const metric = isPassword
    ? (lower.includes('history') ? 'password_hist_len' : lower.includes('minimum password age') ? 'min_passwd_age' : lower.includes('maximum password age') ? 'max_passwd_age' : lower.includes('minimum password length') ? 'min_passwd_len' : lower.includes('complexity') ? 'password_complexity' : lower.includes('reversible') ? 'reversible_encryption' : undefined)
    : (lower.includes('lockout duration') ? 'lockout_duration' : lower.includes('observation window') ? 'lockout_observation_window' : lower.includes('threshold') || lower.includes('bad logon') ? 'lockout_threshold' : undefined);
  if (!metric) return undefined;
  const phrase = isPassword
    ? (metric === 'password_hist_len' ? 'password history' : metric === 'min_passwd_age' ? 'minimum password age' : metric === 'max_passwd_age' ? 'maximum password age' : metric === 'min_passwd_len' ? 'minimum password length' : metric === 'password_complexity' ? 'password complexity' : 'reversible encryption')
    : (metric === 'lockout_duration' ? 'lockout duration' : metric === 'lockout_observation_window' ? 'observation window' : 'lockout threshold');
  const nearby = text.slice(Math.max(0, lower.indexOf(phrase)));
  const numeric = nearby.match(/\b(\d+(?:\.\d+)?)\s*(seconds?|minutes?|hours?|days?|passwords?|characters?|attempts?)?/i);
  const raw = numeric?.[1]; if (!raw) return undefined;
  let value: Json = Number(raw); const unit = numeric?.[2]?.toLowerCase();
  if (unit?.startsWith('day')) value = Number(raw) * 86400; else if (unit?.startsWith('hour')) value = Number(raw) * 3600; else if (unit?.startsWith('minute')) value = Number(raw) * 60;
  const operation = /at least|minimum|or greater|greater than or equal/i.test(text) ? 'greater_than_or_equal' : /less than|or less|no more than|at most/i.test(text) ? 'less_than_or_equal' : 'equals';
  const capability = isPassword ? 'windows.passwordpolicy' : 'windows.lockoutpolicy';
  return { capability, object: {}, fields: { [metric]: { [operation]: value } }, confidence: 'medium', assumptions: [`Inferred ${capability} and ${metric} from the policy language and numeric threshold.`] };
}
function textFileContentCandidate(text: string): Candidate | undefined {
  const command = text.match(/\b(?:grep|egrep)\s+(?:-[A-Za-z]+\s+)?([A-Za-z][A-Za-z0-9_.-]*)\s+(\/[^\s,;:)]+)/i);
  const line = text.match(/\b([A-Za-z][A-Za-z0-9_.-]*)\s*=\s*([A-Za-z0-9_.+-]+)/);
  const key = command?.[1] ?? line?.[1];
  const path = command?.[2] ?? text.match(/(?:^|\s)(\/(?:etc|var|usr|opt|home|root|srv)\/[A-Za-z0-9_./-]+)/)?.[1];
  if (!key || !path || !/(?:grep|egrep|text file|configuration file|config file|line)/i.test(text)) return undefined;
  const lineValue = line?.[1] === key ? line[2] : undefined;
  const alternatives = new Set<string>(); if (lineValue) alternatives.add(lineValue);
  const valuePhrase = text.match(new RegExp(escapeRegex(key) + String.raw`[^.\n]{0,120}?(?:set to|value of|equals?)\s+["']?([A-Za-z0-9_.+-]+)`, 'i'))?.[1];
  if (valuePhrase) alternatives.add(valuePhrase);
  for (const value of text.matchAll(/\b(?:True|False|true|false|yes|no|enabled|disabled)\b/g)) alternatives.add(value[0]);
  if (!alternatives.size) return undefined;
  const escaped = [...alternatives].map(escapeRegex);
  const pattern = String.raw`^\s*${escapeRegex(key)}\s*=\s*(\w+)\b\s*$`;
  const fields = { subexpression: { matches_regex: `^(${escaped.join('|')})$` } };
  const object = {
    full_path: { equals: path }, pattern: { matches_regex: pattern }, instance: { greater_than_or_equal: 1 },
    ignore_case: false, multiline: true, singleline: false, item_creation: 'all_object_elements_fullfilled', filesystem: 'all'
  } as Record<string, Json>;
  return { capability: 'independent.textfilecontent', object, fields, confidence: lineValue ? 'high' : 'medium', assumptions: ['Inferred a text-file content Object from the command, configuration path, and key/value line.', 'Review the generated regular expression and accepted values against the original check.'] };
}
function shellCommandCandidate(text: string): Candidate | undefined {
  const commandStart = '(?:Get-|Set-|Test-|Invoke-|Start-|Stop-|Select-|Where-|ForEach-|AuditPol\\b|dsquery\\b|dsmgmt\\b|netstat\\b|ss\\b|iptables\\b|firewall-cmd\\b|openssl\\b|kubectl\\b|Get-WinEvent\\b)';
  const quoted = text.match(new RegExp('[\"\'`](' + commandStart + '[^\"\'`\\n]*)[\"\'`]', 'i'))?.[1];
  const prompt = text.match(new RegExp('(?:^|\\n|\\$\\s*)(?:(?:sudo|env)\\s+)?(' + commandStart + '[^\\n.;]*)', 'i'))?.[1]?.trim();
  const command = quoted?.trim() ?? prompt;
  if (!command || !/(?:command prompt|powershell|shell|command line|run|enter|AuditPol|Get-|Test-|Invoke-|dsquery|system command)/i.test(text)) return undefined;
  const shell = /^(?:Get-|Set-|Test-|Invoke-|Start-|Stop-|Select-|Where-|ForEach-|AuditPol|dsquery|dsmgmt|Get-WinEvent)/i.test(command) ? 'powershell' : 'bash';
  const object: Record<string, Json> = { shell, command, error_if_exit_status_not_0: false, error_if_stderr_exists: false };
  return { capability: 'independent.shellcommand', object, presenceOnly: true, confidence: quoted ? 'medium' : 'low', assumptions: ['Inferred a shell command Object from an explicitly pasted command.', 'The generated draft checks command collection only; command semantics and output predicates require author review.'] };
}
function unixFileCandidate(text: string): Candidate | undefined {
  const path = text.match(/(?:^|\s)(\/(?:etc|var|usr|opt|home|bin|sbin|boot|tmp|root)\/[A-Za-z0-9_./-]+)/)?.[1];
  if (!path || !/(?:file|directory|folder|permission|mode|owner|group|path)/i.test(text)) return undefined;
  return { capability: 'unix.file', object: { full_path: { equals: path }, filesystem: 'all' }, confidence: 'medium', assumptions: ['Inferred a Unix file Object from an absolute path and file/permission language.', 'The expected file state still needs author review.'] };
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

function candidateFor(input: AssistedDraftInput, pack: MetadataPack): Candidate | undefined {
  const text = input.checkText;
  return auditEventCandidate(text) ?? registryCandidate(text) ?? userRightCandidate(text, pack) ?? sysctlCandidate(text) ?? systemdCandidate(text) ?? policyCandidate(text) ?? textFileContentCandidate(text) ?? shellCommandCandidate(text) ?? unixFileCandidate(text) ?? packageCandidate(text);
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
  const complete = candidate.presenceOnly || Object.keys(candidate.object).length === 0 || required.some(branch => branch.fields.every(field => Object.hasOwn(candidate.object, field)));
  if (!complete) {
    return manualDraft(pack, { title, checkText }, 'low', candidate.assumptions, ['The inferred Object does not satisfy a complete schema-required selector branch.']);
  }
  const testCandidates = candidate.testCandidates ?? [{ title, fields: candidate.fields ?? {} }];
  const generated = createGuidedAssessment(pack, {
    platform: firstPlatform(pack), id: slug(title, 'assessment'), title,
    mode: 'automated', className: firstClass(pack), evaluate: candidate.evaluate,
    tests: testCandidates.map((test, index) => ({
      id: candidate.testCandidates ? slug(`${title.slice(0, 42)}-${index + 1}`, 'test') : slug(title, 'test'), title: test.title, capability: candidate.capability,
      object: candidate.object, fields: test.fields, presenceOnly: test.presenceOnly ?? candidate.presenceOnly ?? false
    }))
  });
  if (generated.diagnostics.length) {
    return manualDraft(pack, { title, checkText }, 'low', candidate.assumptions, [
      `The best automated guess failed pinned schema validation: ${generated.diagnostics.join('; ')}`
    ]);
  }
  const unresolved = candidate.testCandidates || candidate.fields ? ['Confirm the inferred capability, selectors, datatype, and expected value against the original STIG.'] : ['Add the expected field predicate(s); this draft currently checks only Item presence.'];
  const notes = annotation({ title, checkText }, candidate.confidence, candidate.assumptions, unresolved);
  return { ...generated, yaml: `${notes}\n${generated.yaml}`, confidence: candidate.confidence, assumptions: candidate.assumptions, unresolved, generatedMode: 'automated' };
}
