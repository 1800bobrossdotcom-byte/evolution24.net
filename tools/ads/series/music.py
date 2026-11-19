"""The series' soundtracks, made here from sine waves and noise, so they are ours to use freely.

Every ad is 15 seconds at 96 BPM: 24 beats, six bars. Under the pictures, a warm house-pop
loop (kick, clap, hats, bass, soft chords and a plucked arpeggio) in a key and progression of
its own, so the six ads do not sound alike; on top, sound for the motion: a swoosh on each
moving transition, a tick as each word or box lands, a riser into the end card, then a hit
and a three-note chime as it lands. Only numpy: filters are done in the frequency domain.

    make(path, cues, key="D", prog=0, drums=0, end_at=11.25, seconds=15)

cues: (seconds, kind) with kind in "whoosh", "tick", "pop", "hit".
"""
import wave

import numpy as np

SR = 48000
BPM = 96
BEAT = 60 / BPM
NOTES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
# Progressions in scale degrees (major key), each chord a bar and a half... no: one chord per bar.
PROGS = [
    [0, 5, 3, 4, 0, 0],     # I  vi IV V  I
    [0, 4, 5, 3, 0, 0],     # I  V  vi IV I
    [5, 3, 0, 4, 0, 0],     # vi IV I  V  I
    [3, 0, 4, 5, 3, 0],     # IV I  V  vi IV I
    [0, 3, 5, 4, 0, 0],     # I  IV vi V  I
    [0, 2, 3, 4, 0, 0],     # I  iii IV V I
]
SCALE = [0, 2, 4, 5, 7, 9, 11]


def hz(semis_from_a4):
    return 440.0 * 2 ** (semis_from_a4 / 12)


def chord(key, degree, octave=4, seventh=True):
    """MIDI-ish semitone offsets from A4 for a diatonic chord: root, third, fifth (and seventh)."""
    root = NOTES[key] - 9 + 12 * (octave - 4)
    steps = [0, 2, 4] + ([6] if seventh else [])
    out = []
    for s in steps:
        i = degree + s
        out.append(root + SCALE[i % 7] + 12 * (i // 7))
    return out


def env(n, attack=0.005, decay=0.3, sustain=0.0, release=None):
    t = np.arange(n) / SR
    a = np.minimum(1, t / max(attack, 1e-4))
    d = sustain + (1 - sustain) * np.exp(-t / decay)
    e = a * d
    if release:
        r = int(release * SR)
        e[-r:] *= np.linspace(1, 0, r) if r < n else 1
    return e


def bandpass(x, lo, hi):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    m = ((f >= lo) & (f <= hi)).astype(float)
    # soft edges
    m = np.convolve(m, np.hanning(64) / np.hanning(64).sum(), mode="same")
    return np.fft.irfft(X * m, n=len(x))


def tone(freq, dur, harmonics=(1.0,), detune=0.0):
    t = np.arange(int(dur * SR)) / SR
    out = np.zeros_like(t)
    for k, amp in enumerate(harmonics, 1):
        out += amp * np.sin(2 * np.pi * freq * k * t)
        if detune:
            out += amp * np.sin(2 * np.pi * freq * k * (1 + detune) * t + 1.3)
    return out


def place(mix, clip, at, gain=1.0, pan=0.0):
    if clip.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        clip = np.stack([clip * l * 1.414, clip * r * 1.414], axis=1)
    i = int(round(at * SR))
    j = min(len(mix), i + len(clip))
    if j > max(i, 0):
        mix[max(i, 0):j] += gain * clip[max(0, -i):j - i]


def reverb(x, seconds=1.8, mix=0.25, seed=1):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = rng.standard_normal(n) * np.exp(-t * 5.5 / seconds)
        ir = bandpass(ir, 120, 7000)
        ir /= np.sqrt((ir ** 2).sum())
        size = 1 << int(np.ceil(np.log2(len(x) + n)))
        wet = np.fft.irfft(np.fft.rfft(x[:, ch], size) * np.fft.rfft(ir, size), size)[:len(x)]
        out[:, ch] = wet
    return x * (1 - mix) + out * mix * 1.6


# ---------------------------------------------------------------- instruments
def kick():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 45 + 95 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(n, 0.001, 0.16) + 0.25 * np.random.default_rng(3).standard_normal(n) * env(n, 0.0005, 0.004)


def clap(seed=4):
    n = int(0.3 * SR)
    rng = np.random.default_rng(seed)
    x = bandpass(rng.standard_normal(n), 900, 6000)
    e = np.zeros(n)
    for k, d in enumerate((0, 0.011, 0.022)):            # three quick hands, then the tail
        i = int(d * SR)
        e[i:] += env(n - i, 0.001, 0.012 if k < 2 else 0.11)
    return x * e * 0.9 + 0.2 * tone(190, 0.3) * env(n, 0.001, 0.05)


def hat(open_=False, seed=5):
    n = int((0.25 if open_ else 0.06) * SR)
    x = bandpass(np.random.default_rng(seed).standard_normal(n), 6500, 16000)
    return x * env(n, 0.0005, 0.09 if open_ else 0.018)


def bass_note(semi, dur):
    f = hz(semi)
    n = int(dur * SR)
    x = tone(f, dur, (1.0, 0.35, 0.12))
    return x * env(n, 0.006, 0.5, 0.55, release=0.04)


def pad(semis, dur):
    n = int(dur * SR)
    out = np.zeros(n)
    for s in semis:
        f = hz(s)
        out += tone(f, dur, (1, 0.5, 0.33, 0.22, 0.14), detune=0.004)
    e = env(n, 0.25, 9.0, 1.0, release=min(0.4, dur / 3))
    return bandpass(out * e, 80, 3200) * 0.16


def pluck(semi, dur=0.35):
    n = int(dur * SR)
    return tone(hz(semi), dur, (1, 0.45, 0.2, 0.1)) * env(n, 0.002, 0.11)


def bell(semi, dur=1.6):
    f = hz(semi)
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.9) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t / 0.35)
         + 0.2 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t / 0.15))
    return x * np.minimum(1, t / 0.002)


