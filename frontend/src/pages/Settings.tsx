import React, { useState, useEffect } from 'react';
import { listProfiles, getProfile, createProfile, updateProfile, deleteProfile, activateProfile } from '../services/api';

export default function Settings() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [active, setActive] = useState('');
  const [selected, setSelected] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState<'form' | 'text' | 'create'>('form');

  // Create mode state
  const [createName, setCreateName] = useState('');
  const [createContent, setCreateContent] = useState('');

  // Text editor mode (for existing profiles)
  const [textContent, setTextContent] = useState('');

  const loadProfiles = () => {
    listProfiles().then(r => {
      setProfiles(r.data.profiles || []);
      setActive(r.data.active || '');
    }).catch(() => {});
  };

  useEffect(() => { loadProfiles(); }, []);

  const handleSelect = async (name: string) => {
    setSelected(name);
    try {
      const res = await getProfile(name);
      const vals = res.data.values || {};
      setValues(vals);
      setTextContent(_dictToEnv(vals));
      setEditMode('form');
    } catch {}
  };

  const handleSave = async () => {
    if (!selected) return;
    const payload = editMode === 'text' ? _envToDict(textContent) : values;
    await updateProfile(selected, payload);
    setValues(payload);
    setEditMode('form');
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    const payload = _envToDict(createContent);
    await createProfile(createName.trim(), payload);
    setCreateName('');
    setCreateContent('');
    loadProfiles();
    setSelected(createName.trim());
    setValues(payload);
    setTextContent(createContent);
    setEditMode('form');
  };

  const handleDelete = async (name: string) => {
    if (name === 'default') return;
    if (!confirm(`Delete profile "${name}"?`)) return;
    await deleteProfile(name);
    if (selected === name) { setSelected(''); setValues({}); setTextContent(''); }
    loadProfiles();
  };

  const handleActivate = async (name: string) => {
    await activateProfile(name);
    setActive(name);
  };

  const handleValueChange = (key: string, val: string) => {
    setValues(prev => ({ ...prev, [key]: val }));
  };

  const startCreate = async () => {
    // Load default config as template
    try {
      const res = await getProfile('default');
      const vals = res.data.values || {};
      setCreateContent(_dictToEnv(vals));
    } catch {
      setCreateContent('');
    }
    setCreateName('');
    setEditMode('create');
    setSelected('');
  };

  const switchToText = () => {
    setTextContent(_dictToEnv(values));
    setEditMode('text');
  };

  const switchToForm = () => {
    setValues(_envToDict(textContent));
    setEditMode('form');
  };

  return (
    <div>
      <h1 style={{ color: 'var(--accent)', fontSize: '24px', marginBottom: '24px', fontFamily: 'var(--font-mono)' }}>
        ⚙ Settings
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '20px', height: 'calc(100vh - 120px)' }}>
        {/* ── Profile list ── */}
        <div className="panel" style={{ overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>PROFILES</span>
            <button className="btn-icon" onClick={startCreate} title="New profile">+</button>
          </div>
          {profiles.map(p => (
            <div
              key={p.name}
              onClick={() => handleSelect(p.name)}
              style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--border-color)',
                cursor: 'pointer',
                background: selected === p.name ? 'var(--accent-bg)' : 'transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                transition: 'background var(--transition)',
              }}
            >
              <div>
                <div style={{ fontSize: '13px', fontWeight: selected === p.name ? 600 : 400 }}>{p.name}</div>
                {p.name === active && <span className="badge badge-success" style={{ fontSize: '10px' }}>ACTIVE</span>}
              </div>
              <div style={{ display: 'flex', gap: '4px' }}>
                {p.name !== active && (
                  <button className="btn" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={e => { e.stopPropagation(); handleActivate(p.name); }}>Set</button>
                )}
                {p.name !== 'default' && (
                  <button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={e => { e.stopPropagation(); handleDelete(p.name); }}>✕</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* ── Editor area ── */}
        <div className="panel" style={{ overflowY: 'auto' }}>
          {/* CREATE MODE */}
          {editMode === 'create' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ color: 'var(--accent)', fontSize: '14px', fontFamily: 'var(--font-mono)' }}>New Profile</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn" onClick={() => { setEditMode('form'); setCreateContent(''); setCreateName(''); }}>Cancel</button>
                  <button className="btn btn-success" onClick={handleCreate} disabled={!createName.trim()}>Create & Save</button>
                </div>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ color: 'var(--text-muted)', fontSize: '11px' }}>PROFILE NAME</label>
                <input
                  className="input"
                  placeholder="e.g. production, test-lab"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  style={{ marginTop: '4px' }}
                />
              </div>

              <div style={{ marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>CONFIGURATION (KEY=VALUE)</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px', marginLeft: '8px' }}>— copied from default profile</span>
              </div>
              <textarea
                className="profile-editor-textarea"
                value={createContent}
                onChange={e => setCreateContent(e.target.value)}
                placeholder="KEY1=value1&#10;KEY2=value2"
                spellCheck={false}
              />
            </>
          )}

          {/* TEXT EDIT MODE (existing profile) */}
          {editMode === 'text' && selected && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ color: 'var(--accent)', fontSize: '16px', fontFamily: 'var(--font-mono)' }}>{selected}.env</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn" onClick={switchToForm}>◀ Form</button>
                  <button className="btn btn-success" onClick={handleSave}>Save</button>
                </div>
              </div>
              <textarea
                className="profile-editor-textarea"
                value={textContent}
                onChange={e => setTextContent(e.target.value)}
                spellCheck={false}
              />
            </>
          )}

          {/* FORM EDIT MODE (existing profile) */}
          {editMode === 'form' && selected && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ color: 'var(--accent)', fontSize: '16px', fontFamily: 'var(--font-mono)' }}>{selected}.env</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn btn-icon" onClick={switchToText} title="Edit as text">✎</button>
                  <button className="btn btn-success" onClick={handleSave}>Save</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '8px', alignItems: 'center' }}>
                {Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => (
                  <React.Fragment key={key}>
                    <label style={{ color: 'var(--text-secondary)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>{key}</label>
                    <input
                      className="input"
                      value={val}
                      onChange={e => handleValueChange(key, e.target.value)}
                      style={{ fontSize: '12px' }}
                    />
                  </React.Fragment>
                ))}
              </div>
            </>
          )}

          {/* NO SELECTION */}
          {editMode === 'form' && !selected && (
            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              Select a profile to edit, or click <span style={{ color: 'var(--accent)', cursor: 'pointer' }} onClick={startCreate}>+</span> to create a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──
function _dictToEnv(d: Record<string, string>): string {
  return Object.entries(d)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function _envToDict(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    // Strip surrounding quotes
    if (value.length >= 2 && ((value[0] === '"' && value[value.length - 1] === '"') || (value[0] === "'" && value[value.length - 1] === "'"))) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}
