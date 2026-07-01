import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Users from './pages/Users';
import Attendance from './pages/Attendance';
import AttendancePage from './pages/AttendancePage';
import Reports from './pages/Reports';
import Exceptions from './pages/Exceptions';
import Payroll from './pages/Payroll';
import Analytics from './pages/Analytics';
import HRProfiles from './pages/HRProfiles';
import Leave from './pages/Leave';
import Assets from './pages/Assets';
import Documents from './pages/Documents';
import Performance from './pages/Performance';
import TimeLogin from './pages/TimeLogin';
import Settings from './pages/Settings';
import './styles.css';

const PREF_KEY = 'sorim_crm_prefs';
const VALID_DEFAULT_PAGES = new Set(['dashboard', 'attendance', 'devices', 'users', 'punches', 'time-login', 'employees', 'leave', 'assets', 'documents', 'performance', 'reports', 'exceptions', 'payroll', 'analytics', 'settings']);

function getDefaultRoute() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    const page = VALID_DEFAULT_PAGES.has(saved.defaultPage) ? saved.defaultPage : 'dashboard';
    return `/${page}`;
  } catch {
    return '/dashboard';
  }
}

function HomeRedirect() {
  return <Navigate to={getDefaultRoute()} replace />;
}

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<HomeRedirect />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="devices" element={<Devices />} />
          <Route path="users" element={<Users />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="punches" element={<Attendance />} />
          <Route path="employees" element={<HRProfiles />} />
          <Route path="leave" element={<Leave />} />
          <Route path="assets" element={<Assets />} />
          <Route path="documents" element={<Documents />} />
          <Route path="performance" element={<Performance />} />
          <Route path="reports" element={<Reports />} />
          <Route path="exceptions" element={<Exceptions />} />
          <Route path="payroll" element={<Payroll />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="time-login" element={<TimeLogin />} />
          <Route path="settings" element={<Settings />} />
        </Route>
    </Routes>
  </BrowserRouter>,
);
