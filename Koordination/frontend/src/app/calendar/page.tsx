'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { eventsApi } from '@/lib/api';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addWeeks, addMonths, subMonths, subWeeks, isSameDay, isSameMonth, parseISO, isToday } from 'date-fns';
import { de } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, Plus, MapPin, Clock, AlertTriangle } from 'lucide-react';
import EventModal from '@/components/calendar/EventModal';
import { Event } from '@/types';

type View = 'day' | 'week' | 'month';

const urgencyColors: Record<string, string> = {
  LOW: 'bg-green-500/20 border-green-500 text-green-300',
  NORMAL: 'bg-blue-500/20 border-blue-500 text-blue-300',
  HIGH: 'bg-orange-500/20 border-orange-500 text-orange-300',
  CRITICAL: 'bg-red-500/20 border-red-500 text-red-300',
};

export default function CalendarPage() {
  const { events, setEvents, addEvent, updateEvent, removeEvent } = useAppStore();
  const [view, setView] = useState<View>('month');
  const [current, setCurrent] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  useEffect(() => {
    const load = async () => {
      const from = startOfMonth(current).toISOString();
      const to = endOfMonth(current).toISOString();
      const res = await eventsApi.getAll(from, to);
      setEvents(res.data);
    };
    load();
  }, [current]);

  const navigate = (dir: 1 | -1) => {
    if (view === 'month') setCurrent(dir === 1 ? addMonths(current, 1) : subMonths(current, 1));
    else if (view === 'week') setCurrent(dir === 1 ? addWeeks(current, 1) : subWeeks(current, 1));
    else setCurrent(addDays(current, dir));
  };

  const eventsForDay = (day: Date) =>
    events.filter((e) => isSameDay(parseISO(e.start), day));

  const openNewEvent = (date?: Date) => {
    setSelectedEvent(null);
    setSelectedDate(date || current);
    setShowModal(true);
  };

  const openEditEvent = (event: Event) => {
    setSelectedEvent(event);
    setShowModal(true);
  };

  const handleSave = async (data: any) => {
    if (selectedEvent) {
      const res = await eventsApi.update(selectedEvent.id, data);
      updateEvent(res.data);
    } else {
      const res = await eventsApi.create(data);
      addEvent(res.data);
    }
    setShowModal(false);
  };

  const handleDelete = async (id: string) => {
    await eventsApi.delete(id);
    removeEvent(id);
    setShowModal(false);
  };

  const renderMonthView = () => {
    const start = startOfWeek(startOfMonth(current), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(current), { weekStartsOn: 1 });
    const days: Date[] = [];
    let d = start;
    while (d <= end) { days.push(d); d = addDays(d, 1); }

    return (
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-7 border-b border-slate-800">
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-slate-500">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 flex-1">
          {days.map((day) => {
            const dayEvents = eventsForDay(day);
            const inMonth = isSameMonth(day, current);
            return (
              <div
                key={day.toISOString()}
                onClick={() => openNewEvent(day)}
                className={`min-h-24 p-1.5 border-b border-r border-slate-800 cursor-pointer hover:bg-slate-800/30 transition-colors
                  ${!inMonth ? 'opacity-40' : ''} ${isToday(day) ? 'bg-blue-500/5' : ''}`}
              >
                <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1
                  ${isToday(day) ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>
                  {format(day, 'd')}
                </div>
                <div className="space-y-0.5">
                  {dayEvents.slice(0, 3).map((event) => (
                    <div
                      key={event.id}
                      onClick={(e) => { e.stopPropagation(); openEditEvent(event); }}
                      className={`text-xs px-1.5 py-0.5 rounded truncate border-l-2 cursor-pointer
                        ${urgencyColors[event.urgency] || urgencyColors.NORMAL}`}
                      style={{ borderLeftColor: event.categoryColor || undefined }}
                    >
                      {format(parseISO(event.start), 'HH:mm')} {event.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <p className="text-xs text-slate-500 px-1">+{dayEvents.length - 3} weitere</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(current, { weekStartsOn: 1 });
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const hours = Array.from({ length: 24 }, (_, i) => i);

    return (
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-8 border-b border-slate-800 sticky top-0 bg-slate-950 z-10">
          <div className="py-2 text-xs text-slate-600 text-center">Zeit</div>
          {days.map((day) => (
            <div key={day.toISOString()} className={`py-2 text-center ${isToday(day) ? 'text-blue-400' : 'text-slate-400'}`}>
              <p className="text-xs">{format(day, 'EEE', { locale: de })}</p>
              <p className={`text-sm font-semibold mt-0.5 w-7 h-7 mx-auto flex items-center justify-center rounded-full ${isToday(day) ? 'bg-blue-600 text-white' : ''}`}>{format(day, 'd')}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-8">
          <div>
            {hours.map((h) => (
              <div key={h} className="h-14 border-b border-slate-800/50 text-right pr-2 pt-1">
                <span className="text-xs text-slate-600">{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>
          {days.map((day) => (
            <div key={day.toISOString()} className="relative border-l border-slate-800">
              {hours.map((h) => (
                <div key={h} className="h-14 border-b border-slate-800/30 hover:bg-slate-800/20 cursor-pointer" onClick={() => openNewEvent(day)} />
              ))}
              {eventsForDay(day).map((event) => {
                const startH = parseISO(event.start).getHours() + parseISO(event.start).getMinutes() / 60;
                const endH = parseISO(event.end).getHours() + parseISO(event.end).getMinutes() / 60;
                const top = startH * 56;
                const height = Math.max((endH - startH) * 56, 28);
                return (
                  <div
                    key={event.id}
                    onClick={(e) => { e.stopPropagation(); openEditEvent(event); }}
                    className={`absolute left-0.5 right-0.5 px-1 py-0.5 rounded text-xs cursor-pointer border-l-2 overflow-hidden
                      ${urgencyColors[event.urgency] || urgencyColors.NORMAL}`}
                    style={{ top, height, borderLeftColor: event.categoryColor || undefined }}
                  >
                    <p className="font-medium truncate">{event.title}</p>
                    <p className="opacity-80">{format(parseISO(event.start), 'HH:mm')}</p>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const dayEvents = eventsForDay(current);
    return (
      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-[60px_1fr]">
          <div />
          <div className="text-center py-2 border-b border-slate-800">
            <p className="text-sm font-semibold text-slate-300">{format(current, 'EEEE, d. MMMM', { locale: de })}</p>
          </div>
        </div>
        <div className="grid grid-cols-[60px_1fr] relative">
          <div>
            {hours.map((h) => (
              <div key={h} className="h-14 border-b border-slate-800/50 text-right pr-2 pt-1">
                <span className="text-xs text-slate-600">{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>
          <div className="relative border-l border-slate-800">
            {hours.map((h) => (
              <div key={h} className="h-14 border-b border-slate-800/30 hover:bg-slate-800/20 cursor-pointer" onClick={() => openNewEvent(current)} />
            ))}
            {dayEvents.map((event) => {
              const startH = parseISO(event.start).getHours() + parseISO(event.start).getMinutes() / 60;
              const endH = parseISO(event.end).getHours() + parseISO(event.end).getMinutes() / 60;
              return (
                <div
                  key={event.id}
                  onClick={(e) => { e.stopPropagation(); openEditEvent(event); }}
                  className={`absolute left-1 right-1 px-2 py-1 rounded cursor-pointer border-l-2 ${urgencyColors[event.urgency] || urgencyColors.NORMAL}`}
                  style={{ top: startH * 56, height: Math.max((endH - startH) * 56, 40), borderLeftColor: event.categoryColor || undefined }}
                >
                  <p className="font-medium text-sm truncate">{event.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Clock size={11} className="opacity-70" />
                    <span className="text-xs opacity-80">{format(parseISO(event.start), 'HH:mm')} – {format(parseISO(event.end), 'HH:mm')}</span>
                    {event.location && <><MapPin size={11} className="opacity-70" /><span className="text-xs opacity-80 truncate">{event.location}</span></>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full -m-4 md:-m-6">
      <div className="flex items-center gap-3 p-4 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"><ChevronLeft size={18} /></button>
          <button onClick={() => setCurrent(new Date())} className="px-3 py-1.5 rounded-lg hover:bg-slate-800 text-sm font-medium text-slate-300">Heute</button>
          <button onClick={() => navigate(1)} className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"><ChevronRight size={18} /></button>
        </div>
        <h2 className="font-semibold text-white flex-1">
          {view === 'month' && format(current, 'MMMM yyyy', { locale: de })}
          {view === 'week' && `KW ${format(current, 'w')} · ${format(startOfWeek(current, { weekStartsOn: 1 }), 'd. MMM', { locale: de })} – ${format(endOfWeek(current, { weekStartsOn: 1 }), 'd. MMM yyyy', { locale: de })}`}
          {view === 'day' && format(current, 'EEEE, d. MMMM yyyy', { locale: de })}
        </h2>
        <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === v ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}>
              {v === 'day' ? 'Tag' : v === 'week' ? 'Woche' : 'Monat'}
            </button>
          ))}
        </div>
        <button onClick={() => openNewEvent()} className="btn-primary flex items-center gap-1.5 text-sm py-1.5">
          <Plus size={16} />
          <span className="hidden sm:inline">Neu</span>
        </button>
      </div>

      {view === 'month' && renderMonthView()}
      {view === 'week' && renderWeekView()}
      {view === 'day' && renderDayView()}

      {showModal && (
        <EventModal
          event={selectedEvent}
          defaultDate={selectedDate}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
