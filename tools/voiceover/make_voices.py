#!/usr/bin/env python3
"""Generate the chess-piece voice clips with HeyGen Voice Turbo (free model).

Commands (run from the repo root):
  python3 tools/voiceover/make_voices.py plan             list the 96 files that will be made (no key needed)
  python3 tools/voiceover/make_voices.py voices           list HeyGen public voices
  python3 tools/voiceover/make_voices.py assign A1=<id> A2=<id> ... D2=<id>   save the 8 voice choices
  python3 tools/voiceover/make_voices.py make [--only Aldric] [--limit N]    make the clips
  python3 tools/voiceover/make_voices.py manifest         rewrite manifest.json from the files present

The API key is read from the HEYGEN_API_KEY environment variable and is never
printed or saved.
"""
import csv, json, os, re, sys, time, urllib.request, urllib.error, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(HERE, "clips.csv")
VOICES_PATH = os.path.join(HERE, "voices.json")
OUT_DIR = os.environ.get("VOICE_OUT_DIR", os.path.join(HERE, "..", "..", "src", "frontend", "public", "audio", "pieces"))
BASE = os.environ.get("HEYGEN_BASE", "https://api.heygen.com")
MODEL = "heygen-voice-1-turbo-free"
PAUSE = float(os.environ.get("VOICE_PAUSE", "2.3"))   # free tier: 30 requests/minute
EVENTS = [("Move line", "move"), ("Capture line", "capture"), ("Captured line", "captured")]


def starting_square(colour, ptype):
    """Fixed choice of starting square for each of the 32 pieces."""
    rank_back = "1" if colour == "white" else "8"
    rank_pawn = "2" if colour == "white" else "7"
    m = re.match(r"^(King|Queen|Rook|Bishop|Knight|Pawn)(?: (\d))?$", ptype)
    kind, n = m.group(1), m.group(2)
    n = int(n) if n else 1
    files = {"King": "e", "Queen": "d"}
    if kind in files:
        return kind.lower(), files[kind] + rank_back
    if kind == "Pawn":
        return "pawn", "abcdefgh"[n - 1] + rank_pawn
    pair = {"Rook": "ah", "Knight": "bg", "Bishop": "cf"}[kind]
    return kind.lower(), pair[n - 1] + rank_back


def safe(text):
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-")


