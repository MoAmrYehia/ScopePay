#!/usr/bin/env python3
"""Synthesises the demo narration with the Kokoro-82M text-to-speech model.

Self-contained inference: espeak-ng for phonemes, onnxruntime for the model.
It reads three data files and runs no third-party code:

  --model   Kokoro v1.0 ONNX model (inputs: tokens, style, speed)
  --vocab   vocab.json mapping phoneme symbols to token ids
  --voice   a Kokoro voice file: 510 x 256 float32 style vectors (e.g. af_heart.bin)

Usage:
  python3 scripts/kokoro-voiceover.py --model kokoro.onnx --vocab vocab.json \
      --voice af_heart.bin --script scripts/demo-narration.json --out vo/

Writes <cue>.wav per line (24 kHz mono) and durations.json (cue -> seconds).
"""
import argparse
import json
import re
import subprocess
import wave
from pathlib import Path

import numpy as np
import onnxruntime as ort

SAMPLE_RATE = 24000
PUNCT = ';:,.!?—…'

# espeak-ng IPA -> the phoneme set Kokoro was trained on (American English).
E2M = sorted({
    'ʔˌn̩': 'tn', 'ʔn̩': 'tn', 'ʔn': 'tn', 'ʔ': 't',
    'a^ɪ': 'I', 'a^ʊ': 'W', 'e^ɪ': 'A', 'ɔ^ɪ': 'Y', 'o^ʊ': 'O',
    'd^ʒ': 'ʤ', 't^ʃ': 'ʧ',
    'e': 'A', 'r': 'ɹ', 'x': 'k', 'ç': 'k', 'ɐ': 'ə', 'ɬ': 'l',
    'ə^l': 'ᵊl', 'ɚ': 'əɹ', '̃': '',
}.items(), key=lambda kv: -len(kv[0]))

# Spellings that read better, applied before phonemising.
SPELLINGS = [
    (r'\bScopePay\b', 'Scope Pay'),
    (r'\bCSV\b', 'C S V'),
    (r'\bninety-five\b', 'ninety five'),
]

# Words espeak-ng gets wrong in this script, given directly as Kokoro phonemes.
PRONUNCIATIONS = {
    'AI': 'ˌAˈI',              # not "uh eye"
    'AG Grid': 'ˌAʤˈi ɡɹˈɪd',  # not "uh gee grid"
    'uploads': 'ʌplˈOdz',      # the verb, not the noun
}


def espeak(text: str) -> str:
    out = subprocess.run(['espeak-ng', '-q', '--ipa', '--tie=^', '-v', 'en-us', text],
                         capture_output=True, text=True, check=True).stdout
    return ' '.join(out.split())


def phonemize(text: str) -> str:
    for pattern, spoken in SPELLINGS:
        text = re.sub(pattern, spoken, text)
    text = text.replace('’', "'")
    fixed = '|'.join(re.escape(k) for k in sorted(PRONUNCIATIONS, key=len, reverse=True))
    parts = re.split(rf'(\b(?:{fixed})\b|[{re.escape(PUNCT)}])', text)
    out = []
    for part in parts:
        if not part.strip():
            continue
        if part in PUNCT:
            out.append(part + ' ')
            continue
        if part in PRONUNCIATIONS:
            out.append(f' {PRONUNCIATIONS[part]} ')
            continue
        ps = espeak(part.strip())
        for old, new in E2M:
            ps = ps.replace(old, new)
        ps = re.sub(r'(\S)̩', r'ᵊ\1', ps).replace('̩', '')
        ps = ps.replace('ɜːɹ', 'ɜɹ').replace('ɜː', 'ɜɹ').replace('ɪə', 'iə').replace('ː', '').replace('^', '')
        ps = ps.replace('ɹɹ', 'ɹ')  # espeak's linking r after "-er"
        ps = ps.replace('oɹ', 'ɔɹ').replace('ɪˌO', 'iˌO')  # "four", "portfolio"
        # espeak glues "the" onto the word before it ("for the" -> "fəɹðə"); Kokoro wants separate words.
        ps = re.sub(r'(?<=\S)(ð[əɪ])(?=\s|$)', r' \1', ps)
        ps = re.sub(r'(^|\s)ðɪ(?=\s|$)', r'\1ði', ps)  # "the" before a vowel
        out.append(' ' + ps + ' ')
    ps = re.sub(r'\s+', ' ', ''.join(out))
    ps = re.sub(r'(^|\s)ðˈ?ə(?= [ˌˈ]?[AIOWYæɑɛɪʌəiuɔ])', r'\1ði', ps)  # "the AI"
    ps = re.sub(r'(^|\s)ðˈə(?=\s)', r'\1ðə', ps)
    return re.sub(r'\s+([;:,.!?—…])', r'\1', ps).strip()


def trim(audio, threshold=0.01, pad=int(0.04 * SAMPLE_RATE)):
    idx = np.where(np.abs(audio) > threshold)[0]
    return audio if len(idx) == 0 else audio[max(0, idx[0] - pad): idx[-1] + pad]


def main():
    ap = argparse.ArgumentParser()
    for name in ('model', 'vocab', 'voice', 'script', 'out'):
        ap.add_argument(f'--{name}', required=True)
    ap.add_argument('--speed', type=float, default=1.0)
    args = ap.parse_args()

    vocab = json.loads(Path(args.vocab).read_text(encoding='utf-8'))['vocab']
    style = np.fromfile(args.voice, dtype=np.float32).reshape(-1, 256)
    session = ort.InferenceSession(args.model, providers=['CPUExecutionProvider'])
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    durations = {}
    for line in json.loads(Path(args.script).read_text(encoding='utf-8')):
        phonemes = phonemize(line['text'])
        unknown = sorted({c for c in phonemes if c not in vocab})
        tokens = [vocab[c] for c in phonemes if c in vocab]
        assert len(tokens) <= 500, f"{line['cue']}: too long for one pass"
        audio = session.run(None, {
            'tokens': np.array([[0, *tokens, 0]], dtype=np.int64),
            'style': style[min(len(tokens), len(style) - 1)].reshape(1, 256),
            'speed': np.array([args.speed], dtype=np.float32),
        })[0]
        audio = trim(np.asarray(audio, np.float32).ravel())
        # Even out loudness between lines: same RMS for each, without clipping.
        rms = float(np.sqrt(np.mean(audio ** 2))) or 1.0
        audio = audio * min(0.09 / rms, 0.95 / float(np.abs(audio).max()))
        with wave.open(str(out_dir / f"{line['cue']}.wav"), 'wb') as f:
            f.setnchannels(1)
            f.setsampwidth(2)
            f.setframerate(SAMPLE_RATE)
            f.writeframes((np.clip(audio, -1, 1) * 32767).astype('<i2').tobytes())
        durations[line['cue']] = round(len(audio) / SAMPLE_RATE, 2)
        print(f"{line['cue']:15s} {durations[line['cue']]:5.2f}s  peak {np.abs(audio).max():.2f}  {phonemes}" + (f"  UNKNOWN {unknown}" if unknown else ''))

    (out_dir / 'durations.json').write_text(json.dumps(durations, indent=2))
    print(f"total speech {sum(durations.values()):.1f}s")


if __name__ == '__main__':
    main()
