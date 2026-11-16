// The "Sky forecast" panel: weather for astronomy from /api/astro-weather —
// a line per night and an hour-by-hour grid of cloud by layer, seeing,
// transparency, wind, dew and the Moon. Seeing and transparency are
// estimates (see lib/astro_weather.js).
import { fetchJson, el } from './common.js';

const VERDICTS = {
  go: { label: 'Go', rank: 0 },
  marginal: { label: 'Marginal', rank: 1 },
  'no-go': { label: 'No-go', rank: 2 },
};
const SCALE = ['', 'Bad', 'Poor', 'Fair', 'Good', 'Great'];
const DEW = { low: 'Low', likely: 'Likely', high: 'High', frost: 'Frost' };
const GRID_HOURS = 36;

// Miles and Fahrenheit for readers whose browser is set to the US.
const IMPERIAL = /-US$/i.test(navigator.language || '');
const speed = (kmh) => (kmh == null ? '—' : String(Math.round(IMPERIAL ? kmh / 1.609 : kmh)));
const SPEED_UNIT = IMPERIAL ? 'mph' : 'km/h';
const temp = (c) => (c == null ? '—' : `${Math.round(IMPERIAL ? c * 9 / 5 + 32 : c)}°${IMPERIAL ? 'F' : 'C'}`);
const pct = (v) => (v == null ? '—' : String(Math.round(v)));

const hourLabel = (d) => d.toLocaleTimeString([], { hour: 'numeric' }).replace(/\s/g, ' ');
const timeLabel = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const sameDay = (a, b) => a.toDateString() === b.toDateString();

// "Tonight" for the first night when it is under way or starts within 18 h;
// otherwise the weekday of the evening it starts on.
function nightName(start, now, isFirst) {
  if (isFirst && start.getTime() - now.getTime() < 18 * 3_600_000) return 'Tonight';
  const evening = start.getHours() >= 12 ? start : new Date(start.getTime() - 86_400_000);
  return `${evening.toLocaleDateString([], { weekday: 'long' })} night`;
}

function nightLine(night, now, isFirst) {
  const v = VERDICTS[night.verdict];
  let detail;
  if (night.best && night.best.hours >= night.hours - 1) detail = 'clear all night';
  else if (night.best) detail = `best ${timeLabel(new Date(night.best.start))} – ${timeLabel(new Date(night.best.end))}`;
  else if (night.marginal_hours) detail = `${night.marginal_hours} h of broken sky at best`;
  else detail = 'clouded or rained out';
  return el('li', { class: `sky-night sky-${night.verdict}` },
    el('strong', { text: nightName(new Date(night.start), now, isFirst) }),
    el('span', { class: 'sky-pill', text: v.label }),
    el('span', { text: detail }),
  );
}

// Cloud cells are shaded by how much sky is covered; the number is always
// there too, so the shade is never the only cue.
function cloudCell(value, small) {
  const td = el('td', { class: small ? 'sky-cloud sky-small' : 'sky-cloud', text: pct(value) });
  if (value != null) td.style.setProperty('--cover', String(Math.round(value)));
  return td;
}

function scaleCell(score) {
  return el('td', { class: score ? `sky-scale sky-s${score}` : '', text: score ? SCALE[score] : '—' });
}

function grid(hours) {
  const row = (label, cells, cls) => el('tr', { class: cls || '' }, el('th', { scope: 'row', text: label }), ...cells);
  const dayClass = (h) => (h.darkness === 'day' ? 'sky-day' : h.darkness === 'twilight' ? 'sky-twilight' : '');
  const each = (fn) => hours.map((h, i) => {
    const td = fn(h, i);
    if (dayClass(h)) td.classList.add(dayClass(h));
    return td;
  });
  const table = el('table', { class: 'sky-grid' },
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col', text: 'Hour' }),
      ...hours.map((h, i) => {
        const d = new Date(h.time);
        const newDay = i === 0 || d.getHours() === 0;
        return el('th', { scope: 'col', class: dayClass(h) },
          newDay ? el('span', { class: 'sky-dayname', text: d.toLocaleDateString([], { weekday: 'short' }) }) : null,
          hourLabel(d));
      }),
    )),
    el('tbody', {},
      row('Verdict', each((h) => el('td', {
        class: h.verdict ? `sky-verdict sky-${h.verdict}` : '',
        title: h.reasons && h.reasons.length ? h.reasons.join(', ') : null,
        text: h.verdict ? VERDICTS[h.verdict].label : '—',
      }))),
      row('Cloud %', each((h) => cloudCell(h.cloud))),
      row('· low', each((h) => cloudCell(h.cloud_low, true)), 'sky-sub'),
      row('· mid', each((h) => cloudCell(h.cloud_mid, true)), 'sky-sub'),
      row('· high', each((h) => cloudCell(h.cloud_high, true)), 'sky-sub'),
      row('Seeing', each((h) => scaleCell(h.seeing))),
      row('Transp.', each((h) => scaleCell(h.transparency))),
      row(`Wind/gust ${SPEED_UNIT}`, each((h) => el('td', {
        class: h.gusts != null && h.gusts >= 45 ? 'sky-bad' : h.gusts != null && h.gusts >= 30 ? 'sky-warn' : '',
        text: `${speed(h.wind)} / ${speed(h.gusts)}`,
      }))),
      row('Dew', each((h) => el('td', {
        class: h.dew === 'high' || h.dew === 'frost' ? 'sky-bad' : h.dew === 'likely' ? 'sky-warn' : '',
        title: h.temperature != null && h.dew_point != null ? `${temp(h.temperature)}, dew point ${temp(h.dew_point)}` : null,
        text: h.dew ? DEW[h.dew] : '—',
      }))),
      row('Temp', each((h) => el('td', { text: temp(h.temperature) }))),
      row('Moon', each((h) => el('td', {
        class: h.moon_altitude > 0 ? '' : 'sky-muted',
        title: `Moon ${h.moon_altitude > 0 ? `${Math.round(h.moon_altitude)}° up` : 'below the horizon'}, ${Math.round(h.moon_illumination * 100)}% lit`,
        text: h.moon_altitude > 0 ? `${Math.round(h.moon_illumination * 100)}%` : 'Down',
      }))),
    ),
  );
  return el('div', { class: 'sky-scroll', tabindex: '0', role: 'region', 'aria-label': 'Hour-by-hour sky forecast' }, table);
}

