# Karaokê SaaS — Descritivo do Produto e Telas

> Documento de referência para design de layout. Descreve o serviço, os perfis de usuário e todas as telas necessárias em cada superfície do produto.

## 1. Descritivo do serviço

Um SaaS de karaokê cobrado por uso diário, pensado para uso em grupo (festas, bares, eventos, reuniões de família). O centro da experiência é o modo **Jam** (ou "Party"): um anfitrião abre uma sessão numa tela grande (TV/projetor), os participantes entram por celular via código ou QR — sem precisar criar conta — e todos colaboram numa fila de músicas. A tela principal mostra o vídeo com letra sincronizada estilo karaokê. Ao final de cada música, o sistema pontua a performance do cantor (por afinação real, captada pelo microfone do celular) e mantém um ranking ao vivo entre os participantes daquela sessão. No futuro, o serviço também permite locar equipamento físico (microfones, caixas de som) para quem não tem.

### Perfis de usuário (personas)

| Perfil | Quem é | O que faz |
|---|---|---|
| **Operador da plataforma** | Você, dono do SaaS (ou equipe interna) | Gerencia o catálogo de músicas, licenciamento, usuários pagantes, financeiro da plataforma |
| **Anfitrião** | Cliente pagante — quem organiza o karaokê (ex: dono do bar, anfitrião da festa) | Compra crédito/dia, cria a sessão (Jam), controla a tela host, convida participantes |
| **Participante** | Convidado da sessão, sem conta | Entra via código/QR, escolhe um nome, adiciona músicas à fila, canta, vê sua pontuação e o ranking |

### Superfícies do produto

1. **Site institucional / marketing** — apresentação do produto, planos, cadastro.
2. **Painel Admin** — uso interno do operador da plataforma.
3. **Dashboard do Anfitrião** — onde o cliente pagante gerencia sua conta, compra crédito e cria sessões.
4. **Tela Host/TV** — exibida na TV/projetor durante a Jam. Pode ser aberta a partir do dashboard do anfitrião num navegador conectado à TV.
5. **App do Participante (mobile-web)** — usado no celular de cada convidado durante a Jam.

---

## 2. Telas — Site institucional (marketing)

| Tela | Objetivo | Elementos principais |
|---|---|---|
| **Landing page** | Apresentar o produto e converter visitante em cadastro | Hero explicando o conceito de Jam, demonstração/vídeo, destaque para pontuação por voz real, seção de planos/preço, CTA "Criar conta" |
| **Planos e preços** | Explicar o modelo de cobrança por dia de uso (e futuramente locação de equipamento) | Comparativo de pacotes (ex: 1 dia, pacote de dias, add-on de equipamento), Pix/cartão em destaque |
| **Cadastro / Login (Anfitrião)** | Criar conta paga ou entrar | Form de cadastro (nome, e-mail, senha ou login social), recuperação de senha |

---

## 3. Telas — Painel Admin (Operador da plataforma)

| Tela | Objetivo | Elementos principais |
|---|---|---|
| **Login Admin** | Acesso restrito à equipe interna | Autenticação simples, sem cadastro público |
| **Dashboard geral** | Visão rápida da saúde da plataforma | Nº de jams ativas agora, receita do dia/mês, músicas processando, alertas (falha de pipeline, licenciamento pendente) |
| **Catálogo de músicas — lista** | Gerenciar todas as músicas disponíveis | Tabela com busca/filtro (título, artista, gênero, status), status por música: *Processando pitch* / *Pronta* / *Erro* / *Licença pendente*, ações em massa |
| **Catálogo — cadastrar/editar música** | Adicionar nova música ou editar metadados | Form: título, artista, gênero, capa/thumbnail, upload de vídeo/instrumental, upload ou geração de letra sincronizada, campo de origem/licenciamento (fornecedor B2B ou upload próprio), preview do player |
| **Catálogo — detalhe de processamento** | Acompanhar o pipeline assíncrono de uma música | Barra de progresso das etapas (separação vocal → extração de pitch → alinhamento de letra), log de erro se falhar, botão de reprocessar |
| **Gestão de licenciamento** | Controlar contratos e fornecedores de conteúdo | Lista de fornecedores B2B integrados, status de contrato, músicas vinculadas a cada fornecedor |
| **Usuários / Anfitriões** | Ver e administrar contas de clientes pagantes | Lista de anfitriões, histórico de uso, suporte (bloquear/desbloquear conta) |
| **Sessões (Jams) — histórico e monitor** | Auditoria e suporte em tempo real | Lista de jams passadas e ativas, ao abrir uma jam ativa: fila atual, participantes, possibilidade de encerrar remotamente em caso de problema |
| **Financeiro / Transações** | Acompanhar pagamentos da plataforma | Lista de transações (Pix/boleto/cartão), status, reembolsos, conciliação |
| **Configurações da plataforma** | Parâmetros globais | Regras de cobrança, feature flags (ex: ativar/desativar scoring real vs. simulado por conta), termos de uso |

---

## 4. Telas — Dashboard do Anfitrião (Cliente pagante)

