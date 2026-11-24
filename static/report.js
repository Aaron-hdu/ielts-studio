function annotatedEssay(text,annotations) {
    const spans=[];
    for(const a of annotations) {
        const start=text.indexOf(a.quote), end=start+a.quote.length;
        if(!a.quote||start<0||spans.some(s=>s.start<end&&s.end>start)) continue;
        spans.push({start,end,kind:a.kind,quote:a.quote});
    }
    let html="",pos=0;
    for(const span of spans.sort((a,b)=>a.start-b.start)) {
        const style=proofStyle(span.kind);
        html+=esc(text.slice(pos,span.start))+`<mark class="${style}" title="${esc(span.kind)}">${esc(span.quote)}</mark>`;
        pos=span.end;
    }
    return html+esc(text.slice(pos));
}
function proofStyle(kind) {
    return ({"错误":"proof-error","建议":"proof-suggestion","亮点":"proof-strength"})[kind]||"";
}
// Existing reports store expressions in dictionary form, even when an example uses the past tense.
const irregularReportVerbs = new Map(Object.entries({
    rise:["rose","risen"], fall:["fell","fallen"], overtake:["overtook","overtaken"],
    grow:["grew","grown"], take:["took","taken"], make:["made"], lead:["led"],
    see:["saw","seen"], show:["shown"], hold:["held"], become:["became"]
}));
function expressionPattern(target) {
    const escape = word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return target.trim().split(/\s+/).map(word => {
        if (!/^[a-z]{3,}$/i.test(word)) return escape(word);
        const forms = new Set([word, word + "s", ...(irregularReportVerbs.get(word.toLowerCase()) || [])]);
        if (/[^aeiou]y$/i.test(word)) {
            forms.add(word.slice(0, -1) + "ies");
            forms.add(word.slice(0, -1) + "ied");
        }
        if (/(s|sh|ch|x|z|o)$/i.test(word)) forms.add(word + "es");
        forms.add(word.endsWith("e") ? word + "d" : word + "ed");
        forms.add((/[^e]e$/i.test(word) ? word.slice(0, -1) : word) + "ing");
        return "(?:" + [...forms].map(escape).join("|") + ")";
    }).join("[ \\t]+");
}

function highlightExpressions(text, targets) {
    const terms = [...new Set(targets.map(t => t.trim()).filter(Boolean))];
    if (!terms.length) return esc(text);
    const patterns = terms.sort((a,b) => b.length - a.length).map(expressionPattern);
    const regex = new RegExp("(^|[^a-zA-Z0-9’'])(" + patterns.join("|") + ")(?![a-zA-Z0-9’'])", "gi");
    let html = "", offset = 0;
    for (const match of text.matchAll(regex)) {
        const start = match.index + match[1].length;
        html += esc(text.slice(offset, start)) + `<mark class="learn-phrase">${esc(match[2])}</mark>`;
        offset = start + match[2].length;
    }
    return html + esc(text.slice(offset));
}

function highlightedRewrite(report) {
    // New reports mark the exact inflected phrase. Older reports can use their linked teaching items.
    if (/\*\*[^*\n]+\*\*/.test(report.rewrite)) {
        return report.rewrite.split(/\*\*([^*\n]+)\*\*/g).map((part, i) =>
            i % 2 ? `<mark class="learn-phrase">${esc(part)}</mark>` : esc(part)).join("");
    }
    const items = [...report.expressions, ...(report.vocabulary || [])];
    return highlightExpressions(report.rewrite, items.map(item => item.target));
}

function languageSection(report) {
    const items=report.language_errors;
    const groups=items===undefined ? '<p class="hint">这份历史报告可以按原稿补查拼写和语法。</p><button class="btn topgap" id="languageCheck">补查原稿</button>' :
        ["拼写","语法"].map(kind=>{
            const group=items.filter(item=>item.category===kind);
            return `<article class="language-group"><h3>${kind} <span class="meta">${group.length} 项</span></h3>${group.map(item=>
                `<p><del class="proof-error">${esc(item.quote)}</del> → <mark class="proof-revision">${esc(item.correction)}</mark></p><p class="hint">${esc(item.reason)}</p>`).join("")||'<p class="hint">本次检查未标出明确错误。</p>'}</article>`;
        }).join("");
    return `<section class="panel report-section"><h2>拼写与语法</h2>${groups}</section>`;
}
function vocabularySection(report) {
    const items=report.vocabulary;
    const body=items?items.map((v,i)=>`<div class="vocab-item">
        <div class="row between"><span class="vocab-pair"><span class="vocab-source">${esc(v.original)}</span> → <mark class="learn-phrase">${esc(v.target)}</mark></span><button class="btn addcard" data-section="vocabulary" data-index="${i}">加入练习</button></div>
        <p>${esc(v.meaning)}</p>
        <p class="usage"><b>何时使用</b>　${esc(v.usage)}</p>
        <p><b>常见搭配</b>　<strong class="vocab-collocation">${esc(v.collocation)}</strong></p>
        <p class="essaytext vocab-example">${highlightExpressions(v.context,[v.target])}</p>
        </div>`).join("")||'<p class="hint">本篇没有需单独补充的近义表达。</p>':
        '<p class="hint">这是一份较早的报告，可以按原文补充近义表达、使用场合和例句。</p><button id="supplement" class="btn topgap">生成词汇提升</button>';
    return `<section class="panel report-section"><h2>词汇提升</h2>${body}</section>`;
}

