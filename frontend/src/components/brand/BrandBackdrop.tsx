import { CircuitField } from './CircuitField'

/**
 * Full-surface ambient backdrop: deep emerald/cyan radial pools, a receding
 * cybernetic circuit plane with sporadic electricity, and a vignette so content
 * stays legible. Absolutely positioned behind page content, the parent must be
 * `relative`; content should sit in a `relative z-10` layer above it.
 */
export function BrandBackdrop({ intensity = 1 }: { intensity?: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="ambient-field absolute inset-0" />
      <CircuitField intensity={intensity} />
      {/* Soft sapphire light bloom, "light from a sapphire" */}
      <div
        className="animate-breathe absolute inset-0"
        style={{ background: 'radial-gradient(60% 55% at 50% 34%, rgba(77,159,255,0.16), transparent 66%)' }}
      />
      {/* Vignette so edges fall into black and content stays legible */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 90% at 50% 40%, transparent 45%, rgba(3,6,12,0.62) 100%)' }}
      />
    </div>
  )
}
