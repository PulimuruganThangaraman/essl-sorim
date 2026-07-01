import React, { useEffect, useMemo, useState } from 'react';
import { Laptop, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { request } from '../api';

const EMPTY_FORM = {
  user_id: '',
  asset_tag: '',
  category: 'Laptop',
  model: '',
  serial_number: '',
  assigned_date: '',
  return_date: '',
  status: 'Assigned',
  condition: 'Good',
  notes: '',
};

function uniqueUsers(records) {
  const map = new Map();
  records.forEach((record) => {
    if (!map.has(record.user_id)) map.set(record.user_id, record);
  });
  return Array.from(map.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function Stat({ label, value, tone }) {
  return (
    <section className={`hrMiniStat ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </section>
  );
}

export default function Assets() {
  const [users, setUsers] = useState([]);
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const [userData, assetData] = await Promise.all([request('/api/users'), request('/api/hr/assets')]);
      const list = uniqueUsers(userData);
      setUsers(list);
      setRecords(assetData);
      setForm((current) => ({ ...current, user_id: current.user_id || list[0]?.user_id || '' }));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const userMap = useMemo(
    () => Object.fromEntries(users.map((user) => [user.user_id, user.name || user.user_id])),
    [users],
  );

  const stats = useMemo(() => records.reduce((acc, item) => {
    acc.total += 1;
    acc.assigned += item.status === 'Assigned' ? 1 : 0;
    acc.available += item.status === 'Available' ? 1 : 0;
    acc.repair += item.status === 'Repair' ? 1 : 0;
    return acc;
  }, { total: 0, assigned: 0, available: 0, repair: 0 }), [records]);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await request('/api/hr/assets', { method: 'POST', body: JSON.stringify(form) });
      setForm((current) => ({ ...EMPTY_FORM, user_id: current.user_id }));
      setMessage('Asset record saved.');
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(record, status) {
    await request(`/api/hr/assets/${record.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    await load();
  }

  async function remove(record) {
    if (!window.confirm('Delete this asset record?')) return;
    await request(`/api/hr/assets/${record.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Assets</h1>
          <p>Assign laptops, access cards, phones, and other company property to employees</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>
        </div>
      </header>

      {message && <div className="notice success">{message}</div>}

      <section className="hrMiniStats">
        <Stat label="Total Assets" value={stats.total} />
        <Stat label="Assigned" value={stats.assigned} tone="good" />
        <Stat label="Available" value={stats.available} />
        <Stat label="Repair" value={stats.repair} tone="warn" />
      </section>

      <form className="card hrCreateForm" onSubmit={submit}>
        <div className="cardHeader"><Laptop size={18} /><h2>Register Asset</h2></div>
        <div className="formGrid">
          <label><span>Employee</span><select value={form.user_id} onChange={(event) => updateForm('user_id', event.target.value)} required>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.name || user.user_id}</option>)}</select></label>
          <label><span>Asset Tag</span><input value={form.asset_tag} onChange={(event) => updateForm('asset_tag', event.target.value)} required /></label>
          <label><span>Category</span><select value={form.category} onChange={(event) => updateForm('category', event.target.value)}><option>Laptop</option><option>Desktop</option><option>Mobile</option><option>Access Card</option><option>SIM</option><option>Other</option></select></label>
          <label><span>Model</span><input value={form.model} onChange={(event) => updateForm('model', event.target.value)} /></label>
          <label><span>Serial Number</span><input value={form.serial_number} onChange={(event) => updateForm('serial_number', event.target.value)} /></label>
          <label><span>Assigned Date</span><input type="date" value={form.assigned_date} onChange={(event) => updateForm('assigned_date', event.target.value)} /></label>
          <label><span>Return Date</span><input type="date" value={form.return_date} onChange={(event) => updateForm('return_date', event.target.value)} /></label>
          <label><span>Status</span><select value={form.status} onChange={(event) => updateForm('status', event.target.value)}><option>Assigned</option><option>Available</option><option>Returned</option><option>Repair</option></select></label>
          <label><span>Condition</span><select value={form.condition} onChange={(event) => updateForm('condition', event.target.value)}><option>New</option><option>Good</option><option>Needs Review</option><option>Damaged</option></select></label>
        </div>
        <label className="wideField"><span>Notes</span><textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} /></label>
        <div className="formActions"><button type="submit" disabled={submitting}><Plus size={15} /> {submitting ? 'Saving...' : 'Save Asset'}</button></div>
      </form>

      <section className="hrRecordGrid">
        {records.map((record) => (
          <article key={record.id} className="hrRecordCard">
            <div className="hrRecordTop">
              <span className={`hrStatus ${String(record.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{record.status}</span>
              <strong>{record.asset_tag || 'No tag'}</strong>
            </div>
            <h3>{record.category} {record.model}</h3>
            <p>{userMap[record.user_id] || record.user_id}</p>
            <div className="hrRecordMeta">
              <span>Serial: {record.serial_number || '-'}</span>
              <span>Assigned: {record.assigned_date || '-'}</span>
              <span>Return: {record.return_date || '-'}</span>
              <span>Condition: {record.condition || '-'}</span>
              <span>{record.notes || 'No notes added'}</span>
            </div>
            <div className="hrRecordActions">
              <button type="button" className="btnSmall" onClick={() => updateStatus(record, 'Assigned')}><Laptop size={13} /> Assigned</button>
              <button type="button" className="btnSecondary btnSmall" onClick={() => updateStatus(record, 'Returned')}><RotateCcw size={13} /> Returned</button>
              <button type="button" className="btnDanger btnSmall" onClick={() => remove(record)}><Trash2 size={13} /> Delete</button>
            </div>
          </article>
        ))}
        {!records.length && <p className="emptyText">No assets registered yet.</p>}
      </section>
    </div>
  );
}
