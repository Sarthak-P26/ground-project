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
  Dumbbell,
  Eye,
  Filter,
  Gauge,
  IndianRupee,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Phone,
  Printer,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  UserPlus,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Bar, BarChart as RechartsBarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import turfImage from './assets/four-section-turf.png';
import './styles.css';

const STORAGE_KEYS = {
  bookings: 'college-turf-bookings-v1',
  settings: 'college-turf-settings-v1',
  user: 'college-turf-user-v1',
  token: 'college-turf-session-token-v1',
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

function authHeaders(headers = {}) {
  return {
    ...headers,
    Authorization: `Bearer ${loadJson(STORAGE_KEYS.token, '')}`,
  };
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

function activeSlotPrice(priceOverrides, date, section, hour) {
  return priceOverrides.find((override) =>
    override.active &&
    override.date === date &&
    override.section === section &&
    Number(override.startHour) === Number(hour),
  );
}

function isFutureBookingSlot(date, hour) {
  const [year, month, day] = String(date).split('-').map(Number);
  const startTimestamp = Date.UTC(year, month - 1, day, Number(hour)) - 330 * 60 * 1000;
  return Number.isFinite(startTimestamp) && startTimestamp > Date.now();
}

function isBlockedDate(settings, date) {
  return settings.maintenanceDates?.includes(date);
}

function isFutureOrToday(date) {
  return date >= toDateInput(new Date());
}

function isStudentCancellationEligible(booking) {
  const [year, month, day] = String(booking.date).split('-').map(Number);
  const startTimestamp = Date.UTC(year, month - 1, day, Number(booking.startHour)) - 330 * 60 * 1000;
  return Number.isFinite(startTimestamp) && startTimestamp > Date.now() + 24 * 60 * 60 * 1000;
}

function datePlus(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateInput(date);
}

function App() {
  const [settings, setSettings] = useState(() => loadJson(STORAGE_KEYS.settings, DEFAULT_SETTINGS));
  const [bookings, setBookings] = useState(() => loadJson(STORAGE_KEYS.bookings, []));
  const [priceOverrides, setPriceOverrides] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(() => Boolean(loadJson(STORAGE_KEYS.token, '')));
  const [authRole, setAuthRole] = useState('student');
  const [authMode, setAuthMode] = useState(() => new URLSearchParams(window.location.search).get('reset') ? 'reset' : 'home');
  const [authError, setAuthError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [appMessage, setAppMessage] = useState('');
  const [syncStatus, setSyncStatus] = useState('Connecting');
  const [activeDate, setActiveDate] = useState(() => toDateInput(new Date()));
  const [selectedSport, setSelectedSport] = useState(() => settings.sports[0] || 'Cricket');
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [receiptBooking, setReceiptBooking] = useState(null);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [sportFilter, setSportFilter] = useState('All');
  const [showProfile, setShowProfile] = useState(false);
  const [ownerPage, setOwnerPage] = useState('dashboard');
  const [pendingCancellation, setPendingCancellation] = useState(null);
  const [skipCancellationConfirmation, setSkipCancellationConfirmation] = useState(false);

  const slots = useMemo(() => makeTimeSlots(settings), [settings]);
  const isOwner = currentUser?.role === 'owner';
  const today = toDateInput(new Date());
  const quickDates = useMemo(() => Array.from({ length: 7 }, (_, index) => datePlus(index)), []);
  const latestBookingDate = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + Number(settings.bookingWindowDays || DEFAULT_SETTINGS.bookingWindowDays));
    return toDateInput(date);
  }, [settings.bookingWindowDays]);
  const activeBookings = bookings.filter((booking) => !booking.cancelledAt);

  const myBookings = currentUser
    ? bookings
        .filter((booking) => booking.bookedBy === currentUser.id)
        .sort((a, b) => `${a.date}-${a.startHour}`.localeCompare(`${b.date}-${b.startHour}`))
    : [];
  const filteredBookings = (isOwner ? bookings : myBookings)
    .filter((booking) => {
      const q = search.trim().toLowerCase();
      const matchesSport = sportFilter === 'All' || booking.sport === sportFilter;
      if (!matchesSport) return false;
      if (!q) return true;
      const searchableValues = isOwner
        ? [
            booking.playerName,
            booking.phone,
            booking.sport,
            booking.section,
            booking.id,
            booking.date,
            formatDate(booking.date),
            formatHour(booking.startHour),
            formatHour(booking.endHour),
            booking.teamSize,
            booking.price,
            booking.paymentMode,
            booking.paymentStatus,
            booking.cancelledAt ? 'cancelled' : 'confirmed',
          ]
        : [booking.playerName, booking.phone, booking.sport, booking.section, booking.id];
      return searchableValues
        .join(' ')
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => `${b.date}-${b.startHour}`.localeCompare(`${a.date}-${a.startHour}`));

  useEffect(() => {
    const token = loadJson(STORAGE_KEYS.token, '');
    if (!token) {
      setSessionLoading(false);
      return;
    }
    fetch('/api/auth/session', { headers: authHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error('expired');
        const { user } = await response.json();
        if (!user || !['student', 'owner'].includes(user.role)) throw new Error('invalid-role');
        setCurrentUser(user);
        saveJson(STORAGE_KEYS.user, user);
      })
      .catch(() => {
        localStorage.removeItem(STORAGE_KEYS.token);
        localStorage.removeItem(STORAGE_KEYS.user);
        localStorage.removeItem(STORAGE_KEYS.bookings);
        setBookings([]);
        setCurrentUser(null);
        setAuthMode('login');
        setAuthNotice('Your session expired. Please log in again.');
      })
      .finally(() => {
        setSessionLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!currentUser) {
      setSkipCancellationConfirmation(false);
      return;
    }
    try {
      setSkipCancellationConfirmation(
        localStorage.getItem(`turfcast-skip-cancel-confirmation:${currentUser.id}`) === 'true',
      );
    } catch {
      setSkipCancellationConfirmation(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    async function loadServerStore() {
      try {
        const response = await fetch('/api/store', { headers: authHeaders() });
        if (!response.ok) throw new Error('Server unavailable');
        const store = await response.json();
        const mergedSettings = { ...DEFAULT_SETTINGS, ...store.settings };
        setSettings(mergedSettings);
        setBookings(store.bookings);
        setPriceOverrides(store.priceOverrides || []);
        saveJson(STORAGE_KEYS.settings, mergedSettings);
        saveJson(STORAGE_KEYS.bookings, store.bookings);
        setSyncStatus('Live');
      } catch {
        setSyncStatus('Offline');
      }
    }

    loadServerStore();
  }, []);

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
      playerName: currentUser.name,
      phone: currentUser.phone,
      collegeId: currentUser.collegeId || '',
      bookedBy: currentUser.id,
      teamSize: Number(get('teamSize')) || 1,
      paymentMode: 'Pay at venue',
      paymentStatus: 'unpaid',
      notes: String(get('notes') || '').trim(),
      price: selectedSlot.price ?? settings.price,
      createdAt: new Date().toISOString(),
    };

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
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(nextBooking),
      });
      if (!response.ok) {
        const error = await response.json();
        return { ok: false, message: error.message || 'Could not save booking.' };
      }
      const store = await response.json();
      persistBookings(store.bookings);
      persistSettings(store.settings);
      setPriceOverrides(store.priceOverrides || []);
      const savedBooking = store.bookings.find((booking) =>
        booking.bookedBy === currentUser.id &&
        booking.date === activeDate &&
        booking.section === bookingSlot.section &&
        Number(booking.startHour) === Number(bookingSlot.hour),
      );
      setReceiptBooking(savedBooking || nextBooking);
      setBookingConfirmed(true);
      setSyncStatus('Live');
    } catch {
      setSyncStatus('Offline');
      return { ok: false, message: 'Booking could not be saved. Check your connection and try again.' };
    }

    setSelectedSlot(null);
    return { ok: true };
  }

  async function cancelBooking(bookingId) {
    try {
      const response = await fetch(`/api/bookings/${bookingId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const result = await response.json();
      if (!response.ok) {
        const message = result.message || 'Could not cancel booking.';
        setAppMessage(message);
        return { ok: false, message };
      }
      persistBookings(result.bookings);
      setSyncStatus('Live');
      setAppMessage('');
      return { ok: true };
    } catch (error) {
      setSyncStatus('Offline');
      setAppMessage(error.message || 'Booking could not be cancelled. Check your connection and try again.');
      return { ok: false, message: error.message || 'Booking could not be cancelled. Check your connection and try again.' };
    }
  }

  function requestBookingCancellation(booking) {
    if (isOwner) {
      return cancelBooking(booking.id);
    }
    if (!isStudentCancellationEligible(booking)) return;
    if (skipCancellationConfirmation) return cancelBooking(booking.id);
    setPendingCancellation(booking);
  }

  async function confirmBookingCancellation(booking, rememberChoice) {
    const result = await cancelBooking(booking.id);
    if (!result.ok) return result;
    if (rememberChoice) {
      try {
        localStorage.setItem(`turfcast-skip-cancel-confirmation:${currentUser.id}`, 'true');
        setSkipCancellationConfirmation(true);
      } catch {
        setAppMessage('Cancellation succeeded, but this device could not save your confirmation preference.');
      }
    }
    setPendingCancellation(null);
    return result;
  }

  async function saveSettings(nextSettings) {
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(nextSettings),
      });
      const store = await response.json();
      if (!response.ok) throw new Error(store.message || 'Could not save settings.');
      persistSettings(store.settings);
      persistBookings(store.bookings);
      setPriceOverrides(store.priceOverrides || []);
      setSyncStatus('Live');
      setAppMessage('');
      return true;
    } catch (error) {
      setSyncStatus('Offline');
      setAppMessage(error.message || 'Settings could not be saved. Check your connection and try again.');
      return false;
    }
  }

  async function savePriceOverride(priceOverride) {
    const response = await fetch('/api/pricing/overrides', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(priceOverride),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not save this slot price.');
    setPriceOverrides(result.priceOverrides || []);
    setSyncStatus('Live');
    return true;
  }

  async function saveDefaultPrice(price) {
    const response = await fetch('/api/pricing/default', {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ price }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not save the default price.');
    persistSettings(result.settings);
    persistBookings(result.bookings);
    setPriceOverrides(result.priceOverrides || []);
    setSyncStatus('Live');
    return true;
  }

  async function deactivatePriceOverride(id) {
    const response = await fetch(`/api/pricing/overrides/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not reset this slot price.');
    setPriceOverrides(result.priceOverrides || []);
    setSyncStatus('Live');
    return true;
  }

  async function markBookingPaid(id) {
    try {
      const response = await fetch(`/api/bookings/${id}/payment`, {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ paymentStatus: 'paid' }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not update payment status.');
      persistBookings(result.bookings);
      setSyncStatus('Live');
      setAppMessage('');
    } catch (error) {
      setSyncStatus('Offline');
      setAppMessage(error.message || 'Payment status could not be updated. Check your connection and try again.');
    }
  }

  function applyAuthenticatedSession(user, store, sessionToken) {
    const mergedSettings = { ...DEFAULT_SETTINGS, ...(store?.settings || settings) };
    setCurrentUser(user);
    setSettings(mergedSettings);
    setBookings(store?.bookings || bookings);
    setPriceOverrides(store?.priceOverrides || []);
    saveJson(STORAGE_KEYS.user, user);
    saveJson(STORAGE_KEYS.token, sessionToken);
    saveJson(STORAGE_KEYS.settings, mergedSettings);
    saveJson(STORAGE_KEYS.bookings, store?.bookings || bookings);
    setAuthError('');
  }

  async function handleAuthSubmit(mode, payload) {
    setAuthLoading(true);
    setAuthError('');
    setAuthNotice('');
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
        setAuthNotice(result.message || 'If an account with that email or phone exists, a password reset email has been sent.');
        return true;
      }
      if (mode === 'reset-password') {
        window.history.replaceState({}, '', window.location.pathname);
        setAuthMode('login');
        setAuthNotice(result.message || 'Password reset complete.');
        return true;
      }
      if (!result.sessionToken) {
        setAuthError('The server did not create a login session. Please try again.');
        return false;
      }
      if (!result.user || !['student', 'owner'].includes(result.user.role)) {
        setAuthError('The server did not return a valid account role. Please try again.');
        return false;
      }
      applyAuthenticatedSession(result.user, result.store, result.sessionToken);
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

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
    } catch {
      setSyncStatus('Offline');
    }
    localStorage.removeItem(STORAGE_KEYS.user);
    localStorage.removeItem(STORAGE_KEYS.token);
    localStorage.removeItem(STORAGE_KEYS.bookings);
    sessionStorage.removeItem('turf-admin');
    setCurrentUser(null);
    setBookings([]);
    setPendingCancellation(null);
    setAuthRole('student');
    setAuthMode('home');
  }

  async function saveProfile(profile) {
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(profile),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not save profile.');
      setCurrentUser(result.user);
      saveJson(STORAGE_KEYS.user, result.user);
      setShowProfile(false);
      setAppMessage('Profile updated.');
    } catch (error) {
      setAppMessage(error.message || 'Profile could not be saved.');
    }
  }

  function scrollToSection(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exportBookings() {
    const csvNumber = (value) => {
      if (value === null || value === undefined || value === '') return '';
      const number = Number(value);
      return Number.isFinite(number) ? number : '';
    };
    const headers = [
      'Booking ID',
      'Booking Date',
      'Start Time',
      'End Time',
      'Section',
      'Sport',
      'Student Name',
      'Phone Number',
      'College ID',
      'Players',
      'Price (INR)',
      'Payment Mode',
      'Payment Status',
      'Booking Status',
      'Notes',
      'Created At',
    ];
    const rows = bookings.map((booking) => [
      booking.id,
      formatDate(booking.date),
      formatHour(booking.startHour),
      formatHour(booking.endHour),
      booking.section,
      booking.sport,
      booking.playerName,
      booking.phone,
      booking.collegeId,
      csvNumber(booking.teamSize),
      csvNumber(booking.price),
      booking.paymentMode || 'Pay at venue',
      booking.paymentStatus === 'paid'
        ? 'Paid'
        : booking.paymentStatus === 'refunded' || booking.paymentStatus === 'cancelled'
          ? 'Refunded'
          : 'Unpaid',
      booking.cancelledAt ? 'Cancelled' : 'Confirmed',
      booking.notes,
      booking.createdAt && Number.isFinite(new Date(booking.createdAt).getTime())
        ? new Date(booking.createdAt).toLocaleString('en-IN')
        : '',
    ]);

    const csvCell = (cell) => {
      const value = String(cell ?? '').replace(/\r\n?|\n/g, ' ');
      const safeValue = /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safeValue.replaceAll('"', '""')}"`;
    };
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => typeof cell === 'number' ? String(cell) : csvCell(cell)).join(','))
      .join('\n');

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `turf-bookings-${toDateInput(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!currentUser) {
    if (sessionLoading) {
      return <main className="app-shell" role="status">Checking your session…</main>;
    }
    return (
      <AuthExperience
        authMode={authMode}
        authError={authError}
        authNotice={authNotice}
        authLoading={authLoading}
        settings={settings}
        bookings={bookings}
        authRole={authRole}
        onRoleChange={setAuthRole}
        onModeChange={(mode) => {
          setAuthMode(mode);
          setAuthError('');
          setAuthNotice('');
        }}
        onSubmit={handleAuthSubmit}
      />
    );
  }

  return (
    <main className={`app-shell product-shell ${isOwner ? 'owner-experience' : 'student-experience'}`}>
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
          {isOwner && <button className="ghost-button" type="button" onClick={exportBookings} title="Export bookings">
            <Download size={18} /><span>Export</span>
          </button>}
          {!isOwner && <button className="ghost-button" type="button" onClick={() => setShowProfile(true)}><UserRound size={18} /><span>Profile</span></button>}
          <span className={`sync-pill ${syncStatus.toLowerCase()}`}>{syncStatus}</span>
          <button className="icon-button" type="button" onClick={logout} title="Log out">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      {appMessage && <p className="form-error" role="alert">{appMessage}</p>}

      {!isOwner && <nav className="product-tabs" aria-label="Main navigation">
          <button type="button" onClick={() => scrollToSection('schedule')}><CalendarDays size={17} /><span>Browse & Book</span></button>
          <button type="button" onClick={() => scrollToSection('records')}><ClipboardCheck size={17} /><span>My Bookings</span></button>
      </nav>}

      {isOwner ? (
        <OwnerExperience
          page={ownerPage}
          onPageChange={(page) => {
            setOwnerPage(page);
            if (page === 'profile') setShowProfile(false);
          }}
          user={currentUser}
          bookings={bookings}
          activeBookings={activeBookings}
          filteredBookings={filteredBookings}
          settings={settings}
          search={search}
          sportFilter={sportFilter}
          onSearchChange={setSearch}
          onSportFilterChange={setSportFilter}
          onOpenSettings={() => setShowSettings(true)}
          priceOverrides={priceOverrides}
          slots={slots}
          onSaveDefaultPrice={saveDefaultPrice}
          onSavePriceOverride={savePriceOverride}
          onDeactivatePriceOverride={deactivatePriceOverride}
          onOpenProfile={() => setShowProfile(true)}
          onMarkPaid={markBookingPaid}
          onCancelBooking={cancelBooking}
          onViewBooking={(booking) => {
            setBookingConfirmed(false);
            setReceiptBooking(booking);
          }}
        />
      ) : <>
      <section className="simple-welcome">
        <div><p>College Turf</p><h2>Book your next game.</h2></div>
        <button className="primary-button" type="button" onClick={() => scrollToSection('schedule')}><CalendarDays size={18} /><span>Book a Slot</span></button>
      </section>

      <div className="student-sport-row">
        <label>Sport
          <select value={selectedSport} onChange={(event) => setSelectedSport(event.target.value)}>
            {settings.sports.map((sport) => <option key={sport}>{sport}</option>)}
          </select>
        </label>
      </div>
      <section className="date-runway student-dates" aria-label="Choose booking date">
        {quickDates.map((date, index) => {
          return (
            <button
              className={`date-pill ${activeDate === date ? 'active' : ''}`}
              type="button"
              key={date}
              onClick={() => setActiveDate(date)}
            >
              <span>{index === 0 ? 'Today' : new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(new Date(`${date}T00:00:00`))}</span>
              <strong>{new Date(`${date}T00:00:00`).getDate()}</strong>
              <small>{new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(new Date(`${date}T00:00:00`))}</small>
            </button>
          );
        })}
        <label className="date-picker">
          <span>Choose another date</span>
          <input type="date" min={today} max={latestBookingDate} value={activeDate} onChange={(event) => setActiveDate(event.target.value)} />
        </label>
      </section>

      <section className="workspace student-workspace" id="schedule">
        <section className="board-panel">
          <div className="section-heading">
            <div>
              <p>Choose a slot</p>
              <h2>Available slots · {formatDate(activeDate)}</h2>
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
                  const override = activeSlotPrice(priceOverrides, activeDate, section, hour);
                  const slotPrice = override?.price ?? settings.price;
                  return (
                    <button
                      type="button"
                      className={`slot-card ${booking ? 'booked' : 'available'} ${!booking && override?.type === 'promotion' ? 'special-price-card' : ''}`}
                      key={`${section}-${hour}`}
                      onClick={() => !booking && setSelectedSlot({ section, hour, price: slotPrice })}
                      disabled={Boolean(booking)}
                      title={booking ? 'Unavailable' : `Book ${section}`}
                    >
                      {booking ? (
                        <strong>Unavailable</strong>
                      ) : (
                        <>
                          <strong>{override?.type === 'promotion' ? 'Special Price' : 'Available'}</strong>
                          <small>{currency(slotPrice)}</small>
                          <span className="slot-book-label">Book</span>
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
            <p>{isOwner ? 'Turf operations' : 'My bookings'}</p>
            <h2>{isOwner ? 'Manage all reservations' : 'My Bookings'}</h2>
          </div>
          {isOwner && <div className="filter-strip">
            <Filter size={18} />
            <select value={sportFilter} onChange={(event) => setSportFilter(event.target.value)}>
              <option>All</option>
              {settings.sports.map((sport) => (
                <option key={sport}>{sport}</option>
              ))}
            </select>
          </div>}
          {isOwner && <div className="search-box">
            <Search size={18} />
            <input
              type="search"
              placeholder="Search booking"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>}
        </div>

        <div className="booking-list">
          {filteredBookings.length === 0 ? (
            <div className="empty-state">
              <Dumbbell size={26} />
              <p>{isOwner ? 'No bookings yet.' : 'No bookings yet. Choose a date and book your first slot.'}</p>
            </div>
          ) : (
            filteredBookings.map((booking) => (
              <article className="booking-row" key={booking.id}>
                <div className="booking-icon">
                  {isOwner ? <Users size={20} /> : <CalendarDays size={20} />}
                </div>
                <div>
                  <h3>{isOwner ? booking.playerName : booking.section}</h3>
                  <p>
                    {formatDate(booking.date)} · {formatHour(booking.startHour)}-{formatHour(booking.endHour)}
                  </p>
                </div>
                <div className="booking-tags">
                  <span>{booking.sport}</span>
                  {isOwner && <span>{booking.teamSize} players</span>}
                  {isOwner && <span>{booking.paymentMode || 'Pending'}</span>}
                  {isOwner && <span>{booking.paymentStatus || 'unpaid'}</span>}
                  {booking.cancelledAt && <span className="booking-status-cancelled">Cancelled</span>}
                  <span>{currency(booking.price)}</span>
                </div>
                {isOwner
                  ? <button className="icon-button" type="button" onClick={() => { setBookingConfirmed(false); setReceiptBooking(booking); }} title="View receipt"><Eye size={18} /></button>
                  : <button className="ghost-button booking-detail-button" type="button" onClick={() => { setBookingConfirmed(false); setReceiptBooking(booking); }} title="View booking confirmation"><span>Details</span></button>}
                {!booking.cancelledAt && isOwner &&
                  <button className="danger-button" type="button" onClick={() => requestBookingCancellation(booking)} title="Cancel booking"><Trash2 size={18} /></button>}
                {!booking.cancelledAt && !isOwner && booking.bookedBy === currentUser.id &&
                  (isStudentCancellationEligible(booking)
                    ? <button className="danger-button" type="button" onClick={() => requestBookingCancellation(booking)} title="Cancel booking"><Trash2 size={18} /></button>
                    : <button
                        className="ghost-button booking-detail-button cancellation-unavailable-button"
                        type="button"
                        disabled
                        title="Online cancellation is available only up to 24 hours before the booking."
                      ><span>Cancellation unavailable</span></button>)}
              </article>
            ))
          )}
        </div>
      </section>
      </>}

      {selectedSlot && (
        <BookingModal
          settings={settings}
          selectedSlot={selectedSlot}
          activeDate={activeDate}
          selectedSport={selectedSport}
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
            const saved = await saveSettings(nextSettings);
            if (saved) setShowSettings(false);
            return saved;
          }}
        />
      )}

      {receiptBooking && (
        <ReceiptModal
          booking={receiptBooking}
          confirmed={bookingConfirmed}
          student={!isOwner}
          onClose={() => { setReceiptBooking(null); setBookingConfirmed(false); }}
        />
      )}
      {showProfile && <ProfileModal user={currentUser} onClose={() => setShowProfile(false)} onSave={saveProfile} />}
      {pendingCancellation && <CancellationConfirmModal
        booking={pendingCancellation}
        onClose={() => setPendingCancellation(null)}
        onConfirm={(rememberChoice) => confirmBookingCancellation(pendingCancellation, rememberChoice)}
      />}

    </main>
  );
}

function AuthExperience({ authMode, authError, authNotice, authLoading, settings, bookings, authRole, onRoleChange, onModeChange, onSubmit }) {
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
          authNotice={authNotice}
          authLoading={authLoading}
          role={authRole}
          onRoleChange={onRoleChange}
          onModeChange={onModeChange}
          onSubmit={onSubmit}
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

function AuthPanel({ mode, authError, authNotice, authLoading, role, onRoleChange, onModeChange, onSubmit }) {
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
    <form key={mode} className="auth-panel" onSubmit={handleSubmit}>
      <div className="auth-panel-head">
        <div className="auth-icon">
          {isSignup ? <UserPlus size={22} /> : <LogIn size={22} />}
        </div>
        <div>
          <p>{panelKicker}</p>
          <h3>{panelTitle}</h3>
        </div>
      </div>

      {mode === 'forgot' ? <><label>Email or Phone<div className="input-with-icon"><Mail size={18} /><input name="identifier" type="text" placeholder="email or phone" /></div></label><p className="demo-link">{authNotice || 'We’ll email a password reset link to the address on your account.'}</p></> : mode === 'reset' ? <label>New Password<div className="input-with-icon"><Lock size={18} /><input name="password" type="password" placeholder="At least 6 characters" /></div></label> : <>
      <label>Account type<div className="input-with-icon"><ShieldCheck size={18} /><select name="role" value={role} onChange={(event) => onRoleChange(event.target.value)}><option value="student">Student / Customer</option><option value="owner">Turf Admin / Owner</option></select></div></label>
      {isSignup ? (
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
          {role === 'student' ? <label>
            College ID
            <div className="input-with-icon">
              <ClipboardCheck size={18} />
              <input name="collegeId" type="text" placeholder="Optional roll number" />
            </div>
          </label> : <>
            <label>Business / Turf Name<div className="input-with-icon"><Trophy size={18} /><input name="businessName" type="text" placeholder="College turf" /></div></label>
            <label>Owner Title<div className="input-with-icon"><UserRound size={18} /><input name="ownerTitle" type="text" placeholder="Owner or administrator" /></div></label>
            <label>Owner Invitation Code<div className="input-with-icon"><Lock size={18} /><input name="ownerSignupCode" type="password" autoComplete="off" required /></div></label>
          </>}
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
      </>}

      {mode !== 'forgot' && mode !== 'reset' && <label>
        Password
        <div className="input-with-icon">
          <Lock size={18} />
          <input name="password" type="password" placeholder="At least 6 characters" />
        </div>
      </label>}

      {authError && <p className="form-error">{authError}</p>}
      {authNotice && mode !== 'forgot' && <p className="demo-link">{authNotice}</p>}

      <button className="primary-button glow-button auth-submit" type="submit" disabled={authLoading}>
        {isSignup ? <UserPlus size={18} /> : <LogIn size={18} />}
        <span>{authLoading ? 'Working' : mode === 'forgot' ? 'Send reset email' : mode === 'reset' ? 'Set new password' : isSignup ? 'Create Account' : 'Login'}</span>
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

const ownerNavigation = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'bookings', label: 'Bookings', icon: ClipboardCheck },
  { id: 'pricing', label: 'Pricing', icon: IndianRupee },
  { id: 'analytics', label: 'Analytics', icon: Activity },
  { id: 'settings', label: 'Turf Settings', icon: Settings },
  { id: 'profile', label: 'Profile', icon: UserRound },
];

function OwnerExperience({
  page,
  onPageChange,
  user,
  bookings,
  activeBookings,
  filteredBookings,
  settings,
  search,
  sportFilter,
  onSearchChange,
  onSportFilterChange,
  onOpenSettings,
  priceOverrides,
  slots,
  onSaveDefaultPrice,
  onSavePriceOverride,
  onDeactivatePriceOverride,
  onOpenProfile,
  onMarkPaid,
  onCancelBooking,
  onViewBooking,
}) {
  return (
    <div className="owner-console">
      <nav className="owner-navigation" aria-label="Owner navigation">
        {ownerNavigation.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={page === id ? 'active' : ''}
            aria-current={page === id ? 'page' : undefined}
            onClick={() => {
              onPageChange(id);
            }}
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <header className="owner-page-heading">
        <div>
          <p>Owner workspace · {user.businessName || 'College turf'}</p>
          <h2>{page === 'dashboard' ? 'Run your turf.' : ownerNavigation.find((item) => item.id === page)?.label}</h2>
        </div>
        <span>{new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date())}</span>
      </header>

      {page === 'dashboard' && (
        <OwnerDashboard
          bookings={bookings}
          settings={settings}
          onOpenBookings={() => onPageChange('bookings')}
          onMarkPaid={onMarkPaid}
          onCancelBooking={onCancelBooking}
          onViewBooking={onViewBooking}
        />
      )}
      {page === 'bookings' && (
        <OwnerBookings
          bookings={filteredBookings}
          sports={settings.sports}
          search={search}
          sportFilter={sportFilter}
          onSearchChange={onSearchChange}
          onSportFilterChange={onSportFilterChange}
          onMarkPaid={onMarkPaid}
          onCancelBooking={onCancelBooking}
          onViewBooking={onViewBooking}
        />
      )}
      {page === 'pricing' && <OwnerPricing
        settings={settings}
        priceOverrides={priceOverrides}
        slots={slots}
        onSaveDefaultPrice={onSaveDefaultPrice}
        onSavePriceOverride={onSavePriceOverride}
        onDeactivatePriceOverride={onDeactivatePriceOverride}
      />}
      {page === 'analytics' && <OwnerAnalytics bookings={activeBookings} settings={settings} />}
      {page === 'settings' && <OwnerTurfSettings settings={settings} onEdit={onOpenSettings} />}
      {page === 'profile' && <OwnerProfile user={user} onEdit={onOpenProfile} />}
    </div>
  );
}

function OwnerDashboard({ bookings, settings, onOpenBookings, onMarkPaid, onCancelBooking, onViewBooking }) {
  const today = toDateInput(new Date());
  const todayDate = new Date(`${today}T00:00:00`);
  const weekStart = new Date(todayDate);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const monthStart = `${today.slice(0, 7)}-01`;
  const inRange = (booking, start, end = today) => booking.date >= start && booking.date <= end;
  const activeBookings = bookings.filter((booking) => !booking.cancelledAt);
  const collectedRevenue = (items) => items
    .filter((booking) => booking.paymentStatus === 'paid')
    .reduce((sum, booking) => sum + Number(booking.price || 0), 0);
  const todayBookings = activeBookings.filter((booking) => booking.date === today);
  const weekBookings = activeBookings.filter((booking) => inRange(booking, toDateInput(weekStart)));
  const monthBookings = activeBookings.filter((booking) => inRange(booking, monthStart));
  const capacity = makeTimeSlots(settings).length * settings.sections.length;
  const occupancy = capacity ? Math.round((todayBookings.length / capacity) * 100) : 0;
  const upcomingBookings = activeBookings
    .filter((booking) => booking.date >= today);
  const upcomingCount = upcomingBookings.length;
  const upcoming = [...upcomingBookings].sort((a, b) =>
    `${a.date}-${a.startHour}`.localeCompare(`${b.date}-${b.startHour}`),
  );
  const metrics = [
    { label: "Today's Bookings", value: todayBookings.length, note: 'Reservations scheduled today' },
    { label: "Today's Revenue", value: currency(collectedRevenue(todayBookings)), note: 'Payments collected' },
    { label: "Today's Occupancy", value: `${occupancy}%`, note: `${todayBookings.length} of ${capacity} available slots` },
    { label: 'Upcoming Bookings', value: upcomingCount, note: 'Next scheduled reservations' },
  ];
  const secondaryMetrics = [
    { label: "This Week's Revenue", value: currency(collectedRevenue(weekBookings)), note: 'Payments collected this week' },
    { label: "This Month's Revenue", value: currency(collectedRevenue(monthBookings)), note: 'Payments collected this month' },
    { label: 'Total Bookings', value: bookings.length, note: 'All bookings, including history' },
  ];
  const attentionBookings = activeBookings
    .filter((booking) => booking.date >= today && booking.paymentStatus !== 'paid')
    .sort((a, b) => `${a.date}-${a.startHour}`.localeCompare(`${b.date}-${b.startHour}`))
    .slice(0, 6);
  const historyStart = new Date(`${today}T00:00:00`);
  historyStart.setDate(historyStart.getDate() - 27);
  const historyStartDate = toDateInput(historyStart);
  const observedBookings = activeBookings.filter((booking) => booking.date >= historyStartDate && booking.date <= today);
  const slotHours = makeTimeSlots(settings);
  const opportunities = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const weekdayDates = Array.from({ length: 28 }, (_, index) => {
      const date = new Date(`${historyStartDate}T00:00:00`);
      date.setDate(date.getDate() + index);
      return date.getDay() === weekday;
    }).filter(Boolean).length;
    for (const hour of slotHours) {
      const count = observedBookings.filter((booking) =>
        new Date(`${booking.date}T00:00:00`).getDay() === weekday && Number(booking.startHour) === hour,
      ).length;
      const periodCapacity = weekdayDates * settings.sections.length;
      opportunities.push({
        weekday,
        hour,
        count,
        utilization: periodCapacity ? count / periodCapacity : 0,
      });
    }
  }
  const lowDemand = [...opportunities].sort((a, b) => a.utilization - b.utilization).slice(0, 3);
  const highDemand = [...opportunities].filter((period) => period.count > 0)
    .sort((a, b) => b.utilization - a.utilization).slice(0, 2);
  const formatOpportunity = ({ weekday, hour }) => {
    const dayLabel = new Intl.DateTimeFormat('en-IN', { weekday: 'long' }).format(new Date(2024, 0, 7 + weekday));
    return `${dayLabel} ${formatHour(hour)}–${formatHour(hour + settings.durationHours)}`;
  };

  return (
    <div className="owner-page-content">
      <section className="owner-metric-grid owner-primary-metrics" aria-label="Key turf metrics">
        {metrics.map((metric) => (
          <article className="owner-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </section>

      <section className="owner-metric-grid owner-secondary-metrics" aria-label="Revenue and total bookings">
        {secondaryMetrics.map((metric) => (
          <article className="owner-metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </section>

      <OwnerAttentionBookings
        bookings={attentionBookings}
        onViewBooking={onViewBooking}
        onMarkPaid={onMarkPaid}
        onCancelBooking={onCancelBooking}
      />
      <OwnerBookingOpportunities
        hasHistory={observedBookings.length > 0}
        lowDemand={lowDemand}
        highDemand={highDemand}
        formatPeriod={formatOpportunity}
      />
      <button className="owner-inline-link" type="button" onClick={onOpenBookings}>Open booking management <ArrowRight size={16} /></button>
    </div>
  );
}

function OwnerAttentionBookings({ bookings, onViewBooking, onMarkPaid, onCancelBooking }) {
  return (
    <section className="owner-panel owner-attention-panel">
      <div className="owner-panel-heading">
        <div><h3>Bookings needing attention</h3><p>Upcoming reservations with payment still due.</p></div>
        <span>{bookings.length}</span>
      </div>
      {bookings.length ? bookings.map((booking) => (
        <article className="owner-attention-row" key={booking.id}>
          <div className="owner-attention-student">
            <strong>{booking.playerName}</strong>
            <span>{booking.sport} · {formatDate(booking.date)} · {formatHour(booking.startHour)}–{formatHour(booking.endHour)} · {booking.section} · {booking.teamSize || 1} players</span>
          </div>
          <strong className="owner-attention-price">{currency(booking.price)}</strong>
          <span className="owner-status pending">{booking.paymentStatus === 'refunded' ? 'Refunded' : 'Unpaid'}</span>
          <div className="owner-booking-actions">
            <button className="owner-action-button" type="button" onClick={() => onViewBooking(booking)} aria-label={`View ${booking.playerName}'s booking`}><Eye size={16} /></button>
            {booking.paymentStatus !== 'paid' && booking.paymentStatus !== 'refunded' && <button className="owner-action-button" type="button" onClick={() => onMarkPaid(booking.id)}>Collect</button>}
            <button className="owner-action-button danger" type="button" onClick={() => onCancelBooking(booking.id)} aria-label={`Cancel ${booking.playerName}'s booking`}><Trash2 size={16} /></button>
          </div>
        </article>
      )) : <p className="owner-empty-note">No upcoming unpaid bookings.</p>}
    </section>
  );
}

