// Where a page's latitude / longitude inputs start: the place this visitor
// last used, else the site's default location (set in the admin settings).
// "Use my location" on each page still switches to the browser's position.
import { fetchJson, el } from './common.js';

const blank = (input) => input.value.trim() === '';
// Older versions saved 0, 0 when a page loaded with empty inputs.
const nullIsland = (latInput, lonInput) => Number(latInput.value) === 0 && Number(lonInput.value) === 0;

// Fills the inputs from the site default when they hold nothing usable, and
// adds a "Default location" button after `locateBtn` to come back to it.
// Resolves to true when the inputs hold coordinates afterwards. `onChange`
// runs when the button is used.
export async function applyDefaultLocation(latInput, lonInput, locateBtn, onChange) {
  let home = null;
  try {
    const settings = await fetchJson('/api/settings');
    const lat = settings.default_latitude;
    const lon = settings.default_longitude;
    if (typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon)) home = { lat, lon };
  } catch { /* no default: the page asks for coordinates */ }

  const fill = () => {
    latInput.value = String(home.lat);
    lonInput.value = String(home.lon);
  };
  if (home) {
    if (blank(latInput) || blank(lonInput) || nullIsland(latInput, lonInput)) fill();
    if (locateBtn) {
      locateBtn.after(' ', el('button', {
        type: 'button',
        id: 'home-btn',
        text: 'Default location',
        onclick: () => { fill(); if (onChange) onChange(); },
      }));
    }
  } else if (nullIsland(latInput, lonInput)) {
    latInput.value = '';
    lonInput.value = '';
  }
  return !blank(latInput) && !blank(lonInput);
}
