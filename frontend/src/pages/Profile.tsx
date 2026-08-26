import { useState, useEffect } from 'react';
import {
  Button, Input, Space, Typography, Tag, Modal, Form, message, Tabs, Radio, Select,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, CheckOutlined, SaveOutlined,
  FileTextOutlined, SettingOutlined, DatabaseOutlined,
  EditOutlined, CopyOutlined, ArrowLeftOutlined,
  GlobalOutlined, KeyOutlined, CodeOutlined,
  SearchOutlined, DownOutlined, RightOutlined,
  TagOutlined, MobileOutlined, CloudOutlined,
  ApiOutlined, LinkOutlined, SafetyOutlined,
  AppstoreOutlined, PhoneOutlined,
} from '@ant-design/icons';
import {
  listProfiles, getProfile, createProfile, updateProfile, deleteProfile, activateProfile,
  listTemplates, getTemplate, updateTemplate,
} from '../services/api';

const { Text, Title } = Typography;
const { TextArea } = Input;

// ── Glassmorphism styles (VoxEra-inspired) ──
const glassCard: React.CSSProperties = {

  border: '1px solid rgba(255, 255, 255, 0.06)',
  borderRadius: 12,
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  color: '#f0f4ff',
  fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
  fontSize: 13,
  padding: '6px 12px',
  transition: 'all 0.2s ease',
  fontWeight: 500,
};

const sectionHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginBottom: 20,
};

const iconBadge = (color: string): React.CSSProperties => ({
  width: 36,
  height: 36,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: `linear-gradient(135deg, ${color}40, ${color}20)`,
  border: `1px solid ${color}30`,
  color,
  fontSize: 18,
});

// ── Category definitions ──
const COMMON_SORT_ORDER = [
  'DEFAULT_CORE_NETWORK', 'CORE_ADDRESS', 'PLMN',
  'PERMANENT_KEY', 'OPC_VALUE',
  'DEFAULT_SUBSCRIPTION_COUNT', 'INITIAL_IMSI_INDEX', 'LOG_LEVEL',
  'DATA_NETWORK_NAME', 'DNN', 'APN',
  'OP_VALUE',
];

const PROVISION_SORT_ORDER = [
  'USERNAME', 'PASSWORD', 'API_TOKEN',
  'WEBUI_PORT', 'FREE5GC_SUBSCRIPTION_TEMPLATE', 'OPEN5GS_SUBSCRIPTION_TEMPLATE',
];

const VOERA_SORT_ORDER = [
  'PUBLIC_HOST', 'ASTERISK_EXTERNAL_IP',
  'VITE_API_URL', 'VITE_SIP_WS_URL', 'VITE_SIP_URI', 'VITE_SIP_PASSWORD',
  'PORT', 'JWT_SECRET',
  'ASTERISK_HOST', 'ASTERISK_PORT', 'ASTERISK_WSS_PORT',
  'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'DATABASE_URL',
];

const CATEGORIES: { key: string; label: string; icon: React.ReactNode; color: string; matchers: (k: string) => boolean }[] = [
  {
    key: 'common',
    label: 'Common',
    icon: <AppstoreOutlined />,
    color: '#00d4ff',
    matchers: k => /^(DEFAULT_CORE_NETWORK|CORE_ADDRESS|PLMN|PERMANENT_KEY|OPC_VALUE|OP_VALUE|DEFAULT_SUBSCRIPTION_COUNT|INITIAL_IMSI_INDEX|LOG_LEVEL|DATA_NETWORK_NAME|DNN|APN)/i.test(k),
  },
  {
    key: 'provision',
    label: 'Provision',
    icon: <KeyOutlined />,
    color: '#eb2f96',
    matchers: k => /^(USERNAME|PASSWORD|API_TOKEN|FREE5GC_SUBSCRIPTION_TEMPLATE|OPEN5GS_SUBSCRIPTION_TEMPLATE|WEBUI_PORT)/i.test(k),
  },
  {
    key: '5g',
    label: '5G',
    icon: <GlobalOutlined />,
    color: '#52c41a',
    matchers: k => /^(GNB_|GNB_NR_|SLICES|SST|SD|NSSAI|SNSSAI|AMF)/i.test(k),
  },
  {
    key: '4g',
    label: '4G / LTE',
    icon: <MobileOutlined />,
    color: '#faad14',
    matchers: k => /^(ENB_|MME_PORT|TAC|IMEISV)/i.test(k),
  },
  {
    key: 'ims',
    label: 'IMS',
    icon: <CloudOutlined />,
    color: '#a78bfa',
    matchers: k => /^(MSISDN_PREFIXES|MSISDN_LENGTH|ENABLE_IMS)/i.test(k),
  },
  {
    key: 'voera',
    label: 'VoEra',
    icon: <PhoneOutlined />,
    color: '#f56a00',
    matchers: k => /^(PUBLIC_HOST|ASTERISK_|VITE_API_URL|VITE_SIP_|PORT|JWT_SECRET|POSTGRES_|DATABASE_URL)/i.test(k),
  },
  {
    key: 'redis',
    label: 'Redis',
    icon: <DatabaseOutlined />,
    color: '#13c2c2',
    matchers: k => /^REDIS_/i.test(k),
  },
  {
    key: 'other',
    label: 'Other',
    icon: <SettingOutlined />,
    color: '#8a9bb8',
    matchers: () => true,
  },
];

