/**
 * ImagesDrawer — Docker image management for topology NFs.
 *
 * Opened from the topology-editor toolbar. Four sections:
 *  - Upload: drag-and-drop a `.tar` / `.tar.gz` image archive (docker load).
 *  - Pull:   pull an image from a registry with streamed progress (WebSocket).
 *  - Login:  configure registry credentials (docker login) + active logins.
 *  - Local:  list local images.
 *
 * Credentials are persisted by Docker itself (~/.docker/config.json); the app
 * stores none of them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Drawer, Upload, Button, Input, Space, Typography, List, Tag, message, Empty,
} from 'antd';
import {
  CloudDownloadOutlined, LoginOutlined, ReloadOutlined,
} from '@ant-design/icons';
import type { UploadProps } from 'antd';
import {
  listDockerImages, uploadDockerImage, dockerLogin, listDockerLogins,
  pullDockerImage, DockerPullEvent,
} from '../../services/api';

const { Text } = Typography;
const mono = 'Consolas, Liberation Mono, Menlo, monospace';

interface DockerImage {
  id: string;
  tags: string[];
  size: number;
  created?: string;
}

function fmtSize(bytes: number): string {
  if (!bytes) return '—';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

interface ImagesDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function ImagesDrawer({ open, onClose }: ImagesDrawerProps) {
  const [images, setImages] = useState<DockerImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  // Pull state
  const [pullRef, setPullRef] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullLines, setPullLines] = useState<string[]>([]);
  const pullDisposeRef = useRef<(() => void) | null>(null);
  const pullBoxRef = useRef<HTMLDivElement | null>(null);

  // Login state
  const [registry, setRegistry] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [logins, setLogins] = useState<string[]>([]);

  const refreshImages = useCallback(async () => {
    setLoadingImages(true);
    try {
      const r = await listDockerImages();
      setImages(r.data?.images || []);
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'Failed to list images');
    } finally {
      setLoadingImages(false);
    }
  }, []);

  const refreshLogins = useCallback(async () => {
    try {
      const r = await listDockerLogins();
      setLogins(r.data?.registries || []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    if (open) {
      refreshImages();
      refreshLogins();
    }
    return () => {
      pullDisposeRef.current?.();
      pullDisposeRef.current = null;
    };
  }, [open, refreshImages, refreshLogins]);

  useEffect(() => {
    if (pullBoxRef.current) {
      pullBoxRef.current.scrollTop = pullBoxRef.current.scrollHeight;
    }
  }, [pullLines]);

  const uploadProps: UploadProps = {
    name: 'file',
    multiple: false,
    accept: '.tar,.tar.gz,.tgz',
    showUploadList: false,
    beforeUpload: (file) => {
      setPendingFile(file as File);
      return false; // just stage the file, don't upload yet
    },
  };

  const handleDockerLoad = async () => {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const r = await uploadDockerImage(pendingFile);
      const tags: string[] = r.data?.tags || [];
      message.success(`Loaded ${tags.length ? tags.join(', ') : pendingFile.name}`);
      setPendingFile(null);
      refreshImages();
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'docker load failed');
    } finally {
      setUploading(false);
    }
  };

  const handlePull = () => {
    const ref = pullRef.trim();
    if (!ref) {
      message.warning('Enter an image reference');
      return;
    }
    setPulling(true);
    setPullLines([`$ docker pull ${ref}`]);
    pullDisposeRef.current?.();
    pullDisposeRef.current = pullDockerImage(
      ref,
      (evt: DockerPullEvent) => {
        if (evt.ping) return;
        if (evt.error) {
          setPullLines((prev) => [...prev, `✗ ${evt.error}`]);
          message.error(evt.error);
          setPulling(false);
          return;
        }
        if (evt.done) {
          setPullLines((prev) => [...prev, '✓ Pull complete']);
          message.success(`Pulled ${ref}`);
          setPulling(false);
          refreshImages();
          return;
        }
        const layer = evt.id ? `${evt.id}: ` : '';
        const prog = evt.progress ? ` ${evt.progress}` : '';
        setPullLines((prev) => [...prev.slice(-400), `${layer}${evt.status || ''}${prog}`]);
      },
      () => setPulling(false),
    );
  };

  const handleLogin = async () => {
    if (!username || !password) {
      message.warning('Username and password are required');
      return;
    }
    setLoggingIn(true);
    try {
      const r = await dockerLogin(registry, username, password);
      message.success(r.data?.detail || 'Logged in');
      setPassword('');
      refreshLogins();
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'Login failed');
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <Drawer
      title="Docker Images"
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
      styles={{ body: { background: '#0d1117', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }, header: { background: '#111827', borderBottom: '1px solid #1e3a5f' } }}
    >
      {/* ── 01 · Online pull (primary mode) ── */}
      <div>
        <Text style={{ color: '#7dd3fc', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>01 · ONLINE PULL</Text>
        <Space.Compact style={{ width: '100%', marginTop: 6 }}>
          <Input
            size="small"
            placeholder="e.g. nginx:latest or registry/repo:tag"
            value={pullRef}
            onChange={(e) => setPullRef(e.target.value)}
            onPressEnter={handlePull}
            disabled={pulling}
            style={{ background: '#1a2035', borderColor: '#1e3a5f', fontFamily: mono }}
          />
          <Button
            size="small"
            type="primary"
            icon={<CloudDownloadOutlined />}
            onClick={handlePull}
            loading={pulling}
            style={{ background: 'linear-gradient(135deg, #00d4ff, #6366f1)', border: 'none' }}
          >
            Pull
          </Button>
        </Space.Compact>
        {(pullLines.length > 0 || pulling) && (
          <div
            ref={pullBoxRef}
            style={{
              marginTop: 6, height: 96, overflowY: 'auto', background: '#0a0e17',
              border: '1px solid #1e3a5f', borderRadius: 6, padding: '6px 8px',
              fontFamily: mono, fontSize: 11, color: '#8a9bb8', whiteSpace: 'pre-wrap',
            }}
          >
            {pullLines.map((l, i) => (
              <div key={i} style={{ color: l.startsWith('✓') ? '#52c41a' : l.startsWith('✗') ? '#ff4d4f' : '#8a9bb8' }}>
                {l}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 02 · Load from file (slim drop zone) ── */}
      <div>
        <Text style={{ color: '#7dd3fc', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>02 · LOAD ARCHIVE</Text>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'stretch' }}>
          <Upload.Dragger
            {...uploadProps}
            disabled={uploading}
            className="compact-dragger"
            style={{ background: '#111827', borderColor: pendingFile ? '#00d4ff' : '#1e3a5f', flex: 1 }}
          >
            <p style={{ margin: 0, color: pendingFile ? '#00d4ff' : '#7a8db0', fontSize: 11.5, lineHeight: '20px' }}>
              {pendingFile ? pendingFile.name : 'Drop .tar / .tar.gz here or click to browse'}
            </p>
          </Upload.Dragger>
          {pendingFile && (
            <Button
              type="primary"
              size="small"
              loading={uploading}
              onClick={handleDockerLoad}
              style={{ background: 'linear-gradient(135deg, #00d4ff, #6366f1)', border: 'none', fontSize: 12 }}
            >
              {uploading ? 'Loading…' : 'Load'}
            </Button>
          )}
        </div>
      </div>

      {/* ── 03 · Registry login ── */}
      <div>
        <Text style={{ color: '#7dd3fc', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>03 · REGISTRY LOGIN</Text>
        <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
          <Input
            size="small"
            placeholder="Registry (blank = Docker Hub)"
            value={registry}
            onChange={(e) => setRegistry(e.target.value)}
            style={{ background: '#1a2035', borderColor: '#1e3a5f', flex: '0 0 34%' }}
          />
          <Input
            size="small"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ background: '#1a2035', borderColor: '#1e3a5f' }}
          />
          <Input.Password
            size="small"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onPressEnter={handleLogin}
            style={{ background: '#1a2035', borderColor: '#1e3a5f' }}
          />
          <Button
            size="small"
            icon={<LoginOutlined />}
            onClick={handleLogin}
            loading={loggingIn}
            style={{ borderColor: '#1e3a5f', color: '#b8c4e0' }}
          />
        </div>
        {logins.length > 0 && (
          <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {logins.map((r) => (
              <Tag key={r} color="blue" style={{ fontFamily: mono, fontSize: 10 }}>{r}</Tag>
            ))}
          </div>
        )}
      </div>

      {/* ── 04 · Local images (fills the remaining page) ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 140 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Text style={{ color: '#7dd3fc', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>04 · LOCAL IMAGES ({images.length})</Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={refreshImages} loading={loadingImages}
            style={{ borderColor: '#1e3a5f', color: '#8a9bb8' }} />
        </Space>
        {images.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text type="secondary">No local images</Text>} style={{ marginTop: 12 }} />
        ) : (
          <List
            size="small"
            loading={loadingImages}
            dataSource={images}
            style={{ marginTop: 6, flex: 1, overflowY: 'auto' }}
            renderItem={(img) => (
              <List.Item style={{ borderColor: 'rgba(30,58,95,0.5)', padding: '5px 0' }}>
                <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 }}>
                    {img.tags && img.tags.length > 0 ? (
                      img.tags.map((t) => (
                        <Tag key={t} style={{ fontFamily: mono, fontSize: 11, margin: 0 }}>{t}</Tag>
                      ))
                    ) : (
                      <Tag style={{ fontFamily: mono, fontSize: 11, margin: 0 }}>{img.id?.slice(7, 19) || '<untagged>'}</Tag>
                    )}
                  </div>
                  <Text type="secondary" style={{ fontSize: 10, flexShrink: 0 }}>{fmtSize(img.size)}</Text>
                </div>
              </List.Item>
            )}
          />
        )}
      </div>
    </Drawer>
  );
}
