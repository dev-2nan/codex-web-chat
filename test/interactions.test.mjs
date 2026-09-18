import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InteractionBroker,responseFor,requestActions,validateForm,checkFormSchema,safeWebUrl,supportedRequests} from '../lib/interactions.mjs';
const req=(method,params={})=>({id:42,method,params:{threadId:'chat-a',...params}});

test('command, file and legacy approvals map every allowed decision correctly',()=>{
  for(const method of ['item/commandExecution/requestApproval','item/fileChange/requestApproval']){
    for(const action of ['accept','acceptForSession','decline','cancel'])assert.deepEqual(responseFor(req(method),{action}),{decision:action});
    assert.throws(()=>responseFor(req(method),{action:'anything'}));
  }
  for(const method of ['execCommandApproval','applyPatchApproval']){
    assert.equal(responseFor(req(method),{action:'accept'}).decision,'approved');
    assert.equal(responseFor(req(method),{action:'cancel'}).decision,'abort');
    assert.ok(responseFor(req(method),{action:'decline'}).decision.denied);
  }
  const r=req('item/commandExecution/requestApproval',{proposedExecpolicyAmendment:['git','status'],proposedNetworkPolicyAmendments:[{host:'example.com',action:'allow'}]});
  assert.deepEqual(responseFor(r,{action:'execPolicy',proposedExecpolicyAmendment:['malicious']}),{decision:{acceptWithExecpolicyAmendment:{execpolicy_amendment:['git','status']}}});
  assert.equal(responseFor(r,{action:'network:0'}).decision.applyNetworkPolicyAmendment.network_policy_amendment.host,'example.com');
  assert.throws(()=>responseFor(r,{action:'network:8'}));
});
test('permissions only grant requested categories with explicit scope',()=>{
  const r=req('item/permissions/requestApproval',{permissions:{network:{enabled:true},fileSystem:{read:['/docs'],write:null}}});
  assert.deepEqual(responseFor(r,{action:'accept',permissionKeys:['network']}),{permissions:{network:{enabled:true}},scope:'turn'});
  assert.equal(responseFor(r,{action:'acceptForSession',permissionKeys:['fileSystem']}).scope,'session');
  assert.deepEqual(responseFor(r,{action:'decline'}).permissions,{});
  assert.throws(()=>responseFor(r,{action:'accept',permissionKeys:['admin']}));
  assert.throws(()=>responseFor(r,{action:'accept',permissionKeys:[]}));
});
test('questions validate options, free text, secret answers and skip without default consent',()=>{
  for(const method of ['item/tool/requestUserInput','tool/requestUserInput']){
    const r=req(method,{questions:[{id:'choice',header:'Choice',options:[{label:'A'},{label:'B'}],isOther:false},{id:'secret',question:'Token',isSecret:true}]});
    assert.throws(()=>responseFor(r,{action:'answer',answers:{choice:'C',secret:'x'}}));
    assert.throws(()=>responseFor(r,{action:'answer',answers:{choice:'A',secret:''}}));
    assert.equal(responseFor(r,{action:'answer',answers:{choice:'A',secret:'x'}}).answers.secret.answers[0],'x');
    assert.deepEqual(responseFor(r,{action:'skip'}),{answers:{}});
    r.params.questions[0].isOther=true;assert.equal(responseFor(r,{action:'answer',answers:{choice:'custom',secret:'x'}}).answers.choice.answers[0],'custom');
  }
});
const schema={type:'object',required:['name','count','enabled'],properties:{name:{type:'string',minLength:2,maxLength:20},count:{type:'integer',minimum:1,maximum:10},enabled:{type:'boolean'},choice:{type:'string',oneOf:[{const:'a',title:'A'}]},tags:{type:'array',minItems:1,items:{anyOf:[{const:'x',title:'X'},{const:'y',title:'Y'}]}}}};
test('MCP standard schemas support typed fields and enforce constraints server-side',()=>{
  const valid={name:'demo',count:2,enabled:false,choice:'a',tags:['x']};assert.deepEqual(validateForm(schema,valid),valid);
  for(const patch of [{name:'x'},{count:1.5},{count:11},{enabled:'false'},{choice:'b'},{tags:[]},{tags:['x','x']},{extra:'bad'}])assert.throws(()=>validateForm(schema,{...valid,...patch}));
  assert.throws(()=>validateForm(schema,{name:'demo'}));
  assert.throws(()=>checkFormSchema({type:'object',properties:{nested:{type:'object'}}}));
  assert.throws(()=>checkFormSchema({type:'object',properties:{name:{type:'string',pattern:'.*'}}}));
});
test('MCP accepts validated forms, declines without values, and rejects unsafe URL modes',()=>{
  const r=req('mcpServer/elicitation/request',{mode:'form',requestedSchema:schema});
  assert.deepEqual(responseFor(r,{action:'cancel',content:{secret:'never return'}}),{action:'cancel',content:null,_meta:null});
  assert.equal(responseFor(r,{action:'accept',content:{name:'demo',count:1,enabled:true}}).action,'accept');
  assert.throws(()=>responseFor(req(r.method,{mode:'openai/form'}),{action:'accept',content:{}}));
  assert.throws(()=>responseFor(req(r.method,{mode:'url',url:'javascript:alert(1)'}),{action:'accept'}));
  assert.equal(responseFor(req(r.method,{mode:'url',url:'https://example.com'}),{action:'accept'}).content,null);
  assert.equal(safeWebUrl('https://user:password@example.com'),null);
});
test('broker handles multiple requests, opaque IDs, duplicates, expiry and disconnect',()=>{
  const sent=[],notices=[];const b=new InteractionBroker(m=>sent.push(m),()=>{},(...args)=>notices.push(args));
  b.receive(req('item/fileChange/requestApproval',{turnId:'turn-1'}));b.receive({...req('item/tool/requestUserInput',{turnId:'turn-2',questions:[]}),id:43});
  const first=b.list()[0];assert.notEqual(first.id,'42');assert.equal(first.threadId,'chat-a');
  assert.throws(()=>b.reply(first.id,{action:'bogus'}));assert.equal(b.list().length,2);
  b.reply(first.id,{action:'decline'});assert.equal(sent[0].id,42);assert.throws(()=>b.reply(first.id,{action:'accept'}),{statusCode:409});
  b.clear('chat-a','turn-1');assert.equal(b.list().length,1);b.resolved(43);assert.equal(b.list().length,0);
  b.receive(req('item/fileChange/requestApproval'));const old=b.list()[0].id;b.clear();b.receive(req('item/fileChange/requestApproval'));assert.notEqual(b.list()[0].id,old);
  for(const method of ['item/tool/call','account/chatgptAuthTokens/refresh','attestation/generate','future/newRequest'])b.receive(req(method));
  assert.equal(notices.length,4);assert.equal(sent.at(-4).result.success,false);assert.equal(sent.at(-1).error.code,-32601);
});
test('supported callback methods all have a UI decision set',()=>{for(const method of supportedRequests)assert.ok(requestActions(req(method)).length);});
