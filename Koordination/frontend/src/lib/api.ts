import axios from 'axios';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      window.location.href = '/auth/login';
    }
    return Promise.reject(err);
  },
);

export default api;

export const authApi = {
  register: (data: any) => api.post('/auth/register', data),
  login: (data: any) => api.post('/auth/login', data),
};

export const usersApi = {
  getAll: () => api.get('/users'),
  getMe: () => api.get('/users/me'),
  updateProfile: (data: any) => api.patch('/users/me', data),
};

export const eventsApi = {
  getAll: (from?: string, to?: string) => api.get('/events', { params: { from, to } }),
  getOne: (id: string) => api.get(`/events/${id}`),
  create: (data: any) => api.post('/events', data),
  update: (id: string, data: any) => api.patch(`/events/${id}`, data),
  delete: (id: string) => api.delete(`/events/${id}`),
  checkConflicts: (start: string, end: string, excludeId?: string) =>
    api.get('/events/conflicts', { params: { start, end, excludeId } }),
};

export const tasksApi = {
  getAll: (status?: string) => api.get('/tasks', { params: { status } }),
  getOne: (id: string) => api.get(`/tasks/${id}`),
  create: (data: any) => api.post('/tasks', data),
  update: (id: string, data: any) => api.patch(`/tasks/${id}`, data),
  updateStatus: (id: string, status: string) => api.patch(`/tasks/${id}/status`, { status }),
  delete: (id: string) => api.delete(`/tasks/${id}`),
};

export const remindersApi = {
  getAll: () => api.get('/reminders'),
  create: (data: any) => api.post('/reminders', data),
  update: (id: string, data: any) => api.patch(`/reminders/${id}`, data),
  delete: (id: string) => api.delete(`/reminders/${id}`),
};

export const sharingApi = {
  send: (data: any) => api.post('/sharing/send', data),
  getSent: () => api.get('/sharing/sent'),
  getReceived: () => api.get('/sharing/received'),
  getOne: (id: string) => api.get(`/sharing/${id}`),
  react: (id: string, data: { reaction: string; note?: string }) => api.post(`/sharing/${id}/react`, data),
  translate: (id: string, language: string) => api.post(`/sharing/${id}/translate`, { language }),
  getWhatsAppLink: (id: string) => api.get(`/sharing/${id}/whatsapp`),
};

export const groupsApi = {
  getAll: () => api.get('/groups'),
  getOne: (id: string) => api.get(`/groups/${id}`),
  create: (data: any) => api.post('/groups', data),
  update: (id: string, data: any) => api.patch(`/groups/${id}`, data),
  addMember: (id: string, data: any) => api.post(`/groups/${id}/members`, data),
  removeMember: (id: string, memberId: string) => api.delete(`/groups/${id}/members/${memberId}`),
  delete: (id: string) => api.delete(`/groups/${id}`),
};
