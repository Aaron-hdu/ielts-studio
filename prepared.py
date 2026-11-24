"""Prepare both views of a bilingual exercise before the expression is studied."""
import re


def local_question(card):
    sentence=card["answer"].strip()
    target=card["target"].strip()
    if not sentence or not target or not card["cue"].strip():
        return None
    # Match the actual inflection and variable slots in a report example.
    parts=[]
    if target.casefold()=="bring people together":
        parts=[r"(?:bring|brings|bringing|brought)",r"people(?:\s+[\w’-]+){0,5}?",r"together"]
    elif target.casefold()=="be worth it":
        parts=[r"(?:(?:be|is|are|was|were|been|being)\s+)?worth",r"it"]
    for word in ([] if parts else target.split()):
        token=re.escape(word)
        if word.lower() in ("someone","something"):
            token=r"(?:[\w’'-]+\s+){0,6}?[\w’'-]+"
        elif word.lower()=="be":
            token=r"(?:be|is|are|was|were|been|being)"
        elif word.lower()=="overtake":
            token=r"(?:overtake[ns]?|overtook|overtaking)"
        elif word.isalpha() and len(word)>3:
            forms={word,word+"s",word+"ed",word+"ing"}
            if word.endswith("s") and not word.endswith("ss"):
                forms.add(word[:-1])
            if word.endswith("e"):
                forms.update((word+"d",word[:-1]+"ing"))
            token="(?:"+"|".join(re.escape(x) for x in sorted(forms,key=len,reverse=True))+")"
        parts.append(token)
    pattern=r"(?<!\w)"+r"\s+".join(parts)+r"(?!\w)"
    matches=list(re.finditer(pattern,sentence,re.I))
    if len(matches)!=1:
        return None
    return {"sentence":sentence,"span":matches[0].group(),"chinese":card["cue"]}
