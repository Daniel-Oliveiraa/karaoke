"""
Substitui letras transcritas pelo Whisper por letras SINCRONIZADAS da
LRCLIB (lrclib.net — base comunitaria aberta de letras em formato LRC,
com timestamp por linha), que sao muito mais precisas.

Uso:
  python fix_lyrics.py            # corrige todo o catalogo elegivel
  python fix_lyrics.py --id knock # so uma musica
  python fix_lyrics.py --force    # re-processa ate as ja corrigidas

Regras:
- Musicas UltraStar / importacao local sao PULADAS (a letra delas ja e
  exata, por silaba — substituir seria regressao).
- So substitui quando a LRCLIB tem letra sincronizada E a duracao bate
  (+-4s) — evita trocar pela versao ao vivo/remix errada.
- Original vai para lyrics_backup/<id>.json (uma vez; nunca sobrescrito).
- Ids corrigidos ficam em lyrics_backup/fixed.txt (re-runs pulam).

Licenciamento: letras tambem sao obra protegida; LRCLIB e uma base
comunitaria — mesmo enquadramento dos audios do batch_youtube (uso
pessoal). Catalogo comercial exige licenca de letra (ex: Musixmatch).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

for stream in (sys.stdout, sys.stderr):
    if stream and hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
MEDIA = HERE.parents[1] / "apps" / "api" / "media"
BACKUP = HERE / "lyrics_backup"
FIXED_LIST = BACKUP / "fixed.txt"

API = "https://lrclib.net/api"
USER_AGENT = "Kantai-personal-karaoke/0.1 (estudo pessoal)"
DURATION_TOLERANCE_S = 4
MIN_LINES = 4  # letra sincronizada com menos que isso e lixo/instrumental

LRC_TAG = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")


def http_get(path: str, params: dict[str, str | int]) -> object | None:
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.load(resp)
    except Exception:  # noqa: BLE001  (404 = sem match; rede = pula)
        return None


def clean_for_query(text: str) -> str:
    """Tira ruido de titulo de video: (Clipe Oficial), [DVD ...], aspas."""
    text = re.sub(r"[\(\[][^)\]]*[\)\]]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" -–|\"'“”")


def parse_lrc(synced: str, duration: float) -> list[dict]:
    """LRC → LyricLine[] (end = inicio da proxima linha)."""
    entries: list[tuple[float, str]] = []
    for raw in synced.splitlines():
        tags = list(LRC_TAG.finditer(raw))
        if not tags:
            continue
        text = LRC_TAG.sub("", raw).strip()
        if not text:
            continue
        for m in tags:
            t = int(m.group(1)) * 60 + float(m.group(2))
            entries.append((t, text))
    entries.sort(key=lambda e: e[0])
    lines = []
    for i, (start, text) in enumerate(entries):
        end = entries[i + 1][0] if i + 1 < len(entries) else min(start + 8, duration)
        end = min(end, duration)
        if end <= start:
            end = start + 1
        lines.append({"start": round(start, 3), "end": round(end, 3), "text": text})
    return lines


def find_synced(title: str, artist: str, duration: float) -> str | None:
    """Melhor letra sincronizada da LRCLIB para (titulo, artista, duracao)."""
    q_title = clean_for_query(title)
    q_artist = clean_for_query(artist)

    # 1) match exato (a API ja considera a duracao)
    hit = http_get(
        "get",
        {"track_name": q_title, "artist_name": q_artist, "duration": round(duration)},
    )
    if isinstance(hit, dict) and hit.get("syncedLyrics"):
        return hit["syncedLyrics"]

    # 2) busca fuzzy, filtrando por duracao proxima e letra sincronizada
    for params in (
        {"track_name": q_title, "artist_name": q_artist},
        {"q": f"{q_artist} {q_title}"},
    ):
        results = http_get("search", params)
        if not isinstance(results, list):
            continue
        candidates = [
            r
            for r in results
            if r.get("syncedLyrics")
            and abs((r.get("duration") or 0) - duration) <= DURATION_TOLERANCE_S
        ]
        if candidates:
            best = min(candidates, key=lambda r: abs(r["duration"] - duration))
            return best["syncedLyrics"]
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Letras sincronizadas via LRCLIB")
    ap.add_argument("--id", help="corrigir so esta musica")
    ap.add_argument("--force", action="store_true", help="re-processa ja corrigidas")
    args = ap.parse_args()

    BACKUP.mkdir(exist_ok=True)
    fixed_ids = set(FIXED_LIST.read_text().split()) if FIXED_LIST.exists() else set()

    files = sorted(MEDIA.glob(f"{args.id}.json" if args.id else "*.json"))
    if not files:
        sys.exit("nenhuma musica encontrada")

    ok, skipped, miss = 0, 0, 0
    for f in files:
        song = json.loads(f.read_text(encoding="utf-8"))
        label = f"{song.get('artist', '?')} - {song.get('title', '?')}"
        attribution = song.get("attribution") or ""

        if re.search(r"ultrastar|importação local", attribution, re.IGNORECASE):
            skipped += 1
            continue
        if song["id"] in fixed_ids and not args.force:
            skipped += 1
            continue

        synced = find_synced(song["title"], song["artist"], song["durationSec"])
        time.sleep(0.4)  # gentileza com a API gratuita
        if not synced:
            miss += 1
            print(f"- {label}: sem letra sincronizada na LRCLIB")
            continue
        lines = parse_lrc(synced, song["durationSec"])
        if len(lines) < MIN_LINES:
            miss += 1
            print(f"- {label}: LRC com poucas linhas ({len(lines)}), mantendo Whisper")
            continue

        backup_file = BACKUP / f.name
        if not backup_file.exists():
            backup_file.write_text(
                json.dumps(song, ensure_ascii=False, indent=1), encoding="utf-8"
            )
        song["lines"] = lines
        f.write_text(json.dumps(song, ensure_ascii=False, indent=1), encoding="utf-8")
        with FIXED_LIST.open("a", encoding="utf-8") as fl:
            fl.write(song["id"] + "\n")
        ok += 1
        print(f"OK {label}: {len(lines)} linhas sincronizadas")

    print(f"\nLYRICS_DONE ok={ok} pulados={skipped} sem_match={miss}")
    if ok:
        print("Reinicie a API (npm run dev:api) para as letras novas valerem.")


if __name__ == "__main__":
    main()
