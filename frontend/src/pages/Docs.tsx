import { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import { Spin, Empty, Segmented } from 'antd';
import { getDocsIndex, getDocContent } from '../services/api';

// Initialise mermaid once (dark theme to match the app). Diagrams are rendered
// on demand inside <MermaidBlock /> rather than on document load.
mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });

type Lang = 'zh' | 'en';
const LANG_KEY = 'rantern-docs-lang';

interface DocEntry {
  id: string;
  title: string;
  file: string;
}

/** Render a ```mermaid fenced block as an inline SVG (falls back to source). */
function MermaidBlock({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${Math.random().toString(36).slice(2)}`;
    mermaid
      .render(id, chart)
      .then(({ svg }) => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (failed) {
    return (
      <pre style={{ color: '#ff7875', fontSize: 12, whiteSpace: 'pre-wrap' }}>{chart}</pre>
    );
  }
  return (
    <div
      ref={ref}
      style={{
        background: '#0d1117',
        border: '1px solid #1e3a5f',
        borderRadius: 8,
        padding: 16,
        margin: '12px 0',
        overflowX: 'auto',
        textAlign: 'center',
      }}
    />
  );
}

// Route ```mermaid code fences to <MermaidBlock />; everything else renders as
// a normal inline <code> element (styled by .docs-markdown).
const markdownComponents: Components = {
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className || '');
    if (match?.[1] === 'mermaid') {
      return <MermaidBlock chart={String(children).replace(/\n$/, '')} />;
    }
    return <code className={className}>{children}</code>;
  },
};

export default function Docs() {
  const [lang, setLang] = useState<Lang>(
    () => (localStorage.getItem(LANG_KEY) as Lang) || 'zh',
  );
  const [entries, setEntries] = useState<DocEntry[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  const changeLang = (value: Lang) => {
    setLang(value);
    localStorage.setItem(LANG_KEY, value);
  };

  useEffect(() => {
    getDocsIndex(lang)
      .then((r) => {
        const list = r.data || [];
        setEntries(list);
        setActiveId((cur) => cur || (list.length > 0 ? list[0].id : ''));
      })
      .catch(() => setEntries([]));
  }, [lang]);

  useEffect(() => {
    if (!activeId) return;
    setLoading(true);
    getDocContent(activeId, lang)
      .then((r) => setContent(typeof r.data === 'string' ? r.data : ''))
      .catch(() => setContent(''))
      .finally(() => setLoading(false));
  }, [activeId, lang]);

  const t = {
    title: lang === 'zh' ? '文档' : 'Documentation',
    empty: lang === 'zh' ? '暂无内容' : 'No content',
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 48px)', gap: 0 }}>
      {/* Sidebar */}
      <div
        style={{
          width: 200,
          flexShrink: 0,
          borderRight: '1px solid #1e293b',
          padding: '16px 0',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            padding: '0 16px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ color: '#00d4ff', fontSize: 14, fontWeight: 700 }}>{t.title}</span>
          <Segmented
            size="small"
            value={lang}
            onChange={(v) => changeLang(v as Lang)}
            options={[
              { label: '中文', value: 'zh' },
              { label: 'EN', value: 'en' },
            ]}
          />
        </div>
        {entries.map((e) => (
          <div
            key={e.id}
            onClick={() => setActiveId(e.id)}
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              fontSize: 13,
              color: activeId === e.id ? '#00d4ff' : '#b8c4e0',
              background: activeId === e.id ? 'rgba(0,212,255,0.08)' : 'transparent',
              borderLeft: activeId === e.id ? '3px solid #00d4ff' : '3px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            {e.title}
          </div>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 40px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', paddingTop: 80 }}>
            <Spin size="large" />
          </div>
        ) : content ? (
          <div className="docs-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <Empty description={t.empty} style={{ marginTop: 80 }} />
        )}
      </div>
    </div>
  );
}
