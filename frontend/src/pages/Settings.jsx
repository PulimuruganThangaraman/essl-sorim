import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  BriefcaseBusiness,
  CalendarCheck,
  CheckCircle,
  Clock,
  Database,
  FileText,
  Globe,
  HardDrive,
  Info,
  Laptop,
  Mail,
  Palette,
  RefreshCw,
  Save,
  Send,
  Server,
  Shield,
  SlidersHorizontal,
  Target,
  Trash2,
  UserRound,
} from 'lucide-react';
import { request } from '../api';

const PREF_KEY = 'sorim_crm_prefs';

const DEFAULTS = {
  theme: 'light',
  accent: 'green',
  timeFormat: '24h',
  dateFormat: 'DD/MM/YYYY',
  timezone: 'Asia/Kolkata',
  language: 'en',
  defaultPage: 'dashboard',
  rowsPerPage: '50',
  notifyNewPunch: 'true',
  notifyDeviceOffline: 'true',
  notifyDailyReport: 'false',
  csvDelimiter: ',',
  defaultDateRange: '1',
  compactSidebar: 'false',
  workStart: '09:30',
  workEnd: '18:30',
  fullDayHours: '8',
  halfDayHours: '4',
  overtimeAfter: '9',
  lateGraceMinutes: '10',
  annualLeaveQuota: '12',
  payrollCurrency: 'INR',
  documentReminderDays: '30',
  assetAuditCycle: 'quarterly',
};

const DEFAULT_EMAIL = {
  host: 'smtp.gmail.com',
  port: 587,
  user: '',
  password: '',
  from_email: '',
  to_email: '',
  cc_email: '',
  bcc_email: '',
  use_tls: true,
  enabled: false,
  time: '23:30',
  password_configured: false,
};

const DEFAULT_ZOHO = {
  enabled: false,
  auto_push: false,
  data_center: 'in',
  accounts_url: 'https://accounts.zoho.in',
  people_url: 'https://people.zoho.in',
  client_id: '',
  client_secret: '',
  refresh_token: '',
  default_location: '',
  default_building: '',
  use_biometric_user_id_as_emp_id: false,
  send_only_mapped_users: true,
  batch_size: 100,
  mappings: {},
  configured: false,
  client_id_configured: false,
  client_secret_configured: false,
  refresh_token_configured: false,
  required_scope: 'ZOHOPEOPLE.attendance.ALL',
  employee_read_scope: 'ZOHOPEOPLE.forms.READ',
  employee_verified_at: '',
  employee_verify_matched_count: 0,
  mapping_count: 0,
  data_centers: {},
};

const DEFAULT_ZOHO_STATUS = {
  total_punches: 0,
  sent_count: 0,
  failed_count: 0,
  skipped_count: 0,
  pending_count: 0,
  recent_runs: [],
  last_run: null,
};

const EMPTY_HR_DATA = {
  profiles: {},
  leave_requests: [],
  assets: [],
  documents: [],
  performance: [],
};

function loadPrefs() {
  try {
    const saved = localStorage.getItem(PREF_KEY);
    if (saved) return { ...DEFAULTS, ...JSON.parse(saved) };
  } catch {
    // Keep defaults when localStorage is unavailable or corrupted.
  }
  return { ...DEFAULTS };
}

function savePrefsToStorage(prefs) {
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent('sorim:prefs-changed', { detail: prefs }));
}

