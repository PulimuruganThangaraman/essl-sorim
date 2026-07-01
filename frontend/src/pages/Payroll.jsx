import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
  Timer,
  TrendingUp,
  Users,
} from 'lucide-react';
import { rangeForDays, request } from '../api';

function toDateInput(value) {
  return String(value || '').slice(0, 10);
}

function summarizePayroll(rows, expectedHours) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row.user_id || '-';
    const item = map.get(key) || {
      user_id: key,
      user_name: row.user_name || 'Unknown',
      present_days: 0,
      total_hours: 0,
      overtime_hours: 0,
      short_days: 0,
      missing_punches: 0,
      records: 0,
      days: [],
    };

    const hours = Number(row.work_hours || 0);
    const overtime = Math.max(0, hours - expectedHours);
    const missingIn = !row.first_in;
    const missingOut = !row.last_out;
    const shortDay = hours > 0 && hours < 5;

    item.records += 1;
    if (row.first_in || row.last_out) item.present_days += 1;
    item.total_hours += hours;
    item.overtime_hours += overtime;
    if (shortDay) item.short_days += 1;
    if (missingIn) item.missing_punches += 1;
    if (missingOut) item.missing_punches += 1;
    item.days.push({
      day: row.day,
      first_in: row.first_in,
      last_out: row.last_out,
      total_punches: row.total_punches || 0,
      work_hours: hours,
      overtime_hours: overtime,
      present: Boolean(row.first_in || row.last_out),
      missing_in: missingIn,
      missing_out: missingOut,
      short_day: shortDay,
    });
    map.set(key, item);
  });

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      total_hours: Number(item.total_hours.toFixed(2)),
      overtime_hours: Number(item.overtime_hours.toFixed(2)),
      avg_hours: item.present_days ? Number((item.total_hours / item.present_days).toFixed(2)) : 0,
      days: item.days.sort((a, b) => a.day.localeCompare(b.day)),
    }))
    .sort((a, b) => a.user_name.localeCompare(b.user_name));
}

function Stat({ icon: Icon, label, value, tone }) {
  return (
    <section className={`stat ${tone || ''}`}>
      <div className="statIcon"><Icon size={19} /></div>
      <div><p>{label}</p><strong>{value}</strong></div>
    </section>
  );
}

function hours(value) {
  return `${Number(value || 0).toFixed(2)}h`;
}