function OwnerBookingOpportunities({ hasHistory, lowDemand, highDemand, formatPeriod }) {
  return (
    <section className="owner-panel owner-opportunities-panel">
      <div className="owner-panel-heading">
        <div><h3>Booking opportunities</h3><p>Utilization patterns from the last 28 days of booking records.</p></div>
      </div>
      {hasHistory ? <div className="owner-opportunity-grid">
        <div>
          <h4>Lower utilization</h4>
          {lowDemand.map((period) => (
            <div className="owner-opportunity-row" key={`low-${period.weekday}-${period.hour}`}>
              <span>{formatPeriod(period)}</span>
              <strong>{period.count === 0 ? 'No bookings' : 'Low demand'}</strong>
            </div>
          ))}
        </div>
        <div>
          <h4>Highly booked</h4>
          {highDemand.length ? highDemand.map((period) => (
            <div className="owner-opportunity-row" key={`high-${period.weekday}-${period.hour}`}>
              <span>{formatPeriod(period)}</span>
              <strong>{period.utilization >= 0.5 ? 'High demand' : 'Booked'}</strong>
            </div>
          )) : <p className="owner-empty-note">No highly booked periods in this range.</p>}
        </div>
      </div> : <p className="owner-empty-note">Booking opportunities will appear after booking activity is recorded.</p>}
    </section>
  );
}

