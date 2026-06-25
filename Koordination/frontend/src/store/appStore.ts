import { create } from 'zustand';
import { Event, Task, Reminder, SharedMessage, Group, User } from '@/types';

interface AppState {
  events: Event[];
  tasks: Task[];
  reminders: Reminder[];
  messages: SharedMessage[];
  groups: Group[];
  users: User[];
  notifications: Array<{ id: string; type: string; message: string; data?: any; read: boolean; createdAt: Date }>;

  setEvents: (events: Event[]) => void;
  addEvent: (event: Event) => void;
  updateEvent: (event: Event) => void;
  removeEvent: (id: string) => void;

  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  removeTask: (id: string) => void;

  setReminders: (reminders: Reminder[]) => void;
  addReminder: (reminder: Reminder) => void;
  removeReminder: (id: string) => void;

  setMessages: (messages: SharedMessage[]) => void;
  addMessage: (message: SharedMessage) => void;

  setGroups: (groups: Group[]) => void;
  setUsers: (users: User[]) => void;

  addNotification: (notification: Omit<AppState['notifications'][0], 'id' | 'read' | 'createdAt'>) => void;
  markNotificationRead: (id: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  events: [],
  tasks: [],
  reminders: [],
  messages: [],
  groups: [],
  users: [],
  notifications: [],

  setEvents: (events) => set({ events }),
  addEvent: (event) => set((s) => ({ events: [...s.events, event] })),
  updateEvent: (event) => set((s) => ({ events: s.events.map((e) => (e.id === event.id ? event : e)) })),
  removeEvent: (id) => set((s) => ({ events: s.events.filter((e) => e.id !== id) })),

  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((s) => ({ tasks: [...s.tasks, task] })),
  updateTask: (task) => set((s) => ({ tasks: s.tasks.map((t) => (t.id === task.id ? task : t)) })),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),

  setReminders: (reminders) => set({ reminders }),
  addReminder: (reminder) => set((s) => ({ reminders: [...s.reminders, reminder] })),
  removeReminder: (id) => set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id) })),

  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((s) => ({ messages: [message, ...s.messages] })),

  setGroups: (groups) => set({ groups }),
  setUsers: (users) => set({ users }),

  addNotification: (n) =>
    set((s) => ({
      notifications: [
        { ...n, id: Math.random().toString(36), read: false, createdAt: new Date() },
        ...s.notifications,
      ],
    })),
  markNotificationRead: (id) =>
    set((s) => ({ notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) })),
}));
