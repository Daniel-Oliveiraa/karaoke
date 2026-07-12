"""
Teste do prototipo "voz na TV": participante liga o toggle durante a musica
e a TV deve estabelecer a conexao WebRTC (fake mic do Chromium) e exibir o
medidor de latencia com estado conectado.

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

        phone.click("text=Adicionar música")
        phone.fill("input[placeholder*='Buscar']", "peixe")
        phone.get_by_role("button", name="Adicionar", exact=True).click()

        phone.wait_for_selector("text=É a sua vez", timeout=20000)
        phone.click("text=Liberar microfone e cantar")
        phone.wait_for_selector("text=Voz na TV desligada", timeout=15000)
        print("ok - cantando, toggle disponivel")

        # liga a voz na TV
        phone.click("text=Voz na TV desligada")
        phone.wait_for_selector("text=Voz na TV ligada", timeout=15000)
        print("ok - toggle ligado no celular")

        # TV deve mostrar o medidor com a conexao estabelecida
        tv.wait_for_selector("text=Voz na TV", timeout=20000)
        time.sleep(3)  # espera as primeiras estatisticas
        badge = tv.locator("text=/Voz na TV .*ms/").inner_text()
        print("ok - medidor na TV:", badge)
        ms = int(re.search(r"~(\d+) ms", badge).group(1))
        if not (10 <= ms <= 400):
            raise AssertionError(f"latencia estimada fora do plausivel: {ms}ms")
        print(f"ok - latencia estimada plausivel ({ms}ms, localhost)")

        tv.screenshot(path=f"{SHOTS}/tvmic_1_tv_meter.png")
        phone.screenshot(path=f"{SHOTS}/tvmic_2_phone_toggle.png")

        # desliga e o medidor deve sumir junto com a conexao
        phone.click("text=Voz na TV ligada")
        phone.wait_for_selector("text=Voz na TV desligada", timeout=10000)
        print("ok - toggle desligado")

        browser.close()
        print("\nVOZ NA TV OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FALHOU:", e)
        sys.exit(1)
