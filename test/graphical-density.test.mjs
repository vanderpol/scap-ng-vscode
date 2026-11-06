import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphicalHtml } from '../dist/graphical.js';

test('graphical webview contains syntactically valid JavaScript and source-safe controls', () => {
  const html = graphicalHtml();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'Webview script must exist');
  assert.doesNotThrow(() => new Function(script), 'Webview JS must parse');
  assert.match(html, /vscode\.postMessage\(\{type:'edit'/);
  assert.match(html, /revision:current\.revision,version:current\.version/);
});

test('defaults are explained locally rather than by an opaque global toolbar count', () => {
  const html = graphicalHtml();
  assert.doesNotMatch(html, /id="toggleDefaults"/);
  assert.match(html, /function hiddenFor\(path\)/);
  assert.match(html, /function defaultsSummary\(path\)/);
  assert.match(html, /What is hidden\?/);
  assert.match(html, /Show all fields/);
  assert.match(html, /Simplified/);
  assert.match(html, /All fields/);
  assert.match(html, /No schema defaults are hidden in this section/);
});

test('center inspector is construct-focused and default help is on field focus', () => {
  const html = graphicalHtml();
  assert.match(html, /if\(path\.length===1\)return sectionFields\(path\)/, 'Assessment metadata does not show nested Test values');
  assert.match(html, /function groupedForm\(path\)/);
  assert.match(html, /input\.onfocus=\(\)=>renderHelp\(f\)/);
  assert.doesNotMatch(html, /wrap\.append\(help\)/, 'Long descriptions should not fill each property row');
  assert.match(html, /Technical YAML path/);
  assert.match(html, /function friendlyLabel\(f\)/);
});

test('help panel collapses and contextual actions preserve their node path', () => {
  const html = graphicalHtml();
  assert.match(html, /workspace\.help-collapsed/);
  assert.match(html, /classList\.toggle\('help-collapsed',!helpOpen\)/);
  assert.match(html, /const target=menuPath\?\.slice\(\);hideMenu\(\)/);
  assert.match(html, /action:item\.action,path:testPathForSelection\(target\)\|\|target/);
});

test('simplified/all-fields only rerenders the inspector, never rebuilds the tree', () => {
  const html = graphicalHtml();
  assert.match(html, /function setDefaultsView\(next\)/);
  const block = html.slice(html.indexOf('function setDefaultsView(next)'), html.indexOf('function defaultsSummary(path)'));
  assert.match(block, /renderCenter\(\);renderHelp\(\)/);
  assert.doesNotMatch(block, /renderTree\(\)|render\(current\)|revealPath\(/);
  assert.match(html, /button\.onclick=\(\)=>setDefaultsView\(item\.value\)/);
  assert.match(html, /action\.onclick=\(\)=>setDefaultsView\(!showDefaults\)/);
  assert.match(html, /const objectFields=allFieldsUnder\(object\)/);
  assert.match(html, /\|\|allFieldsUnder\(node\.path\)\.length>0/);
});

test('Test overview preserves Object-vs-Require semantics', () => {
  const html = graphicalHtml();
  assert.match(html, /Object — what to inspect/);
  assert.match(html, /Require — what must be true/);
  assert.match(html, /function semanticCard\(testPath,which\)/);
  assert.match(html, /function testOverview\(path\)/);
  assert.match(html, /else if\(isCollection\(editPath\)\)root\.append\(collectionOverview\(editPath\)\)/);
});

function evaluationHarness(assessment) {
  const html = graphicalHtml();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'webview script missing');
  const start = script.indexOf('function evalChild(');
  const end = script.indexOf('function hasVisible(', start);
  assert.ok(start >= 0 && end > start, 'evaluation outline functions missing');
  const logic = script.slice(start, end);
  const factory = new Function('current', [
    'let evaluationNodes = new Map();let visualTestPaths = new Map();',
    "const key = path => path.map(String).join('/');",
    'const same = (a,b) => Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>v===b[i]);',
    'const hasPrefix = (path,prefix) => path.length>prefix.length&&prefix.every((v,i)=>v===path[i]);',
    'const allFieldsUnder = path => (current.fields||[]).filter(f=>hasPrefix(f.path,path));',
    logic,
    'return {treeModel,evaluationSelection,testPathForSelection};'
  ].join('\n'));
  return factory({ fields: [], assessment });
}

test('Evaluate tree follows actual nested expression and resolves Test IDs without duplication', () => {
  const ctx = evaluationHarness({
    mode: 'automated',
    tests: [
      {id:'mount-nosuid-test',title:'Full mount test'},
      {id:'config-option-test',title:'Full config check'},
      {id:'registry-policy-test',title:'Full Windows test'}
    ],
    evaluate: {and:[
      {test:'mount-nosuid-test'},
      {or:[{test:'config-option-test'},{test:'registry-policy-test'}]}
    ]}
  });
  const tree = ctx.treeModel().root;
  const evalRoot = tree.children.find(n=>n.path[1]==='evaluate');
  assert.equal(evalRoot.label, 'Evaluate — AND');
  assert.equal(evalRoot.children[0].label, 'mount-nosuid-test');
  assert.equal(evalRoot.children[1].label, 'OR');
  assert.deepEqual(evalRoot.children[1].children.map(n=>n.label), ['config-option-test','registry-policy-test']);
  assert.deepEqual(ctx.testPathForSelection(evalRoot.children[1].children[1].path),
    ['assessment','tests','registry-policy-test']);
  assert.ok(!tree.children.find(n=>n.path[1]==='tests'), 'Only Evaluate normally navigates Tests');
});

test('Single Test, conditional evaluation and manual Assessment retain their true shapes', () => {
  const single = evaluationHarness({
    mode: 'automated',
    tests: [{id:'single-test'}],
    evaluate: {test:'single-test'}
  });
  const singleTree = single.treeModel().root.children.find(n=>n.path[1]==='evaluate');
  assert.equal(singleTree.label, 'Evaluate — Test');
  assert.equal(singleTree.children[0].label, 'single-test');

  const conditional = evaluationHarness({
    mode: 'automated',
    tests: [{id:'single-test'}],
    evaluate: {if:{input_provided:'optional-input'}, then:{test:'single-test'},
      else:{not_applicable:{reason:'missing optional input'}}}
  });
  const conditionalTree = conditional.treeModel().root.children.find(n=>n.path[1]==='evaluate');
  assert.equal(conditionalTree.label, 'Evaluate — IF');
  assert.deepEqual(conditionalTree.children.map(n=>n.label),
    ['IF: Input provided: optional-input','THEN: single-test','ELSE: Not applicable']);

  const manual = evaluationHarness({mode:'manual',tests:[]});
  assert.ok(!manual.treeModel().root.children.some(n=>n.path[1]==='evaluate'));
});

test('Evaluate group UI is explicitly read-only, source-backed and does not imply implicit AND', () => {
  const html = graphicalHtml();
  assert.match(html, /function renderEvalOverview\(node\)/);
  assert.match(html, /To change the logic, use Reveal in YAML/);
  assert.match(html, /fillEvalTree\(evalRoot,current\?\.assessment\?\.evaluate/);
  assert.doesNotMatch(html, /last==='evaluate'\)items\.push\(\{label:'Add child'/);
});


test('Assessment and Test forms prioritize readable columns and whole-value controls', () => {
  const html = graphicalHtml();
  assert.match(html, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(html, /\.property-grid \.field-entry\.wide\{grid-column:1\/-1\}/);
  assert.match(html, /container-name:inspector/);
  assert.match(html, /@container inspector \(max-width:440px\)/);
  assert.match(html, /function fieldNeedsWide\(f\)/);
  assert.match(html, /function fieldNeedsMultiline\(f\)/);
  assert.match(html, /fieldNeedsWide\(item\)\?' wide'/);
  assert.match(html, /input\.rows=Math\.min\(4,Math\.max\(2,/);
  assert.doesNotMatch(html, /\.field-entry>label\{[^}]*text-overflow:ellipsis/);
});

test('Only long or semantically wide properties get full rows and multiline editors', () => {
  const html = graphicalHtml();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const start = script.indexOf('function fieldNeedsWide(');
  const end = script.indexOf('function makeInput(f)',start);
  assert.ok(start >= 0 && end > start);
  const helpers = new Function(script.slice(start,end)+';return {fieldNeedsWide,fieldNeedsMultiline}')();
  const prop = (keys,value,kind='string') => ({path:['assessment',...keys],value,kind,choices:[]});
  const longTitle = prop(['assessment_title'],'A full-length readable human title describing one Assessment');
  assert.equal(helpers.fieldNeedsWide(longTitle),true);
  assert.equal(helpers.fieldNeedsMultiline(longTitle),true);
  assert.equal(helpers.fieldNeedsWide(prop(['mode'],'automated')),false);
  assert.equal(helpers.fieldNeedsMultiline(prop(['class'],'compliance')),false);
  assert.equal(helpers.fieldNeedsWide(prop(['tests','check-test','test_title'],'Short title')),true);
  assert.equal(helpers.fieldNeedsWide(prop(['tests','check-test','object','mount_point','matches_regex'],'^/home')),true);
  assert.equal(helpers.fieldNeedsWide(prop(['tests','check-test','object','hive','equals'],'local_machine')),false);
  assert.equal(helpers.fieldNeedsMultiline({...longTitle,choices:['A','B']}),false);
});


test('Variable stages show collection, capture and concatenation in dependency order', () => {
  const html = graphicalHtml();
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  const start = script.indexOf('function expressionBrief(expr)');
  const end = script.indexOf('function stepControls(step)',start);
  assert.ok(start>=0&&end>start,'Variable expression planner missing');
  const planner = new Function(script.slice(start,end)+';return {variablePlan,expressionBrief}')();
  const expression = {concat:[
    {literal:{datatype:'string',value:'icacls '}},
    {regex_capture:{pattern:'(^[a-zA-Z]:\\\\.+)\\\\sysvol',
      value:{values:{object:{capability:'windows.registry',hive:{equals:'local_machine'},
        key:{equals:'SYSTEM\\CurrentControlSet\\Services\\Netlogon\\Parameters'},
        name:{equals:'SysVol'}},field:'value'}}}}
  ]};
  const path=['assessment','variables','icacls-and-path-to-sysvol-directory-variable','expression'];
  const stages=planner.variablePlan(expression,path);
  assert.deepEqual(stages.map(x=>x.title),[
    'Read registry values','Extract with regular expression','Combine values in order']);
  assert.deepEqual(stages[0].controls,[path.concat('concat',1,'regex_capture','value','values')]);
  assert.deepEqual(stages[1].controls,[path.concat('concat',1,'regex_capture','pattern')]);
  assert.deepEqual(stages[2].controls,[path.concat('concat',0,'literal')]);
  assert.deepEqual(stages[2].operands,['Literal "icacls "','Regex capture result']);
  assert.match(stages[2].note,/authored order/);
});

test('Variable UI preserves source-edit controls and never presents runtime-derived output', () => {
  const html=graphicalHtml();
  assert.match(html,/function variableInspector\(path\)/);
  assert.match(html,/function stepControls\(step\)/);
  assert.match(html,/function variableUsage\(id\)/);
  assert.match(html,/function variableDefinition\(path\)/);
  assert.match(html,/root\.append\(variableDefinition\(editPath\)\?variableInspector\(editPath\)/);
  assert.match(html,/No target system is queried by this editor/);
  assert.match(html,/no registry value was collected, regex executed, or resulting command run/);
  assert.match(html,/const fields=stepControls\(step\);if\(fields\.length\)card\.append\(compactGrid\(fields\)\)/);
});


test('Require predicate planner preserves separate statuses, regex list and value_match', () => {
  const html=graphicalHtml();
  const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  const start=script.indexOf('function requireDefinition(path)');
  const end=script.indexOf('function groupedForm(path)',start);
  assert.ok(start>=0 && end>start);
  const factory=new Function(script.slice(start,end)+';return {predicatePlan,cardinalityWords}')();
  const requirement={
    item_requirement:{items_found:'one_or_more',items_satisfying:'every'},
    field_requirement:{values_found:'one_or_more',values_matching:'every'},
    fields:{
      exit_status:{equals:0},
      stdout_line:{matches_regex:[
        '(?i)NT AUTHORITY\\\\Authenticated Users:\\(RX\\)',
        '(?i)NT AUTHORITY\\\\SYSTEM:\\(F\\)'],value_match:'one_or_more'},
      stderr_line:{values_found:'none'}
    }
  };
  const plans=factory.predicatePlan(requirement);
  assert.deepEqual(plans.map(p=>p.name),['exit_status','stdout_line','stderr_line']);
  assert.deepEqual(plans[0].operators,['equals']);
  assert.equal(plans[1].patterns.length,2);
  assert.equal(plans[1].expectedMatch,'one_or_more');
  assert.equal(plans[2].absence,true);
  assert.equal(factory.cardinalityWords('one_or_more'),'at least one');
  assert.equal(factory.cardinalityWords('every'),'every');
});

test('Require inspector groups Item, Field and predicate requirements with editable patterns', () => {
  const html=graphicalHtml();
  assert.match(html,/function requireInspector\(path\)/);
  assert.match(html,/function fieldCheckCard\(path,plan\)/);
  assert.match(html,/1\. Item requirements/);
  assert.match(html,/2\. Field-value requirements/);
  assert.match(html,/3\. Field conditions/);
  assert.match(html,/Regex patterns \(/);
  assert.match(html,/Pattern '\+\(Number\(f\.path\.at\(-1\)\)\+1\)/);
  assert.match(html,/regex\.append\(entry\)/);
  assert.match(html,/Distinct from the field-value and Item requirements above|distinct from the field-value and Item requirements above/);
  assert.match(html,/requireDefinition\(editPath\)\?requireInspector\(editPath\)/);
});

test('Object Variable references expose an inline preview and editor navigation', () => {
  const html=graphicalHtml();
  const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  const start=script.indexOf('function variableReferenceId(f)');
  const end=script.indexOf('function compactGrid(fields,style)',start);
  assert.ok(start>=0&&end>start);
  const factory=new Function(script.slice(start,end)+';return {variableReferenceId}')();
  const ref={
    path:['assessment','tests','permissions-must-conform-to-minimum-requirements-test',
      'object','command','variable'],
    value:'icacls-and-path-to-sysvol-directory-variable'
  };
  assert.equal(factory.variableReferenceId(ref),ref.value);
  assert.equal(factory.variableReferenceId({path:['assessment','variables','one-variable','expression','variable'],value:ref.value}),null);
  assert.equal(factory.variableReferenceId({...ref,value:''}),null);
  assert.match(html,/Show Variable: /);
  assert.match(html,/Unresolved Variable: /);
  assert.match(html,/Open Variable editor/);
  assert.match(html,/open\.onclick=\(\)=>select\(\['assessment','variables',id\]\)/);
  assert.match(html,/const ref=variableReferenceLink\(item\);if\(ref\)entry\.append\(ref\)/);
  assert.match(html,/not evaluated here/);
});


test('Test summary always shows authored metadata without an inapplicable defaults display toggle', () => {
  const html=graphicalHtml();
  const center=html.slice(html.indexOf('function renderCenter(){'),html.indexOf('function renderHelp(',html.indexOf('function renderCenter(){')));
  assert.match(center,/const isTestOverview=editPath\.length===3&&editPath\[1\]==='tests'/);
  assert.match(center,/&&\!isTestOverview&&\!isCollection\(editPath\)\)heading\.append\(viewToggle\(editPath\)\)/);
  assert.match(center,/if\(!isTestOverview\)root\.append\(defaultsSummary\(editPath\)\)/);
  const overview=html.slice(html.indexOf('function testOverview(path)'),html.indexOf('function requireDefinition(path)'));
  assert.match(overview,/const headFields=sectionFields\(path\)/, 'Summary shows authored Test metadata regardless of display preference');
  assert.doesNotMatch(overview,/const headFields=editorFields\(path\)/);
});

test('Test Object and Require summaries show all properties, not an unexpandable truncated count', () => {
  const html=graphicalHtml();
  const semantic=html.slice(html.indexOf('function semanticCard(testPath,which)'),html.indexOf('function testOverview(path)'));
  assert.match(semantic,/for\(const f of ranked\)/, 'No fixed three-field preview limit');
  assert.doesNotMatch(semantic,/ranked\.slice\(0,3\)/);
  assert.doesNotMatch(semantic,/\+\(values\.length-3\)\+' more properties'/);
  assert.match(semantic,/Edit Object/);
  assert.match(semantic,/Edit Require/);
});


test('Organizational Inputs page describes policy-supplied values and has Add control', () => {
  const html = graphicalHtml();
  assert.match(html, /Organizational Inputs/);
  assert.match(html, /do not reference external Assessment files; those use dependencies/);
  assert.match(html, /No Organizational Inputs declared/);
  assert.match(html, /\+ Add Organizational Input/);
  assert.match(html, /add\.onclick=\(\)=>vscode\.postMessage\(\{type:'structural',action:'add',path,revision:current\?\.revision,version:current\?\.version\}\)/);
  assert.match(html, /last==='inputs'\)items\.push\(\{label:'Add Organizational Input',action:'add'\}\)/);
  const center = html.slice(html.indexOf('function renderCenter(){'),html.indexOf('function renderHelp(',html.indexOf('function renderCenter(){')));
  assert.match(center, /!\s*isCollection\(editPath\)\)heading\.append\(viewToggle\(editPath\)\)/);
});


test('Shared Object inspector explains selector authoring and does not hide missing required fields', () => {
  const html = graphicalHtml();
  assert.match(html,/function sharedObjectInspector\(path\)/);
  assert.match(html,/function sharedObjectDefinition\(path\)/);
  assert.match(html,/function sharedObjectUsage\(id\)/);
  assert.match(html,/No selectors are authored/);
  assert.match(html,/Missing required object_title/);
  assert.match(html,/Shared Object names must end in -object/);
  assert.match(html,/Add selector/);
  assert.match(html,/A Test must use its object_ref ID/);
  assert.match(html,/root\.append\(variableDefinition\(editPath\)\?variableInspector\(editPath\):sharedObjectDefinition\(editPath\)\?sharedObjectInspector\(editPath\)/);
  assert.match(html,/label:'Add Object selector \/ required title'/);
});

test('Shared Object context exposes the original authored controls and source-backed Add action', () => {
  const html = graphicalHtml();
  assert.match(html,/const controls=editorFields\(path\)/);
  assert.match(html,/if\(controls\.length\)section\.append\(compactGrid\(controls\)\)/);
  assert.match(html,/action:'add',path,revision:current\?\.revision,version:current\?\.version/);
  assert.match(html,/function friendlyLabel\(f\)/);
  assert.match(html,/if\(p\[1\]==='shared_objects'&&p\.length>4\)/);
});


test('context menu labels represent authoring concepts, never generic YAML nodes and keys', () => {
  const html=graphicalHtml();
  const script=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)?.[1];
  const start=script.indexOf('function menuItems(path)');
  const end=script.indexOf('function showMenu(path',start);
  assert.ok(start>=0&&end>start);
  const menuItems=new Function('testPathForSelection',script.slice(start,end)+';return menuItems')(()=>null);
  const labels=path=>menuItems(path).filter(x=>!x.separator).map(x=>x.label);
  assert.deepEqual(labels(['assessment','tests']),['Add Test','Reveal in YAML']);
  assert.deepEqual(labels(['assessment','inputs']),['Add Organizational Input','Reveal in YAML']);
  assert.deepEqual(labels(['assessment','variables']),['Add Variable','Reveal in YAML']);
  assert.deepEqual(labels(['assessment','shared_objects']),['Add Shared Object','Reveal in YAML']);
  assert.deepEqual(labels(['assessment','tests','first-test']),[
    'Duplicate Test','Rename Test ID','Remove Test','Reveal in YAML']);
  assert.deepEqual(labels(['assessment','variables','first-variable']),[
    'Duplicate Variable','Rename Variable ID','Remove Variable','Reveal in YAML']);
  assert.deepEqual(labels(['assessment','inputs','first-input']),[
    'Duplicate Organizational Input','Rename Organizational Input ID','Remove Organizational Input','Reveal in YAML']);
  assert.deepEqual(labels(['assessment','shared_objects','first-object']),[
    'Add Object selector / required title','Duplicate Shared Object',
    'Rename Shared Object ID','Remove Shared Object','Reveal in YAML']);
  assert.deepEqual(labels(['assessment','tests','first-test','object']),[
    'Add Object selector','Reveal in YAML']);
  assert.deepEqual(labels(['assessment','tests','first-test','require']),['Reveal in YAML']);
  assert.deepEqual(labels(['assessment','tests','first-test','object','hive']),['Reveal in YAML']);
  for(const path of [['assessment'],['assessment','shared_objects','first-object'],
                     ['assessment','tests','first-test','require']])
    assert.ok(!labels(path).some(x=>/\b(node|key|child|new-property)\b/i.test(x)));
});


test('Require default-only item policy stays explicit without a misleading empty-controls row', () => {
  const html=graphicalHtml();
  const begin=html.indexOf('function requireSection(title,description,controls)');
  const end=html.indexOf('function predicatePlan(requirement)',begin);
  const body=html.slice(begin,end);
  assert.ok(begin>=0 && end>begin);
  assert.match(body,/section\.classList\.add\('compact-constant'\)/);
  assert.match(body,/if\(controls\.length\)section\.append\(compactGrid\(controls\)\)/);
  assert.doesNotMatch(body,/No authored controls visible in this section/);
  assert.match(html,/\.require-section\.compact-constant h2\{display:inline/);
  const inspector=html.slice(html.indexOf('function requireInspector(path)'),html.indexOf('function groupedForm(path)'));
  assert.match(inspector,/panel\.append\(requireSection\('1\. Item requirements'/);
  assert.match(inspector,/if\(requirement\.field_requirement\)panel\.append\(requireSection\('2\. Field-value requirements'/);
});

test('Require density adjustment leaves all authored Field conditions and regex editing intact', () => {
  const html=graphicalHtml();
  assert.match(html,/\.require-fields\{display:flex;flex-direction:column;gap:7px/);
  assert.match(html,/\.require-predicate\{border:1px solid var\(--vscode-panel-border\)/);
  assert.match(html,/Regex patterns \(/);
  assert.match(html,/require-regex-row/);
  assert.match(html,/section\.append\(regex\)/);
  assert.match(html,/return section\s*\}/);
});


test('Require field name and small explanatory text share a responsive heading row', () => {
  const html=graphicalHtml();
  assert.match(html,/\.require-predicate-heading\{display:flex;align-items:baseline;flex-wrap:wrap/);
  assert.match(html,/\.require-predicate-heading h3\{margin:0;flex:0 0 auto\}/);
  assert.match(html,/\.require-predicate-heading \.hint\{margin:0;flex:1 1 180px;min-width:0;line-height:1\.4\}/);
  const start=html.indexOf('function fieldCheckCard(path,plan)');
  const end=html.indexOf('function requireInspector(path)',start);
  assert.ok(start>=0&&end>start);
  const card=html.slice(start,end);
  assert.match(card,/const heading=document\.createElement\('div'\);heading\.className='require-predicate-heading'/);
  assert.match(card,/heading\.append\(note\);section\.append\(heading\)/);
  assert.doesNotMatch(card,/section\.append\(title\)/);
  assert.doesNotMatch(card,/section\.append\(note\)/);
  assert.match(card,/const meta=visible\.filter/);
  assert.match(card,/section\.append\(regex\)/);
});

test('Require policy and predicate editor labels align inline with their controls', () => {
  const html=graphicalHtml();
  // Layout-only: retain the current schema-derived controls and source editor.
  assert.match(html,/\.require-section>\.property-grid \.field-entry,\.require-predicate>\.property-grid \.field-entry\{display:grid;grid-template-columns:minmax\(92px,37%\) minmax\(0,1fr\)/);
  assert.match(html,/\.require-section>\.property-grid \.field-entry>label,\.require-predicate>\.property-grid \.field-entry>label\{display:block;padding:0/);
  assert.match(html,/@media\(max-width:760px\)\{\.require-section>\.property-grid/);
  const section=html.slice(html.indexOf('function requireSection(title,description,controls)'),html.indexOf('function predicatePlan(requirement)'));
  assert.match(section,/if\(controls\.length\)section\.append\(compactGrid\(controls\)\)/);
  const card=html.slice(html.indexOf('function fieldCheckCard(path,plan)'),html.indexOf('function requireInspector(path)'));
  assert.match(card,/if\(meta\.length\)section\.append\(compactGrid\(meta\)\)/);
  assert.match(card,/section\.append\(regex\)/);
});

test('Regex pattern editor aligns numbered labels with editable expression controls', () => {
  const html=graphicalHtml();
  assert.match(html,/\.require-regex-row\{display:grid;grid-template-columns:minmax\(70px,90px\) minmax\(0,1fr\)/);
  assert.match(html,/\.require-regex-row label\{font-size:11px;display:block;padding:6px 0 0\}/);
  const card=html.slice(html.indexOf('function fieldCheckCard(path,plan)'),html.indexOf('function requireInspector(path)'));
  assert.match(card,/entry\.append\(label,makeInput\(f\)\);regex\.append\(entry\)/);
  assert.match(card,/const controls=visible\.filter/);
});

test('Require section headings and explanations share a line including Field conditions', () => {
  const html=graphicalHtml();
  assert.match(html,/\.require-section>h2\{display:inline;margin:0 8px 0 0\}/);
  assert.match(html,/\.require-section>\.hint\{display:inline;line-height:1\.4\}/);
  assert.match(html,/\.require-section>\.property-grid\{margin-top:6px\}/);
  const inspector=html.slice(html.indexOf('function requireInspector(path)'),html.indexOf('function groupedForm(path)'));
  assert.match(inspector,/requireSection\('2\. Field-value requirements'/);
  assert.match(inspector,/title\.textContent='3\. Field conditions';group\.append\(title\)/);
  assert.match(inspector,/guide\.textContent='These are the conditions applied to collected evidence fields\.';group\.append\(guide\)/);
});

test('Variable stages share heading/help row and all property forms align labels inline', () => {
  const html=graphicalHtml();
  assert.match(html,/\.property-grid \.field-entry\{display:grid;grid-template-columns:minmax\(96px,34%\) minmax\(0,1fr\)/);
  assert.match(html,/\.property-grid \.field-entry\.wide\{grid-template-columns:minmax\(110px,24%\) minmax\(0,1fr\)/);
  assert.match(html,/\.variable-step-heading\{display:flex;align-items:baseline;flex-wrap:wrap/);
  assert.match(html,/\.variable-step-heading>\.hint\{margin:0;flex:1 1 240px/);
  const start=html.indexOf('function variableInspector(path)');
  const end=html.indexOf('function collectionOverview(path)',start);
  const inspector=html.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(inspector,/help\.textContent=step\.note;heading\.append\(help\)/);
  assert.match(inspector,/const fields=stepControls\(step\);if\(fields\.length\)card\.append\(compactGrid\(fields\)\)/);
  assert.doesNotMatch(inspector,/help\.textContent=step\.note;card\.append\(help\)/);
});

test('Evaluate Test references expose Object/Require once per occurrence while keeping source identities', () => {
  const ctx=evaluationHarness({mode:'automated',tests:[
    {id:'first-test',title:'First'}, {id:'second-test',title:'Second'}, {id:'orphan-test',title:'Orphan'}
  ],evaluate:{and:[{test:'first-test'},{or:[{test:'second-test'},{test:'first-test'}]}]}});
  const {root,meaningful}=ctx.treeModel();
  assert.equal(root.children.some(n=>n.path[1]==='tests'),false);
  const evaluate=root.children.find(n=>n.path[1]==='evaluate');
  assert.equal(evaluate.children[0].label,'first-test');
  assert.deepEqual(evaluate.children[0].children.map(n=>n.path.at(-1)),['object','require']);
  assert.deepEqual(ctx.testPathForSelection(['assessment','evaluate','and',0,'require']),
    ['assessment','tests','first-test','require']);
  assert.deepEqual(ctx.testPathForSelection(['assessment','evaluate','and',1,'or',1,'object']),
    ['assessment','tests','first-test','object']);
  const orphans=root.children.find(n=>n.path[1]==='unreferenced_tests');
  assert.equal(orphans.label,'Unreferenced Tests (1)');
  assert.deepEqual(orphans.children[0].children.map(n=>n.path.at(-1)),['object','require']);
  assert.deepEqual(ctx.testPathForSelection(['assessment','unreferenced_tests','orphan-test','require']),
    ['assessment','tests','orphan-test','require']);
  assert.ok(meaningful.has('assessment/evaluate/and/0/require'));
});
test('Absent/missing Evaluate reference does not masquerade as authored Test',()=>{
  const ctx=evaluationHarness({mode:'automated',tests:[{id:'real-test'}],evaluate:{test:'missing-test'}});
  const tree=ctx.treeModel().root;
  assert.equal(tree.children.find(n=>n.path[1]==='evaluate').children[0].label,'missing-test');
  assert.equal(ctx.testPathForSelection(['assessment','evaluate','test']),null);
  assert.equal(tree.children.find(n=>n.path[1]==='unreferenced_tests').children[0].label,'real-test');
});

test('Object inspectors give selectors full-width rows and schema-backed short descriptions',()=>{
  const html=graphicalHtml();
  assert.match(html,/\.property-grid\.object-fields\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(html,/\.property-grid\.object-fields \.field-entry,\.property-grid\.object-fields \.field-entry\.wide\{grid-column:1\/-1/);
  assert.match(html,/\.object-field-description\{font-size:11px/);
  assert.match(html,/style==='object-fields'/);
  assert.match(html,/desc\.textContent=item\.description/);
  assert.match(html,/compactGrid\(fields,path\.at\(-1\)==='object'\?'object-fields':undefined\)/);
  assert.match(html,/compactGrid\(controls,'object-fields'\)/);
});
test('Object controls retain source-provided enumerations, rather than inventing option lists',()=>{
  const html=graphicalHtml();
  const section=html.slice(html.indexOf('function makeInput(f)'),html.indexOf('function friendlyLabel(f)'));
  assert.match(section,/const choices=Array\.isArray\(f\.choices\)\?f\.choices:\[\]/);
  assert.match(section,/if\(choices\.length\)\{input=document\.createElement\('select'\)/);
  assert.match(section,/choices\.forEach\(choice=>/);
  assert.match(section,/o\.selected=JSON\.stringify\(choice\)===JSON\.stringify\(f\.value\)/);
  assert.match(section,/revision:current\.revision,version:current\.version/);
});

test('Object selector source control switches typed string mappings through revision-safe host action',()=>{
 const html=graphicalHtml();
 assert.match(html,/function sourceChoiceForObject\(field\)/);
 assert.match(html,/if\(!inTest&&!inShared\|\|field\.kind!=='string'\)return null/);
 assert.match(html,/\['equals','Fixed value'\]/);
 assert.match(html,/\['variable','Variable reference'\]/);
 assert.match(html,/type:'selectorSource',path:parts\.slice\(0,-1\)/);
 assert.match(html,/revision:current\.revision,version:current\.version/);
 assert.match(html,/style==='object-fields'\)\{const chooser=sourceChoiceForObject\(item\)/);
 assert.match(html,/\.object-source-switch\{grid-column:2;display:grid/);
});