| Tela | Objetivo | Elementos principais |
|---|---|---|
| **Login / Cadastro** | Acesso à conta do anfitrião | (compartilhada com o site institucional) |
| **Minha conta / Início** | Visão geral do que o anfitrião pode fazer | Saldo de crédito/dias disponíveis, botão destacado "Criar nova Jam", histórico de jams anteriores |
| **Comprar crédito / Checkout** | Adquirir pacote de uso diário | Seleção de pacote (1 dia, pacote de dias, add-on equipamento se aplicável), escolha de método (Pix/boleto/cartão), confirmação de pagamento |
| **Criar Jam** | Configurar uma nova sessão antes de abrir | Nome da sessão (opcional), configurações (permitir participantes votarem/reordenarem fila? limite de músicas por pessoa?), botão "Abrir sessão" |
| **Minha Jam ativa (controle)** | Painel de controle enquanto a Jam está rodando (usado no celular do anfitrião, separado da tela host/TV) | Código/QR para compartilhar, fila atual com opção de pular/reordenar, lista de participantes, botão para encerrar sessão |
| **Histórico de Jams / Relatórios simples** | Ver sessões passadas | Data, duração, nº de participantes, músicas mais cantadas, ranking final de cada sessão |
| **Configurações da conta** | Dados de perfil e pagamento | Dados cadastrais, métodos de pagamento salvos, notificações |

---

## 5. Telas — Tela Host / TV

> Exibida em tela cheia num navegador conectado à TV/projetor. Sem interação direta por toque — é só visualização, controlada remotamente pelo anfitrião.

| Tela | Objetivo | Elementos principais |
|---|---|---|
| **Lobby / Aguardando início** | Mostrar o código de entrada antes da primeira música | Código da sessão em destaque + QR grande, lista de participantes entrando em tempo real, contador de pessoas |
| **Player — música em andamento** | Tela principal durante o canto | Vídeo em destaque com letra sincronizada sobrepostas (estilo karaokê, palavra atual destacada), nome de quem está cantando, próxima música na fila (canto da tela), indicador de tempo restante |
| **Resultado da música** | Exibir a pontuação ao final de cada faixa | Nome do cantor, pontuação numérica/nota, feedback visual (ex: estrelas, gráfico de afinação ao longo da música), transição automática para a próxima |
| **Leaderboard da sessão** | Ranking ao vivo entre as músicas | Lista ordenada dos participantes por pontuação acumulada, destaque para o 1º lugar, pode aparecer como tela intermediária entre músicas ou como painel fixo lateral durante o player |
| **Fila vazia / aguardando próxima música** | Estado quando não há próxima música na fila | Mensagem incentivando participantes a adicionar músicas, código de entrada ainda visível |
| **Encerramento da sessão** | Tela final quando o anfitrião encerra a Jam | Ranking final, resumo (nº de músicas cantadas, duração), agradecimento/branding |

---

## 6. Telas — App do Participante (mobile-web)

> Acessado via QR/código, sem necessidade de conta. Otimizado para celular.

| Tela | Objetivo | Elementos principais |
|---|---|---|
| **Entrar na sessão** | Ponto de entrada | Campo para digitar código da sessão OU botão de escanear QR |
| **Escolher nome/avatar** | Identificação leve do participante | Campo de nickname, seleção simples de avatar/cor (sem foto obrigatória) |
| **Tela principal da Jam** | Hub do participante durante a sessão | Fila atual (com posição e quem adicionou cada música), botão destacado "Adicionar música", atalho para o leaderboard |
| **Buscar/adicionar música** | Escolher a próxima música para cantar | Busca por título/artista, filtros (gênero, populares), preview (capa, duração), botão "Adicionar à fila" |
| **Sua vez de cantar** | Tela ativa quando é a vez do participante | Aviso "É sua vez!", botão para permitir acesso ao microfone, indicador de captura de áudio ativa, (opcional) letra também espelhada no celular como apoio |
| **Resultado da sua performance** | Feedback imediato pós-música | Pontuação obtida, comparação com afinação (gráfico simples), posição atual no ranking da sessão |
| **Leaderboard** | Ranking ao vivo | Lista de participantes ordenada por pontos, destaque para a posição do próprio usuário |
| **Sessão encerrada** | Encerramento do lado do participante | Ranking final, agradecimento, (futuro) CTA para o participante criar sua própria conta/Jam |

---

## 7. Notas para o design de layout

- **Tela Host/TV** deve priorizar legibilidade a distância (fontes grandes, alto contraste) — é vista de longe, numa TV, muitas vezes num ambiente com pouca luz (bar/festa).
- **App do Participante** deve minimizar fricção: da entrada até adicionar a primeira música deve levar poucos toques, sem cadastro.
- **Painel Admin** e **Dashboard do Anfitrião** são interfaces de trabalho — podem seguir um padrão mais denso/tabular, mas são públicos distintos (equipe interna vs. cliente pagante) e não devem compartilhar a mesma navegação.
- Reaproveitar um único **design system** (cores, tipografia, componentes de botão/card) entre todas as superfícies para manter consistência de marca, mesmo com layouts distintos por público.
