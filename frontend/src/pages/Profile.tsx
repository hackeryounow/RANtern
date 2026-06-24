import { useState, useEffect } from 'react';
import {
  Card, Menu, Button, Input, Space, Typography, Tag, Modal, Form, InputNumber, Select as AntSelect, Divider, message,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, CheckOutlined, EditOutlined,
  FileTextOutlined, SettingOutlined, SaveOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import {
  listProfiles, getProfile, createProfile, updateProfile, deleteProfile, activateProfile,
  listTemplates, getTemplate, updateTemplate,
} from '../services/api';

const { Text } = Typography;
const { TextArea } = Input;

export default function Profile() {

  // ENV state
  const [profiles, setProfiles] = useState<any[]>([]);
  const [active, setActive] = useState('');
  const [selected, setSelected] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState<'form' | 'text'>('form');
  const [textContent, setTextContent] = useState('');
  const [createModal, setCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');

  // Templates state
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTpl, setSelectedTpl] = useState('');
  const [tplContent, setTplContent] = useState('');
  const [tplDirty, setTplDirty] = useState(false);

  const load = () => {
    listProfiles().then(r => { setProfiles(r.data.profiles || []); setActive(r.data.active || ''); }).catch(() => {});
    listTemplates().then(r => setTemplates(r.data.templates || [])).catch(() => {});
  };
  useEffect(load, []);

  const selectProfile = async (name: string) => {
    setSelected(name);
    setSelectedTpl('');
    try {
      const res = await getProfile(name);
      setValues(res.data.values || {});
      setTextContent(_dictToEnv(res.data.values || {}));
      setEditMode('form');
    } catch {}
  };

  const saveProfile = async () => {
    if (!selected) return;
    const payload = editMode === 'text' ? _envToDict(textContent) : values;
    await updateProfile(selected, payload);
    setValues(payload);
    setEditMode('form');
    message.success('Saved');
  };

  const doCreate = async () => {
    if (!newName.trim()) return;
    const payload = _envToDict(newContent);
    await createProfile(newName.trim(), payload);
    setCreateModal(false);
    setNewName(''); setNewContent('');
    load();
    setSelected(newName.trim());
    setValues(payload);
    setTextContent(newContent);
    setEditMode('form');
    message.success(`Profile "${newName.trim()}" created`);
  };

  const doDelete = async (name: string) => {
    if (name === 'default') return;
    Modal.confirm({
      title: `Delete "${name}"?`,
      onOk: async () => {
        await deleteProfile(name);
        if (selected === name) { setSelected(''); setValues({}); setTextContent(''); }
        load();
        message.success('Deleted');
      },
    });
  };

  const doActivate = async (name: string) => {
    await activateProfile(name);
    setActive(name);
    message.success(`"${name}" activated`);
  };

  const openCreate = async () => {
    try {
      const res = await getProfile('default');
      setNewContent(_dictToEnv(res.data.values || {}));
    } catch { setNewContent(''); }
    setNewName('');
    setCreateModal(true);
  };

  // Template handlers
  const selectTpl = async (name: string) => {
    setSelectedTpl(name);
    setSelected('');
    try {
      const res = await getTemplate(name);
      setTplContent(res.data.content || '');
      setTplDirty(false);
    } catch {}
  };

  const saveTpl = async () => {
    if (!selectedTpl) return;
    try {
      const res = await updateTemplate(selectedTpl, tplContent);
      if (res.data.error) { message.error(res.data.error); return; }
      setTplDirty(false);
      message.success('Template saved');
      load();
    } catch (e: any) { message.error(e.message); }
  };

  // Menu items for left nav
  const menuItems: MenuProps['items'] = [
    {
      key: 'env',
      icon: <SettingOutlined />,
      label: 'ENV Profiles',
      children: [
        {
          key: 'env-new',
          icon: <PlusOutlined />,
          label: 'New Profile',
          onClick: openCreate,
        },
        { type: 'divider' },
        ...profiles.map(p => ({
          key: `env-${p.name}`,
          label: (
            <Space>
              <span>{p.name}</span>
              {p.name === active && <Tag color="success" style={{ fontSize: 10, lineHeight: '16px' }}>ACTIVE</Tag>}
            </Space>
          ),
          onClick: () => selectProfile(p.name),
        })),
      ],
    },
    {
      key: 'templates',
      icon: <FileTextOutlined />,
      label: 'JSON Templates',
      children: templates.map(t => ({
        key: `tpl-${t.name}`,
        label: t.name,
        onClick: () => selectTpl(t.name),
      })),
    },
  ];

  return (
    <div>
      <Typography.Title level={4} style={{ margin: '0 0 16px', color: '#00d4ff', fontFamily: 'JetBrains Mono, monospace' }}>
        ⚙ Profile
      </Typography.Title>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, minHeight: 'calc(100vh - 140px)' }}>
        {/* Left nav */}
        <Card size="small" style={{ overflowY: 'auto' }} styles={{ body: { padding: 0 } }}>
          <Menu
            mode="inline"
            theme="dark"
            defaultOpenKeys={['env']}
            selectedKeys={selected ? [`env-${selected}`] : selectedTpl ? [`tpl-${selectedTpl}`] : []}
            items={menuItems}
            style={{ borderRight: 'none' }}
          />
        </Card>

        {/* Right content */}
        <Card size="small" style={{ overflowY: 'auto' }}>
          {/* ── ENV FORM MODE ── */}
          {editMode === 'form' && selected && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Space>
                  <Text strong style={{ color: '#00d4ff', fontSize: 15, fontFamily: 'JetBrains Mono, monospace' }}>{selected}.env</Text>
                  {selected === active && <Tag color="success">ACTIVE</Tag>}
                </Space>
                <Space>
                  {selected !== active && <Button size="small" icon={<CheckOutlined />} onClick={() => doActivate(selected)}>Activate</Button>}
                  {selected !== 'default' && <Button size="small" danger icon={<DeleteOutlined />} onClick={() => doDelete(selected)}>Delete</Button>}
                  <Button size="small" icon={<EditOutlined />} onClick={() => { setTextContent(_dictToEnv(values)); setEditMode('text'); }}>Text</Button>
                  <Button size="small" type="primary" icon={<SaveOutlined />} onClick={saveProfile}>Save</Button>
                </Space>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '6px 12px', alignItems: 'center' }}>
                {Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => (
                  <div key={key} style={{ display: 'contents' }}>
                    <Text type="secondary" style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>{key}</Text>
                    <Input
                      size="small"
                      value={val}
                      onChange={e => setValues(p => ({ ...p, [key]: e.target.value }))}
                      style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── ENV TEXT MODE ── */}
          {editMode === 'text' && selected && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text strong style={{ color: '#00d4ff', fontSize: 15, fontFamily: 'JetBrains Mono, monospace' }}>{selected}.env (text)</Text>
                <Space>
                  <Button size="small" onClick={() => { setValues(_envToDict(textContent)); setEditMode('form'); }}>Form</Button>
                  <Button size="small" type="primary" icon={<SaveOutlined />} onClick={saveProfile}>Save</Button>
                </Space>
              </div>
              <TextArea
                value={textContent}
                onChange={e => setTextContent(e.target.value)}
                autoSize={{ minRows: 20, maxRows: 40 }}
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, background: '#0d1117', borderColor: '#1e293b' }}
                spellCheck={false}
              />
            </>
          )}

          {/* ── ENV NO SELECTION ── */}
          {!selected && !selectedTpl && (
            <Text type="secondary">Select a profile or template from the left menu to edit.</Text>
          )}

          {/* ── JSON TEMPLATE EDITOR ── */}
          {selectedTpl && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text strong style={{ color: '#00d4ff', fontSize: 15, fontFamily: 'JetBrains Mono, monospace' }}>{selectedTpl}</Text>
                <Button size="small" type="primary" icon={<SaveOutlined />} onClick={saveTpl} disabled={!tplDirty}>Save</Button>
              </div>
              <TextArea
                value={tplContent}
                onChange={e => { setTplContent(e.target.value); setTplDirty(true); }}
                autoSize={{ minRows: 20, maxRows: 40 }}
                style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, background: '#0d1117', borderColor: '#1e293b' }}
                spellCheck={false}
              />
            </>
          )}
        </Card>
      </div>

      {/* Create profile modal */}
      <Modal
        title="Create New Profile"
        open={createModal}
        onCancel={() => setCreateModal(false)}
        onOk={doCreate}
        okText="Create"
        okButtonProps={{ disabled: !newName.trim() }}
      >
        <Form layout="vertical">
          <Form.Item label="Profile Name">
            <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. production, test-lab" />
          </Form.Item>
          <Form.Item label="Configuration (KEY=VALUE)">
            <TextArea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              autoSize={{ minRows: 8, maxRows: 20 }}
              style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, background: '#0d1117' }}
              spellCheck={false}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>Initialized from default profile</Text>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function _dictToEnv(d: Record<string, string>): string {
  return Object.entries(d).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
}
function _envToDict(content: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) v = v.slice(1, -1);
    if (k) r[k] = v;
  }
  return r;
}
