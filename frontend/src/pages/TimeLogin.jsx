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
  Edit2,
  Trash2,
  X,
  Check,
  Send,
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
  const [editingRecord, setEditingRecord] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [zohoLoading, setZohoLoading] = useState(false);
  const [selectedRecords, setSelectedRecords] = useState(new Set());
  const [slotConfig, setSlotConfig] = useState([]);
  const [editingSlot, setEditingSlot] = useState(null);
  const [editSlotValue, setEditSlotValue] = useState('');

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
      // Sort records by slot_time ascending, then by first_in_time
      const sortedRecords = [...recordsData].sort((a, b) => {
        const slotA = a.slot_time || '99:99';
        const slotB = b.slot_time || '99:99';
        if (slotA !== slotB) return slotA.localeCompare(slotB);
        const timeA = a.first_in_time || '';
        const timeB = b.first_in_time || '';
        return timeA.localeCompare(timeB);
      });
      setRecords(sortedRecords);
      setSelectedRecords(new Set());
    } catch (err) {
      showMsg('Failed to load Time Login data: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [date]);

  async function toggleConfig(key, value) {
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

  async function saveSlotTimeEdit(oldTime) {
    const newTime = editSlotTimeValue.trim();
    if (!newTime || newTime === oldTime) { setEditingSlotTime(null); return; }
    const updated = slotTimes.map(t => t === oldTime ? newTime : t).sort();
    try {
      const result = await request('/api/time-login/config', {
        method: 'POST',
        body: JSON.stringify({ slot_times: updated }),
      });
      setConfig((prev) => ({ ...prev, ...result }));
      setEditingSlotTime(null);
      showMsg('Slot time updated', 'success');
    } catch (err) {
      showMsg('Failed to update slot time', 'error');
    }
  }

  async function deleteSlotTime(slotTime) {
    const updated = slotTimes.filter(t => t !== slotTime);
    try {
      const result = await request('/api/time-login/config', {
        method: 'POST',
        body: JSON.stringify({ slot_times: updated }),
      });
      setConfig((prev) => ({ ...prev, ...result }));
      showMsg('Slot time removed', 'success');
    } catch (err) {
      showMsg('Failed to remove slot time', 'error');
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

  async function saveOutTimeEdit(oldTime) {
    const newTime = editOutTimeValue.trim();
    if (!newTime || newTime === oldTime) { setEditingOutTime(null); return; }
    const updated = outTimes.map(t => t === oldTime ? newTime : t).sort();
    try {
      const result = await request('/api/time-login/config', {
        method: 'POST',
        body: JSON.stringify({ out_times: updated }),
      });
      setConfig((prev) => ({ ...prev, ...result }));
      setEditingOutTime(null);
      showMsg('OUT check time updated', 'success');
    } catch (err) {
      showMsg('Failed to update OUT time', 'error');
    }
  }

  async function deleteOutTime(checkTime) {
    const updated = outTimes.filter(t => t !== checkTime);
    try {
      const result = await request('/api/time-login/config', {
        method: 'POST',
        body: JSON.stringify({ out_times: updated }),
      });
      setConfig((prev) => ({ ...prev, ...result }));
      showMsg('OUT check time removed', 'success');
    } catch (err) {
      showMsg('Failed to remove OUT time', 'error');
    }
  }

  async function saveTimeEdit(recordId, field, value) {
    try {
      await request(`/api/time-login/records/${recordId}/update-time`, {
        method: 'POST',
        body: JSON.stringify({ field, value }),
      });
      showMsg('Time updated successfully', 'success');
      setEditingRecord(null);
      loadData();
    } catch (err) {
      showMsg('Failed to update time: ' + err.message, 'error');
    }
  }

  async function deleteRecord(recordId) {
    if (!confirm('Are you sure you want to delete this record?')) return;
    try {
      await request(`/api/time-login/records/${recordId}`, { method: 'DELETE' });
      showMsg('Record deleted', 'success');
      loadData();
    } catch (err) {
      showMsg('Delete failed: ' + err.message, 'error');
    }
  }

  async function syncToZoho() {
    setZohoLoading(true);
    try {
      const result = await request('/api/time-login/sync-zoho', {
        method: 'POST',
        body: JSON.stringify({ record_ids: Array.from(selectedRecords) }),
      });
      showMsg(result.message, result.status === 'ok' ? 'success' : 'error');
      setSelectedRecords(new Set());
      loadData();
    } catch (err) {
      showMsg('Zoho sync failed: ' + err.message, 'error');
    } finally {
      setZohoLoading(false);
    }
  }

  function startEdit(record, field) {
    const current = field === 'first_in_time' ? record.first_in_time : record.last_out_time;
    setEditingRecord({ recordId: `${record.user_id}|${record.date}`, field });
    setEditValue(current ? new Date(current).toISOString().slice(11, 16) : '');
  }

  function toggleSelect(recordId) {
    setSelectedRecords((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  const slotTimes = config.slot_times || ['08:00', '10:00', '13:00', '15:00', '17:00'];
  const slotLabels = config.slot_labels || {};
  const outTimes = config.out_times || ['22:00', '23:00'];

  const [editingSlotTime, setEditingSlotTime] = useState(null);
  const [editSlotTimeValue, setEditSlotTimeValue] = useState('');
  const [editingOutTime, setEditingOutTime] = useState(null);
  const [editOutTimeValue, setEditOutTimeValue] = useState('');
  const [newSlotTime, setNewSlotTime] = useState('');
  const [newOutTime, setNewOutTime] = useState('');

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
            <div className="statIcon"><LogIn size={20} /></div>
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

      {/* IN Time Slots */}
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
                  {editingSlotTime === slot ? (
                    <input
                      type="time"
                      value={editSlotTimeValue}
                      onChange={(e) => setEditSlotTimeValue(e.target.value)}
                      className="timeInput"
                    />
                  ) : (
                    <h3>{slot}</h3>
                  )}
                </div>
                <p className="tlSlotLabel">{slotLabels[slot] || `Slot ${slot}`}</p>
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
                  {editingSlotTime === slot ? (
                    <>
                      <button type="button" className="btnSmall" onClick={() => saveSlotTimeEdit(slot)}><Check size={12} /> Save</button>
                      <button type="button" className="btnSmall btnSecondary" onClick={() => setEditingSlotTime(null)}><X size={12} /></button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btnSmall" onClick={() => { setEditingSlotTime(slot); setEditSlotTimeValue(slot); }} title="Edit time"><Edit2 size={12} /></button>
                      <button type="button" className="btnSmall btnDanger" onClick={() => deleteSlotTime(slot)} title="Remove slot"><Trash2 size={12} /></button>
                    </>
                  )}
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
        <div className="tlAddTime">
          <input
            type="time"
            value={newSlotTime}
            onChange={(e) => setNewSlotTime(e.target.value)}
            className="timeInput"
          />
          <button
            type="button"
            className="btnSmall"
            onClick={async () => {
              if (!newSlotTime || slotTimes.includes(newSlotTime)) return;
              const updated = [...slotTimes, newSlotTime].sort();
              try {
                const result = await request('/api/time-login/config', {
                  method: 'POST',
                  body: JSON.stringify({ slot_times: updated }),
                });
                setConfig((prev) => ({ ...prev, ...result }));
                setNewSlotTime('');
                showMsg('IN slot added', 'success');
              } catch (err) {
                showMsg('Failed to add slot', 'error');
              }
            }}
          >
            Add IN Slot
          </button>
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
                {editingOutTime === time ? (
                  <input
                    type="time"
                    value={editOutTimeValue}
                    onChange={(e) => setEditOutTimeValue(e.target.value)}
                    className="timeInput"
                  />
                ) : (
                  <h3>{time}</h3>
                )}
              </div>
              <p className="tlSlotLabel">Daily OUT check</p>
              <div className="tlSlotActions single">
                {editingOutTime === time ? (
                  <>
                    <button type="button" className="btnSmall" onClick={() => saveOutTimeEdit(time)}><Check size={12} /> Save</button>
                    <button type="button" className="btnSmall btnSecondary" onClick={() => setEditingOutTime(null)}><X size={12} /></button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btnSmall" onClick={() => { setEditingOutTime(time); setEditOutTimeValue(time); }} title="Edit time"><Edit2 size={12} /></button>
                    <button type="button" className="btnSmall btnDanger" onClick={() => deleteOutTime(time)} title="Remove OUT check"><Trash2 size={12} /></button>
                  </>
                )}
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
        <div className="tlAddTime">
          <input
            type="time"
            value={newOutTime}
            onChange={(e) => setNewOutTime(e.target.value)}
            className="timeInput"
          />
          <button
            type="button"
            className="btnSmall"
            onClick={async () => {
              if (!newOutTime || outTimes.includes(newOutTime)) return;
              const updated = [...outTimes, newOutTime].sort();
              try {
                const result = await request('/api/time-login/config', {
                  method: 'POST',
                  body: JSON.stringify({ out_times: updated }),
                });
                setConfig((prev) => ({ ...prev, ...result }));
                setNewOutTime('');
                showMsg('OUT check time added', 'success');
              } catch (err) {
                showMsg('Failed to add OUT time', 'error');
              }
            }}
          >
            Add OUT Check
          </button>
        </div>
      </div>

      {/* Records Table - Grouped by Slot */}
      <div className="tlSection">
        <div className="tlSectionHeader">
          <h2>Time Login Records for {date}</h2>
          <div className="tlSectionActions">
            {selectedRecords.size > 0 && (
              <button
                type="button"
                className="btnSmall primary"
                onClick={syncToZoho}
                disabled={zohoLoading}
              >
                <Send size={14} />
                {zohoLoading ? 'Syncing...' : `Sync to Zoho (${selectedRecords.size})`}
              </button>
            )}
          </div>
        </div>
        <div className="tlRecordsTable">
          {(() => {
            // Group records by slot_time
            const slotGroups = {};
            records.forEach((record) => {
              const slotKey = record.slot_time || 'Unassigned';
              if (!slotGroups[slotKey]) {
                slotGroups[slotKey] = [];
              }
              slotGroups[slotKey].push(record);
            });

            // Sort slot keys ascending
            const sortedSlotKeys = Object.keys(slotGroups).sort((a, b) => {
              if (a === 'Unassigned') return 1;
              if (b === 'Unassigned') return -1;
              return a.localeCompare(b);
            });

            if (records.length === 0) {
              return (
                <table>
                  <tbody>
                    <tr>
                      <td colSpan="7" className="emptyRow">No records for this date</td>
                    </tr>
                  </tbody>
                </table>
              );
            }

            return (
              <div className="tlSlotGroups">
                {sortedSlotKeys.map((slotKey) => {
                  const slotRecords = slotGroups[slotKey];
                  const slotLabel = slotTimes.find(t => t === slotKey)
                    ? (slotLabels[slotKey] || `Slot ${slotKey}`)
                    : 'Unassigned';

                  return (
                    <div key={slotKey} className="tlSlotGroup">
                      <div className="tlSlotGroupHeader">
                        <h4>{slotLabel}</h4>
                        <span className="tlSlotGroupCount">{slotRecords.length} user{slotRecords.length !== 1 ? 's' : ''}</span>
                      </div>
                      <table>
                        <thead>
                          <tr>
                            <th>User ID</th>
                            <th>Name</th>
                            <th>First IN</th>
                            <th>Last OUT</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slotRecords.map((record) => {
                            const recordId = `${record.user_id}|${record.date}`;
                            const isSelected = selectedRecords.has(recordId);
                            const isEditing = editingRecord?.recordId === recordId;

                            return (
                              <tr key={recordId} className={isSelected ? 'selected' : ''}>
                                <td className="mono">{record.user_id}</td>
                                <td>{record.user_name || 'N/A'}</td>
                                <td>
                                  {isEditing && editingRecord.field === 'first_in_time' ? (
                                    <div className="editTime">
                                      <input
                                        type="time"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        step="60"
                                      />
                                      <button onClick={() => saveTimeEdit(recordId, 'first_in_time', editValue + ':00')}><Check size={14} /></button>
                                      <button onClick={() => setEditingRecord(null)}><X size={14} /></button>
                                    </div>
                                  ) : (
                                    <span
                                      className="timeValue"
                                      onClick={() => startEdit(record, 'first_in_time')}
                                    >
                                      {record.first_in_time ? new Date(record.first_in_time).toLocaleTimeString() : 'N/A'}
                                      {record.first_in_time && <Edit2 size={12} className="editIcon" />}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  {isEditing && editingRecord.field === 'last_out_time' ? (
                                    <div className="editTime">
                                      <input
                                        type="time"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        step="60"
                                      />
                                      <button onClick={() => saveTimeEdit(recordId, 'last_out_time', editValue + ':00')}><Check size={14} /></button>
                                      <button onClick={() => setEditingRecord(null)}><X size={14} /></button>
                                    </div>
                                  ) : (
                                    <span
                                      className="timeValue"
                                      onClick={() => startEdit(record, 'last_out_time')}
                                    >
                                      {record.last_out_time ? new Date(record.last_out_time).toLocaleTimeString() : 'N/A'}
                                      {record.last_out_time && <Edit2 size={12} className="editIcon" />}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <span className={`statusBadge ${record.out_status === 'recorded' ? 'ok' : 'warn'}`}>
                                    {record.out_status === 'recorded' ? 'Complete' : 'Pending OUT'}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="btnTiny btnDanger"
                                    onClick={() => deleteRecord(recordId)}
                                    title="Delete record"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

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