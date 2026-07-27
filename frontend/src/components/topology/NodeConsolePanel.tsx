/**
 * NodeConsolePanel — bottom docked console for topology nodes.
 *
 * Shows one tab per opened node console (e.g. `amf1·logs`, `upf1·shell`).
 * Logs stream over WebSocket (`/ws/topologies/{name}/nodes/{id}/logs`); the
 * shell is an interactive xterm PTY (`/ws/topologies/{name}/nodes/{id}/shell`).
 * All tabs stay mounted (hidden when inactive) so terminals/streams persist.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Space, Typography, Select } from 'antd';
import {
  ClearOutlined, PauseCircleOutlined, PlayCircleOutlined, SearchOutlined,
  CloseOutlined, FileTextOutlined, CodeOutlined, DownOutlined, UpOutlined,
} from '@ant-design/icons';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getNodeLogs } from '../../services/api';

const { Text } = Typography;
const mono = 'Consolas, Liberation Mono, Menlo, monospace';

export interface ConsoleTab {
  key: string;
  nodeId: string;
  nodeLabel: string;
  mode: 'logs' | 'shell';
}

interface NodeConsolePanelProps {
  topoName: string;
  tabs: ConsoleTab[];
  activeKey: string | null;
  height: number;
  collapsed: boolean;
  onSelectTab: (key: string) => void;
  onCloseTab: (key: string) => void;
  onToggleCollapse: () => void;
  onCloseAll: () => void;
}

function buildWsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

export default function NodeConsolePanel({
  topoName,
  tabs,
  activeKey,
  height,
  collapsed,
  onSelectTab,
  onCloseTab,
  onToggleCollapse,
  onCloseAll,
}: NodeConsolePanelProps) {
  const [panelHeight, setPanelHeight] = useState(height);
  const [resizing, setResizing] = useState(false);
  const dragging = useRef(false);

  // ── Resize handle logic (drag top edge to grow/shrink) ──
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    setResizing(true);
    const startY = e.clientY;
    const startH = panelHeight;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const maxH = Math.max(200, window.innerHeight * 0.8);
      const h = Math.max(120, Math.min(maxH, startH + (startY - ev.clientY)));
      setPanelHeight(h);
    };
    const onUp = () => {
      dragging.current = false;
      setResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelHeight]);

  if (tabs.length === 0) return null;

  return (
    <div
      style={{
        height: collapsed ? 36 : panelHeight,
        flexShrink: 0,
        borderTop: '1px solid #1e3a5f',
        background: '#0d1117',
        display: 'flex',
        flexDirection: 'column',
        transition: resizing ? 'none' : 'height 0.2s',
        position: 'relative',
      }}
    >
      {/* Resize handle (top edge) */}
      {!collapsed && (
        <div
          onMouseDown={onResizeStart}
          style={{
            position: 'absolute',
            top: -3,
            left: 0,
            right: 0,
            height: 6,
            cursor: 'row-resize',
            zIndex: 10,
          }}
        />
      )}
      {/* Tab bar */}
      <div
        style={{
          minHeight: 40,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          borderBottom: collapsed ? 'none' : '1px solid #1e3a5f',
          overflowX: 'auto',
        }}
      >
        {tabs.map((t) => {
          const active = t.key === activeKey && !collapsed;
          return (
            <div
              key={t.key}
              onClick={() => onSelectTab(t.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                background: active ? '#1e293b' : 'transparent',
                border: `1px solid ${active ? '#334155' : 'transparent'}`,
                whiteSpace: 'nowrap',
              }}
            >
              {t.mode === 'logs' ? (
                <FileTextOutlined style={{ color: '#00d4ff', fontSize: 13 }} />
              ) : (
                <CodeOutlined style={{ color: '#52c41a', fontSize: 13 }} />
              )}
              <Text style={{ color: active ? '#f0f4ff' : '#8a9bb8', fontSize: 12, fontFamily: mono }}>
                {t.nodeLabel}·{t.mode}
              </Text>
              <CloseOutlined
                style={{ color: '#64748b', fontSize: 12 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(t.key);
                }}
              />
            </div>
          );
        })}
        <Space size={4} style={{ marginLeft: 'auto' }}>
          <Button
            type="text"
            size="small"
            icon={collapsed ? <UpOutlined /> : <DownOutlined />}
            onClick={onToggleCollapse}
            style={{ color: '#8a9bb8' }}
          />
        </Space>
      </div>
      {/* Close-all row */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 8px 2px' }}>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onCloseAll}
          title="Close all"
          style={{ color: '#64748b', fontSize: 12 }}
        />
      </div>

      {/* Content (all tabs mounted, hidden when inactive) */}
      {!collapsed && (
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {tabs.map((t) => (
            <div
              key={t.key}
              style={{
                position: 'absolute',
                inset: 0,
                display: t.key === activeKey ? 'flex' : 'none',
                flexDirection: 'column',
              }}
            >
              {t.mode === 'logs' ? (
                <LogsView topoName={topoName} nodeId={t.nodeId} active={t.key === activeKey} />
              ) : (
                <ShellView topoName={topoName} nodeId={t.nodeId} active={t.key === activeKey} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Logs view ───────────────────────────────────────────────────────────
function LogsView({ topoName, nodeId, active }: { topoName: string; nodeId: string; active: boolean }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLogs([]);
    const ws = new WebSocket(buildWsUrl(`/api/ws/topologies/${topoName}/nodes/${nodeId}/logs`));
    ws.onmessage = (evt) => {
      if (evt.data) setLogs((prev) => [...prev.slice(-3000), evt.data]);
    };
    ws.onerror = () => {
      getNodeLogs(topoName, nodeId, 200)
        .then((r) => setLogs(r.data?.logs || []))
        .catch(() => {});
    };
    return () => ws.close();
  }, [topoName, nodeId]);

  useEffect(() => {
    if (autoScroll && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [logs, autoScroll]);

  // Filter against the visible (ANSI-stripped) text so searches match what the
  // user sees rather than raw escape sequences.
  const filtered = query.trim()
    ? logs.filter((l) => stripAnsi(l).toLowerCase().includes(query.toLowerCase()))
    : logs;

  return (
    <>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #1e3a5f', display: 'flex', gap: 8, alignItems: 'center' }}>
        <SearchOutlined style={{ color: '#64748b' }} />
        <Input
          size="small"
          placeholder="Filter logs..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          allowClear
          style={{ flex: 1, background: 'rgba(255,255,255,0.03)', fontFamily: mono, fontSize: 13 }}
        />
        <Button
          size="small"
          icon={autoScroll ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          onClick={() => setAutoScroll(!autoScroll)}
          style={{ color: autoScroll ? '#00d4ff' : '#8a9bb8' }}
        />
        <Button size="small" icon={<ClearOutlined />} onClick={() => setLogs([])} style={{ color: '#8a9bb8' }} />
      </div>
      <div ref={boxRef} style={{ flex: 1, overflowY: 'auto', padding: '6px 10px', fontFamily: mono, fontSize: 13, lineHeight: 1.5, background: '#0d1117' }}>
        {filtered.length === 0 ? (
          <div style={{ color: '#64748b', textAlign: 'center', padding: 16 }}>Waiting for log output...</div>
        ) : (
          filtered.map((line, i) =>
            ANSI_RE.test(line) ? (
              <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: '1px 0' }}>
                {parseAnsiLine(line).map((s, j) => (
                  <span key={j} style={{ color: s.color || '#b8c4e0', fontWeight: s.bold ? 700 : 400 }}>
                    {s.text}
                  </span>
                ))}
              </div>
            ) : (
              <div key={i} style={{ color: logColor(line), whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: '1px 0' }}>
                {line}
              </div>
            ),
          )
        )}
      </div>
    </>
  );
}

function logColor(line: string): string {
  const l = line.toLowerCase();
  if (l.includes('error') || l.includes('fatal') || l.includes('fail')) return '#ff4d4f';
  if (l.includes('warn')) return '#faad14';
  if (l.includes('success') || l.includes('started') || l.includes('ready')) return '#52c41a';
  if (l.includes('info')) return '#38bdf8';
  return '#b8c4e0';
}

// ── ANSI SGR rendering ──────────────────────────────────────────────────
// Container logs (e.g. open5gs) embed ANSI color escapes like \x1b[32m. The
// logs view is plain text, so those showed up as raw "[32m" garbage. Parse the
// SGR sequences and emit colored spans matching the terminal theme.
const ANSI_RE = /\x1b\[[0-9;]*m/;

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// Standard foreground colors (30-37 normal, 90-97 bright), tuned for the dark
// log background (ANSI "black" is mapped to a visible dim gray).
const ANSI_COLORS: Record<number, string> = {
  30: '#4e5a73', 31: '#ff4d4f', 32: '#52c41a', 33: '#faad14',
  34: '#00d4ff', 35: '#c084fc', 36: '#13c2c2', 37: '#e0e7ff',
  90: '#8a9bb8', 91: '#ff7875', 92: '#73d13d', 93: '#ffc53d',
  94: '#40a9ff', 95: '#d3adf7', 96: '#36cfc9', 97: '#ffffff',
};

interface AnsiSeg {
  text: string;
  color?: string;
  bold?: boolean;
}

function parseAnsiLine(line: string): AnsiSeg[] {
  const segs: AnsiSeg[] = [];
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let color: string | undefined;
  let bold = false;
  const flush = (text: string) => {
    if (text) segs.push({ text, color, bold });
  };
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    flush(line.slice(last, m.index));
    last = re.lastIndex;
    const codes = m[1] ? m[1].split(';').map((c) => parseInt(c, 10)) : [0];
    for (const code of codes) {
      if (code === 0) {
        color = undefined;
        bold = false;
      } else if (code === 1) {
        bold = true;
      } else if (code === 22) {
        bold = false;
      } else if (code === 39) {
        color = undefined;
      } else if (ANSI_COLORS[code]) {
        color = ANSI_COLORS[code];
      }
    }
  }
  flush(line.slice(last));
  return segs;
}

// ── Shell view ──────────────────────────────────────────────────────────
function ShellView({ topoName, nodeId, active }: { topoName: string; nodeId: string; active: boolean }) {
  const termRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [shell, setShell] = useState<'sh' | 'bash'>('sh');

  useEffect(() => {
    if (!termRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: mono,
      theme: {
        background: '#0d1117',
        foreground: '#b8c4e0',
        cursor: '#00d4ff',
        black: '#0d1117',
        red: '#ff4d4f',
        green: '#52c41a',
        yellow: '#faad14',
        blue: '#00d4ff',
        magenta: '#c084fc',
        cyan: '#13c2c2',
        white: '#e0e7ff',
      },
    });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(termRef.current);
    setTimeout(() => fit.fit(), 100);

    const ws = new WebSocket(buildWsUrl(`/api/ws/topologies/${topoName}/nodes/${nodeId}/shell?shell=${shell}`));
    ws.onopen = () => term.focus();
    ws.onmessage = (evt) => term.write(evt.data);
    ws.onerror = () => term.write('\r\n\x1b[31m[Connection error]\x1b[0m\r\n');
    ws.onclose = () => term.write('\r\n\x1b[33m[Connection closed]\x1b[0m\r\n');
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    const onResize = () => {
      try {
        fitRef.current?.fit();
      } catch {
        /* noop */
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      ws.close();
      term.dispose();
      fitRef.current = null;
    };
  }, [topoName, nodeId, shell]);

  // Refit when this tab becomes active.
  useEffect(() => {
    if (active) {
      setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch {
          /* noop */
        }
      }, 120);
    }
  }, [active]);

  return (
    <>
      <div style={{ padding: '5px 10px', borderBottom: '1px solid #1e3a5f', display: 'flex', gap: 8, alignItems: 'center' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>Shell:</Text>
        <Select size="small" value={shell} onChange={setShell} style={{ width: 80 }} options={[{ value: 'sh', label: 'sh' }, { value: 'bash', label: 'bash' }]} />
        <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>Change shell to reconnect</Text>
      </div>
      <div ref={termRef} style={{ flex: 1, padding: 4, background: '#0d1117', overflow: 'hidden' }} />
    </>
  );
}
