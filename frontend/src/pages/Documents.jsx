import React, { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, FileText, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { request } from '../api';

const EMPTY_FORM = {
  user_id: '',
  document_type: 'ID Proof',
  document_number: '',
  status: 'Pending',
  expiry_date: '',
  verified_by: '',
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

export default function Documents() {
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
      const [userData, docData] = await Promise.all([request('/api/users'), request('/api/hr/documents')]);
      const list = uniqueUsers(userData);
      setUsers(list);
      setRecords(docData);
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
    acc.pending += item.status === 'Pending' ? 1 : 0;
    acc.verified += item.status === 'Verified' ? 1 : 0;
    acc.expired += item.status === 'Expired' ? 1 : 0;
    return acc;
  }, { total: 0, pending: 0, verified: 0, expired: 0 }), [records]);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await request('/api/hr/documents', { method: 'POST', body: JSON.stringify(form) });
      setForm((current) => ({ ...EMPTY_FORM, user_id: current.user_id }));
      setMessage('Document record saved.');
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(record, status) {
    await request(`/api/hr/documents/${record.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    await load();
  }

  async function remove(record) {
    if (!window.confirm('Delete this document record?')) return;
    await request(`/api/hr/documents/${record.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Documents</h1>
          <p>Maintain employee KYC, offer, policy, and compliance document status</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>
        </div>
      </header>

      {message && <div className="notice success">{message}</div>}

      <section className="hrMiniStats">
        <Stat label="Documents" value={stats.total} />
        <Stat label="Pending" value={stats.pending} tone="warn" />
        <Stat label="Verified" value={stats.verified} tone="good" />
        <Stat label="Expired" value={stats.expired} tone="danger" />
      </section>

      <form className="card hrCreateForm" onSubmit={submit}>
        <div className="cardHeader"><FileText size={18} /><h2>Add Document</h2></div>
        <div className="formGrid">
          <label><span>Employee</span><select value={form.user_id} onChange={(event) => updateForm('user_id', event.target.value)} required>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.name || user.user_id}</option>)}</select></label>
          <label><span>Document Type</span><select value={form.document_type} onChange={(event) => updateForm('document_type', event.target.value)}><option>ID Proof</option><option>Address Proof</option><option>Offer Letter</option><option>NDA</option><option>Experience Letter</option><option>PAN</option><option>Bank Proof</option><option>Policy Acknowledgement</option></select></label>
          <label><span>Document Number</span><input value={form.document_number} onChange={(event) => updateForm('document_number', event.target.value)} /></label>
          <label><span>Status</span><select value={form.status} onChange={(event) => updateForm('status', event.target.value)}><option>Pending</option><option>Submitted</option><option>Verified</option><option>Expired</option><option>Rejected</option></select></label>
          <label><span>Expiry Date</span><input type="date" value={form.expiry_date} onChange={(event) => updateForm('expiry_date', event.target.value)} /></label>
          <label><span>Verified By</span><input value={form.verified_by} onChange={(event) => updateForm('verified_by', event.target.value)} /></label>
        </div>
        <label className="wideField"><span>Notes</span><textarea value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} /></label>
        <div className="formActions"><button type="submit" disabled={submitting}><Plus size={15} /> {submitting ? 'Saving...' : 'Save Document'}</button></div>
      </form>

      <section className="hrRecordGrid">
        {records.map((record) => (
          <article key={record.id} className="hrRecordCard">
            <div className="hrRecordTop">
              <span className={`hrStatus ${String(record.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{record.status}</span>
              <strong>{record.document_type}</strong>
            </div>
            <h3>{userMap[record.user_id] || record.user_id}</h3>
            <p>{record.document_number || 'No document number'}</p>
            <div className="hrRecordMeta">
              <span>Expiry: {record.expiry_date || '-'}</span>
              <span>Verified by: {record.verified_by || '-'}</span>
              <span>{record.notes || 'No notes added'}</span>
            </div>
            <div className="hrRecordActions">
              <button type="button" className="btnSmall" onClick={() => updateStatus(record, 'Verified')}><BadgeCheck size={13} /> Verify</button>
              <button type="button" className="btnSecondary btnSmall" onClick={() => updateStatus(record, 'Rejected')}><XCircle size={13} /> Reject</button>
              <button type="button" className="btnDanger btnSmall" onClick={() => remove(record)}><Trash2 size={13} /> Delete</button>
            </div>
          </article>
        ))}
        {!records.length && <p className="emptyText">No document records yet.</p>}
      </section>
    </div>
  );
}
