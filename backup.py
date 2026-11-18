import contextlib
import io
import shutil
import sqlite3
import tempfile
import zipfile
from pathlib import Path

import studio
from studio import LOCK, Problem, connect, require


def pack():
    with LOCK, tempfile.TemporaryDirectory() as tmp, contextlib.closing(connect()) as live:
        snap=Path(tmp)/"studio.sqlite3"
        with contextlib.closing(sqlite3.connect(snap)) as dest: live.backup(dest)
        buf=io.BytesIO()
        with zipfile.ZipFile(buf,"w",zipfile.ZIP_DEFLATED) as z:
            z.write(snap,"studio.sqlite3")
            for name in ("作文","配图"):
                for p in (studio.DATA/name).glob("*"):
                    if p.is_file(): z.write(p,str(p.relative_to(studio.DATA)))
        return buf.getvalue()


def restore(binary):
    from studio import init, uid
    with LOCK, tempfile.TemporaryDirectory(dir=studio.DATA) as tmp:
        tmp=Path(tmp)
        try:
            with zipfile.ZipFile(io.BytesIO(binary)) as z:
                require(sum(i.file_size for i in z.infolist())<=500_000_000,"备份解压后过大。")
                require("studio.sqlite3" in z.namelist(),"备份缺少数据库。")
                for info in z.infolist():
                    p=Path(info.filename)
                    require(info.filename=="studio.sqlite3" or (len(p.parts)==2 and p.parts[0] in ("作文","配图") and p.name not in (".","..")), "备份含未知路径。")
                    dest=tmp/p
                    dest.parent.mkdir(exist_ok=True)
                    dest.write_bytes(z.read(info))
            with contextlib.closing(sqlite3.connect(tmp/"studio.sqlite3")) as db, contextlib.closing(connect()) as current:
                require(not current.execute("SELECT 1 FROM sessions WHERE grade_state='running'").fetchone(),"请等当前批改完成再恢复。",409)
                schema=lambda conn: {tuple(r) for r in conn.execute("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL")}
                require(schema(db)==schema(current) and db.execute("PRAGMA integrity_check").fetchone()[0]=="ok","备份数据库版本不匹配或已损坏。")
        except (zipfile.BadZipFile,sqlite3.DatabaseError):
            raise Problem("无法读取此备份。")
        before=studio.DATA/("恢复前备份-"+uid()+".zip")
        before.write_bytes(pack())
        old=tmp/"old"
        old.mkdir()
        try:
            for name in ("studio.sqlite3","作文","配图"):
                live=studio.DATA/name
                if live.exists(): live.replace(old/name)
                if (tmp/name).exists(): (tmp/name).replace(live)
            init()
        except Exception:
            for p in old.iterdir():
                live=studio.DATA/p.name
                if live.is_dir(): shutil.rmtree(live)
                p.replace(live)
            raise
        return {"previous":before.name}
