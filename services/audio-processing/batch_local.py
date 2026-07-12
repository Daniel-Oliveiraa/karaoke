"""
Importa em lote pacotes UltraStar LOCAIS (estudo pessoal, em casa).

Estrutura esperada — uma pasta por musica dentro de input/ultrastar/:

  input/ultrastar/
    minha-musica-1/
      qualquer-nome.txt      (arquivo UltraStar)
      qualquer-audio.mp3     (ou .ogg/.wav; ou o nome do #MP3 do txt)
    minha-musica-2/
      ...

Uso: python batch_local.py

O id/titulo/artista saem dos cabecalhos do proprio txt. Pacotes ja
importados (json existente em apps/api/media) sao pulados; para
reimportar, apague o json correspondente.

IMPORTANTE: este fluxo e para estudo de viabilidade em uso pessoal.
Conteudo de terceiros importado por aqui NAO esta licenciado para o
produto — o campo attribution marca isso explicitamente e o catalogo
de producao deve vir do licenciamento B2B (ver CLAUDE.md).
"""

from __future__ import annotations

import re
import subprocess
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
INPUT = HERE / "input" / "ultrastar"
MEDIA = HERE.parents[1] / "apps" / "api" / "media"

AUDIO_EXTS = {".mp3", ".ogg", ".wav"}


def read_headers(txt: Path) -> dict[str, str]:
    headers: dict[str, str] = {}
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            for line in txt.read_text(encoding=enc).splitlines():
                if not line.startswith("#"):
                    break
                key, _, value = line[1:].partition(":")
                headers[key.strip().upper()] = value.strip()
            return headers
        except UnicodeDecodeError:
            continue
    return headers


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:60] or "musica"


def find_audio(folder: Path, headers: dict[str, str]) -> Path | None:
    mp3_header = headers.get("MP3")
    if mp3_header and (folder / mp3_header).exists():
        candidate = folder / mp3_header
        if candidate.suffix.lower() in AUDIO_EXTS:
            return candidate
    for f in sorted(folder.iterdir()):
        if f.suffix.lower() in AUDIO_EXTS:
            return f
    return None


def main() -> None:
    if not INPUT.exists():
        INPUT.mkdir(parents=True, exist_ok=True)
        print(f"Pasta criada: {INPUT}")
        print("Coloque uma subpasta por musica (txt + audio) e rode de novo.")
        return

    folders = [d for d in sorted(INPUT.iterdir()) if d.is_dir()]
    if not folders:
        print(f"Nenhum pacote em {INPUT} — crie uma subpasta por musica.")
        return

    ok, skipped, fail = 0, 0, []
    for folder in folders:
        txts = sorted(folder.glob("*.txt"))
        txt = next((t for t in txts if t.name.lower() != "license.txt"), None)
        if not txt:
            print(f"- {folder.name}: sem .txt, pulando")
            continue

        headers = read_headers(txt)
        artist = headers.get("ARTIST", folder.name)
        title = headers.get("TITLE", folder.name)
        slug = slugify(f"{artist}-{title}")

        # dedupe: cobre tanto o slug por cabecalho quanto o por nome de
        # pasta (usado pelo batch_ultrastar_cc), senao a mesma musica
        # entra duas vezes com ids diferentes
        folder_slug = slugify(folder.name)
        if (MEDIA / f"{slug}.json").exists() or (MEDIA / f"{folder_slug}.json").exists():
            print(f"= {artist} - {title} (ja importada)")
            skipped += 1
            continue

        audio = find_audio(folder, headers)
        if not audio:
            fail.append(folder.name)
            print(f"FALHOU {folder.name}: nenhum audio (.mp3/.ogg/.wav) na pasta")
            continue

        try:
            subprocess.run(
                [
                    sys.executable, str(HERE / "ultrastar.py"),
                    "--txt", str(txt),
                    "--audio", str(audio),
                    "--id", slug,
                    "--attribution",
                    "importação local — uso pessoal/estudo, não licenciada para uso comercial",
                ],
                check=True,
            )
            ok += 1
        except Exception as e:  # noqa: BLE001
            fail.append(folder.name)
            print(f"FALHOU {folder.name}: {e}")

    print(f"\nLOCAL_DONE ok={ok} pulados={skipped} fail={len(fail)} {fail}")
    if ok:
        print("Reinicie a API (npm run dev:api) para as musicas entrarem no catalogo.")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
