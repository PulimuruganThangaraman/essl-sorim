import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import App from './App';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Users from './pages/Users';
import Attendance from './pages/Attendance';
import AttendancePage from './pages/AttendancePage';
import Settings from './pages/Settings';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="devices" element={<Devices />} />
          <Route path="users" element={<Users />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="punches" element={<Attendance />} />
          <Route path="settings" element={<Settings />} />
        </Route>
    </Routes>
  </BrowserRouter>,
);