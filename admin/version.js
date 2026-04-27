// Inserts a small version chip into the admin header and checks GitHub for
// the latest commit on the tracked branch (default: main). Deliberately
// best-effort — if the GitHub call fails (offline, rate-limited) the chip
// just shows the running version without an upstream comparison.

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // re-check upstream once an hour
const STORE_KEY = 'deepskylog.versionCheck';

function shortSha(sha) {
  return sha ? sha.slice(0, 7) : null;
}

function loadCachedRemote() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.fetched_at > CHECK_INTERVAL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cacheRemote(data) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...data, fetched_at: Date.now() }));
  } catch {}
}

async function fetchRemote(repo, ref) {
  const branch = ref && ref !== 'unknown' && ref !== 'dev' ? ref : 'main';
  const res = await fetch(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`,
    { headers: { Accept: 'application/vnd.github+json' } },
  );
  if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`);
  const data = await res.json();
  return { branch, sha: data.sha, date: data.commit?.committer?.date || null };
}

async function fetchCompare(repo, currentSha, latestSha) {
  if (!currentSha || !latestSha || currentSha === latestSha) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/compare/${currentSha}...${latestSha}`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { ahead_by: data.ahead_by, behind_by: data.behind_by };
  } catch {
    return null;
  }
}

function buildChip() {
  const chip = document.createElement('div');
  chip.className = 'version-chip';
  chip.innerHTML = `
    <span class="version-status" data-state="loading">…</span>
    <span class="version-label">checking</span>
  `;
  return chip;
}

function commitUrl(repo, sha) {
  return sha ? `https://github.com/${repo}/commit/${sha}` : `https://github.com/${repo}`;
}

function compareUrl(repo, fromSha, toSha) {
  return `https://github.com/${repo}/compare/${fromSha}...${toSha}`;
}

function renderChip(chip, { local, remote, compare }) {
  const status = chip.querySelector('.version-status');
  const label = chip.querySelector('.version-label');
  chip.innerHTML = '';

  const link = document.createElement('a');
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'version-chip-inner';

  const dot = document.createElement('span');
  dot.className = 'version-status';
  const text = document.createElement('span');
  text.className = 'version-label';

  if (!local.sha) {
    dot.dataset.state = 'unknown';
    text.textContent = `dev build${local.ref && local.ref !== 'dev' ? ` (${local.ref})` : ''}`;
    link.href = `https://github.com/${local.repo}`;
  } else if (!remote) {
    dot.dataset.state = 'unknown';
    text.textContent = `v${shortSha(local.sha)} · couldn't reach GitHub`;
    link.href = commitUrl(local.repo, local.sha);
  } else if (remote.sha === local.sha) {
    dot.dataset.state = 'current';
    text.textContent = `v${shortSha(local.sha)} · up to date`;
    link.href = commitUrl(local.repo, local.sha);
    link.title = `Latest on ${remote.branch} matches the running build.`;
  } else {
    dot.dataset.state = 'behind';
    const behind = compare?.ahead_by;
    text.textContent = behind
      ? `v${shortSha(local.sha)} · ${behind} commit${behind === 1 ? '' : 's'} behind`
      : `v${shortSha(local.sha)} · update available`;
    link.href = compareUrl(local.repo, local.sha, remote.sha);
    link.title = `Latest on ${remote.branch}: ${shortSha(remote.sha)}. Click to compare.`;
  }

  link.appendChild(dot);
  link.appendChild(text);
  chip.appendChild(link);
}

async function init() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const chip = buildChip();
  header.appendChild(chip);

  let local;
  try {
    const res = await fetch('/api/version');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    local = await res.json();
  } catch {
    chip.remove();
    return;
  }

  let remote = loadCachedRemote();
  if (!remote && local.sha) {
    try {
      remote = await fetchRemote(local.repo, local.ref);
      cacheRemote(remote);
    } catch {
      remote = null;
    }
  }

  let compare = null;
  if (remote && local.sha && remote.sha !== local.sha) {
    compare = await fetchCompare(local.repo, local.sha, remote.sha);
  }

  renderChip(chip, { local, remote, compare });
}

init();
