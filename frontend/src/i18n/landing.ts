import type { Lang } from './LanguageContext'

// All Landing copy in both languages. Icons, layout and plan highlighting stay
// in the component; only text lives here so translations are easy to maintain.
// Plan names (Starter/Pro/Agency/Enterprise) are product names, not translated.

export interface LandingContent {
  nav: { features: string; how: string; pricing: string; faq: string; signIn: string; bookDemo: string }
  hero: { titlePre: string; titleHighlight: string; subtitle: string; cta: string }
  features: { eyebrow: string; title: string; items: { title: string; body: string }[] }
  how: { eyebrow: string; title: string; steps: { title: string; body: string }[] }
  pricing: {
    eyebrow: string
    title: string
    subtitle: string
    plans: { tagline: string }[]
    mostPopular: string
    custom: string
    quoted: string
    contact: string
    included: string
    features: { label: string; values: (string | boolean)[] }[]
    footnote: string
  }
  faq: { eyebrow: string; title: string; items: { q: string; a: string }[] }
  cta: { titlePre: string; titleHighlight: string; body: string; bookDemo: string }
  footer: { features: string; pricing: string; faq: string; contact: string }
}

const en: LandingContent = {
  nav: { features: 'Features', how: 'How it works', pricing: 'Pricing', faq: 'FAQ', signIn: 'Sign in', bookDemo: 'Book a demo' },
  hero: {
    titlePre: 'The command center for',
    titleHighlight: 'Web3 community managers',
    subtitle:
      'Analytics, moderation, moderator payroll and task calendars for every community you run, unified in one dark, fast, premium workspace.',
    cta: 'Sign in',
  },
  features: {
    eyebrow: 'Product',
    title: 'Everything a Web3 CM needs, in one panel',
    items: [
      { title: 'Cross-platform analytics', body: 'Members, messages, growth and retention across Discord, Telegram, Zealy and Galxe, one dashboard, honest metrics, no vanity.' },
      { title: 'Moderation log', body: 'Fake links, impersonation, phishing, rug warnings, every incident tracked per platform with export and audit trail.' },
      { title: 'Moderator payroll', body: 'Configurable points per metric, auto-computed earnings, salary log and Payments section. Pay from what they actually did.' },
      { title: 'KOL tracker', body: 'Track influencers by channel and campaign, Discord, Telegram, Twitter, YouTube, with performance signals.' },
      { title: 'Tasks + calendar', body: 'Kanban board plus calendar view, drag-and-drop, per-moderator assignments, and a Notion-style daily recap.' },
      { title: 'Reports on autopilot', body: 'Branded one-pagers with exec summary, moderator activity and scheduled email delivery to your clients.' },
    ],
  },
  how: {
    eyebrow: 'How it works',
    title: 'From chaos to a live dashboard in an afternoon',
    steps: [
      { title: 'Connect your community', body: 'Plug in Discord, Telegram, Zealy, Galxe and Snapshot in minutes. OAuth or bot token, your choice.' },
      { title: 'Configure moderators & rules', body: 'Add your team, set point values per metric, define shifts and warnings. The system tracks the rest.' },
      { title: 'Automate reports & payouts', body: 'Recap pops up at re-entry, weekly reports email out on schedule, and payments compute themselves.' },
    ],
  },
  pricing: {
    eyebrow: 'Pricing',
    title: 'Simple tiers. Talk to us for a number.',
    subtitle: 'Every plan is quoted based on the size of your community and the number of moderators you actually pay. No credit card in the way.',
    plans: [
      { tagline: 'For a solo CM testing the water' },
      { tagline: 'For active community managers' },
      { tagline: 'For teams running multiple clients' },
      { tagline: 'For foundations & large ecosystems' },
    ],
    mostPopular: 'Most popular',
    custom: 'Custom',
    quoted: 'Quoted on request',
    contact: 'Contact us',
    included: "What's included",
    features: [
      { label: 'Workspaces (communities)', values: ['1', '2', '8', 'Unlimited'] },
      { label: 'Moderators tracked', values: ['3', '10', '40', 'Unlimited'] },
      { label: 'Team seats (CMs)', values: ['1', '2', '6', 'Unlimited'] },
      { label: 'Integrations', values: ['Discord, Telegram', '+ Zealy, Galxe', '+ Snapshot, X import, streaming (Twitch / YouTube / Kick)', '+ Custom / API'] },
      { label: 'Data sync frequency', values: ['Manual', 'Hourly', 'Every 15 min', 'Real-time'] },
      { label: 'Analytics history', values: ['7 days', '30 days + hourly snapshots', '90 days', 'Unlimited'] },
      { label: 'Moderation log', values: [true, true, 'Full + export', 'Full + webhooks'] },
      { label: 'Points system + Payments', values: [false, true, 'Multi-currency', 'Wallet API'] },
      { label: 'Scheduled email reports', values: [false, 'Weekly', 'Daily + branded PDF', 'White-label'] },
      { label: 'AI recap (every 2h)', values: [false, false, true, 'Custom prompts'] },
      { label: 'Moderator drill-down reports', values: [false, 'Basic', 'Full + CSV', 'Full + API'] },
      { label: 'Discord member retention', values: [false, false, true, true] },
      { label: 'Support', values: ['Community', 'Email 72h', 'Priority 24h + onboarding', 'Dedicated CSM + SLA'] },
    ],
    footnote: 'Extra workspaces, moderators and seats billed per unit. Annual billing available on all paid tiers.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Answers to what teams ask us first',
    items: [
      { q: 'Why don’t you show prices?', a: 'Every community is different. A KOL agency with 8 clients has very different needs from a single foundation running one Discord. We quote you a number that fits, no surprise overage bills, no shelf-ware.' },
      { q: 'Which platforms do you support today?', a: 'Discord, Telegram, Zealy, Galxe and Snapshot are wired in. X / Twitter data comes in via CSV import. Streaming platforms, Twitch, YouTube Live and Kick, are on the roadmap and visible in the Integrations panel as “Coming Soon”.' },
      { q: 'How does the moderator payroll work?', a: 'You define a point value for each metric that matters (Discord messages, Telegram messages, X contents, likes, incidents resolved…), set a points-to-currency rate, and Catch computes what each moderator earned. Overrides and manual adjustments are always available.' },
      { q: 'Do you store our community data?', a: 'Yes, aggregated metrics and metadata live on Supabase (Postgres) with row-level security. Message content is not stored beyond what’s needed for attribution and moderation logs.' },
      { q: 'Can we white-label the reports for our clients?', a: 'Yes, on Agency and Enterprise. Custom branding on the PDF and the scheduled email, your logo, your domain.' },
      { q: 'Do you offer a trial?', a: 'We prefer a 30-minute onboarding call. You show us your community, we set up your workspace with your data live during the call. If it doesn’t click, you owe nothing.' },
    ],
  },
  cta: {
    titlePre: 'Ready to run your communities like a',
    titleHighlight: 'real ops team',
    body: 'Book a 30-minute call. We’ll spin up your workspace with your actual Discord and Telegram data live on the screen.',
    bookDemo: 'Book a demo',
  },
  footer: { features: 'Features', pricing: 'Pricing', faq: 'FAQ', contact: 'Contact' },
}

