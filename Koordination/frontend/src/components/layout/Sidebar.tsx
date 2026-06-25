'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Calendar, CheckSquare, Bell, Share2, Users, Home, Settings, LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useRouter } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/calendar', label: 'Kalender', icon: Calendar },
  { href: '/tasks', label: 'Aufgaben', icon: CheckSquare },
  { href: '/reminders', label: 'Erinnerungen', icon: Bell },
  { href: '/sharing', label: 'Nachrichten', icon: Share2 },
  { href: '/groups', label: 'Teams', icon: Users },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { logout, user } = useAuthStore();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push('/auth/login');
  };

  return (
    <aside className="hidden md:flex flex-col w-60 bg-slate-900 border-r border-slate-800 shrink-0">
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold text-sm">K</div>
          <div>
            <p className="font-semibold text-sm text-white">Koordination</p>
            <p className="text-xs text-slate-500">Version {process.env.NEXT_PUBLIC_VERSION}</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-0.5">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${active
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-800 space-y-0.5">
        <Link href="/settings" className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
          <Settings size={18} />
          Einstellungen
        </Link>
        <button onClick={handleLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors">
          <LogOut size={18} />
          Abmelden
        </button>
        <div className="px-3 py-2 mt-1">
          <p className="text-xs text-slate-500 truncate">{user?.name}</p>
          <p className="text-xs text-slate-600 truncate">{user?.email}</p>
        </div>
      </div>
    </aside>
  );
}
