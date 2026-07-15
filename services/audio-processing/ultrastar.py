"""
Kantaí - importador de arquivos UltraStar (.txt).

O formato UltraStar (UltraStar Deluxe/Performous/Vocaluxe) traz tudo que o
Kantaí precisa, sem pipeline pesado: melodia nota a nota (com TOM, que
vira a referencia de afinacao do score) e letra sincronizada por silaba.

Uso:
  python ultrastar.py --txt caminho/song.txt --id code-monkey \
      [--audio caminho/audio.mp3] [--genre "Rock"] [--attribution "..."] \
      [--strip-vocals]

- --audio: se omitido, usa o #MP3 do cabecalho (relativo a pasta do txt).
- --strip-vocals: gera instrumental com Demucs (lento); por padrao usa o
  audio original com voz, como os jogos UltraStar fazem (voz-guia).

Formato (resumo):
  #BPM e dado em "quartos de batida": t_seg = GAP/1000 + beat * 60/(BPM*4)
  Tom: 0 = C4 (MIDI 60), pode ser negativo.
  Notas ":" normais, "*" golden (valem igual aqui), "F"/"R"/"G" sem tom
  (freestyle/rap - entram na letra, ficam fora da melodia).
  "- a [b]" quebra de linha; com #RELATIVE:YES os beats sao relativos e
  "b" avanca o offset.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

# ": beat duração tom sílaba" — um único espaço separa o tom da sílaba;
# espaços extras pertencem à sílaba (viram espaços na letra)
_NOTE_RE = re.compile(
    r"^[:\*FRG]\s+(-?\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(-?\d+(?:[.,]\d+)?) ?(.*)$"
)

REPO_ROOT = Path(__file__).resolve().parents[2]
MEDIA_DIR = REPO_ROOT / "apps" / "api" / "media"

PALETTE = [
    ("#7C3AED", "#3B82F6"),
    ("#3B82F6", "#22C55E"),
    ("#D946EF", "#7C3AED"),
    ("#F97316", "#FACC15"),
    ("#14B8A6", "#3B82F6"),
]


def read_text_any_encoding(path: Path) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return path.read_text(encoding=enc)
        except UnicodeDecodeError:
            continue
    raise ValueError(f"nao consegui decodificar {path}")


def parse_ultrastar(text: str):
    headers: dict[str, str] = {}
    notes = []       # {start, duration, midi} em segundos
    lines = []       # {start, end, text}
    cur_sylls: list[tuple[float, float, str]] = []  # (start, end, syll)

    bpm = None
    gap_ms = 0.0
    relative = False
    offset_beats = 0.0

    def beat_to_sec(beat: float) -> float:
        return gap_ms / 1000.0 + (offset_beats + beat) * 60.0 / (bpm * 4.0)

    def close_line():
        nonlocal cur_sylls
        if cur_sylls:
            text_line = "".join(s for _, _, s in cur_sylls).strip()
            if text_line:
                lines.append(
                    {
                        "start": round(cur_sylls[0][0], 3),
                        "end": round(cur_sylls[-1][1], 3),
                        "text": text_line,
                    }
                )
        cur_sylls = []

    for raw in text.splitlines():
        line = raw.rstrip("\r\n")
        if not line:
            continue

        if line.startswith("#"):
            key, _, value = line[1:].partition(":")
            headers[key.strip().upper()] = value.strip()
            continue

        if bpm is None:
            bpm = float(headers.get("BPM", "0").replace(",", "."))
            if bpm <= 0:
                raise ValueError("cabecalho #BPM invalido/ausente")
            gap_ms = float(headers.get("GAP", "0").replace(",", "."))
            relative = headers.get("RELATIVE", "").upper() == "YES"

        kind = line[0]
        if kind == "E":  # fim
            break

        if kind == "-":  # quebra de linha
            close_line()
            if relative:
                parts = line[1:].split()
                if len(parts) >= 2:
                    offset_beats += float(parts[1])
                elif len(parts) == 1:
                    offset_beats += float(parts[0])
            continue

        if kind in (":", "*", "F", "R", "G"):
            # os espaços à esquerda da sílaba fazem parte da letra — o
            # separador consome UM espaço e o resto é preservado como está
            m = _NOTE_RE.match(line)
            if not m:
                continue
            beat = float(m.group(1).replace(",", "."))
            length = float(m.group(2).replace(",", "."))
            pitch = int(float(m.group(3).replace(",", ".")))
            syll = (m.group(4) or "").replace("~", "")

            start = beat_to_sec(beat)
            end = beat_to_sec(beat + max(length, 0.5))
            cur_sylls.append((start, end, syll))

            # F/R/G nao tem tom cantavel — ficam fora da melodia de referencia
            if kind in (":", "*"):
                notes.append(
                    {
                        "start": round(start, 3),
                        "duration": round(end - start, 3),
                        "midi": 60 + pitch,
                    }
                )

    close_line()
    notes.sort(key=lambda n: n["start"])
    lines.sort(key=lambda l: l["start"])
    return headers, notes, lines


def main() -> None:
    ap = argparse.ArgumentParser(description="Importa UltraStar .txt para o catalogo")
    ap.add_argument("--txt", required=True)
    ap.add_argument("--id", required=True, help="slug unico (ex: code-monkey)")
    ap.add_argument("--audio", help="audio; padrao: #MP3 do cabecalho")
    ap.add_argument("--genre", default=None)
    ap.add_argument("--attribution", default=None)
    ap.add_argument("--strip-vocals", action="store_true",
                    help="gera instrumental com Demucs (lento)")
    args = ap.parse_args()

    txt_path = Path(args.txt).resolve()
    if not txt_path.exists():
        sys.exit(f"txt nao encontrado: {txt_path}")

    headers, notes, lines = parse_ultrastar(read_text_any_encoding(txt_path))
    if not notes:
        sys.exit("nenhuma nota com tom encontrada no arquivo")

    audio_path = (
        Path(args.audio).resolve()
        if args.audio
        else (txt_path.parent / headers.get("MP3", "")).resolve()
    )
    if not audio_path.exists():
        sys.exit(f"audio nao encontrado: {audio_path}")

    if args.strip_vocals:
        import subprocess
        import tempfile

        with tempfile.TemporaryDirectory(prefix="kantai-us-") as tmp:
            subprocess.run(
                [sys.executable, "-m", "demucs", "--two-stems=vocals",
                 "-n", "htdemucs", "-o", tmp, str(audio_path)],
                check=True,
            )
            no_vocals = Path(tmp) / "htdemucs" / audio_path.stem / "no_vocals.wav"
            MEDIA_DIR.mkdir(parents=True, exist_ok=True)
            dest_audio = MEDIA_DIR / f"{args.id}.wav"
            shutil.copyfile(no_vocals, dest_audio)
    else:
        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        dest_audio = MEDIA_DIR / f"{args.id}{audio_path.suffix.lower()}"
        shutil.copyfile(audio_path, dest_audio)

    import librosa

    duration = float(librosa.get_duration(path=str(dest_audio)))
    us_bpm = float(headers.get("BPM", "0").replace(",", "."))
    colors = PALETTE[sum(ord(c) for c in args.id) % len(PALETTE)]

    song = {
        "id": args.id,
        "title": headers.get("TITLE", args.id),
        "artist": headers.get("ARTIST", "?"),
        "genre": args.genre or headers.get("GENRE", "Karaokê"),
        "bpm": int(round(us_bpm / 4)) or 100,
        "durationSec": round(duration, 3),
        "coverColors": list(colors),
        "audioUrl": f"/media/{dest_audio.name}",
        "attribution": args.attribution,
        "lines": lines,
        "notes": notes,
    }

    dest_json = MEDIA_DIR / f"{args.id}.json"
    dest_json.write_text(json.dumps(song, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"OK: {song['artist']} - {song['title']}")
    print(f"    {len(notes)} notas, {len(lines)} linhas, {duration:.0f}s")
    print(f"    {dest_json}")


if __name__ == "__main__":
    main()
