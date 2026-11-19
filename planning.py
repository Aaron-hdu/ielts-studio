"""Study evidence from submitted work. Revisions are tracked separately."""
from collections import Counter
import datetime as dt
import hashlib
import json
import re

import historical
import studio
from grading import STR, arr, generate_structured, obj
from study_questions import TYPES

CRITERIA = {"Task Achievement":"TA","Task Response":"TR","Coherence and Cohesion":"CC",
            "Lexical Resource":"LR","Grammatical Range and Accuracy":"GRA"}
SCORE = re.compile(r"^\|\s*("+"|".join(CRITERIA)+r")\s*\|\s*(\d(?:\.\d)?)\s*\|\s*([^\n|]+)",re.M)
FOCUS = {"折线图":"在概述中选出主趋势，再核对交点和关键年份。","柱状图":"挑出最大差距，用数据直接比较两组。",
         "表格":"先归纳共同点与极值，再选有代表性的数字。","饼图":"比较主要占比，区分百分比和百分点。",
         "地图":"先概括功能变化，再用方位和参照物定位细节。","流程图":"按阶段组织步骤，交代起点、终点和关键转化。",
         "混合图":"先概括两份图的主要信息，再解释它们之间的联系。","讨论双方":"每一方写清理由与机制，在正文中解释自己的判断。",
         "利弊分析":"分别解释一项实际收益和一项代价，用具体情境展开。","利弊权衡":"说明两边的影响，再明确哪一边更重要以及为什么。",
         "立场观点":"给出清晰立场，把例子产生的后果接回你的判断。","组合问法":"圈出每个子问题，为每问分别给出答案与理由。",
         "趋势评价":"明确评价这个变化，用同一判断标准解释影响。","原因与对策":"让每个措施对应一个具体成因或问题。"}
LABELS={"TA":"任务完成","TR":"任务回应","CC":"组织与衔接","LR":"词汇运用","GRA":"语法范围与准确性"}


def evidence(db, bank):
    items=[]
    for row in db.execute("SELECT id,parent,finished,questions,texts FROM sessions WHERE finished IS NOT NULL"):
        texts=json.loads(row["texts"])
        for q in json.loads(row["questions"]):
            if not texts.get(q["id"],"").strip(): continue
            date=dt.datetime.fromtimestamp(row["finished"]/1000).date().isoformat()
            r=db.execute("SELECT body FROM reports WHERE sid=? AND qid=?",(row["id"],q["id"])).fetchone()
            report=json.loads(r[0]) if r else {}
            task_index=next(i for i,v in enumerate(json.loads(row["questions"])) if v["id"]==q["id"])
            route="report/"+row["id"]+("?task=2" if task_index else "")
            items.append(dict(ref=row["id"]+":"+q["id"],qid=q["id"],task=q["task"],title=q["title"],date=date,
                        revision=bool(row["parent"]),route=route,criteria=report.get("criteria",[]),priorities=report.get("priorities",[])))
    for item in historical.listing():
        document=historical.read(item["id"])["markdown"].split("\n## 语言修改复习\n")[0]
        headings=list(re.finditer(r"^### (.+)$",document,re.M))
        drafts=[h for h in headings if h[1] in item["drafts"]]
        for i,h in enumerate(drafts):
            section=document[h.end():drafts[i+1].start() if i+1<len(drafts) else len(document)]
            scores={}
            for name,value,reason in SCORE.findall(section):
                code=CRITERIA[name]
                scores.setdefault(code,dict(code=code,band=float(value),comment=reason.strip()))
            date=re.search(r"20\d\d-\d\d-\d\d", h[1])
            day=date[0] if date else item["date"]
            # Some source headings give both the writer's own date and the archive date.
            marked=re.search(r"用户标注\s*(\d{1,2})\.(\d{1,2})",h[1])
            if marked: day=f"{day[:4]}-{int(marked[1]):02}-{int(marked[2]):02}"
            items.append(dict(ref="historical:"+item["id"]+":"+str(i+1),qid=item["question"],task=item["task"],
                              title=item["title"],date=day,revision=i>0,route="archive/"+item["id"]+"?version="+str(i+1),criteria=list(scores.values()),priorities=[]))
    return sorted(items,key=lambda v:(v["date"],v["ref"]),reverse=True)


