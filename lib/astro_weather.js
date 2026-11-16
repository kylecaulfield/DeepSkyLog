// Weather for astronomy: an hour-by-hour forecast of what matters at the
// eyepiece — cloud by layer, seeing, transparency, dew, wind, darkness and
// the Moon — with a go / marginal / no-go verdict per hour and a summary per
// night. Source: Open-Meteo's forecast API (free, no key).
//
// Seeing and transparency are ESTIMATES. No free API forecasts them, so they
// are derived here from what Open-Meteo does give: seeing from the jet
// stream (wind at 250 hPa) and surface gusts, transparency from humidity
// and visibility. Good for "is tonight worth setting up", not for picking a
// planetary-imaging night.
'use strict';

const { altAz, moonPhase, sunPosition, moonPosition } = require('./astro');

const API_BASE = () => process.env.OPEN_METEO_BASE || 'https://api.open-meteo.com';
const HOURLY = [
  'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
  'temperature_2m', 'dew_point_2m', 'relative_humidity_2m',
  'wind_speed_10m', 'wind_gusts_10m', 'visibility', 'precipitation_probability',
  'wind_speed_250hPa',
];
// One day more than the week on offer: the series starts at 00:00 UTC today
// and ends at 00:00 UTC, so past hours and a cut-off last night come off it.
const FORECAST_DAYS = 8;
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 200;
// After a failed fetch: how long before the service is asked again for that
// square, and how old a forecast may be and still stand in for a fresh one.
const RETRY_MS = 5 * 60 * 1000;
const STALE_MAX_MS = 6 * 60 * 60 * 1000;
// The endpoint is public, so cap what strangers can make this server ask of
// Open-Meteo: at most this many upstream requests in any hour.
const UPSTREAM_MAX_PER_HOUR = 120;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 5 (steady) .. 1 (boiling), from the jet stream overhead; strong gusts at
// the ground cost a further point. Null when the jet-stream wind is unknown.
function seeingEstimate(jetKmh, gustKmh) {
  if (jetKmh == null) return null;
  let score = jetKmh <= 60 ? 5 : jetKmh <= 100 ? 4 : jetKmh <= 140 ? 3 : jetKmh <= 180 ? 2 : 1;
  if (gustKmh != null && gustKmh >= 35) score -= 1;
  return clamp(score, 1, 5);
}

// 5 (crisp) .. 1 (murky), from humidity and visibility. Cloud is reported
// separately and is not part of this.
function transparencyEstimate(humidityPct, visibilityM) {
  if (humidityPct == null && visibilityM == null) return null;
  let score = 5;
  if (humidityPct != null) score -= humidityPct >= 95 ? 2 : humidityPct >= 80 ? 1 : 0;
  if (visibilityM != null) score -= visibilityM < 5000 ? 3 : visibilityM < 10000 ? 2 : visibilityM < 20000 ? 1 : 0;
  return clamp(score, 1, 5);
}

// How likely optics are to fog: the gap between air temperature and dew
// point. 'frost' when that happens below freezing.
function dewRisk(tempC, dewPointC) {
  if (tempC == null || dewPointC == null) return null;
  const spread = tempC - dewPointC;
  if (spread <= 1) return tempC <= 0 ? 'frost' : 'high';
  if (spread <= 3) return 'likely';
  return 'low';
}

// 'day' (Sun above -6°), 'twilight' (to -18°) or 'dark'.
function darkness(sunAltitude) {
  if (sunAltitude > -6) return 'day';
  return sunAltitude > -18 ? 'twilight' : 'dark';
}

