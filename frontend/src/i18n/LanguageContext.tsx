import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// Lightweight i18n. Today it powers the public marketing surface (Landing);
// the dashboard is translated incrementally on top of the same provider.
export type Lang = 'en' | 'pt'

const STORAGE_KEY = 'catch:lang'

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'en'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'pt') return stored
  const nav = (navigator.language || '').toLowerCase()
  return nav.startsWith('pt') ? 'pt' : 'en'
}

interface LangCtx {
  lang: Lang
  setLang: (l: Lang) => void
}

const Ctx = createContext<LangCtx>({ lang: 'en', setLang: () => {} })

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  function setLang(l: Lang) {
    setLangState(l)
    try {
      window.localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* storage unavailable, choice still applies for this session */
    }
  }

  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>
}

export function useLang() {
  return useContext(Ctx)
}
