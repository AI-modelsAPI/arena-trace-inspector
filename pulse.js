/* Arena /api/me/pulse quota parsing. Pure functions shared by worker, HUD and popup.
   The payload shape is not documented, so parse() recognizes common field names
   (percent / used+limit / remaining+quota / reset timestamps) and reports null
   for anything it cannot identify — never a guessed number. */
(() => {
  const PULSE_URL = 'https://arena.ai/api/me/pulse';
  const num = v => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  const toTime = v => {
    const n = num(v);
    if (n !== null) {
      if (n > 1e11) return Math.round(n);        // epoch ms
      if (n > 1e9) return Math.round(n * 1000);  // epoch seconds
      return null;
    }
    if (typeof v === 'string') {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return t;
    }
    return null;
  };
  const round1 = n => n === null ? null : Math.round(n * 10) / 10;
  function parse(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    let percentUsed = null, percentRemaining = null, percentGeneric = null;
    let used = null, limit = null, remaining = null, resetAt = null;
    const seen = new Set();
    function walk(o, depth) {
      if (!o || typeof o !== 'object' || seen.has(o) || depth > 6) return;
      seen.add(o);
      for (const [k, v] of Object.entries(o)) {
        const key = k.toLowerCase();
        const n = num(v);
        if (n !== null) {
          // The live payload is {"pulse":99,"refreshedAt":"…"} — pulse is the
          // remaining percentage of the current 24h window.
          if (percentRemaining === null && /^pulse$/.test(key) && n >= 0 && n <= 100) percentRemaining = n;
          if (/percent|pct|ratio|rate/.test(key)) {
            const pct = n >= 0 && n <= 1 ? n * 100 : n;
            if (pct >= 0 && pct <= 100) {
              if (/remain|left|available|free/.test(key)) { if (percentRemaining === null) percentRemaining = pct; }
              else if (/used|consumed|spent/.test(key)) { if (percentUsed === null) percentUsed = pct; }
              else if (percentGeneric === null) percentGeneric = pct;
            }
          }
          if (used === null && /used|consumed|spent|usage/.test(key) && !/rate|percent|pct/.test(key)) used = n;
          if (limit === null && /limit|quota|cap|total|max|allowance/.test(key) && !/rate|percent|pct/.test(key)) limit = n;
          if (remaining === null && /remain|left|balance|available/.test(key) && !/percent|pct/.test(key)) remaining = n;
        }
        if (resetAt === null && /reset|renew|refresh|window_?end|expires|refill/.test(key)) {
          const t = toTime(v);
          if (t) resetAt = t;
        }
        if (typeof v === 'object') walk(v, depth + 1);
      }
    }
    walk(json, 0);
    // Derive the complement only when the semantics are known.
    if (percentUsed === null && used !== null && limit) percentUsed = Math.min(100, used / limit * 100);
    if (percentRemaining === null && remaining !== null && limit) percentRemaining = Math.max(0, Math.min(100, remaining / limit * 100));
    if (percentRemaining === null && percentUsed !== null) percentRemaining = 100 - percentUsed;
    if (percentUsed === null && percentRemaining !== null) percentUsed = 100 - percentRemaining;
    if (percentUsed === null && percentRemaining === null && percentGeneric === null && used === null && remaining === null && resetAt === null) return null;
    return {percentUsed: round1(percentUsed), percentRemaining: round1(percentRemaining), percentGeneric: round1(percentGeneric), used, limit, remaining, resetAt};
  }
  function formatDuration(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m >= 60) { const h = Math.floor(m / 60), rest = m % 60; return h + '小时' + (rest ? rest + '分' : ''); }
    return m + '分钟';
  }
  // Live countdown H:MM:SS for the reset timer.
  function formatCountdown(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 3600) + ':' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  // Remaining percentage for the progress bar, whichever shape was parsed.
  function remaining(pulse) {
    if (!pulse) return null;
    if (pulse.percentRemaining !== null && pulse.percentRemaining !== undefined) return pulse.percentRemaining;
    if (pulse.percentUsed !== null && pulse.percentUsed !== undefined) return Math.round((100 - pulse.percentUsed) * 10) / 10;
    return pulse.percentGeneric ?? null;
  }
  // ok / warn (<20%) / crit (<10%) traffic light for the bar.
  function level(pulse) {
    const r = remaining(pulse);
    if (r === null || r === undefined) return 'unknown';
    if (r < 10) return 'crit';
    if (r < 20) return 'warn';
    return 'ok';
  }
  function format(pulse, now = Date.now()) {
    if (!pulse) return '';
    const parts = [];
    if (pulse.percentRemaining !== null) parts.push('剩余额度 ' + pulse.percentRemaining + '%');
    else if (pulse.percentGeneric !== null) parts.push('额度 ' + pulse.percentGeneric + '%');
    else if (pulse.percentUsed !== null) parts.push('已用额度 ' + pulse.percentUsed + '%');
    else if (pulse.remaining !== null && pulse.limit) parts.push('额度 ' + pulse.remaining + '/' + pulse.limit);
    if (pulse.resetAt) parts.push(pulse.resetAt > now ? formatCountdown(pulse.resetAt - now) + ' 后重置' : '已到重置时间，正在重新读取…');
    return parts.join(' · ');
  }
  globalThis.ArenaPulse = {PULSE_URL, parse, format, formatDuration, formatCountdown, remaining, level};
})();
