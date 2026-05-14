'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, BarChart2, Database, Settings, FlaskConical } from 'lucide-react'
import clsx from 'clsx'

const links = [
  { href: '/review',   label: '综述选题',   icon: BookOpen },
  { href: '/meta',     label: 'Meta 分析',  icon: BarChart2 },
  { href: '/clinical', label: '临床数据',   icon: Database },
]

export default function Nav() {
  const pathname = usePathname()

  return (
    <nav className="border-b border-gray-100 bg-white sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        <Link href="/" className="flex items-center gap-2 font-semibold text-primary-700">
          <FlaskConical className="w-5 h-5" />
          <span>Lucye的临床科研选题助手</span>
        </Link>

        <div className="flex items-center gap-1">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                pathname.startsWith(href)
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          ))}
        </div>

        <Link
          href="/config"
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            pathname === '/config'
              ? 'bg-primary-50 text-primary-700'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
          )}
        >
          <Settings className="w-4 h-4" />
          API 配置
        </Link>
      </div>
    </nav>
  )
}
