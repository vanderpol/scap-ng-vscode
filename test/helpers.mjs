import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256, MetadataPack } from '../dist/index.js';
export const context = { documentVersion:'0.4.0', schemaValid:true, isOverride:false, diagnostics:[] };
export const uri='https://example.invalid/schema';
export function fixture(schema, mutateManifest = () => {}) {
  const dir=mkdtempSync(join(tmpdir(),'metadata-'));
  const doc={$schema:'https://json-schema.org/draft/2020-12/schema',$id:uri,'x-scap-ng-version':'0.4.0',...schema};
  const raw=JSON.stringify(doc); writeFileSync(join(dir,'schema.json'),raw);
  const manifest={format:'scap-ng/offline-editor-pack/1',schema_version:'0.4.0',authoring_metadata_version:1,source_commit:'a'.repeat(40),
    resources:[{uri,path:'schema.json',kind:'schema',bytes:Buffer.byteLength(raw),sha256:sha256(raw)}]};
  mutateManifest(manifest); const bytes=JSON.stringify(manifest);writeFileSync(join(dir,'manifest.json'),bytes);
  const pin={schemaVersion:'0.4.0',sourceCommit:'a'.repeat(40),manifestSha256:sha256(bytes)};
  return {dir,pin,open:()=>new MetadataPack(dir,pin),close:()=>rmSync(dir,{recursive:true,force:true})};
}
export const hint=(extra={})=>({version:1,control_id:'example',group:'comparison',representation:'value',hide_when_default:true,new_authoring_only:true,serialize_explicitly:true,preserve_overrides:true,...extra});
