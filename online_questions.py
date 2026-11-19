"""Read a selected writing task from its indexed source, outside SQLite transactions."""
import base64
import binascii
import threading
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request

import studio
from provider import NoRedirect


class TaskPages(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.depth = 0
        self.text = []
        self.images = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class","").split()
        if tag=="img" and "ielts-writing-image" in classes:
            self.images.append(attrs.get("src",""))
        if tag=="div" and "ielts-writing-question" in classes and not self.depth:
            self.depth=1
            self.text=[]
        elif self.depth:
            if tag=="div": self.depth+=1
            if tag in ("p","br","li"): self.text.append("\n")

    def handle_endtag(self, tag):
        if self.depth and tag=="div":
            self.depth-=1
            if not self.depth:
                self.parts.append("\n\n".join(" ".join(line.split()) for line in "".join(self.text).splitlines() if line.strip()))
        elif self.depth and tag=="p":
            self.text.append("\n")

    def handle_data(self, data):
        if self.depth: self.text.append(data)


def fetch(url, limit):
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!="https" or parsed.netloc!="engnovate.com":
        raise studio.Problem("题源地址无效。")
    request=urllib.request.Request(url,headers={"User-Agent":"IELTSStudio/1 (personal practice)"})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=15) as response:
            data=response.read(limit+1)
    except urllib.error.HTTPError as error:
        if error.code in (401,403):
            message=f"题源拒绝了写作室的请求（HTTP {error.code}）。可打开题源页并贴入英文原题。"
        elif error.code==429:
            message="题源请求过多（HTTP 429）。请稍后重试，或打开题源页作答。"
        else:
            message=f"题源返回 HTTP {error.code}。可打开来源页核对题目，或稍后重试。"
        raise studio.Problem(message,502) from error
    except OSError as error:
        raise studio.Problem("写作室未能连接题源。请检查网络，或从题源页贴入原题。",502) from error
    studio.require(len(data)<=limit,"题源文件过大。",502)
    return data


def task_page(source):
    html=fetch(source,5_000_000).decode("utf-8",errors="replace")
    order=re.findall(r"""id\s*=\s*["']ielts-writing-question-section-([12])["']""",html)
    page=TaskPages()
    page.feed(html)
    studio.require(order==["1","2"] and len(page.parts)==2,"题源页面格式有变，暂时无法识别两道任务。请打开题源核对。",502)
    return page


def online_text(q, pages=None):
    if pages is not None and q["source"] in pages:
        page=pages[q["source"]]
    else:
        page=task_page(q["source"])
        if pages is not None:
            pages.clear()
            pages[q["source"]]=page
    task=q["task"]
    body=page.parts[task-1]
    studio.require(len(body.split())>=12 and (not re.match(r"WRITING TASK",body,re.I) or
                   re.match(rf"WRITING TASK\s+{task}\b",body,re.I)),"无法核对英文题文，请打开题源查看。",502)
    result=dict(q,prompt=body,prompt_source="transcription")
    if task==1 and page.images:
        source=urllib.parse.urljoin(q["source"],page.images[0])
        if urllib.parse.urlsplit(source).netloc=="engnovate.com" and source.startswith("https://engnovate.com/wp-content/uploads/"):
            result["figure_source"]=source
    return result


def load_chart(q):
    return chart_file(q,fetch(q["figure_source"],8_000_000))


def chart_file(q,image):
    if image.startswith(b"\x89PNG\r\n\x1a\n"): ext="png"
    elif image.startswith(b"\xff\xd8\xff"): ext="jpg"
    elif image[:4]==b"RIFF" and image[8:12]==b"WEBP": ext="webp"
    else: raise studio.Problem("题源未返回有效的图表，请稍后重试。",502)
    name=f"source-{q['id']}-{hashlib.sha256(image).hexdigest()[:12]}.{ext}"
    return name,image


