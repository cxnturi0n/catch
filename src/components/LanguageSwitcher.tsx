import { useLang, type Lang } from '../i18n/LanguageContext'

const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'pt', label: 'PT' },
]

/** Compact EN/PT toggle. `tone` adapts it to dark (landing) or default surfaces. */
export function LanguageSwitcher({ tone = 'dark' }: { tone?: 'dark' | 'surface' }) {
  const { lang, setLang } = useLang()
  const border = tone === 'dark' ? 'border-white/10' : 'border-[var(--border-card)]'
  return (
    <div className={`inline-flex rounded-lg border ${border} p-0.5 text-xs font-semibold`} role="group" aria-label="Language">
      {LANGS.map((l) => {
        const active = lang === l.id
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => setLang(l.id)}
            aria-pressed={active}
            className={`rounded-md px-2 py-1 transition-colors ${
              active ? 'bg-white/[0.12] text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {l.label}
          </button>
        )
      })}
    </div>
  )
}
