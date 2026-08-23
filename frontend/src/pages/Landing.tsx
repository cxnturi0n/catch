import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  PlayCircle,
  BarChart3,
  ShieldCheck,
  Users,
  Megaphone,
  Calendar,
  FileText,
  Plug,
  Sliders,
  Zap,
  Check,
  Minus,
  ChevronDown,
  Mail,
  type LucideIcon,
} from 'lucide-react'
import { CatchMark } from '../components/brand/CatchMark'
import { BrandBackdrop } from '../components/brand/BrandBackdrop'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../i18n/LanguageContext'
import { LANDING_CONTENT, type LandingContent } from '../i18n/landing'

const CONTACT_EMAIL = 'hello@catch.app'
const contactHref = (subject: string) =>
  `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`

// Icons + structural meta live in the component; all text comes from LANDING_CONTENT.
const FEATURE_ICONS: LucideIcon[] = [BarChart3, ShieldCheck, Users, Megaphone, Calendar, FileText]
const STEP_ICONS: LucideIcon[] = [Plug, Sliders, Zap]
const PLAN_META = [
  { name: 'Starter', highlight: false },
  { name: 'Pro', highlight: false },
  { name: 'Agency', highlight: true },
  { name: 'Enterprise', highlight: false },
] as const

export function Landing({ forcePublic = false }: { forcePublic?: boolean } = {}) {
  const navigate = useNavigate()
  const { isAuthenticated, isLoading } = useAuth()
  const { lang } = useLang()
  const c = LANDING_CONTENT[lang]

  // Root ("/") redirects authenticated users into the app. The dedicated
  // "/landing" route sets forcePublic to keep the marketing page visible
  // so the same URL can be shared with prospects.
  if (!forcePublic && !isLoading && isAuthenticated) return <Navigate to="/dashboard" replace />

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#070b12] text-white">
      <BrandBackdrop intensity={1.2} />

      <SiteHeader c={c} />

      <main className="relative z-10">
        <Hero c={c} onDemo={() => navigate('/login')} />
        <Features c={c} />
        <HowItWorks c={c} />
        <Pricing c={c} />
        <FAQ c={c} />
        <ContactCTA c={c} />
      </main>

      <SiteFooter c={c} />
    </div>
  )
}

/* ---------------- Header ---------------- */

function SiteHeader({ c }: { c: LandingContent }) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-[#070b12]/70 px-6 py-4 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <CatchMark size={32} play={false} />
          <span className="text-shine text-xl font-extrabold tracking-tight">Catch</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-slate-300 md:flex">
          <a href="#features" className="hover:text-white">{c.nav.features}</a>
          <a href="#how" className="hover:text-white">{c.nav.how}</a>
          <a href="#pricing" className="hover:text-white">{c.nav.pricing}</a>
          <a href="#faq" className="hover:text-white">{c.nav.faq}</a>
        </nav>
        <div className="flex items-center gap-2 text-sm">
          <LanguageSwitcher />
          <Link to="/login" className="rounded-lg px-3 py-2 font-medium text-slate-300 hover:text-white">
            {c.nav.signIn}
          </Link>
          <a
            href={contactHref('Catch, book a demo')}
            className="gradient-bar-emerald sheen rounded-lg px-4 py-2 font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:shadow-[var(--glow-emerald-strong)]"
          >
            {c.nav.bookDemo}
          </a>
        </div>
      </div>
    </header>
  )
}

/* ---------------- Hero ---------------- */

