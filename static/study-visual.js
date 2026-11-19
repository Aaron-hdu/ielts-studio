function studyVisual(q) {
    const v = q.visual;
    if (!v || !q.task || q.task !== 1) return "";
    if (v.steps) return '<ol class="process-steps">' + v.steps.map(s=>`<li>${esc(s)}</li>`).join("") + '</ol>';
    if (v.map) return '<p class="mini">↑ North</p><div class="map-pair">' + ["before","after"].map((key,i)=>
        `<figure><figcaption>${esc(v.map.periods[i])}</figcaption><div class="map-grid">${v.map[key].map(s=>`<span>${esc(s)}</span>`).join("")}</div></figure>`).join("") + '</div>';
    return (v.charts||[]).map((c,i)=>chartView(c,q.study_type==="混合图"?(i?"表格":"柱状图"):q.study_type)).join("");
}
function chartView(c, kind) {
    const colors=["#6752a1","#247568","#ae602d","#4c70a5","#a23b66","#718330","#715e47","#384652"];
    const table=`<div class="archive-table"><table><thead><tr><th>${esc(c.unit)}</th>${c.labels.map(t=>`<th>${esc(t)}</th>`).join("")}</tr></thead><tbody>${c.series.map(s=>`<tr><th>${esc(s.name)}</th>${s.values.map(n=>`<td>${n}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    let graphic="",legend=[];
    if(kind==="饼图"){
        let sum=0;
        const stops=c.series[0].values.map((v,i)=>{const start=sum;sum+=v;return `${colors[i]} ${start}% ${sum}%`});
        graphic=`<div class="study-pie" style="background:conic-gradient(${stops.join(",")})"></div>`;
        legend=c.labels.map((s,i)=>`${s} · ${c.series[0].values[i]}%`);
    } else if(kind!=="表格"){
        const values=c.series.flatMap(s=>s.values), low=Math.min(0,...values),high=Math.max(0,...values);
        const y=n=>155-130*(n-low)/(high-low||1);
        const gap=490/c.labels.length, x=i=>65+(i+0.5)*gap;
        let plot="";
        for(let j=0;j<=4;j++){
            const val=low+(high-low)*j/4;
            plot+=`<path d="M65 ${y(val)}h490" stroke="#dedce5"/><text x="58" y="${y(val)+4}" text-anchor="end">${+val.toFixed(2)}</text>`;
        }
        c.series.forEach((s,j)=>{
            if(kind==="折线图"){
                plot+=`<polyline points="${s.values.map((v,i)=>x(i)+","+y(v)).join(" ")}" fill="none" stroke="${colors[j]}" stroke-width="3"/>`;
                plot+=s.values.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="3" fill="${colors[j]}"/>`).join("");
            } else {
                const w=gap*.76/c.series.length;
                plot+=s.values.map((v,i)=>`<rect x="${x(i)-gap*.38+j*w}" y="${Math.min(y(0),y(v))}" width="${w*.94}" height="${Math.abs(y(v)-y(0))}" fill="${colors[j]}"/>`).join("");
            }
        });
        plot+=c.labels.map((t,i)=>`<text x="${x(i)}" y="175" text-anchor="middle">${esc(t.length>11?t.slice(0,10)+"…":t)}</text>`).join("");
        graphic=`<svg role="img" aria-label="${esc(c.title)}" viewBox="0 0 575 190">${plot}</svg>`;
        legend=c.series.map(s=>s.name);
    }
    return `<figure class="study-figure"><figcaption>${esc(c.title)} · ${esc(c.unit)}</figcaption>${graphic}${legend.map((s,i)=>`<span class="chart-key"><i style="background:${colors[i]}"></i>${esc(s)}</span>`).join("")}${graphic?`<details><summary>查看数据</summary>${table}</details>`:table}</figure>`;
}
