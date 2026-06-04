import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Download,
  FileDown,
  Filter,
  RefreshCw,
  Clock3,
  Users,
  LogIn,
  LogOut,
} from 'lucide-react';
import { request, todayRange, formatPunchTime, API_BASE } from '../api';

function Stat({ icon: Icon, label, value, tone }) {
  return (
    <section className={`stat ${tone || ''}`}>
      <div className="statIcon">
        <Icon size={19} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </section>
  );
}

export default function Attendance() {
  const [devices, setDevices] = useState([]);
  const [punches, setPunches] = useState([]);
  const [summary, setSummary] = useState({
    total_punches: 0,
    total_people: 0,
    in_count: 0,
    out_count: 0,
  });
  const [filters, setFilters] = useState(() => ({
    ...todayRange(),
    device_ip: '',
    direction: '',
    user_id: '',
  }));
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set('limit', '1000');
    return params.toString();
  }, [filters]);

  async function loadData() {
    setLoading(true);
    setMessage('');
    try {
      const [deviceData, punchData, summaryData] = await Promise.all([
        request('/api/devices'),
        request(`/api/punches?${query}`),
        request(`/api/summary?from_time=${filters.from_time}&to_time=${filters.to_time}`),
      ]);
      setDevices(deviceData);
      setPunches(punchData);
      setSummary(summaryData);
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
      const body = {
        from_time: filters.from_time || null,
        to_time: filters.to_time || null,
        device_ips: filters.device_ip ? [filters.device_ip] : null,
      };
      const result = await request('/api/sync', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const okCount = result.devices.filter((d) => d.status === 'ok').length;
      setMessage(`Sync complete: ${okCount}/${result.devices.length} devices, ${result.new_punches} new punches.`);
      await loadData();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSyncing(false);
    }
  }

  function exportCsv() {
    window.open(`${API_BASE}/api/punches.csv?${query}&limit=100000`, '_blank', 'noopener,noreferrer');
  }

  useEffect(() => {
    loadData();
  }, [query]);

  // Auto-refresh data every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      // Re-fetch with current filters
      loadData();
    }, 30000);
    return () => clearInterval(interval);
  }, [query]);

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>All Punches</h1>
          <p>View and filter all recorded punches</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={loadData} disabled={loading || syncing}>
            <RefreshCw size={15} />
            Refresh
          </button>
          <button type="button" className="btnSecondary" onClick={exportCsv}>
            <FileDown size={15} />
            CSV
          </button>
          <button type="button" onClick={syncDevices} disabled={syncing}>
            <Download size={15} />
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
        </div>
      </header>

      {message && <div className="notice">{message}</div>}

      <section className="filters" aria-label="Attendance filters">
        <label>
          <span>From</span>
          <input
            type="datetime-local"
            value={filters.from_time}
            onChange={(e) => setFilters((c) => ({ ...c, from_time: e.target.value }))}
          />
        </label>
        <label>
          <span>To</span>
          <input
            type="datetime-local"
            value={filters.to_time}
            onChange={(e) => setFilters((c) => ({ ...c, to_time: e.target.value }))}
          />
        </label>
        <label>
          <span>Device</span>
          <select
            value={filters.device_ip}
            onChange={(e) => setFilters((c) => ({ ...c, device_ip: e.target.value }))}
          >
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.id} value={d.ip}>{d.name} ({d.ip})</option>
            ))}
          </select>
        </label>
        <label>
          <span>Direction</span>
          <select
            value={filters.direction}
            onChange={(e) => setFilters((c) => ({ ...c, direction: e.target.value }))}
          >
            <option value="">In and out</option>
            <option value="IN">In only</option>
            <option value="OUT">Out only</option>
          </select>
        </label>
        <label>
          <span>User ID</span>
          <input
            type="search"
            value={filters.user_id}
            placeholder="Search ID"
            onChange={(e) => setFilters((c) => ({ ...c, user_id: e.target.value }))}
          />
        </label>
        <button type="button" className="btnSecondary iconOnly" onClick={loadData} title="Apply filters">
          <Filter size={17} />
        </button>
      </section>

      <section className="statsGrid">
        <Stat icon={Clock3} label="Punches" value={summary.total_punches} />
        <Stat icon={Users} label="People" value={summary.total_people} />
        <Stat icon={LogIn} label="In" value={summary.in_count} tone="inTone" />
        <Stat icon={LogOut} label="Out" value={summary.out_count} tone="outTone" />
      </section>

      <div className="card">
        <div className="tableHeader">
          <div>
            <h2>In/Out Punches</h2>
            <p>{loading ? 'Loading records' : `${punches.length} records shown`}</p>
          </div>
          <Activity size={19} />
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Punch time</th>
                <th>Direction</th>
                <th>User</th>
                <th>User ID</th>
                <th>Device</th>
                <th>IP</th>
                <th>Punch type</th>
              </tr>
            </thead>
            <tbody>
              {punches.map((punch) => (
                <tr key={punch.id}>
                  <td>{formatPunchTime(punch.punch_time)}</td>
                  <td>
                    <span className={`badge ${punch.direction.toLowerCase()}`}>{punch.direction}</span>
                  </td>
                  <td>{punch.user_name || 'Unknown'}</td>
                  <td className="mono">{punch.user_id}</td>
                  <td>{punch.device_name}</td>
                  <td className="mono">{punch.device_ip}</td>
                  <td>{punch.punch_label}</td>
                </tr>
              ))}
              {!punches.length && (
                <tr>
                  <td className="empty" colSpan="7">
                    No punches found for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}