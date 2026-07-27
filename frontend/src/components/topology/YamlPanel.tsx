/**
 * YamlPanel — containerlab-style YAML viewer/editor as a modal dialog.
 *
 * Shows the topology as a *.clab.yml document in a popup. Users can view and
 * edit the YAML directly; "Apply" parses it back into the graph. Reopens
 * fresh from the current graph each time.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Button, message, Modal, Space, Typography } from 'antd';
import {
  CheckOutlined, CopyOutlined, SyncOutlined, FileTextOutlined,
} from '@ant-design/icons';
import * as yaml from 'js-yaml';
import type { TopologyDoc } from '../../services/api';
import { applyTopologyYaml } from '../../services/api';

const { Text } = Typography;
const mono = 'Consolas, Liberation Mono, Menlo, monospace';

interface YamlPanelProps {
  open: boolean;
  onClose: () => void;
  topoName: string;
  doc: TopologyDoc | null;
  onApply: (doc: TopologyDoc) => void;
}

/** Convert a TopologyDoc to containerlab-style YAML (client-side). */
function docToYaml(doc: TopologyDoc): string {
  const kinds: Record<string, any> = {};
  const nodes: Record<string, any> = {};

  (doc.nodes || []).forEach((n) => {
    if (n.kind && n.kind !== 'bridge' && !kinds[n.kind]) {
      kinds[n.kind] = {};
    }
    const entry: any = { kind: n.kind };
    if (n.interfaces && Object.keys(n.interfaces).length > 0) {
      entry.interfaces = n.interfaces;
    }
    if (n.config && Object.keys(n.config).length > 0) {
      entry.config = n.config;
    }
    nodes[n.id] = entry;
  });

  const links = (doc.links || []).map((l) => {
    const eps = l.endpoints || [];
    return {
      endpoints: [
        `${eps[0]?.node || ''}:${eps[0]?.iface || ''}`,
        `${eps[1]?.node || ''}:${eps[1]?.iface || ''}`,
      ],
    };
  });

  const out: any = { name: doc.name };
  const topo: any = {};
  if (Object.keys(kinds).length > 0) topo.kinds = kinds;
  if (Object.keys(nodes).length > 0) topo.nodes = nodes;
  if (links.length > 0) topo.links = links;
  out.topology = topo;

  return yaml.dump(out, { indent: 2, lineWidth: 120, noRefs: true });
}

export default function YamlPanel({ open, onClose, topoName, doc, onApply }: YamlPanelProps) {
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [applying, setApplying] = useState(false);
  const textRef = useRef(text);
  textRef.current = text;

  // Whenever the dialog is (re)opened, show the latest YAML from the graph.
  useEffect(() => {
    if (open) setDirty(false);
  }, [open]);

  // Sync from the doc while open and the user hasn't edited.
  useEffect(() => {
    if (open && doc && !dirty) {
      setText(docToYaml(doc));
    }
  }, [open, doc, dirty]);

  const handleApply = useCallback(async () => {
    setApplying(true);
    try {
      const r = await applyTopologyYaml(topoName, textRef.current);
      const parsed = r.data?.doc;
      if (parsed) {
        onApply(parsed as TopologyDoc);
        setDirty(false);
        message.success('YAML applied to topology');
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'Failed to apply YAML');
    } finally {
      setApplying(false);
    }
  }, [topoName, onApply]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(textRef.current).then(() => message.success('Copied'));
  }, []);

  const handleRefresh = useCallback(() => {
    if (doc) {
      setText(docToYaml(doc));
      setDirty(false);
    }
  }, [doc]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={760}
      title={
        <Space size={8}>
          <FileTextOutlined style={{ color: '#00d4ff' }} />
          <span>Topology YAML</span>
          <Text type="secondary" style={{ fontFamily: mono, fontSize: 12 }}>
            {topoName}.clab.yml
          </Text>
        </Space>
      }
      footer={
        <Space>
          <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>
            Copy
          </Button>
          <Button size="small" icon={<SyncOutlined />} onClick={handleRefresh}>
            Refresh from graph
          </Button>
          <Button size="small" onClick={onClose}>
            Close
          </Button>
          <Button
            type="primary"
            size="small"
            icon={<CheckOutlined />}
            onClick={handleApply}
            loading={applying}
            disabled={!dirty}
          >
            Apply
          </Button>
        </Space>
      }
    >
      <textarea
        className="yaml-modal-editor"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        spellCheck={false}
      />
    </Modal>
  );
}