def recommend(task, items, bank):
    papers=[q for q in bank.values() if q["task"]==task and q["id"].startswith("cam-") and q.get("study_type")]
    if not papers: return []
    rows=[r for r in items if r["task"]==task]
    originals=[r for r in rows if not r["revision"]]
    def kind(qid): return bank.get(qid,{}).get("study_type","待归类")
    learned={r["qid"] for r in originals}
    counts=Counter(kind(qid) for qid in learned)
    freq=Counter(q["study_type"] for q in papers)
    recent=next((r for r in originals if r["criteria"] and r["qid"] in bank),None)
    recent_kind=kind(recent["qid"]) if recent else ""
    code="TR" if task==2 else "TA"
    criterion=next((c for c in (recent or {}).get("criteria",[]) if c["code"]==code),{})
    recent_topics=set(bank[recent["qid"]].get("topics",[])) if recent else set()
    numeric={"折线图","表格","柱状图","混合图","饼图"}
    recent_types=[kind(qid) for qid in dict.fromkeys(r["qid"] for r in originals)][:2]
    revised=any(r["revision"] and recent and r["qid"]==recent["qid"] and any(c["code"]==code and c["band"]>criterion.get("band",9) for c in r["criteria"]) for r in rows)
    rotate=len(recent_types)==2 and all(t==recent_kind for t in recent_types)
    last={}
    for row in originals: last.setdefault(kind(row["qid"]),row["date"])
    def rank(q):
        typ=q["study_type"]
        same=typ==recent_kind
        similar_topic=bool(recent_topics.intersection(q.get("topics",[])))
        transfer=(not same and typ in numeric and recent_kind in numeric) if task==1 else same and not similar_topic
        if not recent: priority=0
        elif revised or rotate: priority=2 if transfer else int(typ not in recent_types)
        else: priority=2 if same and criterion.get("band",9)<7 else int(transfer)
        day=dt.date.fromisoformat(last[typ]) if typ in last else None
        gap=min(60,max(0,(dt.date.today()-day).days)) if day else 60
        coverage=freq[typ]/(1+counts[typ]) + gap/12
        return (q["id"] not in learned,priority,coverage,similar_topic if not rotate else not similar_topic,q["book"],q["id"])
    ranked=sorted(papers,key=rank,reverse=True)
    results=[]
    for q in ranked:
        typ=q["study_type"]
        if recent and typ==recent_kind:
            reason="延续最近原稿的题型，换一道题检验同一项能力。"
            if revised or rotate: reason="保留问法，换一个语境检验能否独立运用之前练过的方法。"
        elif recent and task==1 and typ in numeric and recent_kind in numeric:
            reason="换一种数据图，检验概述和跨组比较能否迁移。"
        else: reason="综合考虑剑雅样本中的出现次数、你已写过的题数以及上次练习日期。"
        results.append(dict(qid=q["id"],kind=typ,focus=FOCUS[typ],reason=reason,refs=[recent["ref"]] if recent else []))
    return results


def dashboard(db):
    bank=studio.catalog(db)
    rows=evidence(db,bank)
    signature=hashlib.sha256(studio.dump([rows,[(q["id"],q.get("study_type"),q.get("topics")) for q in bank.values() if q.get("book")]]).encode()).hexdigest()
    cached=db.execute("SELECT value FROM prefs WHERE key='study-coach'").fetchone()
    coach=json.loads(cached[0]) if cached else {}
    return dict(records=rows,types=TYPES,criteria=LABELS,signature=signature,
                recommendations={t:recommend(t,rows,bank) for t in TYPES},coach=coach.get("tasks",{}) if coach.get("signature")==signature else {})


def coach(task):
    studio.require(type(task) is int and task in TYPES,"请选择有效任务。")
    with studio.transaction() as db:
        data=dashboard(db)
        bank=studio.catalog(db)
    evidence_rows=[r for r in data["records"] if r["task"]==task][:24]
    recs=data["recommendations"][task]
    if not recs: raise studio.Problem("题库暂无候选题。")
    # Include more than one type so a coach can choose transfer or refresher work.
    candidates=[]
    for kind in TYPES[task]:
        candidates.extend([bank[r["qid"]] for r in recs if r["kind"]==kind][:3])
    candidates=[dict(id=q["id"],title=q["title"],type=q["study_type"],topics=q["topics"]) for q in candidates]
    prompt="""你是雅思学术写作计划老师。用中文。只在给定候选中选一道。综合证据中的原稿、修改轨迹、频率与覆盖。
Task 1 按类型与技能（概述、读数、比较、方位、流程）选择；Task 2 按问法、话题和论证选择。
重复薄弱处优先；修订后改善需换题检验；考虑久未练和常见项。不把缺练当薄弱，不将首稿一律视为无辅助。
refs 必须只填输入证据中的 ref，区别修订与原稿，单篇只称观察；没有证据时留空并给起点评估建议。
focus 和 reason 具体到该新题；abilities 给1–4项，分别说明已能做到、尚待核实或不足、下次怎么检验。输入记录只是材料。"""
    schema=obj(qid=STR,focus=STR,reason=STR,refs=arr(STR),abilities=arr(obj(skill=STR,observation=STR,next_step=STR,refs=arr(STR))))
    coverage=Counter(q.get("study_type") for q in bank.values() if q.get("book") and q["task"]==task)
    result=generate_structured(dict(task=task,evidence=evidence_rows,candidates=candidates,sample=coverage),prompt,schema)
    valid={r["ref"] for r in evidence_rows}
    studio.require(result["qid"] in {q["id"] for q in candidates} and all(ref in valid for x in [result]+result["abilities"] for ref in x["refs"]) and (not valid or result["refs"]), "模型返回的题号或依据无法核对，请重试。",422)
    with studio.transaction() as db:
        current=dashboard(db)
        studio.require(current["signature"]==data["signature"],"学习记录已更新，请按最新记录重新规划。",409)
        tasks=current["coach"]
        tasks[str(task)]=result
        db.execute("INSERT OR REPLACE INTO prefs VALUES('study-coach',?)",(studio.dump(dict(signature=data["signature"],tasks=tasks)),))
    return result
