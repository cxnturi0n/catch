// Animated sapphire gem background for the public discovery form. Self-contained
// (styles live in discovery.css); imports nothing from the dashboard. One fixed
// layer, mounted once per step. Only transform/opacity animate; a scrim on top
// protects readability. Honours prefers-reduced-motion and print via CSS.

type GemVariant = 'crown' | 'corner'

/**
 * `crown`, Step 1: the gem rises from the bottom edge, centred (hero).
 * `corner`, Step 2: a smaller gem cropped by the top-right corner (content-dense).
 */
export function SapphireGem({ variant }: { variant: GemVariant }) {
  return (
    <div aria-hidden="true" className={`df-gem df-gem--${variant}`}>
      <div className="df-gem__glow df-glow-a" />
      {variant === 'corner' && <div className="df-gem__glow df-glow-b" />}
      <div className="df-gem__wrap">
        <div className="df-gem__facet df-c-body" />
        <div className="df-gem__facet df-c-crown" />
        <div className="df-gem__facet df-c-right" />
        {variant === 'crown' && <div className="df-gem__facet df-c-left" />}
        <div className="df-gem__facet df-c-shadow" />
      </div>
      <div className="df-gem__scrim" />
    </div>
  )
}
