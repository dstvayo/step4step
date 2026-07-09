'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Calendar, CheckSquare, Bell, MessageSquare, Users } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/calendar', icon: Calendar, label: 'Kalender' },
  { href: '/tasks', icon: CheckSquare, label: 'Aufgaben' },
  { href: '/reminders', icon: Bell, label: 'Erinnerungen' },
  { href: '/sharing', icon: MessageSquare, label: 'Nachrichten' },
  { href: '/groups', icon: Users, label: 'Teams' },
];

export default function MobileNav() {
  const pathname = usePathname() || '/';

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 z-40 safe-area-inset-bottom">
      <div className="flex items-center justify-around px-2 py-2 pb-safe">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-colors min-w-0
                ${active ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 1.8} />
              <span className="text-[10px] font-medium truncate">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
