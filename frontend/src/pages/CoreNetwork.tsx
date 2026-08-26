import TopologyEditor from '../components/topology/TopologyEditor';

export default function CoreNetwork() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      {/* Header */}
      <div style={{ marginBottom: 14, flexShrink: 0 }}>
        <div className="fx-page-title" style={{ fontSize: 18, marginBottom: 4, paddingBottom: 8 }}>Core Network</div>
        <div style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>
          Design, deploy and monitor containerized 4G/5G core topologies
        </div>
      </div>

      {/* Topology editor (full page). Running / CPU stats are shown in the
          editor toolbar, sourced from the topology's own containers. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TopologyEditor />
      </div>
    </div>
  );
}
