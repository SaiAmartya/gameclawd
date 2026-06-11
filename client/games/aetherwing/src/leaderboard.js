// Client for the global leaderboard API.
const NAME_KEY = 'aetherwing-pilot';

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export class Leaderboard {
  constructor() {
    this.token = null;
    this.available = null; // null = unknown, false = offline
  }

  get savedName() {
    try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
  }

  set savedName(v) {
    try { localStorage.setItem(NAME_KEY, v); } catch { /* private mode */ }
  }

  // Mint a signed flight token at takeoff. Its age proves how long we flew.
  async beginSession() {
    this.token = null;
    try {
      const r = await fetch('/api/aetherwing/session', { method: 'POST' });
      if (!r.ok) throw new Error();
      this.token = (await r.json()).token;
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  async fetchTop() {
    try {
      const r = await fetch('/api/aetherwing/scores');
      if (!r.ok) throw new Error();
      this.available = true;
      return (await r.json()).scores || [];
    } catch {
      this.available = false;
      return null;
    }
  }

  async submit(name, score) {
    if (!this.token) return { error: 'no_session' };
    try {
      const r = await fetch('/api/aetherwing/scores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, score, token: this.token }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return { error: data.error || 'rejected' };
      this.token = null; // single use
      return data;
    } catch {
      return { error: 'network' };
    }
  }

  render(el, scores, highlightName = null) {
    if (scores === null) {
      el.innerHTML = '<li class="lb-empty">leaderboard offline</li>';
      return;
    }
    if (!scores.length) {
      el.innerHTML = '<li class="lb-empty">no flights recorded — be first</li>';
      return;
    }
    let highlighted = false;
    el.innerHTML = scores.map((s, i) => {
      const me = !highlighted && highlightName && s.name === highlightName;
      if (me) highlighted = true;
      return `<li class="${me ? 'me' : ''}">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${escapeHTML(s.name)}</span>
        <span class="lb-score">${Number(s.score)}</span>
      </li>`;
    }).join('');
  }
}
