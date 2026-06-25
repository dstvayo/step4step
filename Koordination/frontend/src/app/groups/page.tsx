'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { groupsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Plus, Users, Trash2, UserPlus, Crown } from 'lucide-react';
import { Group } from '@/types';

export default function GroupsPage() {
  const { groups, setGroups } = useAppStore();
  const { user } = useAuthStore();
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [form, setForm] = useState({ name: '', description: '', memberIds: [] as string[] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    groupsApi.getAll().then((r) => setGroups(r.data));
    usersApi.getAll().then((r) => setUsers(r.data));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await groupsApi.create(form);
      setGroups([...groups, res.data]);
      setShowCreate(false);
      setForm({ name: '', description: '', memberIds: [] });
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Gruppe wirklich löschen?')) return;
    await groupsApi.delete(id);
    setGroups(groups.filter((g) => g.id !== id));
    if (selectedGroup?.id === id) setSelectedGroup(null);
  };

  const handleAddMember = async (groupId: string, userId: string) => {
    const res = await groupsApi.addMember(groupId, { userId });
    const updated = await groupsApi.getOne(groupId);
    setGroups(groups.map((g) => g.id === groupId ? updated.data : g));
    setSelectedGroup(updated.data);
  };

  const handleRemoveMember = async (groupId: string, memberId: string) => {
    await groupsApi.removeMember(groupId, memberId);
    const updated = await groupsApi.getOne(groupId);
    setGroups(groups.map((g) => g.id === groupId ? updated.data : g));
    setSelectedGroup(updated.data);
  };

  return (
    <div className="flex gap-4 h-full -m-4 md:-m-6 p-4 md:p-6">
      <div className="w-72 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-400">Meine Teams</h3>
          <button onClick={() => setShowCreate(true)} className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
            <Plus size={14} />
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="card mb-3 space-y-3 bg-slate-900 border-slate-800">
            <input className="input bg-slate-800 border-slate-700 text-white text-sm" placeholder="Teamname *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input bg-slate-800 border-slate-700 text-white text-sm" placeholder="Beschreibung" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div className="max-h-24 overflow-y-auto space-y-1">
              {users.filter((u) => u.id !== user?.id).map((u) => (
                <label key={u.id} className="flex items-center gap-2 p-1 rounded hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" onChange={(e) => setForm({ ...form, memberIds: e.target.checked ? [...form.memberIds, u.id] : form.memberIds.filter((id) => id !== u.id) })} />
                  <span className="text-xs text-white">{u.name}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary flex-1 text-xs">Abbrechen</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1 text-xs">{saving ? '...' : 'Erstellen'}</button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          {groups.map((group) => (
            <button key={group.id} onClick={() => setSelectedGroup(group)}
              className={`w-full text-left p-3 rounded-xl border transition-colors ${selectedGroup?.id === group.id ? 'bg-blue-600/20 border-blue-500/30' : 'bg-slate-900 border-slate-800 hover:border-slate-700'}`}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold">{group.name[0]}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{group.name}</p>
                  <p className="text-xs text-slate-500">{group.members.length} Mitglieder</p>
                </div>
              </div>
            </button>
          ))}
          {groups.length === 0 && !showCreate && (
            <div className="text-center py-8">
              <Users size={32} className="text-slate-700 mx-auto mb-2" />
              <p className="text-sm text-slate-600">Noch keine Teams</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
        {selectedGroup ? (
          <div className="p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">{selectedGroup.name}</h2>
                {selectedGroup.description && <p className="text-sm text-slate-400 mt-0.5">{selectedGroup.description}</p>}
                <p className="text-xs text-slate-500 mt-1">Erstellt von: {selectedGroup.owner.name}</p>
              </div>
              {selectedGroup.ownerId === user?.id && (
                <button onClick={() => handleDelete(selectedGroup.id)} className="p-2 text-red-400 hover:bg-red-500/10 rounded-lg">
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-400 mb-3">Mitglieder ({selectedGroup.members.length})</h3>
              <div className="space-y-2">
                {selectedGroup.members.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 p-3 bg-slate-800 rounded-lg">
                    <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium">{member.user.name[0]}</div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{member.user.name}</p>
                      <p className="text-xs text-slate-500">{member.user.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {member.role === 'owner' && <span title="Besitzer"><Crown size={14} className="text-amber-400" /></span>}
                      {selectedGroup.ownerId === user?.id && member.userId !== user?.id && (
                        <button onClick={() => handleRemoveMember(selectedGroup.id, member.userId)} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-red-500/10">Entfernen</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedGroup.ownerId === user?.id && (
              <div>
                <h3 className="text-sm font-semibold text-slate-400 mb-3">Mitglied hinzufügen</h3>
                <div className="grid grid-cols-2 gap-2">
                  {users.filter((u) => !selectedGroup.members.some((m) => m.userId === u.id)).map((u) => (
                    <button key={u.id} onClick={() => handleAddMember(selectedGroup.id, u.id)}
                      className="flex items-center gap-2 p-2.5 bg-slate-800 rounded-lg hover:bg-slate-700 border border-slate-700 hover:border-slate-600 transition-colors text-left">
                      <div className="w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center text-xs text-white">{u.name[0]}</div>
                      <div>
                        <p className="text-xs font-medium text-white">{u.name}</p>
                        <p className="text-xs text-slate-500 truncate max-w-24">{u.email}</p>
                      </div>
                      <UserPlus size={12} className="ml-auto text-blue-400" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 h-full flex items-center justify-center text-center">
            <div>
              <Users size={40} className="text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500">Team auswählen</p>
              <p className="text-xs text-slate-600 mt-1">oder neues Team erstellen</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
