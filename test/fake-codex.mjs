import {createInterface} from 'node:readline';
const output=value=>process.stdout.write(JSON.stringify(value)+'\n');
const models=[{model:'test-a',displayName:'Test A',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}]},{model:'test-b',displayName:'Test B',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}];
let turnNumber=0,threadNumber=0;
createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);if(m.id===undefined)return;
  let result={};
  switch(m.method){
    case 'model/list':result={data:models,nextCursor:null};break;
    case 'config/read':result={config:{model:'test-a',model_reasoning_effort:'high'}};break;
    case 'account/rateLimits/read':result={rateLimits:{limitId:'codex',primary:{usedPercent:83,windowDurationMins:10080,resetsAt:2000000000}}};break;
    case 'thread/start':case 'thread/resume':result={thread:{id:m.params.threadId||'test-thread-'+(++threadNumber)},model:m.params.model||'test-a',reasoningEffort:m.params.config?.model_reasoning_effort||'high'};break;
    case 'thread/read':result={thread:{id:m.params.threadId,model:'test-a',reasoningEffort:'high'}};break;
    case 'turn/start':{
      const turnId='turn-'+(++turnNumber),threadId=m.params.threadId;
      result={turn:{id:turnId,status:'inProgress'}};
      setTimeout(()=>{
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
