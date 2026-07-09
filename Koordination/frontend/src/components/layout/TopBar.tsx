'use client';

import { useState } from 'react';
import { Bell, Menu, BellRing, BellOff } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { usePathname } from 'next/navigation';
import { usePushNotifications } from '@/hooks/usePushNotifications';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/calendar': 'Kalender',
  '/tasks': 'Aufgaben',
  '/reminders': 'Erinnerungen',
  '/sharing': 'Nachrichten',
  '/groups': 'Teams',
  '/settings': 'Einstellungen',
};

export default function TopBar() {
  const pathname = usePathname() || '/';
  const notifications = useAppStore((s) => s.notifications);
  const unread = notifications.filter((n) => !n.read).length;
  const [showNotifs, setShowNotifs] = useState(false);
  const markRead = useAppStore((s) => s.markNotificationRead);
  const { subscribed, supported, subscribe, unsubscribe } = usePushNotifications();

  const title = pageTitles[pathname] || pageTitles[Object.keys(pageTitles).find((k) => pathname.startsWith(k) && k !== '/') || ''] || 'Koordination';

  const handlePushToggle = async () => {
    if (subscribed) {
      await unsubscribe();
    } else {
      await subscribe();
    }
  };

  return (
    <header className="h-14 bg-slate-900 border-b border-slate-800 flex items-center px-4 gap-3 shrink-0">
      <button className="md:hidden p-1.5 rounded-lg hover:bg-slate-800 text-slate-400">
        <Menu size={20} />
      </button>

      <h1 className="font-semibold text-base text-white flex-1">{title}</h1>

      <div className="flex items-center gap-2">
        {supported && (
          <button
            onClick={handlePushToggle}
            title={subscribed ? 'Push-Benachrichtigungen deaktivieren' : 'Push-Benachrichtigungen aktivieren'}
            className={`p-2 rounded-lg transition-colors ${
              subscribed ? 'text-blue-400 hover:bg-blue-500/10' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
            }`}
          >
            {subscribed ? <BellRing size={18} /> : <BellOff size={18} />}
          </button>
        )}

        <div className="relative">
          <button
            onClick={() => setShowNotifs(!showNotifs)}
            className="relative p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <Bell size={18} />
            {unread > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full" />
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-10 w-80 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-700 flex items-center justify-between">
                <span className="text-sm font-medium">Benachrichtigungen</span>
                <span className="text-xs text-slate-500">{unread} neu</span>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="text-sm text-slate-500 p-4 text-center">Keine Benachrichtigungen</p>
                ) : (
                  notifications.slice(0, 20).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => markRead(n.id)}
                      className={`w-full text-left px-4 py-3 border-b border-slate-700 hover:bg-slate-700 transition-colors ${!n.read ? 'bg-slate-700/50' : ''}`}
                    >
                      <p className="text-sm text-slate-200">{n.message}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{new Date(n.createdAt).toLocaleTimeString('de-DE')}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
