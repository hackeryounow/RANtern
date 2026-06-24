import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Layout as AntLayout, Menu, ConfigProvider, theme } from 'antd';
import {
  DashboardOutlined,
  BarChartOutlined,
  HistoryOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';

const { Sider, Content } = AntLayout;

const navItems = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/ngap-stats', icon: <BarChartOutlined />, label: 'NGAP Stats' },
  { key: '/history', icon: <HistoryOutlined />, label: 'History' },
  { key: '/profile', icon: <SettingOutlined />, label: 'Profile' },
];

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false);

  const onClickMenu: MenuProps['onClick'] = () => {};

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#00d4ff',
          colorBgContainer: '#111827',
          colorBgElevated: '#1a1f2e',
          fontFamily: 'JetBrains Mono, monospace',
        },
        components: {
          Layout: { siderBg: '#0d1117', bodyBg: '#0a0e17' },
          Menu: { darkItemBg: '#0d1117', darkSubMenuItemBg: '#0d1117' },
        },
      }}
    >
      <AntLayout style={{ minHeight: '100vh' }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          trigger={null}
          width={220}
          collapsedWidth={56}
          style={{
            position: 'fixed',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 110,
            borderRight: '1px solid #1e293b',
          }}
        >
          {/* Logo area */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: collapsed ? '12px 14px' : '12px 16px',
              borderBottom: '1px solid #1e293b',
              minHeight: 52,
              justifyContent: collapsed ? 'center' : 'flex-start',
            }}
          >
            <img
              src="/coresimrunner.png"
              alt="CoreSimRunner"
              style={{ width: collapsed ? 28 : 32, height: collapsed ? 28 : 32, objectFit: 'contain', flexShrink: 0 }}
            />
            {!collapsed && (
              <div style={{ overflow: 'hidden' }}>
                <div style={{ color: '#00d4ff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  CoreSimRunner
                </div>
                <div style={{ color: '#64748b', fontSize: 10, whiteSpace: 'nowrap' }}>
                  5G/4G Test Platform
                </div>
              </div>
            )}
          </div>

          {/* Nav items */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Menu
              theme="dark"
              mode="inline"
              selectedKeys={[]}
              items={navItems.map(item => ({
                key: item.key,
                icon: item.icon,
                label: (
                  <NavLink to={item.key} style={{ color: 'inherit', textDecoration: 'none' }}>
                    {item.label}
                  </NavLink>
                ),
              }))}
              onClick={onClickMenu}
              style={{ borderRight: 'none', marginTop: 4 }}
            />
          </div>

          {/* Collapse trigger at bottom */}
          <div
            style={{
              borderTop: '1px solid #1e293b',
              padding: '8px 0',
              textAlign: 'center',
              cursor: 'pointer',
              color: '#64748b',
              fontSize: 16,
              transition: 'color 0.2s',
            }}
            onClick={() => setCollapsed(!collapsed)}
            onMouseEnter={e => (e.currentTarget.style.color = '#00d4ff')}
            onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
          >
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </div>
        </Sider>

        <AntLayout style={{ marginLeft: collapsed ? 56 : 220, transition: 'margin-left 0.2s' }}>
          <Content style={{ padding: '24px 32px', minHeight: '100vh' }}>
            <Outlet />
          </Content>
        </AntLayout>
      </AntLayout>
    </ConfigProvider>
  );
}
