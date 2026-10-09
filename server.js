import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import admin from 'firebase-admin';
import nodemailer from 'nodemailer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express(); const PORT = process.env.PORT || 4173;
const DEFAULT_TURF_LOCATION = 'Dharashiv, Maharashtra';
const defaults = { settings: { price: 600, durationHours: 3, openHour: 6, closeHour: 21, sections: ['Section A', 'Section B', 'Section C', 'Section D'], sports: ['Cricket', 'Football'], bookingWindowDays: 14, maxActiveBookingsPerPhone: 2, maintenanceDates: [], turfLocation: DEFAULT_TURF_LOCATION }, priceOverrides: [], bookings: [], users: [] };
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const databaseUrl = process.env.FIREBASE_DATABASE_URL;
const hasServiceAccount = Boolean(databaseUrl && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && privateKey);
function publicRtdbRef(path = '') {
  const base = databaseUrl.replace(/\/$/, ''); const endpoint = `${base}/${path ? `${path}/` : ''}.json`;
  async function request(method, value) { const response = await fetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) }); if (!response.ok) throw new Error(`RTDB REST request failed: ${response.status}`); return response.status === 204 ? null : response.json(); }
  return { once: async () => { const value = await request('GET'); return { val: () => value }; }, set: (value) => request('PUT', value), update: (value) => request('PATCH', value), remove: () => request('DELETE') };
}
let db;
if (hasServiceAccount) { admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey }), databaseURL: databaseUrl }); db = admin.database(); }
else if (databaseUrl && process.env.FIREBASE_ALLOW_PUBLIC_REST === 'true') { db = { ref: publicRtdbRef }; console.warn('Using public RTDB REST demo mode. Add service-account credentials before production.'); }
else console.warn('Firebase credentials are missing; using data/store.json for app data.');
const smtpUser = process.env.SMTP_USER;
const smtpAppPassword = process.env.SMTP_APP_PASSWORD?.replace(/\s/g, '');
const smtpPort = Number(process.env.SMTP_PORT || 465);
const mailTransport = smtpUser && smtpAppPassword
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: smtpPort,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : smtpPort === 465,
      auth: { user: smtpUser, pass: smtpAppPassword },
    })
  : null;
