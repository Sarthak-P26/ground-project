import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  CreditCard,
  Download,
  Home,
  Dumbbell,
  Eye,
  Filter,
  Gauge,
  IndianRupee,
  LayoutGrid,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Phone,
  Plus,
  Printer,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  UserPlus,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import turfImage from './assets/four-section-turf.png';
import './styles.css';

const STORAGE_KEYS = {
  bookings: 'college-turf-bookings-v1',
  settings: 'college-turf-settings-v1',
  user: 'college-turf-user-v1',
};

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found.');
const appRoot = rootElement.__turfcastRoot || createRoot(rootElement);
rootElement.__turfcastRoot = appRoot;

const DEFAULT_SETTINGS = {
  price: 600,
  durationHours: 3,
  openHour: 6,
  closeHour: 21,
  sections: ['Section A', 'Section B', 'Section C', 'Section D'],
  sports: ['Cricket', 'Football'],
  bookingWindowDays: 14,
  maxActiveBookingsPerPhone: 2,
  adminPin: '1234',
  maintenanceDates: [],
};

function loadJson(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function toDateInput(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

function formatHour(hour) {
  const normalized = hour % 24;
  const date = new Date();
  date.setHours(normalized, 0, 0, 0);
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function currency(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

function makeBookingId() {
  return `BK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function makeTimeSlots(settings) {
  const slots = [];
  for (let hour = settings.openHour; hour + settings.durationHours <= settings.closeHour; hour += settings.durationHours) {
    slots.push(hour);
  }
  return slots;
}

function bookingMatchesSlot(booking, date, section, hour) {
  return booking.date === date && booking.section === section && Number(booking.startHour) === Number(hour);
}

function isBlockedDate(settings, date) {
  return settings.maintenanceDates?.includes(date);
}

function isFutureOrToday(date) {
  return date >= toDateInput(new Date());
}

function datePlus(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

function App() {
  const [settings, setSettings] = useState(() => loadJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS));
  const [bookings, setBookings] = useState(() => loadJson(STORAGE_KEYS.bookings, []));
  const [currentUser, setCurrentUser] = useState(() => loadJson(STORAGE_KEYS.user, null));
  const [authMode, setAuthMode] = useState(() => new URLSearchParams(window.location.search).get('reset') ? 'reset' : 'home');
  const [demoResetLink, setDemoResetLink] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Connecting');
  const [activeDate, setActiveDate] = useState(() => toDateInput(new Date()));
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [weather, setWeather] = useState({});
  const [forecast, setForecast] = useState([]);
  const [priceSuggestions, setPriceSuggestions] = useState({});
  const [acceptedSuggestions, setAcceptedSuggestions] = useState({});
  const [receiptBooking, setReceiptBooking] = useState(null);
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showAdminUnlock, setShowAdminUnlock] = useState(false);
  const [isAdmin, setIsAdmin] = useState(() => sessionStorage.getItem('turf-admin') === 'yes');
  const [dashboardMode, setDashboardMode] = useState(() => sessionStorage.getItem('turf-admin') === 'yes' ? 'admin' : 'student');
  const [sportFilter, setSportFilter] = useState('All');

  const slots = useMemo(() => makeTimeSlots(settings), [settings]);
  const today = toDateInput(new Date());
  const quickDates = useMemo(() => Array.from({ length: 7 }, (_, index) => datePlus(index)), []);
  const latestBookingDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + Number(settings.bookingWindowDays || DEFAULT_SETTINGS.bookingWindowDays));
    return toDateInput(date);
  }, [settings.bookingWindowDays]);
  const activeBookings = bookings.filter((booking) => !booking.cancelledAt);
  const selectedDateBookings = activeBookings
    .filter((booking) => booking.date === activeDate)
    .sort((a, b) => a.startHour - b.startHour || a.section.localeCompare(b.section));

  const filteredBookings = bookings
    .filter((booking) => {
      const q = search.trim().toLowerCase();
      const matchesSport = sportFilter === 'All' || booking.sport === sportFilter;
      if (!matchesSport) return false;
      if (!q) return true;
      return [booking.playerName, booking.phone, booking.sport, booking.section, booking.id]
        .join(' ')
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => `${b.date}-${b.startHour}`.localeCompare(`${a.date}-${a.startHour}`));

  const totalCapacity = settings.sections.length * slots.length;
  const bookedCount = selectedDateBookings.length;
  const availableCount = Math.max(totalCapacity - bookedCount, 0);
  const revenue = selectedDateBookings.reduce((sum, booking) => sum + Number(booking.price), 0);
  const nextBooking = activeBookings
    .filter((booking) => isFutureOrToday(booking.date))
    .sort((a, b) => `${a.date}-${a.startHour}`.localeCompare(`${b.date}-${b.startHour}`))[0];
  const myBookings = currentUser
    ? bookings
        .filter((booking) => !booking.cancelledAt && (booking.bookedBy === currentUser.id || booking.phone === currentUser.phone))
        .sort((a, b) => `${a.date}-${a.startHour}`.localeCompare(`${b.date}-${b.startHour}`))
    : [];
  const myNextBooking = myBookings.find((booking) => isFutureOrToday(booking.date));
  const utilization = totalCapacity ? Math.round((bookedCount / totalCapacity) * 100) : 0;

  useEffect(() => {
    async function loadServerStore() {
      try {
        const response = await fetch('/api/store');
        if (!response.ok) throw new Error('Server unavailable');
        const store = await response.json();
        const mergedSettings = { ...DEFAULT_SETTINGS, ...store.settings };
        setSettings(mergedSettings);
        setBookings(store.bookings);
        saveJson(STORAGE_KEYS.settings, mergedSettings);
        saveJson(STORAGE_KEYS.bookings, store.bookings);
        setSyncStatus('Live');
      } catch {
        setSyncStatus('Offline');
      }
    }

    loadServerStore();
  }, []);

  useEffect(() => {
    Promise.all(slots.map(async (hour) => [hour, await fetch(`/api/weather-risk?date=${activeDate}&hour=${hour}`).then((r) => r.json())]))
      .then((items) => setWeather(Object.fromEntries(items))).catch(() => setWeather({}));
  }, [activeDate, slots.length]);

  useEffect(() => { fetch('/api/forecast').then((r) => r.json()).then(setForecast).catch(() => setForecast([])); }, []);
  useEffect(() => { fetch(`/api/price-suggestions?date=${activeDate}`).then((r) => r.json()).then(setPriceSuggestions).catch(() => setPriceSuggestions({})); }, [activeDate]);

  function persistBookings(nextBookings) {
    setBookings(nextBookings);
    saveJson(STORAGE_KEYS.bookings, nextBookings);
  }

  function persistSettings(nextSettings) {
    setSettings(nextSettings);
    saveJson(STORAGE_KEYS.settings, nextSettings);
    setSelectedSlot(null);
  }

  async function addBooking(formData) {
    const get = (key) => formData instanceof FormData ? formData.get(key) : formData[key];
    const bookingSlot = selectedSlot;
    const nextBooking = {
      id: makeBookingId(),
      date: activeDate,
      startHour: bookingSlot.hour,
      endHour: bookingSlot.hour + settings.durationHours,
      section: bookingSlot.section,
      sport: get('sport'),
      playerName: String(get('playerName') || '').trim(),
      phone: String(get('phone') || '').trim(),
      collegeId: String(get('collegeId') || '').trim(),
      bookedBy: currentUser.id,
      teamSize: Number(get('teamSize')) || 1,
      paymentMode: 'Pay at venue',
      paymentStatus: 'unpaid',
      notes: String(get('notes') || '').trim(),
      price: Number(settings.price),
      createdAt: new Date().toISOString(),
    };

    if (!nextBooking.playerName || !nextBooking.phone) {
      return { ok: false, message: 'Enter player name and phone number, then try again.' };
    }

    if (!/^[6-9]\d{9}$/.test(nextBooking.phone)) {
      return { ok: false, message: 'Enter a valid 10-digit Indian phone number.' };
    }

    if (isBlockedDate(settings, activeDate)) {
      return { ok: false, message: 'This date is blocked for maintenance.' };
    }

    const activeForPhone = activeBookings.filter((booking) => booking.phone === nextBooking.phone && isFutureOrToday(booking.date));
    if (activeForPhone.length >= Number(settings.maxActiveBookingsPerPhone)) {
      return { ok: false, message: `This phone already has ${settings.maxActiveBookingsPerPhone} active bookings.` };
    }

    const alreadyBooked = activeBookings.some((booking) =>
      bookingMatchesSlot(booking, activeDate, bookingSlot.section, bookingSlot.hour),
    );

    if (alreadyBooked) {
      setSelectedSlot(null);
      return { ok: false, message: 'That slot was just booked. Pick another one.' };
    }

    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextBooking),
      });
      if (!response.ok) {
        const error = await response.json();
        return { ok: false, message: error.message || 'Could not save booking.' };
      }
      const store = await response.json();
      persistBookings(store.bookings);
      persistSettings(store.settings);
      setReceiptBooking(store.bookings.find((booking) => booking.id === nextBooking.id) || nextBooking);
      setSyncStatus('Live');
    } catch {
      persistBookings([...bookings, nextBooking]);
      setSyncStatus('Offline');
    }

    setSelectedSlot(null);
    return { ok: true };
  }

  function unlockAdmin(pin) {
    if (pin === String(settings.adminPin || '1234')) {
      sessionStorage.setItem('turf-admin', 'yes');
      setIsAdmin(true);
      setDashboardMode('admin');
      setShowAdminUnlock(false);
      return true;
    }
    return false;
  }

  function requireAdmin(action) {
    if (!isAdmin) {
      setShowAdminUnlock(true);
      return;
    }
    action();
  }

  async function cancelBooking(bookingId) {
    try {
      const response = await fetch(`/api/bookings/${bookingId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not delete');
      const store = await response.json();
      persistBookings(store.bookings);
      setSyncStatus('Live');
    } catch {
      persistBookings(bookings.filter((booking) => booking.id !== bookingId));
      setSyncStatus('Offline');
    }
  }

  async function saveSettings(nextSettings) {
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      if (!response.ok) throw new Error('Could not save settings');
      const store = await response.json();
      persistSettings(store.settings);
      persistBookings(store.bookings);
      setSyncStatus('Live');
    } catch {
      persistSettings(nextSettings);
      setSyncStatus('Offline');
    }
  }

  function applyAuthenticatedSession(user, store) {
    const mergedSettings = { ...DEFAULT_SETTINGS, ...(store?.settings || settings) };
    setCurrentUser(user);
    setSettings(mergedSettings);
    setBookings(store?.bookings || bookings);
    saveJson(STORAGE_KEYS.user, user);
    saveJson(STORAGE_KEYS.settings, mergedSettings);
    saveJson(STORAGE_KEYS.bookings, store?.bookings || bookings);
    setAuthError('');
  }

  async function handleAuthSubmit(mode, payload) {
    setAuthLoading(true);
    setAuthError('');
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        setAuthError(result.message || 'Authentication failed.');
        return false;
      }
      if (mode === 'forgot-password') {
        const token = result.resetToken || new URL(result.resetLink || '', window.location.origin).searchParams.get('reset');
        const nextResetLink = token ? `${window.location.origin}/?reset=${token}` : '';
        setDemoResetLink(nextResetLink);
        setAuthError(result.message || 'If an account exists, a reset link will be prepared in demo mode.');
        return true;
      }
      if (mode === 'reset-password') { setAuthMode('login'); setAuthError(result.message || 'Password reset complete.'); return true; }
      applyAuthenticatedSession(result.user, result.store);
      setSyncStatus('Live');
      return true;
    } catch {
      setAuthError('Server is not reachable. Start the app server and try again.');
      setSyncStatus('Offline');
      return false;
    } finally {
      setAuthLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEYS.user);
    sessionStorage.removeItem('turf-admin');
    setCurrentUser(null);
    setIsAdmin(false);
    setDashboardMode('student');
    setAuthMode('home');
  }

  function scrollToSection(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exportBookings() {
    const headers = ['Booking ID', 'Date', 'Section', 'Start', 'End', 'Sport', 'Name', 'Phone', 'Players', 'Price', 'Notes'];
    const rows = bookings.map((booking) => [
      booking.id,
      booking.date,
      booking.section,
      formatHour(booking.startHour),
      formatHour(booking.endHour),
      booking.sport,
      booking.playerName,
      booking.phone,
      booking.teamSize,
      booking.price,
      booking.notes,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `turf-bookings-${toDateInput(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!currentUser) {
    return (
      <AuthExperience
        authMode={authMode}
        authError={authError}
        authLoading={authLoading}
        settings={settings}
        bookings={bookings}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError('');
        }}
        onSubmit={handleAuthSubmit}
        demoResetLink={demoResetLink}
      />
    );
  }

  return (
    <main className="app-shell product-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Trophy size={24} />
          </div>
          <div>
            <p>College Sports Desk</p>
            <h1>TurfCast</h1>
          </div>
        </div>
        <div className="top-actions">
          <div className="user-chip">
            <UserRound size={18} />
            <span>{currentUser.name}</span>
          </div>
          <button className="ghost-button" type="button" onClick={() => requireAdmin(exportBookings)} title="Export bookings">
            <Download size={18} />
            <span>Export</span>
          </button>
          <button className="ghost-button" type="button" onClick={() => isAdmin ? setDashboardMode(dashboardMode === 'admin' ? 'student' : 'admin') : setShowAdminUnlock(true)}>
            <ShieldCheck size={18} /><span>{dashboardMode === 'admin' ? 'Student View' : 'Owner Console'}</span>
          </button>
          <button className="ghost-button" type="button" onClick={logout} title="Back to public home"><Home size={18} /><span>Home</span></button>
          <span className={`sync-pill ${syncStatus.toLowerCase()}`}>{syncStatus}</span>
          <button className="icon-button" type="button" onClick={() => requireAdmin(() => setShowSettings(true))} title="Admin settings">
            {isAdmin ? <Settings size={20} /> : <Lock size={20} />}
          </button>
          <button className="icon-button" type="button" onClick={logout} title="Log out">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <nav className="product-tabs" aria-label="Main navigation">
        <button type="button" onClick={() => scrollToSection('overview')}>
          <Gauge size={17} />
          <span>Overview</span>
        </button>
        <button type="button" onClick={() => scrollToSection('schedule')}>
          <CalendarDays size={17} />
          <span>Schedule</span>
        </button>
        <button type="button" onClick={() => scrollToSection('records')}>
          <ClipboardCheck size={17} />
          <span>Records</span>
        </button>
      </nav>

      <section className="command-deck" id="overview">
        <div className="deck-copy">
          <div className="auth-kicker">
            <Activity size={16} />
            <span>Live command center</span>
          </div>
          <h2>Welcome back, {currentUser.name.split(' ')[0]}.</h2>
          <p>Today’s turf load is at {utilization}%. Pick a clean window, keep your team moving, and avoid the last-minute chaos.</p>
        </div>
        <div className="deck-card next">
          <span>Your Next Slot</span>
          {myNextBooking ? (
            <>
              <strong>{myNextBooking.section}</strong>
              <p>{formatDate(myNextBooking.date)} · {formatHour(myNextBooking.startHour)}</p>
            </>
          ) : (
            <>
              <strong>No slot yet</strong>
              <p>Grab a section before the prime hours disappear.</p>
            </>
          )}
        </div>
        <div className="deck-card pulse">
          <span>Ground Pulse</span>
          <strong>{availableCount} open</strong>
          <div className="pulse-ring" style={{ '--usage': `${utilization}%` }}>
            <Activity size={22} />
          </div>
        </div>
      </section>

      <section className="simple-welcome">
        <div><p>{dashboardMode === 'admin' ? 'Owner Console' : 'Student Booking'}</p><h2>{dashboardMode === 'admin' ? 'Control today’s turf, at a glance.' : `Hi ${currentUser.name.split(' ')[0]}, choose a time that works.`}</h2><span>{dashboardMode === 'admin' ? 'Live operations, collections, and AI demand guidance in one place.' : 'Pick a date, check the rain signal, and reserve an open section.'}</span></div>
        <button className="primary-button" type="button" onClick={() => scrollToSection(dashboardMode === 'admin' ? 'records' : 'schedule')}><CalendarDays size={18} /><span>{dashboardMode === 'admin' ? 'View Bookings' : 'Book a Slot'}</span></button>
      </section>

      {dashboardMode === 'admin' && <section className="forecast-card">
        <div><p>AI Demand Signal</p><h2>7-Day Demand Forecast</h2></div>
        <ResponsiveContainer width="100%" height={180}><LineChart data={forecast}><XAxis dataKey="label" /><YAxis /><Tooltip /><Line type="monotone" dataKey="demand" stroke="#1a73e8" strokeWidth={3} dot={{ r: 4 }} /></LineChart></ResponsiveContainer>
      </section>}

      {dashboardMode === 'admin' && <OwnerDashboard bookings={activeBookings} onMarkPaid={async (id) => { const response = await fetch(`/api/bookings/${id}/payment`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentStatus: 'paid' }) }); if (response.ok) { const store = await response.json(); persistBookings(store.bookings); } }} />}

      {false && <section className="command-hero product-hero">
        <div className="hero-copy">
          <p>Four-section campus turf</p>
          <h2>Book a clean three-hour window before the rush starts.</h2>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={() => window.scrollTo({ top: 380, behavior: 'smooth' })}>
              <CalendarDays size={18} />
              <span>Book Slot</span>
            </button>
            <button className="ghost-button glass" type="button" onClick={() => requireAdmin(() => setShowSettings(true))}>
              <SlidersHorizontal size={18} />
              <span>{isAdmin ? 'Change Rules' : 'Admin Unlock'}</span>
            </button>
          </div>
        </div>
        <div className="turf-stage" aria-label="Four section turf preview">
          <img src={turfImage} alt="Four section college turf under stadium lights" />
          <div className="turf-overlay">
            {settings.sections.map((section, index) => {
              const sectionBookings = selectedDateBookings.filter((booking) => booking.section === section).length;
              return (
                <div className="turf-quadrant" key={section} style={{ '--delay': `${index * 120}ms` }}>
                  <strong>{section.replace('Section ', '')}</strong>
                  <span>{sectionBookings}/{slots.length}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>}

      <section className="summary-strip">
        <Metric icon={<LayoutGrid size={20} />} label="Sections" value={settings.sections.length} tone="green" />
        <Metric icon={<Clock size={20} />} label="Slot Duration" value={`${settings.durationHours} hr`} tone="blue" />
        <Metric icon={<IndianRupee size={20} />} label="Price" value={currency(settings.price)} tone="gold" />
        <Metric icon={<ShieldCheck size={20} />} label="Usage Today" value={`${utilization}%`} tone="red" />
      </section>

      <section className="date-runway" aria-label="Quick date selection">
        {quickDates.map((date, index) => {
          const count = activeBookings.filter((booking) => booking.date === date).length;
          const dayCapacity = totalCapacity;
          return (
            <button
              className={`date-pill ${activeDate === date ? 'active' : ''}`}
              type="button"
              key={date}
              onClick={() => setActiveDate(date)}
            >
              <span>{index === 0 ? 'Today' : formatDate(date).split(',')[0]}</span>
              <strong>{new Date(`${date}T00:00:00`).getDate()}</strong>
              <small>{count}/{dayCapacity} booked</small>
            </button>
          );
        })}
      </section>

      <section className="workspace" id="schedule">
        <aside className="side-panel">
          <div className="date-card">
            <label htmlFor="booking-date">Booking Date</label>
            <div className="date-input-wrap">
              <CalendarDays size={18} />
              <input
                id="booking-date"
                type="date"
                min={today}
                max={latestBookingDate}
                value={activeDate}
                onChange={(event) => setActiveDate(event.target.value)}
              />
            </div>
            <h2>{formatDate(activeDate)}</h2>
          </div>

          <div className="panel-group">
            <h3>Day Snapshot</h3>
            <div className="snapshot-grid">
              <SmallStat label="Booked" value={bookedCount} />
              <SmallStat label="Open" value={availableCount} />
              <SmallStat label="Income" value={currency(revenue)} />
              <SmallStat label="Slots" value={totalCapacity} />
            </div>
          </div>

          <div className="panel-group">
            <h3>Section Load</h3>
            <div className="section-load-list">
              {settings.sections.map((section) => {
                const count = selectedDateBookings.filter((booking) => booking.section === section).length;
                const percent = slots.length ? Math.round((count / slots.length) * 100) : 0;
                const suggestion = priceSuggestions[section];
                const suggested = suggestion?.suggestedPrice ?? settings.price;
                return (
                  <div className="load-row" key={section}>
                    <div>
                      <strong>{section}</strong>
                      <span>{count}/{slots.length} booked</span>
                    </div>
                    <div className="load-bar">
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    <small>Base {currency(settings.price)} · Suggested {currency(suggested)} {suggestion ? `(${suggestion.demand}% ${suggestion.recommendation.toLowerCase()})` : ''}</small>
                    {isAdmin && suggested !== settings.price && <button className="text-button" type="button" onClick={() => setAcceptedSuggestions((current) => ({ ...current, [section]: suggested }))}>{acceptedSuggestions[section] ? 'Suggestion accepted for review' : 'Accept suggestion'}</button>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="panel-group next-card">
            <h3>Next Booking</h3>
            {nextBooking ? (
              <button className="next-booking" type="button" onClick={() => setReceiptBooking(nextBooking)}>
                <strong>{nextBooking.playerName}</strong>
                <span>{formatDate(nextBooking.date)} · {formatHour(nextBooking.startHour)}</span>
              </button>
            ) : (
              <p className="quiet-text">No upcoming booking in the system.</p>
            )}
          </div>

          <div className="panel-group">
            <h3>Rules</h3>
            <ul className="rule-list">
              <li>One booking reserves one section.</li>
              <li>Each booking runs for {settings.durationHours} hours.</li>
              <li>Each phone can hold {settings.maxActiveBookingsPerPhone} active bookings.</li>
              <li>Bookings open {settings.bookingWindowDays} days ahead.</li>
              <li>Students can choose cricket or football.</li>
            </ul>
          </div>
        </aside>

        <section className="board-panel">
          <div className="section-heading">
            <div>
              <p>Live Schedule</p>
              <h2>Pick a free section and time</h2>
            </div>
            <span>{isBlockedDate(settings, activeDate) ? 'Maintenance blocked' : `${formatHour(settings.openHour)} to ${formatHour(settings.closeHour)}`}</span>
          </div>

          {isBlockedDate(settings, activeDate) ? (
            <div className="maintenance-panel">
              <ShieldCheck size={28} />
              <h3>Ground maintenance day</h3>
              <p>This date is blocked by the sports desk. Pick another date from the calendar.</p>
            </div>
          ) : (
          <div className="booking-grid" style={{ '--columns': settings.sections.length }}>
            <div className="grid-head time-head">Time</div>
            {settings.sections.map((section) => (
              <div className="grid-head" key={section}>{section}</div>
            ))}

            {slots.map((hour) => (
              <React.Fragment key={hour}>
                <div className="time-cell">
                  <strong>{formatHour(hour)}</strong>
                  <span>{formatHour(hour + settings.durationHours)}</span>
                </div>
                {settings.sections.map((section) => {
                  const booking = activeBookings.find((item) => bookingMatchesSlot(item, activeDate, section, hour));
                  return (
                    <button
                      type="button"
                      className={`slot-card ${booking ? 'booked' : 'available'}`}
                      key={`${section}-${hour}`}
                      onClick={() => !booking && setSelectedSlot({ section, hour })}
                      disabled={Boolean(booking)}
                      title={booking ? `${booking.playerName} has booked this slot` : `Book ${section}`}
                    >
                      {booking ? (
                        <>
                          <span>{booking.sport}</span>
                          <strong>{booking.playerName}</strong>
                          <small>{booking.phone}</small>
                          <small className={`weather-tag ${(weather[hour]?.risk || 'Low').toLowerCase()}`}>{weather[hour]?.risk || 'Low'} rain risk</small>
                        </>
                      ) : (
                        <>
                          <Plus size={18} />
                          <strong>Available</strong>
                          <small>{currency(settings.price)}</small>
                          <small className={`weather-tag ${(weather[hour]?.risk || 'Low').toLowerCase()}`}>{weather[hour]?.risk || 'Low'} rain risk</small>
                        </>
                      )}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          )}
        </section>
      </section>

      <section className="records-panel" id="records">
        <div className="section-heading">
          <div>
            <p>Booking Records</p>
            <h2>Manage reservations</h2>
          </div>
          <div className="filter-strip">
            <Filter size={18} />
            <select value={sportFilter} onChange={(event) => setSportFilter(event.target.value)}>
              <option>All</option>
              {settings.sports.map((sport) => (
                <option key={sport}>{sport}</option>
              ))}
            </select>
          </div>
          <div className="search-box">
            <Search size={18} />
            <input
              type="search"
              placeholder="Search booking"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>

        <div className="booking-list">
          {filteredBookings.length === 0 ? (
            <div className="empty-state">
              <Dumbbell size={26} />
              <p>No bookings yet.</p>
            </div>
          ) : (
            filteredBookings.map((booking) => (
              <article className="booking-row" key={booking.id}>
                <div className="booking-icon">
                  <Users size={20} />
                </div>
                <div>
                  <h3>{booking.playerName}</h3>
                  <p>
                    {formatDate(booking.date)} · {booking.section} · {formatHour(booking.startHour)}-{formatHour(booking.endHour)}
                  </p>
                </div>
                <div className="booking-tags">
                  <span>{booking.sport}</span>
                  <span>{booking.teamSize} players</span>
                  <span>{booking.paymentMode || 'Pending'}</span>
                  <span>{booking.paymentStatus || 'unpaid'}</span>
                  {booking.cancelledAt && <span>Cancelled</span>}
                  <span>{currency(booking.price)}</span>
                </div>
                <button className="icon-button" type="button" onClick={() => setReceiptBooking(booking)} title="View receipt">
                  <Eye size={18} />
                </button>
                <button className="danger-button" type="button" disabled={Boolean(booking.cancelledAt)} onClick={() => requireAdmin(() => cancelBooking(booking.id))} title={booking.cancelledAt ? 'Already cancelled' : 'Cancel booking'}>
                  <Trash2 size={18} />
                </button>
              </article>
            ))
          )}
        </div>
      </section>

      {selectedSlot && (
        <BookingModal
          settings={settings}
          selectedSlot={selectedSlot}
          activeDate={activeDate}
          currentUser={currentUser}
          onClose={() => setSelectedSlot(null)}
          onSave={addBooking}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSave={async (nextSettings) => {
            await saveSettings(nextSettings);
            setShowSettings(false);
          }}
        />
      )}

      {showAdminUnlock && (
        <AdminUnlockModal
          onClose={() => setShowAdminUnlock(false)}
          onUnlock={unlockAdmin}
        />
      )}

      {receiptBooking && (
        <ReceiptModal
          booking={receiptBooking}
          onClose={() => setReceiptBooking(null)}
        />
      )}

    </main>
  );
}

function AuthExperience({ authMode, authError, authLoading, settings, bookings, onModeChange, onSubmit, demoResetLink }) {
  const today = toDateInput(new Date());
  const todayBookings = bookings.filter((booking) => booking.date === today).length;
  const slots = makeTimeSlots(settings).length * settings.sections.length;
  const openSlots = Math.max(slots - todayBookings, 0);

  return (
    <main className="auth-shell">
      <img className="auth-bg" src={turfImage} alt="Four section turf background" />
      <div className="auth-noise" />
      <header className="auth-nav">
        <div className="brand auth-brand">
          <div className="brand-mark">
            <Trophy size={24} />
          </div>
          <div>
            <p>College Sports Desk</p>
            <h1>TurfCast</h1>
          </div>
        </div>
        <div className="auth-nav-actions">
          <button className="ghost-button glass" type="button" onClick={() => onModeChange('login')}>
            <LogIn size={18} />
            <span>Login</span>
          </button>
          <button className="primary-button glow-button" type="button" onClick={() => onModeChange('signup')}>
            <UserPlus size={18} />
            <span>Sign Up</span>
          </button>
        </div>
      </header>

      <section className="auth-hero">
        <div className="auth-copy">
          <div className="auth-kicker">
            <Sparkles size={16} />
            <span>Smart turf access for everyone</span>
          </div>
          <h2>Four sections. Fair slots. Zero confusion.</h2>
          <p>
            Book cricket or football windows, keep the rush organized, and give every group a clean chance to play.
          </p>
          <div className="auth-stat-row">
            <AuthStat label="Open Slots Today" value={openSlots} />
            <AuthStat label="Slot Length" value={`${settings.durationHours} hr`} />
            <AuthStat label="Booking Fee" value={currency(settings.price)} />
          </div>
          <div className="enterprise-strip">
            <div>
              <BadgeCheck size={18} />
              <span>Fair access rules</span>
            </div>
            <div>
              <ShieldCheck size={18} />
              <span>Admin-controlled slots</span>
            </div>
            <div>
              <Clock size={18} />
              <span>3-hour booking windows</span>
            </div>
          </div>
          <AuthShowcase settings={settings} bookings={bookings} />
          {authMode === 'home' && (
            <div className="hero-actions">
              <button className="primary-button glow-button" type="button" onClick={() => onModeChange('signup')}>
                <UserPlus size={18} />
                <span>Create Account</span>
              </button>
              <button className="ghost-button glass" type="button" onClick={() => onModeChange('login')}>
                <ArrowRight size={18} />
                <span>Enter Console</span>
              </button>
            </div>
          )}
        </div>

        <AuthPanel
          mode={authMode === 'home' ? 'login' : authMode}
          authError={authError}
          authLoading={authLoading}
          onModeChange={onModeChange}
          onSubmit={onSubmit}
          demoResetLink={demoResetLink}
        />
      </section>
      <section className="auth-product-band">
        <ProductPillar icon={<CalendarDays size={20} />} title="Book faster" text="Students see available sections instantly and reserve without confusion." />
        <ProductPillar icon={<ShieldCheck size={20} />} title="Keep it fair" text="Limits, maintenance dates, and admin controls protect equal access." />
        <ProductPillar icon={<ClipboardCheck size={20} />} title="Run records cleanly" text="Receipts, exports, payments, and cancellations stay organized." />
      </section>
    </main>
  );
}

function ProductPillar({ icon, title, text }) {
  return (
    <article className="product-pillar">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}

function AuthShowcase({ settings, bookings }) {
  const today = toDateInput(new Date());
  const slots = makeTimeSlots(settings);

  return (
    <div className="auth-showcase">
      <div className="showcase-top">
        <div>
          <span>Live Turf Matrix</span>
          <strong>{formatDate(today)}</strong>
        </div>
        <div className="showcase-signal">
          <span />
          Online
        </div>
      </div>
      <div className="holo-field">
        {settings.sections.map((section, index) => {
          const count = bookings.filter((booking) => booking.date === today && booking.section === section).length;
          return (
            <div className="holo-tile" key={section} style={{ '--delay': `${index * 130}ms` }}>
              <strong>{section.replace('Section ', '')}</strong>
              <span>{count}/{slots.length}</span>
            </div>
          );
        })}
      </div>
      <div className="showcase-rail">
        <div>
          <CheckCircle2 size={16} />
          Fair play limit active
        </div>
        <div>
          <Star size={16} />
          Prime slots protected
        </div>
      </div>
    </div>
  );
}

function AuthStat({ label, value }) {
  return (
    <div className="auth-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AuthPanel({ mode, authError, authLoading, onModeChange, onSubmit, demoResetLink }) {
  const isSignup = mode === 'signup';
  const panelTitle = mode === 'forgot' ? 'Reset your TurfCast password' : mode === 'reset' ? 'Choose a new password' : isSignup ? 'Create your TurfCast account' : 'Login to book your slot';
  const panelKicker = mode === 'forgot' ? 'Account Recovery' : mode === 'reset' ? 'Secure Reset' : isSignup ? 'New Player' : 'Welcome Back';

  async function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    if (mode === 'forgot') await onSubmit('forgot-password', payload);
    else if (mode === 'reset') await onSubmit('reset-password', { ...payload, token: new URLSearchParams(window.location.search).get('reset') });
    else await onSubmit(isSignup ? 'signup' : 'login', payload);
  }

  return (
    <form className="auth-panel" onSubmit={handleSubmit}>
      <div className="auth-panel-head">
        <div className="auth-icon">
          {isSignup ? <UserPlus size={22} /> : <LogIn size={22} />}
        </div>
        <div>
          <p>{panelKicker}</p>
          <h3>{panelTitle}</h3>
        </div>
      </div>

      {mode === 'forgot' ? <><label>Email or Phone<div className="input-with-icon"><Mail size={18} /><input name="identifier" type="text" placeholder="email or phone" /></div></label>{demoResetLink ? <p className="demo-link">Demo mode: in production this would be emailed. <a href={demoResetLink}>Open reset link</a></p> : <p className="demo-link">If an account exists, a reset link will be prepared in demo mode.</p>}</> : mode === 'reset' ? <label>New Password<div className="input-with-icon"><Lock size={18} /><input name="password" type="password" placeholder="At least 6 characters" /></div></label> : isSignup ? (
        <>
          <label>
            Full Name
            <div className="input-with-icon">
              <UserRound size={18} />
              <input name="name" type="text" placeholder="Your name" />
            </div>
          </label>
          <label>
            Email
            <div className="input-with-icon">
              <Mail size={18} />
              <input name="email" type="email" placeholder="you@college.edu" />
            </div>
          </label>
          <label>
            Phone
            <div className="input-with-icon">
              <Phone size={18} />
              <input name="phone" type="tel" placeholder="9876543210" />
            </div>
          </label>
          <label>
            College ID
            <div className="input-with-icon">
              <ClipboardCheck size={18} />
              <input name="collegeId" type="text" placeholder="Optional roll number" />
            </div>
          </label>
        </>
      ) : (
        <label>
          Email or Phone
          <div className="input-with-icon">
            <Mail size={18} />
            <input name="identifier" type="text" placeholder="email or phone" />
          </div>
        </label>
      )}

      {mode !== 'forgot' && mode !== 'reset' && <label>
        Password
        <div className="input-with-icon">
          <Lock size={18} />
          <input name="password" type="password" placeholder="At least 6 characters" />
        </div>
      </label>}

      {authError && <p className="form-error">{authError}</p>}

      <button className="primary-button glow-button auth-submit" type="submit" disabled={authLoading}>
        {isSignup ? <UserPlus size={18} /> : <LogIn size={18} />}
        <span>{authLoading ? 'Working' : mode === 'forgot' ? 'Create reset link' : mode === 'reset' ? 'Set new password' : isSignup ? 'Create Account' : 'Login'}</span>
      </button>

      <p className="auth-switch">
        {isSignup ? 'Already have an account?' : 'Need a player account?'}
        <button type="button" onClick={() => onModeChange(isSignup ? 'login' : 'signup')}>
          {isSignup ? 'Login' : 'Sign up'}
        </button>
      </p>
      {mode === 'login' && <button className="text-button" type="button" onClick={() => onModeChange('forgot')}>Forgot Password?</button>}
    </form>
  );
}

function Metric({ icon, label, value, tone }) {
  return (
    <div className={`metric ${tone}`}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SmallStat({ label, value }) {
  return (
    <div className="small-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OwnerDashboard({ bookings, onMarkPaid }) {
  const today = toDateInput(new Date());
  const todayBookings = bookings.filter((booking) => booking.date === today);
  const unpaid = bookings.filter((booking) => booking.paymentStatus === 'unpaid');
  const expected = todayBookings.reduce((total, booking) => total + Number(booking.price || 0), 0);
  return (
    <section className="owner-dashboard">
      <div className="owner-heading"><div><p>Owner essentials</p><h2>Today’s control board</h2></div><span>Only the actions that need your attention.</span></div>
      <div className="owner-metrics"><SmallStat label="Today’s bookings" value={todayBookings.length} /><SmallStat label="Expected collection" value={currency(expected)} /><SmallStat label="Payment at venue" value={unpaid.length} /></div>
      <div className="collection-list"><div><h3>Collect at venue</h3><p>Mark cash collection after the team arrives.</p></div>{unpaid.length ? unpaid.slice(0, 4).map((booking) => <div className="collection-row" key={booking.id}><span><strong>{booking.playerName}</strong><small>{booking.section} · {formatDate(booking.date)}</small></span><button className="ghost-button" type="button" onClick={() => onMarkPaid(booking.id)}>Mark collected</button></div>) : <p className="quiet-text">No collections waiting.</p>}</div>
    </section>
  );
}

function BookingModal({ settings, selectedSlot, activeDate, currentUser, onClose, onSave }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    const result = await onSave(new FormData(event.currentTarget));
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <p>New Booking</p>
            <h2>{selectedSlot.section}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>

        <div className="slot-summary">
          <span>{formatDate(activeDate)}</span>
          <span>{formatHour(selectedSlot.hour)}-{formatHour(selectedSlot.hour + settings.durationHours)}</span>
          <span>{currency(settings.price)}</span>
        </div>

        <label>
          Player Name
          <input name="playerName" type="text" placeholder="Student or team captain" defaultValue={currentUser.name} autoFocus />
        </label>

        <label>
          Phone Number
          <input name="phone" type="tel" placeholder="9876543210" defaultValue={currentUser.phone} />
        </label>

        <label>
          College ID
          <input name="collegeId" type="text" placeholder="Optional roll number or ID" defaultValue={currentUser.collegeId} />
        </label>

        <div className="form-grid">
          <label>
            Sport
            <select name="sport" defaultValue={settings.sports[0]}>
              {settings.sports.map((sport) => (
                <option key={sport}>{sport}</option>
              ))}
            </select>
          </label>
          <label>
            Players
            <input name="teamSize" type="number" min="1" max="30" defaultValue="10" />
          </label>
        </div>

        <label>
          Notes
          <textarea name="notes" rows="3" placeholder="Optional notes" />
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="submit" disabled={saving}>
            <CreditCard size={18} />
            <span>{saving ? 'Saving' : 'Confirm Booking'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function SettingsModal({ settings, onClose, onSave }) {
  const [draft, setDraft] = useState(settings);

  function setNumber(key, value) {
    setDraft((current) => ({ ...current, [key]: Number(value) }));
  }

  function setList(key, value) {
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    setDraft((current) => ({ ...current, [key]: items }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const safeSettings = {
      ...draft,
      price: Math.max(1, Number(draft.price)),
      durationHours: Math.max(1, Number(draft.durationHours)),
      openHour: Math.max(0, Math.min(23, Number(draft.openHour))),
      closeHour: Math.max(1, Math.min(24, Number(draft.closeHour))),
      bookingWindowDays: Math.max(1, Number(draft.bookingWindowDays)),
      maxActiveBookingsPerPhone: Math.max(1, Number(draft.maxActiveBookingsPerPhone)),
      adminPin: String(draft.adminPin || DEFAULT_SETTINGS.adminPin),
      sections: draft.sections.length ? draft.sections : DEFAULT_SETTINGS.sections,
      sports: draft.sports.length ? draft.sports : DEFAULT_SETTINGS.sports,
      maintenanceDates: draft.maintenanceDates || [],
    };
    onSave(safeSettings);
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <p>Ground Rules</p>
            <h2>Settings</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>

        <div className="form-grid">
          <label>
            Price
            <input type="number" min="1" value={draft.price} onChange={(event) => setNumber('price', event.target.value)} />
          </label>
          <label>
            Duration Hours
            <input type="number" min="1" value={draft.durationHours} onChange={(event) => setNumber('durationHours', event.target.value)} />
          </label>
          <label>
            Open Hour
            <input type="number" min="0" max="23" value={draft.openHour} onChange={(event) => setNumber('openHour', event.target.value)} />
          </label>
          <label>
            Close Hour
            <input type="number" min="1" max="24" value={draft.closeHour} onChange={(event) => setNumber('closeHour', event.target.value)} />
          </label>
          <label>
            Booking Window Days
            <input type="number" min="1" value={draft.bookingWindowDays} onChange={(event) => setNumber('bookingWindowDays', event.target.value)} />
          </label>
          <label>
            Max Active Per Phone
            <input type="number" min="1" value={draft.maxActiveBookingsPerPhone} onChange={(event) => setNumber('maxActiveBookingsPerPhone', event.target.value)} />
          </label>
        </div>

        <label>
          Sections
          <input value={draft.sections.join(', ')} onChange={(event) => setList('sections', event.target.value)} />
        </label>

        <label>
          Sports
          <input value={draft.sports.join(', ')} onChange={(event) => setList('sports', event.target.value)} />
        </label>

        <label>
          Maintenance Dates
          <input
            placeholder="2026-05-01, 2026-05-08"
            value={(draft.maintenanceDates || []).join(', ')}
            onChange={(event) => setList('maintenanceDates', event.target.value)}
          />
        </label>

        <label>
          Admin PIN
          <input value={draft.adminPin} onChange={(event) => setDraft((current) => ({ ...current, adminPin: event.target.value }))} />
        </label>

        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="submit">
            <Save size={18} />
            <span>Save Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function AdminUnlockModal({ onClose, onUnlock }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(event) {
    event.preventDefault();
    if (!onUnlock(pin)) {
      setError('Wrong admin PIN.');
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal compact-modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <p>Protected Area</p>
            <h2>Admin Unlock</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>
        <label>
          Admin PIN
          <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} autoFocus />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="submit">
            <Lock size={18} />
            <span>Unlock</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function ReceiptModal({ booking, onClose }) {
  function printReceipt() {
    window.print();
  }

  return (
    <div className="modal-backdrop">
      <section className="modal receipt-modal">
        <div className="modal-header no-print">
          <div>
            <p>Booking Receipt</p>
            <h2>{booking.id}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>
        <div className="receipt-card">
          <div className="receipt-top">
            <div className="brand-mark">
              <ClipboardCheck size={24} />
            </div>
            <div>
              <p>TurfCast · College Sports Desk</p>
              <h3>{booking.playerName}</h3>
            </div>
          </div>
          <div className="receipt-grid">
            <ReceiptItem label="Date" value={formatDate(booking.date)} />
            <ReceiptItem label="Time" value={`${formatHour(booking.startHour)}-${formatHour(booking.endHour)}`} />
            <ReceiptItem label="Section" value={booking.section} />
            <ReceiptItem label="Sport" value={booking.sport} />
            <ReceiptItem label="Phone" value={booking.phone} />
            <ReceiptItem label="College ID" value={booking.collegeId || 'Not added'} />
            <ReceiptItem label="Players" value={booking.teamSize} />
            <ReceiptItem label="Payment" value={booking.paymentMode || 'Pending'} />
          </div>
          <div className="receipt-total">
            <span>Total</span>
            <strong>{currency(booking.price)}</strong>
          </div>
        </div>
        <div className="modal-actions no-print">
          <button className="ghost-button" type="button" onClick={onClose}>Close</button>
          <button className="primary-button" type="button" onClick={printReceipt}>
            <Printer size={18} />
            <span>Print</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function ReceiptItem({ label, value }) {
  return (
    <div className="receipt-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

appRoot.render(<App />);
