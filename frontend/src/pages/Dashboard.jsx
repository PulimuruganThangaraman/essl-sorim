import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  Clock3,
  Download,
  FileSpreadsheet,
  LogIn,
  LogOut,
  Mail,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Users,
  TrendingUp,
  UserCheck,
} from 'lucide-react';
import { request, todayRange, formatPunchTime } from '../api';

function StatCard({ icon: Icon, label, value, tone }) {
  return (
    <section className={`statCard ${tone || ''}`}>
      <div className="statCardIcon">
        <Icon size={20} />
      </div>
      <div>
        <p className="statCardLabel">{label}</p>
        <strong className="statCardValue">{value}</strong>
      </div>
    </section>
  );
}

function PulseCard({ icon: Icon, label, value, detail, tone }) {
  return (
    <section className={`pulseCard ${tone || ''}`}>
      <div className="pulseIcon">
        <Icon size={19} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </section>
  );
}

function ShortcutCard({ to, icon: Icon, title, detail }) {
  return (
    <Link to={to} className="shortcutCard">
      <div className="shortcutIcon">
        <Icon size={18} />
      </div>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </Link>
  );
}

function dateParam(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildAttendanceExceptions(rows) {
  const exceptions = [];
  rows.forEach((row) => {
    const name = row.user_name || 'Unknown';
    const id = row.user_id || '-';
    if (!row.first_in) {
      exceptions.push({ key: `${id}-in`, type: 'Missing IN', name, id, detail: `${row.total_punches || 0} punches`, tone: 'warn' });
    }
    if (!row.last_out) {
      exceptions.push({ key: `${id}-out`, type: 'Missing OUT', name, id, detail: row.first_in ? formatPunchTime(row.first_in) : `${row.total_punches || 0} punches`, tone: 'danger' });
    }
    if (row.work_hours !== null && row.work_hours !== undefined && row.work_hours < 5) {
      exceptions.push({ key: `${id}-short`, type: 'Short Hours', name, id, detail: `${row.work_hours}h`, tone: 'warn' });
    }
    if (row.work_hours !== null && row.work_hours !== undefined && row.work_hours > 12) {
      exceptions.push({ key: `${id}-long`, type: 'Long Shift', name, id, detail: `${row.work_hours}h`, tone: 'info' });
    }
  });
  return exceptions;
}

export default function Dashboard() {
  const [devices, setDevices] = useState([]);
  const [users, setUsers] = useState([]);
  const [summary, setSummary] = useState({
    total_punches: 0,
    total_people: 0,
    in_count: 0,
    out_count: 0,
    by_device: [],
  });
  const [recentPunches, setRecentPunches] = useState([]);
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [autoSync, setAutoSync] = useState({ enabled: true, interval_seconds: 60 });
  const [emailConfig, setEmailConfig] = useState({ enabled: false, time: '23:30', to_email: '' });
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const range = todayRange();
      const today = dateParam(new Date());
      const [deviceData, summaryData, punchData, userData, dailyData, syncData, emailData] = await Promise.all([
        request('/api/devices'),
        request(`/api/summary?from_time=${range.from_time}&to_time=${range.to_time}`),
        request(`/api/punches?from_time=${range.from_time}&to_time=${range.to_time}&limit=10`),
        request('/api/users'),
        request(`/api/attendance/daily?from_date=${today}&to_date=${today}`),
        request('/api/auto-sync'),
        request('/api/email/config'),
      ]);
      setDevices(deviceData);
      setSummary(summaryData);
      setRecentPunches(punchData);
      setUsers(userData);
      setAttendanceRows(dailyData);
      setAutoSync(syncData);
      setEmailConfig(emailData);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function syncDevices() {
    setSyncing(true);
    setMessage('');
    try {
      const range = todayRange();
      const result = await request('/api/sync', {
        method: 'POST',
        body: JSON.stringify({ from_time: range.from_time, to_time: range.to_time }),
      });
      const okCount = result.devices.filter((d) => d.status === 'ok').length;
      setMessage(`Sync complete: ${okCount}/${result.devices.length} devices, ${result.new_punches} new punches.`);
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // auto-refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const onlineDevices = devices.filter((d) => d.status === 'online').length;
  const errorDevices = devices.filter((d) => d.status === 'error').length;
  const employeeCount = useMemo(() => new Set(users.map((user) => user.user_id)).size, [users]);
  const attendanceCoverage = employeeCount ? Math.min(100, Math.round((summary.total_people / employeeCount) * 100)) : 0;
  const exceptions = useMemo(() => buildAttendanceExceptions(attendanceRows), [attendanceRows]);
  const reportReady = Boolean(emailConfig.to_email && emailConfig.password_configured);

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Dashboard</h1>
          <p>Overview of your biometric attendance system</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading || syncing}>
            <RefreshCw size={15} />
            Refresh
          </button>
          <button type="button" onClick={syncDevices} disabled={syncing}>
            <Download size={15} />
            {syncing ? 'Syncing...' : 'Sync Devices'}
          </button>
        </div>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="statsGrid">
        <StatCard icon={Clock3} label="Total Punches" value={summary.total_punches} />
        <StatCard icon={Users} label="People Today" value={summary.total_people} />
        <StatCard icon={LogIn} label="Check Ins" value={summary.in_count} tone="inTone" />
        <StatCard icon={LogOut} label="Check Outs" value={summary.out_count} tone="outTone" />
      </section>

      <section className="pulseGrid">
        <PulseCard
          icon={UserCheck}
          label="Coverage"
          value={`${attendanceCoverage}%`}
          detail={`${summary.total_people}/${employeeCount || 0} employees seen`}
          tone={attendanceCoverage >= 80 ? 'good' : 'warn'}
        />
        <PulseCard
          icon={AlertCircle}
          label="Exceptions"
          value={exceptions.length}
          detail="Missing punches or unusual hours"
          tone={exceptions.length ? 'warn' : 'good'}
        />
        <PulseCard
          icon={ShieldCheck}
          label="Device Health"
          value={`${onlineDevices}/${devices.length}`}
          detail={errorDevices ? `${errorDevices} device issue` : 'All configured devices OK'}
          tone={errorDevices ? 'warn' : 'good'}
        />
        <PulseCard
          icon={Mail}
          label="Report Automation"
          value={emailConfig.enabled ? emailConfig.time || 'Scheduled' : 'Manual'}
          detail={reportReady ? 'Email configuration ready' : 'Email needs setup'}
          tone={reportReady ? 'good' : 'warn'}
        />
      </section>

      <div className="operationsGrid">
        <section className="card attentionCard">
          <div className="cardHeader">
            <AlertCircle size={18} />
            <h2>Attention Queue</h2>
          </div>
          <div className="attentionList">
            {exceptions.slice(0, 8).map((item) => (
              <div key={item.key} className="attentionRow">
                <span className={`attentionType ${item.tone}`}>{item.type}</span>
                <div className="attentionInfo">
                  <strong>{item.name}</strong>
                  <small>{item.id} &middot; {item.detail}</small>
                </div>
              </div>
            ))}
            {!exceptions.length && <p className="emptyText">No attendance exceptions today.</p>}
          </div>
          <div className="attentionFooter">
            <Link to="/attendance">Review attendance</Link>
            <Link to="/punches">Open punches</Link>
          </div>
        </section>

        <section className="card shortcutsCard">
          <div className="cardHeader">
            <FileSpreadsheet size={18} />
            <h2>Operations Shortcuts</h2>
          </div>
          <div className="shortcutGrid">
            <ShortcutCard to="/attendance" icon={Clock3} title="Daily Report" detail="First IN, last OUT, work hours" />
            <ShortcutCard to="/punches" icon={Activity} title="Punch Audit" detail="Recent and user-wise punches" />
            <ShortcutCard to="/devices" icon={Server} title="Device Health" detail="Sync and device status" />
            <ShortcutCard to="/settings" icon={Settings} title="Automation" detail={autoSync.enabled ? `Sync ${autoSync.interval_seconds}s` : 'Sync disabled'} />
          </div>
        </section>
      </div>

      <div className="dashboardGrid">
        <section className="card">
          <div className="cardHeader">
            <Server size={18} />
            <h2>Device Status</h2>
          </div>
          <div className="deviceStatusList">
            {devices.map((device) => (
              <div key={device.id} className="deviceStatusRow">
                <div className="deviceStatusInfo">
                  <strong>{device.name}</strong>
                  <small>{device.ip}</small>
                </div>
                <span className={`statusBadge ${device.status}`}>{device.status}</span>
              </div>
            ))}
            {!devices.length && <p className="emptyText">No devices configured.</p>}
          </div>
          <div className="deviceSummary">
            <span className="summaryItem">{devices.length} total</span>
            <span className="summaryItem online">{onlineDevices} online</span>
            {errorDevices > 0 && <span className="summaryItem error">{errorDevices} error</span>}
          </div>
        </section>

        <section className="card">
          <div className="cardHeader">
            <Activity size={18} />
            <h2>Recent Activity</h2>
          </div>
          <div className="activityList">
            {recentPunches.map((punch) => (
              <div key={punch.id} className="activityRow">
                <span className={`badge ${punch.direction.toLowerCase()}`}>{punch.direction}</span>
                <div className="activityInfo">
                  <strong>{punch.user_name || 'Unknown'}</strong>
                  <small>{punch.device_name} &middot; {formatPunchTime(punch.punch_time)}</small>
                </div>
              </div>
            ))}
            {!recentPunches.length && <p className="emptyText">No punches today.</p>}
          </div>
        </section>
      </div>

      {summary.by_device.length > 0 && (
        <section className="card">
          <div className="cardHeader">
            <TrendingUp size={18} />
            <h2>Punches by Device</h2>
          </div>
          <div className="byDeviceGrid">
            {summary.by_device.map((item) => (
              <div key={item.device_ip} className="byDeviceCard">
                <strong>{item.device_name}</strong>
                <span className="byDeviceIp">{item.device_ip}</span>
                <span className="byDeviceCount">{item.punches}</span>
                <span className="byDeviceLabel">punches</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
