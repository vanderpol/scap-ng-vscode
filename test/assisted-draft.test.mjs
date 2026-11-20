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

test('assisted draft can infer its title and test summary from check text', () => {
  const checkText = 'Set the registry value "NoLockScreenSlideshow" under HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Microsoft\\Windows\\Personalization to 1.';
  const result = createAssistedAssessment(pack, { checkText });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.document.assessment.assessment_title, checkText);
  const test = Object.values(result.document.assessment.tests)[0];
  assert.match(test.test_title, /^Check .*Windows Registry/);
  assert.match(result.yaml, /No Rule title was supplied/);
});

test('assisted registry alternatives preserve paths and minimum-value semantics', () => {
  const checkText = String.raw`If the registry value is not configured as specified, this is a finding.

Registry Hive: HKEY_LOCAL_MACHINE
Registry Path: \SOFTWARE\Policies\Microsoft\PassportForWork\PINComplexity\  (For GPO-managed systems)
Or
Registry Path: \SOFTWARE\Microsoft\Policies\PassportForWork\[guid]\device\policies\PINComplexity  (For Intune-managed systems)

Value Name: MinimumPINLength

Type: REG_DWORD
Value: 6 (or greater)`;
  const result = createAssistedAssessment(pack, { checkText });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.confidence, 'medium');
  const tests = Object.values(result.document.assessment.tests);
  assert.equal(tests.length, 2);
  assert.ok(result.document.assessment.evaluate.if);
  assert.equal(result.document.assessment.evaluate.else_if.length, 1);
  assert.ok(result.document.assessment.evaluate.else.not_evaluated);
  assert.equal(Object.keys(result.document.assessment.dependencies).length, 2);
  assert.equal(tests[0].object.key.equals, 'SOFTWARE\\Policies\\Microsoft\\PassportForWork\\PINComplexity');
  assert.equal(tests[1].object.key.equals, 'SOFTWARE\\Microsoft\\Policies\\PassportForWork\\[guid]\\device\\policies\\PINComplexity');
  assert.deepEqual(tests[0].require.fields.value, { greater_than_or_equal: 6 });
  assert.deepEqual(tests[0].require.fields.type, { equals: 'dword' });
  assert.match(result.yaml, /placeholder such as \[guid\]/);
  assert.doesNotMatch(result.yaml, /&a\d+|\*a\d+/);
});

