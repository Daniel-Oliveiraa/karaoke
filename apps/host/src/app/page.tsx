"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@jamroom/ui";
import { getSocket } from "@/lib/socket";

/**
 * Entrada da tela host. No produto final esta tela é aberta a partir do
 * dashboard do anfitrião; no MVP ela mesma cria a Jam.
 */
export default function HostHome() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function createJam() {
    setCreating(true);
    setError(null);
    getSocket().emit("host:create", (res) => {
      if (res.ok && res.jam) {
        router.push(`/session/${res.jam.code}`);
      } else {
        setError(res.error ?? "Não foi possível criar a Jam");
        setCreating(false);
      }
    });
  }

  return (
    <main
      className="flex h-full flex-col items-center justify-center gap-8 px-8 text-center"
      style={{
        background:
          "radial-gradient(70% 60% at 50% 20%, rgba(124,58,237,0.22), transparent 60%), #09090B",
      }}
    >
      <div>
        <p className="text-4xl font-extrabold tracking-tight">
          JAM<span className="text-primary">ROOM</span>
        </p>
        <p className="mt-2 text-subtitle text-foreground-muted">
          Tela da TV · Everybody sings.
        </p>
      </div>

      <Button
        variant="primary"
        className="px-10 py-5 text-subtitle"
        disabled={creating}
        onClick={createJam}
      >
        {creating ? "Abrindo..." : "Abrir uma Jam nesta tela"}
      </Button>

      {error && <p className="text-body text-error">{error}</p>}

      <p className="max-w-md text-body text-foreground-muted">
        Deixe esta tela na TV ou projetor. Os participantes entram pelo
        celular com o código que vai aparecer aqui.
      </p>
    </main>
  );
}
