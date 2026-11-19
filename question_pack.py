"""Move only private Cambridge question material between local installations."""
import io
import json
from pathlib import Path
import zipfile

import online_questions as online
import studio


def pack():
    buffer=io.BytesIO()
    with studio.transaction() as db, zipfile.ZipFile(buffer,"w",zipfile.ZIP_DEFLATED) as bundle:
        records={}
        for q in online.cambridge():
            item=online.saved_question(db,q)
            if not item:
                continue
            record={k:item[k] for k in ("prompt","prompt_source","source")}
            if item.get("figure"):
                name=Path(item["figure"]).name
                bundle.write(studio.DATA/"配图"/name,"figures/"+name)
                record["image"]="figures/"+name
            records[q["id"]]=record
        bundle.writestr("questions.json",studio.dump({"format":1,"questions":records}))
    return buffer.getvalue()


def unpack(binary):
    bank={q["id"]:q for q in online.cambridge()}
    items=[]
    try:
        with zipfile.ZipFile(io.BytesIO(binary)) as bundle:
            names=bundle.namelist()
            studio.require(len(names)==len(set(names)) and 1<=len(names)<=85 and "questions.json" in names,"不是写作室的独立题库包。")
            studio.require(sum(i.file_size for i in bundle.infolist())<=128_000_000 and bundle.getinfo("questions.json").file_size<=4_000_000,"题库包过大。")
            manifest=json.loads(bundle.read("questions.json"))
            studio.require(isinstance(manifest,dict) and manifest.get("format")==1 and isinstance(manifest.get("questions"),dict),"无法识别题库包格式。")
            expected={"questions.json"}
            for qid,record in manifest["questions"].items():
                q=bank.get(qid)
                studio.require(q and isinstance(record,dict) and record.get("source")==q["source"],"题号或题源不匹配。")
                prompt=record.get("prompt")
                studio.require(isinstance(prompt,str) and 12<=len(prompt.strip())<=15000 and record.get("prompt_source") in ("transcription","user_transcription"),"题库包含无效题文。")
                item=dict(q,prompt=prompt,prompt_source=record["prompt_source"])
                chart=None
                if "image" in record:
                    path=record["image"]
                    studio.require(q["task"]==1 and isinstance(path,str) and path in names and bundle.getinfo(path).file_size<=8_000_000,"题库包含无效配图。")
                    chart=online.chart_file(q,bundle.read(path))
                    studio.require(path=="figures/"+chart[0],"题图与题号或校验值不匹配。")
                    expected.add(path)
                items.append((item,chart))
            studio.require(expected==set(names),"题库包包含其他文件。")
    except (zipfile.BadZipFile,KeyError,ValueError,UnicodeError,RuntimeError,NotImplementedError) as exc:
        raise studio.Problem("无法读取题库包。请使用写作室导出的 ZIP。") from exc
    added=0
    with studio.transaction() as db:
        for item,chart in items:
            old=online.saved_question(db,item)
            if online.complete(old) or (old and not chart):
                continue
            if chart: item["figure"]=online.save_image(*chart)
            online.store_question(db,item)
            added+=1
        if all(online.complete(online.saved_question(db,q)) for q in bank.values()):
            online.set_job(db,"complete")
    return {"added":added}
