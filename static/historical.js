function historyInline(text) {
    return esc(text).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
}

function historyBody(text) {
    const blocks = text.trim().split(/\n\s*\n/);
    return blocks.map(block => {
        const lines = block.split("\n");
        if (lines.length >= 2 && /^\|[\s:|-]+\|$/.test(lines[1])) {
            const cells = row => row.trim().replace(/^\||\|$/g, "").split("|");
            const row = (line, cell) => "<tr>" + cells(line).map(value =>
                `<${cell}>${historyInline(value.trim())}</${cell}>`).join("") + "</tr>";
            return '<div class="archive-table"><table><thead>' + row(lines[0],"th") +
                "</thead><tbody>" + lines.slice(2).map(l => row(l,"td")).join("") + "</tbody></table></div>";
        }
        return lines.map(line => {
            if (/^#{1,6} /.test(line)) return "<h3>" + historyInline(line.replace(/^#{1,6} /,"")) + "</h3>";
            return '<p>' + historyInline(line.replace(/^- /,"• ")) + '</p>';
        }).join("");
    }).join("");
}

function historySections(text) {
    return text.split(/^### /m).map((section, i) => {
        if (!i) return {title:"记录说明",body:section.trim()};
        const split = section.indexOf("\n");
        return {title:section.slice(0,split).trim(),body:section.slice(split + 1).trim()};
    }).filter(section => section.body);
}

async function historicalPage(id) {
    const item = await api("history/" + id);
    const [writing, review] = item.markdown.split("\n## 写作练习记录\n")[1].split("\n## 语言修改复习\n");
    const sections = historySections(writing);
    const drafts = item.drafts.map(title => sections.find(s => s.title === title));
    const feedback = sections.filter(s => !item.drafts.includes(s.title));
    const groups = [...drafts.map((s,i) => ({label:i ? "第" + (i+1) + "稿" : "原稿",sections:[s]})),
        {label:"历次反馈与示范",sections:feedback},{label:"语言修改复习",sections:historySections(review)}];
    main.innerHTML = topbar("写作记录") + heading("Writing archive",item.title,
        `练习 ${id} · Task ${item.task} · ${item.date} · 历史练习`) +
        '<div class="toolbar" id="versions"></div><section class="panel history-content" id="historicalText"></section>';
    const nav = $("#versions"), content = $("#historicalText");
    function select(index) {
        nav.innerHTML = groups.map((g,i) => `<button class="chip ${i===index?"on":""}" aria-pressed="${i===index}" data-group="${i}">${esc(g.label)}</button>`).join("") +
            button("下载 Markdown","archiveMd");
        nav.querySelectorAll("[data-group]").forEach(b => b.onclick = () => select(Number(b.dataset.group)));
        $("#archiveMd").onclick = () => download(item.markdown,"历史练习-"+id+".md","text/markdown");
        content.innerHTML = groups[index].sections.map(s => index < drafts.length
            ? `<h2>${esc(s.title)}</h2>${historyBody(s.body)}`
            : `<details class="archive-detail"><summary>${esc(s.title)}</summary>${historyBody(s.body)}</details>`).join("");
    }
    select(0);
}
