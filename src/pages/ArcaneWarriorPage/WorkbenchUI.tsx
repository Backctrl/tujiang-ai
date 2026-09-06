import type { ReactNode } from 'react'
import arcaneWarriorLogo from '@shared/static/images/arcane-warrior-brand-source.png'
export function StatusDot({ tone = 'violet' }: { tone?: 'violet' | 'green' | 'yellow' | 'red' | 'muted' }) {
  return <span className={`status-dot ${tone}`} />
}

export function Chip({ children, tone = 'violet' }: { children: ReactNode; tone?: 'violet' | 'green' | 'yellow' | 'red' | 'muted' }) {
  return <span className={`chip ${tone}`}>{children}</span>
}

export function Button({ children, tone = 'ghost', disabled, onClick, className = '' }: { children: ReactNode; tone?: 'primary' | 'violet' | 'ghost' | 'danger'; disabled?: boolean; onClick?: () => void; className?: string }) {
  return <button type="button" className={`button ${tone} ${className}`} disabled={disabled} onClick={onClick}>{children}</button>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label"><span />{children}</div>
}

export function PanelTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="panel-title">
      <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>
      {action}
    </div>
  )
}

export function ClientLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`client-logo ${compact ? 'compact' : ''}`} role="img" aria-label="ARCANE WARRIOR">
      <img src={arcaneWarriorLogo} alt="" aria-hidden="true" />
    </span>
  )
}

export function BrandMark() {
  return (
    <div className="brand">
      <ClientLogo />
    </div>
  )
}