// Mounts the panel in `container`. Returns { load(lat, lon, { from }),
// verdictFor(startISO, endISO) }; `onUpdate` runs after each load, with the
// forecast or null.
export function mountAstroWeather(container, { onUpdate } = {}) {
  let data = null;
  let gen = 0;
  let lastKey = '';
  const body = el('div', { class: 'sky-body' });
  container.classList.add('sky-forecast');
  container.replaceChildren(el('h2', { text: 'Sky forecast' }), body);

  function render(from) {
    const now = new Date();
    const start = from && from > now ? from : now;
    const first = data.hours.findIndex((h) => new Date(h.time).getTime() + 3_600_000 > start.getTime());
    const hours = first < 0 ? [] : data.hours.slice(first, first + GRID_HOURS);
    if (!hours.length) {
      body.replaceChildren(el('div', { class: 'empty-state', text: 'That date is beyond the 7-day forecast.' }));
      return;
    }
    const until = new Date(hours.at(-1).time).getTime() + 3_600_000;
    const nights = data.nights.filter((n) => new Date(n.end) > start && new Date(n.start).getTime() < until + 36 * 3_600_000).slice(0, 3);
    body.replaceChildren(
      el('ul', { class: 'sky-nights' }, ...nights.map((n, i) => nightLine(n, now, i === 0))),
      grid(hours),
      el('p', { class: 'dim sky-foot', text:
        `Seeing and transparency (Transp.) are estimates from jet-stream wind, humidity and visibility. Greyed hours are daylight. Forecast: ${data.source}, `
        + `fetched ${timeLabel(new Date(data.fetched_at))}, for ${data.location.lat.toFixed(1)}°, ${data.location.lon.toFixed(1)}°.` }),
    );
  }

  async function load(lat, lon, { from } = {}) {
    const myGen = ++gen;
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    // Same place, forecast under 30 minutes old: just redraw from `from`.
    if (data && key === lastKey && Date.now() - new Date(data.fetched_at).getTime() < 30 * 60_000) {
      render(from);
      if (onUpdate) onUpdate(data);
      return;
    }
    if (!data || key !== lastKey) body.replaceChildren(el('span', { class: 'dim', text: 'Loading the forecast…' }));
    try {
      const fresh = await fetchJson(`/api/astro-weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
      if (myGen !== gen) return;
      data = fresh;
      lastKey = key;
      render(from);
    } catch (err) {
      if (myGen !== gen) return;
      data = null;
      lastKey = '';
      body.replaceChildren(el('div', { class: 'sky-error', role: 'alert', text:
        /^429\b/.test(err.message) ? 'Too many forecast requests right now. Try again later.' : 'The forecast isn\'t available right now.' }));
    }
    if (onUpdate) onUpdate(data);
  }

  // The worst verdict among the forecast hours a time span touches, or null
  // when the forecast doesn't cover all of it.
  function verdictFor(startISO, endISO) {
    if (!data) return null;
    const start = new Date(startISO).getTime();
    const end = new Date(endISO).getTime();
    if (!(end > start)) return null;
    const touched = data.hours.filter((h) => {
      const t = new Date(h.time).getTime();
      return t < end && t + 3_600_000 > start;
    });
    if (!touched.length || touched.some((h) => !h.verdict)) return null;
    if (new Date(touched[0].time).getTime() > start || new Date(touched.at(-1).time).getTime() + 3_600_000 < end) return null;
    const worst = touched.reduce((a, b) => (VERDICTS[b.verdict].rank > VERDICTS[a.verdict].rank ? b : a));
    return { verdict: worst.verdict, label: VERDICTS[worst.verdict].label, rank: VERDICTS[worst.verdict].rank, reasons: worst.reasons || [] };
  }

  return { load, verdictFor };
}
