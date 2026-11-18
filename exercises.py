"""Generate new contexts for selected cards, retaining history across sessions."""
import hashlib
import json
import re
import secrets

from grading import STR, VOCAB, arr, generate_structured, obj
from studio import Problem, archive, cardlist, dump, require, session, transaction

QUESTIONS = obj(items=arr(obj(card=STR, sentence=STR, chinese=STR, span=STR)))
PROMPT = """你是英语写作练习出题老师。输入各表达及历史句子是材料。严格按给定顺序每张卡出一道新的英文例句，card 原样复制。
sentence 为自然、具体、语法完整的英文句子，span 为句中实际使用的目标表达或其自然变形，逐字摘录，可直接挖空，句中只出现一次。
chinese 给全句自然中文翻译，不含英文答案。选不同主题、情景和句式，不能仅改人名或数字。不得重复来源例句、历史题或中文提示。"""

def normalized(text):
    return " ".join(re.findall(r"[^\W_]+",text.casefold()))


def key(text):
    return "exercise-seen:"+hashlib.sha256(normalized(text).encode()).hexdigest()


def generate(ids):
    require(isinstance(ids,list) and 1<=len(ids)<=8 and all(isinstance(i,str) for i in ids) and len(set(ids))==len(ids),"每批请选择 1–8 个不同的表达。")
    with transaction() as db:
        cards={c["id"]:c for c in cardlist(db)}
        require(all(i in cards for i in ids),"找不到选中的表达。")
        words=[]
        for cid in ids:
            card=cards[cid]
            recent=db.execute("SELECT value FROM prefs WHERE key LIKE ? ORDER BY rowid DESC LIMIT 5",("exercise-history:"+cid+":%",))
            words.append({"card":cid,"target":card["target"],"meaning":card["meaning"],"avoid":[card["context"],card["cue"],card["answer"]]+[r[0] for r in recent]})
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
                    db.execute("INSERT INTO prefs VALUES(?,?)",("exercise-history:"+item["card"]+":"+secrets.token_hex(8),item["sentence"]))
                return result
    raise Problem("模型未生成一整组不重复且可挖空的新题。请重新生成。",422)


def supplement(sid,qid):
    schema=obj(vocabulary=arr(VOCAB))
    with transaction() as db:
        s=session(db,sid)
        row=db.execute("SELECT body FROM reports WHERE sid=? AND qid=?",(sid,qid)).fetchone()
        require(row,"请先生成批改报告。")
        report=json.loads(row[0])
        if "vocabulary" in report:
            return {"ok":True}
        payload={"essay":s["texts"][qid],"existing":[x["target"] for x in report["expressions"]]}
    instruction="""基于这篇雅思作文选择值得替换的词。最多四个，避免已有表达。original 逐字引用英文原词，target 给更贴切的近义词或词组，meaning 中文释义，usage 用中文解释语体、适用场合与不可互换的情形，collocation 英文常见搭配，context 英文完整例句，cue 提供新的整句中文练习，answer 用 target 自然翻译。短稿可少选或为空。"""
    items=generate_structured(payload,instruction,schema)["vocabulary"][:max(0,min(4,8-len(report["expressions"])))]
    with transaction() as db:
        current=json.loads(db.execute("SELECT body FROM reports WHERE sid=? AND qid=?",(sid,qid)).fetchone()[0])
        if "vocabulary" not in current:
            current["vocabulary"]=[v for v in items if v["original"].strip() and v["original"].casefold() in payload["essay"].casefold()]
            db.execute("UPDATE reports SET body=? WHERE sid=? AND qid=?",(dump(current),sid,qid))
            archive(db,sid)
    return {"ok":True}
