/** Audit pinned schema contracts without reading or modifying user content. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {MetadataPack} from '../dist/metadata.js';
import {GuidedCatalog} from '../dist/guided.js';
import {selectorOperatorChoices, selectorValueChoices} from '../dist/completion.js';
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
const summary={schemaVersion:pin.schemaVersion,pinnedCommit:pin.sourceCommit,
  capabilityCount:capabilities.length,fieldContracts:rows.length,
  missingOperatorMetadata:rows.filter(r=>!r.operatorOptions.length).length,
  missingHelpText:rows.filter(r=>!r.help).length,
  oversizedOperatorLists:rows.filter(r=>r.operatorOptions.length>20).length,
  maxOperatorCount:Math.max(0,...rows.map(r=>r.operatorOptions.length)),
  note:'Uses the same capability-scoped operator resolver as GUI and YAML completion. Does not demonstrate host rendering or scanner equivalence.'};
console.log(JSON.stringify({summary,missing:rows.filter(r=>r.missing),rows},null,2));