function OwnerBookings({ bookings, sports, search, sportFilter, onSearchChange, onSportFilterChange, onMarkPaid, onCancelBooking, onViewBooking }) {
  return (
    <section className="owner-panel owner-bookings-panel">
      <div className="owner-panel-heading owner-bookings-heading">
        <div><h3>Booking management</h3><p>Review reservations, payment and booking status.</p></div>
        <div className="owner-booking-filters">
          <label className="owner-search"><Search size={16} /><input type="search" placeholder="Find a player or booking" value={search} onChange={(event) => onSearchChange(event.target.value)} /></label>
          <select aria-label="Filter bookings by sport" value={sportFilter} onChange={(event) => onSportFilterChange(event.target.value)}>
            <option>All</option>
            {sports.map((sport) => <option key={sport}>{sport}</option>)}
          </select>
        </div>
      </div>
      <div className="owner-booking-table" role="table" aria-label="Bookings">
        <div className="owner-booking-table-head" role="row">
          <span>Player</span><span>Date & time</span><span>Section</span><span>Sport</span><span>Players</span><span>Price</span><span>Payment</span><span>Status</span><span>Actions</span>
        </div>
        {bookings.length ? bookings.map((booking) => (
          <article className="owner-booking-table-row" role="row" key={booking.id}>
            <strong className="owner-player-cell">{booking.playerName}<small>{booking.id}</small></strong>
            <span>{formatDate(booking.date)}<small>{formatHour(booking.startHour)}–{formatHour(booking.endHour)}</small></span>
            <span>{booking.section}</span>
            <span>{booking.sport}</span>
            <span>{booking.teamSize || 1}</span>
            <strong>{currency(booking.price)}</strong>
            <span className={`owner-status ${booking.paymentStatus === 'paid' ? 'active' : booking.paymentStatus === 'refunded' ? 'cancelled' : 'pending'}`}>
              {booking.paymentStatus === 'paid' ? 'Collected' : booking.paymentStatus === 'refunded' ? 'Refunded' : 'Unpaid'}
            </span>
            <span className={`owner-status ${booking.cancelledAt ? 'cancelled' : 'active'}`}>{booking.cancelledAt ? 'Cancelled' : 'Confirmed'}</span>
            <div className="owner-booking-actions">
              <button className="owner-action-button" type="button" onClick={() => onViewBooking(booking)} aria-label={`View ${booking.playerName}'s booking`}><Eye size={16} /></button>
              {!booking.cancelledAt && booking.paymentStatus !== 'paid' && booking.paymentStatus !== 'refunded' && <button className="owner-action-button" type="button" onClick={() => onMarkPaid(booking.id)}>Collect</button>}
              {!booking.cancelledAt && <button className="owner-action-button danger" type="button" onClick={() => onCancelBooking(booking.id)} aria-label={`Cancel ${booking.playerName}'s booking`}><Trash2 size={16} /></button>}
            </div>
          </article>
        )) : <div className="owner-empty-note">No bookings match your filters.</div>}
      </div>
    </section>
  );
}

