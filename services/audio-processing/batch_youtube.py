"""
Baixa musicas do YouTube em lote (playlist, video avulso ou busca) e passa
cada uma no pipeline IA (Demucs+pyin+Whisper): a voz e removida e sai o
pacote completo de karaoke (instrumental + melodia de referencia + letra
sincronizada) em apps/api/media/.

Uso:
  python batch_youtube.py <URL-playlist-ou-video> [<URL2> ...]
  python batch_youtube.py "ytsearch1:artista nome da musica"
  opcoes: --language pt   idioma da letra para o Whisper (senao detecta)
          --limit N       processa no maximo N videos da playlist

Os MP3 baixados ficam em input/youtube/ (cache: nao baixa de novo).
Musicas ja importadas (json existente em apps/api/media) sao puladas;
para reimportar, apague o json correspondente.

Requisitos: pip install yt-dlp imageio-ffmpeg (o ffmpeg do sistema e
usado se existir no PATH; senao entra o binario do imageio-ffmpeg).

IMPORTANTE: este fluxo e para estudo de viabilidade em uso pessoal.
Baixar do YouTube viola os Termos de Servico da plataforma e faixas
comerciais sao protegidas por direitos autorais — nada vindo daqui pode
entrar no catalogo do produto (mesma regra do batch_local.py); o campo
attribution marca isso explicitamente.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

from pipeline import find_ffmpeg

# titulos de video trazem qualquer unicode; o console/arquivo de log no
# Windows nasce cp1252 e um print com acento combinado derruba o lote
for stream in (sys.stdout, sys.stderr):
    if stream and hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
INPUT = HERE / "input" / "youtube"
MEDIA = HERE.parents[1] / "apps" / "api" / "media"
# ids de video ja processados (ok ou pulado): re-execucoes em playlists
# grandes ficam baratas — sem 1 consulta de metadados por video ja feito
ARCHIVE = INPUT / "processed.txt"


def slugify(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:60] or "musica"


def title_artist(info: dict) -> tuple[str, str]:
    """
    Melhor palpite de (titulo, artista) a partir dos metadados do yt-dlp.
    Videos de musica costumam trazer track/artist; senao cai no padrao
    "Artista - Titulo" do nome do video, e por ultimo no canal.
    """
    title = (info.get("track") or "").strip()
    artist = (info.get("artist") or info.get("creator") or "").strip()
    raw_title = (info.get("title") or "").strip()
    uploader = re.sub(r"\s*-\s*Topic$", "", (info.get("uploader") or "").strip())

    if not title:
        if not artist and " - " in raw_title:
            artist, _, title = (p.strip() for p in raw_title.partition(" - "))
        else:
            title = raw_title
    if not artist:
        artist = uploader or "Desconhecido"
    # limpa sufixos comuns de video que nao fazem parte do titulo
    title = re.sub(
        r"\s*[\(\[](official\s+)?(music\s+)?(video|audio|lyric[s]?( video)?|hd|4k)[\)\]]\s*$",
        "",
        title,
        flags=re.IGNORECASE,
    ).strip() or raw_title
    return title, artist


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Baixa musicas do YouTube e importa via pipeline IA"
    )
    ap.add_argument("urls", nargs="+", help="playlist, video ou ytsearchN:termos")
    ap.add_argument("--language", default=None, help="idioma da letra (en, pt, ...)")
    ap.add_argument("--limit", type=int, default=None, help="maximo de videos")
    args = ap.parse_args()

    try:
        import yt_dlp
    except ImportError:
        sys.exit("yt-dlp nao instalado: pip install yt-dlp")

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        sys.exit("ffmpeg nao encontrado: instale no PATH ou pip install imageio-ffmpeg")

    INPUT.mkdir(parents=True, exist_ok=True)

    common = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
    }

    # 1) lista os videos sem baixar (playlists viram entradas rasas)
    entries: list[dict] = []
    with yt_dlp.YoutubeDL({**common, "extract_flat": "in_playlist"}) as ydl:
        for url in args.urls:
            try:
                info = ydl.extract_info(url, download=False)
            except Exception as e:  # noqa: BLE001
                print(f"FALHOU {url}: {e}")
                continue
            if info.get("_type") == "playlist":
                entries.extend(e for e in info.get("entries") or [] if e)
            else:
                entries.append(info)
    done_ids = set(ARCHIVE.read_text().split()) if ARCHIVE.exists() else set()
    total = len(entries)
    entries = [e for e in entries if e.get("id") not in done_ids]
    if args.limit:
        entries = entries[: args.limit]
    if not entries:
        print(f"nada novo: {total} video(s), todos ja processados")
        return
    if total != len(entries):
        print(f"{total} video(s) na lista, {total - len(entries)} ja processados antes")
    print(f"{len(entries)} video(s) para processar\n")

    def mark_done(video_id: str) -> None:
        with ARCHIVE.open("a", encoding="utf-8") as f:
            f.write(video_id + "\n")

    meta_ydl = yt_dlp.YoutubeDL(common)
    dl_ydl = yt_dlp.YoutubeDL(
        {
            **common,
            "noprogress": False,
            "format": "bestaudio/best",
            "outtmpl": str(INPUT / "%(id)s.%(ext)s"),
            "ffmpeg_location": ffmpeg,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "0",
                }
            ],
        }
    )

    ok, skipped, fail = 0, 0, []
    for i, entry in enumerate(entries, 1):
        video_url = entry.get("webpage_url") or entry.get("url") or entry["id"]
        try:
            info = meta_ydl.extract_info(video_url, download=False)
        except Exception as e:  # noqa: BLE001
            fail.append(video_url)
            print(f"FALHOU {video_url}: {e}")
            continue

        title, artist = title_artist(info)
        slug = slugify(f"{artist}-{title}")
        label = f"[{i}/{len(entries)}] {artist} - {title}"

        if (MEDIA / f"{slug}.json").exists():
            print(f"= {label} (ja importada)")
            skipped += 1
            mark_done(info["id"])
            continue

        mp3 = INPUT / f"{info['id']}.mp3"
        try:
            if mp3.exists():
                print(f"> {label}: mp3 em cache")
            else:
                print(f"> {label}: baixando audio...")
                dl_ydl.download([info["webpage_url"]])
                if not mp3.exists():
                    raise FileNotFoundError(f"download nao gerou {mp3.name}")

            print(f"> {label}: pipeline (Demucs+pyin+Whisper, ~minutos em CPU)")
            cmd = [
                sys.executable, str(HERE / "pipeline.py"),
                "--original", str(mp3),
                "--id", slug,
                "--title", title,
                "--artist", artist,
                "--attribution",
                f"YouTube ({info['webpage_url']}) — uso pessoal/estudo, "
                "não licenciada para uso comercial",
            ]
            if args.language:
                cmd += ["--language", args.language]
            subprocess.run(cmd, check=True)
            ok += 1
            mark_done(info["id"])
        except Exception as e:  # noqa: BLE001
            fail.append(f"{artist} - {title}")
            print(f"FALHOU {label}: {e}")

    print(f"\nYOUTUBE_DONE ok={ok} pulados={skipped} fail={len(fail)} {fail}")
    if ok:
        print("Reinicie a API (npm run dev:api) para as musicas entrarem no catalogo.")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
