import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Clock3,
  Download,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
} from 'lucide-react';
import { formatPunchTime, rangeForDays, request } from '../api';

function toDateInput(value) {
  return String(value || '').slice(0, 10);
}

function exceptionRows(attendanceRows) {
  const rows = [];
  attendanceRows.forEach((row) => {
    const base = {
      day: row.day,
      user_id: row.user_id || '-',
      user_name: row.user_name || 'Unknown',
      first_in: row.first_in,
      last_out: row.last_out,
      work_hours: row.work_hours,
      punches: row.total_punches || 0,
    };

    if (!row.first_in) rows.push({ ...base, id: `${row.day}-${row.user_id}-missing-in`, type: 'Missing IN', severity: 'High' });
    if (!row.last_out) rows.push({ ...base, id: `${row.day}-${row.user_id}-missing-out`, type: 'Missing OUT', severity: 'High' });
    if (row.work_hours !== null && row.work_hours !== undefined && row.work_hours < 5) rows.push({ ...base, id: `${row.day}-${row.user_id}-short`, type: 'Short Hours', severity: 'Medium' });
    if (row.work_hours !== null && row.work_hours !== undefined && row.work_hours > 12) rows.push({ ...base, id: `${row.day}-${row.user_id}-long`, type: 'Long Shift', severity: 'Review' });
  });
  return rows;
}

function Stat({ icon: Icon, label, value, tone }) {
  return (
    <section className={`stat ${tone || ''}`}>
      <div className="statIcon"><Icon size={19} /></div>
      <div><p>{label}</p><strong>{value}</strong></div>
    </section>
  );
}

function hoursText(value) {
  if (value === null || value === undefined) return '-';
  return `${Number(value).toFixed(2)}h`;
}

export default function Exceptions() {
  const [filters, setFilters] = useState(() => {
    const range = rangeForDays(1);
    return { from_date: toDateInput(range.from_time), to_date: toDateInput(range.to_time), type: '', search: '' };
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const data = await request(`/api/attendance/daily?from_date=${filters.from_date}&to_date=${filters.to_date}`);
      setRows(data);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [filters.from_date, filters.to_date]);

  const exceptions = useMemo(() => exceptionRows(rows), [rows]);
  const filtered = useMemo(() => {
    const needle = filters.search.trim().toLowerCase();
    return exceptions.filter((item) => {
      const matchesType = !filters.type || item.type === filters.type;
      const matchesSearch = !needle || `${item.user_name} ${item.user_id}`.toLowerCase().includes(needle);
      return matchesType && matchesSearch;
    });
  }, [exceptions, filters.search, filters.type]);

  function exportCsv() {
    const header = ['Date', 'User', 'User ID', 'Type', 'Severity', 'First IN', 'Last OUT', 'Hours', 'Punches'];
    const csv = [
      header.join(','),
      ...filtered.map((item) => [
        item.day,
        `"${String(item.user_name).replace(/"/g, '""')}"`,
        item.user_id,
        item.type,
        item.severity,
        item.first_in || '',
        item.last_out || '',
        item.work_hours ?? '',
        item.punches,
      ].join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance-exceptions-${filters.from_date}-to-${filters.to_date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const missingIn = exceptions.filter((item) => item.type === 'Missing IN').length;
  const missingOut = exceptions.filter((item) => item.type === 'Missing OUT').length;
  const shortHours = exceptions.filter((item) => item.type === 'Short Hours').length;

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Exceptions</h1>
          <p>Review missing punches, short hours, and unusual shifts</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <button type="button" onClick={exportCsv}><Download size={15} /> Export</button>
        </div>
      </header>

      {message && <div className="notice error">{message}</div>}

      <section className="filters exceptionFilters" aria-label="Exception filters">
        <label><span>From Date</span><input type="date" value={filters.from_date} onChange={(event) => setFilters((current) => ({ ...current, from_date: event.target.value }))} /></label>
        <label><span>To Date</span><input type="date" value={filters.to_date} onChange={(event) => setFilters((current) => ({ ...current, to_date: event.target.value }))} /></label>
        <label>
          <span>Type</span>
          <select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}>
            <option value="">All types</option>
            <option value="Missing IN">Missing IN</option>
            <option value="Missing OUT">Missing OUT</option>
            <option value="Short Hours">Short Hours</option>
            <option value="Long Shift">Long Shift</option>
          </select>
        </label>
        <label><span>Search User</span><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Name or ID" /></label>
      </section>

      <section className="statsGrid">
        <Stat icon={AlertCircle} label="Total Exceptions" value={exceptions.length} tone="outTone" />
        <Stat icon={LogIn} label="Missing IN" value={missingIn} />
        <Stat icon={LogOut} label="Missing OUT" value={missingOut} />
        <Stat icon={Clock3} label="Short Hours" value={shortHours} />
      </section>

      <section className="exceptionBoard">
        {filtered.map((item) => (
          <article key={item.id} className="exceptionCard">
            <div className="exceptionTop">
              <span className={`exceptionPill ${item.severity.toLowerCase()}`}>{item.type}</span>
              <span className="exceptionDate"><CalendarDays size={13} /> {item.day}</span>
            </div>
            <div className="exceptionPerson">
              <strong>{item.user_name}</strong>
              <span className="mono">{item.user_id}</span>
            </div>
            <div className="exceptionMeta">
              <span>IN <strong>{item.first_in ? formatPunchTime(item.first_in) : 'Missing'}</strong></span>
              <span>OUT <strong>{item.last_out ? formatPunchTime(item.last_out) : 'Missing'}</strong></span>
              <span>Hours <strong>{hoursText(item.work_hours)}</strong></span>
              <span>Punches <strong>{item.punches}</strong></span>
            </div>
          </article>
        ))}
        {!filtered.length && (
          <div className="emptyState">
            <Search size={28} />
            <p>No exceptions found for this filter.</p>
          </div>
        )}
      </section>
    </div>
  );
}
