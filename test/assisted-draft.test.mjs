import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';
import { MetadataPack } from '../dist/metadata.js';
import { createAssistedAssessment } from '../dist/assisted-draft.js';

const pack = new MetadataPack('.external/editor-pack', JSON.parse(readFileSync('schema-profile.json', 'utf8')));

test('assisted registry draft is deterministic, annotated, and pinned-schema valid', () => {
  const result = createAssistedAssessment(pack, {
    title: 'Prevent lock screen slide show',
    checkText: 'Set the registry value "NoLockScreenSlideshow" under HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Windows\\Personalization to 1.'
  });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
  assert.match(result.yaml, /best guess only/);
  assert.equal(result.document.assessment.tests['prevent-lock-screen-slide-show-test'].capability, 'windows.registry');
  assert.equal(result.document.assessment.tests['prevent-lock-screen-slide-show-test'].require.fields.value.equals, 1);
  assert.deepEqual(parseDocument(result.yaml).errors, []);
});

test('assisted fallback produces a schema-valid manual procedure instead of inventing automation', () => {
  const checkText = 'Review the supplied evidence and confirm the requirement with the system owner.';
  const result = createAssistedAssessment(pack, { title: 'Unrecognized requirement', checkText });
  assert.equal(result.generatedMode, 'manual');
  assert.equal(result.confidence, 'low');
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.document.assessment.procedure, checkText);
  assert.match(result.yaml, /No supported automated selector pattern/);
});

test('assisted AuditPol rule prefers the native Windows audit capability over manual mode', () => {
  const result = createAssistedAssessment(pack, {
    title: 'The system must be configured to audit Policy Change - Authorization Policy Change successes.',
    checkText: 'Security Option "Audit: Force audit policy subcategory settings to override audit policy category settings" must be set to "Enabled" (WN11-SO-000030) for the detailed auditing subcategories to be effective.\n\nUse the AuditPol tool to review the current Audit Policy configuration:\n-Open a Command Prompt with elevated privileges ("Run as Administrator").\n-Enter "AuditPol /get /category:*".\n\nCompare the AuditPol settings with the following. If the system does not audit the following, this is a finding.\n\nPolicy Change &gt;&gt; Authorization Policy Change - Success'
  });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.confidence, 'high');
  assert.equal(result.diagnostics.length, 0);
  const tests = Object.values(result.document.assessment.tests);
  assert.equal(tests.length, 2);
  assert.ok(tests.every(test => test.capability === 'windows.auditeventpolicysubcategories'));
  assert.deepEqual(result.document.assessment.evaluate, { or: tests.map(test => ({ test: Object.keys(result.document.assessment.tests).find(id => result.document.assessment.tests[id] === test) })) });
  assert.equal(tests[0].require.fields.authorization_policy_change.equals, 'AUDIT_SUCCESS');
  assert.equal(tests[1].require.fields.authorization_policy_change.equals, 'AUDIT_SUCCESS_FAILURE');
});

test('assisted labeled Windows registry input infers hive, path, value name, type, and value', () => {
  const result = createAssistedAssessment(pack, {
    title: 'The system must enforce the network selection policy.',
    checkText: `If the following registry value does not exist or is not configured as specified, this is a finding:\n\nRegistry Hive: HKEY_LOCAL_MACHINE\nRegistry Path: \\SOFTWARE\\Policies\\Microsoft\\Windows\\System\\\n\nValue Name: DontDisplayNetworkSelectionUI\n\nValue Type: REG_DWORD\nValue: 1`
  });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
  const test = Object.values(result.document.assessment.tests)[0];
  assert.equal(test.capability, 'windows.registry');
  assert.equal(test.object.hive.equals, 'local_machine');
  assert.equal(test.object.key.equals, 'SOFTWARE\\Policies\\Microsoft\\Windows\\System');
  assert.equal(test.object.name.equals, 'DontDisplayNetworkSelectionUI');
  assert.equal(test.require.fields.type.equals, 'dword');
  assert.equal(test.require.fields.value.equals, 1);
});

test('assisted common command and policy patterns stay native and schema-valid', () => {
  const cases = [
    ['unix.sysctl', 'Restrict kernel pointers', 'Run: $ sudo sysctl kernel.kptr_restrict kernel.kptr_restrict = 1'],
    ['linux.rpminfo', 'Package must not be installed', 'Verify with: $ dnf list --installed vsftpd Error: No matching Packages to list'],
    ['linux.systemdunitproperty', 'Service must be active', 'Verify with: $ systemctl is-active systemd-journald active'],
    ['windows.passwordpolicy', 'Password history must be 24', 'If Enforce password history is less than 24 passwords remembered, this is a finding.'],
    ['independent.textfilecontent', 'Configuration must be enabled', 'Verify with: $ grep localpkg_gpgcheck /etc/dnf/dnf.conf localpkg_gpgcheck=1 If localpkg_gpgcheck is not set to 1 or True, this is a finding.'],
    ['independent.shellcommand', 'Directory memberships must be reviewed', 'Open PowerShell and enter "Get-ADGroupMember -Identity EnterpriseAdmins".']
  ];
  for (const [capability, title, checkText] of cases) {
    const result = createAssistedAssessment(pack, { title, checkText });
    assert.equal(result.generatedMode, 'automated', capability);
    assert.equal(result.diagnostics.length, 0, capability);
    assert.ok(Object.values(result.document.assessment.tests).some(test => test.capability === capability), capability);
  }
});
