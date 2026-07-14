"""
Enriquece o genero das musicas do catalogo via iTunes Search API (gratis,
sem chave; generos em pt-BR com country=BR: Sertanejo, MPB, Pagode...).
O pipeline preenche "Pop/Rock" por padrao — este script corrige.

Uso:
  python fix_genres.py            # todas com genero generico
  python fix_genres.py --id knock # so uma musica
  python fix_genres.py --force    # re-processa ate as ja corrigidas

Ids corrigidos ficam em lyrics_backup/genres_fixed.txt (re-runs pulam).
Rate limit da API ~20 req/min — sleep de 3s entre chamadas.
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
FIXED_LIST = HERE / "lyrics_backup" / "genres_fixed.txt"

# generos que sao default/placeholder, nao informacao real
GENERIC = {"pop/rock", "karaokê", "karaoke", ""}


def clean_term(text: str) -> str:
    text = re.sub(r"[\(\[][^)\]]*[\)\]]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def itunes_genre(title: str, artist: str) -> str | None:
    """primaryGenreName da melhor correspondencia no iTunes (ou None)."""
    term = clean_term(f"{artist} {title}")
    url = "https://itunes.apple.com/search?" + urllib.parse.urlencode(
        {"term": term, "media": "music", "limit": 1, "country": "BR"}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "JAMROOM/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
        results = data.get("results") or []
        genre = results[0].get("primaryGenreName") if results else None
        return genre.strip() if genre else None
    except Exception:  # noqa: BLE001
        return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Generos reais via iTunes Search API")
    ap.add_argument("--id", help="corrigir so esta musica")
    ap.add_argument("--force", action="store_true", help="re-processa ja corrigidas")
    args = ap.parse_args()

    FIXED_LIST.parent.mkdir(exist_ok=True)
    fixed_ids = set(FIXED_LIST.read_text().split()) if FIXED_LIST.exists() else set()

    files = sorted(MEDIA.glob(f"{args.id}.json" if args.id else "*.json"))
    if not files:
        sys.exit("nenhuma musica encontrada")

    ok, skipped, miss = 0, 0, 0
    for f in files:
        song = json.loads(f.read_text(encoding="utf-8"))
        label = f"{song.get('artist', '?')} - {song.get('title', '?')}"
        current = (song.get("genre") or "").strip().lower()

        if song["id"] in fixed_ids and not args.force:
            skipped += 1
            continue
        if current not in GENERIC and not args.force and not args.id:
            skipped += 1  # ja tem genero real (ex: UltraStar bem preenchido)
            continue

        genre = itunes_genre(song.get("title", ""), song.get("artist", ""))
        time.sleep(3)  # rate limit ~20/min
        if not genre:
            miss += 1
            print(f"- {label}: sem match no iTunes")
            continue

        song["genre"] = genre
        f.write_text(json.dumps(song, ensure_ascii=False, indent=1), encoding="utf-8")
        with FIXED_LIST.open("a", encoding="utf-8") as fl:
            fl.write(song["id"] + "\n")
        ok += 1
        print(f"OK {label}: {genre}")

    print(f"\nGENRES_DONE ok={ok} pulados={skipped} sem_match={miss}")
    if ok:
        print("Reinicie a API para os generos novos valerem.")


if __name__ == "__main__":
    main()