// The verdict for one hour's weather (darkness is not part of it), with the
// reasons it isn't a plain "go".
function verdict(h) {
  const stop = [];
  const caution = [];
  if (h.cloud != null) {
    if (h.cloud >= 70) stop.push(`${Math.round(h.cloud)}% cloud`);
    else if (h.cloud > 25) caution.push(`${Math.round(h.cloud)}% cloud`);
  }
  if (h.precipitation_probability != null) {
    if (h.precipitation_probability >= 50) stop.push(`${Math.round(h.precipitation_probability)}% chance of rain or snow`);
    else if (h.precipitation_probability >= 20) caution.push(`${Math.round(h.precipitation_probability)}% chance of rain or snow`);
  }
  if (h.gusts != null) {
    if (h.gusts >= 45) stop.push(`gusts ${Math.round(h.gusts)} km/h`);
    else if (h.gusts >= 30) caution.push(`gusts ${Math.round(h.gusts)} km/h`);
  }
  if (h.transparency != null && h.transparency <= 2) caution.push('poor transparency');
  // Rain or a gale settles it even when the cloud figure is missing.
  if (stop.length) return { verdict: 'no-go', reasons: [...stop, ...caution] };
  if (h.cloud == null) return { verdict: null, reasons: [] };
  if (caution.length) return { verdict: 'marginal', reasons: caution };
  return { verdict: 'go', reasons: [] };
}

// Open-Meteo's hourly arrays -> one record per hour, with the Sun and Moon
// for that place added. Hours that ended before `from` are dropped.
function buildHours(hourly, lat, lon, from = new Date()) {
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const col = (name, i) => num(hourly[name]?.[i]);
  // Open-Meteo gives gusts and precipitation chance for the hour BEFORE each
  // timestamp, everything else at the timestamp: an hour's own figure for
  // those two is the next entry (the last hour has only its own).
  const during = (name, i) => col(name, i + 1) ?? col(name, i);
  const hours = [];
  times.forEach((t, i) => {
    const start = new Date(t * 1000);
    if (Number.isNaN(start.getTime()) || start.getTime() + 3_600_000 <= from.getTime()) return;
    const mid = new Date(start.getTime() + 1_800_000);
    const sunAlt = altAz({ ...sunPosition(mid), lat, lon, date: mid }).altitude;
    const moonAlt = altAz({ ...moonPosition(mid), lat, lon, date: mid }).altitude;
    const h = {
      time: start.toISOString(),
      cloud: col('cloud_cover', i),
      cloud_low: col('cloud_cover_low', i),
      cloud_mid: col('cloud_cover_mid', i),
      cloud_high: col('cloud_cover_high', i),
      temperature: col('temperature_2m', i),
      dew_point: col('dew_point_2m', i),
      humidity: col('relative_humidity_2m', i),
      wind: col('wind_speed_10m', i),
      gusts: during('wind_gusts_10m', i),
      visibility: col('visibility', i),
      precipitation_probability: during('precipitation_probability', i),
      jet_stream: col('wind_speed_250hPa', i),
    };
    h.seeing = seeingEstimate(h.jet_stream, h.gusts);
    h.transparency = transparencyEstimate(h.humidity, h.visibility);
    h.dew = dewRisk(h.temperature, h.dew_point);
    h.sun_altitude = Math.round(sunAlt * 10) / 10;
    h.darkness = darkness(sunAlt);
    h.moon_altitude = Math.round(moonAlt * 10) / 10;
    h.moon_illumination = Math.round(moonPhase(mid).illumination * 100) / 100;
    Object.assign(h, verdict(h));
    hours.push(h);
  });
  return hours;
}

// Each run of consecutive non-day hours is a night. For each: how many of
// its hours are a "go", the longest unbroken run of them, and one verdict —
// 'go' when that run is at least 2 h, 'marginal' when at least 2 h are
// usable (go or marginal), else 'no-go'. Left out: a night with under 2 h
// to go, and a last night the forecast ends partway through (its second
// half is unknown). Where the Sun never rises (polar night) a "night" is
// cut every 24 h.
function summariseNights(hours) {
  const nights = [];
  let current = null;
  const close = (cutOff) => {
    if (!current) return;
    const hs = current;
    current = null;
    const rated = hs.filter((h) => h.verdict);
    if (cutOff || hs.length < 2 || !rated.length) return;
    let best = null;
    let run = null;
    for (const h of hs) {
      if (h.verdict === 'go') {
        run = run ? { ...run, hours: run.hours + 1 } : { start: h.time, hours: 1 };
        if (!best || run.hours > best.hours) best = run;
      } else run = null;
    }
    const go = rated.filter((h) => h.verdict === 'go').length;
    const usable = rated.filter((h) => h.verdict !== 'no-go').length;
    const end = new Date(new Date(hs.at(-1).time).getTime() + 3_600_000).toISOString();
    nights.push({
      start: hs[0].time,
      end,
      hours: hs.length,
      go_hours: go,
      marginal_hours: usable - go,
      best: best ? { start: best.start, end: new Date(new Date(best.start).getTime() + best.hours * 3_600_000).toISOString(), hours: best.hours } : null,
      verdict: best && best.hours >= 2 ? 'go' : usable >= 2 ? 'marginal' : 'no-go',
    });
  };
  for (const h of hours) {
    if (h.darkness === 'day') close();
    else {
      if (current && current.length >= 24) close();
      (current ||= []).push(h);
    }
  }
  // Still night when the data runs out: that night is incomplete.
  close(true);
  return nights;
}

