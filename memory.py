"""Mode-specific FSRS schedules, shared by daily and self-directed practice."""
import json
from datetime import datetime, timedelta, timezone

from vendor.fsrs.card import Card
from vendor.fsrs.rating import Rating
from vendor.fsrs.scheduler import Scheduler
from vendor.fsrs.state import State
from studio import NOW, dump, require

MODES = ("recall", "cloze", "flash")
RATINGS = {"again": Rating.Again, "hard": Rating.Hard, "good": Rating.Good, "easy": Rating.Easy}
DEFAULT = {"retention": 90, "new_limit": 5, "modes": ["recall"]}


def pref(db, key, default=None):
    row = db.execute("SELECT value FROM prefs WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else default


def put(db, key, value):
    db.execute("INSERT OR REPLACE INTO prefs VALUES(?,?)", (key, dump(value)))


def options(db):
    return pref(db, "fsrs-options", DEFAULT)


def engine(settings):
    return Scheduler(desired_retention=settings["retention"]/100, enable_fuzzing=False)


def stamp(ms):
    return datetime.fromtimestamp(ms/1000, timezone.utc)


def millis(date):
    return round(date.timestamp()*1000)


def state_key(cid, mode):
    return f"memory:{cid}:{mode}"


def describe(state):
    if not state:
        return {"level":"未练习","count":0,"due":None}
    card = Card.from_dict(state["card"])
    if state["recent"][-1] == "again" or card.state == State.Relearning:
        level = "生疏"
    elif state["days"] < 2 or card.state == State.Learning:
        level = "学习中"
    elif state["recent"].count("again") >= 2:
        level = "生疏"
    elif card.stability >= 21 and state["days"] >= 3:
        level = "熟悉"
    else:
        level = "较熟悉"
    return {"level":level, "count":state["count"], "due":millis(card.due),
            "first":state["first"], "last":millis(card.last_review), "recent":state["recent"],
            "days":state["days"], "stability":round(card.stability,1)}


def apply(db, cid, mode, grade, now, scheduler):
    key = state_key(cid,mode)
    state = pref(db,key)
    card = Card.from_dict(state["card"]) if state else Card(card_id=0)
    previous = card.last_review
    date = stamp(now)
    card,_ = scheduler.review_card(card,RATINGS[grade],date)
    if not state:
        state = {"first":now,"days":0,"recent":[],"count":0}
    if previous is None or date.date() > previous.date():
        state["days"] += 1
    state.update(card=card.to_dict(), count=state["count"]+1, recent=(state["recent"]+[grade])[-3:])
    put(db,key,state)
    return describe(state)


def migrate(db):
    if pref(db,"fsrs-migrated"):
        return
    scheduler = engine(options(db))
    rows = db.execute("""SELECT r.*,p.value mode FROM reviews r
        LEFT JOIN prefs p ON p.key='review-mode:'||r.id ORDER BY moment,r.rowid""")
    for row in rows:
        mode=row["mode"]
        grade={"again":"again","recall":"good"}.get(row["result"])
        if mode in MODES and grade:
            apply(db,row["card"],mode,grade,row["moment"],scheduler)
    put(db,"fsrs-migrated",True)


def update_options(db,b):
    retention,limit,modes=b.get("retention"),b.get("new_limit"),b.get("modes")
    require(type(retention) is int and 70<=retention<=97 and type(limit) is int and 0<=limit<=100,
            "保留率应为 70–97%，每日新学数量应为 0–100。")
    require(isinstance(modes,list) and modes and all(m in MODES for m in modes),"请选择复习模式。")
    settings={"retention":retention,"new_limit":limit,"modes":list(dict.fromkeys(modes))}
    if options(db)["retention"]!=retention:
        scheduler=engine(settings)
        for key,value in db.execute("SELECT key,value FROM prefs WHERE key LIKE 'memory:%'").fetchall():
            state=json.loads(value)
            card=Card.from_dict(state["card"])
            if card.state==State.Review:
                card.due=card.last_review+timedelta(days=scheduler._next_interval(stability=card.stability))
                state["card"]=card.to_dict()
                put(db,key,state)
    put(db,"fsrs-options",settings)
    return settings


def preview(db,cid,mode):
    require(mode in MODES and db.execute("SELECT 1 FROM cards WHERE id=?",(cid,)).fetchone(),"找不到练习卡。")
    state=pref(db,state_key(cid,mode))
    card=Card.from_dict(state["card"]) if state else Card(card_id=0)
    date=stamp(NOW())
    scheduler=engine(options(db))
    return {key:round((scheduler.review_card(card,rating,date)[0].due-date).total_seconds())
            for key,rating in RATINGS.items()}


def curve(db,cid,mode):
    require(mode in MODES,"无效的复习模式。")
    state=pref(db,state_key(cid,mode))
    if not state:
        return None
    card=Card.from_dict(state["card"])
    scheduler=engine(options(db))
    current=stamp(NOW())
    horizon=max(7,min(36500,2*max(1,(card.due-card.last_review).days)))
    offsets=sorted({round(i*horizon/40) for i in range(41)})
    points=[[d,round(100*scheduler.get_card_retrievability(card,card.last_review+timedelta(days=d)),1)] for d in offsets]
    return {"points":points,"today":round(100*scheduler.get_card_retrievability(card,current)),
            "retention":options(db)["retention"]}


def history(db,cid):
    rows=db.execute("""SELECT r.*,p.value mode,m.value detail FROM reviews r
        LEFT JOIN prefs p ON p.key='review-mode:'||r.id LEFT JOIN prefs m ON m.key='attempt:'||r.id
        WHERE card=? ORDER BY moment DESC,r.rowid DESC""",(cid,))
    return [dict(dict(row),detail=json.loads(row["detail"]) if row["detail"] else None) for row in rows]


def submit(db,b):
    import re
    cid,mode,grade=b.get("card"),b.get("mode","recall"),b.get("result")
    key,answer=b.get("id"),b.get("answer")
    require(mode in MODES and isinstance(key,str) and re.fullmatch(r"[a-zA-Z0-9-]{8,64}",key),"无效的练习编号或模式。")
    require(isinstance(answer,str) and len(answer)<=10000 and grade in (*RATINGS,"recall","alternative"),"无效的自评或答案。")
    require(db.execute("SELECT 1 FROM cards WHERE id=?",(cid,)).fetchone(),"找不到练习卡。",404)
    existing=db.execute("SELECT card,result,answer FROM reviews WHERE id=?",(key,)).fetchone()
    if existing:
        stored_mode=db.execute("SELECT value FROM prefs WHERE key=?",("review-mode:"+key,)).fetchone()
        require(tuple(existing)==(cid,grade,answer) and stored_mode and stored_mode[0]==mode,"练习编号冲突。",409)
    else:
        detail={k:b.get(k,"") for k in ("prompt","reference","source","hint")}
        require(all(isinstance(v,str) and len(v)<=12000 for v in detail.values()),"题目内容过长。")
        now=NOW()
        mapped={"recall":"good","alternative":"hard" if mode=="flash" else None}.get(grade,grade)
        if mapped:
            state=apply(db,cid,mode,mapped,now,engine(options(db)))
            detail["due"]=state["due"]
        db.execute("INSERT INTO reviews VALUES(?,?,?,?,?)",(key,cid,now,answer,grade))
        db.execute("INSERT INTO prefs VALUES(?,?)",("review-mode:"+key,mode))
        put(db,"attempt:"+key,detail)
    current=describe(pref(db,state_key(cid,mode)))
    return {"ok":True,"due":current["due"] or NOW(),"memory":current}
