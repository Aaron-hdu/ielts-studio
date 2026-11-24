"""Local persistence and replay protocol for the personal IELTS writing studio."""
import contextlib
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def default_data_dir():
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "页间写作室"
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "IELTS Studio"
    return Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / "ielts-studio"


LOCATION_FILE = default_data_dir().parent / ".ielts-studio-location.json"

def configured_data_dir():
    override = os.environ.get("IELTS_DATA")
    if override:
        return Path(override).expanduser().resolve()
    if LOCATION_FILE.exists():
        return Path(json.loads(LOCATION_FILE.read_text(encoding="utf-8"))["path"]).resolve()
    return default_data_dir().resolve()


DATA = configured_data_dir()
LOCK = threading.RLock()
NOW = lambda: int(time.time() * 1000)


class Problem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def require(ok, message, status=400):
    if not ok:
        raise Problem(message, status)


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def uid():
    return uuid.uuid4().hex[:16]


def catalog(db=None):
    result = {}
    for filename in ["practice.json", "cambridge.json"]:
        path = ROOT / "catalog" / filename
        if path.exists():
            for q in json.loads(path.read_text(encoding="utf-8")):
                result[q["id"]] = q
    with (ROOT/"catalog"/"study-tags.tsv").open(encoding="utf-8") as tags:
        next(tags)
        for line in tags:
            qid, kind, topics = line.rstrip().split("\t")
            if qid in result:
                result[qid].update(study_type=kind, topics=topics.split("/"))
    if db is not None:
        for row in db.execute("SELECT value FROM prefs WHERE key LIKE 'question:ai-%'"):
            q = json.loads(row[0])
            result[q["id"]] = q
    return result


