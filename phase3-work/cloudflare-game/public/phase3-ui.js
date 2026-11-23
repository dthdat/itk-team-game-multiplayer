(() => {
  document.addEventListener('contextmenu',event=>event.preventDefault());
  const enabled=window.ITK_GAME_CONFIG?.serviceEnabled===true;
  const language='en';
  const el=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const root=el('aside');root.id='phase3-player';root.style.cssText='position:fixed;z-index:40;right:14px;top:196px;width:min(340px,calc(100vw - 28px));pointer-events:none';
  const toggle=el('button');toggle.type='button';toggle.className='panel';toggle.style.cssText='padding:10px;cursor:pointer;pointer-events:auto;float:right';
  const panel=el('div');panel.className='panel';panel.hidden=true;panel.style.cssText='clear:both;padding:14px;max-height:60vh;overflow:auto;pointer-events:auto';
  const note=el('p'),load=el('button'),content=el('div'),close=el('button');load.type=close.type='button';
  const text=(en,vi)=>language==='vi'?vi:en;
  function paint(){toggle.textContent='Player';note.textContent='No sign-in needed. Your name is remembered on this browser. Saved progress uses this browser’s guest session.';load.textContent='Mission progress & leaderboard';close.textContent='Close';window.ITK_SET_JUMP_LANGUAGE?.(language);}
  toggle.onclick=()=>panel.hidden=!panel.hidden;close.onclick=()=>panel.hidden=true;
  load.onclick=async()=>{content.textContent=text('Loading…','Đang tải…');if(!enabled){content.textContent=text('Multiplayer is offline. All eight missions can still be opened in the office.','Nhiều người chơi đang ngoại tuyến. Vẫn có thể mở cả tám nhiệm vụ.');return;}
    try{const responses=await Promise.all(['/api/progress','/api/submissions','/api/leaderboard'].map(p=>fetch(p,{credentials:'same-origin'})));if(responses.some(r=>!r.ok))throw Error();const [progress,history,board]=await Promise.all(responses.map(r=>r.json()));content.textContent='';
      const section=(heading,value)=>{const h=el('h3',heading),pre=el('pre',value);pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';content.append(h,pre);};
      section(text('Eight missions','Tám nhiệm vụ'),window.AP.MISSIONS.map((m,i)=>{const d=progress.progress.done?.[m.id];return (i+1)+'. '+(language==='vi'?window.ITK_GAME_TRANSLATIONS?.[m.id]?.title||m.title:m.title)+' · '+(d?d.score+'% · '+d.xp+' XP':text('Pending / not completed','Đang chờ / chưa hoàn thành'));}).join('\n'));
      section(text('Total XP','Tổng XP'),String(progress.progress.xp)+' XP · '+progress.progress.rank);
      section(text('Submission history','Lịch sử bài nộp'),history.submissions.map(s=>s.missionId+' · '+({pending:text('Pending','Đang chờ'),reviewing:text('Reviewing','Đang chấm'),graded:text('Reviewed','Đã chấm'),retryable:text('Waiting to retry','Chờ thử lại'),failed:text('Review unavailable','Chấm không khả dụng')}[s.state]||s.state)+(s.score!==null?' · '+s.score+'% · +'+s.xp+' XP':'')+'\n'+(s.result?JSON.parse(s.result).summary+'\n':'')+s.answer.slice(0,300)).join('\n\n')||text('No submissions','Chưa có bài nộp'));
      for(const submission of history.submissions.filter(s=>s.state==='graded'&&s.result).slice(0,20)){
        const view=el('button',text('View AI response','Xem phản hồi AI')+' · '+submission.missionId);view.type='button';view.className='btn';view.style.cssText='margin:4px 4px 8px 0;max-width:100%;white-space:normal';view.onclick=()=>{panel.hidden=true;window.ITK_OPEN_REVIEW?.(submission,progress.progress);};content.append(view);
      }
      section(text('Leaderboard · verified XP only','Bảng xếp hạng · chỉ XP đã xác minh'),board.leaders.map((p,i)=>(p.position||i+1)+'. '+p.name+' · '+p.xp+' XP').join('\n')||text('No verified XP yet','Chưa có XP được xác minh'));
    }catch{content.textContent=text('Progress is temporarily unavailable. You can keep exploring the office.','Tạm thời không tải được tiến độ. Bạn vẫn có thể khám phá văn phòng.');}};
  let tracked='',timer,busy=false,started=0;
  async function checkReview(){
    clearTimeout(timer);if(!tracked||busy||document.hidden||!navigator.onLine)return;
    busy=true;
    try{const response=await fetch('/api/submissions/'+encodeURIComponent(tracked),{credentials:'same-origin'});if(response.status===401||response.status===404){tracked='';return;}if(!response.ok)throw Error();const data=await response.json();if(data.submission.submissionId!==tracked)return;
      window.dispatchEvent(new CustomEvent('itk-ai-review',{detail:data}));
      if(['graded','failed'].includes(data.submission.state)){tracked='';if(!panel.hidden)load.click();return;}
    }catch{}finally{busy=false;if(tracked&&Date.now()-started<600000)timer=setTimeout(checkReview,30000);}
  }
  window.ITK_TRACK_SUBMISSION=id=>{tracked=id;started=Date.now();checkReview();};
  window.addEventListener('itk-review-refresh',()=>{if(tracked)checkReview();});
  window.addEventListener('online',()=>{if(tracked)checkReview();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&tracked)checkReview();});
  window.ITK_SESSION_PROMISE?.then(data=>{const pending=data?.submissions?.find(s=>s.gradingEnabled&&['pending','reviewing','retryable'].includes(s.state));if(pending)window.ITK_TRACK_SUBMISSION(pending.submissionId);}).catch(()=>{});
  const responsePanel=el('section');responsePanel.id='ai-response-panel';responsePanel.style.cssText='margin-top:18px;padding:14px;border:1px solid var(--line,#53616b);border-radius:8px';
  const responseTitle=el('h3'),responseNote=el('p'),responseMeta=el('p'),responseLabel=el('label'),responseBox=el('textarea');
  responseTitle.id='ai-response-title';responseNote.id='ai-response-note';responseMeta.id='ai-response-meta';responseBox.id='ai-response-output';responseBox.readOnly=true;responseBox.rows=12;responseBox.spellcheck=false;responseLabel.htmlFor=responseBox.id;
  responseMeta.style.cssText='font-size:12px;line-height:1.6;overflow-wrap:anywhere';responseBox.style.cssText='width:100%;min-height:220px;max-height:380px;resize:vertical;font:12px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere';
  const snapshotDetails=el('details'),snapshotTitle=el('summary'),snapshot=el('textarea'),versionNote=el('p');snapshot.id='review-submitted-answer';snapshot.readOnly=true;snapshot.rows=5;snapshot.style.cssText='width:100%;resize:vertical';versionNote.id='review-version-note';snapshotDetails.append(snapshotTitle,snapshot);responsePanel.append(responseTitle,responseNote,responseMeta,versionNote,snapshotDetails,responseLabel,responseBox);document.querySelector('#m-result > details').before(responsePanel);
  function responseLabels(locale){const vi=locale==='vi';snapshotTitle.textContent=vi?'Bài đã nộp được chấm':'Submitted answer being reviewed';snapshot.value='';versionNote.textContent='';responseTitle.textContent=vi?'Phản hồi thực tế từ AI':'Actual AI review response';responseLabel.textContent=vi?'Nội dung phản hồi cuối cùng (JSON)':'Final response content (JSON)';return vi;}
  window.ITK_REVIEW_OUTPUT={
    clear(locale){const vi=responseLabels(locale);responseMeta.textContent='';responseNote.textContent=vi?'Chưa có phản hồi AI đã xác thực.':'No validated AI response has returned yet.';responseBox.value='';},
    status(state,locale){const vi=responseLabels(locale);responseMeta.textContent='';responseBox.value='';responseNote.textContent=state==='failed'?(vi?'Chưa có phản hồi AI hợp lệ để hiển thị. Bài của bạn vẫn được lưu.':'No valid AI response is available to display. Your answer is still saved.'):(vi?'Bài đã được lưu. Phản hồi AI sẽ xuất hiện sau khi chấm xong.':'Your answer is saved. The AI response will appear after review.');},
    show(review,submission,locale,reused){const vi=responseLabels(locale);
      snapshot.value=submission.answer||'';const changed=typeof submission.answer==='string'&&document.querySelector('#m-text').value!==submission.answer;versionNote.textContent=(changed?(vi?'Bản nháp đã thay đổi. Kết quả này chỉ dành cho bài đã nộp bên dưới. ':'Draft changed. This review applies only to the submitted answer below. '):'')+(submission.locale!==locale?(vi?'Phản hồi giữ nguyên ngôn ngữ lúc nộp. ':'Feedback keeps the language used at submission. '):'')+(review.provider==='groq'&&review.rubricVersion!==2?(vi?'Phản hồi cũ: chưa có bằng chứng và gợi ý sửa theo mẫu mới.':'Older review: evidence and suggested changes were not recorded in this format.'): '');
      responseNote.textContent=review.provider!=='groq'?(vi?'Kiểm tra độ dài cục bộ; không gọi AI.':'Local minimum-length check; no AI request was made.'):(reused?(vi?'Đang xem lại phản hồi đã lưu; lần xem này không gọi AI mới.':'Showing a saved review; this view did not make a new AI request.'):(vi?'Đây là phản hồi chấm prompt thực tế. AI đánh giá prompt, không thực hiện nhiệm vụ kỹ thuật bên trong prompt.':'This is the actual prompt-grading response. The AI evaluates your prompt; it does not execute the engineering task inside it.'));
      const pieces=[review.provider+' · '+review.model];
      if(review.reasoningEffort)pieces.push((vi?'Mức suy luận: ':'Reasoning effort: ')+review.reasoningEffort);
      if(Number.isFinite(review.providerMs))pieces.push((vi?'Thời gian gọi AI: ':'AI request time: ')+(review.providerMs/1000).toFixed(2)+' s');
      else if(review.provider==='groq')pieces.push(vi?'Bài cũ: chưa ghi thời gian gọi AI':'Older review: request timing was not recorded');
      if(Number.isFinite(review.queueWaitMs))pieces.push((vi?'Chờ hàng đợi: ':'Queue wait: ')+(review.queueWaitMs/1000).toFixed(2)+' s');
      if(Number.isInteger(review.promptTokens))pieces.push((vi?'Token đầu vào: ':'Input tokens: ')+review.promptTokens);
      if(Number.isInteger(review.completionTokens))pieces.push((vi?'Token đầu ra: ':'Output tokens: ')+review.completionTokens);
      if(Number.isInteger(review.reasoningTokens))pieces.push((vi?'Trong đó token suy luận: ':'Of which reasoning tokens: ')+review.reasoningTokens);
      if(Number.isInteger(review.tokens))pieces.push((vi?'Tổng token: ':'Total tokens: ')+review.tokens);
      if(!review.responseText&&review.provider==='groq')pieces.push(vi?'Hiển thị kết quả đã xác thực; bản gốc chưa được lưu cho bài cũ':'Showing the saved validated result; original response text was not stored for this older review');
      responseMeta.textContent=pieces.join(' · ');
      const final=review.responseText?JSON.parse(review.responseText):{summary:review.summary,items:review.items};responseBox.value=JSON.stringify(final,null,2);
    }
  };
  panel.append(note,load,content,close);root.append(toggle,panel);document.body.append(root);window.ITK_P3_LANG=language;paint();
})();
