"""The Story's soundtrack: the CC0 track, cut and braked to the edit, and a jingle for the logo.

The jingle is made here from sine waves and noise, so it belongs to us:
a riser as the bars fall, the impact as the logo lands, then a four-note chime in the
track's key (G major: D, G, B, D) over a soft G chord. Everything lines up with the
same beat grid as the pictures.
"""
import json
import subprocess
import tempfile
import wave

import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d

SR = 48000


def load(path, ff, start, dur):
    raw = subprocess.run([ff, "-v", "error", "-ss", f"{start:.4f}", "-t", f"{dur:.4f}", "-i", str(path),
                          "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def env_exp(n, tau, attack=0.003):
    t = np.arange(n) / SR
    return np.minimum(1, t / attack) * np.exp(-t / tau)


def place(mix, clip, at, gain=1.0, pan=0.0):
    """Add a mono or stereo clip into the mix at time `at` (seconds)."""
    if clip.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        clip = np.stack([clip * l * 1.414, clip * r * 1.414], axis=1)
    i = int(round(at * SR))
    j = min(len(mix), i + len(clip))
    if j > max(i, 0):
        mix[max(i, 0):j] += gain * clip[max(0, -i):j - i]


def noise(n, seed):
    return np.random.default_rng(seed).standard_normal(n)


def sweep_noise(dur, f0, f1, seed, q=1.2):
    """Noise through a band-pass that slides from f0 to f1: a whoosh."""
    n = int(dur * SR)
    x = noise(n, seed)
    out = np.zeros(n)
    blocks = 64
    edges = np.linspace(0, n, blocks + 1).astype(int)
    zi = None
    for k in range(blocks):
        fc = f0 * (f1 / f0) ** ((k + 0.5) / blocks)
        lo, hi = fc / (1 + 1 / q), min(fc * (1 + 1 / q), SR / 2 - 100)
        b, a = signal.butter(2, [lo, hi], btype="band", fs=SR)
        if zi is None:
            zi = signal.lfilter_zi(b, a) * 0
        seg, zi = signal.lfilter(b, a, x[edges[k]:edges[k + 1]], zi=zi)
        out[edges[k]:edges[k + 1]] = seg
    return out / (np.abs(out).max() + 1e-9)


def riser(dur, f0, f1, seed):
    n = int(dur * SR)
    t = np.arange(n) / SR
    shape = (t / dur) ** 2.2
    return sweep_noise(dur, f0, f1, seed) * shape


def swish(dur, f0, f1, seed):
    n = int(dur * SR)
    t = np.linspace(0, 1, n)
    return sweep_noise(dur, f0, f1, seed, q=1.6) * np.sin(np.pi * t) ** 2


def reverb(x, seconds=2.2, damp=4000, seed=7, wet=0.35, predelay=0.018):
    """A plate-ish tail: decaying, darkened noise, different in each ear."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.stack([noise(n, seed), noise(n, seed + 1)], axis=1) * np.exp(-t * 6.9 / seconds)[:, None]
    b, a = signal.butter(2, damp, fs=SR)
    ir = signal.lfilter(b, a, ir, axis=0)
    ir = np.concatenate([np.zeros((int(predelay * SR), 2)), ir])
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    y = np.stack([signal.fftconvolve(x[:, c], ir[:, c]) for c in range(2)], axis=1)
    out = np.zeros_like(y)
    out[:len(x)] += x * (1 - wet)
    return out + y * wet


def impact(seed=11):
    n = int(2.4 * SR)
    t = np.arange(n) / SR
    f = 34 + (92 - 34) * np.exp(-t / 0.09)                       # the boom, falling in pitch
    boom = np.tanh(1.6 * np.sin(2 * np.pi * np.cumsum(f) / SR)) * env_exp(n, 0.62, 0.002)
    fk = 48 + (170 - 48) * np.exp(-t / 0.025)                    # the punch on top
    kick = np.sin(2 * np.pi * np.cumsum(fk) / SR) * env_exp(n, 0.13, 0.001)
    nz = noise(n, seed)
    b, a = signal.butter(2, [900, 9000], btype="band", fs=SR)
    crack = signal.lfilter(b, a, nz) * env_exp(n, 0.035, 0.0005)
    b, a = signal.butter(2, 3500, btype="high", fs=SR)
    air = signal.lfilter(b, a, noise(n, seed + 3)) * env_exp(n, 0.55, 0.004) * 0.25
    b, a = signal.butter(2, 380, fs=SR)
    thud = signal.lfilter(b, a, noise(n, seed + 5)) * env_exp(n, 0.12, 0.001) * 2.2
    x = 1.35 * boom + 0.9 * kick + 0.45 * crack + air + 1.3 * thud
    return reverb(x / np.abs(x).max(), seconds=2.6, damp=5000, wet=0.28)


def bell(freq, dur=3.2, seed=0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    idx = 2.4 * np.exp(-t / 0.22)                                # bright strike, mellowing
    body = np.sin(2 * np.pi * freq * t + idx * np.sin(2 * np.pi * 2 * freq * t)) * env_exp(n, 1.25, 0.004)
    shimmer = 0.22 * np.sin(2 * np.pi * 2.756 * freq * t) * env_exp(n, 0.34, 0.002)
    tine = 0.1 * np.sin(2 * np.pi * 5.404 * freq * t) * env_exp(n, 0.1, 0.001)
    return body + shimmer + tine


def pad(freqs, dur, attack=0.5, release=1.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for k, f in enumerate(freqs):
        for det in (-0.12, 0.12):                                # two slightly detuned voices per note
            ph = np.random.default_rng(k).uniform(0, 6.28)
            x += np.sin(2 * np.pi * f * (1 + det / 100) * t + ph) + 0.18 * np.sin(4 * np.pi * f * t + ph)
    shape = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / release)
    b, a = signal.butter(2, 2200, fs=SR)
    return signal.lfilter(b, a, x * shape) / len(freqs)


def tape_stop(music, start, dur):
    """Slow the music to a halt over `dur` seconds from `start`, like a record being stopped."""
    n = int(dur * SR)
    tau = np.arange(n) / SR
    pos = (start + tau - tau ** 2 / (2 * dur)) * SR
    i0 = np.clip(np.floor(pos).astype(int), 0, len(music) - 2)
    fr = (pos - i0)[:, None]
    seg = music[i0] * (1 - fr) + music[i0 + 1] * fr
    # it gets darker as it slows
    out = np.zeros_like(seg)
    y = np.zeros(2)
    for k in range(n):
        fc = 14000 * (1 - tau[k] / dur) ** 2.5 + 180
        a = np.exp(-2 * np.pi * fc / SR)
        y = (1 - a) * seg[k] + a * y
        out[k] = y
    return out * np.clip((1 - tau / dur) * 3.2, 0, 1)[:, None]


def make(mp3, wav, ff, music, beat, drop, slam, end, shots):
    total = int(round(end * SR))
    mix = np.zeros((total, 2))
    # the track, from two bars before the groove, braking to a stop on the last beat
    m = load(mp3, ff, music["bar2"], slam + 0.5)
    stop_at = slam - beat
    body = m[:int(stop_at * SR)].copy()
    body[:int(0.03 * SR)] *= np.linspace(0, 1, int(0.03 * SR))[:, None]
    brake = tape_stop(m, stop_at, beat)
    track = np.concatenate([body, brake])
    place(mix, track, 0, gain=0.8)
    # into the drop: a riser as the camera flies through the full stop
    place(mix, riser(0.5, 350, 7000, 1), drop - 0.5, gain=0.22)
    # the whip, left to right as the picture flies left
    for i, s in enumerate(shots):
        a = drop + 2 * i * beat
        if s["trans"] == "whip":
            w = swish(0.34, 700, 5200, 20 + i)
            n = len(w)
            pan = np.linspace(0.8, -0.8, n)
            place(mix, np.stack([w * np.cos((pan + 1) * np.pi / 4), w * np.sin((pan + 1) * np.pi / 4)], axis=1) * 1.4, a - 0.17, gain=0.2)
        elif s["trans"] in ("strips", "diag", "frame"):
            place(mix, swish(0.28, 1200, 4200, 30 + i), a - 0.12, gain=0.07)
    flag = drop + 2 * len(shots) * beat
    place(mix, swish(0.5, 250, 2400, 40), flag - 0.16, gain=0.12)         # the card rising
    place(mix, swish(0.45, 400, 3200, 41), flag + beat - 0.1, gain=0.1)   # and opening
    cta = flag + 4 * beat
    place(mix, swish(0.4, 300, 3000, 42), cta - 0.16, gain=0.1)           # the page wiping up
    # the logo: a riser as the bars fall, the impact as it lands, then the chime
    place(mix, riser(0.62, 220, 9000, 3), slam - 0.62, gain=0.3)
    place(mix, impact(), slam, gain=1.7)
    notes = [(587.33, 0.28, -0.35), (783.99, 0.44, -0.1), (987.77, 0.60, 0.15), (1174.66, 0.92, 0.35)]
    chime = np.zeros((int((end - slam + 3) * SR), 2))
    for f, at, pan in notes:
        place(chime, bell(f, 3.6), at, gain=0.3 if f < 1100 else 0.36, pan=pan)
    # a soft echo on the chime, a dotted eighth apart
    d = int(beat * 0.75 * SR)
    echo = np.zeros_like(chime)
    echo[d:] += chime[:-d] * 0.32
    echo[2 * d:] += chime[:-2 * d] * 0.12
    place(mix, reverb(chime + echo, seconds=3.0, damp=7000, wet=0.4), slam, gain=1.0)
    place(mix, reverb(pad([98.0, 146.83, 196.0, 246.94, 293.66, 440.0], end - slam - 0.05, attack=0.35, release=1.3),
                      seconds=3.0, wet=0.5), slam + 0.1, gain=0.34)
    # finish: a short fade, then master to -14 LUFS with a limiter at -1.5 dBFS on top
    f = int(0.35 * SR)
    mix[-f:] *= np.linspace(1, 0, f)[:, None] ** 2
    mix *= 10 ** ((-14.0 - loudness(mix, ff)) / 20)
    mix = limiter(mix, 10 ** (-1.5 / 20))
    mix *= 10 ** ((-14.0 - loudness(mix, ff)) / 20)          # the limiter took a little off; put it back
    mix = limiter(mix, 10 ** (-1.5 / 20))
    write(wav, mix)


def write(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())


def loudness(x, ff):
    """Integrated loudness (LUFS), measured by ffmpeg's EBU R128 meter."""
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        write(tmp.name, np.clip(x / max(1.0, np.abs(x).max()), -1, 1))
        scale = 20 * np.log10(max(1.0, np.abs(x).max()))
        out = subprocess.run([ff, "-hide_banner", "-i", tmp.name, "-af", "loudnorm=print_format=json", "-f", "null", "-"],
                             capture_output=True, text=True).stderr
    return float(json.loads(out[out.rindex("{"):out.rindex("}") + 1])["input_i"]) + scale


def limiter(x, ceiling, hold=0.003, smooth=0.012):
    """Look-ahead peak limiter: hold the gain down around each peak, then ease it back."""
    g = np.minimum(1.0, ceiling / np.maximum(np.abs(x).max(axis=1), 1e-9))
    k = int(smooth * SR)
    g = minimum_filter1d(g, size=int(2 * hold * SR) + 2 * k + 1)
    win = np.hanning(2 * k + 1)
    g = np.convolve(g, win / win.sum(), mode="same")
    return np.clip(x * g[:, None], -ceiling, ceiling)


def mux(video, wav, out, ff):
    """The frames and the mastered sound in one MP4, ready to upload."""
    subprocess.run([ff, "-y", "-loglevel", "error", "-i", str(video), "-i", str(wav), "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000",
                    "-shortest", "-movflags", "+faststart", str(out)], check=True)