const pt: LandingContent = {
  nav: { features: 'Recursos', how: 'Como funciona', pricing: 'Preços', faq: 'FAQ', signIn: 'Entrar', bookDemo: 'Agendar demo' },
  hero: {
    titlePre: 'O centro de comando para',
    titleHighlight: 'gestores de comunidade Web3',
    subtitle:
      'Analytics, moderação, pagamento de moderadores e calendários de tarefas para cada comunidade que você gerencia, tudo em um workspace único, escuro, rápido e premium.',
    cta: 'Entrar',
  },
  features: {
    eyebrow: 'Produto',
    title: 'Tudo que um CM Web3 precisa, em um só painel',
    items: [
      { title: 'Analytics multiplataforma', body: 'Membros, mensagens, crescimento e retenção no Discord, Telegram, Zealy e Galxe, um painel, métricas honestas, sem vaidade.' },
      { title: 'Registro de moderação', body: 'Links falsos, falsificação de identidade, phishing, alertas de rug, cada incidente registrado por plataforma, com exportação e trilha de auditoria.' },
      { title: 'Folha de pagamento de moderadores', body: 'Pontos configuráveis por métrica, ganhos calculados automaticamente, histórico salarial e seção de Pagamentos. Pague pelo que eles realmente fizeram.' },
      { title: 'Rastreador de KOLs', body: 'Acompanhe influenciadores por canal e campanha, Discord, Telegram, Twitter, YouTube, com sinais de desempenho.' },
      { title: 'Tarefas + calendário', body: 'Quadro Kanban e visão de calendário, arrastar e soltar, atribuições por moderador e um recap diário no estilo Notion.' },
      { title: 'Relatórios no piloto automático', body: 'One-pagers com sua marca, resumo executivo, atividade dos moderadores e envio agendado por e-mail para seus clientes.' },
    ],
  },
  how: {
    eyebrow: 'Como funciona',
    title: 'Do caos a um painel ao vivo em uma tarde',
    steps: [
      { title: 'Conecte sua comunidade', body: 'Conecte Discord, Telegram, Zealy, Galxe e Snapshot em minutos. OAuth ou bot token, você escolhe.' },
      { title: 'Configure moderadores e regras', body: 'Adicione seu time, defina o valor em pontos por métrica, configure turnos e advertências. O sistema cuida do resto.' },
      { title: 'Automatize relatórios e pagamentos', body: 'O recap aparece ao retornar, os relatórios semanais saem por e-mail no horário e os pagamentos se calculam sozinhos.' },
    ],
  },
  pricing: {
    eyebrow: 'Preços',
    title: 'Planos simples. Fale com a gente para um valor.',
    subtitle: 'Cada plano é cotado com base no tamanho da sua comunidade e no número de moderadores que você realmente paga. Sem cartão de crédito no caminho.',
    plans: [
      { tagline: 'Para um CM solo testando o terreno' },
      { tagline: 'Para gestores de comunidade ativos' },
      { tagline: 'Para times com vários clientes' },
      { tagline: 'Para fundações e grandes ecossistemas' },
    ],
    mostPopular: 'Mais popular',
    custom: 'Sob medida',
    quoted: 'Cotado sob consulta',
    contact: 'Fale conosco',
    included: 'O que está incluído',
    features: [
      { label: 'Workspaces (comunidades)', values: ['1', '2', '8', 'Ilimitado'] },
      { label: 'Moderadores acompanhados', values: ['3', '10', '40', 'Ilimitado'] },
      { label: 'Assentos de time (CMs)', values: ['1', '2', '6', 'Ilimitado'] },
      { label: 'Integrações', values: ['Discord, Telegram', '+ Zealy, Galxe', '+ Snapshot, importação de X, streaming (Twitch / YouTube / Kick)', '+ Custom / API'] },
      { label: 'Frequência de sincronização', values: ['Manual', 'A cada hora', 'A cada 15 min', 'Tempo real'] },
      { label: 'Histórico de analytics', values: ['7 dias', '30 dias + snapshots por hora', '90 dias', 'Ilimitado'] },
      { label: 'Registro de moderação', values: [true, true, 'Completo + exportação', 'Completo + webhooks'] },
      { label: 'Sistema de pontos + Pagamentos', values: [false, true, 'Multimoeda', 'Wallet API'] },
      { label: 'Relatórios agendados por e-mail', values: [false, 'Semanal', 'Diário + PDF com marca', 'White-label'] },
      { label: 'Recap com IA (a cada 2h)', values: [false, false, true, 'Prompts personalizados'] },
      { label: 'Relatórios detalhados por moderador', values: [false, 'Básico', 'Completo + CSV', 'Completo + API'] },
      { label: 'Retenção de membros no Discord', values: [false, false, true, true] },
      { label: 'Suporte', values: ['Comunidade', 'E-mail 72h', 'Prioritário 24h + onboarding', 'CSM dedicado + SLA'] },
    ],
    footnote: 'Workspaces, moderadores e assentos extras cobrados por unidade. Cobrança anual disponível em todos os planos pagos.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Respostas para o que os times perguntam primeiro',
    items: [
      { q: 'Por que vocês não mostram os preços?', a: 'Cada comunidade é diferente. Uma agência de KOLs com 8 clientes tem necessidades bem distintas de uma única fundação com um Discord. A gente cota um valor que faz sentido, sem cobranças-surpresa por excedente, sem software na prateleira.' },
      { q: 'Quais plataformas vocês suportam hoje?', a: 'Discord, Telegram, Zealy, Galxe e Snapshot já estão integrados. Os dados do X / Twitter entram por importação de CSV. Plataformas de streaming, Twitch, YouTube Live e Kick, estão no roadmap e aparecem no painel de Integrações como “Em breve”.' },
      { q: 'Como funciona o pagamento dos moderadores?', a: 'Você define um valor em pontos para cada métrica que importa (mensagens no Discord, mensagens no Telegram, conteúdos no X, curtidas, incidentes resolvidos…), define uma taxa de pontos para moeda, e o Catch calcula quanto cada moderador ganhou. Ajustes e alterações manuais estão sempre disponíveis.' },
      { q: 'Vocês armazenam os dados da nossa comunidade?', a: 'Sim, métricas agregadas e metadados ficam no Supabase (Postgres) com segurança em nível de linha. O conteúdo das mensagens não é armazenado além do necessário para atribuição e registros de moderação.' },
      { q: 'Podemos usar white-label nos relatórios para nossos clientes?', a: 'Sim, no Agency e no Enterprise. Marca personalizada no PDF e no e-mail agendado, seu logo, seu domínio.' },
      { q: 'Vocês oferecem período de teste?', a: 'Preferimos uma call de onboarding de 30 minutos. Você mostra sua comunidade, a gente monta seu workspace com seus dados ao vivo durante a call. Se não fizer sentido, você não deve nada.' },
    ],
  },
  cta: {
    titlePre: 'Pronto para gerenciar suas comunidades como um',
    titleHighlight: 'time de operações de verdade',
    body: 'Agende uma call de 30 minutos. Vamos montar seu workspace com seus dados reais do Discord e do Telegram ao vivo na tela.',
    bookDemo: 'Agendar demo',
  },
  footer: { features: 'Recursos', pricing: 'Preços', faq: 'FAQ', contact: 'Contato' },
}

export const LANDING_CONTENT: Record<Lang, LandingContent> = { en, pt }
