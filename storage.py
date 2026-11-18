"""Switch the local data directory only after a verified copy is ready."""
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path

import studio
from studio import Problem, require


def describe():
    return {"path":str(studio.DATA), "environment":bool(os.environ.get("IELTS_DATA"))}


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.digest()


def relocate(raw):
    require(not os.environ.get("IELTS_DATA"), "当前启动命令指定了 IELTS_DATA。请移除该变量并重启后再从网页迁移。")
    require(isinstance(raw,str) and raw.strip(), "请输入目标文件夹的绝对路径。")
    target = Path(raw.strip()).expanduser()
    require(target.is_absolute(), "需要绝对路径。")
    target = target.resolve()
    with studio.LOCK:
        old = studio.DATA
        if old == target:
            return describe()
        require(old not in target.parents and target not in old.parents and
                target != studio.ROOT and studio.ROOT not in target.parents, "请选源码和当前数据目录之外的独立文件夹。")
        for project_dir in (studio.ROOT, *studio.ROOT.parents):
            if (project_dir/".git").exists():
                require(target != project_dir and project_dir not in target.parents,
                        "该路径属于项目的 Git 仓库。请选择仓库外的文件夹，以保护个人数据。")
                break
        with studio.transaction() as db:
            require(not db.execute("SELECT 1 FROM sessions WHERE grade_state='running'").fetchone(), "批改结束后可以迁移。",409)
        require(not target.exists() or (target.is_dir() and not any(target.iterdir())), "目标目录需要为空，请选一个新目录。")
        try:
            target.parent.mkdir(parents=True,exist_ok=True)
            with tempfile.TemporaryDirectory(dir=target.parent) as temp:
                staged = Path(temp)/"data"
                shutil.copytree(old, staged)
                staged.chmod(0o700)
                for file in old.rglob("*"):
                    if file.is_file():
                        require(digest(file)==digest(staged/file.relative_to(old)), "迁移核对失败，原目录仍在使用。")
                if target.exists():
                    target.rmdir()
                staged.rename(target)
            pointer=studio.LOCATION_FILE
            with tempfile.NamedTemporaryFile("w",dir=pointer.parent,encoding="utf-8",delete=False) as f:
                json.dump({"path":str(target)}, f, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())
            os.replace(f.name,pointer)
        except OSError as error:
            raise Problem(f"迁移失败，原目录仍在使用。{error.strerror}")
        studio.DATA=target
        return describe()
