// Page Actualités : chargement, filtres, rendu, actualisation automatique
const REFRESH_MS = 5 * 60 * 1000;
const FILTERS = [
  { id: "all", label: "Tout", test: () => true },
  { id: "alerte", label: "Alertes et avis", test: (i) => i.cat === "alerte" || i.cat === "avis" },
  { id: "fuites", label: "Fuites en France", test: (i) => i.cat === "fuites" },
  { id: "ransomware", label: "Ransomware", test: (i) => i.cat === "ransomware" },
  { id: "geo", label: "Géopolitique", test: (i) => i.geo || i.cat === "geo" },
  { id: "fr", label: "Impact France", test: (i) => i.fr },
];

const state = {
  data: null,
  filter: store.get("filter", "all"),
  source: "",
  q: "",
  hideRead: store.get("hideRead", false),
  read: new Set(store.get("read", [])),
  loadedAt: 0,
};

const isFresh = (item) => Date.now() - new Date(item.date).getTime() < state.data.retention_hours * 3600e3;

function visibleItems({ ignoreFilter = false, ignoreSource = false } = {}) {
  const f = FILTERS.find((x) => x.id === state.filter) || FILTERS[0];
  const q = state.q.trim().toLowerCase();
  return state.data.items.filter((i) => {
    if (!isFresh(i)) return false;
    if (!ignoreFilter && !f.test(i)) return false;
    if (!ignoreSource && state.source && i.sid !== state.source) return false;
    if (state.hideRead && state.read.has(i.id)) return false;
    if (q && !`${i.title} ${i.summary} ${i.source} ${i.origin || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function renderRail() {
  const fresh = state.data.items.filter(isFresh);
  const box = $("#filters");
  box.replaceChildren(
    ...FILTERS.map((f) =>
      h("button", {
        type: "button",
        "aria-pressed": String(state.filter === f.id),
        onclick: () => { state.filter = f.id; store.set("filter", f.id); render(); },
      }, h("span", {}, f.label), h("span", { class: "n" }, fresh.filter(f.test).length))
    )
  );

  const bySource = new Map();
  for (const i of fresh) {
    const cur = bySource.get(i.sid) || { name: i.source, n: 0 };
    cur.n += 1;
    bySource.set(i.sid, cur);
  }
  const srcBox = $("#sources");
  const entries = [...bySource.entries()].sort((a, b) => b[1].n - a[1].n);
  srcBox.replaceChildren(
    h("button", {
      type: "button", "aria-pressed": String(state.source === ""),
      onclick: () => { state.source = ""; render(); },
    }, h("span", {}, "Toutes les sources"), h("span", { class: "n" }, fresh.length)),
    ...entries.map(([sid, s]) =>
      h("button", {
        type: "button", "aria-pressed": String(state.source === sid),
        onclick: () => { state.source = state.source === sid ? "" : sid; render(); },
      }, h("span", {}, s.name), h("span", { class: "n" }, s.n))
    )
  );
}

function renderItem(i) {
  const d = new Date(i.date);
  const minutes = (Date.now() - d.getTime()) / 60000;
  const isRead = state.read.has(i.id);
  const mark = () => {
    state.read.add(i.id);
    store.set("read", [...state.read]);
    row.classList.add("is-read");
  };
  const link = h("a", { href: safeUrl(i.url), target: "_blank", rel: "noopener noreferrer", onclick: mark, onauxclick: mark }, i.title);
  const row = h("article", { class: `row${isRead ? " is-read" : ""}`, "data-cat": i.geo && i.cat === "actu" ? "geo" : i.cat },
    h("div", { class: "when" },
      h("time", { datetime: i.date, title: d.toLocaleString("fr-FR") }, fmtTime(d)),
      minutes < 60 ? h("span", { class: "live", title: "Publié il y a moins d'une heure" }) : null),
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
      i.summary ? h("p", { class: "sum" }, i.summary) : null)
  );
  return row;
}

function renderFeed() {
  const items = visibleItems();
  const feed = $("#feed");
  if (!items.length) {
    feed.replaceChildren(h("div", { class: "panel" }, h("div", { class: "empty" },
      "Aucun article ne correspond à ces filtres sur les 72 dernières heures.")));
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

function renderStatus() {
  const list = $("#status-list");
  const bad = state.data.sources.filter((s) => s.status !== "ok").length;
  $("#status-summary").textContent = bad
    ? `État des sources : ${bad} en erreur sur ${state.data.sources.length}`
    : `État des sources : ${state.data.sources.length} sur ${state.data.sources.length} disponibles`;
  list.replaceChildren(...state.data.sources.map((s) =>
    h("li", { class: s.status === "ok" ? "" : "ko" },
      h("i"),
      h("div", {},
        h("span", {}, s.name),
        h("small", {}, s.status === "ok" ? `${s.count} article(s), via ${s.via}` : `Erreur : ${s.error}`)))
  ));
}

function renderStamp() {
  if (!state.data) return;
  $("#stamp").textContent = `Données du ${new Date(state.data.generated).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} (${ago(new Date(state.data.generated))})`;
}

function render() {
  const read = new Set(state.data.items.map((i) => i.id)); // oublie les articles disparus
  state.read = new Set([...state.read].filter((id) => read.has(id)));
  store.set("read", [...state.read]);
  renderRail();
  renderFeed();
  renderStatus();
  renderStamp();
}

async function load(manual = false) {
  const btn = $("#refresh");
  btn.disabled = true;
  try {
    state.data = await loadJSON("data/news.json");
    state.loadedAt = Date.now();
    render();
  } catch (err) {
    if (!state.data) {
      $("#feed").replaceChildren(h("div", { class: "panel" }, h("div", { class: "error" },
        h("strong", {}, "Impossible de charger les actualités."),
        "Le premier déploiement n'est peut-être pas terminé. Réessaie dans une minute.",
        h("div", {}, h("button", { type: "button", onclick: () => load(true) }, "Réessayer")))));
      $("#stamp").textContent = "Hors ligne";
    } else if (manual) {
      $("#stamp").textContent = "Actualisation impossible pour le moment";
    }
  } finally {
    btn.disabled = false;
  }
}

$("#q").addEventListener("input", (e) => { state.q = e.target.value; if (state.data) renderFeed(); });
$("#hide-read").checked = state.hideRead;
$("#hide-read").addEventListener("change", (e) => { state.hideRead = e.target.checked; store.set("hideRead", state.hideRead); if (state.data) render(); });
$("#refresh").addEventListener("click", () => load(true));
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); $("#q").focus(); }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - state.loadedAt > 2 * 60 * 1000) load();
});
setInterval(() => load(), REFRESH_MS);
setInterval(() => { if (state.data) { renderStamp(); } }, 30 * 1000);
load();