function formatSyncInterval(seconds) {
  const value = Number(seconds) || 0;
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.round(value / 60)}m`;
  return `${Math.round(value / 3600)}h`;
}

function isOkStatus(value) {
  return value === 'online' || value === 'ok' || value === true;
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggleSlider" />
    </label>
  );
}

function SettingsCard({ icon: Icon, title, subtitle, tone = 'green', children, footer }) {
  return (
    <section className="settingsCard">
      <div className="settingsCardHeader">
        <div className={`settingsCardIcon settingsTone-${tone}`}>
          <Icon size={20} />
        </div>
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="settingsCardBody">
        {children}
        {footer && <div className="settingsCardFooter">{footer}</div>}
      </div>
    </section>
  );
}

function SettingRow({ label, description, children }) {
  return (
    <div className="settingRow">
      <div className="settingInfo">
        <span className="settingLabel">{label}</span>
        <span className="settingDesc">{description}</span>
      </div>
      <div className="settingControl">{children}</div>
    </div>
  );
}

function StatusCard({ icon: Icon, label, value, detail, tone = 'neutral' }) {
  return (
    <section className={`settingsStatusCard ${tone}`}>
      <div className="settingsStatusIcon">
        <Icon size={19} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </section>
  );
}

function ApiItem({ method, path, desc }) {
  return (
    <div className="apiItem">
      <span className={`apiMethod ${method.toLowerCase()}`}>{method}</span>
      <span className="apiPath">{path}</span>
      <span className="apiDesc">{desc}</span>
    </div>
  );
}

function SettingsModuleCard({ icon: Icon, title, metric, detail, to, tone = 'green' }) {
  return (
    <Link to={to} className="settingsModuleCard">
      <div className={`settingsModuleIcon settingsTone-${tone}`}>
        <Icon size={18} />
      </div>
      <div className="settingsModuleMeta">
        <span>{title}</span>
        <strong>{metric}</strong>
        <small>{detail}</small>
      </div>
    </Link>
  );
}

function countByStatus(records, statuses) {
  const statusSet = new Set(statuses.map((status) => status.toLowerCase()));
  return records.filter((record) => statusSet.has(String(record.status || '').toLowerCase())).length;
}

function uniqueEmployeeCount(records) {
  const ids = new Set();
  records.forEach((record) => {
    if (record.user_id) ids.add(String(record.user_id));
  });
  return ids.size;
}

function zohoErrorText(error) {
  if (!error) return '';
  if (error.response_text) {
    try {
      const parsed = JSON.parse(error.response_text);
      if (Array.isArray(parsed.skippedEmpInfo) && parsed.skippedEmpInfo.length) {
        return `Zoho skipped Employee IDs: ${parsed.skippedEmpInfo.slice(0, 12).join(', ')}${parsed.skippedEmpInfo.length > 12 ? '...' : ''}`;
      }
      const response = parsed.response || parsed;
      const nested = response.errors || {};
      return nested.message || response.message || error.error || 'Zoho sync failed';
    } catch {
      return error.response_text;
    }
  }
  return error.error || '';
}

export default function Settings() {
  const [autoSync, setAutoSync] = useState({ enabled: true, interval_seconds: 60 });
  const [health, setHealth] = useState(null);
  const [devices, setDevices] = useState([]);
  const [users, setUsers] = useState([]);
  const [hrData, setHrData] = useState(EMPTY_HR_DATA);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState('info');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [active, setActive] = useState('overview');
  const [emailConfig, setEmailConfig] = useState(DEFAULT_EMAIL);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailTesting, setEmailTesting] = useState(false);
  const [zohoConfig, setZohoConfig] = useState(DEFAULT_ZOHO);
  const [zohoStatus, setZohoStatus] = useState(DEFAULT_ZOHO_STATUS);
  const [zohoSaving, setZohoSaving] = useState(false);
  const [zohoTesting, setZohoTesting] = useState(false);
  const [zohoSyncing, setZohoSyncing] = useState(false);
  const [zohoVerifying, setZohoVerifying] = useState(false);
  const [zohoPreview, setZohoPreview] = useState(null);
  const [zohoVerify, setZohoVerify] = useState(null);
  const [zohoSyncForm, setZohoSyncForm] = useState({ from_time: '', to_time: '', limit: 200 });

  const sections = useMemo(
    () => [
      { key: 'overview', label: 'Overview', icon: SlidersHorizontal },
      { key: 'hrm', label: 'HRM', icon: BriefcaseBusiness },
      { key: 'sync', label: 'Auto-Sync', icon: Clock },
      { key: 'zoho', label: 'Zoho People', icon: Globe },
      { key: 'email', label: 'Email', icon: Mail },
      { key: 'system', label: 'System', icon: Info },
      { key: 'devices', label: 'Devices', icon: Server },
      { key: 'preferences', label: 'Preferences', icon: Palette },
      { key: 'security', label: 'Security', icon: Shield },
      { key: 'api', label: 'API', icon: HardDrive },
    ],
    [],
  );

  function showMessage(text, tone = 'info') {
    setMessage(text);
    setMessageTone(tone);
  }

  async function load() {
    setLoading(true);
    setMessage('');
    const calls = await Promise.allSettled([
      request('/api/auto-sync'),
      request('/api/health'),
      request('/api/devices'),
      request('/api/email/config'),
      request('/api/hr'),
      request('/api/users'),
      request('/api/zoho/config'),
      request('/api/zoho/status'),
    ]);

    const labels = ['auto-sync', 'health', 'devices', 'email', 'hrm', 'users', 'zoho config', 'zoho status'];
    const errors = [];

    calls.forEach((result, index) => {
      if (result.status === 'rejected') {
        errors.push(`${labels[index]}: ${result.reason.message}`);
      }
    });

    if (calls[0].status === 'fulfilled') setAutoSync(calls[0].value);
    if (calls[1].status === 'fulfilled') setHealth(calls[1].value);
    if (calls[2].status === 'fulfilled') setDevices(calls[2].value);
    if (calls[3].status === 'fulfilled') {
      setEmailConfig({ ...DEFAULT_EMAIL, ...calls[3].value, password: '' });
    }
    if (calls[4].status === 'fulfilled') {
      setHrData({ ...EMPTY_HR_DATA, ...calls[4].value });
    }
    if (calls[5].status === 'fulfilled') setUsers(calls[5].value);
    if (calls[6].status === 'fulfilled') setZohoConfig({ ...DEFAULT_ZOHO, ...calls[6].value, client_id: '', client_secret: '', refresh_token: '' });
    if (calls[7].status === 'fulfilled') {
      setZohoStatus({ ...DEFAULT_ZOHO_STATUS, ...calls[7].value });
      if (calls[7].value.config) {
        setZohoConfig((current) => ({ ...current, ...calls[7].value.config, client_id: '', client_secret: '', refresh_token: '' }));
      }
    }

    if (errors.length) {
      showMessage(`Some settings could not load. ${errors.join(' | ')}`, 'error');
    }
    setLoading(false);
  }

  async function saveAutoSync() {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        enabled: Boolean(autoSync.enabled),
        interval_seconds: Number(autoSync.interval_seconds) || 60,
      };
      const result = await request('/api/auto-sync', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setAutoSync(result);
      showMessage(`Auto-sync saved. Current interval: ${formatSyncInterval(result.interval_seconds)}.`, 'success');
    } catch (err) {
      showMessage(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function saveEmailConfig() {
    setEmailSaving(true);
    setMessage('');
    try {
      const payload = {
        ...emailConfig,
        host: String(emailConfig.host || '').trim(),
        user: String(emailConfig.user || '').trim(),
        from_email: String(emailConfig.from_email || '').trim(),
        to_email: String(emailConfig.to_email || '').trim(),
        cc_email: String(emailConfig.cc_email || '').trim(),
        bcc_email: String(emailConfig.bcc_email || '').trim(),
        port: Number(emailConfig.port) || 587,
        time: emailConfig.time || '23:30',
        enabled: Boolean(emailConfig.enabled),
        use_tls: Boolean(emailConfig.use_tls),
      };
      delete payload.password_configured;
      if (!payload.password) delete payload.password;

      const result = await request('/api/email/config', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setEmailConfig({ ...DEFAULT_EMAIL, ...result, password: '' });
      showMessage('Email settings saved.', 'success');
    } catch (err) {
      showMessage(err.message, 'error');
    } finally {
      setEmailSaving(false);
    }
  }

  async function sendTestEmail() {
    setEmailTesting(true);
    setMessage('');
    try {
      const result = await request('/api/email/test', { method: 'POST' });
      showMessage(result.message || 'Email test completed.', result.status === 'ok' ? 'success' : 'error');
    } catch (err) {
      showMessage(err.message, 'error');
    } finally {
      setEmailTesting(false);
    }
  }

  function zohoPayloadFromState() {
    const payload = {
      ...zohoConfig,
      client_id: String(zohoConfig.client_id || '').trim(),
      client_secret: String(zohoConfig.client_secret || '').trim(),
      refresh_token: String(zohoConfig.refresh_token || '').trim(),
      accounts_url: String(zohoConfig.accounts_url || '').trim(),
      people_url: String(zohoConfig.people_url || '').trim(),
      default_location: String(zohoConfig.default_location || '').trim(),
      default_building: String(zohoConfig.default_building || '').trim(),
      batch_size: Number(zohoConfig.batch_size) || 100,
      enabled: Boolean(zohoConfig.enabled),
      auto_push: Boolean(zohoConfig.auto_push),
      use_biometric_user_id_as_emp_id: Boolean(zohoConfig.use_biometric_user_id_as_emp_id),
      send_only_mapped_users: Boolean(zohoConfig.send_only_mapped_users),
    };
    delete payload.configured;
    delete payload.client_id_configured;
    delete payload.client_secret_configured;
    delete payload.refresh_token_configured;
    delete payload.access_token_configured;
    delete payload.access_token_expires_at;
    delete payload.employee_verified_at;
    delete payload.employee_verify_matched_count;
    delete payload.employee_verify_missing_count;
    delete payload.employee_verify_unmapped_count;
    delete payload.mapping_count;
    delete payload.data_centers;
    delete payload.required_scope;
    delete payload.employee_read_scope;
    return payload;
  }

  async function saveZohoConfig({ silent = false } = {}) {
    setZohoSaving(true);
    if (!silent) setMessage('');
    try {
      const result = await request('/api/zoho/config', {
        method: 'POST',
        body: JSON.stringify(zohoPayloadFromState()),
      });
      setZohoConfig({ ...DEFAULT_ZOHO, ...result, client_id: '', client_secret: '', refresh_token: '' });
      if (!silent) showMessage('Zoho People settings saved.', 'success');
      return result;
    } catch (err) {
      showMessage(err.message, 'error');
      return null;
    } finally {
      setZohoSaving(false);
    }
  }

  async function testZohoConnection() {
    setZohoTesting(true);
    setMessage('');
    try {
      const saved = await saveZohoConfig({ silent: true });
      if (!saved) return;
      const result = await request('/api/zoho/test', { method: 'POST' });
      showMessage(result.message || 'Zoho connection tested.', result.status === 'ok' ? 'success' : 'error');
    } catch (err) {
      showMessage(err.message, 'error');
    } finally {
      setZohoTesting(false);
    }
  }

  async function refreshZohoStatus() {
    try {
      const result = await request('/api/zoho/status');
      setZohoStatus({ ...DEFAULT_ZOHO_STATUS, ...result });
      if (result.config) setZohoConfig((current) => ({ ...current, ...result.config, client_id: '', client_secret: '', refresh_token: '' }));
    } catch (err) {
      showMessage(err.message, 'error');
    }
  }

  async function verifyZohoEmployees() {
    setZohoVerifying(true);
    setMessage('');
    try {
      const saved = await saveZohoConfig({ silent: true });
      if (!saved) return;
      const result = await request('/api/zoho/employees/verify');
      setZohoVerify(result);
      const missing = result.missing_count || 0;
      const unmapped = result.unmapped_count || 0;
      const tone = missing || unmapped ? 'info' : 'success';
      showMessage(`Zoho employee check: ${result.matched_count || 0} matched, ${missing} missing, ${unmapped} unmapped.`, tone);
    } catch (err) {
      const scope = zohoConfig.employee_read_scope || 'ZOHOPEOPLE.forms.READ';
      const message = String(err.message || '');
      const suffix = message.toLowerCase().includes('scope') ? ` Add ${scope} to the refresh token, then save and verify again.` : '';
      showMessage(`${message}${suffix}`, 'error');
    } finally {
      setZohoVerifying(false);
    }
  }

  async function previewZohoSync() {
    setZohoSyncing(true);
    setMessage('');
    try {
      const saved = await saveZohoConfig({ silent: true });
      if (!saved) return;
      const payload = {
        ...zohoSyncForm,
        limit: Number(zohoSyncForm.limit) || 200,
        dry_run: true,
      };
      if (!payload.from_time) delete payload.from_time;
      if (!payload.to_time) delete payload.to_time;
      const result = await request('/api/zoho/sync', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setZohoPreview(result);
      showMessage(`Zoho preview ready: ${result.ready_count} mapped, ${result.skipped_count} unmapped.`, result.skipped_count ? 'info' : 'success');
    } catch (err) {
      showMessage(err.message, 'error');
    } finally {
      setZohoSyncing(false);
    }
  }

  async function sendZohoSync() {
    if (!window.confirm('Send mapped biometric punches to Zoho People now?')) return;
    setZohoSyncing(true);
    setMessage('');
    try {
      const saved = await saveZohoConfig({ silent: true });
      if (!saved) return;
      const payload = {
        ...zohoSyncForm,
        limit: Number(zohoSyncForm.limit) || 200,
        dry_run: false,
      };
      if (!payload.from_time) delete payload.from_time;
      if (!payload.to_time) delete payload.to_time;
      const result = await request('/api/zoho/sync', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showMessage(result.message || `${result.sent_count} punches sent to Zoho People.`, result.status === 'ok' ? 'success' : 'info');
      setZohoPreview(null);
      await refreshZohoStatus();
    } catch (err) {
      showMessage(err.message, 'error');
      await refreshZohoStatus();
    } finally {
      setZohoSyncing(false);
    }
  }

  function updatePrefs(key, value) {
    setPrefs((current) => ({ ...current, [key]: value }));
  }

  function savePrefs() {
    try {
      savePrefsToStorage(prefs);
      showMessage('Preferences saved.', 'success');
    } catch (err) {
      showMessage(err.message, 'error');
    }
  }

  function resetPrefs() {
    if (!window.confirm('Reset all local preferences?')) return;
    setPrefs({ ...DEFAULTS });
    savePrefsToStorage({ ...DEFAULTS });
    showMessage('Preferences reset to defaults.', 'success');
  }

  function clearCache() {
    if (!window.confirm('Clear local settings and reload the app?')) return;
    localStorage.clear();
    window.location.reload();
  }

  function updateZohoConfig(key, value) {
    setZohoConfig((current) => {
      if (key === 'data_center') {
        const defaults = current.data_centers?.[value] || {};
        return {
          ...current,
          data_center: value,
          accounts_url: defaults.accounts_url || current.accounts_url,
          people_url: defaults.people_url || current.people_url,
        };
      }
      return { ...current, [key]: value };
    });
  }

  function updateZohoMapping(userId, key, value) {
    setZohoConfig((current) => {
      const existing = current.mappings?.[userId] || {};
      const next = {
        ...existing,
        biometric_user_id: userId,
        [key]: value,
      };
      if (key === 'zoho_employee_id' && value) next.active = true;
      return {
        ...current,
        mappings: {
          ...(current.mappings || {}),
          [userId]: next,
        },
      };
    });
  }

  useEffect(() => {
    load();
  }, []);

  const onlineDevices = devices.filter((device) => isOkStatus(device.status)).length;
  const emailReady = Boolean(emailConfig.from_email && emailConfig.to_email && emailConfig.password_configured);
  const employeeCount = uniqueEmployeeCount(users);
  const profileCount = Object.keys(hrData.profiles || {}).length;
  const leaveRecords = Array.isArray(hrData.leave_requests) ? hrData.leave_requests : [];
  const assetRecords = Array.isArray(hrData.assets) ? hrData.assets : [];
  const documentRecords = Array.isArray(hrData.documents) ? hrData.documents : [];
  const performanceRecords = Array.isArray(hrData.performance) ? hrData.performance : [];
  const pendingLeave = countByStatus(leaveRecords, ['Pending']);
  const assignedAssets = countByStatus(assetRecords, ['Assigned']);
  const pendingDocuments = countByStatus(documentRecords, ['Pending', 'Submitted', 'Expired']);
  const openReviews = performanceRecords.filter((record) => String(record.status || '').toLowerCase() !== 'closed').length;
  const profileCoverage = employeeCount ? Math.round((profileCount / employeeCount) * 100) : 0;
  const uniqueUsers = useMemo(() => {
    const byId = new Map();
    users.forEach((user) => {
      const id = String(user.user_id || '').trim();
      if (!id) return;
      const current = byId.get(id) || { user_id: id, name: '', devices: new Set() };
      if (!current.name && user.name) current.name = user.name;
      if (user.device_name) current.devices.add(user.device_name);
      byId.set(id, current);
    });
    return Array.from(byId.values())
      .map((user) => ({ ...user, devices: Array.from(user.devices) }))
      .sort((a, b) => (a.name || a.user_id).localeCompare(b.name || b.user_id));
  }, [users]);
  const mappedUsers = uniqueUsers.filter((user) => {
    const mapping = zohoConfig.mappings?.[user.user_id];
    return mapping?.active && mapping?.zoho_employee_id;
  }).length;
  const zohoReady = Boolean(zohoConfig.configured || (zohoConfig.client_id_configured && zohoConfig.client_secret_configured && zohoConfig.refresh_token_configured));
  const zohoMappingCoverage = uniqueUsers.length ? Math.round((mappedUsers / uniqueUsers.length) * 100) : 0;

  return (
    <div className="pageContainer settingsPage">
      <header className="pageHeader">
        <div>
          <h1>Settings</h1>
          <p>Configure attendance, HRM, reporting, devices, and local preferences</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}>
            <RefreshCw size={15} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      {message && <div className={`notice ${messageTone}`}>{message}</div>}

      <div className="settingsStatusGrid">
        <StatusCard
          icon={CheckCircle}
          label="System"
          value={health?.ok ? 'Healthy' : 'Checking'}
          detail={health?.database || 'Database path loading'}
          tone={health?.ok ? 'good' : 'neutral'}
        />
        <StatusCard
          icon={Clock}
          label="Auto-Sync"
          value={autoSync.enabled ? 'Enabled' : 'Disabled'}
          detail={`Every ${formatSyncInterval(autoSync.interval_seconds)}`}
          tone={autoSync.enabled ? 'good' : 'warn'}
        />
        <StatusCard
          icon={Mail}
          label="Email"
          value={emailConfig.enabled ? 'Scheduled' : 'Manual'}
          detail={emailReady ? `Daily ${emailConfig.time}` : 'Needs SMTP setup'}
          tone={emailReady ? 'good' : 'warn'}
        />
        <StatusCard
          icon={Server}
          label="Devices"
          value={`${onlineDevices}/${devices.length}`}
          detail="Online devices"
          tone={devices.length && onlineDevices === devices.length ? 'good' : 'neutral'}
        />
        <StatusCard
          icon={BriefcaseBusiness}
          label="HRM"
          value={`${profileCount}/${employeeCount || profileCount}`}
          detail={employeeCount ? `${profileCoverage}% profile coverage` : 'Employee records loading'}
          tone={profileCount && (!employeeCount || profileCoverage >= 75) ? 'good' : 'warn'}
        />
        <StatusCard
          icon={Globe}
          label="Zoho People"
          value={zohoConfig.enabled ? 'Enabled' : 'Off'}
          detail={zohoReady ? `${zohoStatus.sent_count || 0} sent, ${zohoStatus.pending_count || 0} pending` : 'OAuth not configured'}
          tone={zohoConfig.enabled && zohoReady ? 'good' : 'warn'}
        />
      </div>

      <div className="settingsLayout">
        <nav className="settingsNav" aria-label="Settings sections">
          {sections.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`settingsNavItem ${active === key ? 'active' : ''}`}
              onClick={() => setActive(key)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="settingsContent">
          {active === 'overview' && (
            <>
              <SettingsCard icon={SlidersHorizontal} title="Overview" subtitle="Current configuration at a glance">
                <div className="settingsOverviewGrid">
                  <div className="infoItem">
                    <span className="infoLabel">Email Recipients</span>
                    <span className="infoValue">{emailConfig.to_email || 'Not configured'}</span>
                  </div>
                  <div className="infoItem">
                    <span className="infoLabel">Report Time</span>
                    <span className="infoValue">{emailConfig.time || '23:30'}</span>
                  </div>
                  <div className="infoItem">
                    <span className="infoLabel">Sync Interval</span>
                    <span className="infoValue">{formatSyncInterval(autoSync.interval_seconds)}</span>
                  </div>
                  <div className="infoItem">
                    <span className="infoLabel">Default Page</span>
                    <span className="infoValue">{prefs.defaultPage}</span>
                  </div>
                  <div className="infoItem">
                    <span className="infoLabel">Employees</span>
                    <span className="infoValue">{employeeCount || profileCount}</span>
                  </div>
                  <div className="infoItem">
                    <span className="infoLabel">HR Profile Coverage</span>
                    <span className="infoValue">{employeeCount ? `${profileCoverage}%` : `${profileCount} profiles`}</span>
                  </div>
                  <div className="infoItem">
                    <span className="infoLabel">Open Leave</span>
                    <span className="infoValue">{pendingLeave}</span>
                  </div>
                  <div className="infoItem">
                    <span className="infoLabel">Pending Documents</span>
                    <span className="infoValue">{pendingDocuments}</span>
                  </div>
                </div>
              </SettingsCard>
              <SettingsCard icon={Info} title="Quick Checks" subtitle="Useful checks before daily report automation" tone="blue">
                <div className="settingsChecklist">
                  <span className={emailReady ? 'done' : 'warn'}>
                    {emailReady ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
                    SMTP account, sender, recipients, and password
                  </span>
                  <span className={emailConfig.enabled ? 'done' : 'warn'}>
                    {emailConfig.enabled ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
                    Daily email scheduler
                  </span>
                  <span className={devices.length ? 'done' : 'warn'}>
                    {devices.length ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
                    Device configuration loaded
                  </span>
                  <span className={autoSync.enabled ? 'done' : 'warn'}>
                    {autoSync.enabled ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
                    Auto-sync status
                  </span>
                  <span className={profileCount ? 'done' : 'warn'}>
                    {profileCount ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
                    Employee HR profile records
                  </span>
                  <span className={pendingDocuments ? 'warn' : 'done'}>
                    {pendingDocuments ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}
                    Document verification queue
                  </span>
                </div>
              </SettingsCard>
            </>
          )}

          {active === 'hrm' && (
            <>
              <SettingsCard
                icon={BriefcaseBusiness}
                title="HRM Workspace"
                subtitle="Employee data, requests, compliance, assets, reviews, and payroll"
              >
                <div className="settingsModuleGrid">
                  <SettingsModuleCard
                    icon={UserRound}
                    title="Employees"
                    metric={employeeCount ? `${profileCoverage}%` : profileCount}
                    detail={employeeCount ? `${profileCount}/${employeeCount} profiles` : 'Profiles saved'}
                    to="/employees"
                  />
                  <SettingsModuleCard
                    icon={CalendarCheck}
                    title="Leave"
                    metric={pendingLeave}
                    detail={`${leaveRecords.length} total requests`}
                    to="/leave"
                    tone="blue"
                  />
                  <SettingsModuleCard
                    icon={Laptop}
                    title="Assets"
                    metric={assignedAssets}
                    detail={`${assetRecords.length} tracked assets`}
                    to="/assets"
                    tone="purple"
                  />
                  <SettingsModuleCard
                    icon={FileText}
                    title="Documents"
                    metric={pendingDocuments}
                    detail={`${documentRecords.length} document records`}
                    to="/documents"
                    tone="yellow"
                  />
                  <SettingsModuleCard
                    icon={Target}
                    title="Performance"
                    metric={openReviews}
                    detail={`${performanceRecords.length} review records`}
                    to="/performance"
                    tone="red"
                  />
                  <SettingsModuleCard
                    icon={Database}
                    title="Payroll"
                    metric={prefs.payrollCurrency}
                    detail={`${prefs.fullDayHours}h full day`}
                    to="/payroll"
                    tone="green"
                  />
                </div>
              </SettingsCard>

              <SettingsCard
                icon={Clock}
                title="Work & Payroll Defaults"
                subtitle="Shift, overtime, leave, payroll, and reminder defaults"
                tone="blue"
                footer={
                  <div className="settingsFooterActions">
                    <button type="button" onClick={savePrefs}><Save size={15} /> Save HR Defaults</button>
                    <button type="button" className="btnSecondary" onClick={resetPrefs}>Reset</button>
                  </div>
                }
              >
                <div className="formGrid settingsFormGrid">
                  <label>
                    <span>Shift Start</span>
                    <input type="time" value={prefs.workStart} onChange={(event) => updatePrefs('workStart', event.target.value)} />
                  </label>
                  <label>
                    <span>Shift End</span>
                    <input type="time" value={prefs.workEnd} onChange={(event) => updatePrefs('workEnd', event.target.value)} />
                  </label>
                  <label>
                    <span>Full Day Hours</span>
                    <input type="number" min="1" step="0.25" value={prefs.fullDayHours} onChange={(event) => updatePrefs('fullDayHours', event.target.value)} />
                  </label>
                  <label>
                    <span>Half Day Hours</span>
                    <input type="number" min="1" step="0.25" value={prefs.halfDayHours} onChange={(event) => updatePrefs('halfDayHours', event.target.value)} />
                  </label>
                  <label>
                    <span>Overtime After</span>
                    <input type="number" min="1" step="0.25" value={prefs.overtimeAfter} onChange={(event) => updatePrefs('overtimeAfter', event.target.value)} />
                  </label>
                  <label>
                    <span>Late Grace Minutes</span>
                    <input type="number" min="0" step="1" value={prefs.lateGraceMinutes} onChange={(event) => updatePrefs('lateGraceMinutes', event.target.value)} />
                  </label>
                  <label>
                    <span>Annual Leave Quota</span>
                    <input type="number" min="0" step="0.5" value={prefs.annualLeaveQuota} onChange={(event) => updatePrefs('annualLeaveQuota', event.target.value)} />
                  </label>
                  <label>
                    <span>Payroll Currency</span>
                    <select value={prefs.payrollCurrency} onChange={(event) => updatePrefs('payrollCurrency', event.target.value)}>
                      <option value="INR">INR</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                    </select>
                  </label>
                  <label>
                    <span>Document Reminder Days</span>
                    <input type="number" min="1" step="1" value={prefs.documentReminderDays} onChange={(event) => updatePrefs('documentReminderDays', event.target.value)} />
                  </label>
                  <label>
                    <span>Asset Audit Cycle</span>
                    <select value={prefs.assetAuditCycle} onChange={(event) => updatePrefs('assetAuditCycle', event.target.value)}>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="half-yearly">Half-Yearly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </label>
                </div>
              </SettingsCard>

              <SettingsCard icon={Info} title="HR Queue" subtitle="Current HR items that need attention" tone="yellow">
                <div className="settingsChecklist">
                  <span className={pendingLeave ? 'warn' : 'done'}>
                    {pendingLeave ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}
                    {pendingLeave} pending leave request(s)
                  </span>
                  <span className={pendingDocuments ? 'warn' : 'done'}>
                    {pendingDocuments ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}
                    {pendingDocuments} document item(s)
                  </span>
                  <span className={openReviews ? 'warn' : 'done'}>
                    {openReviews ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}
                    {openReviews} open performance review(s)
                  </span>
                  <span className={employeeCount && profileCoverage < 75 ? 'warn' : 'done'}>
                    {employeeCount && profileCoverage < 75 ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}
                    {employeeCount ? `${profileCoverage}% profile coverage` : `${profileCount} profile record(s)`}
                  </span>
                </div>
              </SettingsCard>
            </>
          )}

          {active === 'sync' && (
            <SettingsCard
              icon={Clock}
              title="Auto-Sync"
              subtitle="Automatically pull attendance data from enabled devices"
              footer={
                <button type="button" onClick={saveAutoSync} disabled={saving}>
                  <Save size={15} />
                  {saving ? 'Saving...' : 'Save Auto-Sync'}
                </button>
              }
            >
              <SettingRow label="Enable Auto-Sync" description="Run sync in the background on this backend server">
                <Toggle
                  label="Enable Auto-Sync"
                  checked={Boolean(autoSync.enabled)}
                  onChange={(checked) => setAutoSync((current) => ({ ...current, enabled: checked }))}
                />
              </SettingRow>
              <SettingRow label="Sync Interval" description="How often the backend checks all enabled devices">
                <select
                  value={autoSync.interval_seconds}
                  onChange={(event) => setAutoSync((current) => ({ ...current, interval_seconds: Number(event.target.value) }))}
                >
                  <option value={15}>15 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>1 minute</option>
                  <option value={120}>2 minutes</option>
                  <option value={300}>5 minutes</option>
                  <option value={600}>10 minutes</option>
                  <option value={1800}>30 minutes</option>
                  <option value={3600}>1 hour</option>
                </select>
              </SettingRow>
            </SettingsCard>
          )}

          {active === 'zoho' && (
            <>
              <SettingsCard
                icon={Globe}
                title="Zoho People Sync"
                subtitle="Map biometric punches to existing Zoho People employees"
                tone="blue"
                footer={
                  <div className="settingsFooterActions">
                    <button type="button" onClick={() => saveZohoConfig()} disabled={zohoSaving}>
                      <Save size={15} />
                      {zohoSaving ? 'Saving...' : 'Save Zoho'}
                    </button>
                    <button type="button" className="btnSecondary" onClick={testZohoConnection} disabled={zohoTesting || zohoSaving}>
                      <Send size={15} />
                      {zohoTesting ? 'Testing...' : 'Test OAuth'}
                    </button>
                  </div>
                }
              >
                <SettingRow label="Enable Zoho Sync" description="Allow this backend to send mapped punches to Zoho People">
                  <Toggle
                    label="Enable Zoho sync"
                    checked={Boolean(zohoConfig.enabled)}
                    onChange={(checked) => updateZohoConfig('enabled', checked)}
                  />
                </SettingRow>
                <SettingRow label="Auto-Push After Device Sync" description="Send new mapped punches after the background biometric sync runs">
                  <Toggle
                    label="Auto-push Zoho punches"
                    checked={Boolean(zohoConfig.auto_push)}
                    onChange={(checked) => updateZohoConfig('auto_push', checked)}
                  />
                </SettingRow>
                <SettingRow label="Biometric ID Equals Zoho Employee ID" description="Use this only when your device user ID exactly matches Zoho Employee ID">
                  <Toggle
                    label="Use biometric ID as Zoho Employee ID"
                    checked={Boolean(zohoConfig.use_biometric_user_id_as_emp_id)}
                    onChange={(checked) => updateZohoConfig('use_biometric_user_id_as_emp_id', checked)}
                  />
                </SettingRow>
                <SettingRow label="Only Send Saved Mappings" description="When enabled, Send to Zoho ignores unmapped biometric users">
                  <Toggle
                    label="Only send saved Zoho mappings"
                    checked={zohoConfig.send_only_mapped_users !== false}
                    onChange={(checked) => updateZohoConfig('send_only_mapped_users', checked)}
                  />
                </SettingRow>
                <div className="formGrid settingsFormGrid">
                  <label>
                    <span>Data Center</span>
                    <select value={zohoConfig.data_center} onChange={(event) => updateZohoConfig('data_center', event.target.value)}>
                      <option value="in">India</option>
                      <option value="us">United States</option>
                      <option value="eu">Europe</option>
                      <option value="au">Australia</option>
                      <option value="jp">Japan</option>
                      <option value="cn">China</option>
                    </select>
                  </label>
                  <label>
                    <span>Accounts URL</span>
                    <input value={zohoConfig.accounts_url || ''} onChange={(event) => updateZohoConfig('accounts_url', event.target.value)} />
                  </label>
                  <label>
                    <span>People URL</span>
                    <input value={zohoConfig.people_url || ''} onChange={(event) => updateZohoConfig('people_url', event.target.value)} />
                  </label>
                  <label>
                    <span>Batch Size</span>
                    <input
                      type="number"
                      min="1"
                      max="200"
                      value={zohoConfig.batch_size}
                      onChange={(event) => updateZohoConfig('batch_size', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Client ID</span>
                    <input
                      value={zohoConfig.client_id || ''}
                      placeholder={zohoConfig.client_id_configured ? 'Saved client ID' : 'Zoho client ID'}
                      onChange={(event) => updateZohoConfig('client_id', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Client Secret</span>
                    <input
                      type="password"
                      value={zohoConfig.client_secret || ''}
                      placeholder={zohoConfig.client_secret_configured ? 'Saved client secret' : 'Zoho client secret'}
                      onChange={(event) => updateZohoConfig('client_secret', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Refresh Token</span>
                    <input
                      type="password"
                      value={zohoConfig.refresh_token || ''}
                      placeholder={zohoConfig.refresh_token_configured ? 'Saved refresh token' : 'Zoho refresh token'}
                      onChange={(event) => updateZohoConfig('refresh_token', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Location</span>
                    <input value={zohoConfig.default_location || ''} onChange={(event) => updateZohoConfig('default_location', event.target.value)} />
                  </label>
                  <label>
                    <span>Building</span>
                    <input value={zohoConfig.default_building || ''} onChange={(event) => updateZohoConfig('default_building', event.target.value)} />
                  </label>
                </div>
                <div className="settingsInlineStatus">
                  <span className={zohoReady ? 'statusOk' : 'statusWarn'}>
                    {zohoReady ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                    {zohoReady ? 'OAuth credentials saved' : 'Client ID, client secret, and refresh token required'}
                  </span>
                  <span className="settingsScopeText">Required scope: {zohoConfig.required_scope || 'ZOHOPEOPLE.attendance.ALL'}</span>
                  <span className="settingsScopeText">Verify scope: {zohoConfig.employee_read_scope || 'ZOHOPEOPLE.forms.READ'}</span>
                  <span className={zohoConfig.employee_verified_at ? 'statusOk' : 'statusWarn'}>
                    {zohoConfig.employee_verified_at ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                    {zohoConfig.employee_verified_at
                      ? `Employee IDs verified: ${zohoConfig.employee_verify_matched_count || 0} matched`
                      : 'Auto-push waits for Verify IDs'}
                  </span>
                </div>
              </SettingsCard>

              <SettingsCard
                icon={UserRound}
                title="Employee Mapping"
                subtitle="Connect biometric user IDs to existing Zoho Employee IDs"
                footer={
                  <div className="settingsFooterActions">
                    <button type="button" className="btnSecondary" onClick={verifyZohoEmployees} disabled={zohoVerifying || zohoSaving || !zohoReady}>
                      <Target size={15} />
                      {zohoVerifying ? 'Checking...' : 'Verify IDs'}
                    </button>
                    <button type="button" onClick={() => saveZohoConfig()} disabled={zohoSaving}>
                      <Save size={15} />
                      {zohoSaving ? 'Saving...' : 'Save Mappings'}
                    </button>
                  </div>
                }
              >
                <div className="zohoMappingSummary">
                  <span>{mappedUsers}/{uniqueUsers.length} mapped</span>
                  <strong>{zohoMappingCoverage}%</strong>
                </div>
                {zohoVerify && (
                  <div className="zohoVerifyPanel">
                    <div className="zohoVerifyStats">
                      <span><strong>{zohoVerify.matched_count || 0}</strong> matched</span>
                      <span><strong>{zohoVerify.missing_count || 0}</strong> missing</span>
                      <span><strong>{zohoVerify.unmapped_count || 0}</strong> unmapped</span>
                      <span><strong>{zohoVerify.zoho_employee_count || 0}</strong> in Zoho</span>
                    </div>
                    {(zohoVerify.items || [])
                      .filter((item) => item.status !== 'matched')
                      .slice(0, 8)
                      .map((item) => (
                        <div className={`zohoVerifyRow ${item.status}`} key={`verify-${item.user_id}`}>
                          <span>{item.user_name || item.user_id}</span>
                          <small>{item.status} · {item.expected_employee_id || 'No Employee ID'} · {item.mapping_source}</small>
                        </div>
                      ))}
                    {(zohoVerify.items || []).filter((item) => item.status !== 'matched').length > 8 && (
                      <p className="settingsNote">
                        Showing 8 of {(zohoVerify.items || []).filter((item) => item.status !== 'matched').length} IDs that need attention.
                      </p>
                    )}
                  </div>
                )}
                <div className="zohoMappingList">
                  {uniqueUsers.map((user) => {
                    const mapping = zohoConfig.mappings?.[user.user_id] || {};
                    return (
                      <div className="zohoMappingRow" key={user.user_id}>
                        <div className="zohoMappingUser">
                          <strong>{user.name || `User ${user.user_id}`}</strong>
                          <small>{user.user_id} · {user.devices.join(', ') || 'No device'}</small>
                        </div>
                        <input
                          value={mapping.zoho_employee_id || ''}
                          placeholder="Zoho Employee ID"
                          onChange={(event) => updateZohoMapping(user.user_id, 'zoho_employee_id', event.target.value)}
                        />
                        <Toggle
                          label={`Enable Zoho mapping for ${user.user_id}`}
                          checked={Boolean(mapping.active && mapping.zoho_employee_id)}
                          onChange={(checked) => updateZohoMapping(user.user_id, 'active', checked)}
                        />
                      </div>
                    );
                  })}
                  {!uniqueUsers.length && <p className="emptyText">Sync devices first so local biometric users can be mapped.</p>}
                </div>
              </SettingsCard>

              <SettingsCard
                icon={Send}
                title="Send Punches"
                subtitle="Preview and send unsent mapped attendance punches to Zoho People"
                tone="green"
                footer={
                  <div className="settingsFooterActions">
                    <button type="button" className="btnSecondary" onClick={previewZohoSync} disabled={zohoSyncing}>
                      <RefreshCw size={15} />
                      {zohoSyncing ? 'Checking...' : 'Preview'}
                    </button>
                    <button type="button" onClick={sendZohoSync} disabled={zohoSyncing || !zohoReady}>
                      <Send size={15} />
                      {zohoSyncing ? 'Sending...' : 'Send to Zoho'}
                    </button>
                  </div>
                }
              >
                <div className="settingsOverviewGrid">
                  <div className="infoItem"><span className="infoLabel">Sent</span><span className="infoValue">{zohoStatus.sent_count || 0}</span></div>
                  <div className="infoItem"><span className="infoLabel">Pending</span><span className="infoValue">{zohoStatus.pending_count || 0}</span></div>
                  <div className="infoItem"><span className="infoLabel">Failed</span><span className="infoValue">{zohoStatus.failed_count || 0}</span></div>
                  <div className="infoItem"><span className="infoLabel">Last Run</span><span className="infoValue">{zohoStatus.last_run?.status || 'No run yet'}</span></div>
                </div>
                {zohoStatus.last_error && (
                  <div className="settingsInlineStatus zohoErrorBox">
                    <span className="statusError">
                      <AlertTriangle size={14} />
                      {zohoErrorText(zohoStatus.last_error)}
                    </span>
                  </div>
                )}
                <div className="formGrid settingsFormGrid">
                  <label>
                    <span>From Time</span>
                    <input
                      type="datetime-local"
                      value={zohoSyncForm.from_time}
                      onChange={(event) => setZohoSyncForm((current) => ({ ...current, from_time: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>To Time</span>
                    <input
                      type="datetime-local"
                      value={zohoSyncForm.to_time}
                      onChange={(event) => setZohoSyncForm((current) => ({ ...current, to_time: event.target.value }))}
                    />
                  </label>
                  <label>
                    <span>Limit</span>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={zohoSyncForm.limit}
                      onChange={(event) => setZohoSyncForm((current) => ({ ...current, limit: event.target.value }))}
                    />
                  </label>
                </div>
                {zohoPreview && (
                  <div className="zohoPreviewList">
                    <div className="zohoPreviewHeader">
                      <strong>{zohoPreview.ready_count} ready</strong>
                      <span>{zohoPreview.skipped_count} unmapped</span>
                    </div>
                    {zohoPreview.items.slice(0, 8).map((item) => (
                      <div className="zohoPreviewRow" key={item.punch_id}>
                        <span>{item.user_name || item.user_id}</span>
                        <small>{item.direction} · {item.zoho_employee_id} · {item.punch_time}</small>
                      </div>
                    ))}
                    {zohoPreview.items.length > 8 && <p className="settingsNote">Showing 8 of {zohoPreview.items.length} ready punches.</p>}
                    {zohoPreview.skipped.slice(0, 5).map((item) => (
                      <div className="zohoPreviewRow warn" key={`skip-${item.punch_id}`}>
                        <span>{item.user_name || item.user_id}</span>
                        <small>{item.reason}</small>
                      </div>
                    ))}
                  </div>
                )}
              </SettingsCard>
            </>
          )}

          {active === 'email' && (
            <SettingsCard
              icon={Mail}
              title="Email Reports"
              subtitle="SMTP settings for the daily attendance report"
              footer={
                <div className="settingsFooterActions">
                  <button type="button" onClick={saveEmailConfig} disabled={emailSaving}>
                    <Save size={15} />
                    {emailSaving ? 'Saving...' : 'Save Email'}
                  </button>
                  <button type="button" className="btnSecondary" onClick={sendTestEmail} disabled={emailTesting}>
                    <Send size={15} />
                    {emailTesting ? 'Sending...' : 'Send Test'}
                  </button>
                </div>
              }
            >
              <SettingRow label="Daily Schedule" description="Send the report automatically at the configured time">
                <Toggle
                  label="Daily email schedule"
                  checked={Boolean(emailConfig.enabled)}
                  onChange={(checked) => setEmailConfig((current) => ({ ...current, enabled: checked }))}
                />
              </SettingRow>
              <div className="formGrid settingsFormGrid">
                <label>
                  <span>SMTP Server</span>
                  <input
                    value={emailConfig.host}
                    onChange={(event) => setEmailConfig((current) => ({ ...current, host: event.target.value }))}
                  />
                </label>
                <label>
                  <span>SMTP Port</span>
                  <input
                    type="number"
                    min="1"
                    value={emailConfig.port}
                    onChange={(event) => setEmailConfig((current) => ({ ...current, port: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Username</span>
                  <input
                    value={emailConfig.user}
                    onChange={(event) => {
                      const value = event.target.value;
                      setEmailConfig((current) => ({
                        ...current,
                        user: value,
                        from_email: current.from_email || value,
                      }));
                    }}
                  />
                </label>
                <label>
                  <span>App Password</span>
                  <input
                    type="password"
                    value={emailConfig.password}
                    placeholder={emailConfig.password_configured ? 'Saved app password' : 'Gmail app password'}
                    onChange={(event) => setEmailConfig((current) => ({ ...current, password: event.target.value }))}
                  />
                </label>
                <label>
                  <span>From Email</span>
                  <input
                    value={emailConfig.from_email}
                    onChange={(event) => setEmailConfig((current) => ({ ...current, from_email: event.target.value }))}
                  />
                </label>
                <label>
                  <span>To Email</span>
                  <input
                    value={emailConfig.to_email}
                    placeholder="email1@example.com, email2@example.com"
                    onChange={(event) => setEmailConfig((current) => ({ ...current, to_email: event.target.value }))}
                  />
                </label>
                <label>
                  <span>CC Email</span>
                  <input
                    value={emailConfig.cc_email || ''}
                    placeholder="cc1@example.com, cc2@example.com"
                    onChange={(event) => setEmailConfig((current) => ({ ...current, cc_email: event.target.value }))}
                  />
                </label>
                <label>
                  <span>BCC Email</span>
                  <input
                    value={emailConfig.bcc_email || ''}
                    placeholder="bcc1@example.com, bcc2@example.com"
                    onChange={(event) => setEmailConfig((current) => ({ ...current, bcc_email: event.target.value }))}
                  />
                </label>
                <label>
                  <span>Report Time</span>
                  <input
                    type="time"
                    value={emailConfig.time}
                    onChange={(event) => setEmailConfig((current) => ({ ...current, time: event.target.value }))}
                  />
                </label>
              </div>
              <SettingRow label="TLS" description="Use STARTTLS for SMTP servers like Gmail">
                <Toggle
                  label="Use TLS"
                  checked={Boolean(emailConfig.use_tls)}
                  onChange={(checked) => setEmailConfig((current) => ({ ...current, use_tls: checked }))}
                />
              </SettingRow>
              <div className="settingsInlineStatus">
                <span className={emailConfig.password_configured ? 'statusOk' : 'statusWarn'}>
                  {emailConfig.password_configured ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                  {emailConfig.password_configured ? 'Password saved' : 'Password not saved'}
                </span>
              </div>
            </SettingsCard>
          )}

          {active === 'system' && (
            <SettingsCard icon={Info} title="System Information" subtitle="Current backend and database status" tone="blue">
              <div className="infoGrid">
                <div className="infoItem"><span className="infoLabel">Application</span><span className="infoValue">Sorim CRM</span></div>
                <div className="infoItem"><span className="infoLabel">Version</span><span className="infoValue">1.0.0</span></div>
                <div className="infoItem"><span className="infoLabel">Database</span><span className="infoValue mono">{health?.database || 'Loading...'}</span></div>
                <div className="infoItem"><span className="infoLabel">Status</span><span className="infoValue">{health?.ok ? <span className="statusOk"><CheckCircle size={14} /> Healthy</span> : <span className="statusError"><AlertTriangle size={14} /> Error</span>}</span></div>
                <div className="infoItem"><span className="infoLabel">Total Devices</span><span className="infoValue">{devices.length}</span></div>
                <div className="infoItem"><span className="infoLabel">Employees</span><span className="infoValue">{employeeCount || profileCount}</span></div>
                <div className="infoItem"><span className="infoLabel">HR Records</span><span className="infoValue">{leaveRecords.length + assetRecords.length + documentRecords.length + performanceRecords.length + profileCount}</span></div>
                <div className="infoItem"><span className="infoLabel">Auto-Sync</span><span className="infoValue">{autoSync.enabled ? <span className="statusOk">Active ({formatSyncInterval(autoSync.interval_seconds)})</span> : <span className="statusWarn">Disabled</span>}</span></div>
              </div>
            </SettingsCard>
          )}

          {active === 'devices' && (
            <SettingsCard icon={Server} title="Device Configuration" subtitle="Configured biometric devices and live status">
              <div className="settingsDeviceList">
                {devices.map((device) => (
                  <div key={device.id} className="settingsDeviceRow">
                    <div className="settingsDeviceInfo">
                      <div className="settingsDeviceIcon"><Server size={16} /></div>
                      <div>
                        <strong>{device.name}</strong>
                        <small>{device.ip}:{device.port}</small>
                      </div>
                    </div>
                    <div className="settingsDeviceMeta">
                      <span className={`statusBadge ${device.status}`}>{device.status}</span>
                      <small>{device.location || 'No location'}</small>
                    </div>
                  </div>
                ))}
                {!devices.length && <p className="emptyText">No devices configured.</p>}
              </div>
              <p className="settingsNote">To add or modify devices, edit <code>devices.json</code> in the project root.</p>
            </SettingsCard>
          )}

          {active === 'preferences' && (
            <>
              <SettingsCard
                icon={Palette}
                title="Appearance"
                subtitle="Local display preferences for this browser"
                tone="purple"
              >
                <SettingRow label="Theme" description="Choose how the interface should render on this browser">
                  <select value={prefs.theme} onChange={(event) => updatePrefs('theme', event.target.value)}>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="auto">Auto</option>
                  </select>
                </SettingRow>
                <SettingRow label="Accent Color" description="Primary action color used by the app shell">
                  <select value={prefs.accent} onChange={(event) => updatePrefs('accent', event.target.value)}>
                    <option value="green">Green</option>
                    <option value="blue">Blue</option>
                    <option value="purple">Purple</option>
                    <option value="red">Red</option>
                    <option value="orange">Orange</option>
                  </select>
                </SettingRow>
                <SettingRow label="Compact Sidebar" description="Collapse the sidebar labels on desktop">
                  <Toggle
                    label="Compact sidebar"
                    checked={prefs.compactSidebar === 'true'}
                    onChange={(checked) => updatePrefs('compactSidebar', String(checked))}
                  />
                </SettingRow>
              </SettingsCard>

              <SettingsCard icon={Globe} title="Localization" subtitle="Local time and date display preferences" tone="yellow">
                <div className="formGrid settingsFormGrid">
                  <label>
                    <span>Language</span>
                    <select value={prefs.language} onChange={(event) => updatePrefs('language', event.target.value)}>
                      <option value="en">English</option>
                      <option value="hi">Hindi</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                    </select>
                  </label>
                  <label>
                    <span>Timezone</span>
                    <select value={prefs.timezone} onChange={(event) => updatePrefs('timezone', event.target.value)}>
                      <option value="Asia/Kolkata">Asia/Kolkata</option>
                      <option value="UTC">UTC</option>
                      <option value="America/New_York">America/New_York</option>
                      <option value="Europe/London">Europe/London</option>
                    </select>
                  </label>
                  <label>
                    <span>Time Format</span>
                    <select value={prefs.timeFormat} onChange={(event) => updatePrefs('timeFormat', event.target.value)}>
                      <option value="24h">24-hour</option>
                      <option value="12h">12-hour</option>
                    </select>
                  </label>
                  <label>
                    <span>Date Format</span>
                    <select value={prefs.dateFormat} onChange={(event) => updatePrefs('dateFormat', event.target.value)}>
                      <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                      <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                      <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    </select>
                  </label>
                </div>
              </SettingsCard>

              <SettingsCard
                icon={Database}
                title="Data & Notifications"
                subtitle="Local defaults and notification switches"
                tone="red"
                footer={
                  <div className="settingsFooterActions">
                    <button type="button" onClick={savePrefs}><Save size={15} /> Save Preferences</button>
                    <button type="button" className="btnSecondary" onClick={resetPrefs}>Reset</button>
                  </div>
                }
              >
                <div className="formGrid settingsFormGrid">
                  <label>
                    <span>Default Page</span>
                    <select value={prefs.defaultPage} onChange={(event) => updatePrefs('defaultPage', event.target.value)}>
                      <option value="dashboard">Dashboard</option>
                      <option value="attendance">Attendance</option>
                      <option value="devices">Devices</option>
                      <option value="users">Users</option>
                      <option value="punches">Punches</option>
                      <option value="employees">Employees</option>
                      <option value="leave">Leave</option>
                      <option value="assets">Assets</option>
                      <option value="documents">Documents</option>
                      <option value="performance">Performance</option>
                      <option value="reports">Reports</option>
                      <option value="exceptions">Exceptions</option>
                      <option value="payroll">Payroll</option>
                      <option value="analytics">Analytics</option>
                    </select>
                  </label>
                  <label>
                    <span>Rows Per Page</span>
                    <select value={prefs.rowsPerPage} onChange={(event) => updatePrefs('rowsPerPage', event.target.value)}>
                      <option value="25">25</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                      <option value="200">200</option>
                    </select>
                  </label>
                  <label>
                    <span>Default Date Range</span>
                    <select value={prefs.defaultDateRange} onChange={(event) => updatePrefs('defaultDateRange', event.target.value)}>
                      <option value="1">Today</option>
                      <option value="7">Last 7 days</option>
                      <option value="14">Last 14 days</option>
                      <option value="30">Last 30 days</option>
                    </select>
                  </label>
                </div>
                <SettingRow label="New Punch Alert" description="Save local preference for new-punch notifications">
                  <Toggle label="New punch alert" checked={prefs.notifyNewPunch === 'true'} onChange={(checked) => updatePrefs('notifyNewPunch', String(checked))} />
                </SettingRow>
                <SettingRow label="Device Offline" description="Save local preference for offline-device notifications">
                  <Toggle label="Device offline notification" checked={prefs.notifyDeviceOffline === 'true'} onChange={(checked) => updatePrefs('notifyDeviceOffline', String(checked))} />
                </SettingRow>
                <SettingRow label="Daily Report" description="Save local preference for report notifications">
                  <Toggle label="Daily report notification" checked={prefs.notifyDailyReport === 'true'} onChange={(checked) => updatePrefs('notifyDailyReport', String(checked))} />
                </SettingRow>
              </SettingsCard>
            </>
          )}

          {active === 'security' && (
            <SettingsCard icon={Shield} title="Security" subtitle="Local browser data controls" tone="green">
              <SettingRow label="Clear Local Cache" description="Remove browser preferences and reload the app">
                <button type="button" className="btnDanger" onClick={clearCache}>
                  <Trash2 size={14} />
                  Clear Cache
                </button>
              </SettingRow>
            </SettingsCard>
          )}

          {active === 'api' && (
            <SettingsCard icon={HardDrive} title="API Reference" subtitle="Settings-related backend endpoints" tone="yellow">
              <div className="apiList">
                <ApiItem method="GET" path="/api/health" desc="System health check" />
                <ApiItem method="GET" path="/api/devices" desc="List configured devices" />
                <ApiItem method="GET" path="/api/auto-sync" desc="Get auto-sync settings" />
                <ApiItem method="POST" path="/api/auto-sync" desc="Update auto-sync settings" />
                <ApiItem method="GET" path="/api/email/config" desc="Get public email settings" />
                <ApiItem method="POST" path="/api/email/config" desc="Save email settings" />
                <ApiItem method="POST" path="/api/email/test" desc="Send a test attendance report" />
                <ApiItem method="POST" path="/api/email/send" desc="Send report for a selected date" />
                <ApiItem method="GET" path="/api/zoho/config" desc="Get public Zoho People settings" />
                <ApiItem method="POST" path="/api/zoho/config" desc="Save Zoho People credentials and mappings" />
                <ApiItem method="GET" path="/api/zoho/status" desc="Read Zoho sync counts and recent runs" />
                <ApiItem method="POST" path="/api/zoho/test" desc="Refresh Zoho OAuth token" />
                <ApiItem method="GET" path="/api/zoho/employees/verify" desc="Compare biometric user IDs against Zoho Employee IDs" />
                <ApiItem method="POST" path="/api/zoho/sync" desc="Preview or send mapped punches to Zoho People" />
                <ApiItem method="GET" path="/api/hr" desc="Read all HRM records" />
                <ApiItem method="GET" path="/api/hr/profiles" desc="Read employee HR profiles" />
                <ApiItem method="PUT" path="/api/hr/profiles/{user_id}" desc="Save an employee HR profile" />
                <ApiItem method="GET" path="/api/hr/{collection}" desc="List leave, asset, document, or performance records" />
                <ApiItem method="POST" path="/api/hr/{collection}" desc="Create an HRM record" />
                <ApiItem method="PUT" path="/api/hr/{collection}/{id}" desc="Update an HRM record" />
                <ApiItem method="DELETE" path="/api/hr/{collection}/{id}" desc="Delete an HRM record" />
              </div>
            </SettingsCard>
          )}
        </div>
      </div>
    </div>
  );
}
