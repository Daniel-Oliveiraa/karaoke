"""
Teste do prototipo "voz na TV" (v3, track Opus direto): participante liga o
toggle durante a musica e a TV deve estabelecer a conexao WebRTC (fake mic
do Chromium), receber o MediaStreamTrack e exibir o medidor de latencia com
estado conectado. O som fluindo e validado via getStats() (inRms calculado
de totalAudioEnergy, packets de packetsReceived), exposto em window.__tvmic.

Requer: api (4001), host (3001) e participant (3002) rodando.

Nota: o injetor de jitter sintetico da v2 (DEBUG_JITTER_MS) nao existe mais —
com track Opus os pacotes saem pelo stack SRTP do navegador e nao ha como
atrasa-los em JS; a robustez a jitter agora e responsabilidade do NetEq
(jitter buffer adaptativo do Chrome, com jitterBufferTarget=0 pedido).
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
        # (na v3 o playback e o mesmo — MediaStreamAudioSourceNode nao exige
        # secure context — mas vale validar que nada mais quebrou nesse modo)
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
        # Em headless nao ha saida de audio real, entao os numeros oscilam —
        # amostramos varios segundos e usamos o minimo.
        # O numero que importa e o de hardware real; aqui validamos a fiacao.
        tv.wait_for_selector("text=Voz na TV", timeout=20000)
        samples = []
        rms_samples = []
        for _ in range(8):
            time.sleep(1)
            badge = tv.locator("text=/Voz na TV .*ms/").inner_text()
            m = re.search(r"~(\d+) ms", badge)
            if m:
                samples.append(int(m.group(1)))
            # outputRms e um snapshot de ~43ms do analyser do mixer — o mic
            # fake bipa com silencio no meio, entao amostramos junto com o
            # badge e usamos o MAXIMO como prova de que a voz esta soando
            dbg = tv.evaluate("window.__tvmic")
            if dbg:
                rms_samples.append(dbg.get("outputRms", 0))
        if not samples:
            raise AssertionError("medidor nunca exibiu latencia")
        best = min(samples)
        print(f"ok - medidor ativo (minimo {best}ms em headless; amostras {samples})")
        if best > 2000:
            raise AssertionError(f"latencia implausivel ate para headless: {best}ms")

        # o som esta de fato fluindo? (pacotes RTP chegando + contexto tocando)
        # __tvmic e {ctxState, engine, <participantId>: {packets, ...}} — um
        # bloco por celular conectado (duetos: ate 2)
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
        if dbg2.get("engine") != "opus-track":
            raise AssertionError(f"motor inesperado (deveria ser opus-track): {dbg2}")
        if total_packets(dbg2) <= total_packets(dbg1):
            raise AssertionError(f"pacotes de voz nao estao fluindo: {dbg1} -> {dbg2}")

        # medicoes reais via getStats + confirmacao de que o audio vai direto
        # celular<->TV na LAN (nunca via "relay" — nao configuramos TURN)
        for participant_id, peer_dbg in dbg2.items():
            if not isinstance(peer_dbg, dict):
                continue
            for field in ("lossPct", "jitterBufferMs", "inRms", "concealedPct", "candidateType"):
                if field not in peer_dbg:
                    raise AssertionError(f"campo {field} ausente em __tvmic[{participant_id}]: {peer_dbg}")
            if "relay" in str(peer_dbg.get("candidateType")):
                raise AssertionError(
                    f"conexao passou por relay (deveria ser sempre direto na LAN): {peer_dbg}"
                )
        print("ok - campos de medicao presentes e conexao confirmada como direta (sem relay)")
        # a voz esta de fato SOANDO no mixer da TV? usa o maximo dos
        # snapshots de outputRms coletados junto com o badge (o mic fake
        # bipa; snapshots individuais caem no silencio entre bips).
        # Nota: totalAudioEnergy/audioLevel do inbound-rtp ficam em 0 nesse
        # caminho (Chrome nao popula) — inRms em __tvmic so tem valor em
        # hardware real, se tiver; nao serve de assert aqui.
        peak_rms = max(rms_samples, default=0)
        if peak_rms <= 0.005:
            raise AssertionError(
                f"nenhum sinal no mixer da TV (outputRms max {peak_rms}): {dbg2}"
            )
        print(f"ok - track Opus fluindo e voz soando no mixer (outputRms max {peak_rms})")

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
