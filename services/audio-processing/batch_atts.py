"""
Processa em lote as faixas restantes do album "Addressed to the Stars"
(Josh Woodward, CC BY 4.0): baixa vocal + instrumental do Internet Archive
e roda o pipeline em cada uma. Knock (02) e Orbit (13) ja foram feitas.

Uso: python batch_atts.py
"""
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
INPUT = HERE / "input"
MEDIA = HERE.parents[1] / "apps" / "api" / "media"
VOCAL_ITEM = "pandacd-706-addressed-to-the-stars"
INSTR_ITEM = "cover_Josh_Woodward_-_Addressed_to_the_Stars"
ATTRIBUTION = "Josh Woodward - CC BY 4.0 (joshwoodward.com)"

# (numero, titulo no item vocal, nome camel no item instrumental, slug)
TRACKS = [
    ("01", "Release", "Release", "release"),
    ("03", "After the Flames", "AfterTheFlames", "after-the-flames"),
    ("04", "My Favorite Regret", "MyFavoriteRegret", "my-favorite-regret"),
    ("05", "Perfect", "Perfect", "perfect"),
    ("06", "The Nest", "TheNest", "the-nest"),
    ("07", "Words Fall Apart", "WordsFallApart", "words-fall-apart"),
    ("08", "With a Whimper", "WithAWhimper", "with-a-whimper"),
    ("09", "Bloom", "Bloom", "bloom"),
    ("10", "Too Many Valleys", "TooManyValleys", "too-many-valleys"),
    ("11", "Aimless", "Aimless", "aimless"),
    ("12", "Princess", "Princess", "princess"),
    ("14", "Show Me", "ShowMe", "show-me"),
]


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  ja existe: {dest.name}")
        return
    print(f"  baixando {dest.name}...")
    req = urllib.request.Request(url, headers={"User-Agent": "jamroom-pipeline"})
    with urllib.request.urlopen(req) as r, open(dest, "wb") as f:
        while chunk := r.read(1 << 16):
            f.write(chunk)


def main() -> None:
    INPUT.mkdir(exist_ok=True)
    failures = []
    for nn, title, camel, slug in TRACKS:
        print(f"\n=== {nn} {title} ===")
        if (MEDIA / f"{slug}.json").exists():
            print(f"BATCH_OK {slug} (ja processada, pulando)")
            continue
        vocal = INPUT / f"{slug}_vocal.mp3"
        instr = INPUT / f"{slug}_instrumental.mp3"
        try:
            vocal_name = urllib.parse.quote(f"{nn} - Josh Woodward - {title}.mp3")
            download(f"https://archive.org/download/{VOCAL_ITEM}/{vocal_name}", vocal)
            download(
                f"https://archive.org/download/{INSTR_ITEM}/JoshWoodward-AttS-{nn}-{camel}-NoVox.mp3",
                instr,
            )
            subprocess.run(
                [
                    sys.executable,
                    str(HERE / "pipeline.py"),
                    "--original", str(vocal),
                    "--instrumental", str(instr),
                    "--id", slug,
                    "--title", title,
                    "--artist", "Josh Woodward",
                    "--genre", "Folk rock",
                    "--language", "en",
                    "--attribution", ATTRIBUTION,
                ],
                check=True,
            )
            print(f"BATCH_OK {slug}")
        except Exception as e:  # noqa: BLE001 — segue para a proxima faixa
            failures.append(slug)
            print(f"BATCH_FAIL {slug}: {e}")

    print(f"\nBATCH_DONE ok={len(TRACKS) - len(failures)} fail={len(failures)} {failures}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
