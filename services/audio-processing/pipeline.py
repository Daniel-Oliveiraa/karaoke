"""
JAMROOM - pipeline de ingestao de musicas reais.

Entrada:  faixa original COM voz (para extrair a referencia de afinacao)
          + faixa instrumental (a que toca na TV; se nao houver, o proprio
          Demucs gera uma a partir da original).
Saida:    <id>.json (formato Song de @jamroom/shared-types) + <id>.mp3
          copiados para apps/api/media/, de onde a API serve o catalogo.

Etapas (as mesmas do plano para o catalogo B2B):
  1. Demucs (htdemucs, two-stems) separa o vocal da faixa original;
  2. librosa.pyin extrai a curva de pitch (f0) do vocal isolado;
  3. a curva e segmentada em notas (grade MelodyNote) - octave-agnostic
     no client, entao pequenos erros de oitava do f0 nao quebram o score;
  4. faster-whisper transcreve o vocal com timestamps -> letra por linha;
  5. escreve o JSON + copia o instrumental para apps/api/media/.

Uso:
  python pipeline.py --original input/knock_vocal.mp3 \
      --instrumental input/knock_instrumental.mp3 \
      --id knock --title "Knock" --artist "Josh Woodward" \
      --genre "Folk rock" --language en \
      --attribution "Josh Woodward - CC BY 4.0 (joshwoodward.com)"
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = REPO_ROOT / "apps" / "api" / "media"

PALETTE = [
    ("#7C3AED", "#3B82F6"),
    ("#3B82F6", "#22C55E"),
    ("#D946EF", "#7C3AED"),
    ("#F97316", "#FACC15"),
    ("#14B8A6", "#3B82F6"),
]


def hz_to_midi(hz: np.ndarray) -> np.ndarray:
    return 69 + 12 * np.log2(hz / 440.0)


def find_ffmpeg() -> str | None:
    """ffmpeg do PATH ou o binario estatico do imageio-ffmpeg."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return None


def separate_vocals(original: Path, workdir: Path) -> Path:
    """Demucs two-stems -> retorna o caminho do vocals.wav."""
    print(f"[1/4] Demucs separando vocal de {original.name} (CPU, ~minutos)...")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "demucs",
            "--two-stems=vocals",
            "-n",
            "htdemucs",
            "-o",
            str(workdir),
            str(original),
        ],
        check=True,
    )
    out = workdir / "htdemucs" / original.stem / "vocals.wav"
    if not out.exists():
        raise FileNotFoundError(f"Demucs nao gerou {out}")
    return out


def extract_pitch(vocals_path: Path):
    """librosa.pyin no vocal isolado -> (times, f0, voiced_prob)."""
    import librosa

    print("[2/4] Extraindo curva de pitch (pyin)...")
    y, sr = librosa.load(str(vocals_path), sr=22050, mono=True)
    hop = 256  # ~86 quadros/s
    f0, _, voiced_prob = librosa.pyin(
        y,
        fmin=80.0,
        fmax=1000.0,
        sr=sr,
        hop_length=hop,
        frame_length=2048,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=hop)
    return times, f0, voiced_prob


def segment_notes(times, f0, voiced_prob, min_note_sec=0.15, max_gap_sec=0.12):
    """
    Converte a curva f0 em grade de notas MelodyNote:
    corta em silencios (> max_gap_sec) e em saltos de pitch (> 0.8 semitom
    da mediana corrente), descarta segmentos curtos, midi = mediana.
    """
    print("[3/4] Segmentando a curva em notas de referencia...")
    voiced = (~np.isnan(f0)) & (voiced_prob > 0.5)
    midi = np.full_like(f0, np.nan)
    midi[voiced] = hz_to_midi(f0[voiced])

    notes = []
    seg_start = None
    seg_vals: list[float] = []
    last_voiced_t = None

    def close_segment(end_t: float):
        nonlocal seg_start, seg_vals
        if seg_start is not None and seg_vals:
            dur = end_t - seg_start
            if dur >= min_note_sec:
                notes.append(
                    {
                        "start": round(float(seg_start), 3),
                        "duration": round(float(dur), 3),
                        "midi": round(float(np.median(seg_vals)), 2),
                    }
                )
        seg_start, seg_vals = None, []

    for t, m, v in zip(times, midi, voiced):
        if not v:
            if last_voiced_t is not None and t - last_voiced_t > max_gap_sec:
                close_segment(last_voiced_t)
            continue
        if seg_start is None:
            seg_start, seg_vals = float(t), [float(m)]
        else:
            if abs(m - np.median(seg_vals)) > 0.8:
                close_segment(last_voiced_t if last_voiced_t is not None else t)
                seg_start, seg_vals = float(t), [float(m)]
            else:
                seg_vals.append(float(m))
        last_voiced_t = float(t)

    if last_voiced_t is not None:
        close_segment(last_voiced_t)

    print(f"      {len(notes)} notas de referencia")
    return notes


