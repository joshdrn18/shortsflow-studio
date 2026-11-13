#!/usr/bin/env python3
"""Exercise the same FFmpeg filter pipeline used for production renders."""
import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from background_render import render, render_autopilot, probe_media


def test_autopilot_render(root):
    audio = root / "autopilot-voice.mp3"
    output = root / "autopilot-output.mp4"
    subprocess.run([
        "ffmpeg","-hide_banner","-loglevel","error","-y",
        "-f","lavfi","-i","sine=frequency=440:duration=16",
        "-c:a","libmp3lame","-b:a","96k",str(audio)
    ],check=True,timeout=60)
    colors = ["red","blue","green","yellow"]
    images = []
    scenes = []
    for index,color in enumerate(colors,1):
        image = root / f"autopilot-scene-{index}.jpg"
        subprocess.run([
            "ffmpeg","-hide_banner","-loglevel","error","-y",
            "-f","lavfi","-i",f"color=c={color}:s=720x1280:r=30",
            "-frames:v","1","-update","1",str(image)
        ],check=True,timeout=30)
        images.append(image)
        scenes.append({
            "scene":index,
            "narration":f"This is original scene number {index} in a simple video render validation.",
            "subtitle":f"Ini adalah adegan asli nomor {index} dalam uji render video."
        })
    job = {
        "id":"autopilot-render-test",
        "scenes":scenes,
        "watermark":{"enabled":True,"text":"@Clippers2K26","position":"center","opacity":0.55,"scale":"small"}
    }
    size,duration = render_autopilot(job,images,audio,output,root)
    measured = probe_media(output)
    if size < 1024 or not 15 <= duration <= 60 or abs(measured-duration) > 0.5:
        raise SystemExit(f"Autopilot test output is invalid: size={size}, duration={duration}, measured={measured}")
    print(f"OK: autopilot FFmpeg produced 1080x1920 H.264/AAC with Indonesian subtitles and watermark ({size} bytes, {duration:.1f}s).")

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
        test_autopilot_render(root)

if __name__ == "__main__":
    main()
