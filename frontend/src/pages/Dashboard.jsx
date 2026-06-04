import React, { useEffect, useState } from 'react';
import {
  Activity,
  Clock3,
  Download,
  LogIn,
  LogOut,
  RefreshCw,
  Server,
  Users,
  TrendingUp,
  AlertTriangle,
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

export default function Dashboard() {
  const [devices, setDevices] = useState([]);
  const [summary, setSummary] = useState({
    total_punches: 0,
    total_people: 0,
    in_count: 0,
    out_count: 0,
    by_device: [],
  });
  const [recentPunches, setRecentPunches] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const range = todayRange();
      const [deviceData, summaryData, punchData] = await Promise.all([
        request('/api/devices'),
        request(`/api/summary?from_time=${range.from_time}&to_time=${range.to_time}`),
        request(`/api/punches?from_time=${range.from_time}&to_time=${range.to_time}&limit=10`),
      ]);
      setDevices(deviceData);
      setSummary(summaryData);
      setRecentPunches(punchData);
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