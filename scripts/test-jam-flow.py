"""
Teste de navegador do fluxo da Jam:
host (TV) cria a sessao, participante entra pelo "celular", adiciona musica,
a musica comeca sozinha (countdown), o participante libera o microfone
(fake device do Chromium) e ao final o resultado + leaderboard aparecem.

Requer: api (4001), host (3001) e participant (3002) rodando.
Uso: python scripts/test-jam-flow.py
"""
import re
import sys
import time

from playwright.sync_api import sync_playwright

SHOTS = "C:/Users/danie/AppData/Local/Temp/claude/karaoke-shots"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--autoplay-policy=no-user-gesture-required",
            ],
        )

        # --- TV (host) ---
        tv = browser.new_page(viewport={"width": 1280, "height": 720})
        tv.goto("http://localhost:3001", timeout=90000)
        tv.wait_for_load_state("networkidle")
        tv.click("text=Abrir uma Jam nesta tela")
        tv.wait_for_url(re.compile(r"/session/\d{4}"), timeout=30000)
        code = tv.url.rstrip("/").split("/")[-1]
        print("jam criada, codigo:", code)
        tv.wait_for_selector(f"text={code}", timeout=15000)
        tv.wait_for_selector("img[alt*='QR Code']", timeout=15000)
        tv.screenshot(path=f"{SHOTS}/flow_1_tv_lobby.png")
        print("ok - lobby da TV com codigo e QR")

        # --- celular (participante) ---
        phone = browser.new_page(viewport={"width": 390, "height": 844})
        phone.goto(f"http://localhost:3002/?code={code}", timeout=90000)
        phone.wait_for_load_state("networkidle")
        # codigo pre-preenchido pelo QR; falta o nome
        phone.fill("input[placeholder='Como te chamam?']", "Dani")
        phone.click("text=Entrar na Jam")
        phone.wait_for_selector("text=Adicionar música", timeout=15000)
        phone.screenshot(path=f"{SHOTS}/flow_2_phone_hub.png")
        print("ok - participante entrou no hub")

        # participante aparece na TV
        tv.wait_for_selector("text=Dani", timeout=10000)
        print("ok - participante apareceu na TV em tempo real")

        # --- adicionar musica ---
        phone.click("text=Adicionar música")
        phone.wait_for_selector("input[placeholder*='Buscar']", timeout=10000)
        phone.fill("input[placeholder*='Buscar']", "peixe")
        phone.get_by_role("button", name="Adicionar", exact=True).click()
        phone.wait_for_selector("text=Peixe Vivo", timeout=10000)
        phone.screenshot(path=f"{SHOTS}/flow_3_phone_queue.png")
        print("ok - musica adicionada a fila")

        # --- TV: countdown -> player ---
        tv.wait_for_selector("text=Começando em", timeout=10000)
        tv.wait_for_selector("text=cantando agora", timeout=15000)
        tv.screenshot(path=f"{SHOTS}/flow_4_tv_player.png")
        print("ok - player comecou na TV")

        # --- celular: e a sua vez -> liberar microfone ---
        phone.wait_for_selector("text=É a sua vez", timeout=10000)
        phone.click("text=Liberar microfone e cantar")
        phone.wait_for_selector("text=capturando sua voz", timeout=15000)
        phone.screenshot(path=f"{SHOTS}/flow_5_phone_singing.png")
        print("ok - microfone capturando (fake device)")

        # tela da TV durante a musica (com letra)
        time.sleep(8)
        tv.screenshot(path=f"{SHOTS}/flow_6_tv_lyrics.png")

        # --- espera o fim da musica (Peixe Vivo ~40s) ---
        tv.wait_for_selector("text=de afinação", timeout=90000)
        tv.screenshot(path=f"{SHOTS}/flow_7_tv_results.png")
        print("ok - resultado na TV")

        phone.wait_for_selector("text=Sua posição na Jam", timeout=15000)
        phone.screenshot(path=f"{SHOTS}/flow_8_phone_result.png")
        print("ok - resultado no celular")

        # --- volta ao lobby com leaderboard ---
        tv.wait_for_selector("text=Ranking da Jam", timeout=20000)
        tv.screenshot(path=f"{SHOTS}/flow_9_tv_leaderboard.png")
        print("ok - leaderboard na TV apos a musica")

        browser.close()
        print("\nFLUXO DE NAVEGADOR OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FALHOU:", e)
        sys.exit(1)
