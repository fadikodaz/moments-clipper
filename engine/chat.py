"""
Chat replay signal: how hard the live chat reacted, per 10 seconds, as a hint for the AI that picks moments.

YouTube keeps the chat of past live streams. yt-dlp can only read it from the start of the stream, so the
download runs in the background next to the audio download and is stopped as soon as it passes the end
of the chosen part. Videos without a chat replay (normal uploads) simply have no chat signal.

    from chat import ChatFetch, spikes, tag_for
    job = ChatFetch(url, lo, hi, signals_dir / "chat.json"); job.start()
    ...
    msgs = job.wait(600)              # [(second, text)] in the part, or None
    tags = spikes(msgs, lo, hi)       # {bin_start_second: (ratio, [("LMAO", 30), ...])}
    tag_for(tags, a, b)               # ' [CHAT x5: "LMAO" x30]' for a transcript line, or ''

Spike detection follows the idea of gta6-clipper's chat.py (MIT, NoCodeHack): a 10 s window counts when it
is a few times the stream's own median, so quiet and huge chats are judged alike.
"""

import json
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from collections import Counter
from pathlib import Path

BIN = 10
STREAM_START_SKIP = 300   # the first minutes of a stream are "hi chat": never a moment
HYPE = set(("kekw lul lulw lol lmao lmfao lmaooo omegalul icant omg wtf pog poggers w ww www l ll monkas clip clipit letsgo "
            "nooo noooo bruh sheesh insane cinema cooked dead dying crying 😂 💀 🤣 😭 🔥").split())


