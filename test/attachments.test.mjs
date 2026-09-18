import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAttachmentStore, attachmentInput, MAX_FILE_BYTES } from '../lib/attachments.mjs';

const store = () => createAttachmentStore(mkdtempSync(path.join(tmpdir(),'codex-attachments-')));
test('uploads keep safe filenames and cannot overwrite their metadata',()=>{
  const files=store();
  for(const name of ['../../notes.txt','C:\\secret\\notes.txt','metadata.json','CON.txt']){
    const meta=files.save(name,Buffer.from('sample'));
    assert.ok(!/[\\/]/.test(meta.name));
    assert.equal(readFileSync(files.get(meta.id).path,'utf8'),'sample');
  }
  assert.throws(()=>files.get('../notes.txt'));
  assert.throws(()=>files.save('run.exe',Buffer.from('sample')));
  assert.throws(()=>files.save('empty.txt',Buffer.alloc(0)));
  assert.throws(()=>files.save('fake.png',Buffer.from('not an image')));
  assert.throws(()=>files.save('large.txt',Buffer.alloc(MAX_FILE_BYTES+1)),{statusCode:413});
});
test('attachment resolution enforces unique IDs, count and total byte limits',()=>{
  const files=store();const a=files.save('a.txt',Buffer.alloc(16*1024*1024)),b=files.save('b.txt',Buffer.alloc(16*1024*1024));
  assert.throws(()=>files.resolve([a.id,a.id]));
  assert.throws(()=>files.resolve(Array(11).fill(a.id)));
  assert.throws(()=>files.resolve([a.id,b.id]),{statusCode:413});
  assert.throws(()=>files.resolve(['00000000-0000-0000-0000-000000000000']),{statusCode:404});
});
test('Codex receives images as localImage and document paths as text',()=>{
  const files=store();
  const doc=files.save('notes.txt',Buffer.from('sample'));
  const png=files.save('pixel.png',Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhMsAAAAASUVORK5CYII=','base64'));
  const input=attachmentInput('',files.resolve([doc.id,png.id]));
  assert.equal(input[0].type,'text');assert.ok(input[0].text.length);
  assert.ok(input[1].text.includes(JSON.stringify(files.get(doc.id).path)));
  assert.deepEqual(input[2],{type:'localImage',path:files.get(png.id).path});
});
