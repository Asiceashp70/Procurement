import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3004/api/v1',
});

// Request interceptor to add JWT attached to LocalStorage
api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem('token') : null;
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