test('assisted draft unwraps a previously generated annotated draft before reprocessing', () => {
  const pastedDraft = `# Assisted Assessment draft — best guess only; review before use.
# Source check text (preserved for review):
# # Assisted Assessment draft — best guess only; review before use.
# # Source check text (preserved for review):
# # Registry Hive: HKEY_LOCAL_MACHINE
# # Registry Path: \SOFTWARE\Policies\Microsoft\PassportForWork\PINComplexity
# # Value Name: MinimumPINLength
# # Type: REG_DWORD
# # Value: 6 (or greater)
# assessment:
#   id: old-draft-assessment
assessment:
  id: outer-draft-assessment`;
  const result = createAssistedAssessment(pack, { checkText: pastedDraft });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.document.assessment.assessment_title, 'Windows registry setting MinimumPINLength');
  assert.match(result.yaml, /previous Assisted Assessment draft/);
  assert.match(result.yaml, /greater_than_or_equal/);
  assert.doesNotMatch(result.yaml, /old-draft-assessment/);
  assert.doesNotMatch(result.document.assessment.id, /best-guess/);
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

test('assisted firewall fallback procedures stay manual when applicability and policy are organization-specific', () => {
  const result = createAssistedAssessment(pack, {
    platform: 'rhel',
    title: 'The access control program must grant or deny access to specific hosts and services.',
    checkText: `If the "firewalld" package is not installed, ask the System Administrator (SA) if another firewall application such as iptables is installed. If an application firewall is not installed, this is a finding.

Check to see if firewalld is active with systemctl status firewalld.

If firewalld is not active, determine whether tcpwrappers is being used by checking /etc/hosts.allow and /etc/hosts.deny.

If firewalld and tcpwrappers are not installed, configured, and active, ask the SA if another access control program is installed and active.`
  });
  assert.equal(result.generatedMode, 'manual');
  assert.equal(result.confidence, 'low');
  assert.ok(result.unresolved.some(reason => /multi-branch|organization-specific|applicability/i.test(reason)));
  assert.doesNotMatch(result.yaml, /capability: linux\.systemdunitproperty/);
});

test('assisted common command and policy patterns stay native and schema-valid', () => {
  const cases = [
    ['unix.sysctl', 'Restrict kernel pointers', 'Run: $ sudo sysctl kernel.kptr_restrict kernel.kptr_restrict = 1'],
    ['linux.rpminfo', 'Package must not be installed', 'Verify with: $ dnf list --installed vsftpd Error: No matching Packages to list'],
    ['linux.systemdunitproperty', 'Service must be active', 'Verify with: $ systemctl is-active systemd-journald active'],
    ['windows.passwordpolicy', 'Password history must be 24', 'If Enforce password history is less than 24 passwords remembered, this is a finding.'],
    ['independent.textfilecontent', 'Configuration must be enabled', 'Verify with: $ grep localpkg_gpgcheck /etc/dnf/dnf.conf localpkg_gpgcheck=1 If localpkg_gpgcheck is not set to 1 or True, this is a finding.'],
  ];
  for (const [capability, title, checkText] of cases) {
    const result = createAssistedAssessment(pack, { title, checkText });
    assert.equal(result.generatedMode, 'automated', capability);
    assert.equal(result.diagnostics.length, 0, capability);
    assert.ok(Object.values(result.document.assessment.tests).some(test => test.capability === capability), capability);
  }
});

test('assisted Unix presence checks remain native and schema-valid', () => {
  const result = createAssistedAssessment(pack, {
    title: 'The Unix passwd file must be present.',
    checkText: 'Verify that the file /etc/passwd is present on the system.'
  });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
  const test = Object.values(result.document.assessment.tests)[0];
  assert.equal(test.capability, 'unix.file');
  assert.equal(test.require.item_requirement.items_found, 'one_or_more');
});

test('package-manager checks take precedence over generic Unix path matching', () => {
  const result = createAssistedAssessment(pack, {
    title: 'Package signing keys must be installed.',
    checkText: 'Run rpm -q gpg-pubkey --qf "%{NAME}-%{VERSION}-%{RELEASE}" and verify the package is installed.'
  });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
  const test = Object.values(result.document.assessment.tests)[0];
  assert.equal(test.capability, 'linux.rpminfo');
  assert.equal(test.object.package_name.equals, 'gpg-pubkey');
});

test('registry presence-only checks serialize a valid Item requirement', () => {
  const result = createAssistedAssessment(pack, {
    title: 'The browser policy registry value must be present.',
    checkText: 'Registry Hive: HKEY_LOCAL_MACHINE\nRegistry Path: \\Software\\Policies\\Example\nValue Name: ExamplePolicy\nThe value must be present.'
  });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
  const test = Object.values(result.document.assessment.tests)[0];
  assert.equal(test.capability, 'windows.registry');
  assert.deepEqual(test.require, { item_requirement: { items_found: 'one_or_more' } });
});

test('assisted command families use native capabilities when the pinned contract supports them', () => {
  const cases = [
    ['linux.systemdunitproperty', 'Service inactive', 'Run systemctl is-active kdump.service\ninactive If the service is active, this is a finding.'],
    ['windows.service', 'Windows service state', 'Run sc query W32Time.\n STATE : 4 RUNNING'],
    ['windows.file', 'Windows file exists', 'Run icacls C:\\Windows\\System32\\foo.exe and verify file permissions.'],
    ['linux.partition', 'Mount option', 'mount | grep /dev/shm\ntmpfs on /dev/shm type tmpfs (rw,nodev,nosuid)\nThe mount must use the nodev option.'],
    ['linux.kernelmodule', 'Kernel module', 'lsmod | grep usb-storage\nThe module must not be loaded.'],
    ['linux.selinuxboolean', 'SELinux boolean', 'getsebool allow_execmem --> off'],
    ['linux.sestatus', 'SELinux mode', 'getenforce\nEnforcing']
  ];
  for (const [capability, title, checkText] of cases) {
    const result = createAssistedAssessment(pack, { title, checkText });
    assert.equal(result.generatedMode, 'automated', capability);
    assert.equal(result.diagnostics.length, 0, capability);
    assert.ok(Object.values(result.document.assessment.tests).some(test => test.capability === capability), capability);
  }
});

test('assisted shell fallback preserves explicit complex command collection without claiming predicates', () => {
  const result = createAssistedAssessment(pack, {
    title: 'Audit rules must be configured',
    checkText: 'Verify with: $ sudo auditctl -l | grep /etc/sudoers -w /etc/sudoers -p wa'
  });
  assert.equal(result.generatedMode, 'manual');
  assert.equal(Object.keys(result.document.assessment.tests ?? {}).length, 0);
  assert.match(result.yaml, /no reliable output predicate|collecting command output alone/i);
});

test('assisted draft preserves a selected shared applicability dependency', () => {
  const result = createAssistedAssessment(pack, {
    title: 'Domain registry policy',
    checkText: 'Registry Hive: HKEY_LOCAL_MACHINE\nRegistry Path: \\Software\\Policies\\Example\nValue Name: ExamplePolicy\nValue Type: REG_DWORD\nValue: 0',
    applicability: { alias: 'domain-joined', assessmentId: 'windows-domain-joined-applicability-assessment', expectedVersion: 1 }
  });
  assert.equal(result.generatedMode, 'automated');
  assert.deepEqual(result.document.assessment.applicability, { assessment: 'domain-joined' });
  assert.deepEqual(result.document.assessment.dependencies['domain-joined'], { assessment: 'windows-domain-joined-applicability-assessment', expected_version: 1, purpose: 'applicability' });
  assert.deepEqual(result.diagnostics, []);
});

test('assisted Windows privilege aliases beat placeholder export paths', () => {
  const result = createAssistedAssessment(pack, {
    title: 'The Windows Server 2025 "Increase scheduling priority" user right must only be assigned to Administrators.',
    checkText: 'Run Secedit /Export /Areas User_Rights /cfg c:\\path\\filename.txt and review the Increase scheduling priority user right.'
  });
  assert.equal(result.generatedMode, 'automated');
  const test = Object.values(result.document.assessment.tests)[0];
  assert.equal(test.capability, 'windows.userright');
  assert.equal(test.object.userright.equals, 'SE_INC_BASE_PRIORITY_NAME');
});

test('assisted Windows feature and certificate absence checks preserve native negative cardinality', () => {
  const feature = createAssistedAssessment(pack, {
    title: 'The Microsoft FTP service must not be installed.',
    checkText: 'Enter "Get-WindowsFeature | Where Name -eq Web-Ftp-Service". If Installed State is Installed, this is a finding.'
  });
  assert.equal(feature.generatedMode, 'automated');
  assert.equal(Object.values(feature.document.assessment.tests)[0].capability, 'windows.wmi.query');
  assert.equal(Object.values(feature.document.assessment.tests)[0].require.item_requirement.items_found, 'none');
  const cert = createAssistedAssessment(pack, {
    title: 'Software certificate installation files must be removed.',
    checkText: 'Search all drives for *.p12 and *.pfx files. If any files exist, this is a finding.'
  });
  assert.equal(cert.generatedMode, 'automated');
  const tests = Object.values(cert.document.assessment.tests);
  assert.equal(tests.length, 2);
  assert.ok(tests.every(test => test.capability === 'windows.file' && test.require.item_requirement.items_found === 'none'));
});

test('assisted Linux ownership and audit wording avoids Windows policy inference', () => {
  const result = createAssistedAssessment(pack, {
    title: 'RHEL 9 /etc/gshadow file must be owned by root.',
    checkText: 'Verify the file /etc/gshadow is owned by root with stat -c "%U %n" /etc/gshadow.'
  });
  assert.equal(result.generatedMode, 'automated');
  const test = Object.values(result.document.assessment.tests)[0];
  assert.equal(test.capability, 'unix.file');
  assert.equal(test.require.fields.owner_uid.equals, 0);
  const audit = createAssistedAssessment(pack, {
    title: 'Windows must audit sensitive privilege use failures.',
    checkText: 'If "Audit Sensitive Privilege Use" is not set to "Failure", this is a finding.'
  });
  assert.equal(audit.generatedMode, 'automated');
  assert.ok(Object.values(audit.document.assessment.tests).every(test => test.capability === 'windows.auditeventpolicysubcategories'));
});

test('assisted Ubuntu context maps package, audit, and password checks to native capabilities', () => {
  const packageDraft = createAssistedAssessment(pack, {
    platform: 'ubuntu',
    title: 'Ubuntu 24.04 LTS must have the auditd package installed.',
    checkText: 'Verify the auditd package is installed.'
  });
  assert.equal(Object.values(packageDraft.document.assessment.tests)[0].capability, 'linux.dpkginfo');
  const auditDraft = createAssistedAssessment(pack, {
    platform: 'ubuntu',
    title: 'Ubuntu 24.04 LTS must generate audit records for uses of passwd.',
    checkText: 'Review the audit configuration for the required passwd events.'
  });
  assert.equal(auditDraft.generatedMode, 'manual');
  const passwordDraft = createAssistedAssessment(pack, {
    platform: 'ubuntu',
    title: 'Ubuntu 24.04 LTS must enforce password complexity requiring a numeric character.',
    checkText: 'Verify the password quality policy requires at least one numeric character.'
  });
  assert.equal(passwordDraft.generatedMode, 'manual');
});

test('assisted Solaris context maps release, file, and audit checks to native capabilities', () => {
  const releaseDraft = createAssistedAssessment(pack, {
    platform: 'solaris',
    title: 'The operating system must be a supported release.',
    checkText: 'Verify that the installed Solaris release is supported.'
  });
  assert.equal(releaseDraft.generatedMode, 'manual');
  const fileDraft = createAssistedAssessment(pack, {
    platform: 'solaris',
    title: 'User .netrc files must not exist.',
    checkText: 'Search user home directories for .netrc files.'
  });
  assert.equal(fileDraft.generatedMode, 'manual');
  const auditDraft = createAssistedAssessment(pack, {
    platform: 'solaris',
    title: 'The audit system must be configured to audit account creation.',
    checkText: 'Review Solaris audit configuration and verify account creation is audited.'
  });
  assert.equal(auditDraft.generatedMode, 'manual');
});

test('assisted Office and Chrome contexts select the application policy collectors', () => {
  const office = createAssistedAssessment(pack, {
    platform: 'office365',
    title: 'Macros must be blocked from running in Excel files from the Internet.',
    checkText: 'Verify the Office macro policy is configured as required.'
  });
  assert.equal(office.generatedMode, 'manual');
  const officeMachine = createAssistedAssessment(pack, {
    platform: 'office365',
    title: 'The Information Bar must be enabled in all Office programs.',
    checkText: 'Verify the machine-wide Office policy.'
  });
  assert.equal(officeMachine.generatedMode, 'manual');
  const chrome = createAssistedAssessment(pack, {
    platform: 'chrome',
    title: 'Chrome development tools must be disabled.',
    checkText: 'Verify the Chrome enterprise policy.'
  });
  assert.equal(chrome.generatedMode, 'manual');
});

test('assisted Firefox contexts distinguish registry, profile-variable, and text checks', () => {
  const registry = createAssistedAssessment(pack, {
    platform: 'firefox-windows',
    title: 'Firefox private browsing must be disabled.',
    checkText: 'Verify the Firefox enterprise policy.'
  });
  assert.equal(registry.generatedMode, 'manual');
  const variable = createAssistedAssessment(pack, {
    platform: 'firefox-windows',
    title: 'Firefox must be configured to prevent JavaScript from moving or resizing windows.',
    checkText: 'Verify the Firefox profile preference.'
  });
  assert.equal(variable.generatedMode, 'manual');
  const text = createAssistedAssessment(pack, {
    platform: 'firefox-linux',
    title: 'Firefox must be configured to not automatically execute or download MIME types.',
    checkText: 'Verify the Firefox profile handler configuration.'
  });
  assert.equal(text.generatedMode, 'manual');
});


test('assisted SLES context maps Linux policy families to converted native capabilities', () => {
  const audit = createAssistedAssessment(pack, {
    platform: 'sles15',
    title: 'The SUSE operating system must generate audit records for all uses of the crontab command.',
    checkText: 'Verify the SLES audit rule for crontab.'
  });
  assert.equal(audit.generatedMode, 'manual');
  const sysctl = createAssistedAssessment(pack, {
    platform: 'sles12',
    title: 'The SUSE operating system must implement kptr-restrict.',
    checkText: 'Verify the kernel sysctl value.'
  });
  assert.equal(sysctl.generatedMode, 'manual');
  const packageCheck = createAssistedAssessment(pack, {
    platform: 'sles15',
    title: 'The SUSE operating system must not have the vsftpd package installed.',
    checkText: 'Verify that vsftpd is not installed.'
  });
  assert.equal(packageCheck.generatedMode, 'manual');
});

test('assisted benchmark family context selects native collectors for obscure remaining STIGs', () => {
  const mac = createAssistedAssessment(pack, {
    platform: 'macos', title: 'The macOS system must disable Handoff.', checkText: 'Verify the macOS setting.'
  });
  assert.equal(mac.generatedMode, 'manual');
  const cisco = createAssistedAssessment(pack, {
    platform: 'cisco_ios-xe', title: 'The Cisco router must be configured to display the security banner.', checkText: 'Verify the device configuration.'
  });
  assert.equal(cisco.generatedMode, 'manual');
  const iis = createAssistedAssessment(pack, {
    platform: 'iis_site', title: 'Cookies exchanged between the IIS website and the client must have cookie properties set to prohibit client-side scripts from reading the cookie data.', checkText: 'Verify the IIS site configuration.'
  });
  assert.equal(iis.generatedMode, 'manual');
});

test('automation procedure cleanup removes converter OCIL wrapper boilerplate but preserves check content', async () => {
  const { cleanProcedureForAutomation } = await import('../dist/assisted-draft.js');
  const source = `Manual alternative preserved from the original OCIL check. Follow the source procedure; this Assessment does not execute OCIL.\n\nComplete the source OCIL procedure and record the result.\n\nManual alternative preserved from the original OCIL check. Follow the source procedure; this Assessment does not execute OCIL.\n\nVerify the setting with:\n\n$ grep -i remember /etc/pam.d/common-password\n\nIf remember is less than 5, this is a finding.`;
  const cleaned = cleanProcedureForAutomation(source);
  assert.doesNotMatch(cleaned, /source OCIL|Manual alternative preserved/i);
  assert.match(cleaned, /grep -i remember/);
  assert.match(cleaned, /this is a finding/);
});

test('assisted interactive initialization ownership checks stay manual until foreach relationships are supported', () => {
  const result = createAssistedAssessment(pack, {
    platform: 'rhel9',
    title: 'The Red Hat Enterprise Linux operating system must be configured so that all local initialization files for interactive users are owned by the home directory user or root.',
    checkText: `Verify the local initialization files of all local interactive users are owned by that user.

Check the home directory assignment for all nonprivileged users on the system with the following command:

# awk -F: '($3>=1000)&&($7 !~ /nologin/){print $1, $3, $6}' /etc/passwd

Check the owner of all local interactive users' initialization files with the following command:

# ls -al /home/smithj/.[^.]* | more

If all local interactive users' initialization files are not owned by that user or root, this is a finding.`
  });
  assert.equal(result.generatedMode, 'manual');
  assert.equal(result.confidence, 'low');
  assert.ok(result.unresolved.some(reason => /per-user|foreach|relationship/i.test(reason)));
  assert.equal(Object.keys(result.document.assessment.tests ?? {}).length, 0);
  assert.doesNotMatch(result.yaml, /capability:\s*unix\.file/);
});

test('assisted RHEL nmcli wireless checks infer a filtered absence test and preserve exceptions', () => {
  const result = createAssistedAssessment(pack, {
    platform: 'rhel',
    title: 'The Red Hat Enterprise Linux operating system must be configured so that all wireless network adapters are disabled.',
    checkText: `Verify that there are no wireless interfaces configured on the system.

This is N/A for systems that do not have wireless network adapters.

Check for the presence of active wireless interfaces with the following command:

# nmcli device
DEVICE TYPE STATE
eth0 ethernet connected
wlp3s0 wifi disconnected
lo loopback unmanaged

If a wireless interface is configured and its use on the system is not documented with the Information System Security Officer (ISSO), this is a finding.`
  });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.confidence, 'medium');
  assert.equal(result.diagnostics.length, 0);
  const test = Object.values(result.document.assessment.tests)[0];
  assert.equal(test.capability, 'independent.shellcommand');
  assert.equal(test.object.command, 'nmcli device');
  assert.match(test.object.pattern, /\[Ww\].*\[Ii\].*\[Ff\].*\[Ii\]/);
  assert.equal(test.require.item_requirement.items_found, 'one_or_more');
  assert.deepEqual(test.require.fields.stdout_line, { values_found: 'none' });
  assert.ok(result.unresolved.some(reason => /ISSO|organizational approval/i.test(reason)));
  assert.doesNotMatch(result.yaml, /text file \(presence check\)/i);
});

