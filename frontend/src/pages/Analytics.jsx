import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CalendarDays,
  RefreshCw,
  Timer,
  Users,
} from 'lucide-react';
import { rangeForDays, request } from '../api';

function toDateInput(value) {
  return String(value || '').slice(0, 10);
}

function buildDailyTrend(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const item = map.get(row.day) || { day: row.day, people: new Set(), hours: 0, exceptions: 0, rows: 0 };
    item.people.add(row.user_id);
    item.hours += Number(row.work_hours || 0);
    item.rows += 1;
    if (!row.first_in || !row.last_out || (row.work_hours !== null && row.work_hours !== undefined && row.work_hours < 5)) {
      item.exceptions += 1;
    }
    map.set(row.day, item);
  });
  return Array.from(map.values())
    .map((item) => ({ ...item, people: item.people.size, hours: Number(item.hours.toFixed(2)) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

function Stat({ icon: Icon, label, value, tone }) {
  return (
    <section className={`stat ${tone || ''}`}>
      <div className="statIcon"><Icon size={19} /></div>
      <div><p>{label}</p><strong>{value}</strong></div>
    </section>
  );
}

function pct(value, max) {
  if (!max) return 0;
  return Math.max(4, Math.round((value / max) * 100));
}

export default function Analytics() {
  const [filters, setFilters] = useState(() => {
    const range = rangeForDays(14);
    return { from_date: toDateInput(range.from_time), to_date: toDateInput(range.to_time) };
  });
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ total_punches: 0, total_people: 0, in_count: 0, out_count: 0, by_device: [] });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const query = new URLSearchParams({
        from_time: `${filters.from_date}T00:00`,
        to_time: `${filters.to_date}T23:59`,
      }).toString();
      const [attendanceData, summaryData] = await Promise.all([
        request(`/api/attendance/daily?from_date=${filters.from_date}&to_date=${filters.to_date}`),
        request(`/api/summary?${query}`),
      ]);
      setRows(attendanceData);
      setSummary(summaryData);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [filters.from_date, filters.to_date]);

  const trend = useMemo(() => buildDailyTrend(rows), [rows]);
  const maxPeople = Math.max(...trend.map((item) => item.people), 0);
  const maxHours = Math.max(...trend.map((item) => item.hours), 0);
  const totalHours = trend.reduce((sum, item) => sum + item.hours, 0);
  const totalExceptions = trend.reduce((sum, item) => sum + item.exceptions, 0);
  const avgPeople = trend.length ? Math.round(trend.reduce((sum, item) => sum + item.people, 0) / trend.length) : 0;

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Analytics</h1>
          <p>Management view of attendance trends, workload, and device contribution</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>
        </div>
      </header>

      {message && <div className="notice error">{message}</div>}

      <section className="filters analyticsFilters" aria-label="Analytics filters">
        <label><span>From Date</span><input type="date" value={filters.from_date} onChange={(event) => setFilters((current) => ({ ...current, from_date: event.target.value }))} /></label>
        <label><span>To Date</span><input type="date" value={filters.to_date} onChange={(event) => setFilters((current) => ({ ...current, to_date: event.target.value }))} /></label>
      </section>

      <section className="statsGrid">
        <Stat icon={Users} label="Avg People/Day" value={avgPeople} />
        <Stat icon={Timer} label="Total Hours" value={`${totalHours.toFixed(1)}h`} tone="inTone" />
        <Stat icon={AlertCircle} label="Exceptions" value={totalExceptions} tone="outTone" />
        <Stat icon={Activity} label="Punches" value={summary.total_punches} />
      </section>

      <section className="analyticsGrid">
        <div className="card">
          <div className="cardHeader">
            <BarChart3 size={18} />
            <h2>Daily Attendance Trend</h2>
          </div>
          <div className="trendList">
            {trend.map((item) => (
              <div key={item.day} className="trendRow">
                <span className="trendDay">{item.day}</span>
                <div className="trendBars">
                  <div className="trendBar people" style={{ width: `${pct(item.people, maxPeople)}%` }}><span>{item.people} people</span></div>
                  <div className="trendBar hours" style={{ width: `${pct(item.hours, maxHours)}%` }}><span>{item.hours}h</span></div>
                </div>
                <span className={`trendException ${item.exceptions ? 'warn' : ''}`}>{item.exceptions}</span>
              </div>
            ))}
            {!trend.length && <p className="emptyText">No trend data for this range.</p>}
          </div>
        </div>

        <div className="card">
          <div className="cardHeader">
            <CalendarDays size={18} />
            <h2>Device Contribution</h2>
          </div>
          <div className="deviceAnalyticsList">
            {summary.by_device.map((item) => (
              <div key={item.device_ip} className="deviceAnalyticsRow">
                <div>
                  <strong>{item.device_name}</strong>
                  <small>{item.device_ip}</small>
                </div>
                <span>{item.punches}</span>
              </div>
            ))}
            {!summary.by_device.length && <p className="emptyText">No device data for this range.</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