# ---------------------------------------------------------------- sound for the motion
def whoosh(seed, dur=0.55):
    n = int(dur * SR)
    rng = np.random.default_rng(seed)
    t = np.arange(n) / SR
    x = bandpass(rng.standard_normal(n), 250, 7000)
    peak = 0.62
    e = np.where(t < dur * peak, (t / (dur * peak)) ** 2.2, np.exp(-(t - dur * peak) / 0.07))
    sweep = np.sin(2 * np.pi * np.cumsum(300 + 900 * t / dur) / SR) * 0.15
    mono = (x * 0.8 + sweep) * e
    pan = np.linspace(-0.7, 0.7, n)
    return np.stack([mono * np.cos((pan + 1) * np.pi / 4), mono * np.sin((pan + 1) * np.pi / 4)], axis=1) * 1.3


def tick():
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * (1500 - 4000 * t) * t) * env(n, 0.0005, 0.018)


def pop():
    n = int(0.16 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(900 - 500 * t / 0.16) / SR) * env(n, 0.001, 0.045)


def riser(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    k = t / dur
    noise = bandpass(np.random.default_rng(9).standard_normal(n), 400, 9000) * k ** 2.5 * 0.5
    sweep = np.sin(2 * np.pi * np.cumsum(180 + 900 * k ** 2) / SR) * k ** 2 * 0.25
    return noise + sweep


def boom():
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    low = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.5)
    crash = bandpass(np.random.default_rng(11).standard_normal(n), 2500, 15000) * np.exp(-t / 0.55) * 0.35
    return low + crash


