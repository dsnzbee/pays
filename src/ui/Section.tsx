import { ReactNode, useState } from 'react'

/** Accordion section: closed unless `defaultOpen`. */
export function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={'acc' + (open ? ' open' : '')}>
      <button className="acc-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span>{title}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      {open && <div className="acc-body">{children}</div>}
    </section>
  )
}
