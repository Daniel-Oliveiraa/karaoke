"""
Importa em lote o repositorio oficial de musicas Creative Commons do
UltraStar Deluxe (github.com/UltraStar-Deluxe/songs): baixa song.txt +
audio de cada pacote e roda o importador ultrastar.py.

Atencao a licenca: varios artistas do pacote (ex: Jonathan Coulton) usam
CC BY-NC (nao comercial) — otimo para desenvolvimento/teste, NAO para o
produto comercial sem revisao das licencas individuais (license.txt de
cada pacote).

Uso: python batch_ultrastar_cc.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
INPUT = HERE / "input" / "ultrastar"
MEDIA = HERE.parents[1] / "apps" / "api" / "media"

API = "https://api.github.com/repos/UltraStar-Deluxe/songs/contents/Creative%20Commons"
RAW = "https://raw.githubusercontent.com/UltraStar-Deluxe/songs/master/Creative Commons"


def fetch_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "jamroom-pipeline"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    req = urllib.request.Request(url, headers={"User-Agent": "jamroom-pipeline"})
    with urllib.request.urlopen(req) as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 16):
            f.write(chunk)


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:60]


def main() -> None:
    INPUT.mkdir(parents=True, exist_ok=True)
    folders = [it["name"] for it in fetch_json(API) if it["type"] == "dir"]
    print(f"{len(folders)} pacotes CC no repositorio")

    ok, fail = 0, []
    for folder in folders:
        slug = slugify(folder)
        if (MEDIA / f"{slug}.json").exists():
            print(f"= {slug} (ja importada)")
            ok += 1
            continue
        try:
            files = fetch_json(f"{API}/{urllib.parse.quote(folder)}")
            names = {f["name"] for f in files}
            audio_name = "audio.mp3" if "audio.mp3" in names else "audio.ogg"
            if "song.txt" not in names or audio_name not in names:
                raise FileNotFoundError(f"pacote sem song.txt/audio: {sorted(names)}")

            pkg = INPUT / slug
            pkg.mkdir(parents=True, exist_ok=True)
            base = f"{RAW}/{folder}"
            download(urllib.parse.quote(f"{base}/song.txt", safe=":/"), pkg / "song.txt")
            download(urllib.parse.quote(f"{base}/{audio_name}", safe=":/"), pkg / audio_name)

            artist = folder.split(" - ")[0]
            subprocess.run(
                [
                    sys.executable, str(HERE / "ultrastar.py"),
                    "--txt", str(pkg / "song.txt"),
                    "--audio", str(pkg / audio_name),
                    "--id", slug,
                    "--attribution",
                    f"{artist} — Creative Commons (UltraStar-Deluxe/songs; ver license.txt)",
                ],
                check=True,
            )
            ok += 1
        except Exception as e:  # noqa: BLE001 — segue para o proximo pacote
            fail.append(slug)
            print(f"FALHOU {slug}: {e}")

    print(f"\nBATCH_US_DONE ok={ok} fail={len(fail)} {fail}")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
