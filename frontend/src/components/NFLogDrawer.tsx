import { useState, useEffect, useRef, useCallback } from 'react';
import { Drawer, Tabs, Select, Button, Input, Space, Typography } from 'antd';
import {
  CodeOutlined, FileTextOutlined, SearchOutlined,
  ClearOutlined, PauseCircleOutlined, PlayCircleOutlined,
} from '@ant-design/icons';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getNFLogs } from '../services/api';

const { Text } = Typography;

interface NFLogDrawerProps {
  open: boolean;
  onClose: () => void;
  container: { name: string; nf_type: string } | null;
}

export default function NFLogDrawer({ open, onClose, container }: NFLogDrawerProps) {
  const [activeTab, setActiveTab] = useState<string>('logs');
  const [logs, setLogs] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [shellType, setShellType] = useState<'bash' | 'sh'>('bash');
  const logRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const wsLogRef = useRef<WebSocket | null>(null);
  const wsShellRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Build WebSocket URL
  const buildWsUrl = useCallback((path: string) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${proto}//${host}${path}`;
  }, []);

  // ── Log streaming ──
  useEffect(() => {
    if (!open || !container || activeTab !== 'logs') return;

    setLogs([]);
    const ws = new WebSocket(buildWsUrl(`/api/ws/core/nf/${container.name}/logs`));
    wsLogRef.current = ws;

    ws.onmessage = (evt) => {
      const line = evt.data;
      if (line) {
        setLogs(prev => [...prev.slice(-2000), line]);
      }
    };

    ws.onerror = () => {
      setLogs(prev => [...prev, '[WebSocket error — falling back to REST API]']);
      // Fallback: fetch via REST
      getNFLogs(container.name, 200).then(r => {
        setLogs(r.data.logs || []);
      }).catch(() => {});
    };

    ws.onclose = () => {};

    return () => {
      ws.close();
      wsLogRef.current = null;
    };
  }, [open, container, activeTab, buildWsUrl]);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // ── Shell terminal ──
  useEffect(() => {
    if (!open || !container || activeTab !== 'shell') return;

    // Create terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
      theme: {
        background: '#0d1117',
        foreground: '#b8c4e0',
        cursor: '#00d4ff',
        selectionBackground: 'rgba(0, 212, 255, 0.3)',
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

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    if (termRef.current) {
      term.open(termRef.current);
      setTimeout(() => fitAddon.fit(), 100);
    }

    termInstance.current = term;

    // Connect WebSocket for shell
    const wsUrl = buildWsUrl(`/api/ws/core/nf/${container.name}/shell?shell=${shellType}`);
    const ws = new WebSocket(wsUrl);
    wsShellRef.current = ws;

    ws.onopen = () => {
      term.focus();
    };

    ws.onmessage = (evt) => {
      term.write(evt.data);
    };

    ws.onerror = () => {
      term.write('\r\n\x1b[31m[Connection error]\x1b[0m\r\n');
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[33m[Connection closed]\x1b[0m\r\n');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle resize
    term.onResize(({ cols, rows }) => {
      // Could send resize info to backend if needed
    });

    const handleResize = () => {
      if (fitAddonRef.current) {
        try { fitAddonRef.current.fit(); } catch {}
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      wsShellRef.current = null;
      term.dispose();
      termInstance.current = null;
    };
  }, [open, container, activeTab, shellType, buildWsUrl]);

  // Fit terminal when switching to shell tab
  useEffect(() => {
    if (activeTab === 'shell' && fitAddonRef.current) {
      setTimeout(() => {
        try { fitAddonRef.current?.fit(); } catch {}
      }, 200);
    }
  }, [activeTab]);

  const filteredLogs = searchQuery.trim()
    ? logs.filter(l => l.toLowerCase().includes(searchQuery.toLowerCase()))
    : logs;

  const getLogColor = (line: string) => {
    if (line.includes('error') || line.includes('Error') || line.includes('ERROR') || line.includes('fatal')) return '#ff4d4f';
    if (line.includes('warn') || line.includes('Warn') || line.includes('WARN')) return '#faad14';
    if (line.includes('success') || line.includes('started') || line.includes('ready')) return '#52c41a';
    if (line.includes('info') || line.includes('INFO')) return '#38bdf8';
    return '#b8c4e0';
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        <Space>
          <CodeOutlined style={{ color: '#00d4ff' }} />
          <span style={{ color: '#f0f4ff', fontFamily: 'Consolas, Liberation Mono, Menlo, monospace' }}>
            {container?.name || ''}
          </span>
          <Text type="secondary" style={{ fontSize: 11 }}>
            ({container?.nf_type?.toUpperCase()})
          </Text>
        </Space>
      }
      width={720}
      styles={{
        body: { padding: 0, background: '#0a0e17' },
        header: { background: '#111827', borderColor: '#1e3a5f' },
      }}
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        style={{ height: '100%' }}
        items={[
          {
            key: 'logs',
            label: (
              <Space size={4}>
                <FileTextOutlined />
                <span>Logs</span>
              </Space>
            ),
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
                {/* Toolbar */}
                <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e3a5f', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <SearchOutlined style={{ color: '#64748b' }} />
                  <Input
                    size="small"
                    placeholder="Search logs..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{
                      flex: 1,
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 6,
                      color: '#f0f4ff',
                      fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
                      fontSize: 12,
                    }}
                    allowClear
                  />
                  <Button
                    size="small"
                    icon={autoScroll ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                    onClick={() => setAutoScroll(!autoScroll)}
                    style={{
                      borderRadius: 6,
                      background: autoScroll ? 'rgba(0,212,255,0.1)' : 'rgba(255,255,255,0.05)',
                      borderColor: autoScroll ? '#00d4ff33' : 'rgba(255,255,255,0.1)',
                      color: autoScroll ? '#00d4ff' : '#8a9bb8',
                    }}
                  />
                  <Button
                    size="small"
                    icon={<ClearOutlined />}
                    onClick={() => setLogs([])}
                    style={{ borderRadius: 6, background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#8a9bb8' }}
                  />
                </div>

                {/* Log content */}
                <div
                  ref={logRef}
                  style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '8px 12px',
                    fontFamily: 'Consolas, Liberation Mono, Menlo, monospace',
                    fontSize: 11,
                    lineHeight: 1.5,
                    background: '#0d1117',
                  }}
                >
                  {filteredLogs.length === 0 ? (
                    <div style={{ color: '#64748b', padding: '20px 0', textAlign: 'center' }}>
                      Waiting for log output...
                    </div>
                  ) : (
                    filteredLogs.map((line, i) => (
                      <div
                        key={i}
                        style={{
                          color: getLogColor(line),
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          padding: '1px 0',
                          borderBottom: '1px solid rgba(30,41,59,0.3)',
                        }}
                      >
                        {line}
                      </div>
                    ))
                  )}
                </div>

                {/* Status bar */}
                <div style={{ padding: '4px 12px', borderTop: '1px solid #1e3a5f', fontSize: 10, color: '#64748b' }}>
                  {filteredLogs.length} lines {searchQuery ? `(filtered from ${logs.length})` : ''} | Auto-scroll: {autoScroll ? 'ON' : 'OFF'}
                </div>
              </div>
            ),
          },
          {
            key: 'shell',
            label: (
              <Space size={4}>
                <CodeOutlined />
                <span>Shell</span>
              </Space>
            ),
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
                {/* Shell toolbar */}
                <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e3a5f', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Shell:</Text>
                  <Select
                    size="small"
                    value={shellType}
                    onChange={setShellType}
                    style={{ width: 80 }}
                    options={[
                      { value: 'bash', label: 'bash' },
                      { value: 'sh', label: 'sh' },
                    ]}
                  />
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                    Change shell type to reconnect
                  </Text>
                </div>

                {/* Terminal */}
                <div
                  ref={termRef}
                  style={{
                    flex: 1,
                    padding: '4px',
                    background: '#0d1117',
                    overflow: 'hidden',
                  }}
                />
              </div>
            ),
          },
        ]}
      />
    </Drawer>
  );
}
