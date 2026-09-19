// Utilitaires partagés : DOM, données, actualisation, notifications

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

// ---------- Dates ----------
const timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtTime = (d) => timeFmt.format(d);

function ago(date, now = Date.now()) {
  const min = Math.max(0, Math.round((now - date.getTime()) / 60000));
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `il y a ${hrs} h`;
  return `il y a ${Math.round(hrs / 24)} j`;
}

function dayDiff(date, now = new Date()) {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((b - a) / 86400000);
}

function dayLabel(date) {
  const diff = dayDiff(date);
  if (diff === 0) return "Aujourd'hui";
  if (diff === -1) return "Hier";
  const s = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Catégories ----------
const CAT_LABEL = {
  actu: "Actualité", alerte: "Alerte CERT-FR", avis: "Avis CERT-FR",
  fuites: "Fuite de données", ransomware: "Ransomware", geo: "Géopolitique",
};
const catOf = (i) => (i.geo && i.cat === "actu" ? "geo" : i.cat);
const isFresh = (item, data) => Date.now() - new Date(item.date).getTime() < data.retention_hours * 3600e3;

// ---------- Chargement avec détection des nouveautés ----------
async function fetchNews(prev) {
  const data = await loadJSON("data/news.json");
  const prevIds = new Set((prev?.items || []).map((i) => i.id));
  const newIds = prev ? data.items.filter((i) => isFresh(i, data) && !prevIds.has(i.id)).map((i) => i.id) : [];
  return { data, newIds, added: newIds.length, changed: !prev || prev.generated !== data.generated };
}

// ---------- Notification ----------
let toastTimer;
function toast(message, kind = "info") {
  let el = $("#toast");
  if (!el) {
    el = h("div", { id: "toast", class: "toast", role: "status", "aria-live": "polite" });
    document.body.append(el);
  }
  el.textContent = message;
  el.dataset.kind = kind;
  requestAnimationFrame(() => el.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 4500);
}

function nextCollectText(data) {
  const next = new Date(data.generated).getTime() + (data.refresh_minutes || 10) * 60000;
  if (next > Date.now()) return `Prochaine collecte attendue vers ${fmtTime(new Date(next))}.`;
  return "La prochaine collecte a un peu de retard : GitHub diffère parfois le planificateur de quelques minutes.";
}

const newText = (n, one, many) => (n === 1 ? `1 nouvel ${one}` : `${n} nouveaux ${many}`);

/** Branche le bouton « Actualiser » : état de chargement, puis message de résultat. */
function wireRefresh(loadFn, noun = ["article", "articles"]) {
  const btn = $("#refresh");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (btn.classList.contains("loading")) return;
    const label = $(".lbl", btn);
    btn.classList.add("loading");
    btn.setAttribute("aria-busy", "true");
    label.textContent = "Actualisation…";
    const started = Date.now();
    let res;
    try { res = await loadFn(true); } catch { res = { error: true }; }
    await new Promise((r) => setTimeout(r, Math.max(0, 700 - (Date.now() - started)))); // le retour visuel reste visible
    btn.classList.remove("loading");
    btn.removeAttribute("aria-busy");
    label.textContent = "Actualiser";

    if (res.error) toast("Impossible de joindre le serveur. Réessaie dans un instant.", "error");
    else if (res.added > 0) toast(`${newText(res.added, ...noun)} depuis le dernier affichage.`);
    else if (res.changed) toast("Nouvelle collecte prise en compte : rien de nouveau à signaler.");
    else toast(`Déjà à jour. ${nextCollectText(res.data)}`);
  });
}

/** Rechargement automatique : ne notifie que s'il y a du nouveau. */
function autoRefresh(loadFn, everyMs, noun = ["article", "articles"]) {
  const run = async () => {
    try {
      const res = await loadFn(false);
      if (res.added > 0) toast(`${newText(res.added, ...noun)} disponible${res.added > 1 ? "s" : ""}.`);
    } catch { /* on réessaiera au prochain cycle */ }
  };
  setInterval(run, everyMs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - (autoRefresh.last || 0) > 2 * 60 * 1000) run();
  });
}

function setStamp(data) {
  const text = `Collecte ${ago(new Date(data.generated))}`;
  const el = $("#stamp");
  if (el) el.textContent = text;
  autoRefresh.last = Date.now();
}

/** État des sources (pied de page). */
function renderSourceStatus(data) {
  const list = $("#status-list");
  if (!list) return;
  const bad = data.sources.filter((s) => s.status !== "ok").length;
  $("#status-summary").textContent = bad
    ? `État des sources : ${bad} en erreur sur ${data.sources.length}`
    : `État des sources : ${data.sources.length} sur ${data.sources.length} disponibles`;
  list.replaceChildren(...data.sources.map((s) =>
    h("li", { class: s.status === "ok" ? "" : "ko" },
      h("i"),
      h("div", {}, h("span", {}, s.name),
        h("small", {}, s.status === "ok" ? `${s.count} article(s), via ${s.via}` : `Erreur : ${s.error}`)))
  ));
}

// Garde l'indication « il y a X min » exacte sans recharger.
setInterval(() => { if (typeof window.__restamp === "function") window.__restamp(); }, 30 * 1000);