app.use(express.json());
const list = (v) => Array.isArray(v) ? v : Object.values(v || {});
const MAX_PRICE_INR = 100000;
const isValidPrice = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_PRICE_INR;
function indiaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function normalizePriceOverrides(overrides, settings) {
  const activeOverrides = new Map();
  const normalized = list(overrides || []).flatMap((override) => {
    const date = String(override?.date || '');
    const section = String(override?.section || '');
    const startHour = Number(override?.startHour);
    if (
      !override ||
      typeof override.id !== 'string' ||
      !isValidDateValue(date) ||
      !settings.sections.includes(section) ||
      !Number.isSafeInteger(startHour) ||
      !slots(settings).includes(startHour) ||
      !isValidPrice(override.price) ||
      !['manual', 'promotion'].includes(override.type) ||
      typeof override.active !== 'boolean'
    ) return [];
    return [{
      id: override.id,
      date,
      section,
      startHour,
      price: override.price,
      type: override.type,
      active: override.active,
      createdAt: String(override.createdAt || ''),
      updatedAt: String(override.updatedAt || ''),
    }];
  });
  for (const override of normalized) {
    if (!override.active) continue;
    const key = `${override.date}|${override.section}|${override.startHour}`;
    const previous = activeOverrides.get(key);
    if (previous) previous.active = false;
    activeOverrides.set(key, override);
  }
  return normalized;
}
const normalizeBooking = (booking = {}) => ({
  ...booking,
  paymentMode: booking.paymentMode === 'UPI' ? 'Pay at venue' : (booking.paymentMode || 'Pay at venue'),
  paymentStatus: booking.paymentStatus === 'cancelled' ? 'refunded' : (booking.paymentStatus || 'unpaid'),
});
const rolesNeedMigration = Symbol('rolesNeedMigration');
function normalizeUserRoles(users) {
  let needsMigration = false;
  const normalizedUsers = list(users || []).map((user) => {
    const role = user.role === 'owner' ? 'owner' : 'student';
    if (role !== user.role) needsMigration = true;
    return { ...user, role };
  });
  return { users: normalizedUsers, needsMigration };
}
const normalizeStore = (store = {}, forceRoleMigration = false) => {
  const storedSettings = { ...(store.settings || {}) };
  const turfLocation = typeof storedSettings.turfLocation === 'string' && storedSettings.turfLocation.trim()
    ? storedSettings.turfLocation.trim()
    : DEFAULT_TURF_LOCATION;
  const normalizedUsers = normalizeUserRoles(store.users);
  delete storedSettings.adminPin;
  const normalized = {
    settings: {
      ...defaults.settings,
      ...storedSettings,
      price: isValidPrice(storedSettings.price) ? storedSettings.price : defaults.settings.price,
      turfLocation,
    },
    priceOverrides: normalizePriceOverrides(store.priceOverrides, {
      ...defaults.settings,
      ...storedSettings,
    }),
    bookings: list(store.bookings || []).map(normalizeBooking),
    users: normalizedUsers.users,
  };
  Object.defineProperty(normalized, rolesNeedMigration, {
    value: forceRoleMigration || normalizedUsers.needsMigration,
  });
  return normalized;
};
const storePath = path.join(__dirname, 'data', 'store.json');
async function readFileStore() {
  try {
    return normalizeStore(JSON.parse(await fs.readFile(storePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeStore(defaults);
    throw error;
  }
}
async function readStore() {
  const fileStore = await readFileStore();
  if (!db) return fileStore;
  const [settings, priceOverrides, bookings, users] = await Promise.all(['settings', 'priceOverrides', 'bookings', 'users'].map((node) => db.ref(node).once('value')));
  const mergedUsers = new Map(fileStore.users.map((user) => [user.id, user]));
  const firebaseUsers = list(users.val() || []);
  for (const user of firebaseUsers) mergedUsers.set(user.id, user);
  return normalizeStore({
    settings: settings.val() || {},
    priceOverrides: priceOverrides.val() || [],
    bookings: bookings.val() || [],
    users: [...mergedUsers.values()],
  }, fileStore[rolesNeedMigration] || firebaseUsers.some((user) => !['student', 'owner'].includes(user.role)));
}
const WEATHER_PROVIDER = 'Open-Meteo';
const WEATHER_CACHE_FILE = path.join(__dirname, 'data', 'weather-cache.json');
const WEATHER_FRESH_MS = 15 * 60 * 1000;
const WEATHER_STALE_MS = 3 * 60 * 60 * 1000;
const LOCATION_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const weatherCache = { locations: {}, forecasts: {} };
let weatherCacheLoaded;
let weatherCacheWriteQueue = Promise.resolve();

class WeatherProviderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function unavailableWeather(status, message, details = {}) {
  return {
    available: false,
    status,
    message,
    provider: WEATHER_PROVIDER,
    retrievedAt: null,
    servedAt: new Date().toISOString(),
    freshness: 'unavailable',
    cached: false,
    ...details,
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function loadWeatherCache() {
  if (!weatherCacheLoaded) {
    weatherCacheLoaded = fs.readFile(WEATHER_CACHE_FILE, 'utf8')
      .then((text) => {
        const saved = JSON.parse(text);
        if (saved?.version === 1 && isRecord(saved.locations) && isRecord(saved.forecasts)) {
          Object.assign(weatherCache, saved);
        }
      })
      .catch((error) => {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
          console.warn('[Weather cache]', JSON.stringify({ status: 'read_failed', message: error.message }));
        } else if (error instanceof SyntaxError) {
          console.warn('[Weather cache]', JSON.stringify({ status: 'invalid_cache_file' }));
        }
      });
  }
  return weatherCacheLoaded;
}

function persistWeatherCache() {
  weatherCacheWriteQueue = weatherCacheWriteQueue
    .catch(() => {})
    .then(async () => {
      const temporaryPath = `${WEATHER_CACHE_FILE}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.mkdir(path.dirname(WEATHER_CACHE_FILE), { recursive: true });
        await fs.writeFile(temporaryPath, `${JSON.stringify({ version: 1, ...weatherCache })}\n`, 'utf8');
        await fs.rename(temporaryPath, WEATHER_CACHE_FILE);
      } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => {});
        console.warn('[Weather cache]', JSON.stringify({ status: 'write_failed', message: error.message }));
      }
    });
  return weatherCacheWriteQueue;
}

async function fetchWeatherJson(url, provider) {
  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch (error) {
    throw new WeatherProviderError(
      error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'provider_unavailable',
      error?.name === 'TimeoutError' || error?.name === 'AbortError'
        ? `${provider} did not respond before the weather request timed out.`
        : `${provider} could not be reached.`,
    );
  }
  if (!response.ok) {
    throw new WeatherProviderError('provider_unavailable', `${provider} returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new WeatherProviderError('invalid_provider_response', `${provider} returned invalid JSON.`);
  }
}

function normalizeLocationQuery(location) {
  return location.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function normalizeCityName(value) {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

async function resolveWeatherLocation(location) {
  if (typeof location !== 'string' || !location.trim()) {
    throw new WeatherProviderError('location_missing', 'Set the turf city or location in Turf Settings to enable weather.');
  }
  await loadWeatherCache();
  const query = location.trim().replace(/\s+/g, ' ');
  const cacheKey = normalizeLocationQuery(query);
  const cached = weatherCache.locations[cacheKey];
  if (cached && Date.now() - cached.resolvedAt < LOCATION_CACHE_MS &&
      finiteNumber(cached.latitude) && finiteNumber(cached.longitude) &&
      typeof cached.name === 'string' && typeof cached.timezone === 'string') {
    return { ...cached, query };
  }

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', query);
  url.searchParams.set('count', '10');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  url.searchParams.set('countryCode', 'IN');
  const result = await fetchWeatherJson(url, 'Open-Meteo Geocoding API');
  if (!isRecord(result) || (result.results !== undefined && !Array.isArray(result.results))) {
    throw new WeatherProviderError('invalid_provider_response', 'Open-Meteo Geocoding API returned an invalid location response.');
  }
  const results = (result.results || []).filter((item) =>
    isRecord(item) &&
    item.country_code === 'IN' &&
    finiteNumber(item.latitude) &&
    finiteNumber(item.longitude) &&
    typeof item.name === 'string' &&
    typeof item.timezone === 'string',
  );
  const [requestedName, ...qualifierParts] = query.split(',');
  const qualifier = normalizeCityName(qualifierParts.join(','));
  const exactResults = results.filter((item) =>
    normalizeCityName(item.name) === normalizeCityName(requestedName) &&
    (!qualifier || [item.admin1, item.admin2, item.country].some((part) => normalizeCityName(part) === qualifier)),
  );
  const candidates = exactResults.length ? exactResults : results.length === 1 ? results : [];
  if (!candidates.length) {
    if (results.length > 1 || exactResults.length > 1) {
      throw new WeatherProviderError('location_ambiguous', 'The saved turf location matches multiple Indian places. Add its state, for example “Dharashiv, Maharashtra”.');
    }
    throw new WeatherProviderError('location_not_found', 'The saved turf location could not be resolved. Enter a recognized city and state in Turf Settings.');
  }
  if (candidates.length !== 1) {
    throw new WeatherProviderError('location_ambiguous', 'The saved turf location matches multiple Indian places. Add its state, for example “Dharashiv, Maharashtra”.');
  }
  const match = candidates[0];
  const resolved = {
    name: match.name,
    admin1: typeof match.admin1 === 'string' ? match.admin1 : null,
    country: typeof match.country === 'string' ? match.country : 'India',
    latitude: match.latitude,
    longitude: match.longitude,
    timezone: match.timezone,
    resolvedAt: Date.now(),
  };
  weatherCache.locations[cacheKey] = resolved;
  await persistWeatherCache();
  return { ...resolved, query };
}

function validateForecastResponse(data) {
  return isRecord(data) &&
    finiteNumber(data.latitude) &&
    finiteNumber(data.longitude) &&
    data.timezone === 'Asia/Kolkata' &&
    isRecord(data.current) &&
    typeof data.current.time === 'string' &&
    finiteNumber(data.current.temperature_2m) &&
    isRecord(data.daily) &&
    Array.isArray(data.daily.time) &&
    Array.isArray(data.daily.weather_code) &&
    Array.isArray(data.daily.temperature_2m_min) &&
    Array.isArray(data.daily.temperature_2m_max) &&
    data.daily.time.length > 0 &&
    data.daily.time.length === data.daily.weather_code.length &&
    data.daily.time.length === data.daily.temperature_2m_min.length &&
    data.daily.time.length === data.daily.temperature_2m_max.length &&
    isRecord(data.hourly) &&
    Array.isArray(data.hourly.time) &&
    Array.isArray(data.hourly.temperature_2m) &&
    Array.isArray(data.hourly.weather_code) &&
    data.hourly.time.length > 0 &&
    data.hourly.time.length === data.hourly.temperature_2m.length &&
    data.hourly.time.length === data.hourly.weather_code.length &&
    (!data.hourly.precipitation_probability ||
      (Array.isArray(data.hourly.precipitation_probability) &&
        data.hourly.time.length === data.hourly.precipitation_probability.length)) &&
    (!data.hourly.precipitation ||
      (Array.isArray(data.hourly.precipitation) &&
        data.hourly.time.length === data.hourly.precipitation.length));
}

async function fetchOpenMeteoForecast(location) {
  const cacheKey = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
  await loadWeatherCache();
  const cached = weatherCache.forecasts[cacheKey];
  const age = cached ? Date.now() - cached.retrievedAt : Infinity;
  if (cached && age >= 0 && age < WEATHER_FRESH_MS && validateForecastResponse(cached.data)) {
    return { data: cached.data, retrievedAt: cached.retrievedAt, freshness: 'fresh', ageMs: age };
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m');
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,precipitation,weather_code');
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset');
  url.searchParams.set('timezone', 'Asia/Kolkata');
  url.searchParams.set('forecast_days', '16');
  try {
    const data = await fetchWeatherJson(url, WEATHER_PROVIDER);
    if (!validateForecastResponse(data)) {
      throw new WeatherProviderError('invalid_provider_response', 'Open-Meteo returned an incomplete forecast response.');
    }
    const retrievedAt = Date.now();
    weatherCache.forecasts[cacheKey] = { data, retrievedAt };
    await persistWeatherCache();
    return { data, retrievedAt, freshness: 'live', ageMs: 0 };
  } catch (error) {
    if (cached && validateForecastResponse(cached.data)) {
      const cachedAge = Date.now() - cached.retrievedAt;
      if (cachedAge >= 0 && cachedAge <= WEATHER_STALE_MS) {
        return { data: cached.data, retrievedAt: cached.retrievedAt, freshness: 'stale', ageMs: cachedAge };
      }
    }
    throw error;
  }
}

function weatherSummary(code) {
  const descriptions = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snowfall',
    73: 'Moderate snowfall',
    75: 'Heavy snowfall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };
  return Number.isInteger(code) ? descriptions[code] || null : null;
}

function weatherConditions(date, hour, location, forecast, servedAt = new Date().toISOString()) {
  const { data, retrievedAt, freshness, ageMs } = forecast;
  const dateIndex = data.daily.time.indexOf(date);
  if (dateIndex < 0) {
    return unavailableWeather('date_out_of_range', 'The requested date is outside the available 16-day forecast.', {
      provider: WEATHER_PROVIDER,
      location,
      forecastRange: {
        from: data.daily.time[0] || null,
        through: data.daily.time.at(-1) || null,
      },
      retrievedAt: new Date(retrievedAt).toISOString(),
      servedAt,
      freshness,
      cached: freshness === 'stale' || freshness === 'fresh',
      dataAgeSeconds: Math.floor(ageMs / 1000),
      warnings: {
        available: false,
        provider: 'India Meteorological Department',
        status: 'credentials_required',
        message: 'Official IMD warning data is not included because its documented API returned HTTP 401 during verification.',
      },
    });
  }
  const current = isRecord(data.current) ? data.current : {};
  const currentConditions = {
    type: 'modelled_current',
    observed: false,
    validAt: typeof current.time === 'string' ? current.time : null,
  };
  if (finiteNumber(current.temperature_2m)) currentConditions.temperatureC = current.temperature_2m;
  if (finiteNumber(current.relative_humidity_2m)) currentConditions.relativeHumidityPercent = current.relative_humidity_2m;
  if (finiteNumber(current.apparent_temperature)) currentConditions.apparentTemperatureC = current.apparent_temperature;
  if (finiteNumber(current.precipitation)) currentConditions.precipitationMm = current.precipitation;
  if (finiteNumber(current.rain)) current.rainMm = current.rain;
  if (Number.isInteger(current.weather_code)) {
    currentConditions.weatherCode = current.weather_code;
    const summary = weatherSummary(current.weather_code);
    if (summary) currentConditions.summary = summary;
  }
  if (finiteNumber(current.wind_speed_10m)) currentConditions.windSpeedKmh = current.wind_speed_10m;

  const dailyCode = data.daily.weather_code[dateIndex];
  const daily = {
    date,
    minimumTemperatureC: finiteNumber(data.daily.temperature_2m_min[dateIndex])
      ? data.daily.temperature_2m_min[dateIndex]
      : null,
    maximumTemperatureC: finiteNumber(data.daily.temperature_2m_max[dateIndex])
      ? data.daily.temperature_2m_max[dateIndex]
      : null,
    weatherCode: Number.isInteger(dailyCode) ? dailyCode : null,
  };
  const dailySummary = weatherSummary(daily.weatherCode);
  if (dailySummary) daily.summary = dailySummary;
  if (typeof data.daily.sunrise?.[dateIndex] === 'string') daily.sunrise = data.daily.sunrise[dateIndex];
  if (typeof data.daily.sunset?.[dateIndex] === 'string') daily.sunset = data.daily.sunset[dateIndex];

  const targetTime = `${date}T${String(hour).padStart(2, '0')}:00`;
  const hourIndex = data.hourly.time.indexOf(targetTime);
  let hourly = null;
  if (hourIndex >= 0) {
    const code = data.hourly.weather_code[hourIndex];
    hourly = { date, time: targetTime };
    if (finiteNumber(data.hourly.temperature_2m[hourIndex])) hourly.temperatureC = data.hourly.temperature_2m[hourIndex];
    if (finiteNumber(data.hourly.precipitation_probability?.[hourIndex])) {
      hourly.precipitationProbabilityPercent = data.hourly.precipitation_probability[hourIndex];
    }
    if (finiteNumber(data.hourly.precipitation?.[hourIndex])) hourly.precipitationMm = data.hourly.precipitation[hourIndex];
    if (Number.isInteger(code)) {
      hourly.weatherCode = code;
      const summary = weatherSummary(code);
      if (summary) hourly.summary = summary;
    }
  }
  const probability = hourly?.precipitationProbabilityPercent;
  const response = {
    available: true,
    status: 'available',
    provider: WEATHER_PROVIDER,
    location: {
      query: location.query,
      name: location.name,
      admin1: location.admin1,
      country: location.country,
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: location.timezone,
      resolvedBy: 'Open-Meteo Geocoding API',
    },
    retrievedAt: new Date(retrievedAt).toISOString(),
    servedAt,
    freshness,
    cached: freshness === 'stale' || freshness === 'fresh',
    dataAgeSeconds: Math.floor(ageMs / 1000),
    currentConditions,
    observation: null,
    today: {
      date: data.daily.time[0],
      minimumTemperatureC: finiteNumber(data.daily.temperature_2m_min[0]) ? data.daily.temperature_2m_min[0] : null,
      maximumTemperatureC: finiteNumber(data.daily.temperature_2m_max[0]) ? data.daily.temperature_2m_max[0] : null,
      weatherCode: Number.isInteger(data.daily.weather_code[0]) ? data.daily.weather_code[0] : null,
      ...(weatherSummary(data.daily.weather_code[0]) ? { summary: weatherSummary(data.daily.weather_code[0]) } : {}),
    },
    requestedDate: daily,
    hourly,
    warnings: {
      available: false,
      provider: 'India Meteorological Department',
      status: 'credentials_required',
      message: 'Official IMD warning data is not included because its documented API returned HTTP 401 during verification.',
    },
  };
  if (typeof probability === 'number') {
    response.probability = probability;
    response.risk = probability >= 65 ? 'High' : probability >= 35 ? 'Medium' : 'Low';
  }
  return response;
}

async function getWeather(date, hour, location) {
  if (!isValidDateValue(date)) {
    return unavailableWeather('invalid_date', 'Use a valid requested date in YYYY-MM-DD format.');
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return unavailableWeather('invalid_hour', 'Requested booking time must be an hour from 0 to 23.');
  }
  try {
    const resolvedLocation = await resolveWeatherLocation(location);
    const forecast = await fetchOpenMeteoForecast(resolvedLocation);
    return weatherConditions(date, hour, resolvedLocation, forecast);
  } catch (error) {
    if (error instanceof WeatherProviderError) {
      return unavailableWeather(error.status, error.message, {
        warnings: {
          available: false,
          provider: 'India Meteorological Department',
          status: 'credentials_required',
          message: 'Official IMD warning data is not included because its documented API returned HTTP 401 during verification.',
        },
      });
    }
    console.error('[Weather advisor]', error);
    return unavailableWeather('provider_unavailable', 'Weather data is temporarily unavailable. Booking services remain available.');
  }
}

async function weatherRisk(date, hour, location) {
  const weather = await getWeather(date, hour, location);
  if (!weather.available) return weather;
  return {
    ...weather,
    source: WEATHER_PROVIDER,
  };
}
function demandScore(bookings, date, hour, section, risk) { const target = new Date(`${date}T00:00:00`); const weighted = bookings.filter((b) => b.section === section && Number(b.startHour) === Number(hour) && new Date(`${b.date}T00:00:00`).getDay() === target.getDay() && !b.cancelledAt && b.paymentStatus !== 'refunded').reduce((n, b) => n + Math.max(.2, 1 - Math.max(0, (target - new Date(`${b.date}T00:00:00`)) / 86400000) / 220), 0); const weatherFactor = risk === 'High' ? .65 : risk === 'Medium' ? .82 : 1; return Math.min(100, Math.round(weighted * 16 * weatherFactor)); }
async function writeFileStore(store) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  const temporaryPath = `${storePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, storePath);
}
async function writeStore(store) {
  if (!db) return writeFileStore(store);
  await db.ref().update({ settings: store.settings, priceOverrides: store.priceOverrides, bookings: store.bookings, users: store.users });
}
async function writeUsers(users) {
  if (db) return db.ref('users').set(users);
  const store = await readFileStore();
  store.users = users;
  await writeFileStore(store);
}
async function persistRoleMigration(store) {
  if (store[rolesNeedMigration]) await writeUsers(store.users);
}
let storeMutationQueue = Promise.resolve();
function withStoreLock(operation) {
  const result = storeMutationQueue.then(operation, operation);
  storeMutationQueue = result.then(() => undefined, () => undefined);
  return result;
}
async function readHistoricalBookings() {
  if (!db) return [];
  return list((await db.ref('historicalBookings').once('value')).val());
}
const slots = (s) => { const out = []; for (let h = s.openHour; h + s.durationHours <= s.closeHour; h += s.durationHours) out.push(h); return out; };
const today = () => new Date().toISOString().slice(0, 10);
const hash = (p, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(p, salt, 64).toString('hex')}`;
const matches = (p, stored) => { const [salt, saved] = String(stored || '').split(':'); if (!salt || !saved) return false; const a = crypto.scryptSync(p, salt, 64); const b = Buffer.from(saved, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const sessionHash = (token) => crypto.createHash('sha256').update(token).digest('hex');
function authenticatedUser(store, req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const tokenDigest = Buffer.from(sessionHash(token), 'hex');
  return store.users.find((user) => {
    const storedDigest = Buffer.from(String(user.sessionTokenHash || ''), 'hex');
    return storedDigest.length === tokenDigest.length && crypto.timingSafeEqual(storedDigest, tokenDigest);
  }) || null;
}
const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const normalizePhone = (value = '') => {
  const digits = String(value).replace(/\D/g, '').replace(/^0+/, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.slice(-10);
};
const constantTimeEquals = (left, right) => {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};
const normalizeIdentifier = (value = '') => {
  const input = String(value).trim();
  if (!input) return '';
  return input.includes('@') ? normalizeEmail(input) : normalizePhone(input);
};
const publicStoreForUser = (store, user) => ({
  ...publicStore(store),
  bookings: user?.role === 'owner'
    ? publicStore(store).bookings
    : publicStore(store).bookings.map((booking) => {
        const ownBooking = user && booking.bookedBy === user.id;
        if (ownBooking) return booking;
        return {
          id: booking.id,
          date: booking.date,
          section: booking.section,
          startHour: booking.startHour,
          endHour: booking.endHour,
          sport: booking.sport,
          price: booking.price,
          cancelledAt: booking.cancelledAt,
        };
      }),
});
const publicUser = (u) => u && ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  role: u.role === 'owner' ? 'owner' : 'student',
  collegeId: u.collegeId || '',
  businessName: u.businessName || '',
  ownerTitle: u.ownerTitle || '',
  createdAt: u.createdAt,
});
const publicStore = (s) => ({
  settings: s.settings,
  bookings: (s.bookings || []).map(normalizeBooking),
  priceOverrides: s.priceOverrides || [],
});
function configuredAppUrl() {
  const configuredUrl = String(process.env.APP_BASE_URL || '').trim();
  if (!configuredUrl) return null;
  try {
    const url = new URL(configuredUrl);
    const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!isLocalHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}
function bookingStartTimestamp(date, hour) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day, Number(hour)) - 330 * 60 * 1000;
}
function isValidDateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const route = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (e) { next(e); } };

app.get('/api/store', route(async (req, res) => {
  const store = await readStore();
  res.json(publicStoreForUser(store, authenticatedUser(store, req)));
}));
app.get('/api/ai/owner-recommendations', route(async (req, res) => {
  const store = await readStore();
  if (authenticatedUser(store, req)?.role !== 'owner') {
    return res.status(403).json({ message: 'Owner access is required to view AI recommendations.' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ message: 'AI recommendations are not configured yet. Set GEMINI_API_KEY on the server.' });
  }

  const currentDate = today();
  const activeBookings = store.bookings.filter((booking) => !booking.cancelledAt);
  const upcomingBookings = activeBookings.filter((booking) =>
    booking.date > currentDate ||
    (booking.date === currentDate && bookingStartTimestamp(booking.date, booking.startHour) >= Date.now()),
  );
  const historyStart = new Date(`${currentDate}T00:00:00.000Z`);
  historyStart.setUTCDate(historyStart.getUTCDate() - 27);
  const historyStartDate = historyStart.toISOString().slice(0, 10);
  const recentBookings = activeBookings.filter((booking) =>
    booking.date >= historyStartDate && booking.date <= currentDate,
  );
  const countBy = (items, keyFn, field = 'name') => {
    const counts = new Map();
    for (const item of items) {
      const key = keyFn(item);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()].map(([key, count]) => ({ [field]: key, bookings: count }));
  };
  const slotHours = slots(store.settings);
  const periodUsage = slotHours.map((hour) => {
    const matching = recentBookings.filter((booking) => Number(booking.startHour) === hour).length;
    const capacity = 28 * store.settings.sections.length;
    return {
      startTime: `${String(hour).padStart(2, '0')}:00`,
      bookings: matching,
      capacity,
      utilizationPercent: capacity ? Math.round((matching / capacity) * 100) : 0,
    };
  });
  const orderedPeriods = [...periodUsage].sort((a, b) => a.utilizationPercent - b.utilizationPercent);
  const activeOverrides = store.priceOverrides.filter((override) =>
    override.active && override.date >= currentDate && override.date <= (() => {
      const lastDate = new Date(`${currentDate}T00:00:00.000Z`);
      lastDate.setUTCDate(lastDate.getUTCDate() + Number(store.settings.bookingWindowDays));
      return lastDate.toISOString().slice(0, 10);
    })(),
  );
  const businessContext = {
    asOfDate: currentDate,
    bookingsToday: activeBookings.filter((booking) => booking.date === currentDate).length,
    upcomingBookingsCount: upcomingBookings.length,
    upcomingByDate: countBy(upcomingBookings, (booking) => booking.date, 'date').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 14),
    recentPeriodDays: 28,
    recentBookingVolume: recentBookings.length,
    recentBookingsBySport: countBy(recentBookings, (booking) => booking.sport, 'sport'),
    recentBookingsBySection: countBy(recentBookings, (booking) => booking.section, 'section'),
    recentBookingsByTimeSlot: countBy(recentBookings, (booking) => Number(booking.startHour), 'hour').map((item) => ({
      startTime: `${String(item.hour).padStart(2, '0')}:00`,
      bookings: item.bookings,
    })),
    lowUtilizationPeriods: orderedPeriods.slice(0, 2),
    highUtilizationPeriods: [...periodUsage].sort((a, b) => b.utilizationPercent - a.utilizationPercent).slice(0, 2),
    defaultPriceINR: store.settings.price,
    activeCustomPrices: activeOverrides.length,
    activeCustomPriceExamples: activeOverrides.slice(0, 10).map((override) => ({
      date: override.date,
      section: override.section,
      startTime: `${String(override.startHour).padStart(2, '0')}:00`,
      priceINR: override.price,
      type: override.type,
    })),
    bookingWindowDays: store.settings.bookingWindowDays,
    sectionCount: store.settings.sections.length,
    slotsPerDay: slotHours.length,
    totalDailySlotCapacity: slotHours.length * store.settings.sections.length,
  };
  const prompt = [
    'You are a practical business analyst for a single college turf booking business.',
    'Use only the supplied TurfCast business data. Do not invent bookings, prices, weather, or other facts.',
    'Give 3 to 5 concise, actionable recommendations focused on increasing bookings and utilization.',
    'Order recommendations from the most useful, actionable, and directly supported by the supplied data to the least useful. If booking history is sparse, say so and avoid claiming established trends.',
    'Pricing suggestions are optional recommendations only; never imply that you changed or will automatically change a price.',
    'Do not recommend weather-based pricing. Do not invent causes when the data does not establish them.',
    'Return only JSON in this exact shape: {"recommendations":[{"title":"...","reason":"...","action":"..."}]}.',
    'Keep each title brief and each reason/action to one or two short sentences.',
    `TurfCast data: ${JSON.stringify(businessContext)}`,
  ].join('\n');
  const model = String(process.env.GEMINI_MODEL || 'gemini-3.5-flash').replace(/^models\//, '');
  const safeGoogleMessage = (message) => String(message || '')
    .replaceAll(apiKey, '[redacted]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 800);
  const logGeminiFailure = (details) => {
    console.error('[Gemini owner recommendations]', JSON.stringify({ model, ...details }));
  };
  let geminiResponse;
  try {
    geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(20000),
      },
    );
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    logGeminiFailure({
      category: timedOut ? 'timeout' : 'network',
      error: timedOut ? 'Gemini request timed out.' : safeGoogleMessage(error?.cause?.code || error?.message || 'Network request failed.'),
    });
    return res.status(timedOut ? 504 : 502).json({
      message: timedOut
        ? 'Gemini took too long to respond. Please try again.'
        : 'Could not connect to Gemini. Check the server network connection and try again.',
    });
  }
  if (!geminiResponse.ok) {
    let errorBody = {};
    try {
      errorBody = await geminiResponse.json();
    } catch {
      errorBody = {};
    }
    const googleError = errorBody.error || {};
    const googleMessage = safeGoogleMessage(googleError.message);
    const normalizedError = `${googleError.status || ''} ${googleMessage}`.toLowerCase();
    let category = 'server';
    let message = 'Gemini is temporarily unavailable. Please try again shortly.';
    let status = 502;
    if (geminiResponse.status === 401 || /api key|credential|unauthenticated/.test(normalizedError)) {
      category = 'credentials';
      message = 'Gemini rejected the server credentials. Check GEMINI_API_KEY configuration.';
      status = 503;
    } else if (/quota|rate limit|resource_exhausted/.test(normalizedError) || geminiResponse.status === 429) {
      category = 'quota';
      message = 'Gemini is at its request or usage limit. Please try again later.';
      status = 429;
    } else if (geminiResponse.status === 404) {
      category = 'model';
      message = 'The configured Gemini model is unavailable. Set GEMINI_MODEL to an available generateContent model, such as gemini-3.5-flash.';
      status = 503;
    } else if (geminiResponse.status === 400) {
      category = 'request';
      message = 'Gemini rejected the recommendation request. Check GEMINI_MODEL and the server request configuration.';
      status = 502;
    } else if (geminiResponse.status === 403) {
      category = 'permission';
      message = 'Gemini denied this request. Check the API key permissions and Gemini API access.';
      status = 503;
    } else if (geminiResponse.status >= 500) {
      category = 'service';
      message = 'Gemini is temporarily experiencing a service issue. Please try again shortly.';
      status = 503;
    }
    logGeminiFailure({
      category,
      httpStatus: geminiResponse.status,
      googleCode: googleError.code || null,
      googleStatus: googleError.status || null,
      googleMessage: googleMessage || 'Google returned no error message.',
    });
    return res.status(status).json({ message });
  }

  let generated;
  let result;
  try {
    result = await geminiResponse.json();
  } catch (error) {
    logGeminiFailure({ category: 'response_parse', error: safeGoogleMessage(error?.message || 'Gemini returned invalid JSON.') });
    return res.status(502).json({ message: 'Gemini returned an unreadable response. Please try again.' });
  }
  const candidate = result.candidates?.[0];
  const blockedReason = result.promptFeedback?.blockReason;
  if (blockedReason || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'MODEL_ARMOR'].includes(candidate?.finishReason)) {
    const reason = blockedReason || candidate.finishReason;
    logGeminiFailure({ category: 'blocked', blockReason: reason });
    return res.status(422).json({ message: 'Gemini could not process this recommendation request. Please try again.' });
  }
  const responseText = candidate?.content?.parts?.map((part) => part.text || '').join('').trim() || '';
  if (!responseText) {
    logGeminiFailure({
      category: candidate?.finishReason && candidate.finishReason !== 'STOP' ? 'incomplete_response' : 'empty_response',
      finishReason: candidate?.finishReason || null,
    });
    return res.status(502).json({ message: 'Gemini returned no recommendations. Please try again.' });
  }
  try {
    generated = JSON.parse(responseText);
  } catch {
    logGeminiFailure({
      category: candidate?.finishReason && candidate.finishReason !== 'STOP' ? 'incomplete_response' : 'response_parse',
      finishReason: candidate?.finishReason || null,
    });
    return res.status(502).json({ message: 'AI recommendations could not be read. Please try again shortly.' });
  }
  const recommendations = Array.isArray(generated?.recommendations)
    ? generated.recommendations
        .filter((item) =>
          item &&
          typeof item.title === 'string' &&
          typeof item.reason === 'string' &&
          typeof item.action === 'string',
        )
        .slice(0, 5)
        .map((item) => ({
          title: item.title.trim().slice(0, 100),
          reason: item.reason.trim().slice(0, 300),
          action: item.action.trim().slice(0, 300),
        }))
        .filter((item) => item.title && item.reason && item.action)
    : [];
  if (recommendations.length < 3) {
    logGeminiFailure({
      category: 'response_schema',
      finishReason: candidate?.finishReason || null,
      validRecommendationCount: recommendations.length,
    });
    return res.status(502).json({ message: 'AI recommendations could not be generated. Please try again shortly.' });
  }
  res.json({ recommendations });
}));
app.get('/api/weather-risk', route(async (req, res) => {
  const store = await readStore();
  res.json(await weatherRisk(String(req.query.date || today()), Number(req.query.hour || 18), store.settings.turfLocation));
}));
app.get('/api/weather', route(async (req, res) => {
  const store = await readStore();
  const date = req.query.date === undefined ? indiaToday() : String(req.query.date);
  const hourValue = req.query.hour === undefined ? '18' : String(req.query.hour);
  const hour = /^\d{1,2}$/.test(hourValue) ? Number(hourValue) : Number.NaN;
  const weather = await getWeather(date, hour, store.settings.turfLocation);
  if (weather.available) return res.json(weather);
  const statusCode = ['invalid_date', 'invalid_hour'].includes(weather.status)
    ? 400
    : ['location_missing', 'location_ambiguous', 'location_not_found', 'date_out_of_range'].includes(weather.status)
      ? 422
      : 503;
  res.status(statusCode).json(weather);
}));
app.get('/api/forecast', route(async (req, res) => {
  const store = await readStore();
  if (authenticatedUser(store, req)?.role !== 'owner') {
    return res.status(403).json({ message: 'Owner access is required to view the forecast.' });
  }
  const historical = await readHistoricalBookings();
  const data = [];
  for (let day = 0; day < 7; day += 1) {
    const dateValue = new Date();
    dateValue.setDate(dateValue.getDate() + day);
    const date = dateValue.toISOString().slice(0, 10);
    const weather = await weatherRisk(date, 18, store.settings.turfLocation);
    const values = store.settings.sections.flatMap((section) =>
      slots(store.settings).map((hour) => demandScore([...historical, ...store.bookings], date, hour, section, weather.available ? weather.risk : null)),
    );
    data.push({
      date,
      label: dateValue.toLocaleDateString('en-IN', { weekday: 'short' }),
      demand: Math.round(values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1)),
      risk: weather.available ? weather.risk : 'Unavailable',
      weather,
    });
  }
  res.json(data);
}));
app.get('/api/price-suggestions', route(async (req, res) => {
  const store = await readStore();
  if (authenticatedUser(store, req)?.role !== 'owner') {
    return res.status(403).json({ message: 'Owner access is required to view pricing suggestions.' });
  }
  const date = String(req.query.date || '');
  const section = String(req.query.section || '');
  const hour = Number(req.query.hour);
  const currentDate = today();
  const lastBookingDate = new Date(`${currentDate}T00:00:00.000Z`);
  lastBookingDate.setUTCDate(lastBookingDate.getUTCDate() + Number(store.settings.bookingWindowDays));
  if (
    !isValidDateValue(date) ||
    !store.settings.sections.includes(section) ||
    !Number.isSafeInteger(hour) ||
    !slots(store.settings).includes(hour) ||
    date < currentDate ||
    date > lastBookingDate.toISOString().slice(0, 10) ||
    bookingStartTimestamp(date, hour) <= Date.now()
  ) {
    return res.status(400).json({ message: 'Choose a future date, section, and time within the booking window.' });
  }
  if (store.settings.maintenanceDates.includes(date)) {
    return res.status(400).json({ message: 'Price advice is unavailable for a turf maintenance date.' });
  }
  const alreadyBooked = store.bookings.some((booking) =>
    booking.date === date &&
    booking.section === section &&
    Number(booking.startHour) === hour &&
    !booking.cancelledAt &&
    booking.paymentStatus !== 'refunded',
  );
  if (alreadyBooked) {
    return res.status(409).json({ message: 'This section and time already have a booking.' });
  }

  const historical = await readHistoricalBookings();
  const comparableDays = new Set();
  const targetWeekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  for (let offset = 1; offset <= 84; offset += 1) {
    const priorDate = new Date(`${date}T00:00:00.000Z`);
    priorDate.setUTCDate(priorDate.getUTCDate() - offset);
    if (priorDate.getUTCDay() === targetWeekday) comparableDays.add(priorDate.toISOString().slice(0, 10));
  }
  const comparableBookings = [...historical, ...store.bookings].filter((booking) =>
    comparableDays.has(booking.date) &&
    booking.section === section &&
    Number(booking.startHour) === hour &&
    !booking.cancelledAt &&
    booking.paymentStatus !== 'refunded',
  );
  const bookedDates = new Set(comparableBookings.map((booking) => booking.date));
  const demandScore = comparableDays.size
    ? Math.round((bookedDates.size / comparableDays.size) * 100)
    : 0;
  const historySufficient = bookedDates.size >= 4;
  const demandLevel = demandScore >= 60 ? 'high' : demandScore < 25 ? 'low' : 'moderate';
  const basePrice = store.settings.price;
  const multiplier = !historySufficient ? 1 : demandLevel === 'high' ? 1.1 : demandLevel === 'low' ? 0.9 : 1;
  const suggestedPrice = Math.max(1, Math.min(MAX_PRICE_INR, Math.round((basePrice * multiplier) / 50) * 50));
  const weather = await weatherRisk(date, hour, store.settings.turfLocation);
  const demandExplanation = !historySufficient
    ? `Only ${bookedDates.size} comparable bookings were found in the last 12 weeks. The default price is the safer starting point until more slot history is available.`
    : `${bookedDates.size} of ${comparableDays.size} comparable ${new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`))} slots in this section and time were booked in the last 12 weeks.`;
  res.json({
    date,
    section,
    hour,
    suggestedPrice,
    demand: {
      level: historySufficient ? demandLevel : 'limited',
      score: historySufficient ? demandScore : null,
      comparableBookings: bookedDates.size,
      comparableOpportunities: comparableDays.size,
      historySufficient,
    },
    explanation: `${demandExplanation} The suggested price is based on comparable booking demand only; weather does not change it.`,
    weather,
  });
}));
app.post('/api/auth/signup', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const phone = normalizePhone(req.body.phone);
    const password = String(req.body.password || '');
    const requestedRole = String(req.body.role || 'student');
    if (!name || !email || !phone || !password) return { status: 400, body: { message: 'Name, email, phone, and password are required.' } };
    if (!['student', 'owner'].includes(requestedRole)) return { status: 400, body: { message: 'Choose student or owner account type.' } };
    const ownerSignupCode = String(process.env.OWNER_SIGNUP_CODE || '');
    if (requestedRole === 'owner' && (!ownerSignupCode || !constantTimeEquals(req.body.ownerSignupCode || '', ownerSignupCode))) {
      return { status: 403, body: { message: 'A valid owner invitation code is required to create an owner account.' } };
    }
    const role = requestedRole;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 400, body: { message: 'Enter a valid email address.' } };
    if (!/^[6-9]\d{9}$/.test(phone)) return { status: 400, body: { message: 'Enter a valid 10-digit Indian phone number.' } };
    if (password.length < 6) return { status: 400, body: { message: 'Password must be at least 6 characters.' } };
    if (store.users.some((user) => normalizeEmail(user.email) === email || normalizePhone(user.phone) === phone)) {
      return { status: 409, body: { message: 'An account is already registered with this email or phone number.' } };
    }
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const user = {
      id: `USR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
      name,
      email,
      phone,
      role,
      collegeId: String(req.body.collegeId || '').trim(),
      businessName: role === 'owner' ? String(req.body.businessName || '').trim() : '',
      ownerTitle: role === 'owner' ? String(req.body.ownerTitle || '').trim() : '',
      passwordHash: hash(password),
      sessionTokenHash: sessionHash(sessionToken),
      createdAt: new Date().toISOString(),
    };
    store.users.push(user);
    await writeUsers(store.users);
    return { status: 201, body: { user: publicUser(user), store: publicStoreForUser(store, user), sessionToken } };
  });
  res.status(result.status).json(result.body);
}));
app.post('/api/auth/login', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    await persistRoleMigration(store);
    const identifier = normalizeIdentifier(req.body.identifier);
    const user = store.users.find((record) => normalizeEmail(record.email) === identifier || normalizePhone(record.phone) === identifier);
    if (!user || !matches(String(req.body.password || ''), user.passwordHash)) {
      return { status: 401, body: { message: 'Incorrect email/phone or password. Please try again.' } };
    }
    if (req.body.role && req.body.role !== user.role) {
      return { status: 403, body: { message: `This account is registered as a ${user.role}.` } };
    }
    const sessionToken = crypto.randomBytes(32).toString('hex');
    user.sessionTokenHash = sessionHash(sessionToken);
    await writeUsers(store.users);
    return { status: 200, body: { user: publicUser(user), store: publicStoreForUser(store, user), sessionToken } };
  });
  res.status(result.status).json(result.body);
}));
app.get('/api/auth/session', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    await persistRoleMigration(store);
    const user = authenticatedUser(store, req);
    if (!user) return { status: 401, body: { message: 'Please log in again to continue.' } };
    return { status: 200, body: { user: publicUser(user) } };
  });
  res.status(result.status).json(result.body);
}));
app.post('/api/auth/logout', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (user) {
      user.sessionTokenHash = '';
      await writeUsers(store.users);
    }
    return { status: 200, body: { ok: true } };
  });
  res.status(result.status).json(result.body);
}));
app.put('/api/profile', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (!user) return { status: 401, body: { message: 'Please log in again to update your profile.' } };
    const userId = user.id;
    const name = req.body.name === undefined ? user.name : String(req.body.name).trim();
    const email = req.body.email === undefined ? user.email : normalizeEmail(req.body.email);
    const phone = req.body.phone === undefined ? user.phone : normalizePhone(req.body.phone);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[6-9]\d{9}$/.test(phone)) {
      return { status: 400, body: { message: 'Enter a name, valid email, and valid 10-digit Indian phone number.' } };
    }
    if (store.users.some((record) => record.id !== userId && (normalizeEmail(record.email) === email || normalizePhone(record.phone) === phone))) {
      return { status: 409, body: { message: 'An account is already registered with this email or phone number.' } };
    }
    user.name = name;
    user.email = email;
    user.phone = phone;
    user.role = user.role === 'owner' ? 'owner' : 'student';
    user.collegeId = String(req.body.collegeId ?? user.collegeId ?? '').trim();
    if (user.role === 'owner') {
      user.businessName = String(req.body.businessName ?? user.businessName ?? '').trim();
      user.ownerTitle = String(req.body.ownerTitle ?? user.ownerTitle ?? '').trim();
    }
    await writeUsers(store.users);
    return { status: 200, body: { user: publicUser(user) } };
  });
  res.status(result.status).json(result.body);
}));
app.post('/api/auth/forgot-password', route(async (req, res) => {
  if (!mailTransport) {
    return res.status(503).json({
      message: 'Password email is not configured. Add SMTP_USER and SMTP_APP_PASSWORD to the server .env file.',
    });
  }
  const baseUrl = configuredAppUrl();
  if (!baseUrl) {
    return res.status(503).json({
      message: 'Password reset is not configured. Set APP_BASE_URL to the canonical application URL.',
    });
  }
  const reset = await withStoreLock(async () => {
    const store = await readStore();
    const identifier = normalizeIdentifier(req.body.identifier);
    const user = store.users.find((record) => normalizeEmail(record.email) === identifier || normalizePhone(record.phone) === identifier);
    if (!user) return null;
    const token = crypto.randomBytes(24).toString('hex');
    user.passwordReset = { token, expiresAt: Date.now() + 15 * 60 * 1000, createdAt: new Date().toISOString() };
    await writeUsers(store.users);
    return { userId: user.id, email: user.email, token };
  });
  if (reset) {
    const resetLink = `${baseUrl}/?reset=${encodeURIComponent(reset.token)}`;
    try {
      await mailTransport.sendMail({
        from: { name: 'TurfCast', address: smtpUser },
        to: reset.email,
        subject: 'Reset your TurfCast password',
        text: `We received a request to reset your TurfCast password. This link expires in 15 minutes:\n\n${resetLink}\n\nIf you did not request a reset, you can ignore this email.`,
        html: `<p>We received a request to reset your TurfCast password.</p><p><a href="${resetLink}">Reset your password</a></p><p>This link expires in 15 minutes. If you did not request a reset, you can ignore this email.</p>`,
      });
    } catch (error) {
      console.error('Password reset email delivery failed:', error);
      await withStoreLock(async () => {
        const store = await readStore();
        const user = store.users.find((record) => record.id === reset.userId);
        if (user?.passwordReset?.token === reset.token) {
          delete user.passwordReset;
          await writeUsers(store.users);
        }
      });
      return res.status(502).json({ message: 'Could not send the password reset email. Check the Gmail SMTP configuration and try again.' });
    }
  }
  res.json({ message: 'If an account with that email or phone exists, a password reset email has been sent.' });
}));
app.post('/api/auth/reset-password', route(async (req, res) => {
  const token = String(req.body.token || '');
  const password = String(req.body.password || '');
  if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = store.users.find((record) => record.passwordReset?.token === token);
    if (!user || Date.now() >= Number(user.passwordReset.expiresAt)) return null;
    user.passwordHash = hash(password);
    delete user.passwordReset;
    await writeUsers(store.users);
    return true;
  });
  if (!result) return res.status(400).json({ message: 'This reset link is invalid or has expired.' });
  res.json({ message: 'Password reset. You can now log in.' });
}));
app.put('/api/settings', route(async (req, res) => {
  const store = await withStoreLock(async () => {
    const current = await readStore();
    const user = authenticatedUser(current, req);
    if (user?.role !== 'owner') return { status: 403, body: { message: 'Owner access is required to update turf settings.' } };
    const old = current.settings;
    const settingsInput = req.body;
    const price = Object.hasOwn(settingsInput, 'price') ? settingsInput.price : old.price;
    if (!isValidPrice(price)) {
      return { status: 400, body: { message: `Price must be a whole-number INR amount between ₹1 and ₹${MAX_PRICE_INR}.` } };
    }
    current.settings = {
      ...old,
      ...settingsInput,
      turfLocation: typeof settingsInput.turfLocation === 'string'
        ? settingsInput.turfLocation.trim().slice(0, 120) || old.turfLocation || DEFAULT_TURF_LOCATION
        : old.turfLocation || DEFAULT_TURF_LOCATION,
      price,
      durationHours: Math.max(1, Number(settingsInput.durationHours)),
      openHour: Math.max(0, Math.min(23, Number(settingsInput.openHour))),
      closeHour: Math.max(1, Math.min(24, Number(settingsInput.closeHour))),
      sections: Array.isArray(settingsInput.sections) && settingsInput.sections.length ? settingsInput.sections : old.sections,
      sports: Array.isArray(settingsInput.sports) && settingsInput.sports.length ? settingsInput.sports : old.sports,
      bookingWindowDays: Math.max(1, Number(settingsInput.bookingWindowDays || old.bookingWindowDays)),
      maxActiveBookingsPerPhone: Math.max(1, Number(settingsInput.maxActiveBookingsPerPhone || old.maxActiveBookingsPerPhone)),
      maintenanceDates: Array.isArray(settingsInput.maintenanceDates) ? settingsInput.maintenanceDates : old.maintenanceDates,
    };
    await writeStore(current);
    return { status: 200, body: publicStore(current) };
  });
  res.status(store.status).json(store.body);
}));
app.put('/api/pricing/default', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (user?.role !== 'owner') return { status: 403, body: { message: 'Owner access is required to update the default price.' } };
    if (!isValidPrice(req.body.price)) {
      return { status: 400, body: { message: `Price must be a whole-number INR amount between ₹1 and ₹${MAX_PRICE_INR}.` } };
    }
    store.settings.price = req.body.price;
    await writeStore(store);
    return { status: 200, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.put('/api/pricing/overrides', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (user?.role !== 'owner') return { status: 403, body: { message: 'Owner access is required to manage slot prices.' } };

    const { date, section, startHour, price, type } = req.body;
    if (
      typeof date !== 'string' ||
      !isValidDateValue(date) ||
      typeof section !== 'string' ||
      !store.settings.sections.includes(section) ||
      !Number.isSafeInteger(startHour) ||
      !slots(store.settings).includes(startHour) ||
      bookingStartTimestamp(date, startHour) <= Date.now()
    ) {
      return { status: 400, body: { message: 'Choose a valid date, section, and time slot.' } };
    }
    if (!isValidPrice(price)) {
      return { status: 400, body: { message: `Price must be a whole-number INR amount between ₹1 and ₹${MAX_PRICE_INR}.` } };
    }
    if (!['manual', 'promotion'].includes(type)) {
      return { status: 400, body: { message: 'Choose a manual or promotional price type.' } };
    }
    const lastBookingDate = new Date(`${today()}T00:00:00.000Z`);
    lastBookingDate.setUTCDate(lastBookingDate.getUTCDate() + Number(store.settings.bookingWindowDays));
    if (date < today() || date > lastBookingDate.toISOString().slice(0, 10)) {
      return { status: 400, body: { message: `Choose a date within the ${store.settings.bookingWindowDays}-day booking window.` } };
    }
    const key = (item) => item.date === date && item.section === section && item.startHour === startHour;
    const existing = store.priceOverrides.find((item) => item.active && key(item));
    const now = new Date().toISOString();
    if (existing) {
      existing.price = price;
      existing.type = type;
      existing.updatedAt = now;
    } else {
      store.priceOverrides.push({
        id: `PRICE-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        date,
        section,
        startHour,
        price,
        type,
        active: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeStore(store);
    return { status: 200, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.delete('/api/pricing/overrides/:id', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (user?.role !== 'owner') return { status: 403, body: { message: 'Owner access is required to manage slot prices.' } };
    const override = store.priceOverrides.find((item) => item.id === req.params.id && item.active);
    if (!override) return { status: 404, body: { message: 'Active slot price not found.' } };
    override.active = false;
    override.updatedAt = new Date().toISOString();
    await writeStore(store);
    return { status: 200, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.post('/api/bookings', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (!user || user.role !== 'student') return { status: 403, body: { message: 'A student account is required to make a booking.' } };
    const settings = store.settings;
    const date = String(req.body.date || '');
    const startHour = Number(req.body.startHour);
    const teamSize = Number(req.body.teamSize ?? 1);
    const booking = {
      id: `BK-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      date,
      section: String(req.body.section || '').trim(),
      sport: String(req.body.sport || '').trim(),
      playerName: String(user.name || '').trim(),
      phone: normalizePhone(user.phone),
      collegeId: String(user.collegeId || '').trim(),
      bookedBy: user.id,
      paymentMode: 'Pay at venue',
      paymentStatus: 'unpaid',
      price: settings.price,
      startHour,
      endHour: startHour + Number(settings.durationHours),
      teamSize,
      notes: String(req.body.notes || '').trim(),
      createdAt: new Date().toISOString(),
    };
    if (!booking.date || !booking.section || !booking.sport || !booking.playerName || !booking.phone) {
      return { status: 400, body: { message: 'Missing booking details.' } };
    }
    if (!/^[6-9]\d{9}$/.test(booking.phone)) {
      return { status: 400, body: { message: 'Enter a valid 10-digit Indian phone number.' } };
    }
    if (!isValidDateValue(booking.date) || !Number.isSafeInteger(teamSize) || teamSize < 1) {
      return { status: 400, body: { message: 'Enter a valid booking date and number of players.' } };
    }
    if (!settings.sections.includes(booking.section) || !settings.sports.includes(booking.sport) || !slots(settings).includes(booking.startHour)) {
      return { status: 400, body: { message: 'Invalid booking details.' } };
    }
    const slotPrice = store.priceOverrides.find((item) =>
      item.active &&
      item.date === booking.date &&
      item.section === booking.section &&
      item.startHour === booking.startHour,
    );
    booking.price = slotPrice?.price ?? settings.price;
    if (bookingStartTimestamp(booking.date, booking.startHour) <= Date.now()) {
      return { status: 400, body: { message: 'This time slot has already started.' } };
    }
    if (settings.maintenanceDates.includes(booking.date)) {
      return { status: 400, body: { message: 'This date is blocked for maintenance.' } };
    }
    const last = new Date();
    last.setDate(last.getDate() + Number(settings.bookingWindowDays));
    if (booking.date < today() || booking.date > last.toISOString().slice(0, 10)) {
      return { status: 400, body: { message: `Bookings are allowed only within ${settings.bookingWindowDays} days.` } };
    }
    if (store.bookings.filter((item) => !item.cancelledAt && item.phone === booking.phone && item.date >= today()).length >= settings.maxActiveBookingsPerPhone) {
      return { status: 400, body: { message: `This phone already has ${settings.maxActiveBookingsPerPhone} active bookings.` } };
    }
    if (store.bookings.some((item) => !item.cancelledAt && item.date === booking.date && item.section === booking.section && Number(item.startHour) === booking.startHour)) {
      return { status: 409, body: { message: 'This slot is already booked.' } };
    }
    store.bookings.push(booking);
    await writeStore(store);
    return { status: 201, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.put('/api/bookings/:id/payment', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (user?.role !== 'owner') return { status: 403, body: { message: 'Owner access is required to update payments.' } };
    const booking = store.bookings.find((item) => item.id === req.params.id);
    if (!booking || booking.cancelledAt) return { status: 404, body: { message: 'Active booking not found.' } };
    booking.paymentStatus = req.body.paymentStatus === 'paid' ? 'paid' : 'unpaid';
    booking.paymentMode = 'Pay at venue';
    await writeStore(store);
    return { status: 200, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.delete('/api/bookings/:id', route(async (req, res) => {
  const result = await withStoreLock(async () => {
    const store = await readStore();
    const user = authenticatedUser(store, req);
    if (!user) return { status: 403, body: { message: 'Sign in to manage this booking.' } };
    const booking = store.bookings.find((item) => item.id === req.params.id);
    if (!booking) return { status: 404, body: { message: 'Booking not found.' } };
    if (user.role !== 'owner' && booking.bookedBy !== user.id) {
      return { status: 403, body: { message: 'You can only cancel your own booking.' } };
    }
    if (booking.cancelledAt) return { status: 409, body: { message: 'This booking has already been cancelled.' } };
    if (user.role !== 'owner' && bookingStartTimestamp(booking.date, booking.startHour) <= Date.now() + 24 * 60 * 60 * 1000) {
      return { status: 400, body: { message: 'Bookings can only be cancelled at least 24 hours before their start time.' } };
    }
    booking.cancelledAt = new Date().toISOString();
    booking.paymentStatus = 'refunded';
    booking.paymentMode = 'Pay at venue';
    await writeStore(store);
    return { status: 200, body: publicStoreForUser(store, user) };
  });
  res.status(result.status).json(result.body);
}));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ message: 'Could not read or save app data. Check data/store.json permissions and server logs.' }); });
app.use(express.static(path.join(__dirname, 'dist'))); app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html'))); app.listen(PORT, () => console.log(`Turf booking app running at http://localhost:${PORT}`));
