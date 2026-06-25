'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useAppStore } from '@/store/appStore';
import { eventsApi, tasksApi, remindersApi } from '@/lib/api';
import { Calendar, CheckSquare, Bell, Share2, TrendingUp, Clock, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { format, isToday, isTomorrow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, user } = useAuthStore();
  const { events, tasks, reminders, setEvents, setTasks, setReminders } = useAppStore();

  useEffect(() => {
    if (!isAuthenticated) { router.push('/auth/login'); return; }
    const load = async () => {
      const now = new Date();
      const [evRes, tkRes, rmRes] = await Promise.allSettled([
        eventsApi.getAll(now.toISOString(), new Date(now.getTime() + 7 * 86400000).toISOString()),
        tasksApi.getAll(),
        remindersApi.getAll(),
      ]);
      if (evRes.status === 'fulfilled') setEvents(evRes.value.data);
      if (tkRes.status === 'fulfilled') setTasks(tkRes.value.data);
      if (rmRes.status === 'fulfilled') setReminders(rmRes.value.data);
    };
    load();
  }, [isAuthenticated]);

  const todayEvents = events.filter((e) => isToday(parseISO(e.start)));
  const tomorrowEvents = events.filter((e) => isTomorrow(parseISO(e.start)));
  const openTasks = tasks.filter((t) => t.status === 'OPEN');
  const highPriorityTasks = tasks.filter((t) => t.priority === 'HIGH' && t.status !== 'DONE');
  const upcomingReminders = reminders.filter((r) => !r.sent && new Date(r.triggerAt) > new Date()).slice(0, 3);

  const stats = [
    { label: 'Heutige Termine', value: todayEvents.length, icon: Calendar, color: 'text-blue-400', bg: 'bg-blue-500/10', href: '/calendar' },
    { label: 'Offene Aufgaben', value: openTasks.length, icon: CheckSquare, color: 'text-emerald-400', bg: 'bg-emerald-500/10', href: '/tasks' },
    { label: 'Erinnerungen', value: upcomingReminders.length, icon: Bell, color: 'text-amber-400', bg: 'bg-amber-500/10', href: '/reminders' },
    { label: 'Hohe Priorität', value: highPriorityTasks.length, icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10', href: '/tasks?priority=HIGH' },
  ];

  const priorityLabel: Record<string, string> = { LOW: 'Niedrig', MEDIUM: 'Mittel', HIGH: 'Hoch' };
  const statusLabel: Record<string, string> = { OPEN: 'Offen', IN_PROGRESS: 'In Arbeit', DONE: 'Erledigt' };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-2xl font-bold text-white">
          Guten {new Date().getHours() < 12 ? 'Morgen' : new Date().getHours() < 18 ? 'Tag' : 'Abend'}, {user?.name?.split(' ')[0]} 👋
        </h2>
        <p className="text-slate-400 text-sm mt-1">{format(new Date(), "EEEE, d. MMMM yyyy", { locale: de })}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(({ label, value, icon: Icon, color, bg, href }) => (
          <Link key={label} href={href} className="card hover:border-slate-600 transition-colors group">
            <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center mb-3`}>
              <Icon size={18} className={color} />
            </div>
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-xs text-slate-400 mt-0.5">{label}</p>
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-slate-300">Heute & Morgen</h3>
            <Link href="/calendar" className="text-xs text-blue-400 hover:text-blue-300">Alle →</Link>
          </div>
          {[...todayEvents.map((e) => ({ ...e, day: 'Heute' })), ...tomorrowEvents.map((e) => ({ ...e, day: 'Morgen' }))].length === 0 ? (
            <p className="text-slate-500 text-sm py-2">Keine Termine in den nächsten Tagen</p>
          ) : (
            [...todayEvents.map((e) => ({ ...e, day: 'Heute' })), ...tomorrowEvents.map((e) => ({ ...e, day: 'Morgen' }))].slice(0, 4).map((event) => (
              <div key={event.id} className="flex items-start gap-3 py-2 border-b border-slate-700/50 last:border-0">
                <div className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ backgroundColor: event.categoryColor || '#3b82f6' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{event.title}</p>
                  <p className="text-xs text-slate-500">{event.day} · {format(parseISO(event.start), 'HH:mm')} Uhr{event.location ? ` · ${event.location}` : ''}</p>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-slate-300">Offene Aufgaben</h3>
            <Link href="/tasks" className="text-xs text-blue-400 hover:text-blue-300">Alle →</Link>
          </div>
          {openTasks.length === 0 ? (
            <p className="text-slate-500 text-sm py-2">Keine offenen Aufgaben</p>
          ) : (
            openTasks.slice(0, 4).map((task) => (
              <div key={task.id} className="flex items-center gap-3 py-2 border-b border-slate-700/50 last:border-0">
                <div className={`w-2 h-2 rounded-full shrink-0 ${task.priority === 'HIGH' ? 'bg-red-500' : task.priority === 'MEDIUM' ? 'bg-yellow-500' : 'bg-green-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{task.title}</p>
                  <p className="text-xs text-slate-500">{priorityLabel[task.priority]}{task.dueDate ? ` · Fällig ${format(parseISO(task.dueDate), 'd. MMM', { locale: de })}` : ''}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {upcomingReminders.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm text-slate-300">Nächste Erinnerungen</h3>
            <Link href="/reminders" className="text-xs text-blue-400 hover:text-blue-300">Alle →</Link>
          </div>
          <div className="space-y-2">
            {upcomingReminders.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2">
                <Clock size={14} className="text-amber-400 shrink-0" />
                <div>
                  <p className="text-sm text-white">{r.message || 'Erinnerung'}</p>
                  <p className="text-xs text-slate-500">{format(parseISO(r.triggerAt), "d. MMM 'um' HH:mm 'Uhr'", { locale: de })}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
