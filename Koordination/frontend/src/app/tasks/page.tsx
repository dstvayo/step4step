'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { tasksApi, usersApi } from '@/lib/api';
import { Plus, CheckCircle2, Circle, Clock, AlertTriangle, ChevronDown, ChevronRight, Trash2, Edit2, Send } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import { Task } from '@/types';
import TaskModal from '@/components/tasks/TaskModal';
import SendMessageModal from '@/components/sharing/SendMessageModal';

const priorityConfig: Record<string, { label: string; color: string; bg: string }> = {
  LOW: { label: 'Niedrig', color: 'text-green-400', bg: 'bg-green-500/10' },
  MEDIUM: { label: 'Mittel', color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  HIGH: { label: 'Hoch', color: 'text-red-400', bg: 'bg-red-500/10' },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  OPEN: { label: 'Offen', color: 'text-slate-400' },
  IN_PROGRESS: { label: 'In Arbeit', color: 'text-blue-400' },
  DONE: { label: 'Erledigt', color: 'text-green-400' },
};

type FilterStatus = 'all' | 'OPEN' | 'IN_PROGRESS' | 'DONE';

export default function TasksPage() {
  const { tasks, setTasks, addTask, updateTask, removeTask } = useAppStore();
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [sendTask, setSendTask] = useState<Task | null>(null);

  useEffect(() => {
    tasksApi.getAll().then((res) => setTasks(res.data));
  }, []);

  const filtered = tasks.filter((t) => filter === 'all' || t.status === filter);
  const columns = [
    { status: 'OPEN', label: 'Offen', tasks: filtered.filter((t) => t.status === 'OPEN') },
    { status: 'IN_PROGRESS', label: 'In Arbeit', tasks: filtered.filter((t) => t.status === 'IN_PROGRESS') },
    { status: 'DONE', label: 'Erledigt', tasks: filtered.filter((t) => t.status === 'DONE') },
  ];

  const handleStatusChange = async (task: Task, status: string) => {
    const res = await tasksApi.updateStatus(task.id, status);
    updateTask(res.data);
  };

  const handleSave = async (data: any) => {
    if (editingTask) {
      const res = await tasksApi.update(editingTask.id, data);
      updateTask(res.data);
    } else {
      const res = await tasksApi.create(data);
      addTask(res.data);
    }
    setShowModal(false);
    setEditingTask(null);
  };

  const handleDelete = async (id: string) => {
    await tasksApi.delete(id);
    removeTask(id);
    setShowModal(false);
    setEditingTask(null);
  };

  const toggleExpand = (id: string) => {
    const s = new Set(expandedTasks);
    s.has(id) ? s.delete(id) : s.add(id);
    setExpandedTasks(s);
  };

  const renderTask = (task: Task, isSubtask = false) => {
    const p = priorityConfig[task.priority];
    const hasSubtasks = (task.subtasks?.length || 0) > 0;
    const expanded = expandedTasks.has(task.id);

    return (
      <div key={task.id}>
        <div className={`group rounded-lg p-3 ${isSubtask ? 'bg-slate-800/50 ml-4 mt-1.5' : 'bg-slate-800 hover:bg-slate-750'} border border-slate-700/50 hover:border-slate-600 transition-all cursor-pointer`}>
          <div className="flex items-start gap-2">
            {hasSubtasks ? (
              <button onClick={() => toggleExpand(task.id)} className="mt-0.5 text-slate-500 hover:text-slate-300 shrink-0">
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
            ) : (
              <button
                onClick={() => handleStatusChange(task, task.status === 'DONE' ? 'OPEN' : task.status === 'OPEN' ? 'IN_PROGRESS' : 'DONE')}
                className={`mt-0.5 shrink-0 transition-colors ${task.status === 'DONE' ? 'text-green-400' : 'text-slate-600 hover:text-blue-400'}`}
              >
                {task.status === 'DONE' ? <CheckCircle2 size={18} /> : <Circle size={18} />}
              </button>
            )}

            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium leading-snug ${task.status === 'DONE' ? 'line-through text-slate-500' : 'text-white'}`}>{task.title}</p>
              {task.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{task.description}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span className={`text-xs px-1.5 py-0.5 rounded ${p.bg} ${p.color}`}>{p.label}</span>
                {task.dueDate && (
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock size={11} />
                    {format(parseISO(task.dueDate), 'd. MMM', { locale: de })}
                  </span>
                )}
                {task.assignees?.slice(0, 3).map((a) => (
                  <span key={a.userId} className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{a.user.name.split(' ')[0]}</span>
                ))}
                {hasSubtasks && <span className="text-xs text-slate-500">{task.subtasks!.filter((s) => s.status === 'DONE').length}/{task.subtasks!.length} Teilaufgaben</span>}
              </div>
            </div>

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button onClick={() => setSendTask(task)} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-500 hover:text-blue-400" title="Senden">
                <Send size={14} />
              </button>
              <button onClick={() => { setEditingTask(task); setShowModal(true); }} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-500 hover:text-white">
                <Edit2 size={14} />
              </button>
              <button onClick={() => handleDelete(task.id)} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-500 hover:text-red-400">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </div>
        {hasSubtasks && expanded && task.subtasks!.map((sub) => renderTask(sub, true))}
      </div>
    );
  };

  if (filter !== 'all') {
    return (
      <div className="space-y-4 max-w-3xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {(['all', 'OPEN', 'IN_PROGRESS', 'DONE'] as const).map((s) => (
              <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === s ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
                {s === 'all' ? 'Alle' : statusConfig[s].label}
              </button>
            ))}
          </div>
          <button onClick={() => { setEditingTask(null); setShowModal(true); }} className="btn-primary flex items-center gap-1.5 text-sm">
            <Plus size={16} /> Neue Aufgabe
          </button>
        </div>
        <div className="space-y-2">{filtered.map((t) => renderTask(t))}</div>
        {showModal && <TaskModal task={editingTask} onSave={handleSave} onDelete={handleDelete} onClose={() => { setShowModal(false); setEditingTask(null); }} />}
        {sendTask && <SendMessageModal taskId={sendTask.id} subject={sendTask.title} onClose={() => setSendTask(null)} />}
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {(['all', 'OPEN', 'IN_PROGRESS', 'DONE'] as const).map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === s ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
              {s === 'all' ? 'Alle' : statusConfig[s].label}
            </button>
          ))}
        </div>
        <button onClick={() => { setEditingTask(null); setShowModal(true); }} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={16} /> Neue Aufgabe
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 min-h-0">
        {columns.map(({ status, label, tasks: colTasks }) => (
          <div key={status} className="flex flex-col bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-300">{label}</span>
              <span className="text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">{colTasks.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {colTasks.map((t) => renderTask(t))}
              {colTasks.length === 0 && <p className="text-xs text-slate-600 text-center py-4">Keine Aufgaben</p>}
            </div>
          </div>
        ))}
      </div>

      {showModal && <TaskModal task={editingTask} onSave={handleSave} onDelete={handleDelete} onClose={() => { setShowModal(false); setEditingTask(null); }} />}
      {sendTask && <SendMessageModal taskId={sendTask.id} subject={sendTask.title} onClose={() => setSendTask(null)} />}
    </div>
  );
}
