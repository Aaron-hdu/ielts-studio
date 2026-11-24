
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
        const back=[c.target,c.context,c.usage,c.collocation].filter(Boolean).map(field).join("<br><br>");
        for(const o of c.sources){
            const deck=["雅思作文",o.task,o.sid?`${o.name} · ${o.date} · ${o.sid.slice(-6)}`:o.name].map(clean).join("::");
            const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode([c.id,o.sid,o.qid].join("/"))));
            const guid=Array.from(digest.slice(0,12),x=>x.toString(16).padStart(2,"0")).join("");
            rows.push([field(c.meaning),back,deck,guid].join("\t"));
        }
    }
    download(["#separator:Tab","#html:true","#deck column:3","#guid column:4",...rows].join("\n")+"\n",
        "页间写作室-Anki.txt","text/plain;charset=utf-8");
}
async function reviewPage() {
    let [cards,settings] = await Promise.all([api("cards"),api("memory/options")]);
    main.innerHTML = topbar("表达练习") + heading("Practice","表达练习","回译与例句挖空共享写出熟悉度") + '<section id="practiceArea" class="panel"></section>';
    const area = $("#practiceArea");
    if (!cards.length) {
        area.innerHTML = empty("表达库还是空的","在作文报告的「词汇提升」或「可迁移表达」中点击加入练习。","cards");
        return;
    }
    const modes = {cloze:"例句挖空",recall:"回译"};
    let mode="recall";
    const grades={again:"忘了",hard:"困难",good:"记得",easy:"轻松"};
    const levels=["未练习","学习中","生疏","较熟悉","熟悉"];
    const dueNow=state=>state.due!==null && state.due<=Date.now();
    const localDate=ms=>new Date(ms).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
    const interval=sec=>sec<3600?Math.max(1,Math.round(sec/60))+" 分钟":sec<86400?Math.round(sec/3600)+" 小时":Math.round(sec/86400)+" 天";
    function dailyQueue(){
        const start=new Date(); start.setHours(0,0,0,0);
        let introduced=0;
        const due=[],fresh=[];
        for(const card of cards){
            introduced+=Number(card.memory.recall.first>=start.getTime());
            for(const m of settings.modes){
                const state=card.memory[m],entry={card,mode:m};
                if(!state.count)fresh.push(entry);
                else if(dueNow(state))due.push(entry);
            }
        }
        due.sort((a,b)=>a.card.memory[a.mode].due-b.card.memory[b.mode].due);
        return {due,fresh:fresh.slice(0,Math.max(0,settings.new_limit-introduced))};
    }
    function daily(){
        const {due,fresh}=dailyQueue();
        area.innerHTML=`<div class="row between"><h2>今日复习</h2>${button("自由练习","freeStudy")}</div>
          <div class="review-counts"><div><strong>${due.length}</strong><span>到期复习</span></div><div><strong>${fresh.length}</strong><span>可新学</span></div></div>
          <p class="hint">${settings.modes.map(m=>modes[m]).join(" · ")}　优先复习到期表达</p>
          <div class="actions">${button("开始今日复习","dailyStart",true)}</div>
          <details class="compactdetail topgap"><summary>复习设置</summary><form class="stack">
          <label>期望保留率（%）<input type="number" name="retention" min="70" max="97" value="${settings.retention}" aria-describedby="retentionHelp" required><small id="retentionHelp" class="hint">设为 90% 时，系统会尽量安排你在还有约九成把握想起表达时复习，调得越高，通常就要复习得越勤。</small></label>
          <label>每日新学表达上限<input type="number" name="limit" min="0" max="100" value="${settings.new_limit}" required></label>
          <div class="actions">${Object.entries(modes).map(([m,label])=>`<label><input type="radio" name="modes" value="${m}" ${settings.modes.includes(m)?"checked":""}>${label}</label>`).join("")}</div>
          <button class="btn" type="submit">保存复习设置</button></form></details>`;
        const anchor=$("#dailyStart",area);
        anchor.disabled=!(due.length+fresh.length);
        anchor.onclick=()=>study(true,null,[...due,...fresh]);
        $("#freeStudy",area).onclick=()=>picker();
        $("form",area).onsubmit=async e=>{
            e.preventDefault();const form=new FormData(e.target);
            try{
                settings=await api("memory/options",{retention:Number(form.get("retention")),new_limit:Number(form.get("limit")),modes:form.getAll("modes")});
                const updated=await api("cards");
                for(const c of cards)c.memory=updated.find(item=>item.id===c.id)?.memory||c.memory;
                daily();toast("复习设置已保存");
            }catch(err){actionError(err)}
        };
        const midnight=new Date();midnight.setHours(24,0,0,0);
        const future=cards.flatMap(c=>settings.modes.map(m=>c.memory[m].due)).filter(t=>t>Date.now());
        if(future.length){
            const time=Math.min(...future);
            anchor.parentElement.insertAdjacentHTML("afterend",`<p class="hint">下一项到期：${localDate(time)}</p>`);
        }
        const refreshAt=Math.min(midnight.getTime(),...future);
        setTimeout(()=>{if(anchor.isConnected && !$("details",area).open)daily()},Math.max(0,refreshAt-Date.now()+300));
    }
    async function showHistory(card){
        const [logs,curve]=await Promise.all([api("memory/history",{card:card.id}),api("memory/curve",{card:card.id,mode})]);
        let graph="";
        if(curve){
            const horizon=curve.points[curve.points.length-1][0];
            const coords=curve.points.map(([day,rate])=>`${8+284*day/horizon},${8+60*(1-rate/100)}`).join(" ");
            const targetY=8+60*(1-curve.retention/100);
            graph=`<figure class="memory-curve"><figcaption><b>写出熟悉度 · 预计回忆率</b>　当前约 ${curve.today}%</figcaption>
                <svg viewBox="0 0 300 80" role="img" aria-label="从上次作答起，预计回忆概率随时间变化">
                <path d="M8 ${targetY} H292" stroke="#817b73" fill="none" stroke-dasharray="4 3"/>
                <polyline points="${coords}" stroke="#55429a" stroke-width="2.5" fill="none"/></svg>
                <small>上次作答 → 第 ${horizon} 天　·　虚线为 ${curve.retention}% 目标</small></figure>`;
        }
        const state=card.memory.recall;
        const summary=`<p><b>写出熟悉度 · ${state.level}</b>　${state.count} 次有效自评${state.last?" · 最近复习 "+localDate(state.last)+" · 下次 "+localDate(state.due)+" · 跨 "+state.days+" 天练习 · 近次自评："+state.recent.map(r=>grades[r]).join("、"):""}</p>`;
        const old=r=>({alternative:"其他正确表达",recall:"独立写出"})[r.result]||r.result;
        modal(card.target,graph+summary+logs.map(r=>`<details class="compactdetail"><summary>${localDate(r.moment)} · ${modes[r.mode]||"早期记录"} · ${esc(grades[r.result]||old(r))}</summary>
            <p>${esc(r.detail?.prompt||"早期记录未保存题面")}</p>${r.detail?.hint?`<p>${esc(r.detail.hint)}</p>`:""}
            ${r.answer?`<p>我的答案　${esc(r.answer)}</p>`:""}${r.detail?.reference?`<p>参考　${esc(r.detail.reference)}</p>`:""}
            ${r.detail?.due?`<p>当次安排　${localDate(r.detail.due)}</p>`:""}</details>`).join(""));
    }
    const selected=new Set(cards.map(card=>card.id));
    cardSources(cards,overview.sessions,bank);
    const sources=cards.flatMap(c=>c.sources);
    const choices={
        level:levels,
        task:[...new Set(["Task 1","Task 2",...sources.map(s=>s.task)])],
        kind:[...new Set(sources.map(s=>s.kind))].sort(),
        topic:[...new Set(sources.flatMap(s=>s.topics))].sort(),
        date:[...new Set(sources.map(s=>s.date))].sort().reverse()
    };
    const filters=Object.fromEntries(Object.entries(choices).map(([key,list])=>[key,new Set(list)]));
    const labels={level:"熟悉度",task:"写作任务",kind:"题型",topic:"话题",date:"作文日期"};
    const expanded=new Set();
    function visibleCards(){
        return cards.map(c=>({...c,sources:c.sources.filter(o=>sourceMatches(o,filters))})).filter(c=>c.sources.length && filters.level.has(c.memory[mode].level));
    }
    const library={open:false,query:"",page:0,expanded:null};
    function bindLibrary(visible){
        const panel=$("#expressionLibrary",area), input=$("#expressionSearch",panel);
        panel.ontoggle=()=>{if(panel.isConnected)library.open=panel.open};
        input.value=library.query;
        const size=8;
        function render(){
            const term=library.query.trim().toLocaleLowerCase();
            const matches=visible.filter(c=>[c.target,c.meaning].some(v=>(v||"").toLocaleLowerCase().includes(term)))
                .sort((a,b)=>a.target.localeCompare(b.target,"en"));
            const pages=Math.ceil(matches.length/size);
            library.page=Math.min(library.page,Math.max(0,pages-1));
            const rows=matches.slice(library.page*size,(library.page+1)*size);
            $("#libraryCount",panel).textContent=matches.length+" 个表达";
            $("#libraryRows",panel).innerHTML=rows.map(c=>{
                const state=c.memory[mode];
                const fields=[["例句",c.context],["用法",c.usage],["搭配",c.collocation]]
                    .filter(([,value])=>value).map(([label,value])=>`<dt>${label}</dt><dd>${esc(value)}</dd>`).join("");
                return `<details class="word-entry" data-word="${esc(c.id)}" ${library.expanded===c.id?"open":""}>
                    <summary><b>${esc(c.target)}</b><span>${esc(c.meaning)}</span></summary>
                    <div class="word-body"><dl>${fields}<dt>来源</dt><dd>${c.sources.map(o=>o.route?`<a href="${esc(o.route)}">${esc(o.name)} · ${esc(o.date)}</a>`:esc(o.name)).join("<br>")}</dd>
                    <dt>复习</dt><dd>${modes[mode]} · ${state.level} · ${state.due?"下次 "+localDate(state.due):"尚未排期"}</dd></dl>
                    <button class="soft" data-memory="${esc(c.id)}">查看记忆记录</button></div></details>`;
            }).join("")||'<p class="hint">没有匹配的表达。</p>';
            const nav=$("#libraryNav",panel);
            nav.hidden=pages<=1;
            nav.querySelector("span").textContent=(library.page+1)+" / "+pages;
            $("#libraryPrev",nav).disabled=library.page===0;
            $("#libraryNext",nav).disabled=library.page+1>=pages;
        }
        input.oninput=()=>{library.query=input.value;library.page=0;library.expanded=null;render()};
        for(const [id,step] of [["#libraryPrev",-1],["#libraryNext",1]])
            $(id,panel).onclick=()=>{library.page+=step;library.expanded=null;render()};
        $("#libraryRows",panel).addEventListener("toggle",e=>{
            const row=e.target;
            if(!row.matches(".word-entry")||!row.isConnected)return;
            if(row.open){
                library.expanded=row.dataset.word;
                for(const other of panel.querySelectorAll(".word-entry[open]"))if(other!==row)other.open=false;
            }else if(library.expanded===row.dataset.word)library.expanded=null;
        },true);
        panel.onclick=e=>{
            const b=e.target.closest("[data-memory]");
            if(b)showHistory(cards.find(c=>c.id===b.dataset.memory)).catch(actionError);
        };
        render();
    }
    let historyType="all";
    function picker(history=null) {
        if(!Array.isArray(history))history=null;
        const visible=visibleCards();
        const chosen=()=>visible.filter(c=>selected.has(c.id));
        const filterPanel=Object.entries(choices).map(([key,values])=>`<details class="filter-group" data-key="${key}" ${expanded.has(key)?"open":""}><summary>${labels[key]} <small>${filters[key].size===values.length?"全部":filters[key].size+" 项"}</small></summary>
            <div class="filter-values"><button class="soft" data-set="${key}" data-all="1">全选</button><button class="soft" data-set="${key}" data-all="0">清空</button>
            ${values.map(v=>`<label><input type="checkbox" data-filter="${key}" value="${esc(v)}" ${filters[key].has(v)?"checked":""}>${esc(v)}</label>`).join("")}</div></details>`).join("");
        if(history){
            const types={all:"全部",cloze:"例句挖空",recall:"回译",unknown:"旧题 · 未记录题型"};
            const byId=new Map(chosen().map(c=>[c.id,c]));
            const groups=new Map();
            for(const [i,item] of history.entries()){
                if(!byId.has(item.card)||(historyType!=="all"&&(item.mode||"unknown")!==historyType))continue;
                const expression=byId.get(item.card).target.trim().replace(/\s+/g," ").toLowerCase();
                if(!groups.has(expression))groups.set(expression,[]);
                groups.get(expression).push({i,item});
            }
            area.innerHTML=`<div class="row between"><h2>已生成的练习</h2>${button("返回选词","backToPicker")}</div>
                <div class="source-filters">${filterPanel}</div>
                <div class="toolbar"><label>表达练习题型 <select id="historyType">${Object.entries(types).map(([key,label])=>`<option value="${key}" ${key===historyType?"selected":""}>${label}</option>`).join("")}</select></label><span class="meta">${groups.size} 个表达</span></div>
                ${groups.size?"":'<p class="hint">所选表达在当前筛选范围内没有记录。</p>'}
                ${Array.from(groups.values(),rows=>`<details class="archive-detail"><summary><strong>${esc(byId.get(rows[0].item.card).target)}</strong> · ${esc(byId.get(rows[0].item.card).meaning)} <small>${rows.length} 道</small></summary>
                    ${rows.map(({i,item})=>`<article class="expression"><small class="meta">${types[item.mode]||types.unknown}</small><p>${esc(item.chinese||item.sentence)}</p>
                    ${item.chinese?`<details><summary>查看英文</summary><p>${esc(item.sentence)}</p></details><button class="soft" data-redo="${i}">重练这道</button>`:""}</article>`).join("")}</details>`).join("")}`;
            $("#backToPicker",area).onclick=()=>picker();
            $("#historyType",area).onchange=e=>{historyType=e.target.value;picker(history)};
            area.querySelectorAll("[data-redo]").forEach(b=>b.onclick=()=>{
                const item=history[Number(b.dataset.redo)];
                mode=item.mode==="cloze"||item.mode==="recall"?item.mode:(mode==="cloze"?"cloze":"recall");
                study(true,item);
            });
            bindFilters();return;
        }
        const due = card => dueNow(card.memory[mode]);
        area.innerHTML = `<div class="row between"><h2>自由练习</h2>${button("今日复习","goDaily")}</div><div class="chips">${Object.entries(modes).map(([id,title])=>
            `<button class="chip ${mode===id?"on":""}" data-mode="${id}">${title}</button>`).join("")}</div>
            <div class="source-filters">${filterPanel}</div><div class="sec"><h2>选择要练的词和表达</h2><span class="meta" id="selectionCount"></span></div>
            <div class="actions"><button class="soft" data-select="all">全选</button><button class="soft" data-select="due">只选到期 · ${visible.filter(due).length}</button><button class="soft" data-select="none">清空</button></div>
            <div class="study-list">${visible.map(c=>`<label><input type="checkbox" value="${esc(c.id)}" ${selected.has(c.id)?"checked":""}><span><b>${esc(c.target)}</b><small>${esc(c.meaning)}</small><small class="memory-level" data-level="${c.memory[mode].level}">${c.memory[mode].level}${due(c)?" · 已到期":""}</small></span></label>`).join("")}</div>
            <div class="actions">${button("生成新一轮练习","beginStudy",true)}
            ${mode==="recall"?button("用报告里的例句练习","useStored"):""}${button("已生成的练习","historyExercises")}${button("快速翻看","browseWords")}${button("导出所选到 Anki","anki")}</div>
            <p class="hint topgap">每轮从已选表达生成新语境，使用设置中的 Codex 或 API。 Anki 2.1.54+ 以 Basic 导入，按「雅思作文 → Task → 来源作文」分牌组。</p>
            <details id="expressionLibrary" class="compactdetail topgap" ${library.open?"open":""}><summary>表达速查</summary>
            <div class="word-toolbar"><input type="search" class="field" id="expressionSearch" aria-label="搜索表达或中文释义" placeholder="搜索英文表达或中文释义"><small id="libraryCount" class="meta" aria-live="polite"></small></div>
            <div id="libraryRows"></div><nav id="libraryNav" aria-label="表达速查分页"><button class="soft" id="libraryPrev">上一页</button><span></span><button class="soft" id="libraryNext">下一页</button></nav></details>`;
        bindLibrary(visible);
        const count = () => {
            $("#selectionCount",area).textContent=chosen().length+" / "+visible.length+" 项已选";
            for (const btn of area.querySelectorAll("#beginStudy,#useStored,#anki,#browseWords")) btn.disabled=!chosen().length;
        };
        function bindFilters(){
        area.querySelectorAll(".filter-group").forEach(el=>el.ontoggle=()=>{if(!el.isConnected)return;if(el.open)expanded.add(el.dataset.key);else expanded.delete(el.dataset.key)});
        area.querySelectorAll("[data-filter]").forEach(el=>el.onchange=()=>{
            const key=el.dataset.filter;expanded.add(key);
            if(el.checked)filters[key].add(el.value);else filters[key].delete(el.value);picker(history);
        });
        area.querySelectorAll("[data-set]").forEach(el=>el.onclick=()=>{
            const key=el.dataset.set;expanded.add(key);filters[key]=new Set(el.dataset.all==="1"?choices[key]:[]);picker(history);
        });
        }
        bindFilters();
        count();
        $("#goDaily",area).onclick=daily;
        area.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{mode=b.dataset.mode;picker()});
        area.querySelectorAll("[data-select]").forEach(b=>b.onclick=()=>{
            for(const c of visible) selected.delete(c.id);
            for(const c of visible) if(b.dataset.select==="all"||(b.dataset.select==="due"&&due(c))) selected.add(c.id);
            picker();
        });
        area.querySelectorAll(".study-list input").forEach(box=>box.onchange=()=>{
            if(box.checked) selected.add(box.value); else selected.delete(box.value);
            count();
        });
        $("#browseWords",area).onclick=()=>{
            const words=chosen();
            function browse(index){
                const c=words[index];
                modal(c.target,`<p>${esc(c.meaning)}</p><p>${esc(c.context)}</p><p>${esc(c.usage||"")}</p><div class="actions">
                    ${button("上一个","prevWord")}<small>${index+1} / ${words.length}</small>${button("下一个","nextWord")}</div>`);
                $("#prevWord").disabled=index===0;
                $("#nextWord").disabled=index===words.length-1;
                $("#prevWord").onclick=()=>browse(index-1);
                $("#nextWord").onclick=()=>browse(index+1);
            }
            browse(0);
        };
        $("#anki",area).onclick=()=>exportAnki(chosen()).catch(actionError);
        $("#historyExercises",area).onclick=async()=>{
            const anchor=$("#historyExercises",area);
            try{
                const items=await api("exercises/history");
                if(anchor.isConnected)picker(items);
            }catch(err){actionError(err)}
        };
        $("#beginStudy",area).onclick=()=>study(false);
        if($("#useStored",area)) $("#useStored",area).onclick=()=>study(true);
    }
    function study(stored, savedItem=null, dailyEntries=null) {
        const queue=dailyEntries?dailyEntries.map(e=>e.card):savedItem?[cards.find(c=>c.id===savedItem.card)]:visibleCards().filter(c=>selected.has(c.id));
        const tasks=new Map();
        let index=0;
        let receipt="";
        let savedPool=[];
        const leave=dailyEntries?daily:()=>picker();
        const again=dailyEntries?daily:()=>study(stored,savedItem);

        async function next() {
            if(!area.isConnected) return;
            if(index>=queue.length) {
                area.innerHTML=`<h2>本轮完成</h2><p role="status">${esc(receipt)}</p><p class="sub">已练习 ${queue.length} 项。</p><div class="actions topgap">${button(dailyEntries?"查看今日复习":stored?"再练一轮":"生成下一轮新题","repeatRound",true)}${button("重新选词","pick")}</div>`;
                $("#repeatRound",area).onclick=again; $("#pick",area).onclick=picker; return;
            }
            const card=queue[index];
            if(dailyEntries)mode=dailyEntries[index].mode;
            if(dailyEntries && !tasks.has(card.id+mode)){
                const matches=savedPool.filter(x=>x.card===card.id && x.chinese && x.span);
                if(matches.length)tasks.set(card.id+mode,matches[Math.floor(Math.random()*matches.length)]);
            }
            if((!stored||dailyEntries&&mode==="cloze")&&!tasks.has(card.id+mode)) {
                area.innerHTML=`<h2>正在生成新练习…</h2><p class="hint">模型正在为所选表达编写新句子并核对历史题目。</p>`;
                try {
                    const batch=dailyEntries?[card.id]:queue.slice(index,index+6).map(c=>c.id);
                    const items=await api("exercises",{cards:batch,mode});
                    for(const item of items) tasks.set(item.card+mode,item);
                } catch(err) {
                    if(!area.isConnected) return;
                    area.innerHTML=`<p class="notice">${esc(err.message)}</p><div class="actions topgap">${button("重试","retry",true)}${button("返回选词","pick")}</div>`;
                    $("#retry",area).onclick=next; $("#pick",area).onclick=picker; return;
                }
            }
            if(!area.isConnected) return;
            const item=savedItem||tasks.get(card.id+mode)||{chinese:card.cue,sentence:card.answer};
            const front= mode==="cloze"?item.sentence.replace(item.span,"________"):item.chinese;
            area.innerHTML=`<div class="row between"><span class="meta">${modes[mode]} · ${index+1} / ${queue.length}</span><button class="soft" id="pick">返回选词</button></div>
                <p class="hint" role="status">${esc(receipt)}</p><h2 class="study-front">${esc(front)}</h2>
                ${mode==="cloze"?`<p class="muted">${esc(item.chinese)}</p>`:""}
                <textarea class="study-answer" id="answer" aria-label="英文答案" placeholder="写下你的答案…"></textarea>
                <div id="solution" class="topgap">${button("核对答案","reveal",true)} ${mode==="recall"?button("给我挖空提示","clozeHint"):""}</div>`;
            $("#pick",area).textContent=dailyEntries?"返回今日复习":"返回选词";
            $("#pick",area).onclick=leave;
            let usedHint="";
            const hintButton=$("#clozeHint",area);
            if(hintButton)hintButton.onclick=async()=>{
                hintButton.disabled=true;
                $("#reveal",area).disabled=true;
                try{
                    let span=item.span;
                    if(!span){
                        const at=item.sentence.toLowerCase().indexOf(card.target.toLowerCase());
                        if(at>=0)span=item.sentence.slice(at,at+card.target.length);
                    }
                    usedHint=span?item.sentence.replace(span,"________"):item.sentence.replace(/\b[a-z]+(?:'[a-z]+)?\b/gi,
                        word=>/^(the|a|an|is|was|were|are|to|of|for|from|in|at|by|and|but|with|on)$/i.test(word)?word:"____");
                    hintButton.outerHTML=`<p class="notice">挖空提示 · ${esc(usedHint)}</p>`;
                }catch(err){hintButton.disabled=false;actionError(err)}
                finally{const reveal=$("#reveal",area);if(reveal)reveal.disabled=false}
            };
            $("#reveal",area).onclick=async()=>{
                const anchor=$("#reveal",area);anchor.disabled=true;
                let times;
                try{times=await api("memory/preview",{card:card.id,mode})}catch(err){anchor.disabled=false;actionError(err);return}
                if(!anchor.isConnected)return;
                const answer=$("#answer",area).value.trim();
                $("#answer",area).disabled=true;
                const exact=mode==="cloze"&&answer.toLowerCase()===item.span.toLowerCase();
                $("#solution",area).innerHTML=`<div class="notice"><b>${esc(mode==="cloze"?item.span:card.meaning)}</b>
                    <p>${esc(item.sentence)}</p>${card.usage?`<p>${esc(card.usage)}</p>`:""}${card.collocation?`<p>搭配　${esc(card.collocation)}</p>`:""}</div>
                    <p class="hint">${exact?"与参考答案一致。":""}按这次实际回忆情况记录。</p><div class="actions topgap">
                    ${Object.entries(grades).filter(([key])=>!usedHint||key==="again").map(([key,label])=>`<button class="btn ${key==="good"?"primary":""}" data-result="${key}">${usedHint?"记录为未独立想起":label}<small> · ${interval(times[key])}</small></button>`).join("")}</div>`;
                const reviewId=crypto.randomUUID();
                const ratingButtons=area.querySelectorAll("[data-result]");
                ratingButtons.forEach(b=>b.onclick=async()=>{
                    ratingButtons.forEach(el=>el.disabled=true);
                    try {
                        const schedule=await api("reviews",{id:reviewId,card:card.id,answer,mode,result:b.dataset.result,source:dailyEntries?"daily":"free",prompt:front,hint:usedHint||(mode==="cloze"?item.chinese:""),reference:item.sentence});
                        card.memory.recall=card.memory.cloze=schedule.memory;
                        receipt=card.target+" · 已记录「"+grades[b.dataset.result]+"」 · 下次 "+localDate(schedule.due);
                        card.due=schedule.due;
                        if(!b.isConnected)return;
                        index++; await next();
                    } catch(err){ratingButtons.forEach(el=>el.disabled=false);actionError(err)}
                });
            };
        }
        (async()=>{if(dailyEntries)savedPool=await api("exercises/history");await next()})().catch(actionError);
    }
    daily();
}