function OwnerPricing({
  settings,
  priceOverrides,
  slots,
  onSaveDefaultPrice,
  onSavePriceOverride,
  onDeactivatePriceOverride,
}) {
  const today = toDateInput(new Date());
  const latestDate = datePlus(Number(settings.bookingWindowDays));
  const [defaultPrice, setDefaultPrice] = useState(String(settings.price));
  const [slotDate, setSlotDate] = useState(() => datePlus(1));
  const [section, setSection] = useState(settings.sections[0] || '');
  const [startHour, setStartHour] = useState(slots[0] ?? '');
  const [slotPrice, setSlotPrice] = useState(String(settings.price));
  const [priceType, setPriceType] = useState('manual');
  const [savingDefault, setSavingDefault] = useState(false);
  const [savingSlot, setSavingSlot] = useState(false);
  const [defaultError, setDefaultError] = useState('');
  const [slotError, setSlotError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedOverride = activeSlotPrice(priceOverrides, slotDate, section, Number(startHour));
  const upcomingOverrides = priceOverrides
    .filter((override) => override.active && override.date >= today && override.date <= latestDate)
    .sort((a, b) => `${a.date}-${a.startHour}-${a.section}`.localeCompare(`${b.date}-${b.startHour}-${b.section}`));
  const dateSlots = slots.filter((hour) => isFutureBookingSlot(slotDate, hour));

  useEffect(() => {
    setDefaultPrice(String(settings.price));
  }, [settings.price]);

  useEffect(() => {
    setSlotPrice(String(selectedOverride?.price ?? settings.price));
    setPriceType(selectedOverride?.type ?? 'manual');
  }, [selectedOverride?.id, selectedOverride?.price, selectedOverride?.type, settings.price]);

  async function saveDefault(event) {
    event.preventDefault();
    const price = Number(defaultPrice);
    if (!Number.isSafeInteger(price) || price < 1 || price > 100000) {
      setDefaultError('Enter a whole-number price from ₹1 to ₹100,000.');
      return;
    }
    setSavingDefault(true);
    setDefaultError('');
    setNotice('');
    try {
      await onSaveDefaultPrice(price);
      setNotice('Default price saved.');
    } catch (error) {
      setDefaultError(error.message || 'Default price could not be saved.');
    } finally {
      setSavingDefault(false);
    }
  }

  async function saveSlotPrice(event) {
    event.preventDefault();
    const price = Number(slotPrice);
    if (!Number.isSafeInteger(price) || price < 1 || price > 100000) {
      setSlotError('Enter a whole-number price from ₹1 to ₹100,000.');
      return;
    }
    if (!dateSlots.includes(Number(startHour))) {
      setSlotError('Choose a future time slot.');
      return;
    }
    setSavingSlot(true);
    setSlotError('');
    setNotice('');
    try {
      await onSavePriceOverride({
        date: slotDate,
        section,
        startHour: Number(startHour),
        price,
        type: priceType,
      });
      setNotice(`${priceType === 'promotion' ? 'Special price' : 'Manual price'} saved for ${section}.`);
    } catch (error) {
      setSlotError(error.message || 'Slot price could not be saved.');
    } finally {
      setSavingSlot(false);
    }
  }

  async function resetSelectedOverride() {
    if (!selectedOverride) return;
    setSavingSlot(true);
    setSlotError('');
    setNotice('');
    try {
      await onDeactivatePriceOverride(selectedOverride.id);
      setNotice('Slot reset to the default price.');
    } catch (error) {
      setSlotError(error.message || 'Slot price could not be reset.');
    } finally {
      setSavingSlot(false);
    }
  }

  function editOverride(override) {
    setSlotDate(override.date);
    setSection(override.section);
    setStartHour(override.startHour);
    setSlotPrice(String(override.price));
    setPriceType(override.type);
    setSlotError('');
    setNotice('');
  }

  return (
    <div className="owner-pricing-page">
      <section className="owner-panel owner-pricing-default">
        <div>
          <p className="owner-kicker">Default Price</p>
          <h3>{currency(settings.price)} <span>/ {settings.durationHours} hours</span></h3>
          <p>Used for every slot unless a manual or special price is active.</p>
        </div>
        <form className="owner-default-price-form" onSubmit={saveDefault}>
          <label>
            Change default price
            <span><span aria-hidden="true">₹</span><input aria-label="Default price in INR" type="number" min="1" max="100000" step="1" value={defaultPrice} onChange={(event) => setDefaultPrice(event.target.value)} required /></span>
          </label>
          <button className="primary-button" type="submit" disabled={savingDefault}>{savingDefault ? 'Saving' : 'Save default'}</button>
        </form>
        {defaultError && <p className="form-error" role="alert">{defaultError}</p>}
      </section>

      <section className="owner-panel owner-slot-pricing">
        <div className="owner-panel-heading">
          <div><h3>Manage slot prices</h3><p>Set a one-time price for a specific upcoming date, section, and time.</p></div>
        </div>
        <form className="owner-slot-price-form" onSubmit={saveSlotPrice}>
          <label>
            Date
            <input type="date" min={today} max={latestDate} value={slotDate} onChange={(event) => {
              const nextDate = event.target.value;
              setSlotDate(nextDate);
              const nextSlots = slots.filter((hour) => isFutureBookingSlot(nextDate, hour));
              if (nextSlots.length) setStartHour(nextSlots[0]);
            }} required />
          </label>
          <label>
            Section
            <select value={section} onChange={(event) => setSection(event.target.value)} required>
              {settings.sections.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Time slot
            <select value={startHour} onChange={(event) => setStartHour(Number(event.target.value))} required>
              {slots.map((hour) => <option key={hour} value={hour} disabled={!isFutureBookingSlot(slotDate, hour)}>
                {formatHour(hour)}–{formatHour(hour + settings.durationHours)}{!isFutureBookingSlot(slotDate, hour) ? ' · Started' : ''}
              </option>)}
            </select>
          </label>
          <label>
            Price type
            <select value={priceType} onChange={(event) => setPriceType(event.target.value)}>
              <option value="manual">Manual price</option>
              <option value="promotion">Special Price</option>
            </select>
          </label>
          <label>
            {priceType === 'promotion' ? 'Promotional price' : 'Set price'} (INR)
            <span className="owner-rupee-input"><span aria-hidden="true">₹</span><input type="number" min="1" max="100000" step="1" value={slotPrice} onChange={(event) => setSlotPrice(event.target.value)} required /></span>
          </label>
          <div className="owner-slot-price-actions">
            <button className="primary-button" type="submit" disabled={savingSlot || !dateSlots.includes(Number(startHour))}>
              {savingSlot ? 'Saving' : 'Save Price'}
            </button>
            {selectedOverride && <button className="ghost-button" type="button" onClick={resetSelectedOverride} disabled={savingSlot}>Reset to default</button>}
          </div>
        </form>
        <div className="owner-current-slot-price" aria-live="polite">
          <span>{formatDate(slotDate)} · {section} · {formatHour(Number(startHour))}–{formatHour(Number(startHour) + settings.durationHours)}</span>
          <strong>Current: {currency(selectedOverride?.price ?? settings.price)}</strong>
          <small>Price type: {selectedOverride?.type === 'promotion' ? 'Special Price' : selectedOverride ? 'Manual' : 'Default'}</small>
        </div>
        {slotError && <p className="form-error" role="alert">{slotError}</p>}
      </section>

      <section className="owner-panel owner-upcoming-prices">
        <div className="owner-panel-heading">
          <div><h3>Upcoming slot prices</h3><p>Active custom prices; all other slots use the default.</p></div>
          <span>{upcomingOverrides.length}</span>
        </div>
        {upcomingOverrides.length ? <div className="owner-price-list">
          {upcomingOverrides.map((override) => (
            <article className="owner-price-row" key={override.id}>
              <div>
                <strong>{formatDate(override.date)} · {override.section}</strong>
                <span>{formatHour(override.startHour)}–{formatHour(override.startHour + settings.durationHours)} · {override.type === 'promotion' ? 'Special Price' : 'Manual'}</span>
              </div>
              <strong>{currency(override.price)}</strong>
              <div>
                <button className="owner-action-button" type="button" onClick={() => editOverride(override)}>Edit</button>
                <button className="owner-action-button danger" type="button" onClick={() => {
                  editOverride(override);
                  void (async () => {
                    setSavingSlot(true);
                    setSlotError('');
                    setNotice('');
                    try {
                      await onDeactivatePriceOverride(override.id);
                      setNotice('Slot reset to the default price.');
                    } catch (error) {
                      setSlotError(error.message || 'Slot price could not be deactivated.');
                    } finally {
                      setSavingSlot(false);
                    }
                  })();
                }} disabled={savingSlot}>{override.type === 'promotion' ? 'Deactivate' : 'Reset'}</button>
              </div>
            </article>
          ))}
        </div> : <p className="owner-empty-note">No custom slot prices are active in the booking window.</p>}
      </section>
      {notice && <p className="owner-pricing-notice" role="status">{notice}</p>}
    </div>
  );
}

function OwnerTurfSettings({ settings, onEdit }) {
  const details = [
    ['Base price', currency(settings.price)],
    ['Slot duration', `${settings.durationHours} hours`],
    ['Opening hours', `${formatHour(settings.openHour)}–${formatHour(settings.closeHour)}`],
    ['Sports', settings.sports.join(', ') || 'None configured'],
    ['Sections', settings.sections.join(', ') || 'None configured'],
    ['Booking window', `${settings.bookingWindowDays} days`],
    ['Maintenance dates', settings.maintenanceDates?.length ? settings.maintenanceDates.join(', ') : 'None scheduled'],
  ];
  return (
    <section className="owner-panel owner-settings-page">
      <div className="owner-panel-heading"><div><h3>Turf configuration</h3><p>Manage booking rules and the college turf schedule.</p></div></div>
      <dl className="owner-settings-list">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <button className="primary-button" type="button" onClick={onEdit}><Settings size={17} />Edit turf settings</button>
    </section>
  );
}

function OwnerProfile({ user, onEdit }) {
  const details = [
    ['Name', user.name],
    ['Email', user.email],
    ['Phone', user.phone],
    ['Business / turf', user.businessName || 'College turf'],
    ['Title', user.ownerTitle || 'Owner / administrator'],
    ['Role', 'Owner / Admin'],
  ];
  return (
    <section className="owner-panel owner-settings-page">
      <div className="owner-panel-heading"><div><h3>Owner profile</h3><p>Account details for the turf administrator.</p></div></div>
      <dl className="owner-settings-list">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <button className="primary-button" type="button" onClick={onEdit}><UserRound size={17} />Edit profile</button>
    </section>
  );
}

function OwnerAnalytics({ bookings, settings }) {
  const today = new Date(`${toDateInput(new Date())}T00:00:00`);
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(day.getDate() - (6 - index));
    const date = toDateInput(day);
    const dayBookings = bookings.filter((booking) => booking.date === date);
    return {
      date,
      label: new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(day),
      bookings: dayBookings.length,
      revenue: dayBookings.filter((booking) => booking.paymentStatus === 'paid').reduce((sum, booking) => sum + Number(booking.price || 0), 0),
    };
  });
  const sevenDayBookings = bookings.filter((booking) => booking.date >= days[0].date && booking.date <= toDateInput(today));
  const bySport = bookings.reduce((totals, booking) => {
    totals[booking.sport] = (totals[booking.sport] || 0) + 1;
    return totals;
  }, {});
  const sportData = Object.entries(bySport).map(([sport, count]) => ({ sport, count }));
  const timeData = makeTimeSlots(settings).map((hour) => {
    const count = sevenDayBookings.filter((booking) => Number(booking.startHour) === hour).length;
    const capacity = settings.sections.length * 7;
    return { hour, count, capacity, utilization: capacity ? Math.round((count / capacity) * 100) : 0 };
  });
  const busiest = timeData.reduce((best, period) => period.count > best.count ? period : best, { hour: null, count: 0 });
  const leastUsed = timeData.reduce((least, period) => period.count < least.count ? period : least, { hour: null, count: Infinity });
  return (
    <div className="owner-analytics-page">
      <div className="owner-chart-grid">
        <section className="owner-panel owner-chart-panel">
          <div className="owner-panel-heading"><div><h3>Bookings by day</h3><p>Scheduled over the last seven days.</p></div></div>
          <ResponsiveContainer width="100%" height={220}>
            <RechartsBarChart data={days} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="bookings" name="Bookings" fill="#18734b" radius={[5, 5, 0, 0]} />
            </RechartsBarChart>
          </ResponsiveContainer>
        </section>
        <section className="owner-panel owner-chart-panel">
          <div className="owner-panel-heading"><div><h3>Revenue by day</h3><p>Collected payments on scheduled bookings.</p></div></div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={days} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(value) => `₹${value}`} />
              <Tooltip formatter={(value) => currency(value)} />
              <Line type="monotone" dataKey="revenue" name="Collected" stroke="#18734b" strokeWidth={3} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </section>
      </div>
      <div className="owner-chart-grid owner-analysis-lists">
        <section className="owner-panel">
          <div className="owner-panel-heading"><div><h3>Bookings by sport</h3><p>Active reservations in stored records.</p></div></div>
          {sportData.length ? sportData.map(({ sport, count }) => (
            <div className="owner-bar-row" key={sport}><span>{sport}</span><div><i style={{ width: `${Math.max(8, (count / Math.max(...sportData.map((item) => item.count))) * 100)}%` }} /></div><strong>{count}</strong></div>
          )) : <p className="owner-empty-note">No booking data yet.</p>}
        </section>
        <section className="owner-panel">
          <div className="owner-panel-heading"><div><h3>Utilization by time</h3><p>Reserved sections against available sections.</p></div></div>
          <div className="owner-utilization-list">
            {timeData.map(({ hour, count, capacity, utilization }) => (
              <div className="owner-utilization-row" key={hour}>
                <span>{formatHour(hour)}</span><div><i style={{ width: `${utilization}%` }} /></div><strong>{utilization}%</strong>
              </div>
            ))}
          </div>
          <div className="owner-time-summary">
            <span>Busiest <strong>{busiest.count ? formatHour(busiest.hour) : 'No bookings'}</strong></span>
            <span>Least used <strong>{!sevenDayBookings.length ? 'No booking data' : leastUsed.hour === null ? 'No slots' : formatHour(leastUsed.hour)}</strong></span>
          </div>
        </section>
      </div>
    </div>
  );
}

