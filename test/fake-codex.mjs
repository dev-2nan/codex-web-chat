import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {scenarioRequest} from './interaction-scenarios.mjs';
const output=value=>process.stdout.write(JSON.stringify(value)+'\n');
const models=[{model:'test-a',displayName:'Test A',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},{model:'test-b',displayName:'Test B',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}];
let turnNumber=0;
let callbackId=1000;
let catalogReads=0;
const callbacks=new Map(),activeTurns=new Map();
function finish(threadId,turnId,status='completed'){activeTurns.delete(threadId);output({method:'turn/completed',params:{threadId,turn:{id:turnId,status}}});}
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);if(m.id===undefined)return;
  if(!m.method){const r=callbacks.get(m.id);if(r){callbacks.delete(m.id);output({method:'serverRequest/resolved',params:{threadId:r.threadId,requestId:m.id}});output({method:'item/completed',params:{threadId:r.threadId,item:{id:'callback-'+m.id,type:'agentMessage',text:JSON.stringify(m.result||m.error)}}});finish(r.threadId,r.turnId);}return;}
  let result={};
  switch(m.method){
    case 'account/read':result={account:{type:'chatgpt'}};break;
    case 'account/login/start':result={type:'chatgpt',loginId:'test-login',authUrl:'https://example.com/login'};break;
    case 'turn/interrupt':{
      for(const [id,r] of callbacks)if(r.threadId===m.params.threadId)callbacks.delete(id);
      finish(m.params.threadId,m.params.turnId,'interrupted');break;
    }
    case 'turn/steer':{
      if(activeTurns.get(m.params.threadId)!==m.params.expectedTurnId){output({id:m.id,error:{code:-32600,message:'Turn already finished'}});return;}
      result={turnId:m.params.expectedTurnId};
      output({method:'item/completed',params:{threadId:m.params.threadId,item:{id:'steer-'+m.id,type:'agentMessage',text:JSON.stringify({steered:true,input:m.params.input})}}});
      finish(m.params.threadId,m.params.expectedTurnId);break;
    }
    case 'model/list':result=m.params.cursor?{data:[{model:'gpt-6.1-sol',displayName:'GPT-6.1-Sol',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'ultra'}]}],nextCursor:null}:{data:models.map(x=>({...x,description:'catalog '+(++catalogReads)})),nextCursor:'next-models'};break;
    case 'config/read':result={config:{model:'test-a',model_reasoning_effort:'high'}};break;
    case 'account/rateLimits/read':result={rateLimits:{limitId:'codex',primary:{usedPercent:83,windowDurationMins:10080,resetsAt:2000000000}}};break;
    case 'thread/start':case 'thread/resume':result={thread:{id:m.params.threadId||'test-thread-'+randomUUID()},model:m.params.model||'test-a',reasoningEffort:m.params.config?.model_reasoning_effort||'high'};break;
    case 'thread/read':result={thread:{id:m.params.threadId,model:'test-a',reasoningEffort:'high'}};break;
    case 'turn/start':{
      const turnId='turn-'+(++turnNumber),threadId=m.params.threadId;
      result={turn:{id:turnId,status:'inProgress'}};
      activeTurns.set(threadId,turnId);
      setTimeout(()=>{
        const text=m.params.input?.[0]?.text||'';
        if(text.startsWith('scenario:')){
          const scenario=text.slice(9);
          if(scenario==='disconnect'){process.exit(0);return;}
          if(scenario.startsWith('async-')){
            output({method:'item/completed',params:{threadId,item:{id:turnId+'-question',type:'agentMessage',text:'원하는 답변 방식을 선택해 주세요.',delivery:'async',questions:[{title:'설명 방식을 골라 주세요',options:['짧게','자세히']},{title:'추가로 알려줄 내용',options:null}]}}});
            if(scenario==='async-done')finish(threadId,turnId);
            else {let n=0;const timer=setInterval(()=>{if(!activeTurns.has(threadId)){clearInterval(timer);return;}output({method:'item/agentMessage/delta',params:{threadId,itemId:turnId+'-stream',delta:'Working '+(++n)+' '}});},1000);timer.unref();}
            return;
          }
          const request=scenarioRequest(scenario,threadId,turnId);
          if(request){const id=++callbackId;callbacks.set(id,{threadId,turnId});output({...request,id});return;}
        }
        output({method:'thread/settings/updated',params:{threadId,threadSettings:{model:m.params.model||'test-a',effort:m.params.effort||'high'}}});
        output({method:'item/completed',params:{threadId,item:{id:turnId+'-user',clientId:m.params.clientUserMessageId,type:'userMessage',content:m.params.input}}});
        output({method:'item/completed',params:{threadId,item:{id:turnId,type:'agentMessage',text:JSON.stringify(m.params)}}});
        output({method:'thread/tokenUsage/updated',params:{threadId,tokenUsage:{last:{totalTokens:25000},total:{totalTokens:900000},modelContextWindow:100000}}});
        output({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});
      },30);break;
    }
  }
  output({id:m.id,result});
});
