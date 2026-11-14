/** Audit pinned schema contracts without reading or modifying user content. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {MetadataPack} from '../dist/metadata.js';
import {GuidedCatalog} from '../dist/guided.js';
import {predicateOperatorChoices, predicateValueSourceChoices, selectorOperatorChoices, selectorValueChoices} from '../dist/completion.js';
import {expressionContract} from '../dist/expression-contract.js';
const root=process.env.SCAP_NG_METADATA_PACK;
if(!root)throw new Error('SCAP_NG_METADATA_PACK is required');
const pin=JSON.parse(readFileSync(new URL('../schema-profile.json',import.meta.url)));
const pack=new MetadataPack(resolve(root),pin);
const catalog=new GuidedCatalog(pack),capabilities=catalog.capabilities();
const rows=[];
for(const capability of capabilities){
  for(const field of catalog.objectFields(capability.value))
    rows.push({capability:capability.value,section:'Object',field:field.name,
      operatorOptions:selectorOperatorChoices(pack,capability.value,field.name,false).map(o=>o.value),
      enumOptions:selectorValueChoices(pack,capability.value,field.name,'equals',false).map(o=>o.value),
      ...contractAudit(expressionContract(pack,capability.value,field.name,'object')),
      help:field.description||'',missing:!field.operations.length?'operator metadata':!field.description?'help text':null});
  for(const field of catalog.resultFields(capability.value))
    rows.push({capability:capability.value,section:'Require',field:field.name,
      operatorOptions:selectorOperatorChoices(pack,capability.value,field.name,true).map(o=>o.value),enumOptions:[],
      ...contractAudit(expressionContract(pack,capability.value,field.name,'require')),
      help:field.description||'',missing:!field.operations.length?'operator metadata':!field.description?'help text':null});
}
function contractAudit(contract){return {operandSources:contract.operandSources,datatypes:contract.datatypes,operatorSources:contract.operatorSources,operatorDocumentation:contract.operatorDocumentation,cardinalityControls:contract.cardinalityControls,schemaUri:contract.schemaUri,mappingUri:contract.mappingUri};}
// Generic record predicates are schema-supported expression locations even
// though their member names are dynamic and therefore absent from the
// capability catalog. Keep them in the same auditable matrix as capability
// fields; the resolver remains the only source of operators and operands.
for(const definition of ['scalar_field_predicate','record_field_predicate','object_record_field_predicate']){
  const choices=predicateOperatorChoices(pack,definition);
  rows.push({capability:'(canonical predicate)',section:'Require / generic predicate',field:definition,
    operatorOptions:choices.map(choice=>choice.value),enumOptions:[],
    operandSources:[...new Set(choices.flatMap(choice=>predicateValueSourceChoices(pack,definition,choice.value)))],
    datatypes:[],
    operatorSources:Object.fromEntries(choices.map(choice=>[choice.value,predicateValueSourceChoices(pack,definition,choice.value)])),
    operatorDocumentation:Object.fromEntries(choices.map(choice=>[choice.value,choice.description||choice.label||choice.value])),
    cardinalityControls:definition==='object_record_field_predicate'?['value_match']:['values_found','values_matching','value_match'],
    schemaUri:`https://scap-ng.dev/schema/v0.4.0/assessment-language.schema.json#/$defs/${definition}`,
    mappingUri:undefined,help:'Canonical predicate definition; member datatype constraints are resolved by the enclosing capability schema.',missing:choices.length?'': 'operator metadata'});
}
// Variable declarations and nested expression branches are contracts in their
// own right. Their branch names and documentation are read from the pinned
// variable-expression schema; no expression vocabulary is duplicated here.
const variableSchemaUri=pack.manifest.resources.find(resource=>resource.kind==='schema'&&resource.uri.endsWith('/variable-expression.schema.json'))?.uri;
const expressionUri=variableSchemaUri?`${variableSchemaUri}#/$defs/expression`:undefined;
if(expressionUri){
  const expression=pack.node(expressionUri);
  for(const [index,branch] of (expression.oneOf??[]).entries()){
    const name=Array.isArray(branch.required)&&typeof branch.required[0]==='string'?branch.required[0]:`branch-${index}`;
    const sources=[];
    const visit=(node)=>{
      if(!node||typeof node!=='object')return;
      for(const required of node.required??[]){
        if(required==='variable')sources.push('variable');
        if(required==='literal')sources.push('fixed');
        if(required==='input')sources.push('input');
        if(required==='object')sources.push('object');
      }
      for(const key of ['properties','oneOf','anyOf','allOf']){
        const children=key==='properties'?Object.values(node.properties??{}):(Array.isArray(node[key])?node[key]:[]);
        for(const child of children)visit(child);
      }
    };
    visit(branch);
    rows.push({capability:'(canonical variable)',section:'Variables / nested expression',field:name,
      operatorOptions:[],expressionBranch:name,enumOptions:[],operandSources:[...new Set(sources)],datatypes:[],operatorSources:{},operatorDocumentation:{},
      cardinalityControls:[],schemaUri:`${expressionUri}/oneOf/${index}`,mappingUri:undefined,
      help:branch.description||branch.title||'Schema-supported Variable expression branch.',missing:null});
  }
}
const summary={schemaVersion:pin.schemaVersion,pinnedCommit:pin.sourceCommit,
  capabilityCount:capabilities.length,fieldContracts:rows.length, genericPredicateContracts:3, variableExpressionContracts:rows.filter(row=>row.section==='Variables / nested expression').length,
  missingOperatorMetadata:rows.filter(r=>(r.section==='Object'||r.section==='Require'||r.section==='Require / generic predicate')&&!r.operatorOptions.length).length,
  missingHelpText:rows.filter(r=>!r.help).length,
  oversizedOperatorLists:rows.filter(r=>(r.section==='Object'||r.section==='Require'||r.section==='Require / generic predicate')&&r.operatorOptions.length>20).length,
  maxOperatorCount:Math.max(0,...rows.map(r=>r.operatorOptions.length)),
  note:'Uses the same capability-scoped operator resolver as GUI and YAML completion. Does not demonstrate host rendering or scanner equivalence.'};
console.log(JSON.stringify({summary,missing:rows.filter(r=>r.missing),rows},null,2));