def saved_question(db,q):
    key="source-text:"+q["id"]
    row=db.execute("SELECT value FROM prefs WHERE key=?",(key,)).fetchone()
    if row:
        candidates=[json.loads(row[0])]
    else:
        # Earlier versions kept some downloads only inside a writing session.
        candidates=(item for r in db.execute("SELECT questions FROM sessions WHERE questions LIKE ? ORDER BY started DESC",
                                              ('%"'+q["id"]+'"%',)) for item in json.loads(r[0]) if item.get("id")==q["id"])
    for record in candidates:
        prompt=record.get("prompt")
        if record.get("source")!=q["source"] or record.get("prompt_source") not in ("transcription","user_transcription") or not isinstance(prompt,str) or not prompt.strip():
            continue
        digest=hashlib.sha256(prompt.encode()).hexdigest()
        if record.get("prompt_sha256",digest)!=digest:
            continue
        result=dict(q,prompt=prompt,prompt_source=record["prompt_source"])
        figure=record.get("figure") or ""
        name=Path(figure).name
        if re.fullmatch(r"source-"+re.escape(q["id"])+r"-[a-f0-9]{12}\.(?:png|jpg|webp)",name) and (studio.DATA/"配图"/name).is_file():
            result["figure"]="/question-media/"+name
        return result
    return None


def store_question(db,q):
    record={key:q[key] for key in ("prompt","source","prompt_source","figure") if q.get(key)}
    record["prompt_sha256"]=hashlib.sha256(q["prompt"].encode()).hexdigest()
    db.execute("INSERT OR REPLACE INTO prefs(key,value) VALUES(?,?)",("source-text:"+q["id"],studio.dump(record)))


def library_mode(db):
    row=db.execute("SELECT value FROM prefs WHERE key='question-library-mode'").fetchone()
    if row:
        return row[0]
    bank=cambridge()
    mode="local" if all(complete(saved_question(db,q)) for q in bank) else "online"
    db.execute("INSERT INTO prefs VALUES('question-library-mode',?)",(mode,))
    return mode


def cambridge():
    return [q for q in studio.catalog().values() if q["mode"]=="link"]


def complete(q):
    return bool(q and (q["task"]==2 or q.get("figure")))


def job_state(db):
    row=db.execute("SELECT value FROM prefs WHERE key='question-library-sync'").fetchone()
    return json.loads(row[0]) if row else {"phase":"idle","detail":""}


def set_job(db,phase,detail="",token=None):
    state={"phase":phase,"detail":detail,"token":token}
    db.execute("INSERT OR REPLACE INTO prefs VALUES('question-library-sync',?)",(studio.dump(state),))


def library_status():
    with studio.transaction() as db:
        bank=cambridge()
        saved=[saved_question(db,q) for q in bank]
        return {"mode":library_mode(db),"texts":sum(q is not None for q in saved),
                "charts":sum(bool(q and q.get("figure")) for q in saved),
                "total":len(bank),"total_charts":sum(q["task"]==1 for q in bank),"job":job_state(db)}


def save_image(name,image):
    path=studio.DATA/"配图"/name
    path.parent.mkdir(exist_ok=True)
    if not path.exists():
        with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as tmp:
            tmp.write(image)
        Path(tmp.name).replace(path)
    return "/question-media/"+name


def retrieve(q,cached,*,missing_only=False,require_chart=False,pages=None,token=None):
    if missing_only and complete(cached):
        return cached
    try:
        item=cached.copy() if cached and missing_only else online_text(q,pages)
    except studio.Problem as error:
        if missing_only or not cached:
            raise
        item=dict(cached,source_notice=str(error)+" 当前使用本机已保存的题文。")
        if complete(item): return item
    chart=None
    warning=None
    if item["task"]==1:
        try:
            chart=load_chart(item)
        except studio.Problem as error:
            warning=error
    with studio.transaction() as db:
        if token and job_state(db).get("token")!=token:
            return item
        if chart:
            item["figure"]=save_image(*chart)
        elif warning:
            previous=saved_question(db,q)
            if complete(previous) and previous["prompt"]==item["prompt"]:
                return dict(previous,source_notice="题图未能从网络读取，当前使用本机已保存的配图。")
        store_question(db,item)
    if warning:
        if require_chart: raise warning
        item["chart_warning"]=str(warning)
    return item


def resolve(q,*,require_chart=False,pages=None):
    if q["mode"]=="official":
        return dict(q,embed=q["source"],prompt_source="official_pdf")
    if q["mode"]!="link":
        return q
    with studio.transaction() as db:
        mode=library_mode(db)
        cached=saved_question(db,q)
    if mode=="local":
        if complete(cached): return cached
        if cached and not require_chart:
            result=dict(cached,chart_warning="本地题图缺失，可在设置里补全。")
            result.pop("figure_source",None)
            return result
        raise studio.Problem("本地题库缺少这道题或配图，请在工作室设置里补全题库，或切换为联网题源。",409)
    return retrieve(q,cached,require_chart=require_chart,pages=pages)


