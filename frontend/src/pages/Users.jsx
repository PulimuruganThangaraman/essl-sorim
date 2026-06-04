import React, { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Plus,
  Trash2,
  Search,
  X,
  Grid3X3,
  List,
  Shield,
  CreditCard,
  Smartphone,
  UserPlus,
  Users as UsersIcon,
  ChevronDown,
  ChevronUp,
  Edit3,
  Upload,
  Save,
} from 'lucide-react';
import { request } from '../api';

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  '#176b58', '#2d6a8f', '#8b5cf6', '#d97706',
  '#dc2626', '#059669', '#7c3aed', '#0891b2',
  '#be185d', '#4f46e5', '#0d9488', '#c2410c',
];

function getAvatarColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function UserCard({ user, onDelete, onEdit, onPush, allRecords, devices }) {
  const [expanded, setExpanded] = useState(false);
  const userRecords = allRecords.filter((r) => r.user_id === user.user_id);
  return (
    <div className={`userCard ${expanded ? 'expanded' : ''}`}>
      <div className="userCardTop" onClick={() => setExpanded(!expanded)}>
        <div className="userAvatar" style={{ background: getAvatarColor(user.user_id) }}>
          {getInitials(user.name)}
        </div>
        <div className="userCardInfo">
          <strong className="userCardName">{user.name || 'Unnamed User'}</strong>
          <span className="userCardId">{user.user_id}</span>
        </div>
        <div className="userCardRight">
          <span className={`privilegePill ${user.privilege === 1 ? 'admin' : user.privilege === 2 ? 'enroller' : ''}`}>
            {user.privilege === 1 ? 'Admin' : user.privilege === 2 ? 'Enroller' : 'Normal'}
          </span>
          <span className="userCardChevron">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>
      </div>
      {expanded && (
        <div className="userCardBody">
          <div className="userCardDivider" />
          <div className="userDevicesCompact">
            {userRecords.map((record) => (
              <div key={record.device_id} className="userDeviceCompact">
                <div className="userDeviceLeft">
                  <div className="userDeviceDot" />
                  <div className="userDeviceText">
                    <span className="userDeviceNameCompact">{record.device_name}</span>
                    <span className="userDeviceIpCompact">{record.device_ip}</span>
                  </div>
                </div>
                {record.card && record.card !== '0' && (
                  <span className="userCardBadge">{record.card}</span>
                )}
              </div>
            ))}
          </div>
          <div className="userCardActions">
            <button type="button" className="btnSmall" style={{ background: '#e0e7ff', color: '#4f46e5' }} onClick={(e) => { e.stopPropagation(); onEdit(user); }}>
              <Edit3 size={13} /> Edit
            </button>
            <button type="button" className="btnSmall" style={{ background: '#ddebe4', color: '#176b58' }} onClick={(e) => { e.stopPropagation(); onPush(user); }}>
              <Upload size={13} /> Push to Device
            </button>
            <button type="button" className="btnDanger btnSmall" onClick={(e) => { e.stopPropagation(); onDelete(userRecords[0]?.device_id, user.user_id, user.name); }}>
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [viewMode, setViewMode] = useState('table');
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [form, setForm] = useState({
    device_id: '',
    user_id: '',
    name: '',
    privilege: 0,
    password: '',
    group_id: '',
    card: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [pushTarget, setPushTarget] = useState(null);

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const [userData, deviceData] = await Promise.all([
        request('/api/users'),
        request('/api/devices'),
      ]);
      setUsers(userData);
      setDevices(deviceData);
      if (deviceData.length && !form.device_id) {
        setForm((prev) => ({ ...prev, device_id: deviceData[0].id }));
      }
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await request('/api/users', {
        method: 'POST',
        body: JSON.stringify({ ...form, privilege: parseInt(form.privilege, 10) || 0 }),
      });
      setMessage(`User "${form.user_id}" created/updated successfully.`);
      resetForm();
      setShowForm(false);
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(e) {
    e.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const records = users.filter((u) => u.user_id === editUser.user_id);
      for (const record of records) {
        await request(`/api/users/${record.device_id}/${editUser.user_id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: form.name,
            privilege: parseInt(form.privilege, 10) || 0,
            password: form.password,
            group_id: form.group_id,
            card: form.card,
          }),
        });
      }
      setMessage(`User "${editUser.user_id}" updated successfully.`);
      setEditUser(null);
      resetForm();
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(deviceId, userId, userName) {
    if (!window.confirm(`Delete user "${userName || userId}" (${userId})?`)) return;
    setMessage('');
    try {
      await request(`/api/users/${encodeURIComponent(deviceId)}/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
      setMessage(`User "${userId}" deleted.`);
      await load();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function handlePush(user) {
    if (!devices.length) {
      setMessage('No devices available.');
      return;
    }
    setPushTarget(user);
  }

  async function doPush(deviceIp) {
    if (!pushTarget) return;
    setMessage('');
    try {
      await request('/api/users/push', {
        method: 'POST',
        body: JSON.stringify({
          device_ip: deviceIp,
          user_id: pushTarget.user_id,
          name: pushTarget.name || '',
          privilege: pushTarget.privilege || 0,
          password: '',
          card: pushTarget.card || '',
        }),
      });
      setMessage(`User "${pushTarget.user_id}" pushed to device ${deviceIp}.`);
      setPushTarget(null);
    } catch (err) {
      setMessage(err.message);
    }
  }

  function openEdit(user) {
    setForm((prev) => ({
      ...prev,
      name: user.name || '',
      privilege: user.privilege || 0,
      password: '',
      card: user.card || '',
      group_id: user.group_id || '',
    }));
    setEditUser(user);
    setShowForm(false);
  }

  function resetForm() {
    setForm({
      device_id: devices[0]?.id || '',
      user_id: '',
      name: '',
      privilege: 0,
      password: '',
      group_id: '',
      card: '',
    });
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const uniqueUsers = useMemo(() => {
    const seen = new Map();
    users.forEach((u) => {
      const key = u.user_id;
      if (!seen.has(key)) {
        seen.set(key, { ...u, deviceCount: 0, devices: [], uid: u.uid });
      }
      const entry = seen.get(key);
      entry.deviceCount += 1;
      entry.devices.push(u.device_name);
    });
    return Array.from(seen.values());
  }, [users]);

  const filtered = useMemo(() => {
    let result = uniqueUsers;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (u) =>
          (u.name && u.name.toLowerCase().includes(q)) ||
          (u.user_id && u.user_id.toLowerCase().includes(q)) ||
          u.devices.some((d) => d.toLowerCase().includes(q)),
      );
    }
    result.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') cmp = (a.name || '').localeCompare(b.name || '');
      else if (sortField === 'user_id') cmp = a.user_id.localeCompare(b.user_id);
      else if (sortField === 'deviceCount') cmp = a.deviceCount - b.deviceCount;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [uniqueUsers, search, sortField, sortDir]);

  const stats = useMemo(() => {
    const admins = uniqueUsers.filter((u) => u.privilege === 1).length;
    const withCard = uniqueUsers.filter((u) => u.card && u.card !== '0' && u.card !== '').length;
    const deviceBreakdown = devices.map((d) => ({
      name: d.name,
      count: users.filter((u) => u.device_id === d.id).length,
    }));
    return { total: uniqueUsers.length, admins, withCard, deviceBreakdown };
  }, [uniqueUsers, users, devices]);

  function toggleSort(field) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  }

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronDown size={12} style={{ opacity: 0.3 }} />;
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
  };

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Users</h1>
          <p>Manage biometric user profiles across all devices</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button type="button" onClick={() => { setShowForm(!showForm); setEditUser(null); resetForm(); }}>
            {showForm ? <X size={15} /> : <UserPlus size={15} />}
            {showForm ? 'Cancel' : 'Add User'}
          </button>
        </div>
      </header>

      {message && <div className="notice">{message}</div>}

      {/* Push target modal */}
      {pushTarget && (
        <div className="pushModal">
          <div className="pushModalContent">
            <h3><Upload size={18} /> Push "{pushTarget.name || pushTarget.user_id}" to Device</h3>
            <p>Select a device to push this user to:</p>
            <div className="pushDeviceList">
              {devices.map((d) => (
                <button key={d.id} type="button" className="pushDeviceBtn" onClick={() => doPush(d.ip)}>
                  <Smartphone size={16} />
                  <div>
                    <strong>{d.name}</strong>
                    <small>{d.ip}</small>
                  </div>
                  <span className={`statusBadge ${d.status}`}>{d.status}</span>
                </button>
              ))}
            </div>
            <button type="button" className="btnSecondary" onClick={() => setPushTarget(null)} style={{ marginTop: 12 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Stats row */}
      <section className="userStatsRow">
        <div className="userStatCard">
          <div className="userStatIcon" style={{ background: '#ddebe4', color: '#176b58' }}><UsersIcon size={20} /></div>
          <div><span className="userStatLabel">Total Users</span><strong className="userStatValue">{stats.total}</strong></div>
        </div>
        <div className="userStatCard">
          <div className="userStatIcon" style={{ background: '#f9e2dc', color: '#9d321f' }}><Shield size={20} /></div>
          <div><span className="userStatLabel">Admins</span><strong className="userStatValue">{stats.admins}</strong></div>
        </div>
        <div className="userStatCard">
          <div className="userStatIcon" style={{ background: '#e0e7ff', color: '#4f46e5' }}><CreditCard size={20} /></div>
          <div><span className="userStatLabel">With Card</span><strong className="userStatValue">{stats.withCard}</strong></div>
        </div>
        {stats.deviceBreakdown.map((d) => (
          <div key={d.name} className="userStatCard">
            <div className="userStatIcon" style={{ background: '#f0fdf4', color: '#15803d' }}><Smartphone size={20} /></div>
            <div><span className="userStatLabel">{d.name}</span><strong className="userStatValue">{d.count}</strong></div>
          </div>
        ))}
      </section>

      {/* Create form */}
      {showForm && (
        <form className="card userCreateForm" onSubmit={handleCreate}>
          <div className="formTitle"><UserPlus size={20} /><h3>Create / Update User</h3></div>
          <div className="formGrid">
            <label><span>Device *</span>
              <select value={form.device_id} onChange={(e) => setForm((p) => ({ ...p, device_id: e.target.value }))} required>
                {devices.map((d) => (<option key={d.id} value={d.id}>{d.name} ({d.ip})</option>))}
              </select>
            </label>
            <label><span>User ID *</span>
              <input type="text" value={form.user_id} onChange={(e) => setForm((p) => ({ ...p, user_id: e.target.value }))} placeholder="e.g. ST-26-001" required />
            </label>
            <label><span>Full Name</span>
              <input type="text" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. John Doe" />
            </label>
            <label><span>Privilege</span>
              <select value={form.privilege} onChange={(e) => setForm((p) => ({ ...p, privilege: e.target.value }))}>
                <option value={0}>Normal User</option><option value={1}>Admin</option><option value={2}>Enroller</option>
              </select>
            </label>
            <label><span>Device Password</span>
              <input type="text" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} placeholder="Leave blank for none" />
            </label>
            <label><span>Card Number</span>
              <input type="text" value={form.card} onChange={(e) => setForm((p) => ({ ...p, card: e.target.value }))} placeholder="RFID card number" />
            </label>
            <label><span>Group ID</span>
              <input type="text" value={form.group_id} onChange={(e) => setForm((p) => ({ ...p, group_id: e.target.value }))} placeholder="e.g. default" />
            </label>
          </div>
          <div className="formActions">
            <button type="submit" disabled={submitting}><Plus size={15} />{submitting ? 'Saving...' : 'Save User'}</button>
            <button type="button" className="btnSecondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Edit form */}
      {editUser && (
        <form className="card userCreateForm" onSubmit={handleEdit}>
          <div className="formTitle"><Edit3 size={20} /><h3>Edit User: {editUser.user_id}</h3></div>
          <div className="formGrid">
            <label><span>Full Name</span>
              <input type="text" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </label>
            <label><span>Privilege</span>
              <select value={form.privilege} onChange={(e) => setForm((p) => ({ ...p, privilege: e.target.value }))}>
                <option value={0}>Normal User</option><option value={1}>Admin</option><option value={2}>Enroller</option>
              </select>
            </label>
            <label><span>Device Password</span>
              <input type="text" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} placeholder="Leave blank to keep current" />
            </label>
            <label><span>Card Number</span>
              <input type="text" value={form.card} onChange={(e) => setForm((p) => ({ ...p, card: e.target.value }))} />
            </label>
            <label><span>Group ID</span>
              <input type="text" value={form.group_id} onChange={(e) => setForm((p) => ({ ...p, group_id: e.target.value }))} placeholder="e.g. default" />
            </label>
          </div>
          <div className="formActions">
            <button type="submit" disabled={submitting}><Save size={15} />{submitting ? 'Saving...' : 'Update User'}</button>
            <button type="button" className="btnSecondary" onClick={() => { setEditUser(null); resetForm(); }}>Cancel</button>
          </div>
        </form>
      )}

      {/* Toolbar */}
      <div className="userToolbar">
        <div className="searchBar">
          <Search size={16} />
          <input type="text" placeholder="Search by name, user ID, or device..." value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && <button type="button" className="searchClear" onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
        <div className="toolbarRight">
          <span className="resultCount">{filtered.length} of {stats.total} users</span>
          <div className="viewToggle">
            <button type="button" className={`viewBtn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')} title="Table view"><List size={16} /></button>
            <button type="button" className={`viewBtn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')} title="Grid view"><Grid3X3 size={16} /></button>
          </div>
        </div>
      </div>

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="card">
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th className="sortable" onClick={() => toggleSort('name')}>User <SortIcon field="name" /></th>
                  <th className="sortable" onClick={() => toggleSort('user_id')}>User ID <SortIcon field="user_id" /></th>
                  <th>Serial #</th>
                  <th>Devices</th>
                  <th>Card</th>
                  <th>Group</th>
                  <th>Password</th>
                  <th>Privilege</th>
                  <th style={{ width: 120 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((user) => (
                  <tr key={user.user_id}>
                    <td>
                      <div className="tableUserCell">
                        <div className="userAvatar small" style={{ background: getAvatarColor(user.user_id) }}>{getInitials(user.name)}</div>
                        <span>{user.name || <em className="muted">Unnamed</em>}</span>
                      </div>
                    </td>
                    <td><span className="mono">{user.user_id}</span></td>
                    <td><span className="mono">{user.uid || '-'}</span></td>
                    <td>
                      <div className="deviceTags">
                        {user.devices.map((d) => (<span key={d} className="deviceTag">{d}</span>))}
                      </div>
                    </td>
                    <td><span className="mono">{user.card && user.card !== '0' ? user.card : '-'}</span></td>
                    <td><span className="mono">{user.group_id || '-'}</span></td>
                    <td><span className="mono">{user.password ? '***' : '-'}</span></td>
                    <td>
                      <span className={`privilegePill ${user.privilege === 1 ? 'admin' : user.privilege === 2 ? 'enroller' : ''}`}>
                        {user.privilege === 1 ? 'Admin' : user.privilege === 2 ? 'Enroller' : 'Normal'}
                      </span>
                    </td>
                    <td>
                      <div className="tableActions">
                        <button type="button" className="btnTiny" style={{ background: '#e0e7ff', color: '#4f46e5' }} onClick={() => openEdit(user)} title="Edit"><Edit3 size={14} /></button>
                        <button type="button" className="btnTiny" style={{ background: '#ddebe4', color: '#176b58' }} onClick={() => handlePush(user)} title="Push to device"><Upload size={14} /></button>
                        <button type="button" className="btnDanger btnTiny" onClick={() => handleDelete(users.find((u) => u.user_id === user.user_id)?.device_id, user.user_id, user.name)} title="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td className="empty" colSpan="9">{search ? 'No users match your search.' : 'No users found.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div className="userGrid">
          {filtered.map((user) => (
            <UserCard key={user.user_id} user={user} onDelete={handleDelete} onEdit={openEdit} onPush={handlePush} allRecords={users} devices={devices} />
          ))}
          {!filtered.length && (
            <div className="emptyState"><UsersIcon size={40} /><p>{search ? 'No users match your search.' : 'No users found.'}</p></div>
          )}
        </div>
      )}
    </div>
  );
}