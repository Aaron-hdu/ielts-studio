
function cardSources(cards, sessions, questions) {
    const attempts=new Map(sessions.map(s=>[s.id,s]));
    const catalogue=new Map(questions.map(q=>[q.id,q]));
    for(const c of cards){
        c.sources=c.origins.map(o=>{
            const s=attempts.get(o.sid), q={...catalogue.get(o.qid),...s?.questions.find(q=>q.id===o.qid)};
            const moment=s?.finished||s?.started;
            const date=moment?new Intl.DateTimeFormat("sv-SE",{year:"numeric",month:"2-digit",day:"2-digit"}).format(moment):"未知日期";
            const name=[q.book?`C${q.book} Test ${q.test}`:"", q.title||o.qid].filter(Boolean).join(" · ");
            return {...o,task:q.task?`Task ${q.task}`:"未分类",kind:q.study_type||"未分类",topics:q.topics?.length?q.topics:["未分类"],date,name,
                route:"#report/"+o.sid+(s?.questions.length===2&&q.task===2?"?task=2":"")};
        });
        if(!c.sources.length)c.sources=[{task:"未分类",kind:"未分类",topics:["未分类"],date:"未知日期",name:"未关联作文",sid:"",qid:""}];
    }
}
function sourceMatches(o, filters) {
    return filters.task.has(o.task) && filters.kind.has(o.kind) && filters.date.has(o.date) && o.topics.some(t=>filters.topic.has(t));
}
async function exportAnki(cards) {
    const field = value => esc(value || "").replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
    const clean = value => String(value).replace(/::|[\t\r\n]/g," ").trim();
    const rows=[];
    for(const c of cards){
        const back=[c.meaning,c.usage,c.collocation,c.context].filter(Boolean).map(field).join("<br><br>");
        for(const o of c.sources){
            const deck=["雅思作文",o.task,o.sid?`${o.name} · ${o.date} · ${o.sid.slice(-6)}`:o.name].map(clean).join("::");
            const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode([c.id,o.sid,o.qid].join("/"))));
            const guid=Array.from(digest.slice(0,12),x=>x.toString(16).padStart(2,"0")).join("");
            rows.push([field(c.target),back,deck,guid].join("\t"));
        }
    }
    download(["#separator:Tab","#html:true","#deck column:3","#guid column:4",...rows].join("\n")+"\n",
        "页间写作室-Anki.txt","text/plain;charset=utf-8");
}
async function reviewPage() {
    const cards = await api("cards");
    main.innerHTML = topbar("表达练习") + heading("Practice","表达练习") + '<section id="practiceArea" class="panel"></section>';
    const area = $("#practiceArea");
    if (!cards.length) {
        area.innerHTML = empty("表达库还是空的","在作文报告的「词汇提升」或「新表达」中点击加入练习。","cards");
        return;
    }
    const modes = {flash:"翻面背记",cloze:"例句挖空",recall:"中文写英文"};
    let mode="flash";
    const selected=new Set(cards.map(card=>card.id));
    cardSources(cards,overview.sessions,bank);
    const sources=cards.flatMap(c=>c.sources);
    const choices={
        task:[...new Set(["Task 1","Task 2",...sources.map(s=>s.task)])],
        kind:[...new Set(sources.map(s=>s.kind))].sort(),
        topic:[...new Set(sources.flatMap(s=>s.topics))].sort(),
        date:[...new Set(sources.map(s=>s.date))].sort().reverse()
    };
    const filters=Object.fromEntries(Object.entries(choices).map(([key,list])=>[key,new Set(list)]));
    const labels={task:"写作任务",kind:"题型",topic:"话题",date:"作文日期"};
    const expanded=new Set();
    function visibleCards(){
        return cards.map(c=>({...c,sources:c.sources.filter(o=>sourceMatches(o,filters))})).filter(c=>c.sources.length);
    }
    function picker() {
        const visible=visibleCards();
        const chosen=()=>visible.filter(c=>selected.has(c.id));
        const filterPanel=Object.entries(choices).map(([key,values])=>`<details class="filter-group" data-key="${key}" ${expanded.has(key)?"open":""}><summary>${labels[key]} <small>${filters[key].size===values.length?"全部":filters[key].size+" 项"}</small></summary>
            <div class="filter-values"><button class="soft" data-set="${key}" data-all="1">全选</button><button class="soft" data-set="${key}" data-all="0">清空</button>
            ${values.map(v=>`<label><input type="checkbox" data-filter="${key}" value="${esc(v)}" ${filters[key].has(v)?"checked":""}>${esc(v)}</label>`).join("")}</div></details>`).join("");
        const due = card => (mode==="flash"?card.flash_due:card.due)<=Date.now();
        area.innerHTML = `<div class="chips">${Object.entries(modes).map(([id,title])=>
            `<button class="chip ${mode===id?"on":""}" data-mode="${id}">${title}</button>`).join("")}</div>
            <div class="source-filters">${filterPanel}</div><div class="sec"><h2>选择要练的词和表达</h2><span class="meta" id="selectionCount"></span></div>
            <div class="actions"><button class="soft" data-select="all">全选</button><button class="soft" data-select="due">只选到期 · ${visible.filter(due).length}</button><button class="soft" data-select="none">清空</button></div>
            <div class="study-list">${visible.map(c=>`<label><input type="checkbox" value="${esc(c.id)}" ${selected.has(c.id)?"checked":""}><span><b>${esc(c.target)}</b><small>${esc(c.meaning)}</small></span></label>`).join("")}</div>
            <div class="actions">${button(mode==="flash"?"开始背记":"生成新一轮练习","beginStudy",true)}
            ${mode==="recall"?button("用已存例句练习","useStored"):""}${button("导出所选到 Anki","anki")}</div>
            <p class="hint topgap">${mode==="flash"?"英文在正面。先回忆含义，再翻面查看用法和例句。":"每轮从已选表达生成新语境，使用设置中的 Codex 或 API。"} Anki 2.1.54+ 以 Basic 导入，按「雅思作文 → Task → 来源作文」分牌组。</p>
            <details class="compactdetail topgap"><summary>查看用法、来源和复习日期</summary>
            ${visible.map(c=>`<article class="expression"><b>${esc(c.target)}</b> · ${esc(c.meaning)}<p>${esc(c.context)}</p><p class="hint">${esc(c.usage||"")} ${esc(c.collocation||"")}</p><p class="hint">下次输出复习 ${niceDate(c.due)}</p>${c.sources.filter(o=>o.route).map(o=>`<a class="blocklink" href="${esc(o.route)}">${esc(o.name)} · ${esc(o.date)}</a>`).join(" ")}</article>`).join("")}</details>`;
        const count = () => {
            $("#selectionCount",area).textContent=chosen().length+" / "+visible.length+" 项已选";
            for (const btn of area.querySelectorAll("#beginStudy,#useStored,#anki")) btn.disabled=!chosen().length;
        };
        count();
        area.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{mode=b.dataset.mode;picker()});
        area.querySelectorAll("[data-select]").forEach(b=>b.onclick=()=>{
            for(const c of visible) selected.delete(c.id);
            for(const c of visible) if(b.dataset.select==="all"||(b.dataset.select==="due"&&due(c))) selected.add(c.id);
            picker();
        });
        area.querySelectorAll(".filter-group").forEach(el=>el.ontoggle=()=>{if(!el.isConnected)return;if(el.open)expanded.add(el.dataset.key);else expanded.delete(el.dataset.key)});
        area.querySelectorAll("[data-filter]").forEach(el=>el.onchange=()=>{
            const key=el.dataset.filter;expanded.add(key);
            if(el.checked)filters[key].add(el.value);else filters[key].delete(el.value);picker();
        });
        area.querySelectorAll("[data-set]").forEach(el=>el.onclick=()=>{
            const key=el.dataset.set;expanded.add(key);filters[key]=new Set(el.dataset.all==="1"?choices[key]:[]);picker();
        });
        area.querySelectorAll(".study-list input").forEach(box=>box.onchange=()=>{
            if(box.checked) selected.add(box.value); else selected.delete(box.value);
            count();
        });
        $("#anki",area).onclick=()=>exportAnki(chosen()).catch(actionError);
        $("#beginStudy",area).onclick=()=>study(false);
        if($("#useStored",area)) $("#useStored",area).onclick=()=>study(true);
    }
    function study(stored) {
        const queue=visibleCards().filter(c=>selected.has(c.id));
        const tasks=new Map();
        let index=0;
        const again=()=>study(stored);
        async function next() {
            if(!area.isConnected) return;
            if(index>=queue.length) {
                area.innerHTML=`<h2>本轮完成</h2><p class="sub">已练习 ${queue.length} 项。</p><div class="actions topgap">${button(mode==="flash"||stored?"再练一轮":"生成下一轮新题","repeatRound",true)}${button("重新选词","pick")}</div>`;
                $("#repeatRound",area).onclick=again; $("#pick",area).onclick=picker; return;
            }
            const card=queue[index];
            if(mode!=="flash"&&!stored&&!tasks.has(card.id)) {
                area.innerHTML=`<h2>正在生成新练习…</h2><p class="hint">模型正在为所选表达编写新句子并核对历史题目。</p>`;
                try {
                    const batch=queue.slice(index,index+6).map(c=>c.id);
                    for(const item of await api("exercises",{cards:batch})) tasks.set(item.card,item);
                } catch(err) {
                    if(!area.isConnected) return;
                    area.innerHTML=`<p class="notice">${esc(err.message)}</p><div class="actions topgap">${button("重新生成","retry",true)}${button("返回选词","pick")}</div>`;
                    $("#retry",area).onclick=next; $("#pick",area).onclick=picker; return;
                }
            }
            if(!area.isConnected) return;
            const item=tasks.get(card.id)||{chinese:card.cue,sentence:card.answer};
            const front= mode==="flash"?card.target:mode==="cloze"?item.sentence.replace(item.span,"________"):item.chinese;
            area.innerHTML=`<div class="row between"><span class="meta">${modes[mode]} · ${index+1} / ${queue.length}</span><button class="soft" id="pick">返回选词</button></div>
                <h2 class="study-front">${esc(front)}</h2>
                ${mode==="cloze"?`<p class="muted">${esc(item.chinese)}</p>`:""}
                ${mode==="flash"?"":'<textarea class="study-answer" id="answer" aria-label="英文答案" placeholder="写下你的答案…"></textarea>'}
                <div id="solution" class="topgap">${button(mode==="flash"?"翻面":"核对答案","reveal",true)}</div>`;
            $("#pick",area).onclick=picker;
            $("#reveal",area).onclick=()=>{
                const answer=mode==="flash"?"":$("#answer",area).value.trim();
                if(mode!=="flash") $("#answer",area).disabled=true;
                const exact=mode==="cloze"&&answer.toLowerCase()===item.span.toLowerCase();
                $("#solution",area).innerHTML=`<div class="notice"><b>${esc(mode==="cloze"?item.span:card.meaning)}</b>
                    <p>${esc(mode==="flash"?card.context:item.sentence)}</p>${card.usage?`<p>${esc(card.usage)}</p>`:""}${card.collocation?`<p>搭配　${esc(card.collocation)}</p>`:""}</div>
                    <p class="hint">${exact?"与参考答案一致。":""}按这次实际回忆情况记录。</p><div class="actions topgap">
                    <button class="btn primary" data-result="recall">${mode==="flash"?"记住了":"独立写出"}</button>
                    <button class="btn" data-result="alternative">${mode==="flash"?"有点模糊":"其他正确表达"}</button>
                    <button class="btn" data-result="again">还需再练</button></div>`;
                const reviewId=crypto.randomUUID();
                const ratingButtons=area.querySelectorAll("[data-result]");
                ratingButtons.forEach(b=>b.onclick=async()=>{
                    ratingButtons.forEach(el=>el.disabled=true);
                    try {
                        const schedule=await api("reviews",{id:reviewId,card:card.id,answer,mode,result:b.dataset.result});
                        const field=mode==="flash"?"flash_due":"due";
                        card[field]=schedule.due;
                        cards.find(item=>item.id===card.id)[field]=schedule.due;
                        index++; await next();
                    } catch(err){ratingButtons.forEach(el=>el.disabled=false);actionError(err)}
                });
            };
        }
        next().catch(actionError);
    }
    picker();
}

