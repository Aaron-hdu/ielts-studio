import json
import base64
import os
import socket
import urllib.error
import urllib.parse
import urllib.request

import studio
from studio import Problem, dump, require

DEFAULT = {"mode":"codex","base":"https://api.openai.com/v1","model":"","key":"","auto":False,"goal":7}


def settings():
    path=studio.DATA/".provider.json"
    return dict(DEFAULT,**(json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}))


def public():
    result=settings()
    result["has_key"]=bool(result.pop("key"))
    return result


def save(body):
    old=settings()
    mode=body.get("mode")
    require(mode in ("codex","api","agent"),"批改方式无效。")
    base=body.get("base",old["base"]).strip().rstrip("/")
    url=urllib.parse.urlsplit(base)
    require((url.scheme=="https" or (url.scheme=="http" and url.hostname in ("localhost","127.0.0.1","::1"))) and url.hostname and not url.username and not url.password and not url.fragment and not url.query,"Base URL 需使用 HTTPS 或本机 HTTP。")
    key=body.get("key","").strip() or (old["key"] if base==old["base"] and not body.get("clear_key") else "")
    model=body.get("model",old["model"]).strip()
    require(mode!="api" or (model and (key or url.hostname in ("localhost","127.0.0.1","::1"))),"请填写模型名和该服务的 API Key。")
    goal=body.get("goal",7)
    require(type(goal) in (int,float) and 1<=goal<=9 and goal*2==int(goal*2),"目标分数无效。")
    config={"mode":mode,"base":base,"model":model,"key":key,"auto":bool(body.get("auto")) and mode!="agent","goal":goal}
    tmp=studio.DATA/".provider.tmp"
    with os.fdopen(os.open(tmp,os.O_CREAT|os.O_TRUNC|os.O_WRONLY,0o600),"w",encoding="utf-8") as f: f.write(dump(config))
    tmp.replace(studio.DATA/".provider.json")
    return public()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


def invoke(config,payload,prompt,schema,image=None):
    headers={"Content-Type":"application/json","Accept":"application/json"}
    if config["key"]: headers["Authorization"]="Bearer "+config["key"]
    data={"model":config["model"],"messages":[{"role":"system","content":prompt+"\n输出一个符合以下 JSON Schema 的 JSON 对象，不包裹代码块。\n"+dump(schema)},{"role":"user","content":dump(payload)}],
          "response_format":{"type":"json_object"}}
    if image:
        data["messages"][1]["content"]=[{"type":"text","text":dump(payload)},{"type":"image_url","image_url":{"url":"data:"+image[0]+";base64,"+base64.b64encode(image[1]).decode()}}]
    req=urllib.request.Request(config["base"]+"/chat/completions",data=dump(data).encode(),headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=180) as stream:
            reply=json.load(stream)
        return json.loads(reply["choices"][0]["message"]["content"])
    except urllib.error.HTTPError as e:
        hints={401:"请检查 API Key。",403:"请检查密钥权限和模型访问权限。",404:"请检查 Base URL 和模型名。",429:"请检查服务配额，稍后再试。",400:"请确认模型支持 Chat Completions 和 JSON 输出。"}
        raise Problem(f"模型服务返回 HTTP {e.code}。"+hints.get(e.code,"请检查服务设置。"))
    except (urllib.error.URLError,socket.timeout):
        raise Problem("连接模型服务失败或超时，请检查地址和网络。")
    except (KeyError,IndexError,ValueError,TypeError):
        raise Problem("模型返回的格式不符合 JSON 报告要求。")
