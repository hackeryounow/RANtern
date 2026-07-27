import {
  Row, Col,
} from 'antd';
import {
  GlobalOutlined,
} from '@ant-design/icons';
import TopologyEditor from '../components/topology/TopologyEditor';

export default function CoreNetwork() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      {/* Header */}
      <Row justify="space-between" align="middle" style={{ marginBottom: 16, flexShrink: 0 }}>
        <Col>
          <span className="brand-logo">
            <GlobalOutlined className="brand-icon" />
            <span className="brand-text">Core Network</span>
          </span>
        </Col>
      </Row>

      {/* Topology editor (full page). Running / CPU stats are shown in the
          editor toolbar, sourced from the topology's own containers. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TopologyEditor />
      </div>
    </div>
  );
}
