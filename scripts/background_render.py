#!/usr/bin/env python3
"""Background FFmpeg renderer. Runs only on GitHub's hosted runner."""
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

WORKER = os.environ.get("SHORTSFLOW_RENDER_WORKER", "https://shortsflow-analysis-engine.inipastiuy-41f.workers.dev").rstrip("/")
MAX_OUTPUT = 90 * 1024 * 1024

def request(url, method="GET", token=None, data=None, content_type=None, timeout=900):
    headers = {"User-Agent": "ShortsFlow-Background-Renderer/1.0"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if content_type:
        headers["Content-Type"] = content_type
    body = data
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read(2000).decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc

def oidc_token():
    endpoint = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL")
    bearer = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not endpoint or not bearer:
        raise RuntimeError("GitHub Actions OIDC is unavailable. Check workflow id-token permissions.")
    separator = "&" if "?" in endpoint else "?"
    url = endpoint + separator + urllib.parse.urlencode({"audience": "shortsflow-render"})
    _, _, body = request(url, token=bearer, timeout=30)
    token = json.loads(body).get("value")
    if not token:
        raise RuntimeError("GitHub did not issue a render runner identity token.")
    return token

def ass_time(seconds):
    cs = max(0, round(float(seconds) * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    sec, centi = divmod(rem, 100)
    return f"{h}:{m:02d}:{sec:02d}.{centi:02d}"

def ass_color(hex_color):
    value = str(hex_color or "#ffffff").lstrip("#")
    if len(value) != 6:
        value = "ffffff"
    r, g, b = value[0:2], value[2:4], value[4:6]
    return f"&H00{b}{g}{r}".upper()

def ass_escape(value):
    import re
    text = str(value or "")
    text = re.sub(r"</?b\s*>|&lt;/?b\s*&gt;", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<!\w)/b(?!\w)", " ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", " ").replace("\r", " ").strip()

def make_ass(job, path):
    cfg = job.get("subtitleConfig") or {}
    words = job.get("words") or []
    if cfg.get("enabled") is False or not words:
        return None
    clean = []
    for item in words:
        try:
            word = ass_escape(item.get("word"))
            start, end = float(item["start"]), float(item["end"])
            if word and end > start >= 0:
                clean.append({"word": word, "start": start, "end": end})
        except (TypeError, ValueError, KeyError):
            continue
    if not clean:
        return None
    groups, group = [], []
    for item in clean:
        prev = group[-1] if group else None
        gap = item["start"] - prev["end"] if prev else 0
        punctuation = bool(prev and __import__("re").search(r"[.!?…][”’\"')\\]]*$", prev["word"]))
        if group and (len(group) >= 4 or gap > .65 or punctuation):
            groups.append(group)
            group = []
        group.append(item)
    if group:
        groups.append(group)
    font_scale = max(.82, min(1.65, float(cfg.get("fontSize", 28)) / 28))
    size = max(30, min(76, round(49 * font_scale)))
    background = int(cfg.get("background", True) is not False)
    border_style = 3 if background else 1
    back_colour = "AA000000" if background else "00000000"
    base = ass_color(cfg.get("color", "#ffffff"))
    highlight = ass_color(cfg.get("highlight", "#b59aff"))
    position = cfg.get("position", "bottom")
    frame_y, frame_h = 173, 1574
    edge = max(.05, min(.25, float(cfg.get("edgeOffset", 9)) / 100))
    y = round(frame_y + frame_h * (edge if position == "top" else .5 if position == "center" else 1-edge))
    style = f"Style: Default,DejaVu Sans,{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H{back_colour},1,0,0,0,100,100,0,0,{border_style},1,0,5,40,40,40,1"
    lines = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "", "[V4+ Styles]", "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding", style, "", "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text"]
    for group in groups:
        plain = " ".join(item["word"] for item in group)
        for active in group:
            pieces = []
            for item in group:
                if item is active:
                    pieces.append("{\\c" + highlight + "&}\\b1 " + item["word"] + "{\\c" + base + "&}\\b0")
                else:
                    pieces.append(item["word"])
            text = " ".join(pieces)
            if background:
                text = "{\\bord2\\shad0}" + text
            text = "{\\an5\\pos(540," + str(y) + ")}" + text
            lines.append(f"Dialogue: 0,{ass_time(active['start'])},{ass_time(active['end'])},Default,,0,0,0,,{text}")
    pathlib.Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path

def render(job, source, output, workdir):
    start = float(job["startSeconds"])
    duration = float(job["endSeconds"]) - start
    if duration < 1 or duration > 180:
        raise RuntimeError("Clip duration must be between 1 and 180 seconds.")
    ass = make_ass(job, pathlib.Path(workdir) / "subtitles.ass")
    watermark = job.get("watermark") or {}
    filters = [
        "[0:v]split=2[bg0][fg0]",
        "[bg0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2,eq=brightness=-0.38:saturation=1.18[bg]",
        "[fg0]scale=994:1574:force_original_aspect_ratio=decrease,pad=994:1574:(ow-iw)/2:(oh-ih)/2:color=black[fg]",
        "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v0]",
    ]
    current = "v0"
    if ass:
        filters.append(f"[{current}]subtitles={ass}:fontsdir=/usr/share/fonts/truetype/dejavu[vsub]")
        current = "vsub"
    if watermark.get("watermarkEnabled", True):
        text = str(watermark.get("watermarkText") or "YOUR BRAND")[:40]
        textfile = pathlib.Path(workdir) / "watermark.txt"
        textfile.write_text(text, encoding="utf-8")
        scale = {"small": .68, "large": 1.15}.get(watermark.get("watermarkScale"), .88)
        size = round(42 * scale)
        pos = watermark.get("watermarkPosition", "bottom-right")
        x = "58" if pos.endswith("left") else "(w-text_w)/2" if pos.endswith("center") or pos == "center" else "w-text_w-58"
        y = "58" if pos.startswith("top") else "(h-text_h)/2" if pos == "center" else "h-text_h-58"
        opacity = max(.1, min(1, float(watermark.get("watermarkOpacity", .72))))
        filters.append(f"[{current}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:textfile={textfile}:fontcolor=white@{opacity}:fontsize={size}:shadowcolor=black@0.75:shadowx=2:shadowy=2:x={x}:y={y}[vout]")
        current = "vout"
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
        "-ss", str(start), "-i", str(source), "-t", str(duration),
        "-filter_complex", ";".join(filters), "-map", f"[{current}]", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-maxrate", "3.8M", "-bufsize", "7.6M", "-pix_fmt", "yuv420p", "-r", "30",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
        "-t", str(duration), str(output)
    ]
    print("Starting background FFmpeg render", flush=True)
    subprocess.run(command, check=True, timeout=1800)
    size = output.stat().st_size
    if size < 1024 or size > MAX_OUTPUT:
        raise RuntimeError(f"Rendered MP4 is invalid or exceeds 90 MB ({size} bytes).")
    return size

def main():
    token = oidc_token()
    worker = WORKER + "/internal/render/"
    _, _, response = request(worker + "claim", method="POST", token=token, data=b"{}", content_type="application/json")
    payload = json.loads(response)
    job = payload.get("job")
    if not job:
        print("No background render jobs queued.")
        return
    job_id = job["id"]
    print(f"Claimed background render job {job_id}", flush=True)
    try:
        with tempfile.TemporaryDirectory(prefix="shortsflow-render-") as temp:
            root = pathlib.Path(temp)
            source, output = root / "source-video", root / "render.mp4"
            _, _, video = request(worker + "source?" + urllib.parse.urlencode({"jobId": job_id}), token=token, timeout=900)
            source.write_bytes(video)
            if not source.stat().st_size:
                raise RuntimeError("Private source download returned an empty file.")
            size = render(job, source, output, temp)
            request(worker + "complete?" + urllib.parse.urlencode({"jobId": job_id}), method="POST", token=token, data=output.read_bytes(), content_type="video/mp4", timeout=900)
            print(f"Background render saved to R2 ({size} bytes).", flush=True)
    except Exception as error:
        message = str(error)[:900]
        print("Background render failed: " + message, file=sys.stderr, flush=True)
        try:
            request(worker + "fail?" + urllib.parse.urlencode({"jobId": job_id}), method="POST", token=token, data=json.dumps({"error": message}).encode(), content_type="application/json", timeout=30)
        except Exception as report_error:
            print("Could not report render failure: " + str(report_error), file=sys.stderr)
        raise

if __name__ == "__main__":
    main()
