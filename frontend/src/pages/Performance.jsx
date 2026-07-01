import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Plus, RefreshCw, Target, Trash2 } from 'lucide-react';
import { request } from '../api';

const EMPTY_FORM = {
  user_id: '',
  cycle: '',
  reviewer: '',
  rating: 'Meets Expectations',
  status: 'Draft',
  goals: '',
  achievements: '',
  improvement: '',
  next_review_date: '',
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

export default function Performance() {
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
      const [userData, reviewData] = await Promise.all([request('/api/users'), request('/api/hr/performance')]);
      const list = uniqueUsers(userData);
      setUsers(list);
      setRecords(reviewData);
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
    acc.draft += item.status === 'Draft' ? 1 : 0;
    acc.reviewed += item.status === 'Reviewed' ? 1 : 0;
    acc.closed += item.status === 'Closed' ? 1 : 0;
    return acc;
  }, { total: 0, draft: 0, reviewed: 0, closed: 0 }), [records]);

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await request('/api/hr/performance', { method: 'POST', body: JSON.stringify(form) });
      setForm((current) => ({ ...EMPTY_FORM, user_id: current.user_id }));
      setMessage('Performance review saved.');
      await load();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(record, status) {
    await request(`/api/hr/performance/${record.id}`, { method: 'PUT', body: JSON.stringify({ status }) });
    await load();
  }

  async function remove(record) {
    if (!window.confirm('Delete this performance record?')) return;
    await request(`/api/hr/performance/${record.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Performance</h1>
          <p>Capture review cycles, goals, achievements, and next review actions</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>
        </div>
      </header>

      {message && <div className="notice success">{message}</div>}

      <section className="hrMiniStats">
        <Stat label="Reviews" value={stats.total} />
        <Stat label="Draft" value={stats.draft} tone="warn" />
        <Stat label="Reviewed" value={stats.reviewed} tone="good" />
        <Stat label="Closed" value={stats.closed} />
      </section>

      <form className="card hrCreateForm" onSubmit={submit}>
        <div className="cardHeader"><Target size={18} /><h2>Add Review</h2></div>
        <div className="formGrid">
          <label><span>Employee</span><select value={form.user_id} onChange={(event) => updateForm('user_id', event.target.value)} required>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.name || user.user_id}</option>)}</select></label>
          <label><span>Cycle</span><input value={form.cycle} onChange={(event) => updateForm('cycle', event.target.value)} placeholder="Q2 2026" /></label>
          <label><span>Reviewer</span><input value={form.reviewer} onChange={(event) => updateForm('reviewer', event.target.value)} /></label>
          <label><span>Rating</span><select value={form.rating} onChange={(event) => updateForm('rating', event.target.value)}><option>Exceeds Expectations</option><option>Meets Expectations</option><option>Needs Improvement</option><option>Critical Attention</option></select></label>
          <label><span>Status</span><select value={form.status} onChange={(event) => updateForm('status', event.target.value)}><option>Draft</option><option>Reviewed</option><option>Closed</option></select></label>
          <label><span>Next Review Date</span><input type="date" value={form.next_review_date} onChange={(event) => updateForm('next_review_date', event.target.value)} /></label>
        </div>
        <div className="hrTextAreaGrid">
          <label><span>Goals</span><textarea value={form.goals} onChange={(event) => updateForm('goals', event.target.value)} /></label>
          <label><span>Achievements</span><textarea value={form.achievements} onChange={(event) => updateForm('achievements', event.target.value)} /></label>
          <label><span>Improvement Plan</span><textarea value={form.improvement} onChange={(event) => updateForm('improvement', event.target.value)} /></label>
        </div>
        <div className="formActions"><button type="submit" disabled={submitting}><Plus size={15} /> {submitting ? 'Saving...' : 'Save Review'}</button></div>
      </form>

      <section className="hrRecordGrid">
        {records.map((record) => (
          <article key={record.id} className="hrRecordCard performanceCard">
            <div className="hrRecordTop">
              <span className={`hrStatus ${String(record.status || '').toLowerCase()}`}>{record.status}</span>
              <strong>{record.cycle || 'Review'}</strong>
            </div>
            <h3>{userMap[record.user_id] || record.user_id}</h3>
            <p>{record.rating}</p>
            <div className="hrRecordMeta">
              <span>Reviewer: {record.reviewer || '-'}</span>
              <span>Next review: {record.next_review_date || '-'}</span>
              <span>Goals: {record.goals || '-'}</span>
              <span>Achievements: {record.achievements || '-'}</span>
              <span>Improvement: {record.improvement || '-'}</span>
            </div>
            <div className="hrRecordActions">
              <button type="button" className="btnSmall" onClick={() => updateStatus(record, 'Reviewed')}><CheckCircle size={13} /> Reviewed</button>
              <button type="button" className="btnSecondary btnSmall" onClick={() => updateStatus(record, 'Closed')}>Close</button>
              <button type="button" className="btnDanger btnSmall" onClick={() => remove(record)}><Trash2 size={13} /> Delete</button>
            </div>
          </article>
        ))}
        {!records.length && <p className="emptyText">No performance records yet.</p>}
      </section>
    </div>
  );
}
