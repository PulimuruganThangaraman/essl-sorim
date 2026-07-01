import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, Clock3, Download, FileText, Filter, RefreshCw,
  Search, Users, ChevronDown, ChevronUp, LogIn, LogOut, Timer,
  Mail, Send, User, BarChart3, Printer,
} from 'lucide-react';
import { request, API_BASE } from '../api';

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

function formatTime(t) {
  if (!t) return '-';
  try {
    return new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return t;
  }
}

function formatDate(d) {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return d;
  }
}

export default function Reports() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return toInputDate(d);
  });
  const [toDate, setToDate] = useState(() => toInputDate(new Date()));
  const [expandedUser, setExpandedUser] = useState(null);
  const [expandedDay, setExpandedDay] = useState(null);
  const [reportType, setReportType] = useState('summary');
  const [selectedUser, setSelectedUser] = useState('');
  const [allUsers, setAllUsers] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);

  async function load() {
    setLoading(true);
    try {
      let url = `/api/report/detailed?from_date=${fromDate}&to_date=${toDate}`;
      // Apply person filter for by-user and by-day views
      if (selectedUser && (reportType === 'per-person' || reportType === 'summary' || reportType === 'by-user' || reportType === 'by-day')) {
        url += `&user_id=${encodeURIComponent(selectedUser)}`;
      } else if (reportType === 'multi-person' && selectedUsers.length > 0) {
        url += `&user_ids=${selectedUsers.map(u => encodeURIComponent(u)).join(',')}`;
      }
      const data = await request(url);
      setRecords(data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }

  async function loadUsers() {
    try {
      const data = await request('/api/users');
      const unique = new Map();
      data.forEach(u => {
        if (!unique.has(u.user_id)) {
          unique.set(u.user_id, { user_id: u.user_id, name: u.name || u.user_id });
        }
      });
      setAllUsers(Array.from(unique.values()).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    } catch (err) { console.error(err); }
  }

  useEffect(() => { load(); }, [fromDate, toDate, reportType, selectedUser, selectedUsers]);
  useEffect(() => { loadUsers(); }, []);

  const groupedByDay = useMemo(() => {
    const map = new Map();
    records.forEach((r) => {
      if (!map.has(r.day)) map.set(r.day, []);
      map.get(r.day).push(r);
    });
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [records]);

  const groupedByUser = useMemo(() => {
    const map = new Map();
    records.forEach((r) => {
      const key = r.user_id;
      if (!map.has(key)) map.set(key, { user_id: r.user_id, user_name: r.user_name || r.user_id, days: [], total_days: 0, total_hours: 0, total_punches: 0 });
      const entry = map.get(key);
      entry.days.push(r);
      entry.total_days += 1;
      if (r.work_hours) entry.total_hours += r.work_hours;
      entry.total_punches += r.total_punches || 0;
    });
    return Array.from(map.values()).sort((a, b) => (a.user_name || '').localeCompare(b.user_name || ''));
  }, [records]);

  const filteredByDay = useMemo(() => {
    if (!search) return groupedByDay;
    const q = search.toLowerCase();
    return groupedByDay
      .map(([day, rows]) => [day, rows.filter((r) => (r.user_name && r.user_name.toLowerCase().includes(q)) || r.user_id.toLowerCase().includes(q))])
      .filter(([, rows]) => rows.length > 0);
  }, [groupedByDay, search]);

  const filteredByUser = useMemo(() => {
    if (!search) return groupedByUser;
    const q = search.toLowerCase();
    return groupedByUser.filter((u) => (u.user_name && u.user_name.toLowerCase().includes(q)) || u.user_id.toLowerCase().includes(q));
  }, [groupedByUser, search]);

  const totalUsers = groupedByUser.length;
  const totalDays = groupedByDay.length;
  const totalPunches = records.reduce((s, r) => s + (r.total_punches || 0), 0);
  const avgWorkHours = useMemo(() => {
    const withHours = records.filter((r) => r.work_hours != null);
    if (!withHours.length) return 0;
    return withHours.reduce((sum, r) => sum + r.work_hours, 0) / withHours.length;
  }, [records]);

  async function downloadCSV() {
    // Use a hidden form + POST to avoid React Router intercepting GET /api/* URLs
    const base = API_BASE ? API_BASE.replace(/\/$/, '') : window.location.origin;
    const url = `${base}/api/report/detailed`;
    const form = document.createElement('form');
    form.method = 'GET';
    form.action = url;
    form.target = '_blank';
    const fromInput = document.createElement('input');
    fromInput.type = 'hidden'; fromInput.name = 'from_date'; fromInput.value = fromDate;
    const toInput = document.createElement('input');
    toInput.type = 'hidden'; toInput.name = 'to_date'; toInput.value = toDate;
    const csvInput = document.createElement('input');
    csvInput.type = 'hidden'; csvInput.name = 'csv'; csvInput.value = 'true';
    form.appendChild(fromInput); form.appendChild(toInput); form.appendChild(csvInput);
    if (reportType === 'per-person' && selectedUser) {
      const u = document.createElement('input'); u.type = 'hidden'; u.name = 'user_id'; u.value = selectedUser; form.appendChild(u);
    } else if (reportType === 'multi-person' && selectedUsers.length > 0) {
      const u = document.createElement('input'); u.type = 'hidden'; u.name = 'user_ids'; u.value = selectedUsers.join(','); form.appendChild(u);
    }
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  function toggleUserSelection(userId) {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  }

  function selectAllUsers() {
    if (selectedUsers.length === allUsers.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(allUsers.map(u => u.user_id));
    }
  }

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Reports</h1>
          <p>Comprehensive attendance reports — per person, per day, or full summary</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button type="button" onClick={downloadCSV}>
            <Download size={15} /> Download CSV
          </button>
        </div>
      </header>

      {/* Report Type Tabs */}
      <div className="attTabs" style={{ flexWrap: 'wrap' }}>
        <button type="button" className={`attTab ${reportType === 'summary' ? 'active' : ''}`} onClick={() => setReportType('summary')}>
          <BarChart3 size={15} /> Summary
        </button>
        <button type="button" className={`attTab ${reportType === 'by-day' ? 'active' : ''}`} onClick={() => setReportType('by-day')}>
          <CalendarDays size={15} /> By Day
        </button>
        <button type="button" className={`attTab ${reportType === 'by-user' ? 'active' : ''}`} onClick={() => setReportType('by-user')}>
          <Users size={15} /> By Person
        </button>
        <button type="button" className={`attTab ${reportType === 'per-person' ? 'active' : ''}`} onClick={() => setReportType('per-person')}>
          <User size={15} /> Single Person
        </button>
        <button type="button" className={`attTab ${reportType === 'multi-person' ? 'active' : ''}`} onClick={() => setReportType('multi-person')}>
          <Users size={15} /> Multiple Persons
        </button>
      </div>

      {/* Filters */}
      <div className="attFilters">
        <label><span>From Date</span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label><span>To Date</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        {(reportType === 'per-person' || reportType === 'summary' || reportType === 'by-user' || reportType === 'by-day') && (
          <label><span>Person</span>
            <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}>
              <option value="">All Persons</option>
              {allUsers.map(u => (
                <option key={u.user_id} value={u.user_id}>{u.name} ({u.user_id})</option>
              ))}
            </select>
          </label>
        )}
        <div className="attSearchBar">
          <Search size={16} />
          <input type="text" placeholder="Search name or ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Multi-person user selector */}
      {reportType === 'multi-person' && (
        <div className="multiPersonSelector" style={{ background: '#fff', border: '1px solid #d8dfdb', borderRadius: 8, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <strong style={{ color: '#1a2e27', fontSize: 14 }}>Select Persons</strong>
            <button type="button" className="btnTiny btnSecondary" onClick={selectAllUsers}>
              {selectedUsers.length === allUsers.length ? 'Deselect All' : 'Select All'}
            </button>
            <span style={{ color: '#6b8a7e', fontSize: 12 }}>{selectedUsers.length} selected</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxHeight: 120, overflow: 'auto' }}>
            {allUsers.map(u => (
              <button
                key={u.user_id}
                type="button"
                className={`btnSmall ${selectedUsers.includes(u.user_id) ? '' : 'btnSecondary'}`}
                onClick={() => toggleUserSelection(u.user_id)}
                style={selectedUsers.includes(u.user_id) ? {} : { background: '#f0f3f1', color: '#3d5249' }}
              >
                {u.name} ({u.user_id})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* SUMMARY VIEW */}
      {reportType === 'summary' && (
        <>
          <section className="statsGrid">
            <div className="stat"><div className="statIcon"><CalendarDays size={19} /></div><div><p>Days</p><strong>{totalDays}</strong></div></div>
            <div className="stat"><div className="statIcon"><Users size={19} /></div><div><p>People</p><strong>{totalUsers}</strong></div></div>
            <div className="stat"><div className="statIcon"><Timer size={19} /></div><div><p>Avg Hours</p><strong>{formatHours(avgWorkHours)}</strong></div></div>
            <div className="stat"><div className="statIcon"><LogIn size={19} /></div><div><p>Total Punches</p><strong>{totalPunches}</strong></div></div>
          </section>

          {/* Per-person summary cards */}
          <div className="userPunchGrid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {filteredByUser.map((user) => (
              <div key={user.user_id} className="recentPunchCard" style={{ minHeight: 160 }}>
                <div className="recentPunchTop">
                  <strong>{user.user_name || user.user_id}</strong>
                </div>
                <div className="recentPunchMeta" style={{ flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span><strong>{user.total_days}</strong> days</span>
                    <span><strong>{user.total_punches}</strong> punches</span>
                    <span><strong>{formatHours(user.total_hours)}</strong> total</span>
                  </div>
                  <div style={{ color: '#176b58', fontSize: 12 }}>
                    Avg: {formatHours(user.total_days > 0 ? user.total_hours / user.total_days : 0)} / day
                  </div>
                </div>
              </div>
            ))}
            {!filteredByUser.length && !loading && (
              <div className="emptyState" style={{ gridColumn: '1 / -1' }}>
                <CalendarDays size={40} />
                <p>No records found for this period.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* BY DAY VIEW */}
      {reportType === 'by-day' && (
        <div className="attDayList">
          {filteredByDay.map(([day, rows]) => {
            const isExpanded = expandedDay === day;
            const presentCount = rows.filter((r) => r.first_in).length;
            return (
              <div key={day} className="attDayGroup">
                <div className="attDayHeader">
                  <button type="button" className="attDayToggle" onClick={() => setExpandedDay(isExpanded ? null : day)}>
                    <div className="attDayLeft">
                      <CalendarDays size={16} />
                      <div>
                        <strong>{formatDate(day)}</strong>
                        <span className="attDayCount">{presentCount} present &middot; {rows.length} total &middot; {rows.reduce((s, r) => s + (r.total_punches || 0), 0)} punches</span>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                </div>
                {isExpanded && (
                  <div className="attDayBody">
                    <table>
                      <thead><tr><th>User</th><th>ID</th><th>First IN</th><th>Last OUT</th><th>Hours</th><th>INs</th><th>OUTs</th><th>Punches</th><th>All Punches</th></tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.user_id}>
                            <td>{r.user_name || 'Unknown'}</td>
                            <td className="mono">{r.user_id}</td>
                            <td>{formatTime(r.first_in)}</td>
                            <td>{formatTime(r.last_out)}</td>
                            <td><span className={`attHours ${r.work_hours != null ? (r.work_hours >= 8 ? 'good' : r.work_hours >= 4 ? 'ok' : 'low') : ''}`}>{formatHours(r.work_hours)}</span></td>
                            <td>{r.in_count}</td>
                            <td>{r.out_count}</td>
                            <td>{r.total_punches}</td>
                            <td style={{ fontSize: 11 }}>
                              {r.punches?.slice(0, 8).map((p, i) => (
                                <span key={i} className={`attTime ${p.direction.toLowerCase()}`} style={{ marginRight: 3, marginBottom: 2, fontSize: 10 }}>
                                  {formatTime(p.time)}
                                </span>
                              ))}
                              {r.punches?.length > 8 && <span style={{ color: '#6b8a7e', fontSize: 10 }}>+{r.punches.length - 8} more</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {!filteredByDay.length && !loading && (
            <div className="emptyState"><CalendarDays size={40} /><p>No records found.</p></div>
          )}
        </div>
      )}

      {/* BY USER VIEW */}
      {reportType === 'by-user' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredByUser.map((user) => {
            const isExpanded = expandedUser === user.user_id;
            const sortedDays = [...user.days].sort((a, b) => b.day.localeCompare(a.day));
            return (
              <div key={user.user_id} className="attDayGroup">
                <div className="attDayHeader">
                  <button type="button" className="attDayToggle" onClick={() => setExpandedUser(isExpanded ? null : user.user_id)}>
                    <div className="attDayLeft" style={{ color: '#176b58' }}>
                      <Users size={16} />
                      <div>
                        <strong>{user.user_name || user.user_id}</strong>
                        <span className="attDayCount">{user.total_days} days &middot; {user.total_punches} punches &middot; {formatHours(user.total_hours)} total</span>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                </div>
                {isExpanded && (
                  <div className="attDayBody">
                    <table>
                      <thead><tr><th>Date</th><th>First IN</th><th>Last OUT</th><th>Hours</th><th>INs</th><th>OUTs</th><th>Total</th><th>Timeline</th></tr></thead>
                      <tbody>
                        {sortedDays.map((r) => (
                          <tr key={r.day}>
                            <td>{formatDate(r.day)}</td>
                            <td>{formatTime(r.first_in)}</td>
                            <td>{formatTime(r.last_out)}</td>
                            <td><span className={`attHours ${r.work_hours != null ? (r.work_hours >= 8 ? 'good' : r.work_hours >= 4 ? 'ok' : 'low') : ''}`}>{formatHours(r.work_hours)}</span></td>
                            <td>{r.in_count}</td>
                            <td>{r.out_count}</td>
                            <td>{r.total_punches}</td>
                            <td style={{ fontSize: 11 }}>
                              {(r.punches || []).slice(0, 10).map((p, i) => (
                                <span key={i} className={`attTime ${p.direction.toLowerCase()}`} style={{ marginRight: 2, marginBottom: 2, fontSize: 10 }}>
                                  {formatTime(p.time)}
                                </span>
                              ))}
                              {r.punches?.length > 10 && <span style={{ color: '#6b8a7e', fontSize: 10 }}>+{r.punches.length - 10}</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {!filteredByUser.length && !loading && (
            <div className="emptyState"><CalendarDays size={40} /><p>No records found.</p></div>
          )}
        </div>
      )}

      {/* PER PERSON VIEW */}
      {reportType === 'per-person' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {records.length > 0 && (
            <div className="statsGrid">
              <div className="stat"><div className="statIcon"><Users size={19} /></div><div><p>Person</p><strong>{records[0].user_name || records[0].user_id}</strong></div></div>
              <div className="stat"><div className="statIcon"><CalendarDays size={19} /></div><div><p>Days</p><strong>{records.length}</strong></div></div>
              <div className="stat"><div className="statIcon"><Clock3 size={19} /></div><div><p>Avg Hours</p><strong>{formatHours(records.reduce((s, r) => s + (r.work_hours || 0), 0) / records.filter(r => r.work_hours).length)}</strong></div></div>
              <div className="stat"><div className="statIcon"><Timer size={19} /></div><div><p>Total Punches</p><strong>{records.reduce((s, r) => s + (r.total_punches || 0), 0)}</strong></div></div>
            </div>
          )}
          {records.map((r) => (
            <div key={r.day + r.user_id} className="recentPunchCard" style={{ minHeight: 120 }}>
              <div className="recentPunchTop">
                <strong>{formatDate(r.day)}</strong>
                <span className={`attHours ${r.work_hours != null ? (r.work_hours >= 8 ? 'good' : r.work_hours >= 4 ? 'ok' : 'low') : ''}`}>
                  {formatHours(r.work_hours)}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {(r.punches || []).map((p, i) => (
                  <span key={i} className={`attTime ${p.direction.toLowerCase()}`}>
                    {formatTime(p.time)} <span style={{ fontWeight: 400, opacity: 0.8 }}>{p.direction}{p.label !== 'Check In' && p.label !== 'Check Out' ? ` (${p.label})` : ''}</span>
                  </span>
                ))}
              </div>
              <div className="recentPunchMeta">
                <span>First IN: {formatTime(r.first_in)}</span>
                <span>Last OUT: {formatTime(r.last_out)}</span>
                <span>{r.in_count} INs / {r.out_count} OUTs</span>
              </div>
            </div>
          ))}
          {!records.length && !loading && (
            <div className="emptyState"><User size={40} /><p>Select a person to view their detailed report.</p></div>
          )}
        </div>
      )}

      {/* MULTI PERSON VIEW */}
      {reportType === 'multi-person' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {selectedUsers.length === 0 && (
            <div className="emptyState"><Users size={40} /><p>Select persons above to view their combined report.</p></div>
          )}
          {groupedByUser.filter(u => selectedUsers.includes(u.user_id)).map((user) => {
            const isExpanded = expandedUser === user.user_id;
            const sortedDays = [...user.days].sort((a, b) => b.day.localeCompare(a.day));
            return (
              <div key={user.user_id} className="attDayGroup">
                <div className="attDayHeader">
                  <button type="button" className="attDayToggle" onClick={() => setExpandedUser(isExpanded ? null : user.user_id)}>
                    <div className="attDayLeft">
                      <User size={16} />
                      <div>
                        <strong>{user.user_name || user.user_id}</strong>
                        <span className="attDayCount">{user.total_days} days &middot; {user.total_punches} punches &middot; {formatHours(user.total_hours)} total</span>
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                </div>
                {isExpanded && (
                  <div className="attDayBody">
                    <table>
                      <thead><tr><th>Date</th><th>IN</th><th>OUT</th><th>Hours</th><th>Timeline</th></tr></thead>
                      <tbody>
                        {sortedDays.map((r) => (
                          <tr key={r.day}>
                            <td>{formatDate(r.day)}</td>
                            <td><span className="attTime in">{formatTime(r.first_in)}</span></td>
                            <td><span className="attTime out">{formatTime(r.last_out)}</span></td>
                            <td><span className={`attHours ${r.work_hours != null ? (r.work_hours >= 8 ? 'good' : r.work_hours >= 4 ? 'ok' : 'low') : ''}`}>{formatHours(r.work_hours)}</span></td>
                            <td style={{ fontSize: 11 }}>
                              {(r.punches || []).map((p, i) => (
                                <span key={i} className={`attTime ${p.direction.toLowerCase()}`} style={{ marginRight: 2, fontSize: 10 }}>
                                  {formatTime(p.time)}
                                </span>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}