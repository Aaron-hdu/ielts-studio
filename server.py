#!/usr/bin/env python3
import argparse
import contextlib
import datetime as dt
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import re
import secrets
import sqlite3
import sys
import urllib.parse

import backup
import grading
import provider
from studio import (DATA, ROOT, NOW, LOCK, Problem, append_edits, archive, cardlist, catalog,
                    detail, dump, finish, init, learn, make_session, require, review, session, transaction)

STATIC=ROOT/"static"
COOKIE=secrets.token_urlsafe(32)
BROWSER_TYPES={".js":"text/javascript",".css":"text/css"}


def summaries(db):
    rows=[]
    for r in db.execute("SELECT id,started,duration,finished,parent,questions,texts,grade_state FROM sessions ORDER BY started DESC"):
        s=dict(r)
        s["questions"]=[{"id":q["id"],"task":q["task"],"title":q["title"]} for q in json.loads(s["questions"])]
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
            agent=bool(token and secrets.compare_digest(token,"Bearer "+(DATA/".agent-token").read_text(encoding="utf-8").strip()))
            browser=("studio="+COOKIE in self.headers.get("Cookie","").split("; ") and self.headers.get("X-Studio")=="1")
            require(agent or browser,"需要本机网站会话或智能体令牌。",401)
            origin=self.headers.get("Origin")
            require(not origin or origin==f"http://{host}","跨站请求已拒绝。",403)
            if path=="/api/backup" and method=="GET":
                return self.reply(backup.pack(),"application/zip")
            length=int(self.headers.get("Content-Length","0"))
            if path=="/api/restore" and method=="POST":
                require(browser and 0<length<=128_000_000,"请在本站选择有效备份。")
                return self.reply(backup.restore(self.rfile.read(length)))
            require(0<=length<=8_000_000,"请求过大。",413)
            body=json.loads(self.rfile.read(length)) if length else {}
            require(isinstance(body,dict),"需要 JSON 对象。")
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
        bank=catalog()
        if method=="GET":
            if path=="/api/overview":
                cards=cardlist(db)
                return {"sessions":summaries(db),"card_count":len(cards),"due":sum(c["due"]<=NOW() for c in cards),"now":NOW(),"settings":provider.public()}
            if path=="/api/questions": return list(bank.values())
            if path=="/api/sessions": return summaries(db)
            if path=="/api/cards": return cardlist(db)
            if path=="/api/reviews": return [dict(r) for r in db.execute("SELECT * FROM reviews ORDER BY moment DESC")]
            if path=="/api/settings": return dict(provider.public(),codex_available=bool(grading.codex_binary()))
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
            if path=="/api/sessions": return make_session(db,b,bank)
            if path=="/api/cards": return learn(db,b.get("session"),b.get("question"),b.get("index"))
            if path=="/api/reviews": return review(db,b)
            m=re.fullmatch(r"/api/sessions/([a-f0-9]+)/(edits|submit|grade|report)",path)
            if m:
                sid,action=m.groups()
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
    print(f"页间写作室已启动 http://127.0.0.1:{server.server_port}/",flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
