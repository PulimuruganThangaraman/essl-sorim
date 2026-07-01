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
  LayoutGrid,
  List,
} from 'lucide-react';
import { request, rangeForDays, formatPunchTime, API_BASE, getLocalPrefs } from '../api';

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

function directionClass(direction) {
  return String(direction || 'unknown').toLowerCase();
}

function userInitials(name, userId) {
  const source = String(name || userId || 'U').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function buildUserGroups(punchList, sortOrder = 'desc') {
  const groups = new Map();
  const ascending = sortOrder === 'asc';

  punchList.forEach((punch) => {
    const userId = punch.user_id || 'Unknown ID';
    const userName = punch.user_name || 'Unknown';
    const key = `${userId}::${userName}`;
    const existing = groups.get(key) || {
      key,
      user_id: userId,
      user_name: userName,
      earliest: punch.punch_time,
      latest: punch.punch_time,
      punches: [],
      in_count: 0,
      out_count: 0,
      devices: new Set(),
    };

    existing.punches.push(punch);
    if (punch.direction === 'IN') existing.in_count += 1;
    if (punch.direction === 'OUT') existing.out_count += 1;
    if (punch.device_name) existing.devices.add(punch.device_name);
    if (!existing.earliest || new Date(punch.punch_time) < new Date(existing.earliest)) {
      existing.earliest = punch.punch_time;
    }
    if (!existing.latest || new Date(punch.punch_time) > new Date(existing.latest)) {
      existing.latest = punch.punch_time;
    }
    groups.set(key, existing);
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      devices: Array.from(group.devices),
      punches: [...group.punches].sort((a, b) => {
        const byTime = new Date(a.punch_time) - new Date(b.punch_time);
        const byId = Number(a.id || 0) - Number(b.id || 0);
        return (byTime || byId) * (ascending ? 1 : -1);
      }),
    }))
    .sort((a, b) => {
      const key = ascending ? 'earliest' : 'latest';
      const byTime = new Date(a[key]) - new Date(b[key]);
      return byTime * (ascending ? 1 : -1);
    });
}

