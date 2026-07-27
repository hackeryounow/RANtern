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
export const establishPduSession = (ueIndex: number, pduSessionId: number = 1) =>
  api.post(`/test/ue/${ueIndex}/establish-pdu`, { pdu_session_id: pduSessionId });
export const triggerUserInactivity = (ueIndex: number) =>
  api.post(`/test/ue/${ueIndex}/user-inactivity`);
export const deregisterUE = (ueIndex: number) =>
  api.post(`/test/ue/${ueIndex}/deregister`);
export const reregisterUE = (ueIndex: number) =>
  api.post(`/test/ue/${ueIndex}/re-register`);
export const releaseAllPduSessions = () =>
  api.post('/test/release-all-pdu');
export const deregisterAllUEs = () =>
  api.post('/test/deregister-all');
export const serviceRequestAllUEs = () =>
  api.post('/test/service-request-all');
export const oneClickTest = (rounds: number = 1, interval: number = 0) =>
  api.post('/test/one-click-test', { rounds, interval });
export const restartService = () =>
  api.post('/test/restart');
export const clearRedis = () =>
  api.post('/test/clear-redis');

// ─── UE Events ───
export const getUEEvents = (ueIndex: number) =>
  api.get(`/test/ue/${ueIndex}/events`);

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

// ─── Core Network Management ───
export const getCoreTypes = () => api.get('/core/types');
export const deployCore = (type: string) => api.post('/core/deploy', { type });
export const undeployCore = (type: string) => api.post('/core/undeploy', { type });
export const getCoreStatus = (type?: string) => api.get('/core/status', { params: type ? { type } : {} });
export const getTopology = (type?: string) => api.get('/core/topology', { params: type ? { type } : {} });
export const getNFLogs = (name: string, tail: number = 200) => api.get(`/core/nf/${name}/logs`, { params: { tail } });
export const restartNF = (name: string) => api.post(`/core/nf/${name}/restart`);
export const updateNFConfig = (name: string, image?: string, env?: Record<string, string>) =>
  api.put(`/core/nf/${name}/config`, { image, env });
export const startCapture = (src_nf: string, dst_nf: string) =>
  api.post('/core/capture/start', { src_nf, dst_nf });
export const stopCapture = (session_id: string) => api.post('/core/capture/stop', { session_id });
export const getCaptureSummary = (session_id: string, max_packets: number = 100) =>
  api.get(`/core/capture/summary/${session_id}`, { params: { max_packets } });
export const downloadCapture = (session_id: string) => window.open(`/api/core/capture/download/${session_id}`, '_blank');
export const listCaptureSessions = () => api.get('/core/capture/sessions');

// ─── Topology Editor ───
export interface TopologyNode {
  id: string;
  kind: string;
  x?: number;
  y?: number;
  interfaces?: Record<string, { ip?: string; [k: string]: any }>;
  config?: Record<string, any>;
  [k: string]: any;
}
export interface TopologyLink {
  id: string;
  endpoints: { node: string; iface: string }[];
  [k: string]: any;
}
export interface TopologyDoc {
  name: string;
  core_type: string;
  subnet?: string;
  gateway?: string;
  globals?: Record<string, any>;
  nodes: TopologyNode[];
  links: TopologyLink[];
}

export const getNfKinds = (core?: string) =>
  api.get('/nf-kinds', { params: core ? { core } : {} });

// ─── NF component catalog (PostgreSQL-backed) ───
export const listNfComponents = (core?: string) =>
  api.get('/nf-components', { params: core ? { core } : {} });
export const createNfComponent = (payload: Record<string, any>) =>
  api.post('/nf-components', payload);
export const updateNfComponent = (id: string, payload: Record<string, any>) =>
  api.put(`/nf-components/${id}`, payload);
export const deleteNfComponent = (id: string) => api.delete(`/nf-components/${id}`);
export interface ConfigSchemaField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'slices';
  default?: any;
  hint?: string;
  options?: string[];
  fields?: ConfigSchemaField[];
}
export const getConfigSchema = (core: string, kind?: string) =>
  api.get('/config-schema', { params: kind ? { core, kind } : { core } });
export const listTopologies = () => api.get('/topologies');
export const getTopologyDoc = (name: string) => api.get(`/topologies/${name}`);
export const createTopology = (doc: TopologyDoc) => api.post('/topologies', doc);
export const updateTopology = (name: string, doc: TopologyDoc) =>
  api.put(`/topologies/${name}`, doc);
