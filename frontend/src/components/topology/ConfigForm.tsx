/**
 * ConfigForm — schema-driven structured config editor.
 *
 * Renders the semantic config model (PLMN / network slicing / DNN / log level)
 * from backend field descriptors (GET /api/config-schema) instead of raw
 * key/value pairs. Used for both the per-NF override form and the lab-wide
 * global defaults panel. Empty fields are omitted from the config object so
 * the backend falls back to template defaults.
 */
import { useEffect, useState } from 'react';
import { Input, InputNumber, Select, Button, Space, Typography, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { getConfigSchema, type ConfigSchemaField } from '../../services/api';

const { Text } = Typography;
const mono = 'Consolas, Liberation Mono, Menlo, monospace';

/** Fetch the structured-config schema for a core (and optional NF kind). */
export function useConfigSchema(core: string, kind?: string) {
  const [schema, setSchema] = useState<{ global: ConfigSchemaField[]; node: ConfigSchemaField[] }>({
    global: [],
    node: [],
  });
  useEffect(() => {
    let cancelled = false;
    getConfigSchema(core, kind)
      .then((r) => {
        if (!cancelled) setSchema(r.data || { global: [], node: [] });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [core, kind]);
  return schema;
}

interface ConfigFormProps {
  fields: ConfigSchemaField[];
  value: Record<string, any>;
  onChange: (next: Record<string, any>) => void;
  disabled?: boolean;
}

export default function ConfigForm({ fields, value, onChange, disabled }: ConfigFormProps) {
  // Only touch the schema'd keys; unknown keys (raw env vars, etc.) survive.
  const setField = (key: string, val: any) => {
    const next = { ...value };
    if (val === '' || val === null || val === undefined) delete next[key];
    else next[key] = val;
    onChange(next);
  };

  if (fields.length === 0) {
    return <Text type="secondary" style={{ fontSize: 11 }}>No configurable fields for this element</Text>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {fields.map((f) => {
        if (f.type === 'slices') {
          return (
            <SliceListEditor
              key={f.key}
              field={f}
              value={Array.isArray(value[f.key]) ? value[f.key] : []}
              onChange={(arr) => setField(f.key, arr)}
              disabled={disabled}
            />
          );
        }
        return (
          <div key={f.key}>
            <FieldLabel field={f} />
            {f.type === 'select' ? (
              <Select
                size="small"
                allowClear
                disabled={disabled}
                style={{ width: '100%' }}
                value={value[f.key] ?? undefined}
                placeholder={f.default != null ? String(f.default) : undefined}
                options={(f.options || []).map((o) => ({ value: o, label: o }))}
                onChange={(v) => setField(f.key, v)}
              />
            ) : f.type === 'number' ? (
              <InputNumber
                size="small"
                disabled={disabled}
                style={{ width: '100%' }}
                value={value[f.key] ?? undefined}
                placeholder={f.default != null ? String(f.default) : undefined}
                onChange={(v) => setField(f.key, v)}
              />
            ) : (
              <Input
                size="small"
                disabled={disabled}
                value={value[f.key] ?? ''}
                placeholder={f.default != null ? String(f.default) : undefined}
                onChange={(e) => setField(f.key, e.target.value)}
                style={{ fontFamily: mono, fontSize: 11, background: 'rgba(255,255,255,0.03)' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FieldLabel({ field }: { field: ConfigSchemaField }) {
  return (
    <Space size={4} style={{ marginBottom: 3, display: 'flex', alignItems: 'center' }}>
      <Text style={{ color: '#8a9bb8', fontSize: 10, fontWeight: 600 }}>{field.label}</Text>
      {field.hint && (
        <Tooltip title={field.hint}>
          <QuestionCircleOutlined style={{ color: '#475569', fontSize: 10 }} />
        </Tooltip>
      )}
    </Space>
  );
}

/** Dynamic list editor for network slices (S-NSSAI + DNN + UE pool + DNS). */
function SliceListEditor({
  field,
  value,
  onChange,
  disabled,
}: {
  field: ConfigSchemaField;
  value: Record<string, any>[];
  onChange: (arr: Record<string, any>[]) => void;
  disabled?: boolean;
}) {
  const subFields = field.fields || [];

  const addSlice = () => {
    const blank: Record<string, any> = {};
    subFields.forEach((sf) => {
      if (sf.default != null) blank[sf.key] = sf.default;
    });
    onChange([...value, blank]);
  };

  const removeSlice = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const setSliceField = (i: number, key: string, val: any) => {
    onChange(value.map((s, idx) => (idx === i ? { ...s, [key]: val } : s)));
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <FieldLabel field={field} />
        <Button size="small" type="text" icon={<PlusOutlined />} onClick={addSlice} disabled={disabled} style={{ color: '#00d4ff', fontSize: 10 }}>
          Add
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {value.length === 0 && (
          <Text type="secondary" style={{ fontSize: 10 }}>No slices configured (template defaults used)</Text>
        )}
        {value.map((s, i) => (
          <div key={i} style={{ border: '1px solid #1e3a5f', borderRadius: 8, padding: 8, background: '#111827' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <Text style={{ color: '#00d4ff', fontSize: 10, fontFamily: mono, fontWeight: 700 }}>S-NSSAI #{i + 1}</Text>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removeSlice(i)} disabled={disabled} style={{ fontSize: 10 }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {subFields.map((sf) => (
                <div key={sf.key} style={{ gridColumn: sf.key === 'dnn' || sf.key === 'cidr' ? 'span 2' : undefined }}>
                  <Text style={{ color: '#64748b', fontSize: 9, display: 'block', marginBottom: 2 }}>{sf.label}</Text>
                  {sf.type === 'number' ? (
                    <InputNumber
                      size="small"
                      disabled={disabled}
                      style={{ width: '100%' }}
                      value={s[sf.key] ?? sf.default}
                      onChange={(v) => setSliceField(i, sf.key, v)}
                    />
                  ) : (
                    <Input
                      size="small"
                      disabled={disabled}
                      value={s[sf.key] ?? ''}
                      placeholder={sf.default != null ? String(sf.default) : undefined}
                      onChange={(e) => setSliceField(i, sf.key, e.target.value)}
                      style={{ fontFamily: mono, fontSize: 10, background: 'rgba(255,255,255,0.03)' }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
