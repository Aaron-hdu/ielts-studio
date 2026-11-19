async function settingsPage(){
const [s,locationInfo,library]=await Promise.all([api("settings"),api("storage"),api("question-library")]);main.innerHTML=topbar("工作室设置")+heading("Studio settings","工作室设置")+`<div class="settings"><section class="panel stack" id="libraryConfig"><h2>剑雅题库</h2><label>读题方式<select id="libraryMode"><option value="local">本地题库</option><option value="online">联网题源</option></select></label><div id="libraryStats" aria-live="polite"></div><div class="actions"><button class="btn" id="libraryRetry">补全缺少的题目和配图</button><button class="btn" id="libraryText">导出已存题文（Markdown）</button><button class="btn" id="libraryPack">导出独立题库包</button><label class="btn">导入题库包<input id="libraryImport" type="file" accept=".zip" hidden></label></div><p class="hint">题文保存在个人数据目录的 studio.sqlite3，图片保存在「配图」文件夹。下载由本机服务执行，无需配置模型。</p></section><form id="config" class="panel stack"><h2>批改方式</h2><label>接入方式<select id="mode"><option value="codex">本机 Codex 智能体</option><option value="api">API Key · OpenAI 兼容接口</option><option value="agent">其他智能体 · 本机接口</option></select></label><p class="hint">本机 Codex 使用已登录账号调用模型。API 模式支持 Chat Completions 与 JSON 输出。外部智能体可以读取待批改列表，提交结构化报告。</p><label id="codexFields">Codex 模型<input class="field" list="codexChoices" id="codexModel" value="${esc(s.codex_model||"")}" placeholder="留空使用 CLI 默认模型"><datalist id="codexChoices">${(s.codex_models||[]).map(m=>`<option value="${esc(m)}"></option>`).join("")}</datalist></label><div id="apiFields" class="stack"><label>Base URL<input class="field" id="base" value="${esc(s.base)}" placeholder="https://api.openai.com/v1"></label><label>模型名<input class="field" id="model" value="${esc(s.model)}" placeholder="填写服务提供的模型 ID"></label><label>API Key<input class="field" id="key" type="password" autocomplete="new-password" placeholder="${s.has_key?"已保存，留空则保留":"填写 API Key"}"></label><label class="inline"><input id="clearKey" type="checkbox">清除已保存的密钥</label><p class="hint">密钥保存在本机受限配置文件中，备份包不包含密钥。更改服务地址时需重新填写。</p></div><label>目标分数<select id="goal">${[5,5.5,6,6.5,7,7.5,8,8.5,9].map(n=>`<option value="${n}">${n}</option>`).join("")}</select></label><label class="inline"><input type="checkbox" id="auto">交卷后自动批改</label><p class="hint">批改时会把当次作文、题目与写作过程摘要发送给你选定的模型服务。</p>${button("保存设置","saveconfig",true)}</form><section class="panel"><h2>本机数据与备份</h2><p class="meta topgap">当前数据目录</p><p class="codetext">${esc(locationInfo.path)}</p><label class="fieldlabel topgap">新的本机数据目录<input class="field" id="newLocation" placeholder="输入一个新的或空的文件夹绝对路径"></label><button class="btn topgap" id="moveData" ${locationInfo.environment?"disabled":""}>迁移数据并切换</button><p class="hint">${locationInfo.environment?"本次启动已指定 IELTS_DATA。如需通过网页切换，请先移除该变量并重启。":"将复制并核对现有记录和配置，之后写入新目录。旧目录作为迁移前副本保留。"}</p><p class="desc topgap">每次写作生成一份 Markdown，草稿、回放事件和复习进度保存在 SQLite。恢复会先保留一份当前数据备份。</p><div class="actions topgap">${button("下载完整备份","backup",false,"folder")}<label class="btn">恢复备份<input type="file" id="restore" accept=".zip" hidden></label></div></section><section class="panel"><h2>使用与接入文档</h2><div class="actions topgap"><a class="btn" href="/用户手册.md" target="_blank">用户手册</a><a class="btn" href="/智能体接入手册.md" target="_blank">智能体接入手册</a></div></section></div>`;
bindQuestionLibrary(library);
$("#mode").value=s.mode;$("#goal").value=s.goal;$("#auto").checked=s.auto;function visible(){$("#codexFields").hidden=$("#mode").value!=="codex";$("#apiFields").hidden=$("#mode").value!=="api";$("#auto").disabled=$("#mode").value==="agent"}visible();$("#mode").onchange=visible;
$("#saveconfig").onclick=async()=>{await api("settings",{codex_model:$("#codexModel").value.trim(),mode:$("#mode").value,base:$("#base").value,model:$("#model").value,key:$("#key").value,clear_key:$("#clearKey").checked,goal:+$("#goal").value,auto:$("#auto").checked});$("#key").value="";toast("设置已保存")};$("#config").onsubmit=e=>e.preventDefault();
$("#moveData").onclick=async()=>{const path=$("#newLocation").value.trim();if(!path)return toast("请输入新的绝对路径。");if(!confirm("复制当前学习记录和密钥配置到以下目录？\n"+path))return;$("#moveData").disabled=true;try{await api("storage",{path});toast("数据目录已切换");await settingsPage()}finally{if($("#moveData"))$("#moveData").disabled=false}};
$("#backup").onclick=async()=>{const r=await fetch("/api/backup",{headers:{"X-Studio":"1"}});if(!r.ok)throw Error("备份失败");download(await r.blob(),"页间写作备份.zip","application/zip")};
$("#restore").onchange=async e=>{const file=e.target.files[0];if(!file||!confirm("将恢复备份中的学习记录。当前记录会另存为恢复前备份。继续？"))return;const r=await fetch("/api/restore",{method:"POST",headers:{"X-Studio":"1"},body:file}),v=await r.json();if(!r.ok)throw Error(v.error);toast("恢复完成");go("home")}
}


