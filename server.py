#!/usr/bin/env python3
import argparse
import contextlib
import datetime as dt
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import urllib.parse

import question_pack
import online_questions
import memory
import exercises
import storage
import backup
import grading
import historical
import planning
import study_questions
import provider
import studio
from studio import ( ROOT, NOW, LOCK, Problem, append_edits, archive, cardlist, catalog,
                    detail, dump, finish, init, learn, make_session, require, review, session, transaction)

STATIC=ROOT/"static"
COOKIE=os.environ.pop("IELTS_STUDIO_RELOAD_COOKIE", "") or secrets.token_urlsafe(32)
BROWSER_TYPES={".js":"text/javascript",".css":"text/css"}


def summaries(db):
    rows=[]
    for r in db.execute("SELECT id,started,duration,finished,parent,questions,texts,grade_state FROM sessions ORDER BY started DESC"):
        s=dict(r)
        s["questions"]=[{key:q[key] for key in ("id","task","title","book","test","group") if key in q} for q in json.loads(s["questions"])]
        s["words"]=sum(len(re.findall(r"[A-Za-z0-9]+(?:[’'-][A-Za-z0-9]+)*",x)) for x in json.loads(s.pop("texts")).values())
        s["graded"]=db.execute("SELECT COUNT(*) FROM reports WHERE sid=?",(s["id"],)).fetchone()[0]
        rows.append(s)
    return rows


