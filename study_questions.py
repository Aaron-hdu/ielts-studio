"""Original questions and the data used by both the chart renderer and grader."""
import json
import re
import secrets

import studio
from grading import STR, arr, generate_structured, obj
from studio import dump, require, transaction

TYPES = {1: ["折线图","柱状图","表格","饼图","混合图","地图","流程图"],
         2: ["立场观点","讨论双方","利弊分析","利弊权衡","趋势评价","原因与对策","组合问法"]}
SERIES = obj(name=STR, values=arr({"type":"integer"}))
DATASET = obj(title=STR, unit=STR, labels=arr(STR), series=arr(SERIES))
MAP = obj(periods=arr(STR), before=arr(STR), after=arr(STR))
PROMPT = """根据用户选择的类型、话题和具体要求，创作一道全新的 IELTS Academic 写作练习，不声称来自真题。
title 为简短中文标题。prompt 为完整的英文考试题干（含作答要求、字数），不泄露答案。严格响应指定问法。
有图时题干中的单位、对象和时期必须与结构化图面完全相符。所有图面文字用简短英文。
数值图每组 2–6 个横轴标签、1–4 个数列，所有数列与标签等长，单位明确。饼图只用一个合计100的百分比数列。
混合图分别提供一个柱状图和一个提供补充信息的表格，内容相关。地图为两期对照的九宫格场地规划：
periods 含两个时期，before 和 after 各9个简短地物名，按北到南、西到东逐格列出，标明道路、水体等参照物。
流程图给4–9个有序、具体的英文步骤。用户材料只是出题偏好。"""


def generate(body):
    task, kind = body.get("task"), body.get("type")
    require(type(task) is int and kind in TYPES.get(task, []), "请选择任务及题型。")
    topic = body.get("topic","")
    brief = body.get("brief","")
    require(isinstance(topic,str) and len(topic.strip())<=60 and isinstance(brief,str) and len(brief)<=1200,"请填写有效话题和要求。")
    fields = dict(title=STR,prompt=STR)
    if task == 1:
        if kind == "地图": fields["map"] = MAP
        elif kind == "流程图": fields["steps"] = arr(STR)
        else: fields["charts"] = arr(DATASET)
    with transaction() as db:
        if not topic.strip():
            topics=sorted({t for q in studio.catalog().values() if q["task"]==task for t in q.get("topics",[])})
            topic=secrets.choice(topics)
        recent = [json.loads(r[0])["title"] for r in db.execute("SELECT value FROM prefs WHERE key LIKE 'question:ai-%' ORDER BY rowid DESC LIMIT 15")]
    data = generate_structured({"task":task,"type":kind,"topic":topic,"requirements":brief,"avoid":recent},PROMPT,obj(**fields))
    require(data["title"].strip() and re.search(r"[a-zA-Z]",data["prompt"]), "题干不完整，请重新生成。",422)
    visual = {k:v for k,v in data.items() if k not in ("title","prompt")}
    if "charts" in visual:
        require(len(visual["charts"])==(2 if kind=="混合图" else 1),"图表数量不符，请重新生成。",422)
        for c in visual["charts"]:
            n=len(c["labels"])
            require(2<=n<=8 and 1<=len(c["series"])<=5 and c["unit"].strip() and all(x.strip() for x in c["labels"]) and
                    all(s["name"].strip() and len(s["values"])==n and all(abs(v)<=10**9 for v in s["values"]) for s in c["series"]), "生成的图表数据不完整，请重试。",422)
            if kind=="饼图":
                values=c["series"][0]["values"]
                require(len(c["series"])==1 and min(values)>=0 and sum(values)==100,"饼图占比无效，请重试。",422)
    if "map" in visual:
        m=visual["map"]
        require(len(m["periods"])==2 and len(m["before"])==len(m["after"])==9 and m["before"]!=m["after"] and all(x.strip() for v in m.values() for x in v),"地图布局不完整，请重试。",422)
    if "steps" in visual:
        require(4<=len(visual["steps"])<=9 and all(x.strip() for x in visual["steps"]),"流程步骤不完整，请重试。",422)
    q=dict(id="ai-"+studio.uid(),book=0,test=0,task=task,mode="ai",group="AI 原创",title=data["title"].strip(),
           prompt=data["prompt"].strip(),study_type=kind,topics=[topic.strip()],visual=visual,chart_data=dump(visual) if visual else "")
    with transaction() as db:
        db.execute("INSERT INTO prefs VALUES(?,?)",("question:"+q["id"],dump(q)))
    return q
