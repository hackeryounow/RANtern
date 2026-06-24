import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// ─── Health ───
export const healthCheck = () => api.get('/health');

// ─── Provision ───
export const startProvision = (data: { count: number; core_network: string; action: string; profile?: string }) =>
  api.post('/provision', data);
export const getProvisionStatus = () => api.get('/provision/status');

// ─── Test ───
export const start5GTest = (data: any) => api.post('/test/5g', data);
export const start4GTest = (data: any) => api.post('/test/4g', data);
export const stopTest = () => api.post('/test/stop');
export const getTestStatus = () => api.get('/test/status');
export const getTestUEs = () => api.get('/test/ues');
export const getNGAPStats = () => api.get('/test/ngap-stats');
export const getLatencyStats = () => api.get('/test/latency-stats');

// ─── Per-UE Actions ───
export const releasePduSession = (ueIndex: number, pduSessionId: number) =>
  api.post(`/test/ue/${ueIndex}/release-pdu`, { pdu_session_id: pduSessionId });
export const triggerUserInactivity = (ueIndex: number) =>
  api.post(`/test/ue/${ueIndex}/user-inactivity`);
export const deregisterUE = (ueIndex: number) =>
  api.post(`/test/ue/${ueIndex}/deregister`);

// ─── Export ───
export const exportUEsCSV = () => window.open('/api/test/export/ues', '_blank');
export const exportLatencyJSON = () => window.open('/api/test/export/latency-stats', '_blank');
export const exportFullJSON = () => window.open('/api/test/export/full', '_blank');

// ─── Config ───
export const getConfig = () => api.get('/config');
export const updateConfig = (values: Record<string, string>, profile?: string) =>
  api.put('/config', { values, profile });
export const getNetworks = () => api.get('/config/networks');

// ─── Profiles ───
export const listProfiles = () => api.get('/profiles');
export const getProfile = (name: string) => api.get(`/profiles/${name}`);
export const createProfile = (name: string, values: Record<string, string>) =>
  api.post('/profiles', { name, values });
export const updateProfile = (name: string, values: Record<string, string>) =>
  api.put(`/profiles/${name}`, { values });
export const deleteProfile = (name: string) => api.delete(`/profiles/${name}`);
export const activateProfile = (name: string) => api.post(`/profiles/${name}/activate`);

// ─── JSON Templates ───
export const listTemplates = () => api.get('/templates');
export const getTemplate = (name: string) => api.get(`/templates/${name}`);
export const updateTemplate = (name: string, content: string) =>
  api.put(`/templates/${name}`, { content });

// ─── History ───
export const listHistory = () => api.get('/test/history');
export const getHistoryRecord = (id: string) => api.get(`/test/history/${id}`);
export const deleteHistoryRecord = (id: string) => api.delete(`/test/history/${id}`);
export const clearHistory = () => api.delete('/test/history');

export default api;