class Handler(BaseHTTPRequestHandler):
    server_version="IELTSStudio/1"
    def log_message(self,fmt,*args):
        pass

    def reply(self,data,mime="application/json; charset=utf-8",status=200,headers=None):
        if not isinstance(data,bytes): data=dump(data).encode()
        self.send_response(status)
        self.send_header("Content-Type",mime)
        self.send_header("Content-Length",str(len(data)))
        self.send_header("Cache-Control","no-store")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("X-Frame-Options","SAMEORIGIN")
        self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://engnovate.com; frame-src https: 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'")
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self): self.dispatch("GET")
    def do_POST(self): self.dispatch("POST")

    def dispatch(self,method):
        try:
            u=urllib.parse.urlsplit(self.path)
            path=urllib.parse.unquote(u.path)
            hosts={f"{host}:{self.server.server_port}" for host in ("localhost","127.0.0.1")}
            host=self.headers.get("Host","")
            require(host in hosts,"仅接受本机地址。",403)
            media=re.fullmatch(r"/question-media/(source-cam-[0-9-]+-[a-f0-9]{12}\.(?:png|jpg|webp))",path)
            if media:
                require(method=="GET" and "studio="+COOKIE in self.headers.get("Cookie","").split("; "),"需要本机网站会话。",403)
                asset=studio.DATA/"配图"/media[1]
                require(asset.is_file(),"本地题图缺失。",404)
                return self.reply(asset.read_bytes(),mimetypes.guess_type(asset.name)[0])
            if not path.startswith("/api/"):
                require(method=="GET","无效请求。",405)
                if path=="/": file=STATIC/"index.html"
                elif path in ("/用户手册.md","/智能体接入手册.md"): file=ROOT/path[1:]
                else:
                    file=(STATIC/path.lstrip("/")).resolve()
                    require(STATIC in file.parents,"未找到资源。",404)
                require(file.is_file(),"未找到资源。",404)
                mime=BROWSER_TYPES.get(file.suffix) or mimetypes.guess_type(str(file))[0] or "application/octet-stream"
                if mime.startswith("text/"): mime+="; charset=utf-8"
                headers={"Set-Cookie":"studio="+COOKIE+"; Path=/; HttpOnly; SameSite=Strict"} if path=="/" else {}
                return self.reply(file.read_bytes(),mime,headers=headers)
            token=self.headers.get("Authorization","")
            agent=bool(token and secrets.compare_digest(token,"Bearer "+(studio.DATA/".agent-token").read_text(encoding="utf-8").strip()))
            browser=("studio="+COOKIE in self.headers.get("Cookie","").split("; ") and self.headers.get("X-Studio")=="1")
            require(agent or browser,"需要本机网站会话或智能体令牌。",401)
            origin=self.headers.get("Origin")
            require(not origin or origin==f"http://{host}","跨站请求已拒绝。",403)
            if path=="/api/backup" and method=="GET":
                return self.reply(backup.pack(),"application/zip")
            length=int(self.headers.get("Content-Length","0"))
            if path=="/api/question-library/pack":
                if method=="GET": return self.reply(question_pack.pack(),"application/zip")
                require(browser and 0<length<=128_000_000,"请在本机设置页选择题库包。")
                return self.reply(question_pack.unpack(self.rfile.read(length)))
            if path=="/api/restore" and method=="POST":
                require(browser and 0<length<=128_000_000,"请在本站选择有效备份。")
                restored=backup.restore(self.rfile.read(length))
                online_questions.resume_sync()
                return self.reply(restored)
            require(0<=length<=8_000_000,"请求过大。",413)
            body=json.loads(self.rfile.read(length)) if length else {}
            require(isinstance(body,dict),"需要 JSON 对象。")
            if path=="/api/question-library":
                if method=="GET": return self.reply(online_questions.library_status())
                return self.reply(online_questions.select_library(body.get("mode")))
            if method=="GET" and path=="/api/question-library/text":
                return self.reply(online_questions.library_markdown().encode(),"text/markdown; charset=utf-8")
            if method=="POST" and path=="/api/sessions":
                return self.reply(online_questions.create_session(body))
            preview=re.fullmatch(r"/api/questions/([a-z0-9-]+)/preview",path)
            if method=="GET" and preview:
                with transaction() as db:
                    q=catalog(db).get(preview[1])
                require(q,"找不到这道题。",404)
                return self.reply(online_questions.resolve(q))
            if path=="/api/storage":
                require(browser,"请在本机设置页查看或迁移数据。",403)
                return self.reply(storage.describe() if method=="GET" else storage.relocate(body.get("path")))
            if method=="POST" and path=="/api/plan/generate": return self.reply(study_questions.generate(body))
            if method=="POST" and path=="/api/plan/coach": return self.reply(planning.coach(body.get("task")))
            if method=="POST" and path=="/api/cards": return self.reply(exercises.collect(body))
            if method=="POST" and path=="/api/exercises":
                return self.reply(exercises.generate(body.get("cards"),body.get("mode","unknown")))
            if method=="POST" and path=="/api/language-check": return self.reply(grading.supplement_language(body.get("session"),body.get("question")))
            if method=="POST" and path=="/api/vocabulary":
                return self.reply(exercises.supplement(body.get("session"),body.get("question")))
            with transaction() as db:
                result=self.route(db,method,path,body,browser)
            self.reply(result)
        except Problem as e: self.reply({"error":str(e)},status=e.status)
        except (ValueError,TypeError,KeyError,UnicodeError) as e: self.reply({"error":"请求字段或编码有误。"},status=400)
        except (BrokenPipeError,ConnectionResetError): pass
        except Exception:
            import traceback
            traceback.print_exc()
            self.reply({"error":"本机服务处理失败，已保存的数据可重试读取。"},status=500)

    def route(self,db,method,path,b,browser):
        bank=catalog(db)
        if path=="/api/memory/options":
            return memory.options(db) if method=="GET" else memory.update_options(db,b)
        if path=="/api/memory/preview" and method=="POST":
            return memory.preview(db,b.get("card"),b.get("mode"))
        if path=="/api/memory/curve" and method=="POST":
            return memory.curve(db,b.get("card"),b.get("mode"))
        if path=="/api/memory/history" and method=="POST":
            return memory.history(db,b.get("card"))
        if method=="GET":
            if path=="/api/overview":
                cards=cardlist(db)
                active_modes=memory.options(db)["modes"]
                return {"sessions":summaries(db),"historical":historical.listing(),"card_count":len(cards),"due":sum(1 for c in cards for m in active_modes if c["memory"][m]["due"] is not None and c["memory"][m]["due"]<=NOW()),"now":NOW(),"settings":provider.public()}
            old=re.fullmatch(r"/api/history/([0-9]+)",path)
            if old: return historical.read(old[1])
            if path=="/api/plan": return planning.dashboard(db)
            if path=="/api/questions": return list(bank.values())
            if path=="/api/sessions": return summaries(db)
            if path=="/api/exercises/history": return exercises.history(db)
            if path=="/api/cards": return cardlist(db)
            if path=="/api/reviews": return [dict(r) for r in db.execute("SELECT * FROM reviews ORDER BY moment DESC")]
            if path=="/api/settings": return dict(provider.public(),codex_available=bool(grading.codex_binary()),codex_models=provider.codex_models())
            if path=="/api/schema": return grading.SCHEMA
            if path=="/api/queue":
                return [{"session":s["id"],"question":q["id"]} for s in summaries(db) if s["finished"] for q in s["questions"] if not db.execute("SELECT 1 FROM reports WHERE sid=? AND qid=?",(s["id"],q["id"])).fetchone() and session(db,s["id"])["texts"][q["id"]].strip()]
            m=re.fullmatch(r"/api/sessions/([a-f0-9]+)/input/([\w-]+)",path)
            if m: return grading.grade_input(db,*m.groups())
            m=re.fullmatch(r"/api/sessions/([a-f0-9]+)",path)
            if m:
                archive(db,m[1])
                return detail(db,m[1])
        else:
            if path=="/api/settings":
                require(browser,"模型配置只在本机设置页更新。",403)
                return provider.save(b)
            if path=="/api/reviews": return review(db,b)
            m=re.fullmatch(r"/api/sessions/([a-f0-9]+)/(edits|submit|grade|report|pause)",path)
            if m:
                sid,action=m.groups()
                if action=="pause": return studio.set_pause(db,sid,b)
                if action=="edits": return append_edits(db,sid,b)
                if action=="grade": return grading.queue_grade(db,sid)
                if action=="submit":
                    previous=session(db,sid)
                    s=finish(db,sid,b)
                    archive(db,sid)
                    if not previous["finished"] and provider.settings()["auto"] and any(t.strip() for t in s["texts"].values()):
                        grading.queue_grade(db,sid)
                    return {"id":sid,"finished":s["finished"]}
                grading.put_report(db,sid,b.get("question"),b.get("sha256"),b.get("report"))
                archive(db,sid)
                return {"ok":True}
        raise Problem("未找到此接口。",404)


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--port",type=int,default=8767)
    args=p.parse_args()
    server=ThreadingHTTPServer(("127.0.0.1",args.port),Handler)
    init()
    online_questions.resume_sync()
    print(f"页间写作室已启动 http://127.0.0.1:{server.server_port}/",flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
