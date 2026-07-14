"""
Teste do prototipo "voz na TV": participante liga o toggle durante a musica
e a TV deve estabelecer a conexao WebRTC (fake mic do Chromium) e exibir o
medidor de latencia com estado conectado.

Requer: api (4001), host (3001) e participant (3002) rodando.
"""
import os
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

        tv = browser.new_page(viewport={"width": 1280, "height": 720}, ignore_https_errors=True)
        # TV_URL=http://<IP>:3001 testa o caminho de contexto INSEGURO
        # (AudioWorklet indisponivel -> fallback ScriptProcessor)
        tv.goto(os.environ.get("TV_URL", "http://localhost:3001"), timeout=90000)
        tv.click("text=Abrir uma Jam nesta tela")
        tv.wait_for_url(re.compile(r"/session/\d{4}"), timeout=30000)
        code = tv.url.rstrip("/").split("/")[-1]
        print("jam criada:", code)

        phone = browser.new_page(viewport={"width": 390, "height": 844}, ignore_https_errors=True)
        phone.goto(f"https://localhost:3002/?code={code}", timeout=90000)
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

        # TV deve mostrar o medidor com a conexao estabelecida.
        # Em headless nao ha saida de audio real, entao o jitter buffer
        # oscila muito — amostramos varios segundos e usamos o minimo.
        # O numero que importa e o de hardware real; aqui validamos a fiacao.
        tv.wait_for_selector("text=Voz na TV", timeout=20000)
        samples = []
        for _ in range(8):
            time.sleep(1)
            badge = tv.locator("text=/Voz na TV .*ms/").inner_text()
            m = re.search(r"~(\d+) ms", badge)
            if m:
                samples.append(int(m.group(1)))
        if not samples:
            raise AssertionError("medidor nunca exibiu latencia")
        best = min(samples)
        print(f"ok - medidor ativo (minimo {best}ms em headless; amostras {samples})")
        if best > 2000:
            raise AssertionError(f"latencia implausivel ate para headless: {best}ms")

        # o som esta de fato fluindo? (pacotes PCM chegando + contexto tocando)
        # __tvmic e {ctxState, <participantId>: {packets, ...}} — um bloco
        # por celular conectado (duetos: ate 2)
        def total_packets(dbg):
            if not dbg:
                return 0
            return sum(
                v.get("packets", 0) for v in dbg.values() if isinstance(v, dict)
            )

        dbg1 = tv.evaluate("window.__tvmic")
        time.sleep(2)
        dbg2 = tv.evaluate("window.__tvmic")
        print("debug tv:", dbg2)
        # o celular acusa captura muda? (mic ocupado/silencioso)
        mute_warn = phone.locator("text=Sem sinal de voz").count()
        print(f"debug celular: aviso de captura muda visivel = {bool(mute_warn)}")
        if not dbg2 or dbg2.get("ctxState") != "running":
            raise AssertionError(f"AudioContext da TV nao esta tocando: {dbg2}")
        if total_packets(dbg2) <= total_packets(dbg1):
            raise AssertionError(f"pacotes de voz nao estao fluindo: {dbg1} -> {dbg2}")
        # outRms do worklet = RMS emitido ao mixer, MEDIA de 1s inteiro.
        # (o outputRms do analyser e um snapshot de ~43ms e cai no silencio
        # entre os bips do mic fake — nao serve de assert)
        worklet_rms = max(
            (v.get("outRms", 0) for v in dbg2.values() if isinstance(v, dict)),
            default=0,
        )
        if worklet_rms <= 0.005:
            raise AssertionError(f"worklet emitindo silencio ao mixer: {dbg2}")
        print(f"ok - pacotes PCM fluindo e worklet emitindo sinal (rms {worklet_rms})")

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