async function reportPage(id){
await cleanup();cleanup=async()=>{};
const s=await api("sessions/"+id);let qi=location.hash.endsWith("?task=2") && s.questions.length===2 ? 1 : 0,playTimer,poll;
function show(){clearInterval(playTimer);const q=s.questions[qi],r=s.reports[q.id];const grades=r?r.criteria.map(c=>c.band):[];main.innerHTML=topbar("作文报告")+heading("Writing report",reportTitle(q))+`<div class="toolbar">${s.questions.map((q,i)=>`<button class="chip ${i===qi?"on":""}" data-task="${i}">Task ${q.task}</button>`).join("")}${button(s.grade_state==="running"?"正在批改…":"生成批改报告","grade",true)}${button("重写这篇","rewrite")}${button("下载 Markdown","md")}</div><p class="hint">${niceDate(s.started)} · ${wordCount(s.texts[q.id])} 词 · 用时 ${clock((s.elapsed_ms??(s.finished-s.started)))} · 模型估分</p>${s.grade_error?`<p class="notice">${esc(s.grade_error)}</p>`:""}${reportQuestion(q)}<div class="report-section panel"><h2>交卷原文</h2><div class="essaytext topgap">${annotatedEssay(s.texts[q.id],r?.annotations||[])||"空白答卷"}</div></div>${r?`<section class="panel report-section"><div class="row between"><h2>四项评分</h2><div class="band">${(Math.round(grades.reduce((a,b)=>a+b,0)/4*2)/2).toFixed(1)}</div></div><p>${esc(r.summary)}</p><div class="four topgap">${r.criteria.map(c=>`<div class="metric"><b>${c.band}</b><small>${c.code}</small></div>`).join("")}</div>${r.criteria.map(c=>`<details class="compactdetail topgap"><summary>${c.code} · 评分依据与提升建议</summary><p>${esc(c.strength)}</p><p>${esc(c.gap)}</p><p>${esc(c.next_step)}</p></details>`).join("")}<h3>写得好的地方</h3><ul>${r.strengths.map(t=>`<li>${esc(t)}</li>`).join("")}</ul><h3>下一步</h3><ol>${r.priorities.map(t=>`<li>${esc(t)}</li>`).join("")}</ol><p class="hint">${esc(r.limitations)}</p></section><section class="panel report-section"><h2>逐句批注</h2>${r.annotations.map(a=>`<div class="annotation">${tag(a.kind)}<blockquote><span class="${proofStyle(a.kind)}">${esc(a.quote)}</span></blockquote><p><mark class="proof-revision">${esc(a.revision)}</mark></p><p class="hint">${esc(a.reason)}</p></div>`).join("")}</section>`:""}<section class="replay report-section"><div class="row between"><h2>写作回放</h2><span id="replayTime" class="meta"></span></div><div class="toolbar topgap">${button("播放","play",false,"play")}<select id="speed" aria-label="回放速度"><option value="1">1×</option><option value="4" selected>4×</option><option value="16">16×</option></select><label class="mini"><input id="skip" type="checkbox" checked> 跳过空闲时间</label></div><input type="range" id="seek" aria-label="写作时间线" min="0" max="${(s.elapsed_ms??(s.finished-s.started))}" value="0"><div id="replayed" class="essaytext replay-text"></div><div id="pauses" class="topgap"></div>${r?`<h3 class="topgap">写作习惯</h3>${r.habits.map(h=>`<div class="annotation"><button class="soft jump" data-time="${h.time_ms}">${clock(h.time_ms)} · 回放</button><p>${esc(h.observation)}</p><p class="hint">${esc(h.advice)}</p></div>`).join("")}`:""}</section>${r?`<section class="panel report-section"><h2>逐段对照 · 提升版</h2><div class="compare topgap"><div class="essaytext">${esc(s.texts[q.id])}</div><div class="essaytext">${highlightedRewrite(r)}</div></div><h3>改了什么</h3><ul>${r.improvements.map(t=>`<li>${esc(t)}</li>`).join("")}</ul></section>${languageSection(r)}${vocabularySection(r)}<section class="panel report-section"><h2>可迁移表达</h2>${r.expressions.map((x,i)=>`<div class="expression"><div class="row between"><b>${esc(x.target)}</b><button class="btn addcard" data-index="${i}">加入练习</button></div><p>${esc(x.meaning)}</p><p class="hint">${esc(x.context)}</p></div>`).join("")}</section>`:""}<details class="panel report-section"><summary>Markdown 原档与个人笔记</summary><pre class="codetext">${esc(s.archives[q.id]||"")}</pre></details>`;
$("#grade").disabled=s.grade_state==="running"||!!r;$("#grade").onclick=async()=>{await api("sessions/"+id+"/grade",{});await reportPage(id)};$("#rewrite").onclick=()=>start([q.id],id);$("#md").onclick=()=>download((s.archives[q.id]||"").replace(/^# [^\n]*/, () => "# "+reportTitle(q)),id+".md","text/markdown");main.querySelectorAll("[data-task]").forEach(b=>b.onclick=()=>{qi=+b.dataset.task;show()});main.querySelectorAll(".addcard").forEach(b=>b.onclick=async()=>{b.disabled=true;b.textContent="准备练习中…";try{await api("cards",{session:id,question:q.id,index:+b.dataset.index,section:b.dataset.section||"expressions"});b.textContent="已加入"}catch(err){b.disabled=false;b.textContent="加入练习";actionError(err)}});
for(const [selector,endpoint] of [["#supplement","vocabulary"],["#languageCheck","language-check"]]) if($(selector)) $(selector).onclick=async e=>{
    const btn=e.currentTarget;btn.disabled=true;btn.textContent="正在分析…";
    try { await api(endpoint,{session:id,question:q.id});if(btn.isConnected){const updated=await api("sessions/"+id);s.reports=updated.reports;s.archives=updated.archives;show()} }
    catch(err){btn.disabled=false;btn.textContent="重试";actionError(err)}
};
const events=s.events.filter(e=>e.q===q.id);let t=0;function render(){let text="";for(const e of events){if(e.t>t)break;const chars=Array.from(text);text=chars.slice(0,e.at).join("")+e.add+chars.slice(e.at+e.cut).join("")}$("#replayed").textContent=text||"尚未落笔";$("#replayTime").textContent=clock(t)+" / "+clock((s.elapsed_ms??(s.finished-s.started)));$("#seek").value=t}
$("#seek").oninput=e=>{t=+e.target.value;render()};$("#play").onclick=()=>{if(playTimer){clearInterval(playTimer);playTimer=null;$("#play").textContent="播放";return}$("#play").textContent="暂停";playTimer=setInterval(()=>{t+=250*Number($("#speed").value);const next=events.find(e=>e.t>t);if($("#skip").checked&&next&&next.t-t>4000)t=next.t;t=Math.min(t,(s.elapsed_ms??(s.finished-s.started)));render();if(t>=(s.elapsed_ms??(s.finished-s.started))){clearInterval(playTimer);playTimer=null;$("#play").textContent="播放";t=0}},250)};
const pauses=[];let last=0;for(const e of events){if(e.t-last>5000)pauses.push({t:last,gap:e.t-last});last=e.t}$("#pauses").innerHTML=pauses.sort((a,b)=>b.gap-a.gap).slice(0,5).map(p=>`<button class="chip jump" data-time="${p.t}">${clock(p.t)} · 间隔 ${Math.round(p.gap/1000)} 秒</button>`).join(" ");main.querySelectorAll(".jump").forEach(b=>b.onclick=()=>{t=+b.dataset.time;render()});render()}
show();if(s.grade_state==="running")poll=setTimeout(()=>{if(location.hash!=="#report/"+id)return;reportPage(id).catch(actionError)},6000);cleanup=async()=>{clearTimeout(poll);clearInterval(playTimer)}
}
function download(data,name,mime){const url=URL.createObjectURL(new Blob([data],{type:mime})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