function bindQuestionLibrary(initial){
    const panel=$("#libraryConfig"),mode=$("#libraryMode",panel),stats=$("#libraryStats",panel);
    const retry=$("#libraryRetry",panel),exportText=$("#libraryText",panel);
    let timer,version=0;
    function render(state){
        if(!panel.isConnected)return;
        mode.value=state.mode;
        const local=state.mode==="local",running=state.job.phase==="running";
        const missing=state.texts<state.total||state.charts<state.total_charts;
        retry.hidden=!local||!missing||running;
        exportText.disabled=!state.texts;
        stats.innerHTML=`<p>${local?"从本机读题。选择此模式时将自动下载缺少的材料。":"每次选题时向题源请求题文和配图；源站不可用时会标明使用的本机副本。"}</p>
            <p class="meta topgap">已存题文 ${state.texts} / ${state.total} 道　·　已存配图 ${state.charts} / ${state.total_charts} 张</p>
            ${running?'<p class="hint">正在补全题库，可离开设置页。切换为联网模式可停止后续下载。</p>':""}
            ${local&&state.job.phase==="paused"?`<p class="notice">${esc(state.job.detail)} 已保存的材料可继续使用。</p>`:""}`;
        if(running){
            const seq=version;
            timer=setTimeout(async()=>{
                try{const updated=await api("question-library");if(seq===version)render(updated)}
                catch(e){if(panel.isConnected&&seq===version)stats.textContent=e.message}
            },1500);
        }
    }
    async function save(){
        clearTimeout(timer);version++;mode.disabled=retry.disabled=true;
        try{render(await api("question-library",{mode:mode.value}))}
        catch(e){actionError(e);render(await api("question-library"))}
        finally{mode.disabled=retry.disabled=false}
    }
    mode.onchange=save;retry.onclick=save;
    exportText.onclick=async()=>{
        const r=await fetch("/api/question-library/text",{headers:{"X-Studio":"1"}});
        if(!r.ok)throw Error("题文导出失败，请重试。");
        download(await r.text(),"剑雅本地题文.md","text/markdown;charset=utf-8");
    };
    $("#libraryPack",panel).onclick=async()=>{
        const r=await fetch("/api/question-library/pack",{headers:{"X-Studio":"1"}});
        if(!r.ok)throw Error("导出题库失败，请重试。");
        download(await r.blob(),"剑雅本地题库.zip","application/zip");
    };
    $("#libraryImport",panel).onchange=async e=>{
        const file=e.currentTarget.files[0];
        e.currentTarget.value="";
        if(!file)return;
        const r=await fetch("/api/question-library/pack",{method:"POST",headers:{"X-Studio":"1"},body:file});
        const data=await r.json();
        if(!r.ok)throw Error(data.error||"无法导入题库包。");
        clearTimeout(timer);version++;render(await api("question-library"));
        toast("已补入 "+data.added+" 道题目");
    };
    render(initial);
    cleanup=async()=>{version++;clearTimeout(timer)};
}
