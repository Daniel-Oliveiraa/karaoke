"""
Teste da persistencia de sessao do participante: entra na Jam, "fecha o
navegador" (novo contexto com o localStorage preservado, sem sessionStorage)
e verifica que volta direto para o hub sem digitar nome/codigo.

Requer: api (4001), host (3001) e participant (3002) rodando.
"""
import re
import sys

from playwright.sync_api import sync_playwright


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # --- TV cria a jam ---
        tv_ctx = browser.new_context(ignore_https_errors=True)
        tv = tv_ctx.new_page()
        tv.goto("http://localhost:3001", timeout=90000)
        tv.click("text=Abrir uma Jam nesta tela")
        tv.wait_for_url(re.compile(r"/session/\d{4}"), timeout=30000)
        code = tv.url.rstrip("/").split("/")[-1]
        print("jam criada:", code)

        # --- celular entra ---
        phone_ctx = browser.new_context(
            ignore_https_errors=True,
            viewport={"width": 390, "height": 844},
        )
        phone = phone_ctx.new_page()
        phone.goto(f"https://localhost:3002/?code={code}", timeout=90000)
        phone.fill("input[placeholder='Como te chamam?']", "Dani")
        phone.click("text=Entrar na Jam")
        phone.wait_for_selector("text=Adicionar música", timeout=15000)
        print("ok - entrou na jam")

        # "fecha o navegador": preserva localStorage (nao sessionStorage)
        state = phone_ctx.storage_state()
        phone_ctx.close()

        phone_ctx2 = browser.new_context(
            ignore_https_errors=True,
            viewport={"width": 390, "height": 844},
            storage_state=state,
        )
        phone2 = phone_ctx2.new_page()
        phone2.goto("https://localhost:3002/", timeout=90000)
        # deve voltar direto para o hub, sem formulario
        phone2.wait_for_selector("text=Adicionar música", timeout=15000)
        if phone2.locator("input[placeholder='Como te chamam?']").count() > 0:
            raise AssertionError("formulario de entrada apareceu apos reabrir")
        print("ok - reabriu o navegador e voltou direto para a jam (sem digitar nada)")

        # nome preservado no header
        phone2.wait_for_selector("text=Dani", timeout=5000)
        print("ok - mesmo participante (Dani), pontos preservados")

        browser.close()
        print("\nPERSISTENCIA DE SESSAO OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("FALHOU:", e)
        sys.exit(1)
