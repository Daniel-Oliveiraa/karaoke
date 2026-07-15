"use client";

import { useEffect, useState } from "react";
import { Button } from "@kantai/ui";

/**
 * Entrada na sessão: código (pré-preenchido quando veio do QR) + nome.
 * Fricção mínima: dois campos e um botão.
 */
export function JoinView({
  joining,
  error,
  onJoin,
}: {
  joining: boolean;
  error: string | null;
  onJoin: (code: string, name: string) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    const fromQr = new URLSearchParams(window.location.search).get("code");
    if (fromQr) setCode(fromQr.replace(/\D/g, "").slice(0, 4));
  }, []);

  const canJoin = code.length === 4 && name.trim().length >= 2 && !joining;

  return (
    <main
      className="flex min-h-dvh flex-col justify-center gap-8 px-6 py-12"
      style={{
        background:
          "radial-gradient(80% 50% at 50% 0%, rgba(124,58,237,0.25), transparent 60%), #09090B",
      }}
    >
      <div className="text-center">
        <p className="text-3xl font-extrabold tracking-tight">
          KAN<span className="text-primary">TAÍ</span>
        </p>
        <p className="mt-2 text-body text-foreground-muted">
          Entre na Jam e cante com todo mundo
        </p>
      </div>

      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (canJoin) onJoin(code, name.trim());
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-caption font-semibold text-foreground-muted">
            Código da Jam
          </span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="0000"
            className="min-h-input rounded-sm border border-border bg-surface px-4 text-center text-4xl font-extrabold tracking-[0.5em] text-foreground placeholder:text-foreground-muted/40 focus:border-primary focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-caption font-semibold text-foreground-muted">
            Seu nome
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            placeholder="Como te chamam?"
            className="min-h-input rounded-sm border border-border bg-surface px-4 text-body text-foreground placeholder:text-foreground-muted/40 focus:border-primary focus:outline-none"
          />
        </label>

        {error && <p className="text-caption text-error">{error}</p>}

        <Button
          variant="primary"
          className="w-full justify-center py-4 text-body font-semibold"
          disabled={!canJoin}
          // type=submit para o teclado "ir" do celular funcionar
          type="submit"
        >
          {joining ? "Entrando..." : "Entrar na Jam"}
        </Button>
      </form>

      <p className="text-center text-caption text-foreground-muted">
        Sem cadastro. Seu nome aparece só nesta sessão.
      </p>
    </main>
  );
}
