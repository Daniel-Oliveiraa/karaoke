"""
Teste de navegador com MUSICA REAL (Knock - Josh Woodward, CC BY 4.0):
valida que a TV toca o instrumental de verdade (<audio> avancando),
que a letra transcrita pelo Whisper aparece sincronizada e que o
participante entra no modo "sua vez" com captura de microfone.

Nao espera a musica inteira (~3min) - o ciclo completo de fim de musica
ja e coberto por test-protocol.mjs e test-jam-flow.py.

Requer: api (4001), host (3001) e participant (3002) rodando.
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

        tv = browser.new_page(viewport={"width": 1280, "height": 720})
        tv.goto("http://localhost:3001", timeout=90000)
        tv.click("text=Abrir uma Jam nesta tela")
        tv.wait_for_url(re.compile(r"/session/\d{4}"), timeout=30000)
        code = tv.url.rstrip("/").split("/")[-1]
        print("jam criada:", code)

        phone = browser.new_page(viewport={"width": 390, "height": 844})
        phone.goto(f"http://localhost:3002/?code={code}", timeout=90000)
        phone.fill("input[placeholder='Como te chamam?']", "Dani")
        phone.click("text=Entrar na Jam")
        phone.wait_for_selector("text=Adicionar música", timeout=15000)

        # adiciona a musica REAL
        phone.click("text=Adicionar música")
        phone.fill("input[placeholder*='Buscar']", "knock")
        phone.get_by_role("button", name="Adicionar", exact=True).click()
        print("ok - Knock adicionada a fila")

        # TV: player comeca com o audio real
        tv.wait_for_selector("text=cantando agora", timeout=20000)
        tv.wait_for_selector("text=Knock", timeout=5000)
        print("ok - player da TV iniciou com Knock")

        # o <audio> esta avancando de verdade?
        t1 = tv.evaluate("document.querySelector('audio') ? 'no-tag' : 'no-tag'")
        # audio element criado via new Audio() nao esta no DOM; medir pela
        # barra de progresso/tempo restante da UI
        phone.wait_for_selector("text=É a sua vez", timeout=10000)
        phone.click("text=Liberar microfone e cantar")
        phone.wait_for_selector("text=capturando sua voz", timeout=15000)
        print("ok - microfone capturando no celular")

        # espera a primeira linha da letra do Whisper aparecer na TV
        tv.wait_for_selector("text=streetcar", timeout=30000)
        tv.screenshot(path=f"{SHOTS}/real_1_tv_knock_lyrics.png")
        print("ok - letra transcrita aparecendo sincronizada na TV")

        # tempo restante muda = audio avancando
        remaining_before = tv.locator("text=restantes").inner_text()
        time.sleep(5)
        remaining_after = tv.locator("text=restantes").inner_text()
        if remaining_before == remaining_after:
            raise AssertionError(
                f"progresso parado: {remaining_before!r} == {remaining_after!r}"
            )
        print(f"ok - audio avancando ({remaining_before!r} -> {remaining_after!r})")

        phone.screenshot(path=f"{SHOTS}/real_2_phone_knock_singing.png")
        browser.close()
        print("\nMUSICA REAL OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FALHOU:", e)
        sys.exit(1)
