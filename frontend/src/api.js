// In production (built frontend served by backend), API is on the same origin.
// In development, default to localhost:8000 but allow override via VITE_API_BASE.
const API_BASE = import.meta.env.DEV ? (import.meta.env.VITE_API_BASE || 'http://localhost:8000') : '';
const PREF_KEY = 'sorim_crm_prefs';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
  } catch {
    return {};
  }
}

function localeFromPrefs(prefs) {
  const locales = {
    en: 'en-IN',
    hi: 'hi-IN',
    es: 'es-ES',
    fr: 'fr-FR',
  };
  return locales[prefs.language] || 'en-IN';
}

function zonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

function formatDateByPreference(date, prefs) {
  const timeZone = prefs.timezone || 'Asia/Kolkata';
  const parts = zonedDateParts(date, timeZone);
  if (prefs.dateFormat === 'YYYY-MM-DD') return `${parts.year}-${parts.month}-${parts.day}`;
  if (prefs.dateFormat === 'MM/DD/YYYY') return `${parts.month}/${parts.day}/${parts.year}`;
  return `${parts.day}/${parts.month}/${parts.year}`;
}

export async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {
      // Keep the HTTP status text.
    }
    throw new Error(message);
  }
  return response.json();
}

export function toInputDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 0, 0);
  return {
    from_time: toInputDateTime(start),
    to_time: toInputDateTime(end),
  };
}

export function formatPunchTime(value) {
  if (!value) return '';
  const prefs = readPrefs();
  const timeZone = prefs.timezone || 'Asia/Kolkata';
  const locale = localeFromPrefs(prefs);
  const date = new Date(value);
  const formattedDate = formatDateByPreference(date, prefs);
  const formattedTime = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: prefs.timeFormat === '12h',
    timeZone,
  }).format(date);
  return `${formattedDate}, ${formattedTime}`;
}

export function rangeForDays(days) {
  const count = Math.max(1, Number(days) || 1);
  const start = new Date();
  start.setDate(start.getDate() - (count - 1));
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 0, 0);
  return {
    from_time: toInputDateTime(start),
    to_time: toInputDateTime(end),
  };
}

export function getLocalPrefs() {
  return readPrefs();
}

export { API_BASE };
