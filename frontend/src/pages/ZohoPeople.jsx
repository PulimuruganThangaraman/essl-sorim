import React, { useEffect, useState } from 'react';
import { request } from '../api';

export default function ZohoPeople() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await request(`/api/zoho/attendance?date=${date}`);
      setRecords(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [date]);

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Zoho People Attendance</h1>
          <p>View check-in and check-out data from Zoho People</p>
        </div>
        <div className="headerActions">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input"
          />
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      {error && <div className="notice error">{error}</div>}

      <section className="card">
        <div className="cardHeader">
          <h2>Attendance Records - {date}</h2>
        </div>
        <div className="tableWrapper">
          <table className="dataTable">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Check In</th>
                <th>Check Out</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.map((row, idx) => (
                <tr key={idx}>
                  <td>{row.employee_id || '-'}</td>
                  <td>{row.name || '-'}</td>
                  <td>{row.check_in ? new Date(row.check_in).toLocaleString() : '-'}</td>
                  <td>{row.check_out ? new Date(row.check_out).toLocaleString() : '-'}</td>
                  <td>
                    <span className={`badge ${row.status ? 'in' : 'warn'}`}>
                      {row.status || 'absent'}
                    </span>
                  </td>
                </tr>
              ))}
              {!records.length && !loading && (
                <tr>
                  <td colSpan="5" className="emptyText">No Zoho attendance records for this date.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}