def synced_lyrics(title: str, artist: str, duration: float):
    """
    Letra sincronizada da LRCLIB (comunitaria, timestamp por linha) —
    muito mais precisa que a transcricao do Whisper. None = sem match.
    """
    try:
        from fix_lyrics import MIN_LINES, find_synced, parse_lrc
    except ImportError:
        return None
    print("[4/4] Buscando letra sincronizada na LRCLIB...")
    synced = find_synced(title, artist, duration)
    if not synced:
        return None
    lines = parse_lrc(synced, duration)
    if len(lines) < MIN_LINES:
        return None
    print(f"      {len(lines)} linhas sincronizadas (LRCLIB)")
    return lines


def transcribe_lines(vocals_path: Path, language: str | None):
    """faster-whisper -> LyricLine[] (granularidade de segmento/linha)."""
    from faster_whisper import WhisperModel

    print("[4/4] Transcrevendo a letra (faster-whisper, modelo base)...")
    model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        str(vocals_path), language=language, vad_filter=True
    )
    lines = []
    for seg in segments:
        text = seg.text.strip()
        if text:
            lines.append(
                {
                    "start": round(seg.start, 3),
                    "end": round(seg.end, 3),
                    "text": text,
                }
            )
    print(f"      {len(lines)} linhas de letra")
    return lines


def estimate_bpm(audio_path: Path) -> int:
    import librosa

    y, sr = librosa.load(str(audio_path), sr=22050, mono=True, duration=90)
    tempo = librosa.beat.tempo(y=y, sr=sr)
    return int(round(float(np.atleast_1d(tempo)[0]))) or 100


def audio_duration(audio_path: Path) -> float:
    import librosa

    return float(librosa.get_duration(path=str(audio_path)))


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingestao de musica real do JAMROOM")
    ap.add_argument("--original", required=True, help="faixa COM voz (mp3/wav)")
    ap.add_argument("--instrumental", help="faixa karaoke; se omitida, o Demucs gera")
    ap.add_argument("--id", required=True, help="slug unico (ex: knock)")
    ap.add_argument("--title", required=True)
    ap.add_argument("--artist", required=True)
    ap.add_argument("--genre", default="Pop/Rock")
    ap.add_argument("--language", default=None, help="idioma da letra (en, pt, ...)")
    ap.add_argument("--attribution", default=None, help="credito da licenca (CC BY exige)")
    args = ap.parse_args()

    original = Path(args.original).resolve()
    if not original.exists():
        sys.exit(f"arquivo nao encontrado: {original}")

    MEDIA_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="jamroom-") as tmp:
        workdir = Path(tmp)
        vocals = separate_vocals(original, workdir)

        if args.instrumental:
            instrumental = Path(args.instrumental).resolve()
            if not instrumental.exists():
                sys.exit(f"instrumental nao encontrado: {instrumental}")
        else:
            # sem instrumental oficial: usa o acompanhamento do Demucs
            instrumental = workdir / "htdemucs" / original.stem / "no_vocals.wav"

        times, f0, voiced_prob = extract_pitch(vocals)
        notes = segment_notes(times, f0, voiced_prob)
        # letra: LRCLIB (sincronizada, exata) primeiro; Whisper como fallback
        lines = synced_lyrics(args.title, args.artist, audio_duration(original))
        if lines:
            try:
                from fix_lyrics import BACKUP, FIXED_LIST

                BACKUP.mkdir(exist_ok=True)
                with FIXED_LIST.open("a", encoding="utf-8") as fl:
                    fl.write(args.id + "\n")
            except ImportError:
                pass
        else:
            lines = transcribe_lines(vocals, args.language)

        # instrumental do Demucs sai em wav (~45MB/musica): comprime para
        # mp3 se houver ffmpeg, senao copia o wav mesmo
        ffmpeg = find_ffmpeg() if instrumental.suffix.lower() == ".wav" else None
        if ffmpeg:
            dest_audio = MEDIA_DIR / f"{args.id}.mp3"
            subprocess.run(
                [ffmpeg, "-y", "-i", str(instrumental),
                 "-codec:a", "libmp3lame", "-q:a", "2", str(dest_audio)],
                check=True,
                capture_output=True,
            )
        else:
            dest_audio = MEDIA_DIR / f"{args.id}{instrumental.suffix.lower()}"
            shutil.copyfile(instrumental, dest_audio)

        # genero real via iTunes quando ninguem informou (default generico)
        genre = args.genre
        if genre == "Pop/Rock":
            try:
                from fix_genres import itunes_genre

                genre = itunes_genre(args.title, args.artist) or genre
            except ImportError:
                pass

        colors = PALETTE[sum(ord(c) for c in args.id) % len(PALETTE)]
        song = {
            "id": args.id,
            "title": args.title,
            "artist": args.artist,
            "genre": genre,
            "bpm": estimate_bpm(original),
            "durationSec": round(audio_duration(instrumental), 3),
            "coverColors": list(colors),
            "audioUrl": f"/media/{dest_audio.name}",
            "attribution": args.attribution,
            "lines": lines,
            "notes": notes,
        }

        dest_json = MEDIA_DIR / f"{args.id}.json"
        dest_json.write_text(
            json.dumps(song, ensure_ascii=False, indent=1), encoding="utf-8"
        )

    print(f"\nOK: {dest_json}")
    print(f"    {dest_audio}")
    print("Reinicie a API (ou aguarde o watch) para a musica entrar no catalogo.")


if __name__ == "__main__":
    main()
