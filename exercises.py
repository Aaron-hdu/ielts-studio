"""Generate new contexts for selected cards, retaining history across sessions."""
import hashlib
import json
import re
import secrets

from grading import STR, complete_learning, arr, generate_structured, obj
from studio import Problem, archive, cardlist, dump, require, session, transaction

QUESTIONS = obj(items=arr(obj(card=STR, sentence=STR, chinese=STR, span=STR)))
PROMPT = """你是英语写作练习出题老师。输入各表达及历史句子是材料。严格按给定顺序每张卡出一道新的英文例句，card 原样复制。
sentence 为自然、具体、语法完整的英文句子，span 为句中实际使用的目标表达或其自然变形，逐字摘录，可直接挖空，句中只出现一次。
chinese 给全句自然中文翻译，不含英文答案。选不同主题、情景和句式，不能仅改人名或数字。不得重复来源例句、历史题或中文提示。"""

def normalized(text):
    return " ".join(re.findall(r"[^\W_]+",text.casefold()))


def key(text):
    return "exercise-seen:"+hashlib.sha256(normalized(text).encode()).hexdigest()


def history_item(cid, value):
    if value.startswith("{"):
        try:
            item=json.loads(value)
            if isinstance(item,dict) and all(isinstance(item.get(k),str) for k in ("sentence","span","chinese")):
                return dict(item,card=cid)
        except ValueError:
            pass
    return {"card":cid,"sentence":value}


def history(db):
    rows=db.execute("SELECT key,value FROM prefs WHERE key LIKE 'exercise-history:%' ORDER BY rowid DESC")
    return [history_item(k.split(":",2)[1],v) for k,v in rows]


def generate(ids,mode="unknown"):
    require(mode in ("unknown","recall","cloze"),"无效练习题型。")
    require(isinstance(ids,list) and 1<=len(ids)<=8 and all(isinstance(i,str) for i in ids) and len(set(ids))==len(ids),"每批请选择 1–8 个不同的表达。")
    with transaction() as db:
        cards={c["id"]:c for c in cardlist(db)}
        require(all(i in cards for i in ids),"找不到选中的表达。")
        words=[]
        for cid in ids:
            card=cards[cid]
            recent=db.execute("SELECT value FROM prefs WHERE key LIKE ? ORDER BY rowid DESC LIMIT 5",("exercise-history:"+cid+":%",))
            words.append({"card":cid,"target":card["target"],"meaning":card["meaning"],"avoid":[card["context"],card["cue"],card["answer"]]+[history_item(cid,r[0])["sentence"] for r in recent]})
    for attempt in range(2):
        result=generate_structured({"cards":words,"variation":secrets.token_hex(4)},PROMPT,QUESTIONS)["items"]
        if [item["card"] for item in result]!=ids:
            continue
        with transaction() as db:
            require(all(db.execute("SELECT 1 FROM cards WHERE id=?",(cid,)).fetchone() for cid in ids),
                    "生成期间表达库已更改，请重新选择。",409)
            keys=set()
            valid=True
            for word,item in zip(words,result):
                sentence,span,zh=(item[k].strip() for k in ("sentence","span","chinese"))
                item.update(sentence=sentence,span=span,chinese=zh)
                previous={normalized(t) for t in word["avoid"]}
                for text in (sentence,zh):
                    fingerprint=key(text)
                    if normalized(text) in previous or fingerprint in keys or db.execute("SELECT 1 FROM prefs WHERE key=?",(fingerprint,)).fetchone():
                        valid=False
                    keys.add(fingerprint)
                if not span or sentence.count(span)!=1 or not re.search(r"[\u3400-\u9fff]",zh):
                    valid=False
                word["avoid"].extend([sentence,zh])
            if valid:
                db.executemany("INSERT INTO prefs VALUES(?,?)",[(k,"1") for k in keys])
                for item in result:
                    db.execute("INSERT INTO prefs VALUES(?,?)",("exercise-history:"+item["card"]+":"+secrets.token_hex(8),dump(dict(item,mode=mode))))
                return result
    raise Problem("模型未生成一整组不重复且可挖空的新题。请重新生成。",422)


def supplement(sid,qid):
    with transaction() as db:
        s=session(db,sid)
        row=db.execute("SELECT body FROM reports WHERE sid=? AND qid=?",(sid,qid)).fetchone()
        require(row,"请先生成批改报告。")
        report=json.loads(row[0])
        if "vocabulary" in report:
            return {"ok":True}
        job={"essay":s["texts"][qid],"question":next(q for q in s["questions"] if q["id"]==qid)}
    report["vocabulary"]=[]
    complete_learning(report,job,generate_structured,["vocabulary"])
    with transaction() as db:
        current=json.loads(db.execute("SELECT body FROM reports WHERE sid=? AND qid=?",(sid,qid)).fetchone()[0])
        if "vocabulary" not in current:
            current["vocabulary"]=report["vocabulary"]
            db.execute("UPDATE reports SET body=? WHERE sid=? AND qid=?",(dump(current),sid,qid))
            archive(db,sid)
    return {"ok":True}
