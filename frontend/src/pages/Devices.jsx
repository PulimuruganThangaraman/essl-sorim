import React, { useEffect, useState } from 'react';
import {
  RefreshCw, Download, Server, Wifi, WifiOff, AlertTriangle,
  Clock, MapPin, Activity, Smartphone, CheckCircle, XCircle,
  ChevronDown, ChevronUp, HardDrive, ArrowUpDown, Fingerprint,
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
  const [bioModal, setBioModal] = useState(null);
  const [bioData, setBioData] = useState(null);
  const [bioLoading, setBioLoading] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [bioTab, setBioTab] = useState('users');
  const [actionLoading, setActionLoading] = useState({});
  const [userForm, setUserForm] = useState({ user_id: '', name: '', privilege: 0, password: '', card: '' });
  const [editingUser, setEditingUser] = useState(null);

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

  async function deviceAction(ip, action) {
    setActionLoading((prev) => ({ ...prev, [action]: true })); setMessage('');
    try {
      const result = await request(`/api/devices/${encodeURIComponent(ip)}/${action}`, { method: 'POST' });
      setMessage(result.message || `${action} completed`);
    } catch (err) { setMessage(err.message); }
    finally { setActionLoading((prev) => ({ ...prev, [action]: false })); }
  }

  async function openBiometric(ip) {
    setBioModal(ip); setBioData(null); setBioLoading(true);
    try {
      const data = await request(`/api/device-details?device_ip=${encodeURIComponent(ip)}`);
      setBioData(data[ip] || null);
    } catch (err) { setBioData({ status: 'error', error: err.message }); }
    finally { setBioLoading(false); }
  }

  async function loadDeviceSettings(ip) {
    setBioLoading(true);
    try {
      const data = await request(`/api/devices/${encodeURIComponent(ip)}/settings`);
      setBioData((prev) => ({
        ...prev,
        settings: data,
      }));
    } catch (err) {
      setBioData((prev) => ({
        ...prev,
        settings: { status: 'error', message: err.message },
      }));
    }
    finally { setBioLoading(false); }
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
              <div className="deviceCardNewRow">
                <span className="detailLabel">Device Control</span>
                <div className="deviceControlButtons">
                  <button type="button" className="btnSmall" onClick={() => deviceAction(device.ip, 'restart')} disabled={actionLoading['restart']}>Restart</button>
                  <button type="button" className="btnSmall" onClick={() => deviceAction(device.ip, 'enable')} disabled={actionLoading['enable']}>Enable</button>
                  <button type="button" className="btnSmall btnDanger" onClick={() => deviceAction(device.ip, 'disable')} disabled={actionLoading['disable']}>Disable</button>
                </div>
              </div>
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
                <button
                  type="button"
                  className="btnSmall"
                  onClick={() => openBiometric(device.ip)}
                  disabled={bioLoading && bioModal === device.ip}
                >
                  <Fingerprint size={13} />
                  {bioLoading && bioModal === device.ip ? 'Loading...' : 'Biometric'}
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

      {bioModal && (
        <div className="modalOverlay" onClick={() => setBioModal(null)}>
          <div className="modalContent modalLarge" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h3>Biometric Templates</h3>
              <button type="button" className="modalClose" onClick={() => setBioModal(null)}>✕</button>
            </div>
            <div className="modalBody">
              {!bioData && !bioLoading && <p>No data.</p>}
              {bioLoading && <p>Loading biometric data from device...</p>}
              {bioData && bioData.status === 'error' && (
                <div className="notice error">Error: {bioData.error}</div>
              )}
              {bioData && bioData.status === 'ok' && (
                <div className="bioTableWrap">
                  <div className="bioSummary">
                    <div><strong>Users:</strong> {bioData.users?.length || 0}</div>
                    <div><strong>Punches:</strong> {bioData.punches?.length || 0}</div>
                    <div><strong>Biometric Templates:</strong> {bioData.biometric_templates?.total_templates || 0}</div>
                    <div><strong>Users with Biometrics:</strong> {bioData.biometric_templates?.users_with_biometrics || 0}</div>
                  </div>
                  <div className="bioTabs">
                    <button type="button" className={`bioTab ${bioTab === 'users' ? 'active' : ''}`} onClick={() => setBioTab('users')}>Users</button>
                    <button type="button" className={`bioTab ${bioTab === 'punches' ? 'active' : ''}`} onClick={() => setBioTab('punches')}>Punches</button>
                    <button type="button" className={`bioTab ${bioTab === 'bio' ? 'active' : ''}`} onClick={() => setBioTab('bio')}>Biometric Templates</button>
                    <button type="button" className={`bioTab ${bioTab === 'settings' ? 'active' : ''}`} onClick={() => { setBioTab('settings'); if (!bioData?.settings) loadDeviceSettings(bioModal); }}>Settings</button>
                  </div>
                  <div style={{ display: bioTab === 'users' ? 'block' : 'none' }}>
                    <div className="userFormInline">
                      <div className="userFormFields">
                        <input placeholder="User ID" value={userForm.user_id} onChange={e => setUserForm({ ...userForm, user_id: e.target.value })} />
                        <input placeholder="Name" value={userForm.name} onChange={e => setUserForm({ ...userForm, name: e.target.value })} />
                        <input placeholder="Privilege" type="number" value={userForm.privilege} onChange={e => setUserForm({ ...userForm, privilege: parseInt(e.target.value) || 0 })} />
                        <input placeholder="Password" value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} />
                        <input placeholder="Card" value={userForm.card} onChange={e => setUserForm({ ...userForm, card: e.target.value })} />
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <button type="button" className="btnSmall" onClick={async () => { if (!userForm.user_id) return; setActionLoading((p) => ({ ...p, createUser: true })); try { const isEdit = !!editingUser; await request(`/api/devices/${encodeURIComponent(bioModal)}/users${isEdit ? `/${encodeURIComponent(editingUser)}` : ''}`, { method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(userForm) }); setUserForm({ user_id: '', name: '', privilege: 0, password: '', card: '' }); setEditingUser(null); openBiometric(bioModal); } catch (err) { setMessage(err.message); } finally { setActionLoading((p) => ({ ...p, createUser: false })); } }} disabled={actionLoading['createUser'] || !userForm.user_id}>{editingUser ? 'Update' : 'Create'} User</button>
                        {editingUser && <button type="button" className="btnSmall btnSecondary" onClick={() => { setEditingUser(null); setUserForm({ user_id: '', name: '', privilege: 0, password: '', card: '' }); }}>Cancel</button>}
                      </div>
                    </div>
                    <table className="bioTable">
                      <thead>
                        <tr>
                          <th>User ID</th>
                          <th>Name</th>
                          <th>Password</th>
                          <th>Privilege</th>
                          <th>Card</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(bioData.users || []).map((u, idx) => (
                          <tr key={u.user_id + idx}>
                            <td>{u.user_id}</td>
                            <td>{u.name}</td>
                            <td>{u.password || ''}</td>
                            <td>{u.privilege}</td>
                            <td>{u.card}</td>
                            <td style={{ display: 'flex', gap: '4px' }}>
                              <button type="button" className="btnTiny" onClick={() => { setEditingUser(u.user_id); setUserForm({ user_id: u.user_id, name: u.name, privilege: u.privilege || 0, password: '', card: u.card || '' }); }}>Edit</button>
                              <button type="button" className="btnTiny btnDanger" onClick={async () => { if (!confirm(`Delete user ${u.user_id}?`)) return; setActionLoading((p) => ({ ...p, [`del_${u.user_id}`]: true })); try { await request(`/api/devices/${encodeURIComponent(bioModal)}/users/${encodeURIComponent(u.user_id)}`, { method: 'DELETE' }); openBiometric(bioModal); } catch (err) { setMessage(err.message); } finally { setActionLoading((p) => ({ ...p, [`del_${u.user_id}`]: false })); } }} disabled={actionLoading[`del_${u.user_id}`]}>Del</button>
                            </td>
                          </tr>
                        ))}
                        {!bioData.users?.length && (
                          <tr><td colSpan="6" className="emptyRow">No users on device.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: bioTab === 'punches' ? 'block' : 'none' }}>
                    <table className="bioTable">
                      <thead>
                        <tr>
                          <th>User ID</th>
                          <th>Name</th>
                          <th>Punch Time</th>
                          <th>Type</th>
                          <th>Direction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(bioData.punches || []).slice(0, 200).map((p, idx) => (
                          <tr key={p.user_id + idx + p.timestamp}>
                            <td>{p.user_id}</td>
                            <td>{(bioData.user_names || {})[p.user_id] || p.user_id}</td>
                            <td>{p.punch_time}</td>
                            <td>{p.punch_label}</td>
                            <td>{p.direction}</td>
                          </tr>
                        ))}
                        {!bioData.punches?.length && (
                          <tr><td colSpan="5" className="emptyRow">No punches on device.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: bioTab === 'bio' ? 'block' : 'none' }}>
                    <div className="bioFingerSection">
                      <div className="bioFingerDiagram">
                        <div className="fingerHand">
                          <div className="fingerRow">
                            <div className={`finger ${bioData.biometric_templates?.template_details && Object.values(bioData.biometric_templates.template_details).some(details => details.some(t => t.finger_index == 0)) ? 'active' : ''}`}>L1</div>
                            <div className={`finger ${bioData.biometric_templates?.template_details && Object.values(bioData.biometric_templates.template_details).some(details => details.some(t => t.finger_index == 1)) ? 'active' : ''}`}>L2</div>
                            <div className={`finger ${bioData.biometric_templates?.template_details && Object.values(bioData.biometric_templates.template_details).some(details => details.some(t => t.finger_index == 2)) ? 'active' : ''}`}>L3</div>
                            <div className={`finger ${bioData.biometric_templates?.template_details && Object.values(bioData.biometric_templates.template_details).some(details => details.some(t => t.finger_index == 3)) ? 'active' : ''}`}>L4</div>
                            <div className={`finger ${bioData.biometric_templates?.template_details && Object.values(bioData.biometric_templates.template_details).some(details => details.some(t => t.finger_index == 4)) ? 'active' : ''}`}>L5</div>
                          </div>
                          <div className="fingerRow">
                            <div className={`finger ${bioData.biometric_templates?.template_details && Object.values(bioData.biometric_templates.template_details).some(details => details.some(t => t.finger_index == 5)) ? 'active' : ''}`}>R1</div>
                            <div className={`finger ${bioData.biometric_templates?.template_details && Object.values(bioData.biometric_templates.template_details).some(details => details.some(t => t.finger_index == 6)) ? 'active' : ''}`}>R2</div>
                            <div className={`finger ${bioData.biometric_templates?.template_details && Object.values(bioData.biometric_templates.template_details).some(details => details.some(t => t.finger_index == 7)) ? 'active' : ''}`}>R3</div>
                            <div className={`finger ${bioData.biometric_templates?.template_details && Object.values(bioData.biometric_templates.template_details).some(details => details.some(t => t.finger_index == 8)) ? 'active' : ''}`}>R4</div>
                            <div className={`finger ${bioData.biometric_templates?.template_details && Object.values(bioData.biometric_templates.template_details).some(details => details.some(t => t.finger_index == 9)) ? 'active' : ''}`}>R5</div>
                          </div>
                          <div className="fingerLabels">
                            <span>L = Left Hand</span>
                            <span>R = Right Hand</span>
                            <span>1-5 = Thumb to Little</span>
                          </div>
                        </div>
                      </div>
                      <div className="bioDeviceInfo">
                        <h4>Device Interface</h4>
                        <div className="bioInfoGrid">
                          <div><strong>Platform:</strong> {bioData.device_info?.platform || 'N/A'}</div>
                          <div><strong>Version:</strong> {bioData.device_info?.version || 'N/A'}</div>
                          <div><strong>OEM:</strong> {bioData.device_info?.oem || 'N/A'}</div>
                          <div><strong>Serial:</strong> {bioData.device_info?.actual_serial || 'N/A'}</div>
                        </div>
                      </div>
                    </div>
                    <table className="bioTable">
                      <thead>
                        <tr>
                          <th>User ID</th>
                          <th>User Name</th>
                          <th>Finger</th>
                          <th>Finger Name</th>
                          <th>Valid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(bioData.biometric_templates?.template_details || {}).flatMap(([userId, details]) =>
                          (details || []).map((tpl, idx) => (
                            <tr key={`${userId}-${idx}`}>
                              <td>{userId}</td>
                              <td>{(bioData.user_names || {})[userId] || userId}</td>
                              <td>{tpl.finger_index}</td>
                              <td>{tpl.finger_name}</td>
                              <td>{String(tpl.valid)}</td>
                            </tr>
                          ))
                        )}
                        {!Object.keys(bioData.biometric_templates?.template_details || {}).length && (
                          <tr>
                            <td colSpan="5" className="emptyRow">No biometric templates stored on this device.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: bioTab === 'settings' ? 'block' : 'none' }}>
                    <div className="settingsTabContent">
                      <h4>Device Settings</h4>
                      {bioData.settings?.status === 'ok' ? (
                        <div className="settingsList">
                          {Object.keys(bioData.settings.settings || {}).length > 0 ? (
                            Object.entries(bioData.settings.settings).map(([key, value]) => (
                              <div key={key} className="settingItem">
                                <span className="settingKey">{key}</span>
                                <span className="settingValue">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                              </div>
                            ))
                          ) : (
                            <p className="emptyRow">No settings data returned from device.</p>
                          )}
                        </div>
                      ) : bioData.settings?.status === 'error' ? (
                        <div className="notice error">Error: {bioData.settings.message || 'Failed to load settings'}</div>
                      ) : !bioData.settings ? (
                        <div>
                          <p className="emptyRow">Settings not loaded yet.</p>
                          <button type="button" className="btnSmall" onClick={() => loadDeviceSettings(bioModal)}>Load Settings</button>
                        </div>
                      ) : (
                        <p className="emptyRow">Loading...</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