function categorizeEntries(entries: [string, string][]): Record<string, [string, string][]> {
  const result: Record<string, [string, string][]> = {};
  const assigned = new Set<string>();

  for (const cat of CATEGORIES) {
    if (cat.key === 'other') continue;
    result[cat.key] = [];
    for (const [k, v] of entries) {
      if (assigned.has(k)) continue;
      if (cat.matchers(k)) {
        result[cat.key].push([k, v]);
        assigned.add(k);
      }
    }
  }

  result['other'] = entries.filter(([k]) => !assigned.has(k));
  return result;
}

interface CategorizedFormProps {
  values: Record<string, string>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  collapsedCats: Set<string>;
  setCollapsedCats: React.Dispatch<React.SetStateAction<Set<string>>>;
}

function CategorizedProfileForm({ values, setValues, searchQuery, setSearchQuery, collapsedCats, setCollapsedCats }: CategorizedFormProps) {
  const entries = Object.entries(values).sort(([a], [b]) => {
    const getOrder = (key: string) => {
      const ci = COMMON_SORT_ORDER.indexOf(key);
      if (ci !== -1) return ci;
      const pi = PROVISION_SORT_ORDER.indexOf(key);
      if (pi !== -1) return pi;
      const vi = VOERA_SORT_ORDER.indexOf(key);
      if (vi !== -1) return vi;
      return 9999;
    };
    const ao = getOrder(a);
    const bo = getOrder(b);
    if (ao !== bo) return ao - bo;
    return a.localeCompare(b);
  });
  const filtered = searchQuery.trim()
    ? entries.filter(([k, v]) => k.toLowerCase().includes(searchQuery.toLowerCase()) || v.toLowerCase().includes(searchQuery.toLowerCase()))
    : entries;
  const categorized = categorizeEntries(filtered);

  const [opMode, setOpMode] = useState<'opc' | 'op'>(() => (values.OP_VALUE && !values.OPC_VALUE) ? 'op' : 'opc');

  const toggleCat = (key: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      {/* Search bar */}
      <div style={{ ...glassCard, padding: '12px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
        <SearchOutlined style={{ color: '#64748b', fontSize: 16 }} />
        <Input
          placeholder="Search variables by name or value..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ flex: 1, background: 'transparent', border: 'none', color: '#f0f4ff', fontSize: 13, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' }}
          allowClear
        />
        {searchQuery && (
          <Tag style={{ borderRadius: 20, border: 'none', background: 'rgba(0, 212, 255, 0.1)', color: '#00d4ff', fontSize: 11 }}>
            {filtered.length} results
          </Tag>
        )}
      </div>

      {/* Category sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {CATEGORIES.map(cat => {
          const items = categorized[cat.key] || [];
          if (items.length === 0) return null;
          const isCollapsed = collapsedCats.has(cat.key);

          return (
            <div key={cat.key} style={glassCard}>
              {/* Category header */}
              <div
                style={{
                  padding: '16px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: 'pointer',
                  borderBottom: isCollapsed ? 'none' : '1px solid rgba(255,255,255,0.05)',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => toggleCat(cat.key)}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: `${cat.color}15`,
                  border: `1px solid ${cat.color}30`,
                  color: cat.color,
                  fontSize: 16,
                }}>
                  {cat.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <Text strong style={{ color: '#f0f4ff', fontSize: 15 }}>{cat.label}</Text>
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>({items.length})</Text>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Tag style={{ borderRadius: 20, border: 'none', background: `${cat.color}15`, color: cat.color, fontSize: 10, fontWeight: 600 }}>
                    {items.length}
                  </Tag>
                  {isCollapsed ? <RightOutlined style={{ color: '#64748b', fontSize: 12 }} /> : <DownOutlined style={{ color: '#64748b', fontSize: 12 }} />}
                </div>
              </div>

              {/* Category content */}
              {!isCollapsed && (
                <div style={{ padding: '20px 24px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px' }}>
                    {items.filter(([key]) => !(cat.key === 'common' && key === 'OP_VALUE')).map(([key, val]) => {
                      const isOpRow = cat.key === 'common' && key === 'OPC_VALUE';
                      return (
                        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <Text style={{ fontSize: 12, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#b8c4e0', fontWeight: 500, padding: '2px 4px' }}>
                            {isOpRow ? 'Operator Key' : key}
                          </Text>
                          {isOpRow ? (
                            <div style={{ display: 'flex', gap: 8 }}>
                              <Input
                                value={opMode === 'opc' ? val : (values.OP_VALUE || '')}
                                onChange={e => {
                                  if (opMode === 'opc') setValues(p => ({ ...p, OPC_VALUE: e.target.value }));
                                  else setValues(p => ({ ...p, OP_VALUE: e.target.value }));
                                }}
                                style={{
                                  flex: 1,
                                  background: 'rgba(255,255,255,0.03)',
                                  border: '1px solid rgba(255,255,255,0.08)',
                                  borderRadius: 10,
                                  color: '#f0f4ff',
                                  fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
                                  fontSize: 13,
                                }}
                                onFocus={e => { e.currentTarget.style.borderColor = `${cat.color}60`; e.currentTarget.style.boxShadow = `0 0 0 3px ${cat.color}15`; }}
                                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}
                              />
                              <Select
                                value={opMode}
                                onChange={mode => {
                                  setOpMode(mode);
                                  if (mode === 'opc') setValues(p => ({ ...p, OP_VALUE: '' }));
                                  else setValues(p => ({ ...p, OPC_VALUE: '' }));
                                }}
                                size="small"
                                style={{ width: 80 }}
                                options={[
                                  { value: 'opc', label: 'OPC' },
                                  { value: 'op', label: 'OP' },
                                ]}
                              />
                            </div>
                          ) : key === 'DEFAULT_CORE_NETWORK' ? (
                            <Select
                              value={val}
                              onChange={v => setValues(p => ({ ...p, [key]: v }))}
                              size="small"
                              style={{ width: '100%' }}
                              options={[
                                { value: 'free5gc', label: 'Free5GC' },
                                { value: 'open5gs', label: 'Open5GS' },
                                { value: 'custom', label: 'Custom' },
                              ]}
                            />
                          ) : (
                            <Input
                              value={val}
                              onChange={e => setValues(p => ({ ...p, [key]: e.target.value }))}
                              style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 10,
                                color: '#f0f4ff',
                                fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
                                fontSize: 13,
                              }}
                              onFocus={e => { e.currentTarget.style.borderColor = `${cat.color}60`; e.currentTarget.style.boxShadow = `0 0 0 3px ${cat.color}15`; }}
                              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Profile() {
  // ── State ──
  const [profiles, setProfiles] = useState<any[]>([]);
  const [active, setActive] = useState('');
  const [selected, setSelected] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState<'form' | 'text'>('form');
  const [textContent, setTextContent] = useState('');
  const [createModal, setCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newValues, setNewValues] = useState<Record<string, string>>({});
  const [newOpMode, setNewOpMode] = useState<'opc' | 'op'>('opc');

  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTpl, setSelectedTpl] = useState('');
  const [tplContent, setTplContent] = useState('');
  const [tplDirty, setTplDirty] = useState(false);

  const [view, setView] = useState<'list' | 'profile' | 'template'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const load = () => {
    listProfiles().then(r => {
      setProfiles(r.data.profiles || []);
      setActive(r.data.active || '');
    }).catch(() => {});
    listTemplates().then(r => setTemplates(r.data.templates || [])).catch(() => {});
  };
  useEffect(load, []);

  // ── Profile handlers ──
  const selectProfile = async (name: string) => {
    setSelected(name);
    setSelectedTpl('');
    setView('profile');
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
    message.success('Profile saved');
  };

  const doCreate = async () => {
    if (!newName.trim()) return;
    const payload = newValues;
    await createProfile(newName.trim(), payload);
    setCreateModal(false);
    setNewName(''); setNewValues({});
    load();
    setSelected(newName.trim());
    setValues(payload);
    setTextContent(_dictToEnv(payload));
    setEditMode('form');
    setView('profile');
    message.success(`Profile "${newName.trim()}" created`);
  };

  const doDelete = async (name: string) => {
    if (name === 'default') return;
    Modal.confirm({
      title: `Delete "${name}"?`,
      okType: 'danger',
      onOk: async () => {
        await deleteProfile(name);
        if (selected === name) { setSelected(''); setValues({}); setTextContent(''); setView('list'); }
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
      setNewValues(res.data.values || {});
    } catch { setNewValues({}); }
    setNewName('');
    setCreateModal(true);
  };

  // ── Template handlers ──
  const selectTpl = async (name: string) => {
    setSelectedTpl(name);
    setSelected('');
    setView('template');
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

  // ── Render: Profile List (grid of cards) ──
  const renderList = () => (
    <div>
      {/* ENV Profiles section */}
      <div style={sectionHeader}>
        <div style={iconBadge('#00d4ff')}><SettingOutlined /></div>
        <div>
          <Title level={5} style={{ margin: 0, color: '#f0f4ff', fontSize: 16 }}>ENV Profiles</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>Manage test environment configurations</Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={openCreate}
          style={{ marginLeft: 'auto', borderRadius: 10, background: 'linear-gradient(135deg, #00d4ff, #6366f1)', border: 'none' }}
        >
          New Profile
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
        {profiles.map(p => (
          <div
            key={p.name}
            style={{
              ...glassCard,

              padding: '18px 20px',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
            }}
            onClick={() => selectProfile(p.name)}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(0, 212, 255, 0.25)';
              e.currentTarget.style.boxShadow = '0 0 30px rgba(0, 212, 255, 0.1)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.07)';
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.2)';
              e.currentTarget.style.transform = 'none';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <Space>
                <DatabaseOutlined style={{ color: '#00d4ff', fontSize: 16 }} />
                <Text strong style={{ color: '#f0f4ff', fontSize: 14, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' }}>{p.name}</Text>
              </Space>
              {p.name === active && (
                <Tag style={{ borderRadius: 20, border: 'none', background: 'rgba(82, 196, 26, 0.15)', color: '#52c41a', fontSize: 10, fontWeight: 600 }}>
                  ACTIVE
                </Tag>
              )}
            </div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {Object.keys(p.values || {}).length} variables configured
            </Text>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              {p.name !== active && (
                <Button
                  size="small"
                  icon={<CheckOutlined />}
                  onClick={e => { e.stopPropagation(); doActivate(p.name); }}
                  style={{ borderRadius: 8, background: 'rgba(82, 196, 26, 0.1)', borderColor: 'rgba(82, 196, 26, 0.3)', color: '#52c41a' }}
                >
                  Activate
                </Button>
              )}
              {p.name !== 'default' && (
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={e => { e.stopPropagation(); doDelete(p.name); }}
                  style={{ borderRadius: 8, background: 'rgba(255, 77, 79, 0.1)', borderColor: 'rgba(255, 77, 79, 0.2)' }}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* JSON Templates section */}
      <div style={sectionHeader}>
        <div style={iconBadge('#a78bfa')}><FileTextOutlined /></div>
        <div>
          <Title level={5} style={{ margin: 0, color: '#f0f4ff', fontSize: 16 }}>JSON Templates</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>Core network subscription templates</Text>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {templates.map(t => (
          <div
            key={t.name}
            style={{
              ...glassCard,

              padding: '18px 20px',
              cursor: 'pointer',
              transition: 'all 0.25s ease',
            }}
            onClick={() => selectTpl(t.name)}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(167, 139, 250, 0.25)';
              e.currentTarget.style.boxShadow = '0 0 30px rgba(167, 139, 250, 0.1)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.07)';
              e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.2)';
              e.currentTarget.style.transform = 'none';
            }}
          >
            <Space>
              <CodeOutlined style={{ color: '#a78bfa', fontSize: 16 }} />
              <Text strong style={{ color: '#f0f4ff', fontSize: 14, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' }}>{t.name}</Text>
            </Space>
          </div>
        ))}
      </div>
    </div>
  );

  // ── Render: Profile Editor ──
  const renderProfileEditor = () => (
    <div>
      {/* Back button + header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => setView('list')}
          style={{ borderRadius: 10, background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#8a9bb8' }}
        >
          Back
        </Button>
        <div style={iconBadge('#00d4ff')}><DatabaseOutlined /></div>
        <div style={{ flex: 1 }}>
          <Title level={5} style={{ margin: 0, color: '#f0f4ff', fontSize: 16 }}>
            {selected}.env
            {selected === active && (
              <Tag style={{ marginLeft: 8, borderRadius: 20, border: 'none', background: 'rgba(82, 196, 26, 0.15)', color: '#52c41a', fontSize: 10 }}>
                ACTIVE
              </Tag>
            )}
          </Title>
        </div>
        <Space>
          <Button
            size="small"
            icon={editMode === 'form' ? <EditOutlined /> : <CopyOutlined />}
            onClick={() => {
              if (editMode === 'form') { setTextContent(_dictToEnv(values)); setEditMode('text'); }
              else { setValues(_envToDict(textContent)); setEditMode('form'); }
            }}
            style={{ borderRadius: 8, background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#8a9bb8' }}
          >
            {editMode === 'form' ? 'Text Mode' : 'Form Mode'}
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<SaveOutlined />}
            onClick={saveProfile}
            style={{ borderRadius: 8, background: 'linear-gradient(135deg, #00d4ff, #6366f1)', border: 'none' }}
          >
            Save
          </Button>
        </Space>
      </div>

      {/* Form mode */}
      {editMode === 'form' && (
        <CategorizedProfileForm
          values={values}
          setValues={setValues}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          collapsedCats={collapsedCats}
          setCollapsedCats={setCollapsedCats}
        />
      )}

      {/* Text mode */}
      {editMode === 'text' && (
        <div style={glassCard}>
          <div style={{ padding: '20px 24px' }}>
            <TextArea
              value={textContent}
              onChange={e => setTextContent(e.target.value)}
              autoSize={{ minRows: 20, maxRows: 40 }}
              style={{ ...inputStyle, fontSize: 12, lineHeight: 1.6, padding: 16 }}
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </div>
  );

  // ── Render: Template Editor ──
  const renderTemplateEditor = () => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => setView('list')}
          style={{ borderRadius: 10, background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#8a9bb8' }}
        >
          Back
        </Button>
        <div style={iconBadge('#a78bfa')}><CodeOutlined /></div>
        <div style={{ flex: 1 }}>
          <Title level={5} style={{ margin: 0, color: '#f0f4ff', fontSize: 16 }}>{selectedTpl}</Title>
        </div>
        <Button
          size="small"
          type="primary"
          icon={<SaveOutlined />}
          onClick={saveTpl}
          disabled={!tplDirty}
          style={{ borderRadius: 8, background: 'linear-gradient(135deg, #a78bfa, #7c3aed)', border: 'none' }}
        >
          Save
        </Button>
      </div>

      <div style={glassCard}>
        <div style={{ padding: '20px 24px' }}>
          <TextArea
            value={tplContent}
            onChange={e => { setTplContent(e.target.value); setTplDirty(true); }}
            autoSize={{ minRows: 24, maxRows: 50 }}
            style={{ ...inputStyle, fontSize: 12, lineHeight: 1.6, padding: 16 }}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '0 4px' }}>
      <Title level={4} style={{ margin: '0 0 20px', color: '#00d4ff', fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', fontSize: 20 }}>
        <SettingOutlined style={{ marginRight: 10 }} />
        Configuration
      </Title>

      {view === 'list' && renderList()}
      {view === 'profile' && renderProfileEditor()}
      {view === 'template' && renderTemplateEditor()}

      {/* Create profile modal — categorized form */}
      <Modal
        title={
          <Space>
            <div style={iconBadge('#00d4ff')}><PlusOutlined /></div>
            <span style={{ color: '#f0f4ff' }}>Create New Profile</span>
          </Space>
        }
        open={createModal}
        onCancel={() => setCreateModal(false)}
        onOk={doCreate}
        okText="Create"
        okButtonProps={{ disabled: !newName.trim(), style: { borderRadius: 10, background: 'linear-gradient(135deg, #00d4ff, #6366f1)', border: 'none' } }}
        cancelButtonProps={{ style: { borderRadius: 10, background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#8a9bb8' } }}
        width={960}
        styles={{ body: { padding: '28px 32px' }, mask: { background: "rgba(0,0,0,0.7)" } }}
      >
        <Form layout="vertical" style={{ marginBottom: 16 }}>
          <Form.Item label={<Text style={{ color: '#8a9bb8' }}>Profile Name</Text>}>
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. production, test-lab"
              style={inputStyle}
            />
          </Form.Item>
        </Form>

        <Tabs
          defaultActiveKey="common"
          items={CATEGORIES.filter(c => c.key !== 'other').map(cat => {
            const entries = Object.entries(newValues)
              .filter(([k]) => cat.matchers(k))
              .sort(([a], [b]) => {
                const getOrder = (key: string) => {
                  const ci = COMMON_SORT_ORDER.indexOf(key);
                  if (ci !== -1) return ci;
                  const pi = PROVISION_SORT_ORDER.indexOf(key);
                  if (pi !== -1) return pi;
                  return 9999;
                };
                const ao = getOrder(a);
                const bo = getOrder(b);
                if (ao !== bo) return ao - bo;
                return a.localeCompare(b);
              });
            return {
              key: cat.key,
              label: (
                <Space size={4}>
                  <span style={{ color: cat.color, fontSize: 14 }}>{cat.icon}</span>
                  <span style={{ color: '#f0f4ff', fontSize: 13 }}>{cat.label}</span>
                  <Tag style={{ borderRadius: 20, border: 'none', background: `${cat.color}15`, color: cat.color, fontSize: 10 }}>{entries.length}</Tag>
                </Space>
              ),
              children: (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 24px', padding: '8px 0' }}>
                    {entries.filter(([key]) => !(cat.key === 'common' && key === 'OP_VALUE')).map(([key, val]) => {
                      const isOpRow = cat.key === 'common' && key === 'OPC_VALUE';
                      return (
                        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <Text style={{ fontSize: 12, fontFamily: 'Consolas, Liberation Mono, Menlo, monospace', color: '#b8c4e0', fontWeight: 500, padding: '2px 4px' }}>
                            {isOpRow ? 'Operator Key' : key}
                          </Text>
                          {isOpRow ? (
                            <div style={{ display: 'flex', gap: 8 }}>
                              <Input
                                value={newOpMode === 'opc' ? val : (newValues.OP_VALUE || '')}
                                onChange={e => {
                                  if (newOpMode === 'opc') setNewValues(p => ({ ...p, OPC_VALUE: e.target.value }));
                                  else setNewValues(p => ({ ...p, OP_VALUE: e.target.value }));
                                }}
                                style={{
                                  flex: 1,
                                  background: 'rgba(255,255,255,0.03)',
                                  border: '1px solid rgba(255,255,255,0.08)',
                                  borderRadius: 10,
                                  color: '#f0f4ff',
                                  fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
                                  fontSize: 13,
                                }}
                                onFocus={e => { e.currentTarget.style.borderColor = `${cat.color}60`; e.currentTarget.style.boxShadow = `0 0 0 3px ${cat.color}15`; }}
                                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}
                              />
                              <Select
                                value={newOpMode}
                                onChange={mode => {
                                  setNewOpMode(mode);
                                  if (mode === 'opc') setNewValues(p => ({ ...p, OP_VALUE: '' }));
                                  else setNewValues(p => ({ ...p, OPC_VALUE: '' }));
                                }}
                                size="small"
                                style={{ width: 80 }}
                                options={[
                                  { value: 'opc', label: 'OPC' },
                                  { value: 'op', label: 'OP' },
                                ]}
                              />
                            </div>
                          ) : key === 'DEFAULT_CORE_NETWORK' ? (
                            <Select
                              value={val}
                              onChange={v => setNewValues(p => ({ ...p, [key]: v }))}
                              size="small"
                              style={{ width: '100%' }}
                              options={[
                                { value: 'free5gc', label: 'Free5GC' },
                                { value: 'open5gs', label: 'Open5GS' },
                                { value: 'custom', label: 'Custom' },
                              ]}
                            />
                          ) : (
                            <Input
                              value={val}
                              onChange={e => setNewValues(p => ({ ...p, [key]: e.target.value }))}
                              style={{
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: 10,
                                color: '#f0f4ff',
                                fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
                                fontSize: 13,
                              }}
                              onFocus={e => { e.currentTarget.style.borderColor = `${cat.color}60`; e.currentTarget.style.boxShadow = `0 0 0 3px ${cat.color}15`; }}
                              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.boxShadow = 'none'; }}
                            />
                          )}
                        </div>
                      );
                    })}
                    {entries.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>No parameters in this category</Text>}
                  </div>
                </div>
              ),
            };
          })}
        />

        <Text type="secondary" style={{ fontSize: 11 }}>Initialized from default profile values</Text>
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
