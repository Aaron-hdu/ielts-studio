"""Read historical practice notebooks stored alongside the user's essay archives."""
import json
import re

import studio


def summary(path):
    with path.open(encoding="utf-8") as file:
        title = file.readline().rstrip().removeprefix("# ")
        line = file.readline().strip()
    if not line.startswith("<!-- ") or not line.endswith(" -->"):
        return None
    meta = json.loads(line[5:-4])
    return dict(meta, id=path.stem.split("-")[-1], title=title)


def listing():
    rows = []
    for path in (studio.DATA / "作文").glob("历史练习-*.md"):
        if re.fullmatch(r"历史练习-[0-9]+", path.stem):
            row = summary(path)
            if row:
                rows.append(row)
    return sorted(rows, key=lambda row: (row["date"], row["id"]), reverse=True)


def read(number):
    studio.require(re.fullmatch(r"[0-9]+", number), "无效的历史练习编号。")
    path = studio.DATA / "作文" / ("历史练习-" + number + ".md")
    studio.require(path.is_file(), "找不到这篇历史练习。", 404)
    row = summary(path)
    studio.require(row, "历史练习格式不完整。")
    row["markdown"] = path.read_text(encoding="utf-8")
    return row
