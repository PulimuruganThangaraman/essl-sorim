import React, { useEffect, useState } from 'react';
import { Save, RefreshCw, Clock, Server, Info, CheckCircle, AlertTriangle, HardDrive, Palette, Globe, Bell, Shield, Database, Trash2, Mail, Send } from 'lucide-react';
import { request } from '../api';

const DEFAULTS = { theme: 'light', accent: 'green', timeFormat: '24h', dateFormat: 'DD/MM/YYYY', timezone: 'Asia/Kolkata', language: 'en', defaultPage: 'dashboard', rowsPerPage: '50', notifyNewPunch: 'true', notifyDeviceOffline: 'true', notifyDailyReport: 'false', csvDelimiter: ',', defaultDateRange: '7', compactSidebar: 'false' };
const DEFAULT_EMAIL = { host: 'smtp.gmail.com', port: 587, user: '', password: '', from_email: '', to_email: '', use_tls: true, enabled: false, time: '23:30', password_configured: false };

function loadPrefs() { try { const s = localStorage.getItem('sorim_crm_prefs'); if (s) return { ...DEFAULTS, ...JSON.parse(s) }; } catch {} return DEFAULTS; }
function savePrefsToStorage(p) { try { localStorage.setItem('sorim_crm_prefs', JSON.stringify(p)); } catch {} }

