// Utilitaires partagés par les pages Actualités et CTF
const $ = (sel, root = document) => root.querySelector(sel);

/** Crée un élément DOM (aucune injection HTML : tout passe par textContent). */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
  },
};

async function loadJSON(path) {
  const r = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtTime = (d) => timeFmt.format(d);

function ago(date, now = Date.now()) {
  const min = Math.max(0, Math.round((now - date.getTime()) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `il y a ${hrs} h`;
  const d = Math.round(hrs / 24);
  return `il y a ${d} j`;
}

/** Nombre de jours calendaires entre aujourd'hui (0 h locale) et une date. */
function dayDiff(date, now = new Date()) {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((b - a) / 86400000);
}

function dayLabel(date) {
  const diff = dayDiff(date);
  if (diff === 0) return "Aujourd'hui";
  if (diff === -1) return "Hier";
  return date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}
