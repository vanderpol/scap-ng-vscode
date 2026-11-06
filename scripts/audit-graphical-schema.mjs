/** Audit pinned schema contracts without reading or modifying user content. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {MetadataPack} from '../dist/metadata.js';
import {GuidedCatalog} from '../dist/guided.js';
const root=process.env.SCAP_NG_METADATA_PACK;
if(!root)throw new Error('SCAP_NG_METADATA_PACK is required');
const pin=JSON.parse(readFileSync(new URL('../schema-profile.json',import.meta.url)));
const pack=new MetadataPack(resolve(root),pin);
const catalog=new GuidedCatalog(pack),capabilities=catalog.capabilities();
const rows=[];
for(const capability of capabilities){
  for(const field of catalog.objectFields(capability.value))
    rows.push({capability:capability.value,section:'Object',field:field.name,
      operatorOptions:field.operations.map(o=>o.value),enumOptions:field.enumValues,
      help:field.description||'',missing:!field.operations.length?'operator metadata':!field.description?'help text':null});
  for(const field of catalog.resultFields(capability.value))
    rows.push({capability:capability.value,section:'Require',field:field.name,
      operatorOptions:field.operations.map(o=>o.value),enumOptions:[],
      help:field.description||'',missing:!field.operations.length?'operator metadata':!field.description?'help text':null});
}
const summary={schemaVersion:pin.schemaVersion,pinnedCommit:pin.sourceCommit,
  capabilityCount:capabilities.length,fieldContracts:rows.length,
  missingOperatorMetadata:rows.filter(r=>!r.operatorOptions.length).length,
  missingHelpText:rows.filter(r=>!r.help).length,
  note:'Schema inventory only; does not demonstrate host rendering, authoring completeness, or scanner equivalence'};
console.log(JSON.stringify({summary,missing:rows.filter(r=>r.missing),rows},null,2));