def _last_offset(path: Path) -> float:
    """Second of the newest message in a partly written live_chat file (reads only its tail)."""
    try:
        with path.open("rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 65536))
            tail = f.read().decode("utf-8", "replace").splitlines()
        for line in reversed(tail):
            try:
                return int(json.loads(line)["replayChatItemAction"]["videoOffsetTimeMsec"]) / 1000
            except (ValueError, KeyError):
                continue
    except OSError:
        pass
    return 0.0


def _parse(path: Path, lo: float, hi: float) -> list[tuple[int, str]]:
    out = []
    for line in path.open(encoding="utf-8", errors="replace"):
        try:
            act = json.loads(line)["replayChatItemAction"]
            sec = int(act["videoOffsetTimeMsec"]) / 1000
        except (ValueError, KeyError):
            continue
        if not lo <= sec < hi:
            continue
        for a in act.get("actions", []):
            m = a.get("addChatItemAction", {}).get("item", {}).get("liveChatTextMessageRenderer")
            if not m:
                continue
            text = "".join(r.get("text") or ((r.get("emoji") or {}).get("shortcuts") or [""])[0] for r in m.get("message", {}).get("runs", []))
            out.append((int(sec), text.strip()))
    return out


class ChatFetch(threading.Thread):
    """Downloads the chat replay of [lo, hi) seconds in the background; result cached in `out` (JSON)."""

    def __init__(self, url: str, lo: float, hi: float, out: Path, limit_s: float = 1800):
        super().__init__(daemon=True)
        self.url, self.lo, self.hi, self.out, self.limit_s = url, lo, hi, out, limit_s
        self.msgs: list[tuple[int, str]] | None = None
        self.note = ""
        self.progress = 0.0

    def run(self) -> None:
        if self.out.exists():
            try:
                d = json.loads(self.out.read_text(encoding="utf-8"))
                self.msgs, self.note = ([tuple(m) for m in d["msgs"]] if d.get("msgs") is not None else None), d.get("note", "")
                self.progress = 1.0
                return
            except (ValueError, KeyError):
                pass
        tmp = Path(tempfile.mkdtemp(prefix="chat_"))
        try:
            self.msgs = self._fetch(tmp)
        except Exception as e:  # chat is a bonus: never break the job
            self.msgs, self.note = None, f"chat not read: {e}"
        finally:
            shutil.rmtree(tmp, ignore_errors=True)  # the raw file can be large
        self.progress = 1.0
        try:
            self.out.write_text(json.dumps({"lo": self.lo, "hi": self.hi, "note": self.note, "msgs": self.msgs}, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

    def _fetch(self, tmp: Path) -> list[tuple[int, str]] | None:
        cmd = [sys.executable, "-m", "yt_dlp", "-q", "--no-warnings", "--no-playlist", "--skip-download", "--write-subs",
               "--sub-langs", "live_chat", "-o", str(tmp / "c.%(ext)s"), self.url]
        p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
        t0, stopped = time.time(), False
        while p.poll() is None:
            time.sleep(2)
            f = next(tmp.glob("*live_chat*"), None)
            if f:
                at = _last_offset(f)
                self.progress = min(1.0, at / max(1.0, self.hi))
                if at >= self.hi + BIN:  # past the chosen part: enough
                    stopped = True
                    break
            if time.time() - t0 > self.limit_s:
                self.note = f"chat download stopped after {self.limit_s // 60:.0f} min"
                stopped = True
                break
        if stopped:
            p.kill()
        err = "" if stopped else (p.communicate()[1] or "")
        p.wait()
        f = next(tmp.glob("*live_chat*"), None)
        if not f:
            self.note = "no chat replay for this video"
            if "live_chat" not in err and err.strip():
                self.note += f" ({err.strip()[-160:]})"
            return None
        return _parse(f, self.lo, self.hi)

    def wait(self, timeout: float) -> list[tuple[int, str]] | None:
        self.join(timeout)
        if self.is_alive():
            self.note = "chat still downloading; picking without it"
            return None
        return self.msgs


def top_words(texts: list[str], n: int = 3, min_count: int = 3) -> list[tuple[str, int]]:
    """Most repeated reaction words (LMAO, W, KEKW, 💀...) and short repeated messages; each message counts a word once."""
    c, shown = Counter(), {}
    for t in texts:
        words, hit = t.split(), set()
        for w in words:
            k = w.lower().strip(".,!?")
            if k in HYPE:
                hit.add(k)
                shown.setdefault(k, w.strip(".,!?").upper())
        if words and len(t) <= 25 and len(words) <= 4:
            k = t.lower()
            hit.add(k)
            shown.setdefault(k, t)
        for k in hit:
            c[k] += 1
    return [(shown[k], v) for k, v in c.most_common(n) if v >= min_count]


def spikes(msgs: list[tuple[int, str]] | None, lo: float, hi: float, mult: float = 2.5, pct: float = 92, min_msgs: int = 6) -> dict:
    """{bin_start_second: (ratio to the median, top words)} for 10 s windows where chat went clearly above normal."""
    if not msgs:
        return {}
    lo = int(lo)
    nb = max(1, int(-(-(hi - lo) // BIN)))
    counts, texts = [0] * nb, [[] for _ in range(nb)]
    for s, t in msgs:
        i = int((s - lo) // BIN)
        if 0 <= i < nb:
            counts[i] += 1
            texts[i].append(t)
    med = max(1.0, statistics.median(counts))
    thr = max(mult * med, sorted(counts)[min(nb - 1, int(nb * pct / 100))], min_msgs)
    return {lo + i * BIN: (round(c / med, 1), top_words(texts[i]))
            for i, c in enumerate(counts) if c >= thr and lo + i * BIN >= STREAM_START_SKIP}


def tag_for(tags: dict, a: float, b: float) -> str:
    """Tag of the strongest chat window overlapping [a, b] (absolute seconds), e.g. ' [CHAT x5: "LMAO" x30]'."""
    hit = [v for k, v in tags.items() if k <= b and k + BIN > a]
    if not hit:
        return ""
    ratio, words = max(hit, key=lambda v: v[0])
    return f" [CHAT x{ratio:g}" + (": " + ", ".join(f'"{w}" x{n}' for w, n in words) if words else "") + "]"


def summary(msgs, tags) -> str:
    if msgs is None:
        return "no chat"
    return f"{len(msgs)} chat messages, {len(tags)} spikes"


if __name__ == "__main__":
    # python chat.py <url> <from_s> <to_s>   (prints the spikes)
    url, lo, hi = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
    job = ChatFetch(url, lo, hi, Path(tempfile.gettempdir()) / "chat-test.json")
    job.start()
    m = job.wait(3600)
    sp = spikes(m, lo, hi)
    print(summary(m, sp), job.note)
    for k in sorted(sp):
        print(f"{k // 3600}:{k % 3600 // 60:02d}:{k % 60:02d} {tag_for(sp, k, k)}")
