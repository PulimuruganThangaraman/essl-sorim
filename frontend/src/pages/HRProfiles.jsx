import React, { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, RefreshCw, Save, Search, UserRound } from 'lucide-react';
import { request } from '../api';

const EMPTY_PROFILE = {
  department: '',
  designation: '',
  manager: '',
  employment_type: 'Full-time',
  status: 'Active',
  joining_date: '',
  work_email: '',
  phone: '',
  personal_email: '',
  emergency_name: '',
  emergency_phone: '',
  blood_group: '',
  address: '',
  pan_or_tax_id: '',
  bank_name: '',
  account_last4: '',
  notes: '',
};

function uniqueUsers(records) {
  const map = new Map();
  records.forEach((record) => {
    if (!map.has(record.user_id)) map.set(record.user_id, record);
  });
  return Array.from(map.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function initials(name, userId) {
  const value = String(name || userId || 'U').trim();
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U';
}

export default function HRProfiles() {
  const [users, setUsers] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState(EMPTY_PROFILE);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const [userData, profileData] = await Promise.all([request('/api/users'), request('/api/hr/profiles')]);
      const list = uniqueUsers(userData);
      setUsers(list);
      setProfiles(profileData);
      const nextSelected = selected || list[0]?.user_id || '';
      setSelected(nextSelected);
      setForm({ ...EMPTY_PROFILE, ...(profileData[nextSelected] || {}) });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (selected) setForm({ ...EMPTY_PROFILE, ...(profiles[selected] || {}) });
  }, [selected, profiles]);

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) => `${user.name} ${user.user_id}`.toLowerCase().includes(needle));
  }, [users, search]);

  const selectedUser = users.find((user) => user.user_id === selected);
  const completedProfiles = Object.keys(profiles).length;

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setMessage('');
    try {
      const saved = await request(`/api/hr/profiles/${encodeURIComponent(selected)}`, {
        method: 'PUT',
        body: JSON.stringify({ ...form, display_name: selectedUser?.name || '' }),
      });
      setProfiles((current) => ({ ...current, [selected]: saved }));
      setMessage('Employee HR profile saved.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pageContainer">
      <header className="pageHeader">
        <div>
          <h1>Employee Profiles</h1>
          <p>HR master data for employment, contact, emergency, and payroll references</p>
        </div>
        <div className="headerActions">
          <button type="button" className="btnSecondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</button>
        </div>
      </header>

      {message && <div className="notice success">{message}</div>}

      <section className="hrProfileLayout">
        <aside className="hrEmployeePanel">
          <div className="hrPanelHeader">
            <div><strong>{users.length}</strong><span>Employees</span></div>
            <div><strong>{completedProfiles}</strong><span>Profiles</span></div>
          </div>
          <div className="searchBar hrSearch">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employee" />
          </div>
          <div className="hrEmployeeList">
            {filteredUsers.map((user) => (
              <button
                key={user.user_id}
                type="button"
                className={`hrEmployeeItem ${selected === user.user_id ? 'active' : ''}`}
                onClick={() => setSelected(user.user_id)}
              >
                <span className="hrAvatar">{initials(user.name, user.user_id)}</span>
                <span><strong>{user.name || 'Unnamed User'}</strong><small>{user.user_id}</small></span>
              </button>
            ))}
            {!filteredUsers.length && <p className="emptyText">No employees found.</p>}
          </div>
        </aside>

        <form className="card hrProfileForm" onSubmit={saveProfile}>
          <div className="cardHeader">
            <UserRound size={18} />
            <h2>{selectedUser?.name || 'Select Employee'}</h2>
          </div>
          <div className="hrFormSection">
            <h3><BriefcaseBusiness size={17} /> Employment</h3>
            <div className="formGrid">
              <label><span>Department</span><input value={form.department} onChange={(event) => updateField('department', event.target.value)} /></label>
              <label><span>Designation</span><input value={form.designation} onChange={(event) => updateField('designation', event.target.value)} /></label>
              <label><span>Manager</span><input value={form.manager} onChange={(event) => updateField('manager', event.target.value)} /></label>
              <label><span>Employment Type</span><select value={form.employment_type} onChange={(event) => updateField('employment_type', event.target.value)}><option>Full-time</option><option>Contract</option><option>Intern</option><option>Consultant</option></select></label>
              <label><span>Status</span><select value={form.status} onChange={(event) => updateField('status', event.target.value)}><option>Active</option><option>Probation</option><option>Notice Period</option><option>Inactive</option></select></label>
              <label><span>Joining Date</span><input type="date" value={form.joining_date} onChange={(event) => updateField('joining_date', event.target.value)} /></label>
            </div>
          </div>

          <div className="hrFormSection">
            <h3>Contact & Emergency</h3>
            <div className="formGrid">
              <label><span>Work Email</span><input value={form.work_email} onChange={(event) => updateField('work_email', event.target.value)} /></label>
              <label><span>Phone</span><input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} /></label>
              <label><span>Personal Email</span><input value={form.personal_email} onChange={(event) => updateField('personal_email', event.target.value)} /></label>
              <label><span>Emergency Name</span><input value={form.emergency_name} onChange={(event) => updateField('emergency_name', event.target.value)} /></label>
              <label><span>Emergency Phone</span><input value={form.emergency_phone} onChange={(event) => updateField('emergency_phone', event.target.value)} /></label>
              <label><span>Blood Group</span><input value={form.blood_group} onChange={(event) => updateField('blood_group', event.target.value)} /></label>
            </div>
            <label className="wideField"><span>Address</span><textarea value={form.address} onChange={(event) => updateField('address', event.target.value)} /></label>
          </div>

          <div className="hrFormSection">
            <h3>Compliance & Payroll Reference</h3>
            <div className="formGrid">
              <label><span>PAN / Tax ID</span><input value={form.pan_or_tax_id} onChange={(event) => updateField('pan_or_tax_id', event.target.value)} /></label>
              <label><span>Bank Name</span><input value={form.bank_name} onChange={(event) => updateField('bank_name', event.target.value)} /></label>
              <label><span>Account Last 4</span><input value={form.account_last4} onChange={(event) => updateField('account_last4', event.target.value)} /></label>
            </div>
            <label className="wideField"><span>HR Notes</span><textarea value={form.notes} onChange={(event) => updateField('notes', event.target.value)} /></label>
          </div>

          <div className="formActions">
            <button type="submit" disabled={!selected || saving}><Save size={15} /> {saving ? 'Saving...' : 'Save Profile'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