def connect():
    db = sqlite3.connect(DATA / "studio.sqlite3", timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


@contextlib.contextmanager
def transaction():
    with LOCK, contextlib.closing(connect()) as db, db:
        yield db


def init():
    DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
    (DATA / "作文").mkdir(exist_ok=True)
    token_path = DATA / ".agent-token"
    if not token_path.exists():
        with os.fdopen(os.open(token_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), "w", encoding="utf-8") as f:
            f.write(secrets.token_urlsafe(32))
    with transaction() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS sessions(
            id TEXT PRIMARY KEY, started INTEGER NOT NULL, duration INTEGER NOT NULL,
            finished INTEGER, parent TEXT, questions TEXT NOT NULL, texts TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 0, grade_state TEXT NOT NULL DEFAULT 'idle',
            grade_error TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS edits(
            sid TEXT NOT NULL REFERENCES sessions(id), seq INTEGER NOT NULL, event TEXT NOT NULL,
            PRIMARY KEY(sid,seq));
        CREATE TABLE IF NOT EXISTS reports(
            id TEXT PRIMARY KEY, sid TEXT NOT NULL REFERENCES sessions(id), qid TEXT NOT NULL,
            body TEXT NOT NULL, created INTEGER NOT NULL, UNIQUE(sid,qid));
        CREATE TABLE IF NOT EXISTS cards(
            id TEXT PRIMARY KEY, target TEXT NOT NULL UNIQUE, body TEXT NOT NULL,
            due INTEGER NOT NULL, streak INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS origins(
            card TEXT NOT NULL REFERENCES cards(id), sid TEXT NOT NULL, qid TEXT NOT NULL,
            PRIMARY KEY(card,sid,qid));
        CREATE TABLE IF NOT EXISTS reviews(
            id TEXT PRIMARY KEY, card TEXT NOT NULL REFERENCES cards(id), moment INTEGER NOT NULL,
            answer TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS prefs(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)
        import memory
        memory.migrate(db)
        db.execute("UPDATE sessions SET grade_state='error',grade_error='服务重启中断了批改，可以重试。' WHERE grade_state='running'")
        for row in db.execute("SELECT id FROM sessions WHERE finished IS NOT NULL"):
            archive(db, row[0])


def session(db, sid):
    r = db.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
    require(r, "找不到这次写作。", 404)
    s = dict(r)
    s["questions"] = json.loads(s["questions"])
    for q in s["questions"]:
        # Older sessions refer to resources that were once distributed with the app.
        if q.get("figure","").startswith("/figures/cambridge/"):
            name=Path(q["figure"]).name
            q["figure"]="/question-media/"+name if (DATA/"配图"/name).is_file() else ""
        if q.get("mode")=="official" and q.get("embed","").startswith("/figures/"):
            q["embed"]=catalog().get(q["id"],{}).get("source",q.get("source",""))
    s["texts"] = json.loads(s["texts"])
    timer=db.execute("SELECT value FROM prefs WHERE key=?",("timer:"+sid,)).fetchone()
    s["timer"]=json.loads(timer[0]) if timer else {"paused_at":None,"paused_ms":0}
    now=s["timer"]["paused_at"] or s["finished"] or NOW()
    s["elapsed_ms"]=max(0,now-s["started"]-s["timer"]["paused_ms"])
    return s


def set_pause(db,sid,body):
    s=session(db,sid)
    require(len(s["questions"])==1 and not s["finished"],"只有进行中的专项练习可以暂停。",409)
    paused=body.get("paused")
    require(type(paused) is bool and body.get("revision")==s["revision"],"请先同步当前稿件。",409)
    timer=s["timer"]
    now=NOW()
    if paused and timer["paused_at"] is None:
        timer["paused_at"]=now
    elif not paused and timer["paused_at"] is not None:
        timer["paused_ms"]+=max(0,now-timer["paused_at"])
        timer["paused_at"]=None
    db.execute("INSERT OR REPLACE INTO prefs VALUES(?,?)",("timer:"+sid,dump(timer)))
    return timer


def changes(db, sid):
    return [json.loads(r[0]) for r in db.execute("SELECT event FROM edits WHERE sid=? ORDER BY seq", (sid,))]


def make_session(db, body, bank):
    ids = body.get("questions", [])
    require(isinstance(ids, list) and 1 <= len(ids) <= 2 and all(isinstance(i,str) and i in bank for i in ids), "请选择有效题目。")
    qs = [bank[i] for i in ids]
    if len(qs) == 2:
        require([q["task"] for q in qs] == [1,2] and qs[0]["book"] == qs[1]["book"] and qs[0]["test"] == qs[1]["test"] and qs[0].get("group") == qs[1].get("group"), "套题需要同组的 Task 1 和 Task 2。")
    parent = body.get("parent")
    initial = {}
    if parent:
        previous = session(db, parent)
        require(previous["finished"] and all(i in previous["texts"] for i in ids), "重写需要对应的交卷原稿。")
        initial = previous["texts"]
    sid = uid()
    db.execute("INSERT INTO sessions(id,started,duration,parent,questions,texts) VALUES(?,?,?,?,?,?)",
               (sid, NOW(), sum(20*q["task"] for q in qs)*60000, parent, dump(qs), dump({i:"" for i in ids})))
    if parent:
        append_edits(db, sid, {"base":0, "events":[{"q":i,"t":0,"at":0,"cut":0,"add":initial[i],"kind":"baseline"} for i in ids]})
    return session(db, sid)


def append_edits(db, sid, body):
    s = session(db, sid)
    base = body.get("base")
    events = body.get("events", [])
    require(type(base) is int and 0 <= base <= s["revision"] and isinstance(events,list) and len(events) <= 5000, "无效的编辑批次。")
    overlap = min(len(events), s["revision"]-base)
    saved = db.execute("SELECT event FROM edits WHERE sid=? AND seq>? ORDER BY seq LIMIT ?", (sid,base,overlap)).fetchall()
    require(all(json.loads(r[0]) == e for r,e in zip(saved,events[:overlap])), "另一窗口已更改草稿。请保存本页文字副本后重新打开。",409)
    events = events[overlap:]
    if not events:
        return {"revision":s["revision"]}
    require(not s["finished"] and base+overlap == s["revision"], "草稿版本已变化，请重新打开。",409)
    require(s["timer"]["paused_at"] is None,"此练习已暂停，请刷新并继续计时后再写。",409)
    last = db.execute("SELECT event FROM edits WHERE sid=? ORDER BY seq DESC LIMIT 1",(sid,)).fetchone()
    last_t = json.loads(last[0])["t"] if last else 0
    for idx,e in enumerate(events,1):
        require(isinstance(e,dict) and e.get("q") in s["texts"] and type(e.get("t")) is int and last_t <= e["t"] <= (s["duration"] if len(s["questions"]) == 2 else s["elapsed_ms"]+5000), "编辑时间或题目无效。")
        require(e.get("kind") in ("input","paste","delete","baseline","switch","away","back"), "未知编辑类型。")
        a, cut, add = e.get("at"),e.get("cut"),e.get("add")
        old = s["texts"][e["q"]]
        require(type(a) is int and type(cut) is int and isinstance(add,str) and 0<=a<=len(old) and 0<=cut<=len(old)-a and len(add)<=120000, "编辑位置无效。")
        s["texts"][e["q"]] = old[:a]+add+old[a+cut:]
        require(len(s["texts"][e["q"]])<=120000, "草稿过长。")
        db.execute("INSERT INTO edits VALUES(?,?,?)",(sid,s["revision"]+idx,dump(e)))
        last_t = e["t"]
    rev = s["revision"]+len(events)
    db.execute("UPDATE sessions SET texts=?,revision=? WHERE id=?",(dump(s["texts"]),rev,sid))
    return {"revision":rev}


def filename(s,q):
    day = dt.datetime.fromtimestamp(s["started"]/1000).strftime("%Y-%m-%d")
    return DATA/"作文"/f"{day}_{s['id']}_Task{q['task']}.md"


def archive(db,sid):
    s = session(db,sid)
    if not s["finished"]:
        return
    for q in s["questions"]:
        path = filename(s,q)
        if not path.exists():
            title = q["title"]
            original = s["texts"][q["id"]]
            lines = [f"# {title}", "", f"- 写作编号 {sid}", f"- 题目 {q['id']} · Academic Task {q['task']}",
                     f"- 交卷时间 {dt.datetime.fromtimestamp(s['finished']/1000).isoformat(timespec='seconds')}",
                     f"- 本次用时 {s['elapsed_ms']//1000} 秒"]
            if q.get("source"): lines.append(f"- 题源 {q['source']}")
            if s["parent"]: lines.append(f"- 上一稿 {s['parent']}")
            lines += ["","## 题目","",q.get("prompt") or title]
            if q.get("chart_data"): lines += ["", q["chart_data"]]
            if q.get("figure","").startswith("/question-media/"):
                lines += ["",f"![题目配图](../配图/{Path(q['figure']).name})"]
            elif q.get("figure"):
                from shutil import copyfile
                asset = (ROOT/"static"/q["figure"].lstrip("/")).resolve()
                if asset.is_file() and (ROOT/"static") in asset.parents:
                    target=DATA/"配图"/asset.name
                    target.parent.mkdir(exist_ok=True)
                    if not target.exists(): copyfile(asset,target)
                    lines += ["",f"![题目配图](../配图/{asset.name})"]
            lines += ["","## 交卷原文","",original,"","## 我的笔记","",""]
            tmp=path.with_suffix(".tmp")
            tmp.write_text("\n".join(lines), encoding="utf-8")
            tmp.replace(path)
        report=db.execute("SELECT id,body FROM reports WHERE sid=? AND qid=?",(sid,q["id"])).fetchone()
        if report:
            marker = f"<!-- report:{report['id']} -->"
            old=path.read_text(encoding="utf-8")
            if marker not in old:
                from grading import markdown_report
                tmp=path.with_suffix(".tmp")
                tmp.write_text(old.rstrip()+"\n\n"+markdown_report(json.loads(report["body"]))+"\n"+marker+"\n", encoding="utf-8")
                tmp.replace(path)
            else:
                from grading import vocabulary_markdown
                items=json.loads(report["body"]).get("vocabulary",[])
                if items and "### 词汇提升" not in old:
                    tmp=path.with_suffix(".tmp")
                    tmp.write_text(old.rstrip()+"\n\n"+vocabulary_markdown(items)+"\n",encoding="utf-8")
                    tmp.replace(path)
                body=json.loads(report["body"])
                if "language_errors" in body and "### 拼写与语法" not in old:
                    from grading import language_markdown
                    tmp=path.with_suffix(".tmp")
                    tmp.write_text(path.read_text(encoding="utf-8").rstrip()+"\n\n"+language_markdown(body["language_errors"])+"\n",encoding="utf-8")
                    tmp.replace(path)


def finish(db,sid,body):
    s=session(db,sid)
    if not s["finished"]:
        require(body.get("revision")==s["revision"],"有尚未保存的编辑。",409)
        moment=min(NOW(),s["started"]+s["duration"]) if len(s["questions"]) == 2 else NOW()
        if s["timer"]["paused_at"] is not None:
            timer=s["timer"]
            timer["paused_ms"]+=max(0,moment-timer["paused_at"])
            timer["paused_at"]=None
            db.execute("UPDATE prefs SET value=? WHERE key=?",(dump(timer),"timer:"+sid))
        db.execute("UPDATE sessions SET finished=? WHERE id=?",(moment,sid))
    return session(db,sid)


def detail(db,sid):
    s=session(db,sid)
    s["events"]=changes(db,sid)
    s["reports"]={r["qid"]:json.loads(r["body"]) for r in db.execute("SELECT qid,body FROM reports WHERE sid=?",(sid,))}
    s["archives"]={q["id"]:filename(s,q).read_text(encoding="utf-8") for q in s["questions"] if s["finished"] and filename(s,q).exists()}
    return s


def fingerprint(s,qid):
    return hashlib.sha256(s["texts"][qid].encode()).hexdigest()


def cardlist(db):
    import memory
    states={k:memory.describe(json.loads(v)) for k,v in db.execute("SELECT key,value FROM prefs WHERE key LIKE 'memory:%'")}
    result=[]
    for r in db.execute("SELECT * FROM cards ORDER BY due,id"):
        item=dict(r)
        item.update(json.loads(item.pop("body")))
        item["origins"]=[dict(x) for x in db.execute("SELECT sid,qid FROM origins WHERE card=?",(r["id"],))]
        item["memory"]={m:states.get(memory.state_key(item["id"],m),memory.describe(None)) for m in memory.MODES}
        item["due"]=item["memory"]["recall"]["due"] or 0
        result.append(item)
    return result


def learn(db,sid,qid,idx,section="expressions"):
    row=db.execute("SELECT body FROM reports WHERE sid=? AND qid=?",(sid,qid)).fetchone()
    require(row and type(idx) is int,"找不到表达。")
    require(section in ("expressions","vocabulary"),"无效的表达来源。")
    expressions=json.loads(row[0]).get(section,[])
    require(0<=idx<len(expressions),"找不到表达。")
    ex=expressions[idx]
    normalized=" ".join(ex["target"].lower().split())
    db.execute("INSERT OR IGNORE INTO cards(id,target,body,due) VALUES(?,?,?,?)",(uid(),normalized,dump(ex),NOW()))
    card=db.execute("SELECT id FROM cards WHERE target=?",(normalized,)).fetchone()[0]
    if section=="vocabulary":
        db.execute("UPDATE cards SET body=? WHERE id=?",(dump(ex),card))
    db.execute("INSERT OR IGNORE INTO origins VALUES(?,?,?)",(card,sid,qid))
    return {"id":card}


def review(db,body):
    import memory
    return memory.submit(db,body)
