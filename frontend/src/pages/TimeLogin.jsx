import React, { useEffect, useState } from 'react';
import {
  Clock,
  Sun,
  Sunrise,
  Sunset,
  Moon,
  Users,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Calendar,
  User,
  LogIn,
  LogOut,
  Play,
  Settings,
} from 'lucide-react';
import { request } from '../api';

const SLOT_ICONS = {
  '08:00': Sunrise,
  '10:00': Sun,
  '13:00': Clock,
  '15:00': Clock,
  '17:00': Sunset,
};

export default function TimeLogin() {
  const [config, setConfig] = useState({ enabled: true, slots: {}, out_check_enabled: true });
  const [stats, setStats] = useState(null);
  const [summary, setSummary] = useState(null);
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [message, setMessage] = useState('');
  const [msgType, setMsgType] = useState('info');

  function showMsg(text, type = 'info') {
    setMessage(text);
    setMsgType(type);
    setTimeout(() => setMessage(''), 5000);
  }

  async function loadData() {
    setLoading(true);
    try {
      const [configData, statsData, summaryData, recordsData] = await Promise.all([
        request('/api/time-login/config'),
        request('/api/time-login/stats'),
        request(`/api/time-login/summary?date=${date}`),
        request(`/api/time-login/records?date=${date}`),
      ]);
      setConfig(configData);
      setStats(statsData);
      setSummary(summaryData);
      setRecords(recordsData);
    } catch (err) {
      showMsg('Failed to load Time Login data: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [date]);

  async function toggleConfig(key, value) {
    const updated = { ...config, [key]: value };
    try {
      const result = await request('/api/time-login/config', {
        method: 'POST',
        body: JSON.stringify({ [key]: value }),
      });
      setConfig((prev) => ({ ...prev, ...result }));
      showMsg(`Time Login ${key === 'enabled' ? (value ? 'enabled' : 'disabled') : 'updated'}`, 'success');
    } catch (err) {
      showMsg('Config update failed: ' + err.message, 'error');
    }
  }

  async function toggleSlot(slotTime, enabled) {
    const updatedSlots = { ...config.slots, [slotTime]: enabled };
    try {
      const result = await request('/api/time-login/config', {
        method: 'POST',
        body: JSON.stringify({ slots: updatedSlots }),
      });
      setConfig((prev) => ({ ...prev, ...result }));
      showMsg(`Slot ${slotTime} ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      showMsg('Slot update failed: ' + err.message, 'error');
    }
  }

  async function triggerSlot(slotTime) {
    try {
      const result = await request(`/api/time-login/slot/${slotTime}`, { method: 'POST' });
      showMsg(result.message, 'success');
      loadData();
    } catch (err) {
      showMsg('Trigger failed: ' + err.message, 'error');
    }
  }

  async function triggerOutCheck(checkTime) {
    try {
      const result = await request(`/api/time-login/out-check/${checkTime}`, { method: 'POST' });
      showMsg(result.message, 'success');
      loadData();
    } catch (err) {
      showMsg('OUT check failed: ' + err.message, 'error');
    }
  }

  const slotTimes = ['08:00', '10:00', '13:00', '15:00', '17:00'];
  const slotLabels = {
    '08:00': 'Morning 8AM (07:40-08:00)',
    '10:00': 'Mid-Morning 10AM (08:01-10:00)',
    '13:00': 'Lunch 1PM (10:01-13:00)',
    '15:00': 'Afternoon 3PM (13:01-15:00)',
    '17:00': 'Evening 5PM (15:01-17:00)',
  };
  const outTimes = ['22:00', '23:00'];

  if (loading && !stats) {
    return (
      <div className="pageContainer">
        <div className="pageHeader"><h1>Time Login</h1></div>
        <div className="loadingState">Loading Time Login data...</div>
      </div>
    );
  }

  return (
    <div className="pageContainer">
      <div className="pageHeader">
        <h1>
          <Clock size={22} />
          Time Login
        </h1>
        <div className="pageHeaderActions">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="datePicker"
          />
          <button type="button" className="btnSmall" onClick={loadData}>
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {message && (
        <div className={`messageBanner ${msgType}`}>
          <span>{message}</span>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div className="timeLoginStats">
          <div className="statCard">
            <div className="statIcon"><Users size={20} /></div>
            <div className="statBody">
              <span className="statValue">{stats.today_recorded_in}</span>
              <span className="statLabel">IN Recorded Today</span>
            </div>
          </div>
          <div className="statCard">
            <div className="statIcon"><LogOut size={20} /></div>
            <div className="statBody">
              <span className="statValue">{stats.today_recorded_out}</span>
              <span className="statLabel">OUT Recorded Today</span>
            </div>
          </div>
          <div className="statCard warn">
            <div className="statIcon"><AlertTriangle size={20} /></div>
            <div className="statBody">
              <span className="statValue">{stats.today_pending_out}</span>
              <span className="statLabel">Pending OUT</span>
            </div>
          </div>
          <div className="statCard">
            <div className="statIcon"><Calendar size={20} /></div>
            <div className="statBody">
              <span className="statValue">{stats.total_records}</span>
              <span className="statLabel">Total Records</span>
            </div>
          </div>
        </div>
      )}

      {/* Config Toggle */}
      <div className="timeLoginConfig">
        <label className="toggleRow">
          <span>Enable Time Login Auto-Sync</span>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => toggleConfig('enabled', e.target.checked)}
          />
          <span className="toggleSlider" />
        </label>
        <label className="toggleRow">
          <span>Enable OUT Check (10PM/11PM)</span>
          <input
            type="checkbox"
            checked={config.out_check_enabled}
            onChange={(e) => toggleConfig('out_check_enabled', e.target.checked)}
          />
          <span className="toggleSlider" />
        </label>
      </div>

      {/* Time Slot Cards */}
      <div className="tlSection">
        <h2>IN Time Slots</h2>
        <p className="tlSectionDesc">
          Each slot captures the <strong>first IN</strong> punch for users in that time range.
          Once recorded, the user's IN is not updated for later slots.
        </p>
        <div className="tlSlotGrid">
          {slotTimes.map((slot) => {
            const Icon = SLOT_ICONS[slot] || Clock;
            const enabled = config.slots?.[slot] !== false;
            const slotSummary = summary?.slots?.find((s) => s.slot_time === slot);
            const userCount = slotSummary?.total_users || 0;

            return (
              <div key={slot} className={`tlSlotCard ${enabled ? '' : 'disabled'}`}>
                <div className="tlSlotHeader">
                  <Icon size={24} />
                  <h3>{slot}</h3>
                </div>
                <p className="tlSlotLabel">{slotLabels[slot]}</p>
                <div className="tlSlotBody">
                  <div className="tlSlotCount">
                    <Users size={14} />
                    <span>{userCount} users</span>
                  </div>
                </div>
                <div className="tlSlotActions">
                  <label className="tlSlotToggle">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => toggleSlot(slot, e.target.checked)}
                    />
                    <span className="toggleSlider small" />
                    <small>{enabled ? 'On' : 'Off'}</small>
                  </label>
                  <button
                    type="button"
                    className="btnSmall"
                    onClick={() => triggerSlot(slot)}
                    title="Manually trigger this slot now"
                  >
                    <Play size={12} />
                    Run
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* OUT Check Cards */}
      <div className="tlSection">
        <h2>OUT Check Times</h2>
        <p className="tlSectionDesc">
          Checks for the <strong>last OUT</strong> punch of the day for each recorded user.
        </p>
        <div className="tlSlotGrid">
          {outTimes.map((time) => (
            <div key={time} className="tlSlotCard out">
              <div className="tlSlotHeader">
                <Moon size={24} />
                <h3>{time}</h3>
              </div>
              <p className="tlSlotLabel">Daily OUT check</p>
              <div className="tlSlotActions single">
                <button
                  type="button"
                  className="btnSmall"
                  onClick={() => triggerOutCheck(time)}
                >
                  <Play size={12} />
                  Run OUT Check
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Slot Summary Table */}
      {summary && summary.slots && summary.slots.length > 0 && (
        <div className="tlSection">
          <h2>IN Slot Summary for {date}</h2>
          {summary.slots.map((slot) => (
            <div key={slot.slot_time} className="tlSlotSummary">
              <h4 className="tlSlotSummaryTitle">
                {slot.slot_label} ({slot.slot_time})
                <span className="tlSlotSummaryCount">{slot.total_users} users</span>
              </h4>
              {slot.users.length > 0 ? (
                <table className="tlSlotUsersTable">
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>Name</th>
                      <th>First IN Time</th>
                      <th>OUT Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slot.users.map((user) => (
                      <tr key={user.user_id}>
                        <td className="mono">{user.user_id}</td>
                        <td>{user.user_name || 'N/A'}</td>
                        <td className="mono">{user.first_in_time ? new Date(user.first_in_time).toLocaleTimeString() : 'N/A'}</td>
                        <td>
                          {user.out_status === 'recorded' ? (
                            <span className="statusOk"><CheckCircle size={14} /> OUT</span>
                          ) : (
                            <span className="statusWarn"><AlertTriangle size={14} /> Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="emptyText">No users recorded in this slot.</p>
              )}
            </div>
          ))}

          {/* Pending OUT */}
          {summary.pending_out && summary.pending_out.length > 0 && (
            <div className="tlSlotSummary warn">
              <h4 className="tlSlotSummaryTitle">
                <AlertTriangle size={16} />
                Pending OUT ({summary.pending_out.length} users)
              </h4>
              <table className="tlSlotUsersTable">
                <thead>
                  <tr>
                    <th>User ID</th>
                    <th>Name</th>
                    <th>First IN Time</th>
                    <th>Slot</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.pending_out.map((user) => (
                    <tr key={user.user_id}>
                      <td className="mono">{user.user_id}</td>
                      <td>{user.user_name || 'N/A'}</td>
                      <td className="mono">{user.first_in_time ? new Date(user.first_in_time).toLocaleTimeString() : 'N/A'}</td>
                      <td>{user.slot_label || user.slot_time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Recent Logs */}
      {stats && stats.recent_logs && stats.recent_logs.length > 0 && (
        <div className="tlSection">
          <h2>Recent Activity Log</h2>
          <div className="tlLogList">
            {[...stats.recent_logs].reverse().map((log, i) => (
              <div key={i} className="tlLogItem">
                <span className="tlLogTime">{new Date(log.timestamp).toLocaleTimeString()}</span>
                <span className="tlLogAction">{log.action === 'slot_sync' ? 'Slot Sync' : 'OUT Check'}</span>
                {log.slot_time && <span className="tlLogSlot">{log.slot_time} ({log.slot_label})</span>}
                <span className="tlLogResult">
                  {log.users_recorded != null && `${log.users_recorded} recorded`}
                  {log.out_updated != null && `${log.out_updated} OUT updated`}
                  {log.already_recorded > 0 && `, ${log.already_recorded} already synced`}
                  {log.still_pending > 0 && `, ${log.still_pending} pending`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}