test('assisted package-gated configuration checks generate an applicability branch', () => {
  const result = createAssistedAssessment(pack, {
    platform: 'rhel',
    title: 'The TFTP daemon must operate in secure mode if the TFTP server is required.',
    checkText: `Verify the TFTP daemon is configured to operate in secure mode.

Check to see if a TFTP server has been installed with the following commands:

# yum list installed tftp-server
tftp-server.x86_64 x.x-x.el7 rhel-7-server-rpms

If a TFTP server is not installed, this is Not Applicable.

If a TFTP server is installed, check for the server arguments with the following command:

# grep server_args /etc/xinetd.d/tftp
server_args = -s /var/lib/tftpboot

If the "server_args" line does not have a "-s" option and a subdirectory is not assigned, this is a finding.`
  });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.diagnostics.length, 0);
  const assessment = result.document.assessment;
  const test = Object.values(assessment.tests)[0];
  assert.equal(test.capability, 'independent.textfilecontent');
  assert.ok(assessment.dependencies['applicability-tftp-server-installed']);
  assert.equal(assessment.dependencies['applicability-tftp-server-installed'].purpose, 'applicability');
  assert.equal(assessment.evaluate.if.assessment, 'applicability-tftp-server-installed');
  assert.equal(assessment.evaluate.then.test, test.id ?? Object.keys(assessment.tests)[0]);
  assert.equal(Object.hasOwn(assessment.evaluate, 'else_if'), false);
  assert.match(assessment.evaluate.else.not_evaluated.reason, /tftp-server.*Not Applicable/i);
  assert.deepEqual(test.require.fields.subexpression, { matches_regex: '^(-s)$' });
  assert.ok(result.assumptions.some(reason => /applicability Assessment placeholder/i.test(reason)));
});