function clock(value) {
  if (!value) return 'Missing';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function dayStatus(day) {
  if (!day.present) return { label: 'Absent', tone: 'high' };
  if (day.missing_in || day.missing_out) return { label: 'Missing Punch', tone: 'high' };
  if (day.overtime_hours > 0) return { label: 'Overtime', tone: 'medium' };
  if (day.short_day) return { label: 'Short Hours', tone: 'medium' };
  return { label: 'Complete', tone: 'review' };
}

export default function Payroll() {
  const [filters, setFilters] = useState(() => {
    const range = rangeForDays(30);
    return { from_date: toDateInput(range.from_time), to_date: toDateInput(range.to_time), expected_hours: 8 };
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [expandedUser, setExpandedUser] = useState('');

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

  const summary = useMemo(() => summarizePayroll(rows, Number(filters.expected_hours) || 8), [rows, filters.expected_hours]);
  const totals = useMemo(() => summary.reduce(
    (acc, item) => ({
      employees: acc.employees + 1,
      days: acc.days + item.present_days,
      hours: acc.hours + item.total_hours,
      overtime: acc.overtime + item.overtime_hours,
      missing: acc.missing + item.missing_punches,
    }),
    { employees: 0, days: 0, hours: 0, overtime: 0, missing: 0 },
  ), [summary]);

  useEffect(() => {
    setExpandedUser('');
  }, [filters.from_date, filters.to_date, filters.expected_hours]);

  function exportCsv() {
    const header = ['Employee', 'User ID', 'Present Days', 'Total Hours', 'Average Hours', 'Overtime Hours', 'Short Days', 'Missing Punches'];
    const csv = [
      header.join(','),
      ...summary.map((item) => [
        `"${String(item.user_name).replace(/"/g, '""')}"`,
        item.user_id,
        item.present_days,
        item.total_hours,
        item.avg_hours,
        item.overtime_hours,
        item.short_days,
        item.missing_punches,
      ].join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payroll-summary-${filters.from_date}-to-${filters.to_date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Payroll</h1>
          <p>Prepare attendance hours, overtime, and missing-punch checks for payroll</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          <button type="button" onClick={exportCsv}><Download size={15} /> Export Payroll</button>
        </div>
      </header>

      {message && <div className="notice error">{message}</div>}

      <section className="filters payrollFilters" aria-label="Payroll filters">
        <label><span>From Date</span><input type="date" value={filters.from_date} onChange={(event) => setFilters((current) => ({ ...current, from_date: event.target.value }))} /></label>
        <label><span>To Date</span><input type="date" value={filters.to_date} onChange={(event) => setFilters((current) => ({ ...current, to_date: event.target.value }))} /></label>
        <label><span>Expected Hours</span><input type="number" min="1" max="24" value={filters.expected_hours} onChange={(event) => setFilters((current) => ({ ...current, expected_hours: event.target.value }))} /></label>
      </section>

      <section className="statsGrid">
        <Stat icon={Users} label="Employees" value={totals.employees} />
        <Stat icon={CalendarDays} label="Present Days" value={totals.days} />
        <Stat icon={Timer} label="Total Hours" value={hours(totals.hours)} tone="inTone" />
        <Stat icon={TrendingUp} label="Overtime" value={hours(totals.overtime)} />
      </section>

      <section className="card">
        <div className="tableHeader">
          <div>
            <h2>Payroll Attendance Summary</h2>
            <p>{loading ? 'Loading payroll data' : `${summary.length} employees`}</p>
          </div>
          <Banknote size={19} />
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Employee</th>
                <th>User ID</th>
                <th>Present Days</th>
                <th>Total Hours</th>
                <th>Avg Hours</th>
                <th>Overtime</th>
                <th>Short Days</th>
                <th>Missing Punches</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((item) => {
                const isExpanded = expandedUser === item.user_id;
                return (
                  <React.Fragment key={item.user_id}>
                    <tr className={`payrollSummaryRow ${isExpanded ? 'expanded' : ''}`}>
                      <td>
                        <button
                          type="button"
                          className="payrollUserBtn"
                          onClick={() => setExpandedUser(isExpanded ? '' : item.user_id)}
                        >
                          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                          <span>{item.user_name}</span>
                        </button>
                      </td>
                      <td className="mono">{item.user_id}</td>
                      <td className="mono">{item.present_days}</td>
                      <td><span className="attHours good">{hours(item.total_hours)}</span></td>
                      <td><span className="attHours">{hours(item.avg_hours)}</span></td>
                      <td><span className={`attHours ${item.overtime_hours > 0 ? 'ok' : ''}`}>{hours(item.overtime_hours)}</span></td>
                      <td className="mono">{item.short_days}</td>
                      <td><span className={`exceptionPill ${item.missing_punches ? 'high' : 'review'}`}>{item.missing_punches}</span></td>
                    </tr>
                    {isExpanded && (
                      <tr className="payrollDetailRow">
                        <td colSpan="8">
                          <div className="payrollDetailPanel">
                            <div className="payrollFormulaGrid">
                              <div><span>Present Days</span><strong>{item.present_days}</strong><small>Count of days with any IN or OUT punch.</small></div>
                              <div><span>Total Hours</span><strong>{hours(item.total_hours)}</strong><small>Sum of daily Last OUT minus First IN.</small></div>
                              <div><span>Overtime</span><strong>{hours(item.overtime_hours)}</strong><small>Daily hours above {filters.expected_hours || 8}h.</small></div>
                              <div><span>Missing Punches</span><strong>{item.missing_punches}</strong><small>Missing IN plus missing OUT across days.</small></div>
                            </div>

                            <div className="payrollDayList">
                              {item.days.map((day) => {
                                const status = dayStatus(day);
                                return (
                                  <div key={day.day} className="payrollDayRow">
                                    <div className="payrollDayMain">
                                      <strong>{day.day}</strong>
                                      <span className={`exceptionPill ${status.tone}`}>{status.label}</span>
                                    </div>
                                    <div className="payrollDayMetrics">
                                      <span>IN <strong className={day.missing_in ? 'missingText' : ''}>{clock(day.first_in)}</strong></span>
                                      <span>OUT <strong className={day.missing_out ? 'missingText' : ''}>{clock(day.last_out)}</strong></span>
                                      <span>Hours <strong>{hours(day.work_hours)}</strong></span>
                                      <span>OT <strong>{hours(day.overtime_hours)}</strong></span>
                                      <span>Punches <strong>{day.total_punches}</strong></span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {!summary.length && (
                <tr><td className="empty" colSpan="8">No payroll rows for this date range.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
