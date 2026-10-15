import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = { title: 'BusinessHub AI — Your business, in one place', description: 'The all-in-one workspace for freelancers and agencies.' }
export const viewport = { themeColor: '#071225', width: 'device-width', initialScale: 1 }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html> }