test('assisted package-gated postconf checks preserve applicability and allowed-list logic', () => {
  const result = createAssistedAssessment(pack, {
    platform: 'rhel',
    title: 'The system must prevent unrestricted mail relaying.',
    checkText: `Verify the system is configured to prevent unrestricted mail relaying.

Determine if "postfix" is installed with the following commands:

# yum list installed postfix
postfix-2.6.6-6.el7.x86_64.rpm

If postfix is not installed, this is Not Applicable.

If postfix is installed, determine if it is configured to reject connections from unknown or untrusted networks with the following command:

# postconf -n smtpd_client_restrictions
smtpd_client_restrictions = permit_mynetworks, reject

If the "smtpd_client_restrictions" parameter contains any entries other than "permit_mynetworks" and "reject", this is a finding.`
  });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.confidence, 'medium');
  assert.equal(result.diagnostics.length, 0);
  const assessment = result.document.assessment;
  const test = Object.values(assessment.tests)[0];
  assert.equal(test.capability, 'independent.shellcommand');
  assert.equal(test.object.command, 'postconf -n smtpd_client_restrictions');
  assert.match(test.object.pattern, /smtpd_client_restrictions/);
  assert.match(test.require.fields.subexpression.matches_regex, /permit_mynetworks/);
  assert.match(test.require.fields.subexpression.matches_regex, /reject/);
  assert.equal(assessment.evaluate.if.assessment, 'applicability-postfix-installed');
  assert.equal(assessment.dependencies['applicability-postfix-installed'].purpose, 'applicability');
  assert.equal(assessment.evaluate.then.test, Object.keys(assessment.tests)[0]);
  assert.match(assessment.evaluate.else.not_evaluated.reason, /postfix.*Not Applicable/i);
});