export const deleteTopology = (name: string) => api.delete(`/topologies/${name}`);
export const validateTopology = (name: string) => api.get(`/topologies/${name}/validate`);
export const deployTopology = (name: string) => api.post(`/topologies/${name}/deploy`);
export const undeployTopology = (name: string) => api.post(`/topologies/${name}/undeploy`);
export const getTopologyStatus = (name: string) => api.get(`/topologies/${name}/status`);
export interface TopologyImageStatus {
  node_id: string;
  kind: string;
  image: string;
  exists: boolean;
}
export const getTopologyImages = (name: string) => api.get(`/topologies/${name}/images`);
export const checkTopologyImagesDoc = (doc: TopologyDoc) =>
  api.post('/topologies/images-check', doc);
export const applyTopologyYaml = (name: string, yamlText: string) =>
  api.put(`/topologies/${name}/yaml`, yamlText, { headers: { 'Content-Type': 'text/yaml' } });
export const getNodeConfig = (name: string, nodeId: string) =>
  api.get(`/topologies/${name}/nodes/${nodeId}/config`);
export const updateNodeConfig = (
  name: string,
  nodeId: string,
  payload: { config?: Record<string, any>; interfaces?: Record<string, any> },
) => api.put(`/topologies/${name}/nodes/${nodeId}/config`, payload);
export const getNodeLogs = (name: string, nodeId: string, tail: number = 200) =>
  api.get(`/topologies/${name}/nodes/${nodeId}/logs`, { params: { tail } });
export const restartTopologyNode = (name: string, nodeId: string) =>
  api.post(`/topologies/${name}/nodes/${nodeId}/restart`);
export const stopTopologyNode = (name: string, nodeId: string) =>
  api.post(`/topologies/${name}/nodes/${nodeId}/stop`);

// ─── Default 3GPP template ───
export const getDefaultTemplate = (core: string, variant?: string) =>
  api.get('/topologies/default-template', { params: { core, ...(variant ? { variant } : {}) } });

export const getDefaultTemplateVariants = (core: string) =>
  api.get('/topologies/default-template/variants', { params: { core } });

// ─── Per-link packet capture ───
export const startLinkCapture = (name: string, linkId: string) =>
  api.post(`/topologies/${name}/links/${linkId}/capture/start`);

// ─── Topology rendered-config file browser ───
export const listTopologyFiles = (name: string) => api.get(`/topologies/${name}/files`);
export const getTopologyFileContent = (name: string, path: string) =>
  api.get(`/topologies/${name}/files/content`, { params: { path } });
export const downloadTopologyFile = (name: string, path: string) =>
  window.open(`/api/topologies/${name}/files/content?path=${encodeURIComponent(path)}&download=true`, '_blank');

// ─── Docker image management ───
export const listDockerImages = () => api.get('/docker/images');
export const uploadDockerImage = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/docker/images/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};
export const dockerLogin = (registry: string, username: string, password: string) =>
  api.post('/docker/login', { registry: registry || undefined, username, password });
export const listDockerLogins = () => api.get('/docker/logins');

/** Build a WebSocket URL against the current host (mirrors NFLogDrawer). */
export const buildWsUrl = (path: string): string => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
};

export interface DockerPullEvent {
  status?: string;
  progress?: string;
  id?: string;
  done?: boolean;
  error?: string;
  ping?: boolean;
}

/**
 * Pull a Docker image, streaming progress events over WebSocket.
 * Returns a disposer that closes the socket.
 */
export const pullDockerImage = (
  image: string,
  onEvent: (evt: DockerPullEvent) => void,
  onClose?: () => void,
): (() => void) => {
  const ws = new WebSocket(buildWsUrl(`/api/ws/docker/images/pull?image=${encodeURIComponent(image)}`));
  ws.onmessage = (evt) => {
    try {
      onEvent(JSON.parse(evt.data) as DockerPullEvent);
    } catch {
      /* ignore non-JSON frames */
    }
  };
  ws.onclose = () => onClose?.();
  ws.onerror = () => onClose?.();
  return () => {
    try {
      ws.close();
    } catch {
      /* noop */
    }
  };
};

// ─── Docs ───
export const getDocsIndex = (lang: string) => api.get('/docs/index', { params: { lang } });
export const getDocContent = (docId: string, lang: string) =>
  api.get(`/docs/${docId}`, { params: { lang }, responseType: 'text' as any });

export default api;