function Hero({ c, onDemo }: { c: LandingContent; onDemo: () => void }) {
  return (
    <section className="relative flex flex-col items-center px-6 pt-16 pb-24 text-center sm:pt-24 sm:pb-32">
      <div className="relative mb-9 flex items-center justify-center">
        <div
          className="animate-breathe pointer-events-none absolute h-64 w-64 rounded-full blur-[90px]"
          style={{
            background:
              'radial-gradient(circle, rgba(77,159,255,0.55), rgba(47,124,246,0.25) 55%, transparent 75%)',
          }}
        />
        <CatchMark size={132} />
      </div>

      <motion.h1
        initial={{ y: 16 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="max-w-3xl text-4xl font-bold leading-tight text-white sm:text-6xl"
      >
        {c.hero.titlePre} <span className="gradient-text-emerald">{c.hero.titleHighlight}</span>
      </motion.h1>

      <motion.p
        initial={{ y: 16 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, delay: 0.65 }}
        className="mt-5 max-w-xl text-lg text-slate-400"
      >
        {c.hero.subtitle}
      </motion.p>

      <motion.div
        initial={{ y: 16 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.6, delay: 0.8 }}
        className="mt-10 flex flex-wrap items-center justify-center gap-4"
      >
        <button
          onClick={onDemo}
          className="gradient-bar-emerald sheen flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:shadow-[var(--glow-emerald-strong)]"
        >
          <PlayCircle size={16} /> {c.hero.cta} <ArrowRight size={16} />
        </button>
      </motion.div>

      <div className="mt-16 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs uppercase tracking-[0.2em] text-slate-500">
        <span>Discord</span>
        <span>Telegram</span>
        <span>Zealy</span>
        <span>Galxe</span>
        <span>Snapshot</span>
        <span>X / Twitter</span>
        <span>Twitch</span>
        <span>YouTube Live</span>
        <span>Kick</span>
      </div>
    </section>
  )
}

/* ---------------- Features ---------------- */

function Features({ c }: { c: LandingContent }) {
  return (
    <Section id="features" eyebrow={c.features.eyebrow} title={c.features.title}>
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {c.features.items.map((item, i) => {
          const Icon = FEATURE_ICONS[i]
          return (
            <div
              key={item.title}
              className="glass rounded-2xl p-6 transition-all hover:border-[var(--accent-emerald)]/40 hover:shadow-[var(--glow-soft)]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent-cyan)]/25 to-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]">
                {Icon && <Icon size={20} />}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

/* ---------------- How it works ---------------- */

function HowItWorks({ c }: { c: LandingContent }) {
  return (
    <Section id="how" eyebrow={c.how.eyebrow} title={c.how.title}>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {c.how.steps.map((step, i) => {
          const Icon = STEP_ICONS[i]
          return (
            <div key={step.title} className="glass relative rounded-2xl p-6">
              <div className="absolute right-5 top-5 text-4xl font-black text-white/[0.06]">0{i + 1}</div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent-cyan)]/25 to-[var(--accent-emerald)]/15 text-[var(--accent-emerald-bright)]">
                {Icon && <Icon size={20} />}
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>
            </div>
          )
        })}
      </div>
    </Section>
  )
}

/* ---------------- Pricing ---------------- */

type PlanRowValue = boolean | string

function Pricing({ c }: { c: LandingContent }) {
  return (
    <Section id="pricing" eyebrow={c.pricing.eyebrow} title={c.pricing.title} subtitle={c.pricing.subtitle}>
      {/* Tier cards */}
      <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PLAN_META.map((p, i) => (
          <div
            key={p.name}
            className={`relative rounded-2xl p-6 transition-all ${
              p.highlight
                ? 'border border-[var(--accent-emerald)]/60 bg-gradient-to-b from-[var(--accent-emerald)]/[0.08] to-transparent shadow-[var(--glow-emerald)]'
                : 'glass'
            }`}
          >
            {p.highlight && (
              <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-[var(--accent-cyan)] to-[var(--accent-emerald)] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                {c.pricing.mostPopular}
              </span>
            )}
            <h3 className="text-xl font-bold text-white">{p.name}</h3>
            <p className="mt-1 min-h-[2.5rem] text-sm text-slate-400">{c.pricing.plans[i].tagline}</p>
            <div className="mt-6">
              <div className="text-2xl font-bold text-white">{c.pricing.custom}</div>
              <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">{c.pricing.quoted}</div>
            </div>
            <a
              href={contactHref(`Catch, ${p.name} plan inquiry`)}
              className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all ${
                p.highlight
                  ? 'gradient-bar-emerald sheen text-white shadow-[var(--glow-emerald)] hover:shadow-[var(--glow-emerald-strong)]'
                  : 'border border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.07]'
              }`}
            >
              {c.pricing.contact} <ArrowRight size={14} />
            </a>
          </div>
        ))}
      </div>

      {/* Comparison table */}
      <div className="mt-14 overflow-x-auto">
        <div className="glass min-w-[720px] rounded-2xl p-2">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-slate-500">
                <th className="w-1/3 px-4 py-4 font-medium">{c.pricing.included}</th>
                {PLAN_META.map((p) => (
                  <th
                    key={p.name}
                    className={`px-4 py-4 text-center font-semibold ${
                      p.highlight ? 'text-[var(--accent-emerald-bright)]' : 'text-white'
                    }`}
                  >
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {c.pricing.features.map((row) => (
                <tr key={row.label} className="border-t border-white/[0.05]">
                  <td className="px-4 py-3 text-slate-300">{row.label}</td>
                  {row.values.map((v, i) => (
                    <td
                      key={i}
                      className={`px-4 py-3 text-center ${
                        PLAN_META[i].highlight ? 'bg-[var(--accent-emerald)]/[0.04]' : ''
                      }`}
                    >
                      <PlanCell value={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-slate-500">{c.pricing.footnote}</p>
    </Section>
  )
}

function PlanCell({ value }: { value: PlanRowValue }) {
  if (value === true) return <Check size={16} className="mx-auto text-[var(--accent-emerald-bright)]" />
  if (value === false) return <Minus size={16} className="mx-auto text-slate-600" />
  return <span className="text-xs text-slate-200">{value}</span>
}

/* ---------------- FAQ ---------------- */

function FAQ({ c }: { c: LandingContent }) {
  return (
    <Section id="faq" eyebrow={c.faq.eyebrow} title={c.faq.title}>
      <div className="mt-10 mx-auto max-w-3xl divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06] bg-white/[0.02]">
        {c.faq.items.map((f) => (
          <FAQItem key={f.q} q={f.q} a={f.a} />
        ))}
      </div>
    </Section>
  )
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <button
      onClick={() => setOpen((v) => !v)}
      className="flex w-full items-start justify-between gap-6 px-6 py-5 text-left transition-colors hover:bg-white/[0.02]"
    >
      <div className="flex-1">
        <div className="text-base font-semibold text-white">{q}</div>
        {open && <p className="mt-3 text-sm leading-relaxed text-slate-400">{a}</p>}
      </div>
      <ChevronDown
        size={18}
        className={`mt-1 flex-shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
      />
    </button>
  )
}

/* ---------------- Contact CTA ---------------- */

function ContactCTA({ c }: { c: LandingContent }) {
  return (
    <section className="relative px-6 py-24">
      <div className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-[var(--accent-emerald)]/30 bg-gradient-to-br from-[var(--accent-cyan)]/[0.12] via-[var(--accent-emerald)]/[0.06] to-transparent p-10 text-center shadow-[var(--glow-emerald)] sm:p-14">
        <h2 className="text-3xl font-bold text-white sm:text-4xl">
          {c.cta.titlePre} <span className="gradient-text-emerald">{c.cta.titleHighlight}</span>?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-slate-300">{c.cta.body}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href={contactHref('Catch, book a demo')}
            className="gradient-bar-emerald sheen inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-[var(--glow-emerald)] transition-all hover:shadow-[var(--glow-emerald-strong)]"
          >
            <Mail size={16} /> {c.cta.bookDemo}
          </a>
          <a
            href={contactHref('Catch, general inquiry')}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.08]"
          >
            {CONTACT_EMAIL}
          </a>
        </div>
      </div>
    </section>
  )
}

/* ---------------- Footer ---------------- */

function SiteFooter({ c }: { c: LandingContent }) {
  return (
    <footer className="relative z-10 border-t border-white/[0.06] px-6 py-10 text-sm text-slate-500">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 md:flex-row">
        <div className="flex items-center gap-2">
          <CatchMark size={22} play={false} />
          <span className="text-shine font-bold">Catch</span>
          <span className="ml-2 text-xs">© {new Date().getFullYear()}</span>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <a href="#features" className="hover:text-white">{c.footer.features}</a>
          <a href="#pricing" className="hover:text-white">{c.footer.pricing}</a>
          <a href="#faq" className="hover:text-white">{c.footer.faq}</a>
          <a href={contactHref('Catch, hello')} className="hover:text-white">{c.footer.contact}</a>
        </div>
      </div>
    </footer>
  )
}

/* ---------------- Section shell ---------------- */

function Section({
  id,
  eyebrow,
  title,
  subtitle,
  children,
}: {
  id: string
  eyebrow: string
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="relative px-6 py-24 sm:py-28">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--accent-emerald-bright)]">
            {eyebrow}
          </div>
          <h2 className="mt-4 text-3xl font-bold text-white sm:text-4xl">{title}</h2>
          {subtitle && <p className="mt-4 text-slate-400">{subtitle}</p>}
        </div>
        {children}
      </div>
    </section>
  )
}