export default function Settings() {
  const [autoSync, setAutoSync] = useState({ enabled: true, interval_seconds: 60 });
  const [health, setHealth] = useState(null);
  const [devices, setDevices] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [active, setActive] = useState('sync');
  const [emailConfig, setEmailConfig] = useState(DEFAULT_EMAIL);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);

  async function load() {
    setLoading(true); setMessage('');
    try { const [s, h, d, e] = await Promise.all([request('/api/auto-sync'), request('/api/health'), request('/api/devices'), request('/api/email/config')]); setAutoSync(s); setHealth(h); setDevices(d); setEmailConfig({ ...DEFAULT_EMAIL, ...e, password: '' }); }
    catch (err) { setMessage(err.message); } finally { setLoading(false); }
  }
  async function saveAutoSync() {
    setSaving(true); setMessage('');
    try { const result = await request('/api/auto-sync', { method: 'POST', body: JSON.stringify(autoSync) }); setAutoSync(result); setMessage('Auto-sync saved (' + result.interval_seconds + 's). Sync thread restarted.'); }
    catch (err) { setMessage(err.message); } finally { setSaving(false); }
  }
  async function saveEmailConfig() {
    setEmailSaving(true); setMessage('');
    try {
      const payload = { ...emailConfig, port: Number(emailConfig.port) || 587 };
      delete payload.password_configured;
      if (!payload.password) delete payload.password;
      const result = await request('/api/email/config', { method: 'POST', body: JSON.stringify(payload) });
      setEmailConfig({ ...DEFAULT_EMAIL, ...result, password: '' });
      setMessage('Email settings saved.');
    } catch (err) { setMessage(err.message); } finally { setEmailSaving(false); }
  }
  async function sendTestEmail() {
    setEmailTesting(true); setMessage('');
    try {
      const result = await request('/api/email/test', { method: 'POST' });
      setMessage(result.status === 'ok' ? result.message : 'Email failed: ' + (result.message || 'Unknown error'));
    } catch (err) { setMessage(err.message); } finally { setEmailTesting(false); }
  }
  function savePrefs() { savePrefsToStorage(prefs); setMessage('Preferences saved.'); }
  function resetPrefs() { if (!window.confirm('Reset all preferences?')) return; setPrefs(DEFAULTS); savePrefsToStorage(DEFAULTS); setMessage('Preferences reset to defaults.'); }
  function clearCache() { if (!window.confirm('Clear all local data and reload?')) return; localStorage.clear(); window.location.reload(); }

  useEffect(() => { load(); }, []);

  const sections = [
    { key: 'sync', label: 'Auto-Sync', icon: Clock },
    { key: 'email', label: 'Email', icon: Mail },
    { key: 'system', label: 'System', icon: Info },
    { key: 'devices', label: 'Devices', icon: Server },
    { key: 'appearance', label: 'Appearance', icon: Palette },
    { key: 'localization', label: 'Localization', icon: Globe },
    { key: 'data', label: 'Data & Display', icon: Database },
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'security', label: 'Security', icon: Shield },
    { key: 'api', label: 'API Reference', icon: HardDrive },
  ];

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div><h1>Settings</h1><p>Configure your Sorim CRM application</p></div>
        <div className="headerActions"><button type="button" className="btnSecondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button></div>
      </header>
      {message && <div className="notice">{message}</div>}
      <div className="settingsLayout">
        <nav className="settingsNav">
          {sections.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" className={`settingsNavItem ${active === key ? 'active' : ''}`} onClick={() => setActive(key)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
        <div className="settingsContent">

          {active === 'sync' && (
            <section className="settingsCard">
              <div className="settingsCardHeader">
                <div className="settingsCardIcon" style={{ background: '#ddebe4', color: '#176b58' }}><Clock size={20} /></div>
                <div><h3>Auto-Sync</h3><p>Automatically sync data from biometric devices</p></div>
              </div>
              <div className="settingsCardBody">
                <div className="settingRow">
                  <div className="settingInfo"><span className="settingLabel">Enable Auto-Sync</span><span className="settingDesc">Periodically pull data from all enabled devices</span></div>
                  <label className="toggle"><input type="checkbox" checked={autoSync.enabled} onChange={(e) => setAutoSync((p) => ({ ...p, enabled: e.target.checked }))} /><span className="toggleSlider" /></label>
                </div>
                <div className="settingRow">
                  <div className="settingInfo"><span className="settingLabel">Sync Interval</span><span className="settingDesc">How often to sync. Changes take effect immediately.</span></div>
                  <select value={autoSync.interval_seconds} onChange={(e) => setAutoSync((p) => ({ ...p, interval_seconds: parseInt(e.target.value) }))} style={{ width: 180 }}>
                    <option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={60}>1 minute</option>
                    <option value={120}>2 minutes</option><option value={300}>5 minutes</option><option value={600}>10 minutes</option>
                    <option value={1800}>30 minutes</option><option value={3600}>1 hour</option>
                  </select>
                </div>
                <div className="settingsCardFooter">
                  <button type="button" onClick={saveAutoSync} disabled={saving}><Save size={15} /> {saving ? 'Saving...' : 'Save Settings'}</button>
                </div>
              </div>
            </section>
          )}

          {active === 'email' && (
            <section className="settingsCard">
              <div className="settingsCardHeader">
                <div className="settingsCardIcon" style={{ background: '#ddebe4', color: '#176b58' }}><Mail size={20} /></div>
                <div><h3>Email Reports</h3><p>SMTP settings for attendance report delivery</p></div>
              </div>
              <div className="settingsCardBody">
                <div className="settingRow">
                  <div className="settingInfo"><span className="settingLabel">Daily Schedule</span><span className="settingDesc">Send the daily report automatically</span></div>
                  <label className="toggle"><input type="checkbox" checked={emailConfig.enabled} onChange={(e) => setEmailConfig((p) => ({ ...p, enabled: e.target.checked }))} /><span className="toggleSlider" /></label>
                </div>
                <div className="formGrid">
                  <label><span>SMTP Server</span><input value={emailConfig.host} onChange={(e) => setEmailConfig((p) => ({ ...p, host: e.target.value }))} /></label>
                  <label><span>SMTP Port</span><input type="number" value={emailConfig.port} onChange={(e) => setEmailConfig((p) => ({ ...p, port: e.target.value }))} /></label>
                  <label><span>Username</span><input value={emailConfig.user} onChange={(e) => setEmailConfig((p) => ({ ...p, user: e.target.value, from_email: p.from_email || e.target.value, to_email: p.to_email || e.target.value }))} /></label>
                  <label><span>App Password</span><input type="password" value={emailConfig.password} placeholder={emailConfig.password_configured ? 'Saved app password' : 'Gmail app password'} onChange={(e) => setEmailConfig((p) => ({ ...p, password: e.target.value }))} /></label>
                  <label><span>From Email</span><input value={emailConfig.from_email} onChange={(e) => setEmailConfig((p) => ({ ...p, from_email: e.target.value }))} /></label>
                  <label><span>To Email</span><input value={emailConfig.to_email} onChange={(e) => setEmailConfig((p) => ({ ...p, to_email: e.target.value }))} /></label>
                  <label><span>Report Time</span><input type="time" value={emailConfig.time} onChange={(e) => setEmailConfig((p) => ({ ...p, time: e.target.value }))} /></label>
                </div>
                <div className="settingRow">
                  <div className="settingInfo"><span className="settingLabel">TLS</span><span className="settingDesc">Use STARTTLS for SMTP</span></div>
                  <label className="toggle"><input type="checkbox" checked={emailConfig.use_tls} onChange={(e) => setEmailConfig((p) => ({ ...p, use_tls: e.target.checked }))} /><span className="toggleSlider" /></label>
                </div>
                <div className="settingsCardFooter">
                  <button type="button" onClick={saveEmailConfig} disabled={emailSaving}><Save size={15} /> {emailSaving ? 'Saving...' : 'Save Email'}</button>
                  <button type="button" className="btnSecondary" onClick={sendTestEmail} disabled={emailTesting} style={{ marginLeft: 8 }}><Send size={15} /> {emailTesting ? 'Sending...' : 'Send Test'}</button>
                </div>
              </div>
            </section>
          )}

          {active === 'system' && (
            <section className="settingsCard">
              <div className="settingsCardHeader">
                <div className="settingsCardIcon" style={{ background: '#e0e7ff', color: '#4f46e5' }}><Info size={20} /></div>
                <div><h3>System Information</h3><p>Current system status and database information</p></div>
              </div>
              <div className="settingsCardBody">
                <div className="infoGrid">
                  <div className="infoItem"><span className="infoLabel">Application</span><span className="infoValue">Sorim CRM</span></div>
                  <div className="infoItem"><span className="infoLabel">Version</span><span className="infoValue">1.0.0</span></div>
                  <div className="infoItem"><span className="infoLabel">Database</span><span className="infoValue mono">{health?.database || 'Loading...'}</span></div>
                  <div className="infoItem"><span className="infoLabel">Status</span><span className="infoValue">{health?.ok ? <span className="statusOk"><CheckCircle size={14} /> Healthy</span> : <span className="statusError"><AlertTriangle size={14} /> Error</span>}</span></div>
                  <div className="infoItem"><span className="infoLabel">Total Devices</span><span className="infoValue">{devices.length}</span></div>
                  <div className="infoItem"><span className="infoLabel">Auto-Sync</span><span className="infoValue">{autoSync.enabled ? <span className="statusOk">Active ({autoSync.interval_seconds}s)</span> : <span className="statusWarn">Disabled</span>}</span></div>
                </div>
              </div>
            </section>
          )}

          {active === 'devices' && (
            <section className="settingsCard">
              <div className="settingsCardHeader">
                <div className="settingsCardIcon" style={{ background: '#f0fdf4', color: '#15803d' }}><Server size={20} /></div>
                <div><h3>Device Configuration</h3><p>Configured biometric devices and their status</p></div>
              </div>
              <div className="settingsCardBody">
                <div className="settingsDeviceList">
                  {devices.map((d) => (
                    <div key={d.id} className="settingsDeviceRow">
                      <div className="settingsDeviceInfo"><div className="settingsDeviceIcon"><Server size={16} /></div>
                        <div><strong>{d.name}</strong><small>{d.ip}:{d.port}</small></div>
                      </div>
                      <div className="settingsDeviceMeta"><span className={`statusBadge ${d.status}`}>{d.status}</span><small>{d.location || 'No location'}</small></div>
                    </div>
                  ))}
                  {!devices.length && <p className="emptyText">No devices configured.</p>}
                </div>
                <p className="settingsNote">To add or modify devices, edit the <code>devices.json</code> file in the project root.</p>
              </div>
            </section>
          )}

          {active === 'appearance' && (
            <section className="settingsCard">
              <div className="settingsCardHeader">
                <div className="settingsCardIcon" style={{ background: '#f3e8ff', color: '#7c3aed' }}><Palette size={20} /></div>
                <div><h3>Appearance</h3><p>Customize how Sorim CRM looks</p></div>
              </div>
              <div className="settingsCardBody">
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Theme</span><span className="settingDesc">Choose your color theme</span></div>
                  <select value={prefs.theme} onChange={(e) => setPrefs({ ...prefs, theme: e.target.value })} style={{ width: 180 }}>
                    <option value="light">Light</option><option value="dark">Dark</option><option value="auto">Auto (system)</option>
                  </select></div>
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Accent Color</span><span className="settingDesc">Primary brand color</span></div>
                  <select value={prefs.accent} onChange={(e) => setPrefs({ ...prefs, accent: e.target.value })} style={{ width: 180 }}>
                    <option value="green">Green</option><option value="blue">Blue</option><option value="purple">Purple</option><option value="red">Red</option><option value="orange">Orange</option>
                  </select></div>
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Compact Sidebar</span><span className="settingDesc">Show only icons</span></div>
                  <label className="toggle"><input type="checkbox" checked={prefs.compactSidebar === 'true'} onChange={(e) => setPrefs({ ...prefs, compactSidebar: String(e.target.checked) })} /><span className="toggleSlider" /></label></div>
                <div className="settingsCardFooter"><button type="button" onClick={savePrefs}><Save size={15} /> Save Preferences</button>
                  <button type="button" className="btnSecondary" onClick={resetPrefs} style={{ marginLeft: 8 }}>Reset to Defaults</button></div>
              </div>
            </section>
          )}

          {active === 'localization' && (
            <section className="settingsCard">
              <div className="settingsCardHeader">
                <div className="settingsCardIcon" style={{ background: '#fef3cd', color: '#856404' }}><Globe size={20} /></div>
                <div><h3>Localization</h3><p>Language, time, and date format</p></div>
              </div>
              <div className="settingsCardBody">
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Language</span><span className="settingDesc">Display language</span></div>
                  <select value={prefs.language} onChange={(e) => setPrefs({ ...prefs, language: e.target.value })} style={{ width: 200 }}>
                    <option value="en">English</option><option value="hi">Hindi</option><option value="es">Spanish</option><option value="fr">French</option>
                    <option value="de">German</option><option value="pt">Portuguese</option><option value="ar">Arabic</option></select></div>
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Timezone</span><span className="settingDesc">Your local timezone</span></div>
                  <select value={prefs.timezone} onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })} style={{ width: 220 }}>
                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option><option value="UTC">UTC</option>
                    <option value="America/New_York">America/New_York (EST)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                    <option value="Europe/London">Europe/London (GMT)</option><option value="Europe/Paris">Europe/Paris (CET)</option>
                    <option value="Asia/Dubai">Asia/Dubai (GST)</option><option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                    <option value="Asia/Tokyo">Asia/Tokyo (JST)</option><option value="Australia/Sydney">Australia/Sydney (AEDT)</option></select></div>
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Time Format</span><span className="settingDesc">12h or 24h clock</span></div>
                  <select value={prefs.timeFormat} onChange={(e) => setPrefs({ ...prefs, timeFormat: e.target.value })} style={{ width: 180 }}>
                    <option value="24h">24-hour (14:30)</option><option value="12h">12-hour (2:30 PM)</option></select></div>
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Date Format</span><span className="settingDesc">Date display format</span></div>
                  <select value={prefs.dateFormat} onChange={(e) => setPrefs({ ...prefs, dateFormat: e.target.value })} style={{ width: 220 }}>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option><option value="MM/DD/YYYY">MM/DD/YYYY (US)</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD (ISO)</option><option value="DD-MMM-YYYY">DD-MMM-YYYY</option></select></div>
                <div className="settingsCardFooter"><button type="button" onClick={savePrefs}><Save size={15} /> Save Preferences</button></div>
              </div>
            </section>
          )}

          {active === 'data' && (
            <section className="settingsCard">
              <div className="settingsCardHeader">
                <div className="settingsCardIcon" style={{ background: '#fee2e2', color: '#b91c1c' }}><Database size={20} /></div>
                <div><h3>Data & Display</h3><p>Data display preferences</p></div>
              </div>
              <div className="settingsCardBody">
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Default Landing Page</span><span className="settingDesc">Page to show on login</span></div>
                  <select value={prefs.defaultPage} onChange={(e) => setPrefs({ ...prefs, defaultPage: e.target.value })} style={{ width: 200 }}>
                    <option value="dashboard">Dashboard</option><option value="attendance">Attendance</option>
                    <option value="devices">Devices</option><option value="users">Users</option><option value="punches">Punches</option></select></div>
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Rows Per Page</span><span className="settingDesc">Default pagination size</span></div>
                  <select value={prefs.rowsPerPage} onChange={(e) => setPrefs({ ...prefs, rowsPerPage: e.target.value })} style={{ width: 120 }}>
                    <option value="25">25</option><option value="50">50</option><option value="100">100</option><option value="200">200</option></select></div>
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Default Date Range</span><span className="settingDesc">Default days for attendance filter</span></div>
                  <select value={prefs.defaultDateRange} onChange={(e) => setPrefs({ ...prefs, defaultDateRange: e.target.value })} style={{ width: 120 }}>
                    <option value="1">Today</option><option value="7">Last 7 days</option><option value="14">Last 14 days</option>
                    <option value="30">Last 30 days</option><option value="90">Last 90 days</option></select></div>
                <div className="settingsCardFooter"><button type="button" onClick={savePrefs}><Save size={15} /> Save Preferences</button></div>
              </div>
            </section>
          )}

          {active === 'notifications' && (
            <section className="settingsCard">
              <div className="settingsCardHeader">
                <div className="settingsCardIcon" style={{ background: '#e0f2fe', color: '#0369a1' }}><Bell size={20} /></div>
                <div><h3>Notifications</h3><p>Configure notification preferences</p></div>
              </div>
              <div className="settingsCardBody">
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">New Punch Alert</span><span className="settingDesc">Notify on new punch</span></div>
                  <label className="toggle"><input type="checkbox" checked={prefs.notifyNewPunch === 'true'} onChange={(e) => setPrefs({ ...prefs, notifyNewPunch: String(e.target.checked) })} /><span className="toggleSlider" /></label></div>
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Device Offline</span><span className="settingDesc">Notify when device goes offline</span></div>
                  <label className="toggle"><input type="checkbox" checked={prefs.notifyDeviceOffline === 'true'} onChange={(e) => setPrefs({ ...prefs, notifyDeviceOffline: String(e.target.checked) })} /><span className="toggleSlider" /></label></div>
                <div className="settingRow"><div className="settingInfo"><span className="settingLabel">Daily Report</span><span className="settingDesc">Daily email summary</span></div>
                  <label className="toggle"><input type="checkbox" checked={prefs.notifyDailyReport === 'true'} onChange={(e) => setPrefs({ ...prefs, notifyDailyReport: String(e.target.checked) })} /><span className="toggleSlider" /></label></div>
                <div className="settingsCardFooter"><button type="button" onClick={savePrefs}><Save size={15} /> Save Preferences</button></div>
              </div>
            </section>
          )}

          {active === 'security' && (
            <section className="settingsCard">
              <div className="settingsCardHeader">
                <div className="settingsCardIcon" style={{ background: '#dcfce7', color: '#166534' }}><Shield size={20} /></div>
                <div><h3>Security</h3><p>Security and data management</p></div>
              </div>
              <div className="settingsCardBody">
                <div className="settingRow">
                  <div className="settingInfo"><span className="settingLabel">Clear Local Cache</span><span className="settingDesc">Remove all locally stored preferences and reload</span></div>
                  <button type="button" className="btnDanger" onClick={clearCache}><Trash2 size={14} /> Clear Cache</button>
                </div>
                <div className="settingsCardFooter"><button type="button" onClick={savePrefs}><Save size={15} /> Save Preferences</button></div>
              </div>
            </section>
          )}

          {active === 'api' && (
            <section className="settingsCard">
              <div className="settingsCardHeader">
                <div className="settingsCardIcon" style={{ background: '#fef3cd', color: '#856404' }}><HardDrive size={20} /></div>
                <div><h3>API Reference</h3><p>Available REST API endpoints</p></div>
              </div>
              <div className="settingsCardBody">
                <div className="apiList">
                  <div className="apiItem"><span className="apiMethod get">GET</span><span className="apiPath">/api/health</span><span className="apiDesc">System health check</span></div>
                  <div className="apiItem"><span className="apiMethod get">GET</span><span className="apiPath">/api/devices</span><span className="apiDesc">List all devices</span></div>
                  <div className="apiItem"><span className="apiMethod get">GET</span><span className="apiPath">/api/users</span><span className="apiDesc">List all users</span></div>
                  <div className="apiItem"><span className="apiMethod post">POST</span><span className="apiPath">/api/users</span><span className="apiDesc">Create/update user</span></div>
                  <div className="apiItem"><span className="apiMethod put">PUT</span><span className="apiPath">/api/users/:id/:uid</span><span className="apiDesc">Edit user + update punches</span></div>
                  <div className="apiItem"><span className="apiMethod delete">DEL</span><span className="apiPath">/api/users/:id/:uid</span><span className="apiDesc">Delete user</span></div>
                  <div className="apiItem"><span className="apiMethod post">POST</span><span className="apiPath">/api/users/push</span><span className="apiDesc">Push user to device</span></div>
                  <div className="apiItem"><span className="apiMethod get">GET</span><span className="apiPath">/api/punches</span><span className="apiDesc">List punches with filters</span></div>
                  <div className="apiItem"><span className="apiMethod get">GET</span><span className="apiPath">/api/punches.csv</span><span className="apiDesc">Export punches as CSV</span></div>
                  <div className="apiItem"><span className="apiMethod get">GET</span><span className="apiPath">/api/summary</span><span className="apiDesc">Punch summary stats</span></div>
                  <div className="apiItem"><span className="apiMethod get">GET</span><span className="apiPath">/api/attendance/daily</span><span className="apiDesc">Daily attendance report</span></div>
                  <div className="apiItem"><span className="apiMethod post">POST</span><span className="apiPath">/api/sync</span><span className="apiDesc">Trigger device sync</span></div>
                  <div className="apiItem"><span className="apiMethod get">GET</span><span className="apiPath">/api/auto-sync</span><span className="apiDesc">Get auto-sync config</span></div>
                  <div className="apiItem"><span className="apiMethod post">POST</span><span className="apiPath">/api/auto-sync</span><span className="apiDesc">Update auto-sync config</span></div>
                </div>
              </div>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}