test('assisted RHEL find nogroup checks preserve the command and generate an absence test', () => {
  const result = createAssistedAssessment(pack, {
    platform: 'rhel',
    title: 'The Red Hat Enterprise Linux operating system must be configured so that all files and directories have a valid group owner.',
    checkText: `Verify all files and directories on the system have a valid group.

Check the owner of all files and directories with the following command:

# find / -fstype xfs -nogroup

If any files on the system do not have an assigned group, this is a finding.`
  });
  assert.equal(result.generatedMode, 'automated');
  assert.equal(result.confidence, 'medium');
  assert.equal(result.diagnostics.length, 0);
  const test = Object.values(result.document.assessment.tests)[0];
  assert.equal(test.capability, 'independent.shellcommand');
  assert.equal(test.object.command, 'find / -fstype xfs -nogroup');
  assert.equal(test.require.item_requirement.items_found, 'one_or_more');
  assert.deepEqual(test.require.fields.stdout_line, { values_found: 'none' });
  assert.ok(result.unresolved.some(reason => /example|filesystem type/i.test(reason)));
  assert.doesNotMatch(result.yaml, /object:\s*\{\}/);
});

test('assisted drafts refuse selectorless placeholder automation', () => {
  const result = createAssistedAssessment(pack, {
    platform: 'rhel',
    title: 'The operating system must enforce an unrecognized configuration policy.',
    checkText: 'Verify the configuration and confirm the required policy is enabled.'
  });
  assert.equal(result.generatedMode, 'manual');
  assert.equal(Object.keys(result.document.assessment.tests ?? {}).length, 0);
  assert.match(result.yaml, /no empty-object automated draft was emitted/i);
  assert.doesNotMatch(result.yaml, /object:\s*\{\}/);
});

