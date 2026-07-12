import { ChevronDownIcon } from "./icons";

/**
 * Seção "Perguntas Frequentes" da landing. Usa <details>/<summary>
 * nativos (sem JS) estilizados no Design System — acessível por teclado
 * e renderizável como Server Component.
 */
const QUESTIONS: { question: string; answer: string }[] = [
  {
    question: "Preciso instalar algum aplicativo?",
    answer:
      "Não. A TV abre o JAMROOM num navegador e os participantes entram pelo celular escaneando o QR Code ou digitando o código da Jam. Ninguém instala nada, ninguém cria conta para participar.",
  },
  {
    question: "Como funciona a pontuação por voz real?",
    answer:
      "Durante a música, o microfone do celular de quem está cantando capta a voz e o JAMROOM compara a afinação com a melodia original, nota a nota. A pontuação considera afinação e constância — não é sorteio nem número aleatório.",
  },
  {
    question: "Quantas pessoas podem participar de uma Jam?",
    answer:
      "Não há limite prático: todo mundo que estiver no local pode entrar com o código e adicionar músicas à fila. O ranking ao vivo acompanha todos os participantes da sessão.",
  },
  {
    question: "Preciso de equipamento especial?",
    answer:
      "Só uma TV (ou projetor) com navegador e os celulares dos convidados. Caixa de som e microfone dedicados melhoram a experiência, mas não são obrigatórios — em breve você também poderá alugar equipamento direto pelo JAMROOM.",
  },
  {
    question: "Funciona em qualquer TV?",
    answer:
      "Funciona em qualquer tela com um navegador moderno: Smart TVs, Chromecast, Fire Stick, ou um notebook ligado na TV pelo HDMI.",
  },
  {
    question: "E se a internet do local for fraca?",
    answer:
      "O JAMROOM foi pensado para redes de festa: a detecção de voz roda no próprio celular (não enviamos seu áudio para a internet) e o tráfego entre os aparelhos é leve. Uma conexão 4G ou Wi-Fi doméstico é suficiente.",
  },
];

export function Faq() {
  return (
    <section id="faq" className="px-6 py-24 sm:px-8 lg:px-16 lg:py-32">
      <div className="mx-auto max-w-3xl">
        <h2 className="text-center text-3xl font-extrabold tracking-tight text-foreground sm:text-title">
          Perguntas frequentes
        </h2>

        <div className="mt-12 flex flex-col gap-3">
          {QUESTIONS.map(({ question, answer }) => (
            <details
              key={question}
              className="group rounded-md border border-border bg-surface transition-colors open:border-primary/40"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 text-body font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                {question}
                <ChevronDownIcon className="h-5 w-5 shrink-0 text-foreground-muted transition-transform duration-300 group-open:rotate-180" />
              </summary>
              <p className="px-6 pb-5 text-body leading-relaxed text-foreground-muted">
                {answer}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
