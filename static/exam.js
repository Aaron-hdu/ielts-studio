
async function examPage(id){
const s=await api("sessions/"+id);if(s.finished){go("report/"+id);return}
const fullExam=s.questions.length===2;
let qi=0,revision=s.revision,pending=[],saving=null,closed=false,lastT=s.events.at(-1)?.t||0;
const localKey="draft-"+id;let cache=null;try{cache=JSON.parse(localStorage.getItem(localKey)||"null")}catch(e){toast("浏览器缓存损坏，已载入本机已保存版本。")}
if(cache&&cache.base<=revision&&cache.base+cache.events.length>=revision){pending=cache.events.slice(revision-cache.base);for(const e of pending){const chars=Array.from(s.texts[e.q]);s.texts[e.q]=chars.slice(0,e.at).join("")+e.add+chars.slice(e.at+e.cut).join("")}lastT=pending.at(-1)?.t||lastT}
function persist(){localStorage.setItem(localKey,JSON.stringify({base:revision,events:pending}))}
async function save(){if(saving)return saving;if(!pending.length)return;const batch=pending.slice();saving=(async()=>{try{const r=await api("sessions/"+id+"/edits",{base:revision,events:batch});revision=r.revision;pending.splice(0,batch.length);persist();if($("#saved"))$("#saved").textContent="已保存到本机"}catch(e){if($("#saved"))$("#saved").textContent="待同步 · 草稿已留在浏览器";throw e}finally{saving=null}})();return saving}
function elapsed(){return Math.max(0,(s.timer.paused_at??Date.now())-s.started-s.timer.paused_ms)}
let changingPause=false;
async function togglePause(){
    if(changingPause||submitting)return;
    changingPause=true; const pausing=s.timer.paused_at==null;
    $("#essay").disabled=true; $("#pauseTimer").disabled=true; $("#submit").disabled=true;
    try {
        while(pending.length)await save();
        s.timer=await api("sessions/"+id+"/pause",{paused:pausing,revision});
    } catch(e){actionError(e)}
    finally{changingPause=false;if(!closed)show()}
}
function record(kind,old,next){const a=Array.from(old),b=Array.from(next);let p=0;while(p<a.length&&p<b.length&&a[p]===b[p])p++;let end=0;while(end<a.length-p&&end<b.length-p&&a[a.length-1-end]===b[b.length-1-end])end++;lastT=Math.max(lastT,(fullExam?Math.min(s.duration,Date.now()-s.started):elapsed()));pending.push({q:s.questions[qi].id,t:lastT,at:p,cut:a.length-p-end,add:b.slice(p,b.length-end).join(""),kind});persist()}
function examQuestion(q) {
    const cambridge=!!q.book, taskOne=q.task===1;
    const sourceLabel=cambridge && q.prompt_source==="transcription" ? " · Source transcription" : "";
    const prompt=cambridge && !q.prompt_source ? "Open the question source to read the original wording." : q.prompt;
    const figure=q.figure||q.figure_source;
    return `<div class="meta">${esc(cambridge?"Cambridge IELTS "+q.book+" · Test "+q.test:q.mode==="official"?"IELTS Academic sample":q.mode==="ai"?"AI practice":"Practice test")}${sourceLabel}</div>${q.source_notice?'<p class="hint">Using the saved local copy because the online source was unavailable.</p>':""}
        <h2>Writing Task ${q.task}</h2><div class="prompt">${esc(prompt)}</div>
        ${taskOne?studyVisual(q):""}${taskOne&&figure?`<img class="figure" src="${esc(figure)}" alt="Writing Task 1 diagram">`:""}
        ${(taskOne||!prompt)&&!figure&&q.mode==="official"&&q.embed?`<iframe src="${esc(q.embed)}" title="Original task and diagram"></iframe>`:""}
        ${q.source?`<a class="blocklink" href="${esc(q.source)}" target="_blank" rel="noreferrer">Question source ${icon("external")}</a>`:""}`;
}
function show(){const q=s.questions[qi];main.innerHTML=topbar(fullExam?"限时模考":"专项练习")+`<div class="row between examhead"><div class="chips">${s.questions.map((q,i)=>`<button class="chip ${i===qi?"on":""}" data-task="${i}">Task ${q.task}</button>`).join("")}</div><div class="inline"><span class="meta">${fullExam?"剩余":"已用"}</span><span class="timer" id="timer"></span>${fullExam?"":button(s.timer.paused_at==null?"暂停计时":"继续计时","pauseTimer")}${button("交卷","submit",true)}</div></div><div class="examcols"><section class="question">${examQuestion(q)}</section><section class="writebox"><div class="row between"><b>Your response</b><label class="mini">写作字体 <select id="writingFont"><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Verdana">Verdana</option></select></label><span class="meta">至少 ${q.task===1?150:250} 词</span></div><textarea id="essay" aria-label="作文编辑器" spellcheck="false" placeholder="Start writing here…"></textarea><div class="row between editorfoot"><span id="words"></span><span id="saved">已保存到本机</span></div></section></div><p class="pagefoot">${fullExam?"模考倒计时在切换页面后继续。":"暂停时可以离开页面，继续计时后再写。"}编辑过程自动记录。</p>`;const font=$("#writingFont");font.value=localStorage.getItem("writingFont")||"Arial";
function setFont(){const family=["Georgia","Verdana"].includes(font.value)?font.value:"Arial";$("#essay").style.fontFamily=family+(family==="Georgia"?", serif":", sans-serif");localStorage.setItem("writingFont",family)}
setFont();font.onchange=setFont;$("#essay").disabled=s.timer.paused_at!=null;if(!fullExam)$("#pauseTimer").onclick=togglePause;$("#essay").value=s.texts[q.id];$("#words").textContent=wordCount(s.texts[q.id])+" words";
$("#essay").oninput=e=>{if(fullExam&&Date.now()>=s.started+s.duration){e.target.value=s.texts[q.id];return}const next=e.target.value;record(e.inputType==="insertFromPaste"?"paste":e.inputType?.startsWith("delete")?"delete":"input",s.texts[q.id],next);s.texts[q.id]=next;$("#words").textContent=wordCount(next)+" words";$("#saved").textContent="正在保存…"};
main.querySelectorAll("[data-task]").forEach(b=>b.onclick=()=>{if(+b.dataset.task===qi||changingPause||s.timer.paused_at!=null)return;record("switch",s.texts[q.id],s.texts[q.id]);qi=+b.dataset.task;show()});$("#submit").onclick=()=>submit(false);tick()}
let submitting=false;async function submit(auto){if(submitting||changingPause)return;if(!auto&&!confirm("提交当前作文并结束计时？"))return;submitting=true;$("#essay").disabled=true;try{while(pending.length)await save();await api("sessions/"+id+"/submit",{revision});localStorage.removeItem(localKey);go("report/"+id)}catch(e){submitting=false;$("#essay").disabled=s.timer.paused_at!=null;actionError(e)}}
function tick(){if(closed)return;const left=s.started+s.duration-Date.now();if($("#timer"))$("#timer").textContent=clock(fullExam?left:elapsed());if(fullExam&&left<=0&&!submitting)submit(true)}
show();const timer=setInterval(tick,1000),sync=setInterval(()=>save().catch(()=>{}),1000);const away=()=>{if(submitting||closed||changingPause||s.timer.paused_at!=null)return;record(document.hidden?"away":"back",s.texts[s.questions[qi].id],s.texts[s.questions[qi].id]);save().catch(()=>{})};document.addEventListener("visibilitychange",away);cleanup=async()=>{closed=true;clearInterval(timer);clearInterval(sync);document.removeEventListener("visibilitychange",away);try{while(pending.length)await save()}catch(e){actionError(e)}};
}

