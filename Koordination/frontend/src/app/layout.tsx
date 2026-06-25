'use client';

import './globals.css';
import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { connectSocket } from '@/lib/socket';
import { useAppStore } from '@/store/appStore';
import { getSocket } from '@/lib/socket';
import Sidebar from '@/components/layout/Sidebar';
import TopBar from '@/components/layout/TopBar';
import { usePathname } from 'next/navigation';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, token } = useAuthStore();
  const addNotification = useAppStore((s) => s.addNotification);
  const { addEvent, updateEvent, addTask, updateTask } = useAppStore();
  const pathname = usePathname();
  const isAuthPage = pathname?.startsWith('/auth');

  useEffect(() => {
    if (isAuthenticated && token) {
      const socket = connectSocket(token);
      socket.on('reminder', (data) => {
        addNotification({ type: 'reminder', message: data.message || 'Erinnerung', data });
      });
      socket.on('new-message', (data) => {
        addNotification({ type: 'message', message: `Neue Nachricht: ${data.subject}`, data });
      });
      socket.on('message-reaction', (data) => {
        addNotification({ type: 'reaction', message: 'Reaktion auf deine Nachricht', data });
      });
      socket.on('event-updated', updateEvent);
      socket.on('task-updated', updateTask);
    }
  }, [isAuthenticated, token]);

  return (
    <html lang="de" className="dark">
      <head>
        <title>Koordination</title>
        <meta name="description" content="Smart Calendar & Task Management" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="bg-slate-950 text-slate-100 min-h-screen">
        {isAuthPage || !isAuthenticated ? (
          <main>{children}</main>
        ) : (
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <TopBar />
              <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
            </div>
          </div>
        )}
      </body>
    </html>
  );
}