class AstroWeatherError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AstroWeatherError';
    this.status = status;
  }
}

// Forecasts are fetched per 0.1° square (about 10 km, finer than the
// forecast model) and kept for an hour; concurrent requests share one fetch.
function createAstroWeather({ fetchImpl = fetch, now = () => Date.now() } = {}) {
  const cache = new Map(); // key -> { at, data } | { promise }
  let upstream = []; // times of recent upstream requests

  async function fetchForecast(lat, lon) {
    const url = `${API_BASE()}/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&hourly=${HOURLY.join(',')}&forecast_days=${FORECAST_DAYS}&timeformat=unixtime&wind_speed_unit=kmh`;
    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      const why = err.name === 'TimeoutError' ? 'timed out' : (err.cause?.code || err.message);
      throw new AstroWeatherError(`Couldn't reach the weather service (${why}).`, 502);
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body?.hourly?.time)) {
      const said = typeof body?.reason === 'string' ? body.reason : `HTTP ${res.status}`;
      throw new AstroWeatherError(`The weather service didn't return a forecast (${said}).`, 502);
    }
    return body;
  }

  // The last good forecast for a square, if it is recent enough to stand in.
  const standIn = (entry) => (entry?.data && now() - entry.at < STALE_MAX_MS ? entry.data : null);

  async function forecast(latIn, lonIn) {
    // "+ 0" turns -0 into 0, so both sides of the equator share a square.
    const lat = Math.round(latIn * 10) / 10 + 0;
    const lon = Math.round(lonIn * 10) / 10 + 0;
    const key = `${lat},${lon}`;
    const hit = cache.get(key);
    if (hit?.promise) return hit.promise;
    if (hit?.data && now() - hit.at < CACHE_TTL_MS) return hit.data;
    // A fetch for this square failed moments ago: don't ask again yet.
    if (hit?.retryAt && now() < hit.retryAt) {
      const old = standIn(hit);
      if (old) return old;
      throw hit.error;
    }

    upstream = upstream.filter((t) => now() - t < 3_600_000);
    if (upstream.length >= UPSTREAM_MAX_PER_HOUR) {
      const old = standIn(hit);
      if (old) return old;
      throw new AstroWeatherError('Too many forecast requests right now. Try again later.', 429);
    }
    upstream.push(now());

    // Everything, the fallbacks included, happens inside the one promise
    // that concurrent callers share, so they all get the same answer.
    const promise = (async () => {
      try {
        const body = await fetchForecast(lat, lon);
        const fetchedAt = new Date(now());
        const hours = buildHours(body.hourly, lat, lon, fetchedAt);
        const data = {
          location: { lat, lon },
          fetched_at: fetchedAt.toISOString(),
          source: 'Open-Meteo',
          units: { wind: 'km/h', temperature: '°C', visibility: 'm' },
          hours,
          nights: summariseNights(hours),
        };
        cache.delete(key);
        cache.set(key, { at: now(), data });
        while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
        return data;
      } catch (err) {
        const old = standIn(hit);
        cache.set(key, { at: hit?.at, data: old, error: err, retryAt: now() + RETRY_MS });
        if (old) return old;
        throw err;
      }
    })();
    cache.set(key, { promise });
    return promise;
  }

  return { forecast };
}

module.exports = {
  createAstroWeather, AstroWeatherError, buildHours, summariseNights,
  seeingEstimate, transparencyEstimate, dewRisk, darkness, verdict,
  UPSTREAM_MAX_PER_HOUR, RETRY_MS, STALE_MAX_MS, FORECAST_DAYS, HOURLY,
};
