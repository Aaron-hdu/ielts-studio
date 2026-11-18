
function exportAnki(cards) {
    const field = value => esc(value || "").replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
    const rows = cards.map(card => {
        const back = [card.meaning, card.usage, card.collocation, card.context].filter(Boolean);
        return [field(card.target), back.map(field).join("<br><br>")].join("\t");
    });
    download(["#separator:Tab", "#html:true", ...rows].join("\n")+"\n",
        "页间写作室-Anki.txt", "text/plain;charset=utf-8");
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
    function picker() {
        const due = card => (mode==="flash"?card.flash_due:card.due)<=Date.now();
        area.innerHTML = `<div class="chips">${Object.entries(modes).map(([id,title])=>
            `<button class="chip ${mode===id?"on":""}" data-mode="${id}">${title}</button>`).join("")}</div>
            <div class="sec"><h2>选择要练的词和表达</h2><span class="meta" id="selectionCount"></span></div>
            <div class="actions"><button class="soft" data-select="all">全选</button><button class="soft" data-select="due">只选到期 · ${cards.filter(due).length}</button><button class="soft" data-select="none">清空</button></div>
            <div class="study-list">${cards.map(c=>`<label><input type="checkbox" value="${esc(c.id)}" ${selected.has(c.id)?"checked":""}><span><b>${esc(c.target)}</b><small>${esc(c.meaning)}</small></span></label>`).join("")}</div>
            <div class="actions">${button(mode==="flash"?"开始背记":"生成新一轮练习","beginStudy",true)}
            ${mode==="recall"?button("用已存例句练习","useStored"):""}${button("导出所选到 Anki","anki")}</div>
            <p class="hint topgap">${mode==="flash"?"英文在正面。先回忆含义，再翻面查看用法和例句。":"每轮从已选表达生成新语境，使用设置中的 Codex 或 API。"} Anki 文件按 Basic（正面 / 背面）导入。</p>
            <details class="compactdetail topgap"><summary>查看用法、来源和复习日期</summary>
            ${cards.map(c=>`<article class="expression"><b>${esc(c.target)}</b> · ${esc(c.meaning)}<p>${esc(c.context)}</p><p class="hint">${esc(c.usage||"")} ${esc(c.collocation||"")}</p><p class="hint">下次输出复习 ${niceDate(c.due)}</p>${c.origins.map(o=>`<a class="blocklink" href="#report/${o.sid}">回看来源作文</a>`).join(" ")}</article>`).join("")}</details>`;
        const count = () => {
            $("#selectionCount",area).textContent=selected.size+" 项已选";
            for (const btn of area.querySelectorAll("#beginStudy,#useStored,#anki")) btn.disabled=!selected.size;
        };
        count();
        area.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{mode=b.dataset.mode;picker()});
        area.querySelectorAll("[data-select]").forEach(b=>b.onclick=()=>{
            selected.clear();
            for(const c of cards) if(b.dataset.select==="all"||(b.dataset.select==="due"&&due(c))) selected.add(c.id);
            picker();
        });
        area.querySelectorAll("input").forEach(box=>box.onchange=()=>{
            if(box.checked) selected.add(box.value); else selected.delete(box.value);
            count();
        });
        $("#anki",area).onclick=()=>exportAnki(cards.filter(c=>selected.has(c.id)));
        $("#beginStudy",area).onclick=()=>study(false);
        if($("#useStored",area)) $("#useStored",area).onclick=()=>study(true);
    }
    function study(stored) {
        const queue=cards.filter(c=>selected.has(c.id));
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
                        card[mode==="flash"?"flash_due":"due"]=schedule.due;
                        index++; await next();
                    } catch(err){ratingButtons.forEach(el=>el.disabled=false);actionError(err)}
                });
            };
        }
        next().catch(actionError);
    }
    picker();
}

