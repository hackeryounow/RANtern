import { useState, useEffect } from 'react';
import { Modal, Input, Button, Space, Typography, Form, message } from 'antd';
import {
  SaveOutlined, PlusOutlined, DeleteOutlined,
  CloudServerOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { updateNFConfig } from '../services/api';

const { Text } = Typography;

interface NFConfigModalProps {
  open: boolean;
  onClose: () => void;
  container: {
    name: string;
    image: string;
    nf_type: string;
    status: string;
  } | null;
  onUpdated: () => void;
}

export default function NFConfigModal({ open, onClose, container, onUpdated }: NFConfigModalProps) {
  const [image, setImage] = useState('');
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (container) {
      setImage(container.image || '');
      setEnvVars([]);
    }
  }, [container]);

  const handleSave = async () => {
    if (!container) return;
    setLoading(true);
    try {
      const env: Record<string, string> = {};
      envVars.forEach(e => { if (e.key) env[e.key] = e.value; });
      await updateNFConfig(container.name, image || undefined, Object.keys(env).length > 0 ? env : undefined);
      message.success(`${container.name} updated & restarting...`);
      onUpdated();
      onClose();
    } catch (e: any) {
      message.error(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  };

  const addEnvVar = () => setEnvVars(prev => [...prev, { key: '', value: '' }]);
  const removeEnvVar = (idx: number) => setEnvVars(prev => prev.filter((_, i) => i !== idx));
  const setEnvVar = (idx: number, field: 'key' | 'value', val: string) =>
    setEnvVars(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e));

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <CloudServerOutlined style={{ color: '#00d4ff' }} />
          <span style={{ color: '#f0f4ff' }}>
            Configure: {container?.name || ''}
          </span>
        </Space>
      }
      width={600}
      footer={[
        <Button key="cancel" onClick={onClose} style={{ borderRadius: 8, background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#8a9bb8' }}>
          Cancel
        </Button>,
        <Button
          key="save"
          type="primary"
          icon={<SaveOutlined />}
          loading={loading}
          onClick={handleSave}
          style={{ borderRadius: 8, background: 'linear-gradient(135deg, #00d4ff, #6366f1)', border: 'none' }}
        >
          Save & Restart
        </Button>,
      ]}
      styles={{ body: { padding: '24px' } }}
    >
      {container && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Container info */}
          <div style={{ display: 'flex', gap: 16, fontSize: 12, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' }}>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>NF TYPE</Text>
              <div style={{ color: '#00d4ff' }}>{container.nf_type?.toUpperCase()}</div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>STATUS</Text>
              <div style={{ color: container.status === 'running' ? '#52c41a' : '#ff4d4f' }}>
                {container.status}
              </div>
            </div>
          </div>

          {/* Image */}
          <Form layout="vertical">
            <Form.Item
              label={<Text style={{ color: '#b8c4e0', fontSize: 12 }}>Container Image</Text>}
              style={{ marginBottom: 12 }}
            >
              <Input
                value={image}
                onChange={e => setImage(e.target.value)}
                placeholder="e.g. free5gc/amf:v4.0.1"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 8,
                  color: '#f0f4ff',
                  fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
                  fontSize: 13,
                }}
              />
              <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                Change image tag to upgrade/downgrade. Container will be recreated.
              </Text>
            </Form.Item>
          </Form>

          {/* Environment Variables */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ color: '#b8c4e0', fontSize: 12 }}>Environment Variables</Text>
              <Button size="small" icon={<PlusOutlined />} onClick={addEnvVar} type="dashed">
                Add
              </Button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {envVars.map((ev, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Input
                    value={ev.key}
                    onChange={e => setEnvVar(idx, 'key', e.target.value)}
                    placeholder="KEY"
                    style={{
                      flex: 1,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      color: '#f0f4ff',
                      fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
                      fontSize: 12,
                    }}
                  />
                  <Input
                    value={ev.value}
                    onChange={e => setEnvVar(idx, 'value', e.target.value)}
                    placeholder="value"
                    style={{
                      flex: 1,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      color: '#f0f4ff',
                      fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
                      fontSize: 12,
                    }}
                  />
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeEnvVar(idx)}
                  />
                </div>
              ))}
              {envVars.length === 0 && (
                <Text type="secondary" style={{ fontSize: 11, fontStyle: 'italic' }}>
                  No additional env vars. Add key-value pairs above.
                </Text>
              )}
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              <ReloadOutlined style={{ marginRight: 4 }} />
              Saving will automatically restart the container with the new configuration.
            </Text>
          </div>
        </div>
      )}
    </Modal>
  );
}
