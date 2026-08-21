import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, XCircle } from 'lucide-react'

export type ToastType = 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  type: ToastType
}

export function ToastViewport({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div className="pointer-events-none fixed top-6 right-6 z-[100] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.95 }}
            className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm text-[var(--text-primary)] shadow-xl ${
              t.type === 'success'
                ? 'border-[var(--border-card)] bg-[var(--bg-card)] shadow-[var(--glow-emerald)]'
                : 'border-red-500/40 bg-[var(--bg-card)]'
            }`}
          >
            {t.type === 'success' ? (
              <CheckCircle2 size={18} className="text-blue-400" />
            ) : (
              <XCircle size={18} className="text-red-400" />
            )}
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
