// Page d'accueil : radar, chiffres clés, 5 dernières actualités, rubriques
const state = { news: null, ctf: null };

const RUBRIQUES = [
  { hash: "alerte", cat: "alerte", label: "Alertes et avis", desc: "Bulletins du CERT-FR", test: (i) => i.cat === "alerte" || i.cat === "avis" },
  { hash: "fuites", cat: "fuites", label: "Fuites en France", desc: "Données exposées", test: (i) => i.cat === "fuites" },
  { hash: "ransomware", cat: "ransomware", label: "Ransomware", desc: "Revendications récentes", test: (i) => i.cat === "ransomware" },
  { hash: "geo", cat: "geo", label: "Géopolitique", desc: "Menaces étatiques et conflits", test: (i) => i.geo || i.cat === "geo" },
  { hash: "fr", cat: "actu", label: "Impact France", desc: "Ce qui touche le pays", test: (i) => i.fr },
];

const fresh = () => state.news.items.filter((i) => isFresh(i, state.news));

function hash32(str) {
  let x = 2166136261;
  for (const c of str) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

// ---------- Radar ----------
function renderRadar(items, topIds) {
  const box = $("#radar-dots");
  const span = state.news.retention_hours * 3600e3;
  const dots = items.slice(0, 140).map((i) => {
    const age = Math.min(Math.max(Date.now() - new Date(i.date).getTime(), 0), span);
    const r = (0.1 + (age / span) * 0.82) * 50;                // rayon en % de la largeur
    const a = ((hash32(i.id) % 3600) / 3600) * Math.PI * 2;
    return h("a", {
      class: `dot${topIds.has(i.id) ? " top" : ""}`,
      "data-cat": catOf(i), href: safeUrl(i.url), target: "_blank", rel: "noopener noreferrer", tabindex: "-1",
      title: `${i.source} : ${i.title}`,
      style: `left:${(50 + Math.cos(a) * r).toFixed(2)}%;top:${(50 + Math.sin(a) * r).toFixed(2)}%`,
    });
  });
  box.replaceChildren(...dots);
}

// ---------- Chiffres clés ----------
function nextCtf() {
  const now = Date.now();
  return (state.ctf?.events || []).filter((e) => new Date(e.finish).getTime() >= now)
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
}

function renderStats() {
  const items = fresh();
  const alerts = items.filter((i) => i.cat === "alerte").length;
  const avis = items.filter((i) => i.cat === "avis").length;
  const ransomFr = items.filter((i) => i.cat === "ransomware" && i.fr).length;
  const ctf = nextCtf();
  let ctfBig = "–", ctfLabel = "Prochain CTF", ctfSmall = "Calendrier indisponible";
  if (ctf) {
    const start = new Date(ctf.start);
    const d = dayDiff(start);
    ctfBig = start <= new Date() ? "Live" : d <= 0 ? "Auj." : `${d} j`;
    ctfSmall = ctf.title;
  }
  const tile = (href, big, label, small, cat) =>
    h("a", { class: "stat", href, "data-cat": cat }, h("b", {}, big), h("span", {}, label), h("small", {}, small));
  $("#stats").replaceChildren(
    tile("actus.html", items.length, "articles en 72 h", `${new Set(items.map((i) => i.sid)).size} sources actives`),
    tile("actus.html#alerte", alerts + avis, "alertes et avis CERT-FR", `dont ${alerts} alerte${alerts > 1 ? "s" : ""}`, "alerte"),
    tile("actus.html#ransomware", ransomFr, "victimes françaises", "revendiquées par des groupes ransomware", "ransomware"),
    tile("ctf.html", ctfBig, ctfLabel, ctfSmall, "actu"),
  );
}

// ---------- 5 dernières actualités ----------
function newsCard(i, lead) {
  const cat = catOf(i);
  const d = new Date(i.date);
  const fresher = Date.now() - d.getTime() < 3600e3;
  return h("article", { class: `card${lead ? " lead" : ""}`, "data-cat": cat },
    h("div", { class: "top" },
      h("span", { class: "chip" }, CAT_LABEL[cat] || "Actualité"),
      h("span", { class: "ago", title: d.toLocaleString("fr-FR") }, fresher ? h("i", { class: "new-dot" }) : null, ago(d))),
    h("h3", {}, h("a", { href: safeUrl(i.url), target: "_blank", rel: "noopener noreferrer" }, i.title)),
    i.summary ? h("p", { class: "sum" }, i.summary) : null,
    h("div", { class: "foot" },
      h("span", { class: "src" }, i.source),
      i.origin ? h("span", {}, i.origin) : null,
      i.lang === "en" ? h("span", {}, "en anglais") : null,
      i.geo && cat !== "geo" ? h("span", { class: "tag geo" }, "Géopolitique") : null,
      i.fr ? h("span", { class: "tag fr" }, "France") : null,
      h("span", { class: "read", "aria-hidden": "true" }, "Lire ↗")));
}

function topFive() {
  // Les avis CERT-FR et les listes de victimes ont leurs propres rubriques : on ne les mélange pas à la une.
  return fresh().filter((i) => i.cat !== "avis" && i.cat !== "ransomware").slice(0, 5);
}

function renderTop() {
  const top = topFive();
  const box = $("#top5");
  if (!top.length) {
    box.replaceChildren(h("div", { class: "panel", style: "grid-column:1/-1" }, h("div", { class: "empty" }, "Aucune actualité sur les 72 dernières heures.")));
    return top;
  }
  box.replaceChildren(...top.map((i, n) => newsCard(i, n === 0)));
  return top;
}

// ---------- Rubriques ----------
function renderCats() {
  const items = fresh();
  $("#cats").replaceChildren(...RUBRIQUES.map((r) =>
    h("a", { class: "cat", href: `actus.html#${r.hash}`, "data-cat": r.cat },
      h("b", {}, items.filter(r.test).length), h("span", {}, r.label), h("small", {}, r.desc))));
  $("#all-count").textContent = items.length;
}

function renderStamp() {
  if (!state.news) return;
  setStamp(state.news);
  $("#hero-stamp").textContent = `En direct : collecte ${ago(new Date(state.news.generated))}`;
}

function render() {
  const top = renderTop();
  renderRadar(fresh(), new Set(top.map((i) => i.id)));
  renderStats();
  renderCats();
  renderSourceStatus(state.news);
  renderStamp();
}

async function load() {
  const res = await fetchNews(state.news);
  state.news = res.data;
  try { state.ctf = await loadJSON("data/ctf.json"); } catch { /* le calendrier est facultatif ici */ }
  render();
  return res;
}

function showError() {
  $("#top5").replaceChildren(h("div", { class: "panel", style: "grid-column:1/-1" }, h("div", { class: "error" },
    h("strong", {}, "Impossible de charger les actualités."),
    "Le premier déploiement n'est peut-être pas terminé. Réessaie dans une minute.",
    h("div", {}, h("button", { class: "btn solid", type: "button", onclick: () => location.reload() }, "Recharger la page")))));
  $("#stats").replaceChildren();
  $("#stamp").textContent = "Hors ligne";
  $("#hero-stamp").textContent = "Données indisponibles";
}

window.__restamp = renderStamp;
wireRefresh(load);
autoRefresh(load, 3 * 60 * 1000);
load().catch(showError);
