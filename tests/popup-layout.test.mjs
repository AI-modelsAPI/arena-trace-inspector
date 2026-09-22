import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('popup intrinsic width is fixed and cannot feed back through viewport-relative constraints',()=>{
 const css=fs.readFileSync(new URL('../popup.css',import.meta.url),'utf8');
 const body=css.match(/\bbody\{([^}]+)\}/)?.[1];assert.ok(body);
 const props=Object.fromEntries(body.split(';').filter(Boolean).map(s=>{const i=s.indexOf(':');return [s.slice(0,i).trim(),s.slice(i+1).trim()];}));
 assert.match(props.width,/^\d+px$/);assert.equal(props['min-width'],props.width);assert.equal(props['max-width'],'none');
 assert.ok(!/%|\b(?:vw|vh|vmin|vmax|dvw|svw|lvw)\b/.test([props.width,props['min-width'],props['max-width']].join(' ')));
});
test('toolbar popup entry and existing permissions remain intact',()=>{
 const m=JSON.parse(fs.readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
 assert.equal(m.action.default_popup,'popup.html');assert.deepEqual(m.permissions,['activeTab','debugger','storage','cookies']);
});
