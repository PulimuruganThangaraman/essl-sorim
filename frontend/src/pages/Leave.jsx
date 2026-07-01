import React, { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CheckCircle, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { request } from '../api';

const EMPTY_FORM = { user_id: '', leave_type: 'Casual Leave', from_date: '', to_date: '', status: 'Pending', reason: '' };

function uniqueUsers(records) {
  const map = new Map();
  records.forEach((record) => {
    if (!map.has(record.user_id)) map.set(record.user_id, record);
  });
  return Array.from(map.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function daysBetween(from, to) {
  if (!from || !to) return 0;
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function Stat({ label, value, tone }) {
  return <section className={`hrMiniStat ${tone || ''}`}><span>{label}</span><strong>{value}</strong></section>;
}

export default function Leave() {
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
      const [userData, leaveData] = await Promise.all([request('/api/users'), request('/api/hr/leave_requests')]);
      const list = uniqueUsers(userData);
      setUsers(list);
      setRecords(leaveData);
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

  const userMap = useMemo(() => Object.fromEntries(users.map((user) => [user.user_id, user.name || user.user_id])), [users]);
  const stats = useMemo(() => records.reduce((acc, item) => {
    acc.total += daysBetween(item.from_date, item.to_date);
    acc.pending += item.status === 'Pending' ? 1 : 0;
    acc.approved += item.status === 'Approved' ? 1 : 0;
    acc.rejected += item.status === 'Rejected' ? 1 : 0;
    return acc;
  }, { total: 0, pending: 0, approved: 0, rejected: 0 }), [records]);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await request('/api/hr/leave_requests', { method: 'POST', body: JSON.stringify(form) });
      setForm((current) => ({ ...EMPTY_FORM, user_id: current.user_id }));
      setMessage('Leave request saved.');
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(record, status) {
    await request(`/api/hr/leave_requests/${record.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    await load();
  }

  async function remove(record) {
    if (!window.confirm('Delete this leave record?')) return;
    await request(`/api/hr/leave_requests/${record.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div><h1>Leave</h1><p>Track leave requests, approvals, and leave days by employee</p></div>
        <div className="headerActions"><button type="button" className="btnSecondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
      </header>

      {message && <div className="notice success">{message}</div>}

      <section className="hrMiniStats">
        <Stat label="Leave Days" value={stats.total} />
        <Stat label="Pending" value={stats.pending} tone="warn" />
        <Stat label="Approved" value={stats.approved} tone="good" />
        <Stat label="Rejected" value={stats.rejected} tone="danger" />
      </section>

      <form className="card hrCreateForm" onSubmit={submit}>
        <div className="cardHeader"><CalendarCheck size={18} /><h2>Create Leave Request</h2></div>
        <div className="formGrid">
          <label><span>Employee</span><select value={form.user_id} onChange={(event) => updateForm('user_id', event.target.value)} required>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.name || user.user_id}</option>)}</select></label>
          <label><span>Leave Type</span><select value={form.leave_type} onChange={(event) => updateForm('leave_type', event.target.value)}><option>Casual Leave</option><option>Sick Leave</option><option>Earned Leave</option><option>Unpaid Leave</option><option>Comp Off</option></select></label>
          <label><span>From Date</span><input type="date" value={form.from_date} onChange={(event) => updateForm('from_date', event.target.value)} required /></label>
          <label><span>To Date</span><input type="date" value={form.to_date} onChange={(event) => updateForm('to_date', event.target.value)} required /></label>
          <label><span>Status</span><select value={form.status} onChange={(event) => updateForm('status', event.target.value)}><option>Pending</option><option>Approved</option><option>Rejected</option></select></label>
        </div>
        <label className="wideField"><span>Reason</span><textarea value={form.reason} onChange={(event) => updateForm('reason', event.target.value)} /></label>
        <div className="formActions"><button type="submit" disabled={submitting}><Plus size={15} /> {submitting ? 'Saving...' : 'Save Leave'}</button></div>
      </form>

      <section className="hrRecordGrid">
        {records.map((record) => (
          <article key={record.id} className="hrRecordCard">
            <div className="hrRecordTop">
              <span className={`hrStatus ${record.status.toLowerCase()}`}>{record.status}</span>
              <strong>{daysBetween(record.from_date, record.to_date)} day(s)</strong>
            </div>
            <h3>{userMap[record.user_id] || record.user_id}</h3>
            <p>{record.leave_type}</p>
            <div className="hrRecordMeta">
              <span>{record.from_date} to {record.to_date}</span>
              <span>{record.reason || 'No reason added'}</span>
            </div>
            <div className="hrRecordActions">
              <button type="button" className="btnSmall" onClick={() => updateStatus(record, 'Approved')}><CheckCircle size={13} /> Approve</button>
              <button type="button" className="btnSecondary btnSmall" onClick={() => updateStatus(record, 'Rejected')}><XCircle size={13} /> Reject</button>
              <button type="button" className="btnDanger btnSmall" onClick={() => remove(record)}><Trash2 size={13} /> Delete</button>
            </div>
          </article>
        ))}
        {!records.length && <p className="emptyText">No leave requests yet.</p>}
      </section>
    </div>
  );
}
