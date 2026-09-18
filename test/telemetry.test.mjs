import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contextUsage, quotaForModel, mergeRateLimits, validateSelection } from '../lib/telemetry.mjs';

test('context uses last request, not cumulative tokens; compaction can lower it', () => {
  const usage={last:{totalTokens:25000},total:{totalTokens:900000},modelContextWindow:100000};
  assert.equal(contextUsage(usage).percent,25);
  assert.equal(contextUsage({...usage,last:{totalTokens:10000}}).percent,10);
  assert.equal(contextUsage({last:{totalTokens:0},modelContextWindow:100000}).percent,0);
  assert.equal(contextUsage(null).percent,null);
  assert.equal(contextUsage({last:{totalTokens:100}}).percent,null);
});
test('weekly window is identified by duration, even in primary, with zero remaining preserved',()=>{
  const week={usedPercent:83,windowDurationMins:10080,resetsAt:123};
  for(const slot of ['primary','secondary']){
    const q=quotaForModel({rateLimits:{limitId:'codex',[slot]:week}},'model-a');
    assert.equal(q.remainingPercent,17);assert.equal(q.resetsAt,123);assert.equal(q.shared,true);
  }
  assert.equal(quotaForModel({rateLimits:{limitId:'codex',primary:{...week,usedPercent:100}}}).remainingPercent,0);
  assert.equal(quotaForModel({rateLimits:{limitId:'codex',primary:{...week,windowDurationMins:300}}}).remainingPercent,null);
  assert.equal(quotaForModel(null).remainingPercent,null);
});
test('selects model-specific quotas without conflating unrelated buckets',()=>{
  const bucket=(id,usedPercent)=>({limitId:id,secondary:{usedPercent,windowDurationMins:10080}});
  const snapshot={rateLimitsByLimitId:{codex:bucket('codex',10),'model-a':bucket('model-a',90),other:{...bucket('other',50),normalModelSlug:'model-b'}}};
  assert.equal(quotaForModel(snapshot,'model-a').remainingPercent,10);
  assert.equal(quotaForModel(snapshot,'model-b').remainingPercent,50);
  assert.equal(quotaForModel(snapshot,'model-c').remainingPercent,90);
  assert.equal(quotaForModel({rateLimits:bucket('unrelated',1)},'model-a').remainingPercent,null);
});
test('sparse quota updates preserve the weekly snapshot',()=>{
  const primary={usedPercent:83,windowDurationMins:10080};
  const old={rateLimits:{limitId:'codex',primary}};
  const merged=mergeRateLimits(old,{limitId:'codex',primary:null,secondary:{usedPercent:20,windowDurationMins:300}});
  assert.equal(quotaForModel(merged).remainingPercent,17);
});
test('model and effort validation rejects unsupported combinations',()=>{
  const models=[{model:'a',supportedReasoningEfforts:[{reasoningEffort:'low'}]}];
  assert.deepEqual(validateSelection(models,{model:'a',effort:'low'}),{model:'a',effort:'low'});
  assert.throws(()=>validateSelection(models,{model:'a',effort:'ultra'}));
  assert.throws(()=>validateSelection(models,{model:'unknown',effort:'low'}));
});
