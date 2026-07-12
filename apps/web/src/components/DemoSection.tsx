import { Avatar } from "@jamroom/ui";
import { CrownIcon, MicIcon, PlayIcon } from "./icons";

/**
 * Seção "Demonstração" da landing (estrutura documentada em
 * docs/layoutDesc_extracted.txt — Landing Page). Enquanto não existe um
 * vídeo real de demonstração, a seção usa um placeholder de player com a
 * mesma atmosfera de palco do Hero, mantendo o CTA de assistir.
 */
export function DemoSection() {
  return (
    <section id="demo" className="px-6 pb-24 sm:px-8 lg:px-16 lg:pb-32">
      <div className="mx-auto max-w-[1440px]">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-title">
            Veja o JAMROOM em ação
          </h2>
          <p className="mt-4 text-body leading-relaxed text-foreground-muted">
            Da criação da Jam ao ranking final: uma noite inteira de karaokê em
            menos de dois minutos.
          </p>
        </div>

        <div className="relative mx-auto mt-12 max-w-4xl">
          <button
            type="button"
            aria-label="Assistir demonstração do JAMROOM"
            className="group relative block w-full overflow-hidden rounded-lg border border-border shadow-soft transition-transform duration-300 hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="relative aspect-video">
              {/* atmosfera de palco (mesma linguagem visual do Hero) */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(110% 80% at 25% 20%, rgba(124,58,237,0.45), transparent 55%), radial-gradient(80% 70% at 75% 85%, rgba(59,130,246,0.3), transparent 60%), radial-gradient(60% 50% at 88% 25%, rgba(217,70,239,0.22), transparent 60%), #0b0b10",
                }}
              />
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-1/2"
                style={{
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.5), transparent)",
                }}
              />

              {/* botão de play central */}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft transition-colors duration-300 group-hover:bg-primary-hover">
                  <PlayIcon className="ml-1 h-9 w-9" />
                </span>
              </div>

              {/* chips flutuantes ilustrando os momentos da demo */}
              <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-white/10 bg-background/70 px-3.5 py-2 backdrop-blur-glass">
                <MicIcon className="h-4 w-4 text-primary" />
                <span className="text-caption font-semibold text-foreground">
                  Pontuação ao vivo
                </span>
              </div>
              <div className="absolute bottom-5 right-5 hidden items-center gap-2.5 rounded-full border border-white/10 bg-background/70 px-3.5 py-2 backdrop-blur-glass sm:flex">
                <CrownIcon className="h-4 w-4 text-warning" />
                <Avatar name="Pedro" size={22} className="text-[9px]" />
                <span className="text-caption font-semibold text-foreground">
                  Pedro assumiu o 1º lugar
                </span>
              </div>
            </div>
          </button>

          <p className="mt-4 text-center text-caption text-foreground-muted">
            2 min · sem cadastro para assistir
          </p>
        </div>
      </div>
    </section>
  );
}
