"""josa(value, particle): the Korean particle that fits a value known only at build time.
A port of qkr's josa.ts ($QKR_URL/josa.ts, 4 Nov 2026): qkr writes a particle after a placeholder as a token
({GRC.2009.r2|을}); fill() resolves it here. Keep PAIRS in step with josa.ts."""
import re

PAIR_LIST = [
    ("이", "가"), ("은", "는"), ("을", "를"), ("과", "와"), ("과의", "와의"), ("과는", "와는"), ("과도", "와도"),
    ("으로", "로"), ("으로서", "로서"), ("으로써", "로써"), ("으로는", "로는"), ("으로도", "로도"), ("으로부터", "로부터"),
    ("으로의", "로의"),
    ("이나", "나"), ("이다", "다"), ("이며", "며"), ("이고", "고"), ("이었다", "였다"), ("이었고", "였고"),
    ("이었습니다", "였습니다"), ("이면", "면"), ("이라", "라"), ("이라는", "라는"), ("이라고", "라고"), ("이란", "란"),
    ("이든", "든"), ("이지만", "지만"), ("이므로", "므로"),
]
PAIRS = {}
for a, b in PAIR_LIST:
    PAIRS[a] = (a, b)
    PAIRS[b] = (a, b)
DIGIT_FINAL = {"0": "other", "1": "rieul", "2": "none", "3": "other", "4": "none", "5": "none", "6": "other", "7": "rieul",
               "8": "rieul", "9": "none"}
OPEN = {")": "(", "]": "[", "」": "「", "』": "『"}


def last_sound(word: str) -> str:
    w = word.strip()
    while w and w[-1] in ")]」』\"'’”":
        o = OPEN.get(w[-1])
        i = w.rfind(o) if o else -1
        w = (w[:i] if i > 0 else w[:-1]).strip()
    ch = w[-1] if w else ""
    code = ord(ch) - 0xAC00 if ch else -1
    if 0 <= code < 11172:
        jong = code % 28
        return "none" if jong == 0 else "rieul" if jong == 8 else "other"
    if ch in DIGIT_FINAL:
        return DIGIT_FINAL[ch]
    if ch == "%":
        return "none"
    if re.match(r"[a-z]", ch, re.I):
        return ("rieul" if re.search(r"l$", w, re.I) else "other") if re.search(r"[lmnr]$", w, re.I) else "none"
    return "none"


def josa(word, particle: str) -> str:
    w = str(word)
    pair = PAIRS.get(particle)
    if not pair:
        return w + particle
    s = last_sound(w)
    with_final = (s == "other") if pair[0].startswith("으로") else (s != "none")
    return w + (pair[0] if with_final else pair[1])
