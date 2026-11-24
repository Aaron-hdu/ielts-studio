"use strict";
const $=(s,root=document)=>root.querySelector(s);
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const paths={book:'M3 4c3-1 6-.5 9 1.5C15 3.5 18 3 21 4v15c-3-1-6-.5-9 1.5C9 18.5 6 18 3 19z M12 5.5v15',home:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',library:'M3 4h4v16H3z M10 4h3v16h-3z M15 5l3-1 4 15-3 1z',pen:'M4 15 15 4a2.8 2.8 0 0 1 4 4L8 19l-5 1z M13 6l4 4',cards:'M4 6h15v13H4z M7 3h14v12 M8 11h7 M8 14h4',clock:'M12 3a9 9 0 1 0 .01 0 M12 7v5l3 2',chart:'M4 3v17h17 M7 15l4-5 4 2 5-6',arrow:'M4 12h15 M14 6l6 6-6 6',chev:'m9 5 7 7-7 7',settings:'M4 7h5m4 0h7M4 17h9m4 0h3 M9 4v6m4 4v6',calendar:'M3 6h18v15H3z M3 10h18 M7 3v6 M17 3v6',leaf:'M20 3C10 2 4 6 5 13s10 7 13 0c1-3 1-6 2-10z M3 21l12-13',doc:'M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6',external:'M13 4h7v7 M11 13l9-9 M10 6H4v14h14v-6',close:'M5 5l14 14 M19 5 5 19',check:'m4 12 5 5L20 6',play:'m7 4 13 8-13 8z',folder:'M3 7V4h7l2 3h9v13H3z',repeat:'M4 11a8 8 0 1 1 2 7 M4 4v7h7',target:'M12 3a9 9 0 1 0 .01 0 M12 8a4 4 0 1 0 .01 0',arrowup:'m6 18 12-12 M6 6h12v12',history:'M3 12a9 9 0 1 1 3 7 M3 5v7h7 M12 7v5l4 2'};
const icon=n=>`<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[n]||paths.doc}"/></svg>`;
const main=$("#main"),dlg=$("#dialog");
let bank=[],overview={},routeSerial=0,cleanup=async()=>{},toastTimer;
function toast(msg){$("#toast").textContent=msg;$("#toast").classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("#toast").classList.remove("show"),3800)}
async function api(path,body){const r=await fetch("/api/"+path,{method:body===undefined?"GET":"POST",headers:{"X-Studio":"1","Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||"本机服务未能完成请求。"),{status:r.status});return data}
function go(route){location.hash=route}
function modal(title,body){if(dlg.open)dlg.close();dlg.innerHTML=`<header class="modal-head"><h2>${esc(title)}</h2><button aria-label="关闭" data-close>${icon("close")}</button></header><div class="modal-body">${body}</div>`;dlg.showModal();$("[data-close]",dlg).onclick=()=>dlg.close()}
function actionError(err){toast(err.message||"操作失败，请重试。")}
window.addEventListener("unhandledrejection",e=>{e.preventDefault();actionError(e.reason)});
function niceDate(t){return new Intl.DateTimeFormat("zh-CN",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(t))}
function clock(ms){const n=Math.max(0,Math.floor(ms/1000));return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0")}
function wordCount(s){return (s.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)||[]).length}
function group(q){return q.book?`剑雅 ${q.book}`:q.group}
function label(q){if(q.mode==="ai")return "AI 原创";return `${group(q)} · ${q.book?"Test":"组"} ${q.test}`}
function tag(t,c=""){return `<span class="pill ${c}">${esc(t)}</span>`}
function button(t,id,primary=false,ico=""){return `<button type="button" class="btn ${primary?"primary":""}" id="${id}">${ico?icon(ico):""}${esc(t)}</button>`}
function heading(k,t,desc=""){return `<div class="heading"><div><div class="eyebrow">${esc(k)}</div><h1>${esc(t)}</h1>${desc?`<p class="sub">${esc(desc)}</p>`:""}</div></div>`}
function topbar(s){const date=new Intl.DateTimeFormat("zh-CN",{month:"long",day:"numeric",weekday:"long"}).format(new Date());return `<header class="topbar"><span>个人工作空间　/　${esc(s)}</span><span>${icon("calendar")}${date}</span></header>`}
function side(page){const nav=[["home","home","工作台"],["plan","calendar","写作计划"],["bank","library","写作题库"],["history","history","写作记录"],["review","cards","表达练习"]];const link=([r,i,n])=>`<a href="#${r}" class="navitem ${r===page?"active":""}" ${r===page?'aria-current="page"':""}>${icon(i)}${n}</a>`;$("#sidebar").innerHTML=`<a class="brand" href="#home"><span class="monogram">${icon("book")}</span><span><b>页间写作室</b><small>IELTS WRITING STUDIO</small></span></a><div class="navlabel">工作空间</div><nav class="side-nav">${nav.map(link).join("")}</nav><div class="sidefoot">${link(["settings","settings","工作室设置"])}<div class="local"><span class="dot"></span>本机工作空间</div></div>`}
function empty(t,p,i="doc"){return `<div class="empty"><span class="empty-icon">${icon(i)}</span><div><b>${esc(t)}</b><p>${esc(p)}</p></div></div>`}
function writingRecords(){
    return [...overview.sessions,...(overview.historical||[])].sort((a,b)=>
        (b.started ?? Date.parse(b.date)) - (a.started ?? Date.parse(a.date)));
}
function paperName(q) {
    if (q.book) return `C${q.book} Test ${q.test}`;
    return q.group ? [q.group, q.test && `第 ${q.test} 组`].filter(Boolean).join(" · ") : "";
}
function reportTitle(q) {
    return [paperName(q), `Task ${q.task}`, q.title].filter(Boolean).join(" · ");
}
function historicalQuestion(item) {
    const q = bank.find(entry => entry.id === item.question);
    const prefix = item.title.match(/^C(\d+) Test (\d+)\s*·\s*/i);
    return {...(prefix ? {book:prefix[1],test:prefix[2]} : {}), ...q, task:item.task,
        title:prefix ? item.title.slice(prefix[0].length) : item.title};
}
function reportQuestion(q, recordedPrompt) {
    const figure = q.figure || q.figure_source;
    const prompt = recordedPrompt || q.prompt;
    const caption = !recordedPrompt && q.prompt_source==="transcription" ? "作答题目（题源转录）" : !recordedPrompt && !q.prompt_source && q.mode === "link" ? "作答题目（题意整理）" : "作答题目";
    return `<section class="panel report-section report-question"><h2>${caption}</h2>
        <p class="essaytext topgap">${esc(prompt || (q.mode==="official"?"题面见官方样题对应页。":"原记录仅保存了题目简称：" + q.title))}</p>
        ${studyVisual(q)}
        ${figure ? `<img class="figure" src="${esc(figure)}" alt="${esc(q.title)}题图">` : ""}
        ${(q.task===1 || !prompt) && !figure && q.mode === "official" && q.embed ? `<iframe loading="lazy" src="${esc(q.embed)}" title="官方题面"></iframe>` : ""}
        ${q.source ? `<a class="blocklink" href="${esc(q.source)}" target="_blank" rel="noreferrer">查看原题来源 ${icon("external")}</a>` : ""}</section>`;
}
function recordRow(s){
    if(s.drafts) return `<a class="record" href="#archive/${esc(s.id)}"><span><b>${esc(reportTitle(historicalQuestion(s)))}</b><small>${esc(s.date)} · ${s.drafts.length} 份稿件</small></span><span class="inline">${tag("历史练习")}${icon("chev")}</span></a>`;
    const questions = s.questions.map(q => ({...bank.find(entry => entry.id === q.id), ...q}));
    const title = questions.length === 1 ? reportTitle(questions[0]) :
        [paperName(questions[0]), questions.map(q => `Task ${q.task} · ${q.title}`).join(" / ")].filter(Boolean).join(" · ");
    return `<a class="record" href="#${s.finished?"report":"exam"}/${s.id}"><span><b>${esc(title)}</b><small>${niceDate(s.started)} · ${s.questions.length===2?"完整模考 · ":""}${s.words} 词</small></span><span class="inline">${tag(s.finished?(s.graded?"已批改":"已交卷"):"草稿",s.graded?"green":"")}${icon("chev")}</span></a>`}
function manualSource(ids){
    const qs=ids.map(id=>bank.find(q=>q.id===id)).filter(q=>q?.source);
    modal("从题源页作答",`<form class="stack" id="sourceForm"><p class="hint">请在题源页核对题号，将英文原题贴入下方。Task 1 可对照题源页的图表作答，也可附上从浏览器保存的题图。</p>
        ${qs.map(q=>`<label>Task ${q.task} · ${esc(q.title)} <a href="${esc(q.source)}" class="blocklink" target="_blank" rel="noreferrer">打开题源</a>
        <textarea required minlength="12" maxlength="15000" rows="4" data-source="${esc(q.id)}" placeholder="Paste the English question here…"></textarea></label>
        ${q.mode==="link" && q.task===1?`<label>配图（可选，最大 4 MB）<input type="file" data-image="${esc(q.id)}" accept="image/jpeg,image/png,image/webp"></label>`:""}`).join("")}
        <button class="btn primary">开始计时写作</button></form>`);
    $("#sourceForm").onsubmit=async e=>{
        e.preventDefault();const form=e.currentTarget,btn=form.querySelector("button");btn.disabled=true;
        const prompts=Object.fromEntries(Array.from(form.querySelectorAll("textarea"),t=>[t.dataset.source,t.value]));
        try{
            const images={};
            for(const input of form.querySelectorAll("[data-image]")){
                const file=input.files[0];if(!file)continue;
                if(file.size>4_000_000)throw Error("请选择小于 4 MB 的图片。");
                images[input.dataset.image]=await new Promise((resolve,reject)=>{
                    const reader=new FileReader();
                    reader.onload=()=>resolve(reader.result.split(",")[1]);
                    reader.onerror=()=>reject(Error("无法读取图片。"));
                    reader.readAsDataURL(file);
                });
            }
            await start(ids,null,prompts,images)
        }catch(err){actionError(err)}finally{btn.disabled=false}
    };
}
async function start(ids,parent,prompts,images){
    try{
        const s=await api("sessions",{questions:ids,parent:parent||null,source_prompts:prompts,source_images:images});
        if(dlg.open)dlg.close();go("exam/"+s.id);
    }catch(e){
        if(e.status!==502||parent||prompts)throw e;
        manualSource(ids);toast(e.message);
    }
}
function sets(){const pairs=[];for(const q of bank.filter(q=>q.task===1 && q.mode!=="ai")){const q2=bank.find(v=>v.task===2&&v.book===q.book&&v.test===q.test&&v.group===q.group);if(q2)pairs.push([q,q2])}return pairs.sort((a,b)=>b[0].book-a[0].book||a[0].test-b[0].test)}
function chooseSet(){const pairs=sets();if(!pairs.length)return toast("暂无整套模考。");const groups=[...new Set(pairs.map(p=>group(p[0])))];modal("开始完整模考",`<div class="stack"><p class="hint">共 60 分钟，可在两项任务间切换。选好套题后开始计时。</p><label>题册<select id="setgroup">${groups.map(g=>`<option>${esc(g)}</option>`).join("")}</select></label><label>套题<select id="settest"></select></label><div class="notice" id="setinfo"></div>${button("开始 60 分钟模考","begin",true,"clock")}</div>`);const pick=()=>{const [q,v]=pairs[Number($("#settest").value)];$("#setinfo").textContent="Task 1　"+q.title+"　 /　Task 2　"+v.title};const populate=()=>{$("#settest").innerHTML=pairs.map(([q],i)=>group(q)===$("#setgroup").value?`<option value="${i}">${q.book?"Test":"第"} ${q.test}${q.book?"":" 组"}</option>`:"").join("");pick()};populate();$("#setgroup").onchange=populate;$("#settest").onchange=pick;$("#begin").onclick=async e=>{e.currentTarget.disabled=true;try{await start(pairs[+$("#settest").value].map(q=>q.id))}catch(x){$("#begin").disabled=false;throw x}}}
function home(){const rec=writingRecords(),active=overview.sessions.find(s=>!s.finished),now=overview.due;
const tile=(cl,ic,en,title,desc,tail,route)=>`<a href="#${route}" class="tile"><div class="tiletop"><span class="tile-icon ${cl}">${icon(ic)}</span><span class="serial">${en}</span></div><strong>${title}</strong><p>${desc}</p><div class="tail"><span>${tail}</span>${icon("arrow")}</div></a>`;
main.innerHTML=topbar("工作台")+heading("Writing desk","写作工作台")+`<section class="hero"><div class="hero-copy"><div class="eyebrow">Academic Writing · 60 MIN</div><h2>雅思写作限时模考</h2><p>两项写作任务，一次完整练习。交卷后回看每一次落笔与修改。</p><div class="actions">${button(active?"继续上次写作":"开始限时模考","mock",true,"pen")}<a href="#bank" class="btn plain">浏览题库 ${icon("arrow")}</a></div></div><img class="hero-art" src="/desk.webp" alt=""></section><section class="panel plan-home" id="nextStudy"><a href="#plan">查看写作计划</a></section><div class="sec"><h2>专项练习</h2><span class="meta">Academic IELTS</span></div><div class="grid3">${tile("purple","chart","Task 01","图表写作","描述数据、对比趋势与流程。","20 分钟 · 150 词","#bank?task=1".slice(1))}${tile("green","pen","Task 02","议论文写作","展开论点，组织论据与例证。","40 分钟 · 250 词","bank?task=2")}${tile("peach","cards","Recall","表达练习","快速翻看、例句挖空和回译。",now?`${now} 条待复习`:"查看表达练习","review")}</div><div class="sec"><h2>最近写作</h2><a class="blocklink" href="#history">全部记录 ${icon("arrow")}</a></div><div class="listbox">${rec.length?rec.slice(0,3).map(recordRow).join(""):empty("还没有写作记录","完成第一次练习后，作文、回放和批改报告会保存在这里。","history")}</div>`;$("#mock").onclick=()=>active?go("exam/"+active.id):chooseSet();homeRecommendation($("#nextStudy")).catch(actionError)}
function bankPage(params){let currentTask=params.get("task")||"",limit=24;
const books=[...new Set(bank.map(group))].sort((a,b)=>(parseInt(b.split(" ")[1])||0)-(parseInt(a.split(" ")[1])||0));
main.innerHTML=topbar("写作题库")+heading("Question library","写作题库",`剑雅历册、官方样题与离线原创练习。`)+`<div class="toolbar"><input id="search" class="field search" type="search" aria-label="搜索题目" placeholder="搜索主题、题册或题号…"><select id="book" aria-label="选择题册"><option value="">全部题册</option>${books.map(s=>`<option>${esc(s)}</option>`).join("")}</select><select id="task" aria-label="选择任务"><option value="">全部任务</option><option value="1">Task 1</option><option value="2">Task 2</option></select>${button("整套模考","full",true,"clock")}</div><div class="sec"><b id="count"></b><span class="meta">按题册与套题排列</span></div><div class="qlist" id="qlist"></div><div class="topgap" id="more"></div>`;
$("#task").value=currentTask;$("#full").onclick=chooseSet;function render(){const search=$("#search").value.trim().toLowerCase(),series=$("#book").value,t=$("#task").value;
const matches=bank.filter(q=>(!series||group(q)===series)&&(!t||q.task==t)&&(!search||[q.title,label(q),q.id,q.prompt].join(" ").toLowerCase().includes(search))).sort((a,b)=>b.book-a.book||a.test-b.test||a.task-b.task);
$("#count").textContent=matches.length+" 道题目";$("#qlist").innerHTML=matches.slice(0,limit).map(q=>`<button class="qcard" data-q="${esc(q.id)}"><span class="row between"><span class="meta">${esc(label(q))}</span>${tag("Task "+q.task,q.task===2?"green":"")}</span><h3>${esc(q.title)}</h3><span class="mini">${q.task*20} 分钟 · ${q.task===1?150:250} 词　·　${q.mode==="link"?"剑雅题源":q.mode==="official"?"官方在线样题":"离线可练"}</span></button>`).join("")||empty("没有匹配的题目","可更换筛选条件或缩短关键词。");
$("#qlist").querySelectorAll("[data-q]").forEach(el=>el.onclick=()=>previewQuestion(bank.find(q=>q.id===el.dataset.q)));$("#more").innerHTML=matches.length>limit?button("显示更多题目","loadMore"):"";if($("#loadMore"))$("#loadMore").onclick=()=>{limit+=32;render()}}
for(const id of ["#task","#book","#search"])$(id).oninput=()=>{limit=24;render()};render()}
async function previewQuestion(q){
    modal(q.title,'<div id="questionPreview" class="stack" aria-live="polite"></div>');
    const panel=$("#questionPreview",dlg);
    const source=q.source?`<a class="blocklink" href="${esc(q.source)}" target="_blank" rel="noreferrer">打开题源 ${icon("external")}</a>`:"";
    async function load(){
        panel.innerHTML='<p>正在读取题面…</p>'+source;
        try {
            const item=["link","official"].includes(q.mode)?await api("questions/"+encodeURIComponent(q.id)+"/preview"):q;
            if(!panel.isConnected||!dlg.open)return;
            const image=item.figure||item.figure_source;
            panel.innerHTML=`<div class="row">${tag(label(q))}${tag("Task "+q.task)}${tag(q.task*20+" 分钟")}</div>
                ${item.prompt?`<p class="bodytext" lang="en">${esc(item.prompt)}</p>`:""}${studyVisual(item)}
                ${q.task===1&&image?`<img class="figure" src="${esc(image)}" alt="题目图表">`:""}
                ${item.source_notice?`<p class="notice">${esc(item.source_notice)}</p>`:""}
                ${item.chart_warning?`<p class="notice">题图读取失败。${esc(item.chart_warning)}</p>`:""}
                ${item.prompt_source==="official_pdf"?`<iframe src="${esc(item.embed)}" title="官方样题"></iframe>`:""}
                ${q.mode==="link"?`<p class="hint">${item.prompt_source==="user_transcription"?"本题为手动贴入的英文原文。":"英文题面由第三方转录，可打开题源核对。"}</p>`:""}${source}${button("开始专项写作","begin",true,"pen")}${q.mode==="official"?button("贴入英文原题后写作","pasteOfficial"):""}`;
            if(q.mode==="official")$("#pasteOfficial",panel).onclick=()=>manualSource([q.id]);
            $("#begin",panel).onclick=async e=>{
                const btn=e.currentTarget;btn.disabled=true;btn.textContent="正在准备写作…";
                try{await start([q.id])}catch(err){btn.disabled=false;btn.textContent="开始专项写作";actionError(err)}
            };
        }catch(err){
            if(!panel.isConnected||!dlg.open)return;
            panel.innerHTML=`<p class="notice">${esc(err.message)}</p>${source}${button("重新读取","retrySource")}${button("从题源页贴入原题","pasteSource")}`;
            $("#pasteSource",panel).onclick=()=>manualSource([q.id]);
            $("#retrySource",panel).onclick=load;
        }
    }
    await load();
}
function historyPage(){main.innerHTML=topbar("写作记录")+heading("Writing archive","写作记录","按日期回看原稿、修改稿和反馈。")+`<div class="listbox">${writingRecords().map(recordRow).join("")||empty("还没有作文","在题库里选一道题，即可开始第一篇。")}</div>`}
let routeChain=Promise.resolve();
function requestRoute(){const n=++routeSerial;routeChain=routeChain.catch(()=>{}).then(async()=>{if(n!==routeSerial)return;await cleanup();cleanup=async()=>{};if(n!==routeSerial)return;try{const hash=location.hash.slice(1)||"home",[path,query=""]=hash.split("?"),[page,id]=path.split("/");if(!bank.length)bank=await api("questions");overview=await api("overview");if(n!==routeSerial)return;side(({exam:"bank",report:"history",archive:"history"})[page]||page);if(dlg.open)dlg.close();window.scrollTo(0,0);switch(page){case "plan":await planPage(new URLSearchParams(query));break;case "bank":bankPage(new URLSearchParams(query));break;case "exam":await examPage(id);break;case "report":await reportPage(id);break;case "history":historyPage();break;case "archive":await historicalPage(id);break;case "review":await reviewPage();break;case "settings":await settingsPage();break;default:home()}}catch(e){main.innerHTML=empty("无法打开此页面",e.message)+ '<a class="btn" href="#home">回到工作台</a>'}})}
window.addEventListener("hashchange",requestRoute);window.addEventListener("DOMContentLoaded",requestRoute);

