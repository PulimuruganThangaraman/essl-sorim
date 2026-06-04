import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Clock3, LogIn, LogOut, RefreshCw, Search, X, Timer, ChevronDown, ChevronUp, Users, Mail, Send } from 'lucide-react';
import { request, formatPunchTime } from '../api';

function toInputDate(date) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatHours(h) {
  if (h == null) return '-';
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return `${hrs}h ${mins}m`;
}

export default function AttendancePage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('first-in-last-out');
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return toInputDate(d);
  });
  const [toDate, setToDate] = useState(() => toInputDate(new Date()));
  const [expandedDay, setExpandedDay] = useState(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailMessage, setEmailMessage] = useState('');
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  const [emailDate, setEmailDate] = useState(() => toInputDate(new Date()));

  async function load() {
    setLoading(true);
    try {
      const data = await request(`/api/attendance/daily?from_date=${fromDate}&to_date=${toDate}`);
      setRecords(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function sendEmail(targetDate = emailDate) {
    const reportDate = targetDate || emailDate;
    setEmailSending(true); setEmailMessage('');
    try {
      const result = await request('/api/email/send', { method: 'POST', body: JSON.stringify({ date: reportDate }) });
      if (result.status === 'ok') {
        setEmailDate(reportDate);
        setEmailMessage('Email sent successfully for ' + reportDate + '!');
        setShowEmailDialog(false);
      } else {
        setEmailMessage('Failed: ' + (result.message || 'Unknown error'));
      }
    } catch (err) {
      setEmailMessage('Failed: ' + (err.message || 'Network error'));
    } finally {
      setEmailSending(false);
    }
  }

  useEffect(() => { load(); }, [fromDate, toDate]);

  const groupedByDay = useMemo(() => {
    const map = new Map();
    records.forEach((r) => {
      if (!map.has(r.day)) map.set(r.day, []);
      map.get(r.day).push(r);
    });
    return Array.from(map.entries());
  }, [records]);

  const filtered = useMemo(() => {
    if (!search) return groupedByDay;
    const q = search.toLowerCase();
    return groupedByDay
      .map(([day, rows]) => [day, rows.filter((r) => (r.user_name && r.user_name.toLowerCase().includes(q)) || r.user_id.toLowerCase().includes(q))])
      .filter(([, rows]) => rows.length > 0);
  }, [groupedByDay, search]);

  const totalDays = filtered.length;
  const totalUsers = new Set(records.map((r) => r.user_id)).size;
  const avgWorkHours = useMemo(() => {
    const withHours = records.filter((r) => r.work_hours != null);
    if (!withHours.length) return 0;
    return withHours.reduce((sum, r) => sum + r.work_hours, 0) / withHours.length;
  }, [records]);

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Attendance</h1>
          <p>Daily attendance summary — first in & last out</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button type="button" onClick={() => setShowEmailDialog(true)}>
            <Mail size={15} /> Generate Email
          </button>
        </div>
      </header>

      {emailMessage && (
        <div className={emailMessage.startsWith('Email sent') ? 'notice' : 'notice error'}>
          {emailMessage}
        </div>
      )}

      {showEmailDialog && (
        <div className="pushModal">
          <div className="pushModalContent">
            <h3><Mail size={18} /> Generate Attendance Email</h3>
            <p>Select a date to generate and email the attendance report for that day.</p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', color: '#5b6963' }}>Report Date</span>
              <input type="date" value={emailDate} onChange={(e) => setEmailDate(e.target.value)} />
            </label>
            <div className="formActions" style={{ marginTop: 16 }}>
              <button type="button" onClick={() => sendEmail()} disabled={emailSending}>
                <Send size={15} /> {emailSending ? 'Sending...' : 'Send Email'}
              </button>
              <button type="button" className="btnSecondary" onClick={() => { setShowEmailDialog(false); setEmailMessage(''); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="attTabs">
        <button type="button" className={`attTab ${activeTab === 'first-in-last-out' ? 'active' : ''}`} onClick={() => setActiveTab('first-in-last-out')}>
          <Clock3 size={15} /> First IN & Last OUT
        </button>
        <button type="button" className={`attTab ${activeTab === 'in-only' ? 'active' : ''}`} onClick={() => setActiveTab('in-only')}>
          <Timer size={15} /> IN Only (No OUT)
        </button>
      </div>

      {activeTab === 'in-only' && (
        <div className="comingSoonCard">
          <div className="comingSoonIcon"><Timer size={40} /></div>
          <h3>Coming Soon</h3>
          <p>IN-only attendance mode — calculates attendance based on check-in times only, ignoring all OUT punches. This feature is under development.</p>
        </div>
      )}

      {activeTab === 'first-in-last-out' && (
        <>
          <div className="attFilters">
            <label><span>From Date</span>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </label>
            <label><span>To Date</span>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </label>
            <div className="attSearchBar">
              <Search size={16} />
              <input type="text" placeholder="Search user name or ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          <section className="statsGrid">
            <div className="stat"><div className="statIcon"><CalendarDays size={19} /></div><div><p>Days</p><strong>{totalDays}</strong></div></div>
            <div className="stat"><div className="statIcon"><Users size={19} /></div><div><p>People</p><strong>{totalUsers}</strong></div></div>
            <div className="stat"><div className="statIcon"><Clock3 size={19} /></div><div><p>Avg Hours</p><strong>{formatHours(avgWorkHours)}</strong></div></div>
            <div className="stat"><div className="statIcon"><LogIn size={19} /></div><div><p>Records</p><strong>{records.length}</strong></div></div>
          </section>

          <div className="attDayList">
            {filtered.map(([day, rows]) => {
              const isExpanded = expandedDay === day;
              const presentCount = rows.filter((r) => r.first_in).length;
              return (
                <div key={day} className="attDayGroup">
                  <div className="attDayHeader">
                    <button type="button" className="attDayToggle" onClick={() => setExpandedDay(isExpanded ? null : day)} aria-expanded={isExpanded}>
                      <div className="attDayLeft">
                        <CalendarDays size={16} />
                        <div>
                          <strong>{new Date(day + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</strong>
                          <span className="attDayCount">{presentCount} present &middot; {rows.length} total</span>
                        </div>
                      </div>
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                    <div className="attDayActions">
                      <button type="button" className="btnSmall" onClick={() => sendEmail(day)} disabled={emailSending} title="Email this day">
                        <Mail size={12} /> Email
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="attDayBody">
                      <table>
                        <thead><tr><th>User</th><th>ID</th><th>First IN</th><th>Last OUT</th><th>Work Hours</th><th>Punches</th></tr></thead>
                        <tbody>
                          {rows.map((r) => {
                            const firstIn = r.first_in ? new Date(r.first_in) : null;
                            const lastOut = r.last_out ? new Date(r.last_out) : null;
                            return (
                              <tr key={r.user_id}>
                                <td>{r.user_name || 'Unknown'}</td>
                                <td className="mono">{r.user_id}</td>
                                <td>{firstIn ? firstIn.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                                <td>{lastOut ? lastOut.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                                <td><span className={`attHours ${r.work_hours != null ? (r.work_hours >= 8 ? 'good' : r.work_hours >= 4 ? 'ok' : 'low') : ''}`}>{formatHours(r.work_hours)}</span></td>
                                <td className="mono">{r.total_punches}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
            {!filtered.length && !loading && (
              <div className="emptyState">
                <CalendarDays size={40} />
                <p>No attendance records found for this date range.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