function ProfileModal({ user, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const isOwner = user.role === 'owner';
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    await onSave(Object.fromEntries(new FormData(event.currentTarget).entries()));
    setSaving(false);
  }
  return <div className="modal-backdrop"><form className="modal" onSubmit={submit}>
    <div className="modal-header"><div><p>{isOwner ? 'Owner account' : 'Student account'}</p><h2>Profile</h2></div><button className="icon-button" type="button" onClick={onClose} title="Close"><X size={20} /></button></div>
    <label>Full name<input name="name" defaultValue={user.name} required /></label>
    <label>Email<input name="email" type="email" defaultValue={user.email} required /></label>
    <label>Phone<input name="phone" type="tel" defaultValue={user.phone} required /></label>
    {isOwner ? <>
      <label>Business / Turf Name<input name="businessName" defaultValue={user.businessName || ''} /></label>
      <label>Owner Title<input name="ownerTitle" defaultValue={user.ownerTitle || ''} /></label>
    </> : <label>College ID<input name="collegeId" defaultValue={user.collegeId || ''} /></label>}
    <div className="modal-actions"><button className="ghost-button" type="button" onClick={onClose}>Close</button><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving' : 'Save Profile'}</button></div>
  </form></div>;
}

function BookingModal({ settings, selectedSlot, activeDate, selectedSport, currentUser, onClose, onSave }) {
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
      <form className="modal student-booking-modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <p>Confirm your booking</p>
            <h2>{selectedSport} · {selectedSlot.section}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>

        <div className="slot-summary student-slot-summary">
          <span><small>Date</small>{formatDate(activeDate)}</span>
          <span><small>Time</small>{formatHour(selectedSlot.hour)}-{formatHour(selectedSlot.hour + settings.durationHours)}</span>
          <span><small>Final price</small><strong>{currency(selectedSlot.price ?? settings.price)}</strong></span>
        </div>

        <label>
          Player Name
          <input name="playerName" type="text" value={currentUser.name} readOnly autoFocus />
        </label>

        <label>
          Phone Number
          <input name="phone" type="tel" value={currentUser.phone} readOnly />
        </label>

        {currentUser.collegeId && <label>
          College ID
          <input name="collegeId" type="text" value={currentUser.collegeId} readOnly />
        </label>}
        <input type="hidden" name="sport" value={selectedSport} />
        <label>
          Number of players
          <input name="teamSize" type="number" min="1" step="1" defaultValue="10" required />
        </label>
        <label>
          Notes (optional)
          <textarea name="notes" rows="2" maxLength="500" placeholder="Anything the turf team should know?" />
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

function CancellationConfirmModal({ booking, onClose, onConfirm }) {
  const [rememberChoice, setRememberChoice] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function confirm(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const result = await onConfirm(rememberChoice);
    setSaving(false);
    if (!result.ok) setError(result.message || 'Could not cancel this booking.');
  }

  return (
    <div className="modal-backdrop">
      <form className="modal cancellation-confirmation" onSubmit={confirm} role="dialog" aria-modal="true" aria-labelledby="cancel-booking-title">
        <div className="modal-header">
          <div>
            <p>Booking cancellation</p>
            <h2 id="cancel-booking-title">Cancel this booking?</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close" disabled={saving}>
            <X size={20} />
          </button>
        </div>
        <div className="slot-summary">
          <span><small>Date</small>{formatDate(booking.date)}</span>
          <span><small>Time</small>{formatHour(booking.startHour)}-{formatHour(booking.endHour)}</span>
          <span><small>Section</small>{booking.section}</span>
        </div>
        <label className="confirmation-preference">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(event) => setRememberChoice(event.target.checked)}
          />
          Don't ask me again on this device
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose} disabled={saving}>Keep booking</button>
          <button className="danger-button" type="submit" disabled={saving}>
            {saving ? 'Cancelling' : 'Cancel booking'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SettingsModal({ settings, onClose, onSave }) {
  const [draft, setDraft] = useState(settings);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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

  async function handleSubmit(event) {
    event.preventDefault();
    const safeSettings = {
      ...draft,
      price: Math.max(1, Number(draft.price)),
      durationHours: Math.max(1, Number(draft.durationHours)),
      openHour: Math.max(0, Math.min(23, Number(draft.openHour))),
      closeHour: Math.max(1, Math.min(24, Number(draft.closeHour))),
      bookingWindowDays: Math.max(1, Number(draft.bookingWindowDays)),
      maxActiveBookingsPerPhone: Math.max(1, Number(draft.maxActiveBookingsPerPhone)),
      sections: draft.sections.length ? draft.sections : DEFAULT_SETTINGS.sections,
      sports: draft.sports.length ? draft.sports : DEFAULT_SETTINGS.sports,
      maintenanceDates: draft.maintenanceDates || [],
    };
    setSaving(true);
    setError('');
    try {
      const saved = await onSave(safeSettings);
      if (!saved) setError('Settings were not saved. Check the server connection and try again.');
    } catch (saveError) {
      setError(saveError.message || 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
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

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-button" type="submit" disabled={saving}>
            <Save size={18} />
            <span>{saving ? 'Saving' : 'Save Settings'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

function ReceiptModal({ booking, confirmed = false, student = false, onClose }) {
  function printReceipt() {
    window.print();
  }

  return (
    <div className="modal-backdrop">
      <section className="modal receipt-modal">
        <div className="modal-header no-print">
          <div>
            <p>{confirmed ? 'Booking confirmed' : student ? 'Booking details' : 'Booking receipt'}</p>
            <h2>{confirmed ? 'You’re all set!' : booking.id}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>
        {confirmed && <p className="confirmation-note">Your slot is reserved. You can find it anytime in My Bookings.</p>}
        <div className="receipt-card">
          <div className="receipt-top">
            <div className="brand-mark">
              <ClipboardCheck size={24} />
            </div>
            <div>
              <p>{student ? 'TurfCast · College Turf' : 'TurfCast · College Sports Desk'}</p>
              <h3>{student ? booking.sport : booking.playerName}</h3>
            </div>
          </div>
          <div className="receipt-grid">
            <ReceiptItem label="Date" value={formatDate(booking.date)} />
            <ReceiptItem label="Time" value={`${formatHour(booking.startHour)}-${formatHour(booking.endHour)}`} />
            <ReceiptItem label="Section" value={booking.section} />
            <ReceiptItem label="Sport" value={booking.sport} />
            {!student && <ReceiptItem label="Phone" value={booking.phone} />}
            {!student && <ReceiptItem label="College ID" value={booking.collegeId || 'Not added'} />}
            {!student && <ReceiptItem label="Players" value={booking.teamSize} />}
            {!student && <ReceiptItem label="Payment" value={booking.paymentMode || 'Pending'} />}
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
