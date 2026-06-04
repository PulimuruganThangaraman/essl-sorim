import React, { useEffect, useState } from 'react';
import {
  RefreshCw, Download, Server, Wifi, WifiOff, AlertTriangle,
  Clock, MapPin, Activity, Smartphone, CheckCircle, XCircle,
  ChevronDown, ChevronUp, HardDrive, ArrowUpDown,
} from 'lucide-react';
import { request } from '../api';

function formatSyncTime(value) {
  if (!value) return 'Never';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [sortBy, setSortBy] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);

  async function load() {
    setLoading(true); setMessage('');
    try {
      const data = await request('/api/devices');
      setDevices(data);
    } catch (err) { setMessage(err.message); }
    finally { setLoading(false); }
  }

  async function syncAll() {
    setSyncing(true); setMessage('');
    try {
      const result = await request('/api/sync', { method: 'POST', body: JSON.stringify({}) });
      const okCount = result.devices.filter((d) => d.status === 'ok').length;
      setMessage(`Sync complete: ${okCount}/${result.devices.length} devices, ${result.new_punches} new punches.`);
      await load();
    } catch (err) { setMessage(err.message); }
    finally { setSyncing(false); }
  }

  async function syncSingle(ip) {
    setSyncing(true); setMessage('');
    try {
      const result = await request('/api/sync', { method: 'POST', body: JSON.stringify({ device_ips: [ip] }) });
      const device = result.devices[0];
      setMessage(device.status === 'ok'
        ? `${device.device}: ${device.new_punches} new punches synced.`
        : `${device.device}: Error - ${device.error}`);
      await load();
    } catch (err) { setMessage(err.message); }
    finally { setSyncing(false); }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const sorted = [...devices].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') cmp = (a.name || '').localeCompare(b.name || '');
    else if (sortBy === 'ip') cmp = (a.ip || '').localeCompare(b.ip || '');
    else if (sortBy === 'status') cmp = (a.status || '').localeCompare(b.status || '');
    else if (sortBy === 'location') cmp = (a.location || '').localeCompare(b.location || '');
    return sortAsc ? cmp : -cmp;
  });

  const stats = {
    total: devices.length,
    online: devices.filter((d) => d.status === 'online').length,
    error: devices.filter((d) => d.status === 'error').length,
    configured: devices.filter((d) => d.status === 'configured').length,
  };

  function toggleSort(field) {
    if (sortBy === field) setSortAsc(!sortAsc);
    else { setSortBy(field); setSortAsc(true); }
  }

  const SortIcon = ({ field }) => {
    if (sortBy !== field) return <ArrowUpDown size={12} style={{ opacity: 0.3 }} />;
    return sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Devices</h1>
          <p>Monitor and manage your biometric attendance devices</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading || syncing}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button type="button" onClick={syncAll} disabled={syncing}>
            <Download size={15} /> {syncing ? 'Syncing...' : 'Sync All'}
          </button>
        </div>
      </header>

      {message && <div className="notice">{message}</div>}

      {/* Stats cards */}
      <section className="devicesStatsRow">
        <div className="deviceStatCard">
          <div className="deviceStatIcon" style={{ background: '#e0e7ff', color: '#4f46e5' }}>
            <Server size={20} />
          </div>
          <div>
            <span className="deviceStatLabel">Total Devices</span>
            <strong className="deviceStatValue">{stats.total}</strong>
          </div>
        </div>
        <div className="deviceStatCard">
          <div className="deviceStatIcon" style={{ background: '#def1e7', color: '#096c43' }}>
            <Wifi size={20} />
          </div>
          <div>
            <span className="deviceStatLabel">Online</span>
            <strong className="deviceStatValue">{stats.online}</strong>
          </div>
        </div>
        <div className="deviceStatCard">
          <div className="deviceStatIcon" style={{ background: '#f9e2dc', color: '#9d321f' }}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <span className="deviceStatLabel">Errors</span>
            <strong className="deviceStatValue">{stats.error}</strong>
          </div>
        </div>
        <div className="deviceStatCard">
          <div className="deviceStatIcon" style={{ background: '#f0f3f1', color: '#565f66' }}>
            <HardDrive size={20} />
          </div>
          <div>
            <span className="deviceStatLabel">Configured</span>
            <strong className="deviceStatValue">{stats.configured}</strong>
          </div>
        </div>
      </section>

      {/* Sort controls */}
      <div className="devicesToolbar">
        <span className="resultCount">Showing {sorted.length} devices</span>
        <div className="sortGroup">
          <span className="sortLabel">Sort by:</span>
          <button type="button" className={`sortBtn ${sortBy === 'name' ? 'active' : ''}`} onClick={() => toggleSort('name')}>
            Name <SortIcon field="name" />
          </button>
          <button type="button" className={`sortBtn ${sortBy === 'status' ? 'active' : ''}`} onClick={() => toggleSort('status')}>
            Status <SortIcon field="status" />
          </button>
          <button type="button" className={`sortBtn ${sortBy === 'ip' ? 'active' : ''}`} onClick={() => toggleSort('ip')}>
            IP <SortIcon field="ip" />
          </button>
          <button type="button" className={`sortBtn ${sortBy === 'location' ? 'active' : ''}`} onClick={() => toggleSort('location')}>
            Location <SortIcon field="location" />
          </button>
        </div>
      </div>

      {/* Device cards */}
      <div className="devicesGrid">
        {sorted.map((device) => {
          const isExpanded = expanded === device.id;
          const statusColor = device.status === 'online' ? '#096c43' :
            device.status === 'error' ? '#9d321f' : '#565f66';
          const statusBg = device.status === 'online' ? '#def1e7' :
            device.status === 'error' ? '#f9e2dc' : '#f0f3f1';

          return (
            <div key={device.id} className="deviceCardNew">
              <div className="deviceCardNewTop">
                <div className="deviceCardNewLeft">
                  <div className="deviceCardNewIcon" style={{ background: statusBg, color: statusColor }}>
                    <Server size={22} />
                  </div>
                  <div className="deviceCardNewInfo">
                    <h3 className="deviceCardNewName">{device.name}</h3>
                    <span className="deviceCardNewSub">{device.short_name}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="deviceCardExpandBtn"
                  onClick={() => setExpanded(isExpanded ? null : device.id)}
                >
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>

              <div className="deviceCardNewStatus">
                <span className={`statusBadge ${device.status}`}>
                  {device.status === 'online' && <Wifi size={12} />}
                  {device.status === 'error' && <AlertTriangle size={12} />}
                  {device.status === 'configured' && <WifiOff size={12} />}
                  {device.status}
                </span>
              </div>

              <div className="deviceCardNewMeta">
                <div className="deviceCardNewMetaItem">
                  <MapPin size={13} />
                  <span>{device.location || 'No location'}</span>
                </div>
                <div className="deviceCardNewMetaItem">
                  <Clock size={13} />
                  <span>{device.last_sync_at ? formatSyncTime(device.last_sync_at) : 'Never synced'}</span>
                </div>
              </div>

              {isExpanded && (
                <div className="deviceCardNewBody">
                  <div className="deviceCardNewRow">
                    <span className="detailLabel">IP Address</span>
                    <span className="detailValue mono">{device.ip}:{device.port}</span>
                  </div>
                  <div className="deviceCardNewRow">
                    <span className="detailLabel">Serial</span>
                    <span className="detailValue mono">{device.actual_serial || device.serial || 'N/A'}</span>
                  </div>
                  <div className="deviceCardNewRow">
                    <span className="detailLabel">Location</span>
                    <span className="detailValue">{device.location || 'N/A'}</span>
                  </div>
                  <div className="deviceCardNewRow">
                    <span className="detailLabel">Direction Mode</span>
                    <span className="detailValue">{device.direction_mode}</span>
                  </div>
                  <div className="deviceCardNewRow">
                    <span className="detailLabel">Default Direction</span>
                    <span className="detailValue">{device.default_direction}</span>
                  </div>
                  <div className="deviceCardNewRow">
                    <span className="detailLabel">Enabled</span>
                    <span className="detailValue">{device.enabled ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="deviceCardNewRow">
                    <span className="detailLabel">Last Sync</span>
                    <span className="detailValue">{formatSyncTime(device.last_sync_at)}</span>
                  </div>
                  {device.error && (
                    <div className="deviceCardNewRow errorRow">
                      <span className="detailLabel">Error</span>
                      <span className="detailValue errorText">{device.error}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="deviceCardNewActions">
                <button
                  type="button"
                  className="btnSmall deviceSyncBtn"
                  onClick={() => syncSingle(device.ip)}
                  disabled={syncing}
                >
                  <Download size={13} />
                  {syncing ? 'Syncing...' : 'Sync Now'}
                </button>
              </div>
            </div>
          );
        })}
        {!sorted.length && !loading && (
          <div className="emptyState">
            <Server size={40} />
            <p>No devices configured. Add devices to <code>devices.json</code> in the project root.</p>
          </div>
        )}
      </div>
    </div>
  );
}