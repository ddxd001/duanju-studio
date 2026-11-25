"""Concatenate multiple MP4 clips into one episode MP4 using PyAV.

Used by server/image-server.mjs as a zero-FFmpeg-CLI fallback (e.g. via
ComfyUI's embedded Python which already ships PyAV).
Usage: python concat_videos.py <output.mp4> <input1.mp4> [input2.mp4 ...]
"""
import sys
from fractions import Fraction
import av


def concat_videos(output_path: str, input_paths: list[str]) -> None:
    if not input_paths:
        raise ValueError("No input videos provided")

    # Inspect first clip for target video parameters
    with av.open(input_paths[0]) as first:
        v0 = next((s for s in first.streams if s.type == "video"), None)
        if v0 is None:
            raise ValueError(f"No video stream in {input_paths[0]}")
        width = v0.codec_context.width
        height = v0.codec_context.height
        fps = v0.average_rate or Fraction(24, 1)
        if fps <= 0:
            fps = Fraction(24, 1)

    has_any_audio = False
    for p in input_paths:
        with av.open(p) as container:
            if any(s.type == "audio" for s in container.streams):
                has_any_audio = True
                break

    out = av.open(output_path, mode="w")
    try:
        out_v = out.add_stream("libx264", rate=fps)
        out_v.width = width
        out_v.height = height
        out_v.pix_fmt = "yuv420p"
        out_v.options = {"crf": "20", "preset": "fast"}

        out_a = None
        resampler = None
        audio_sample_rate = 48000
        if has_any_audio:
            out_a = out.add_stream("aac", rate=audio_sample_rate)
            out_a.layout = "stereo"
            resampler = av.AudioResampler(format="fltp", layout="stereo", rate=audio_sample_rate)

        video_pts = 0
        audio_pts = 0

        for path in input_paths:
            clip_v_frames = 0
            clip_a_samples = 0
            with av.open(path) as inp:
                v_stream = next((s for s in inp.streams if s.type == "video"), None)
                a_stream = next((s for s in inp.streams if s.type == "audio"), None)

                if v_stream is not None:
                    for frame in inp.decode(video=0):
                        if frame.width != width or frame.height != height or frame.format.name != "yuv420p":
                            frame = frame.reformat(width=width, height=height, format="yuv420p")
                        frame.pts = video_pts
                        frame.time_base = Fraction(1, int(round(float(fps))))
                        video_pts += 1
                        clip_v_frames += 1
                        for packet in out_v.encode(frame):
                            out.mux(packet)

                if out_a is not None and a_stream is not None:
                    inp.seek(0)
                    for frame in inp.decode(audio=0):
                        for resampled in resampler.resample(frame):
                            resampled.pts = audio_pts
                            audio_pts += resampled.samples
                            clip_a_samples += resampled.samples
                            for packet in out_a.encode(resampled):
                                out.mux(packet)

                # Pad silence if a clip has video but no audio track so later clips stay in sync
                if out_a is not None and a_stream is None and clip_v_frames > 0:
                    target_samples = int(round((clip_v_frames / float(fps)) * audio_sample_rate))
                    chunk = 1024
                    remaining = target_samples
                    while remaining > 0:
                        n = min(chunk, remaining)
                        silent = av.AudioFrame(format="fltp", layout="stereo", samples=n)
                        silent.sample_rate = audio_sample_rate
                        for plane in silent.planes:
                            plane.update(bytes(plane.buffer_size))
                        silent.pts = audio_pts
                        audio_pts += n
                        remaining -= n
                        for packet in out_a.encode(silent):
                            out.mux(packet)

        for packet in out_v.encode():
            out.mux(packet)
        if out_a is not None:
            for packet in out_a.encode():
                out.mux(packet)
    finally:
        out.close()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.stderr.write("Usage: concat_videos.py <output.mp4> <input1.mp4> [input2.mp4 ...]\n")
        sys.exit(2)
    concat_videos(sys.argv[1], sys.argv[2:])
