function planQuestion(id) { return bank.find(q=>q.id===id); }
function planOptions(values,selected) {
    return values.map(x=>`<option value="${esc(x)}" ${x===selected?"selected":""}>${esc(x)}</option>`).join("");
}
function daysSince(date) {
    if(!date) return "尚无记录";
    const now=new Date();
    const days=Math.max(0,Math.round((Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())-Date.parse(date))/86400000));
    return (days ? days+" 天前" : "今天")+" · "+date;
}
function nextTask(plan) {
    const last=plan.records.find(r=>!r.revision);
    return last?.task===2?1:2;
}
function topRecommendation(data,task) {
    return data.coach[task] || data.recommendations[task][0];
}
async function homeRecommendation(root) {
    const data=await api("plan");
    if (!root.isConnected) return;
    const task=nextTask(data),rec=topRecommendation(data,task),q=rec && planQuestion(rec.qid);
    if (!q) return;
    root.innerHTML=`<div><span class="meta">下一次练什么 · Task ${task}</span><h2>${esc(reportTitle(q))}</h2><p>${esc(rec.focus)}</p></div><a class="btn primary" href="#plan?task=${task}">查看推荐 ${icon("arrow")}</a>`;
}
function evidenceLinks(rows) {
    return rows.map(r=>`<a class="plan-source" href="#${esc(r.route)}">${esc(r.date)} · ${esc(planQuestion(r.qid)?.title||r.title)} · ${r.revision?"修改稿":"原稿"}</a>`).join("");
}
function planReferences(data,refs) {
    return evidenceLinks(refs.map(ref=>data.records.find(r=>r.ref===ref)).filter(Boolean));
}
async function planPage(params) {
    const [data,currentBank]=await Promise.all([api("plan"),api("questions")]);
    if(location.hash.split("?")[0]!=="#plan") return;
    bank=currentBank;
    let task=Number(params.get("task"))===1?1:Number(params.get("task"))===2?2:nextTask(data);
    const views={recommend:"推荐",coverage:"练习全景",skills:"能力分析",generate:"AI 出题"};
    let tab=views[params.get("view")] || "推荐", axis="题型",span="all",topicFilter="",typeFilter="",rowOpen="",alternate=null;
    let aiBusy=false, generating=false, made=null, error="",selectedType="",selectedTopic="",brief="";
    const allTopics=()=>[...new Set(bank.filter(q=>q.task===task).flatMap(q=>q.topics||[]))].sort();
    main.innerHTML=topbar("写作计划")+heading("Study planner","写作计划")+
        '<div class="plan-controls"><nav class="chips" id="planTabs" aria-label="计划栏目"></nav><select aria-label="写作任务" id="planTask"><option value="1">Task 1 · 图表写作</option><option value="2">Task 2 · 议论文</option></select></div><div id="planBody"></div>';
    const area=$("#planBody"),tabs=$("#planTabs"),selector=$("#planTask");
    selector.value=task;
    selector.onchange=()=>{task=Number(selector.value);typeFilter="";topicFilter="";selectedType="";selectedTopic="";rowOpen="";alternate=null;made=null;error="";render()};
    function render(){
        if(!area.isConnected||location.hash.split("?")[0]!=="#plan")return;
        const view=Object.keys(views).find(key=>views[key]===tab);
        history.replaceState(null,"",`#plan?task=${task}&view=${view}`);
        selector.disabled=generating||aiBusy;
        tabs.innerHTML=["推荐","练习全景","能力分析","AI 出题"].map(t=>`<button class="chip ${t===tab?"on":""}" data-tab="${t}">${t}</button>`).join("");
        tabs.querySelectorAll("button").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;error="";render()});
        if(tab==="推荐")recommendation();
        else if(tab==="练习全景")landscape();
        else if(tab==="能力分析")abilities();
        else generator();
    }
    const warning=()=>error?`<p class="notice" role="alert">${esc(error)}</p>`:"";
    function bindCoach(){
        const btn=$("#askCoach",area);
        btn.disabled=aiBusy;
        btn.onclick=async()=>{
            const t=task;aiBusy=true;error="";render();
            try {data.coach[t]=await api("plan/coach",{task:t});alternate=null}
            catch(e){error=e.message}
            finally{aiBusy=false;render()}
        };
    }
    const coachButton=()=>button(aiBusy?"AI 正在分析…":data.coach[task]?"更新 AI 计划":"请 AI 分析并选题","askCoach");
    function recommendation() {
        const rec=alternate||topRecommendation(data,task),q=rec && planQuestion(rec.qid);
        if(!q){area.innerHTML=empty("暂无可推荐的剑雅题目","可在 AI 出题中生成原创题。","book");return}
        const rows=data.records.filter(r=>r.task===task), previous=rows.find(r=>r.criteria.length && !r.revision);
        const criterion=previous?.criteria.find(c=>c.code===(task===1?"TA":"TR"));
        const sourceLinks=planReferences(data,rec.refs||[]);
        area.innerHTML=`<section class="panel plan-choice">
          <header class="pick-header"><div class="pick-byline">${esc(paperName(q))} · Task ${task}<span>${esc(q.study_type)}</span></div>
          <h2>${esc(q.title)}</h2><div class="actions">${button("开始写这题","writePick",true,"pen")}${button("换一道同题型","swapPick")}</div></header>
          <div class="pick-body"><div class="focus-note"><h3>这次写作的重点</h3><p>${esc(rec.focus)}</p></div>
          <div class="pick-reason"><h3>${alternate?"为什么换这题":data.coach[task]?"AI 推荐依据":"为什么推荐这题"}</h3><p>${esc(rec.reason)}</p>
          ${!alternate && !data.coach[task] && criterion && (criterion.gap||criterion.comment)?`<blockquote>${esc(criterion.gap||criterion.comment)}</blockquote>`:""}</div>
          ${sourceLinks?`<details><summary>查看依据的稿件</summary>${sourceLinks}</details>`:""}
          <button class="soft" id="previewPick">查看英文题面</button></div></section>
          <div class="plan-extras"><section class="panel"><h3>选题方法</h3><p>${task===1?"先看图表类型，再看概述和比较。保持题型做专项，再换图检验能否迁移。":"先看问法是否答完整，再看话题积累。保持问法换题练习，再换话题检验。"}</p>
          <details><summary>如何使用我的记录</summary><p>优先未写过的题，结合原稿反馈、修订表现、已练题型、上次练习日期和剑雅频次。也可以让 AI 结合具体稿件调整推荐。</p></details>
          ${coachButton()}${warning()}</section>
          ${previous?`<section class="panel"><h3>只有 10 分钟</h3><p>打开最近一篇原稿，根据其中一条反馈重写一个段落。</p>${evidenceLinks([previous])}</section>`:""}</div>`;
        $("#previewPick",area).onclick=()=>previewQuestion(q);
        $("#writePick",area).onclick=()=>previewQuestion(q);
        const matches=data.recommendations[task].filter(r=>r.kind===q.study_type);
        $("#swapPick",area).disabled=matches.length<2;
        $("#swapPick",area).onclick=()=>{
            const idx=matches.findIndex(r=>r.qid===q.id);
            alternate={...matches[(idx+1)%matches.length],refs:rec.refs,reason:"保持题型，换一个语境练习相同的写作技能。"}; render();
        };
        bindCoach();
    }
    function landscape(){
        const books=[...new Set(bank.filter(q=>q.book).map(q=>q.book))].sort((a,b)=>b-a);
        const selectedBooks=span==="five"?books.slice(0,5):books;
        const sample=bank.filter(q=>q.book && q.task===task && selectedBooks.includes(q.book));
        const records=data.records.filter(r=>r.task===task);
        const topicAxis=axis==="话题";
        const matchesOther=q=>topicAxis?(!typeFilter||q.study_type===typeFilter):(!topicFilter||q.topics?.includes(topicFilter));
        const tags=q=>topicAxis?(q.topics?.length?q.topics:["待归类"]):[q.study_type||"待归类"];
        const subset=sample.filter(matchesOther);
        const categories=new Set(topicAxis?allTopics():data.types[task]);
        subset.forEach(q=>tags(q).forEach(t=>categories.add(t)));
        const rows=[...categories].map(name=>{
            const qs=subset.filter(q=>tags(q).includes(name));
            const work=records.filter(r=>{const q=planQuestion(r.qid)||{};return matchesOther(q)&&tags(q).includes(name)});
            const first=work.filter(r=>!r.revision), revisions=work.filter(r=>r.revision);
            return {name,qs,work,first,revisions,count:new Set(first.map(r=>r.qid)).size};
        }).sort((a,b)=>b.qs.length-a.qs.length||a.name.localeCompare(b.name,"zh"));
        const missing=sample.filter(q=>tags(q).includes("待归类")).length;
        area.innerHTML=`<section class="panel"><h2>剑雅出题分布与我的练习</h2><div class="plan-filters">
        <label>统计维度<select id="axis">${planOptions(["题型","话题"],axis)}</select></label>
        <label>剑雅样本<select id="range"><option value="all">全部已收录册次</option><option value="five">最近五册</option></select></label>
        <label>${topicAxis?"限定题型":"限定话题"}<select id="cross"><option value="">全部</option>${planOptions(topicAxis?data.types[task]:allTopics(),topicAxis?typeFilter:topicFilter)}</select></label></div>
        <p class="hint">C${Math.min(...selectedBooks)}–C${Math.max(...selectedBooks)} · ${new Set(sample.map(q=>q.book+"-"+q.test)).size} 套 · Task ${task} 共 ${sample.length} 题 · 当前筛选 ${subset.length} 题 · 待归类 ${missing} 题。百分比为已收录样本占比。${topicAxis?"每题可含多个话题，占比之和可超过 100%。":"每题只计一个主类型。"} 个人练习含所有题源和册次。</p>
        <div class="distribution-chart" aria-label="按题数排序的出题分布">${rows.filter(r=>r.qs.length).map(r=>
            `<button type="button" class="distribution-row" data-distribution="${esc(r.name)}" aria-expanded="${rowOpen===r.name}"><span>${esc(r.name)}</span><span class="distribution-track"><i style="width:${100*r.qs.length/rows[0].qs.length}%"></i></span><b>${r.qs.length} 题 · ${(100*r.qs.length/subset.length).toFixed(1)}%</b></button>`).join("")}</div>
        <div class="plan-scroll"><table class="plan-table"><thead><tr><th>${axis} / 点击展开</th><th>剑雅题数 · 占比</th><th>写过的题</th><th>修改稿</th><th>最近原稿</th><th>最近修改</th><th>练习建议</th></tr></thead><tbody>
        ${rows.map((r,i)=>{
            const pct=subset.length?r.qs.length*100/subset.length:0;
            const advice=!r.count?(r.qs.length && r.qs.length>=rows[0].qs.length*.6?"优先尝试":"安排首次覆盖"):r.first[0]?.date && (Date.now()-Date.parse(r.first[0].date))/86400000>21?"换题回顾":"结合批改巩固";
            return `<tr><th><button class="soft" data-bucket="${i}" aria-expanded="${rowOpen===r.name}">${rowOpen===r.name?"▾":"▸"} ${esc(r.name)}</button></th><td><b>${r.qs.length} / ${subset.length}</b> · ${pct.toFixed(1)}%<div class="freq-bar"><i style="width:${pct}%"></i></div></td><td>${r.count}</td><td>${r.revisions.length}</td><td>${esc(daysSince(r.first[0]?.date))}</td><td>${esc(daysSince(r.revisions[0]?.date))}</td><td>${advice}</td></tr>${
            rowOpen===r.name?`<tr><td colspan="7"><b>我的作文</b>${r.work.length?evidenceLinks(r.work):'<p class="hint">暂无交卷。</p>'}<b>样本题号</b><div class="chips">${r.qs.map(q=>`<button class="chip" data-preview="${esc(q.id)}" title="${esc(q.title)}">${esc(paperName(q))} · T${q.task}</button>`).join("")||"无"}</div></td></tr>`:""}`;
        }).join("")}</tbody></table></div></section>`;
        $("#range",area).value=span;
        $("#range",area).onchange=e=>{span=e.target.value;rowOpen="";render()};
        $("#axis",area).onchange=e=>{axis=e.target.value;topicFilter="";typeFilter="";rowOpen="";render()};
        $("#cross",area).onchange=e=>{if(topicAxis)typeFilter=e.target.value;else topicFilter=e.target.value;rowOpen="";render()};
        area.querySelectorAll("[data-distribution]").forEach(b=>b.onclick=()=>{
            rowOpen=rowOpen===b.dataset.distribution?"":b.dataset.distribution;render();
            if(rowOpen) area.querySelector('[data-bucket][aria-expanded="true"]')?.scrollIntoView({block:"nearest"});
        });
        area.querySelectorAll("[data-bucket]").forEach(b=>b.onclick=()=>{const name=rows[+b.dataset.bucket].name;rowOpen=rowOpen===name?"":name;render()});
        area.querySelectorAll("[data-preview]").forEach(b=>b.onclick=()=>previewQuestion(planQuestion(b.dataset.preview)));
    }
    function abilities(){
        const rows=data.records.filter(r=>r.task===task);
        const synthesis=data.coach[task]?.abilities||[];
        const cards=[task===1?"TA":"TR","CC","LR","GRA"].map(code=>{
            const observations=rows.map(r=>({r,c:r.criteria.find(c=>c.code===code)})).filter(x=>x.c);
            const originals=observations.filter(x=>!x.r.revision),latest=originals[0];
            const revisions=observations.length-originals.length;
            const history=observations.map(x=>`<div class="skill-history"><strong>${esc(x.c.band)} 分</strong><p>${esc(x.c.comment||x.c.gap||x.c.strength)}</p>${evidenceLinks([x.r])}</div>`).join("");
            return `<article class="skill-card panel"><header><div><small>${code}</small><h3>${esc(data.criteria[code])}</h3></div>
              ${latest?`<div class="skill-score">${esc(latest.c.band)}<small>最近原稿</small></div>`:""}</header>
              <p class="hint">${new Set(originals.map(x=>x.r.qid)).size} 道原稿 · ${revisions} 份修订反馈</p>
              ${latest?`<p>${esc(latest.c.comment||latest.c.strength||latest.c.gap)}</p>
              ${latest.c.gap&&latest.c.gap!==latest.c.comment?`<p><b>待提升</b>　${esc(latest.c.gap)}</p>`:""}
              ${latest.c.next_step?`<p class="skill-next"><b>下次练习</b>${esc(latest.c.next_step)}</p>`:""}`:'<p class="hint">提交并批改一篇原稿后，这里会显示对应维度的反馈。</p>'}
              ${history?`<details><summary>查看历次反馈（${observations.length}）</summary>${history}</details>`:""}</article>`;
        }).join("");
        area.innerHTML=`<div class="analysis-intro"><div><h2>Task ${task} 能力分析</h2><p class="hint">四项分数取自最近有批改的原稿，修订反馈可单独展开查看。</p></div>${coachButton()}</div>${warning()}
        ${synthesis.length?`<section class="coach-notes">${synthesis.map(a=>`<article><h3>${esc(a.skill)}</h3><p>${esc(a.observation)}</p><p class="skill-next"><b>下次验证</b>${esc(a.next_step)}</p>
        ${a.refs?.length?`<details><summary>查看依据的稿件</summary>${planReferences(data,a.refs)}</details>`:""}</article>`).join("")}</section>`:""}
        <section class="skill-grid" aria-label="四项写作评分维度">${cards}</section>`;
        bindCoach();
    }
    function generator(){
        const kinds=data.types[task];if(!kinds.includes(selectedType))selectedType=kinds[0];
        const generated=bank.filter(q=>q.mode==="ai"&&q.task===task).slice().reverse();
        area.innerHTML=`<section class="panel"><h2>AI 原创写作题</h2><form id="generateForm" class="stack topgap"><label>题型<select id="genType">${planOptions(kinds,selectedType)}</select></label>
        <label>话题（选填）<input class="field" id="genTopic" maxlength="60" list="topicChoices" placeholder="留空随机，也可选择或输入" value="${esc(selectedTopic)}"><datalist id="topicChoices">${allTopics().map(t=>`<option value="${esc(t)}"></option>`).join("")}</datalist></label>
        <label>具体要求（选填）<textarea id="genBrief" maxlength="1200" rows="3" placeholder="${task===1?"例如，两条线路先持平再拉开，练习比较交点。":"例如，围绕就业讨论双方观点，换一个大学选课以外的场景。"}">${esc(brief)}</textarea></label>
        <div><button class="btn primary" ${generating?"disabled":""}>${generating?"正在生成…":"生成练习题"}</button></div></form>${warning()}</section>
        ${made?`<section class="panel topgap"><h2>${esc(made.title)}</h2>${reportQuestion(made)}${button("开始写作","startMade",true)}</section>`:""}
        ${generated.length?`<section class="panel topgap"><h2>已生成的题目</h2>${generated.map(q=>`<button class="record" data-ai="${esc(q.id)}"><span>${esc(q.title)}</span>${tag(q.study_type)}</button>`).join("")}</section>`:""}`;
        $("#genType",area).onchange=e=>selectedType=e.target.value;
        $("#genTopic",area).oninput=e=>selectedTopic=e.target.value;
        $("#genBrief",area).oninput=e=>brief=e.target.value;
        $("#generateForm",area).onsubmit=async e=>{e.preventDefault();if(generating)return;generating=true;error="";render();
            try{made=await api("plan/generate",{task,type:selectedType,topic:selectedTopic,brief});if(!planQuestion(made.id))bank.push(made)}
            catch(e){error=e.message}finally{generating=false;render()}};
        if(made)$("#startMade",area).onclick=()=>start([made.id]);
        area.querySelectorAll("[data-ai]").forEach(b=>b.onclick=()=>previewQuestion(planQuestion(b.dataset.ai)));
    }
    render();
}