export default function Attendance() {
  const initialPrefs = getLocalPrefs();
  const [devices, setDevices] = useState([]);
  const [punches, setPunches] = useState([]);
  const [summary, setSummary] = useState({
    total_punches: 0,
    total_people: 0,
    in_count: 0,
    out_count: 0,
  });
  const [filters, setFilters] = useState(() => ({
    ...rangeForDays(initialPrefs.defaultDateRange || 1),
    device_ip: '',
    direction: '',
    user_id: '',
    sort_order: 'asc',
  }));
  const [rowLimit, setRowLimit] = useState(() => Number(initialPrefs.rowsPerPage) || 1000);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [viewMode, setViewMode] = useState('card');

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    params.set('limit', String(Math.max(10, Number(rowLimit) || 1000)));
    return params.toString();
  }, [filters, rowLimit]);

  async function loadData() {
    setLoading(true);
    setMessage('');
    try {
      const [deviceData, punchData, summaryData] = await Promise.all([
        request('/api/devices'),
        request(`/api/punches?${query}`),
        request(`/api/summary?${query}`),
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

  const isAscending = filters.sort_order === 'asc';
  const recentPunches = useMemo(() => punches.slice(0, 10), [punches]);
  const userGroups = useMemo(
    () => buildUserGroups(punches, filters.sort_order),
    [punches, filters.sort_order],
  );

  useEffect(() => {
    loadData();
  }, [query]);

  useEffect(() => {
    function refreshPrefs() {
      const nextPrefs = getLocalPrefs();
      setRowLimit(Number(nextPrefs.rowsPerPage) || 1000);
    }
    window.addEventListener('sorim:prefs-changed', refreshPrefs);
    window.addEventListener('storage', refreshPrefs);
    return () => {
      window.removeEventListener('sorim:prefs-changed', refreshPrefs);
      window.removeEventListener('storage', refreshPrefs);
    };
  }, []);

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

      <section className="filters attendanceFilters" aria-label="Attendance filters">
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
        <label>
          <span>Sort</span>
          <select
            value={filters.sort_order}
            onChange={(e) => setFilters((c) => ({ ...c, sort_order: e.target.value }))}
          >
            <option value="asc">Time oldest first</option>
            <option value="desc">Time newest first</option>
          </select>
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

      <section className="card">
        <div className="tableHeader">
          <div>
            <h2>{isAscending ? 'Earliest 10 Punches' : 'Recent 10 Punches'}</h2>
            <p>
              {loading
                ? 'Loading records'
                : `${recentPunches.length} ${isAscending ? 'earliest' : 'latest'} punches from this filter`}
            </p>
          </div>
          <Activity size={19} />
        </div>
        <div className="recentPunchGrid">
          {recentPunches.map((punch) => (
            <article key={punch.id} className="recentPunchCard">
              <div className="recentPunchTop">
                <span className={`badge ${directionClass(punch.direction)}`}>{punch.direction || 'N/A'}</span>
                <span className="recentPunchTime">{formatPunchTime(punch.punch_time)}</span>
              </div>
              <strong>{punch.user_name || 'Unknown'}</strong>
              <div className="recentPunchMeta">
                <span className="mono">{punch.user_id}</span>
                <span>{punch.device_name}</span>
              </div>
            </article>
          ))}
          {!recentPunches.length && <p className="emptyText">No punches found for this filter.</p>}
        </div>
      </section>

      <section className="card">
        <div className="tableHeader userPunchHeader">
          <div>
            <h2>Punches By User</h2>
            <p>
              {loading
                ? 'Loading user groups'
                : `${punches.length} punches grouped into ${userGroups.length} users`}
            </p>
          </div>
          <div className="viewToggle" aria-label="Punches by user view">
            <button
              type="button"
              className={`viewBtn ${viewMode === 'card' ? 'active' : ''}`}
              onClick={() => setViewMode('card')}
              title="Card view"
              aria-label="Card view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              type="button"
              className={`viewBtn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
              aria-label="List view"
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {viewMode === 'card' ? (
          <div className="userPunchGrid">
            {userGroups.map((group) => (
              <article key={group.key} className="userPunchCard">
                <div className="userPunchCardTop">
                  <div className="userAvatar">{userInitials(group.user_name, group.user_id)}</div>
                  <div className="userPunchIdentity">
                    <strong>{group.user_name}</strong>
                    <span className="mono">{group.user_id}</span>
                  </div>
                  <span className="userPunchCount">{group.punches.length}</span>
                </div>
                <div className="userPunchMetrics">
                  <span><strong>{group.in_count}</strong>IN</span>
                  <span><strong>{group.out_count}</strong>OUT</span>
                  <span><strong>{group.devices.length}</strong>Devices</span>
                </div>
                <div className="userPunchTimeline">
                  {group.punches.map((punch) => (
                    <div key={punch.id} className="userPunchEvent">
                      <span className={`badge ${directionClass(punch.direction)}`}>{punch.direction || 'N/A'}</span>
                      <div>
                        <strong>{formatPunchTime(punch.punch_time)}</strong>
                        <small>{punch.device_name} &middot; {punch.punch_label}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
            {!userGroups.length && (
              <p className="emptyText">No punches found for this filter.</p>
            )}
          </div>
        ) : (
          <div className="userPunchListView">
            {userGroups.map((group) => (
              <article key={group.key} className="userPunchListGroup">
                <div className="userPunchListUser">
                  <div className="userAvatar small">{userInitials(group.user_name, group.user_id)}</div>
                  <div>
                    <strong>{group.user_name}</strong>
                    <span className="mono">{group.user_id}</span>
                  </div>
                </div>
                <div className="userPunchListSummary">
                  <span>{group.punches.length} punches</span>
                  <span>{group.in_count} IN</span>
                  <span>{group.out_count} OUT</span>
                </div>
                <div className="userPunchListEvents">
                  {group.punches.map((punch) => (
                    <div key={punch.id} className="userPunchListEvent">
                      <span className={`badge ${directionClass(punch.direction)}`}>{punch.direction || 'N/A'}</span>
                      <span>{formatPunchTime(punch.punch_time)}</span>
                      <span>{punch.device_name}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
            {!userGroups.length && (
              <p className="emptyText">No punches found for this filter.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