def load_rows():
    rows = []
    with open(CSV_PATH, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            colour = r["Colour"].strip().lower()
            ptype, square = starting_square(colour, r["Type"].strip())
            rows.append({
                "name": r["Piece"].strip(), "colour": colour, "type": ptype, "square": square,
                "actor": r["Actor"].strip(),
                "lines": {ev: r[col].strip().strip('"').strip() for col, ev in EVENTS},
            })
    return rows


def stem(row, ev):
    return f"{row['colour']}_{row['type']}_{row['square']}_{ev}_{safe(row['name'])}"


def existing_file(row, ev):
    for ext in ("mp3", "wav"):
        p = os.path.join(OUT_DIR, f"{stem(row, ev)}.{ext}")
        if os.path.exists(p):
            return os.path.basename(p)
    return None


def key():
    k = os.environ.get("HEYGEN_API_KEY", "").strip()
    if not k:
        sys.exit("No API key found. Set it first (see the instructions), then run again.")
    return k


def call(method, path, body=None, tries=6):
    url = BASE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    delay = 5
    for attempt in range(1, tries + 1):
        req = urllib.request.Request(url, data=data, method=method, headers={
            "X-Api-Key": key(), "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status, json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            if e.code in (429, 500, 503) and attempt < tries:
                wait = e.headers.get("Retry-After")
                wait = int(wait) if wait and wait.isdigit() else delay
                print(f"   busy ({e.code}); waiting {wait}s then retrying ({attempt}/{tries - 1})")
                time.sleep(wait)
                delay = min(delay * 2, 60)
                continue
            return e.code, {"_error": text[:500]}
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt < tries:
                print(f"   network hiccup ({e}); retrying")
                time.sleep(delay)
                delay = min(delay * 2, 60)
                continue
            return 0, {"_error": str(e)}
    return 0, {"_error": "gave up"}


def find_url(payload):
    for d in (payload.get("data"), payload):
        if isinstance(d, dict) and d.get("audio_url"):
            return d["audio_url"]
    return None


def download(url, dest):
    with urllib.request.urlopen(url, timeout=120) as r:
        blob = r.read()
    if len(blob) < 500:
        raise RuntimeError("downloaded file is suspiciously small")
    with open(dest, "wb") as f:
        f.write(blob)


def cmd_plan():
    rows = load_rows()
    n = 0
    for r in rows:
        for _, ev in EVENTS:
            print(f"{stem(r, ev)}   [{r['actor']}]  \"{r['lines'][ev]}\"")
            n += 1
    print(f"\n{n} clips, {sum(len(t) for r in rows for t in r['lines'].values())} characters")


def cmd_voices(args):
    items, token = [], None
    for _ in range(30):
        path = "/v3/models/audio/voices?type=public&limit=100" + (("&token=" + urllib.parse.quote(token)) if token else "")
        code, payload = call("GET", path)
        if code != 200:
            sys.exit(f"HeyGen answered {code}: {payload.get('_error')}")
        page = payload.get("data") or []
        items.extend(page)
        token = payload.get("next_token")
        if not (payload.get("has_more") and token):
            break
    for it in items:
        vid = it.get("voice_id") or it.get("id")
        print(f"{vid} | {it.get('name')} | {it.get('gender')} | {it.get('language')} | {it.get('preview_audio_url')}")
    print(f"\n{len(items)} voices in total.")


def cmd_assign(args):
    need = sorted({r["actor"] for r in load_rows()})
    got = dict(a.split("=", 1) for a in args if "=" in a)
    missing = [a for a in need if a not in got]
    if missing:
        sys.exit(f"Missing voices for: {', '.join(missing)}. Give all of: {', '.join(need)}")
    with open(VOICES_PATH, "w") as f:
        json.dump({a: got[a].strip() for a in need}, f, indent=1)
    print("Saved voice choices:", {a: got[a][:8] + "..." for a in need})


def cmd_make(args):
    only = args[args.index("--only") + 1] if "--only" in args else None
    limit = int(args[args.index("--limit") + 1]) if "--limit" in args else None
    if not os.path.exists(VOICES_PATH):
        sys.exit("No voices chosen yet. Run the 'assign' step first.")
    voices = json.load(open(VOICES_PATH))
    os.makedirs(OUT_DIR, exist_ok=True)
    made = skipped = failed = 0
    for r in load_rows():
        if only and r["name"].lower() != only.lower():
            continue
        for _, ev in EVENTS:
            if limit is not None and made >= limit:
                break
            if existing_file(r, ev):
                skipped += 1
                continue
            text = r["lines"][ev]
            print(f"{stem(r, ev)}: {text}")
            body = {"model": MODEL, "voice_id": voices[r["actor"]], "text": text, "language": "en",
                    "output_format": {"encoding": "mp3", "bitrate_bps": 96000}}
            code, payload = call("POST", "/v3/models/audio/tts", body)
            if code == 400 and "output_format" in json.dumps(payload):
                body.pop("output_format")
                code, payload = call("POST", "/v3/models/audio/tts", body)
            url = find_url(payload) if code == 200 else None
            if not url:
                failed += 1
                print(f"   FAILED ({code}): {payload.get('_error') or json.dumps(payload)[:300]}")
                time.sleep(PAUSE)
                continue
            ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lstrip(".") or "wav"
            try:
                download(url, os.path.join(OUT_DIR, f"{stem(r, ev)}.{ext}"))
                made += 1
                print(f"   saved .{ext}")
            except Exception as e:
                failed += 1
                print(f"   download FAILED: {e}")
            time.sleep(PAUSE)
    print(f"\nmade {made}, already there {skipped}, failed {failed}")
    cmd_manifest()
    if failed:
        print("Some clips failed. Run the same command again: finished clips are skipped.")


def cmd_manifest():
    out = {}
    for r in load_rows():
        entry = {"name": r["name"], "colour": r["colour"], "type": r["type"], "square": r["square"]}
        for _, ev in EVENTS:
            entry[ev] = existing_file(r, ev)
        out[f"{r['colour']}_{r['type']}_{r['square']}"] = entry
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
        json.dump(out, f, indent=1)
    have = sum(1 for e in out.values() for ev in ("move", "capture", "captured") if e[ev])
    print(f"manifest.json written ({have} of 96 clips present)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    rest = sys.argv[2:]
    if cmd == "plan": cmd_plan()
    elif cmd == "voices": cmd_voices(rest)
    elif cmd == "assign": cmd_assign(rest)
    elif cmd == "make": cmd_make(rest)
    elif cmd == "manifest": cmd_manifest()
    else: print(__doc__)
