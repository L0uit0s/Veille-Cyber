// Page « Toutes les actualités » : filtres, recherche, lecture, actualisation
const FILTERS = [
  { id: "all", label: "Tout", test: () => true },
  { id: "alerte", label: "Alertes et avis", test: (i) => i.cat === "alerte" || i.cat === "avis" },
  { id: "fuites", label: "Fuites en France", test: (i) => i.cat === "fuites" },
  { id: "ransomware", label: "Ransomware", test: (i) => i.cat === "ransomware" },
  { id: "geo", label: "Géopolitique", test: (i) => i.geo || i.cat === "geo" },
  { id: "fr", label: "Impact France", test: (i) => i.fr },
];
const hashFilter = () => FILTERS.find((f) => f.id === location.hash.slice(1))?.id;

const state = {
  data: null,
  newIds: new Set(),
  filter: hashFilter() || store.get("filter", "all"),
  source: "",
  q: "",
  hideRead: store.get("hideRead", false),
  read: new Set(store.get("read", [])),
};

function setFilter(id) {
  state.filter = id;
  store.set("filter", id);
  history.replaceState(null, "", id === "all" ? location.pathname : `#${id}`);
  render();
}

function visibleItems() {
  const f = FILTERS.find((x) => x.id === state.filter) || FILTERS[0];
  const q = state.q.trim().toLowerCase();
  return state.data.items.filter((i) => {
    if (!isFresh(i, state.data)) return false;
    if (!f.test(i)) return false;
    if (state.source && i.sid !== state.source) return false;
    if (state.hideRead && state.read.has(i.id)) return false;
    if (q && !`${i.title} ${i.summary} ${i.source} ${i.origin || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderRail() {
  const fresh = state.data.items.filter((i) => isFresh(i, state.data));
  $("#filters").replaceChildren(...FILTERS.map((f) =>
    h("button", { type: "button", "aria-pressed": String(state.filter === f.id), onclick: () => setFilter(f.id) },
      h("span", {}, f.label), h("span", { class: "n" }, fresh.filter(f.test).length))));

  const bySource = new Map();
  for (const i of fresh) {
    const cur = bySource.get(i.sid) || { name: i.source, n: 0 };
    cur.n += 1;
    bySource.set(i.sid, cur);
  }
  const entries = [...bySource.entries()].sort((a, b) => b[1].n - a[1].n);
  $("#sources").replaceChildren(
    h("button", { type: "button", "aria-pressed": String(state.source === ""), onclick: () => { state.source = ""; render(); } },
      h("span", {}, "Toutes les sources"), h("span", { class: "n" }, fresh.length)),
    ...entries.map(([sid, s]) =>
      h("button", { type: "button", "aria-pressed": String(state.source === sid), onclick: () => { state.source = state.source === sid ? "" : sid; render(); } },
        h("span", {}, s.name), h("span", { class: "n" }, s.n))));
}

function renderItem(i) {
  const d = new Date(i.date);
  const cat = catOf(i);
  const minutes = (Date.now() - d.getTime()) / 60000;
  const mark = () => {
    state.read.add(i.id);
    store.set("read", [...state.read]);
    row.classList.add("is-read");
  };
  const link = h("a", { href: safeUrl(i.url), target: "_blank", rel: "noopener noreferrer", onclick: mark, onauxclick: mark }, i.title);
  const row = h("article", { class: `row${state.read.has(i.id) ? " is-read" : ""}${state.newIds.has(i.id) ? " is-new" : ""}`, "data-cat": cat },
    h("div", { class: "when" },
      h("time", { datetime: i.date, title: d.toLocaleString("fr-FR") }, fmtTime(d)),
      minutes < 60 ? h("span", { class: "new-dot", title: "Publié il y a moins d'une heure" }) : null),
    h("div", { class: "body" },
      h("div", { class: "meta" },
        h("span", { class: "src" }, i.source),
        i.origin ? h("span", {}, i.origin) : null,
        i.lang === "en" ? h("span", {}, "en anglais") : null,
        i.cat === "alerte" ? h("span", { class: "tag alerte" }, "Alerte") : null,
        i.cat === "avis" ? h("span", { class: "tag" }, "Avis") : null,
        i.geo ? h("span", { class: "tag geo" }, "Géopolitique") : null,
        i.fr ? h("span", { class: "tag fr" }, "France") : null),
      h("h3", {}, link),
      i.summary ? h("p", { class: "sum" }, i.summary) : null));
  return row;
}

function renderFeed() {
  const items = visibleItems();
  const feed = $("#feed");
  $("#count").textContent = `${items.length} article${items.length > 1 ? "s" : ""}`;
  if (!items.length) {
    feed.replaceChildren(h("div", { class: "panel" }, h("div", { class: "empty" }, "Aucun article ne correspond à ces filtres sur les 72 dernières heures.")));
    return;
  }
  const groups = new Map();
  for (const i of items) {
    const label = dayLabel(new Date(i.date));
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(i);
  }
  const panel = h("div", { class: "panel" });
  for (const [label, list] of groups) {
    panel.append(h("h2", { class: "day" }, h("span", {}, label), h("span", {}, `${list.length} article${list.length > 1 ? "s" : ""}`)));
    panel.append(...list.map(renderItem));
  }
  feed.replaceChildren(panel);
}

function renderStamp() {
  if (state.data) setStamp(state.data);
}

function render() {
  const ids = new Set(state.data.items.map((i) => i.id)); // oublie les articles disparus
  state.read = new Set([...state.read].filter((id) => ids.has(id)));
  store.set("read", [...state.read]);
  renderRail();
  renderFeed();
  renderSourceStatus(state.data);
  renderStamp();
}

async function load() {
  const res = await fetchNews(state.data);
  state.data = res.data;
  state.newIds = new Set(res.newIds);
  render();
  return res;
}

function showError() {
  $("#feed").replaceChildren(h("div", { class: "panel" }, h("div", { class: "error" },
    h("strong", {}, "Impossible de charger les actualités."),
    "Le premier déploiement n'est peut-être pas terminé. Réessaie dans une minute.",
    h("div", {}, h("button", { class: "btn solid", type: "button", onclick: () => location.reload() }, "Recharger la page")))));
  $("#stamp").textContent = "Hors ligne";
}

$("#q").addEventListener("input", (e) => { state.q = e.target.value; if (state.data) renderFeed(); });
$("#hide-read").checked = state.hideRead;
$("#hide-read").addEventListener("change", (e) => { state.hideRead = e.target.checked; store.set("hideRead", state.hideRead); if (state.data) render(); });
window.addEventListener("hashchange", () => { const id = hashFilter() || "all"; if (state.data && id !== state.filter) { state.filter = id; render(); } });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); $("#q").focus(); }
});

window.__restamp = renderStamp;
wireRefresh(load);
autoRefresh(load, 3 * 60 * 1000);
load().catch(showError);
