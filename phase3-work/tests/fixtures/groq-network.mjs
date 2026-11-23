// This fixture is never part of deployment. Refuse production paths/env.
if(process.env.NODE_ENV!=='test'||!String(process.env.SQLITE_PATH).includes('itk-grading-api-'))throw Error('Network fixture requires an isolated test database');
globalThis.fetch=async(url,options)=>{
 if(url!=='https://api.groq.com/openai/v1/chat/completions')throw Error('Unexpected fixture network request');
 const request=JSON.parse(options.body),input=JSON.parse(request.messages[1].content);
 const result={summary:input.locale==='vi'?'Đã chấm xong.':'Assessment complete.',items:input.rubric.map(r=>({criterionId:r.id,passed:true,feedback:'Fixture criterion.',evidence:input.submittedAnswer.slice(0,40),improvement:''}))};
 return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}],usage:{total_tokens:100}}),{status:200,headers:{'content-type':'application/json'}});
};