def sync_missing(token):
    pages={}
    errors=[]
    try:
        for q in cambridge():
            with studio.transaction() as db:
                if job_state(db).get("token")!=token: return
                cached=saved_question(db,q)
            try:
                retrieve(q,cached,missing_only=True,require_chart=True,pages=pages,token=token)
            except studio.Problem as error:
                errors.append(f"{q['id']} · {error}")
                cause=error.__cause__
                if isinstance(cause,OSError) and getattr(cause,"code",None) not in (404,410):
                    break
    except Exception as error:
        errors.append("下载中断："+str(error))
    with studio.transaction() as db:
        if job_state(db).get("token")==token:
            set_job(db,"paused" if errors else "complete",errors[0] if errors else "")


def select_library(mode):
    studio.require(mode in ("local","online"),"未知题源模式。")
    with studio.transaction() as db:
        db.execute("INSERT OR REPLACE INTO prefs VALUES('question-library-mode',?)",(mode,))
        if mode=="online":
            set_job(db,"idle")
        elif job_state(db)["phase"]!="running":
            if all(complete(saved_question(db,q)) for q in cambridge()):
                set_job(db,"complete")
            else:
                token=studio.uid()
                set_job(db,"running",token=token)
                threading.Thread(target=sync_missing,args=(token,),daemon=True).start()
    return library_status()


def resume_sync():
    with studio.transaction() as db:
        if job_state(db)["phase"]!="running": return
        # A persisted running job belongs to the previous process.
        set_job(db,"paused","正在恢复上次下载。")
        mode=library_mode(db)
    if mode=="local": select_library(mode)


def library_markdown():
    with studio.transaction() as db:
        lines=["# 本机剑雅写作题文",""]
        for q in cambridge():
            item=saved_question(db,q)
            if item:
                lines.extend([f"## C{q['book']} Test {q['test']} · Task {q['task']}","","题源 "+q["source"],"",item["prompt"],""])
    return "\n".join(lines)


def create_session(body):
    ids=body.get("questions")
    with studio.transaction() as db:
        bank=studio.catalog(db)
        studio.require(isinstance(ids,list) and 1<=len(ids)<=2 and all(isinstance(i,str) and i in bank for i in ids),"请选择有效题目。")
        if body.get("parent"):
            parent=studio.session(db,body["parent"])
            bank.update({q["id"]:q for q in parent["questions"]})
            return studio.make_session(db,body,bank)
    manual=body.get("source_prompts",{})
    studio.require(isinstance(manual,dict) and all(i in ids and bank[i]["mode"] in ("link","official") and
                   isinstance(t,str) and 12<=len(t.strip())<=15000 and re.search(r"[A-Za-z]",t)
                   for i,t in manual.items()),"请贴入所选题目的英文原文。")
    attachments=body.get("source_images",{})
    studio.require(isinstance(attachments,dict) and all(i in manual and bank[i]["task"]==1 and bank[i]["mode"]=="link"
                    and isinstance(raw,str) and len(raw)<=6_000_000 for i,raw in attachments.items()),"所选题图无效或过大。")
    images={}
    for qid,raw in attachments.items():
        try:
            image=base64.b64decode(raw,validate=True)
        except (ValueError,binascii.Error) as error:
            raise studio.Problem("无法读取题图。") from error
        try:
            images[qid]=chart_file(bank[qid],image)
        except studio.Problem as error:
            raise studio.Problem("请选择 PNG、JPEG 或 WebP 图像文件。") from error
    pages={}
    for qid in ids:
        if qid in manual:
            q=bank[qid]
            bank[qid]=dict(q,prompt=manual[qid].strip(),prompt_source="user_transcription")
            if q["mode"]=="official": bank[qid]["embed"]=q["source"]
            continue
        bank[qid]=resolve(bank[qid],require_chart=True,pages=pages)
    with studio.transaction() as db:
        for qid in manual:
            q=bank[qid]
            if q["mode"]=="link":
                old=saved_question(db,q)
                if qid in images: q["figure"]=save_image(*images[qid])
                if not complete(old) and (not old or old["prompt"]==q["prompt"] or complete(q)):
                    store_question(db,q)
        return studio.make_session(db,body,bank)
