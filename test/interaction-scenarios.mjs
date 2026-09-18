// Synthetic data only. These scenarios exercise callback routing without running tools.
export function scenarioRequest(name,threadId,turnId){
  const common={threadId,turnId,itemId:'request-item',reason:'웹 상호작용 확인용 요청입니다.'};
  const cases={
    approval:{method:'item/commandExecution/requestApproval',params:{...common,command:'git status',cwd:'C:/example',proposedExecpolicyAmendment:['git','status']}},
    file:{method:'item/fileChange/requestApproval',params:{...common,grantRoot:'C:/example/docs'}},
    choice:{method:'item/tool/requestUserInput',params:{...common,isBlocking:true,questions:[{id:'style',header:'답변 스타일',question:'어떤 방식으로 설명할까요?',options:[{label:'짧게',description:'핵심만 간단히'},{label:'자세히',description:'예시와 함께 설명'}],isOther:true,isSecret:false},{id:'name',header:'이름',question:'어떻게 불러 드릴까요?',options:null,isOther:true,isSecret:false}]}},
    permission:{method:'item/permissions/requestApproval',params:{...common,permissions:{network:{enabled:true},fileSystem:{read:['C:/example/docs'],write:null}}}},
    form:{method:'mcpServer/elicitation/request',params:{...common,serverName:'Example MCP',mode:'form',message:'보고서 설정을 선택해 주세요.',requestedSchema:{type:'object',required:['title','count','confirmed'],properties:{title:{type:'string',title:'보고서 제목',minLength:2},count:{type:'integer',title:'항목 수',minimum:1,maximum:10},confirmed:{type:'boolean',title:'내용을 확인했나요?'},tags:{type:'array',title:'포함할 내용',items:{anyOf:[{const:'summary',title:'요약'},{const:'details',title:'상세'}]}}}}}},
    url:{method:'mcpServer/elicitation/request',params:{...common,serverName:'Example MCP',mode:'url',message:'외부 페이지에서 직접 확인해 주세요.',url:'https://example.com/confirmation',elicitationId:'example-confirm'}},
    unknown:{method:'future/unsupported',params:common},
  };
  return cases[name];
}
