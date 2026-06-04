import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Server,
  Users,
  Clock3,
  Fingerprint,
  Activity,
  ClipboardCheck,
  Settings,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

export { API_BASE };

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/attendance', label: 'Attendance', icon: ClipboardCheck },
  { to: '/devices', label: 'Devices', icon: Server },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/punches', label: 'Punches', icon: Activity },
];

const bottomNavItems = [
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function App() {
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebarBrand">
          <Fingerprint size={24} />
          <span>Sorim CRM</span>
        </div>
        <nav className="sidebarNav">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `sidebarLink ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <nav className="sidebarNav">
          {bottomNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `sidebarLink ${isActive ? 'active' : ''}`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebarFooter">
          <small>Biometric Attendance v1.0</small>
        </div>
      </aside>
      <div className="mainArea">
        <Outlet />
      </div>
    </div>
  );
}