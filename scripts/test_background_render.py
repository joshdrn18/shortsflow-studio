#!/usr/bin/env python3
"""Exercise the same FFmpeg filter pipeline used for production renders."""
import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from background_render import render

def main():
    with tempfile.TemporaryDirectory(prefix="shortsflow-render-test-") as temp:
        root = pathlib.Path(temp)
        source, output = root / "synthetic-source.mp4", root / "synthetic-render.mp4"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
            "-f", "lavfi", "-i", "sine=frequency=880:duration=3",
            "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
            str(source)
        ], check=True, timeout=60)
        job = {
            "startSeconds": 0, "endSeconds": 3,
            "words": [
                {"word": "BACKGROUND", "start": .1, "end": .65},
                {"word": "RENDER", "start": .66, "end": 1.2},
                {"word": "TEST", "start": 1.21, "end": 2.1}
            ],
            "subtitleConfig": {
                "enabled": True, "fontSize": 28, "color": "#ffffff",
                "highlight": "#b59aff", "position": "bottom", "background": True,
                "fontWeight": 900, "animation": "pop", "highlightStyle": "color"
            },
            "watermark": {
                "watermarkEnabled": True, "watermarkText": "SHORTSFLOW TEST",
                "watermarkPosition": "bottom-right", "watermarkOpacity": .72,
                "watermarkScale": "medium"
            }
        }
        size = render(job, source, output, temp)
        probe = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries",
            "stream=codec_type,codec_name,width,height", "-of", "json", str(output)
        ], check=True, capture_output=True, text=True, timeout=30)
        streams = json.loads(probe.stdout).get("streams", [])
        video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
        audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
        if not video or video.get("codec_name") != "h264" or video.get("width") != 1080 or video.get("height") != 1920:
            raise SystemExit(f"Background render output has invalid video stream: {video}")
        if not audio or audio.get("codec_name") != "aac":
            raise SystemExit(f"Background render output has invalid audio stream: {audio}")
        print(f"OK: FFmpeg background pipeline rendered 1080x1920 H.264/AAC MP4 ({size} bytes).")

if __name__ == "__main__":
    main()