# ---------------------------------------------------------------- the mix
def make(path, cues, key="D", prog=0, drums=0, end_at=11.25, seconds=15.0, seed=1):
    n = int(seconds * SR)
    music = np.zeros((n, 2))
    fx = np.zeros((n, 2))
    chords = PROGS[prog % len(PROGS)]
    bars = int(np.ceil(seconds / (4 * BEAT)))
    k_kick, k_clap = kick(), clap()
    for bar in range(bars):
        deg = chords[min(bar, len(chords) - 1)]
        t0 = bar * 4 * BEAT
        last = t0 >= end_at - 0.01
        # chords: a pad held for the bar
        place(music, pad(chord(key, deg, 4), 4 * BEAT + 0.3), t0, 0.9)
        if last:
            continue
        # drums: none in the first beat (the hook lands on silence and a hit), sparser in bar 1
        for b in range(4):
            tb = t0 + b * BEAT
            if tb >= end_at - 0.01:
                break
            if not (bar == 0 and b == 0):
                if drums == 1 and b in (0, 2) or drums != 1:
                    place(music, k_kick, tb, 0.95)
            if b in (1, 3) and bar > 0:
                place(music, k_clap, tb, 0.45, pan=0.05)
            for e in range(2 if drums == 2 else 4):              # hats: eighths or sixteenths
                th = tb + e * BEAT / (2 if drums == 2 else 4)
                if th < end_at - 0.05:
                    accent = 0.22 if e % 2 else 0.12
                    if drums != 2 and e == 2:
                        place(music, hat(True, seed=bar * 7 + b), th, 0.16, pan=0.3)
                    else:
                        place(music, hat(seed=bar * 13 + b * 5 + e), th, accent, pan=0.3)
        # bass: root on 1, and the and of 2, octave on 4
        root = chord(key, deg, 2, False)[0]
        for at, semi, dur in ((0, root, 1.4 * BEAT), (1.5 * BEAT, root, 0.9 * BEAT), (3 * BEAT, root + 12, 0.8 * BEAT)):
            if t0 + at < end_at - 0.05 and not (bar == 0 and at == 0):
                place(music, bass_note(semi, dur), t0 + at, 0.55)
        # pluck arpeggio in eighths, up the chord, from bar 2
        if bar >= 1:
            tones = chord(key, deg, 5)
            pattern = [0, 1, 2, 3, 2, 1, 2, 3] if prog % 2 else [0, 2, 1, 3, 0, 2, 3, 1]
            for e, idx in enumerate(pattern):
                ta = t0 + e * BEAT / 2
                if ta < end_at - 0.05:
                    place(music, pluck(tones[idx]), ta, 0.13, pan=-0.35 if e % 2 else 0.35)
    music = reverb(music, 1.6, 0.18, seed)
    # music ducks a little under the end card's hit, then rings out
    t = np.arange(n) / SR
    duck = 1 - 0.45 * np.clip((t - end_at) / 0.05, 0, 1) * np.exp(-np.clip(t - end_at, 0, None) / 0.6)
    music *= duck[:, None]

    rng = np.random.default_rng(seed)
    for at, kind in cues:
        if kind == "whoosh":
            place(fx, whoosh(int(rng.integers(1 << 30))), at - 0.34, 0.5)
        elif kind == "tick":
            place(fx, tick(), at, 0.28, pan=float(rng.uniform(-0.3, 0.3)))
        elif kind == "pop":
            place(fx, pop(), at, 0.35)
    # into the end card: riser, hit, chime
    place(fx, riser(1.25), end_at - 1.25, 0.55)
    place(fx, boom(), end_at, 0.8)
    place(fx, kick(), end_at, 0.9)
    tones = chord(key, 0, 5, False)
    for i, s in enumerate((tones[0], tones[1], tones[2] + 0)):
        place(fx, bell(s + 12), end_at + 0.35 + i * BEAT / 2, 0.22, pan=(i - 1) * 0.3)
    fx = reverb(fx, 1.2, 0.2, seed + 1)

    mix = music + fx
    # fade in a hair, fade out at the end
    mix[: int(0.01 * SR)] *= np.linspace(0, 1, int(0.01 * SR))[:, None]
    fo = int(0.8 * SR)
    mix[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
    mix = np.tanh(mix * 1.1) / np.tanh(1.1)
    mix /= max(1e-6, np.abs(mix).max()) / 0.89
    data = (mix * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    return path