test('assisted RHEL audit, account, and graphical procedures preserve concrete command predicates', () => {
  const audit = createAssistedAssessment(pack, {
    platform: 'rhel',
    title: 'The system must audit use of semanage.',
    checkText: '# sudo grep -w "/usr/sbin/semanage" /etc/audit/audit.rules -a always,exit -F path=/usr/sbin/semanage -F perm=x -F auid>=1000'
  });
  assert.equal(audit.generatedMode, 'automated');
  assert.equal(audit.confidence, 'medium');
  const auditTest = Object.values(audit.document.assessment.tests)[0];
  assert.equal(auditTest.capability, 'independent.shellcommand');
  assert.match(auditTest.object.command, /semanage/);
  assert.equal(auditTest.require.item_requirement.items_found, 'one_or_more');

  const accounts = createAssistedAssessment(pack, {
    platform: 'rhel',
    title: 'Accounts with an invalid shadow entry must be absent.',
    checkText: '# awk -F: \'!$2 {print $1}\' /etc/shadow\nIf the command returns any results, this is a finding.'
  });
  assert.equal(accounts.generatedMode, 'automated');
  const accountTest = Object.values(accounts.document.assessment.tests)[0];
  assert.equal(accountTest.require.item_requirement.items_found, 'one_or_more');
  assert.deepEqual(accountTest.require.fields.stdout_line, { values_found: 'none' });

  const graphical = createAssistedAssessment(pack, {
    platform: 'rhel',
    title: 'The graphical display manager must not be installed unless approved.',
    checkText: '$ systemctl get-default\nmulti-user.target\n$ rpm -qa | grep xorg | grep server'
  });
  assert.equal(graphical.generatedMode, 'automated');
  assert.equal(Object.values(graphical.document.assessment.tests).length, 2);
  assert.ok(graphical.unresolved.some(reason => /ISSO|organizational approval/i.test(reason)));
});

test('assisted text configuration parsing preserves case-insensitive keys and multi-token values', () => {
  const result = createAssistedAssessment(pack, {
    platform: 'rhel',
    title: 'SSH MAC algorithms must be FIPS-approved.',
    checkText: '# grep -i macs /etc/ssh/sshd_config\nMACs hmac-sha2-512,hmac-sha2-256\nIf any other hashes are listed, this is a finding.'
  });
  assert.equal(result.generatedMode, 'automated');
  const test = Object.values(result.document.assessment.tests)[0];
  assert.equal(test.capability, 'independent.textfilecontent');
  assert.equal(test.object.ignore_case, true);
  assert.match(test.object.pattern.matches_regex, /\(\.\+\?\)/);
  assert.match(test.require.fields.subexpression.matches_regex, /hmac-sha2-512/);
});
