import type { ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export function PageHeading({ title, description, back, action }: { title: string; description?: string; back?: string; action?: ReactNode }) {
  return <header className="app-page-heading"><div>{back && <Link className="app-back" to={back}><ArrowLeft size={17} aria-hidden />Kembali</Link>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>
}
