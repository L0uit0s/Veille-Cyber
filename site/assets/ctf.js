// Page CTF : calendrier (en ligne / France) + actualité
const TABS = [
  { id: "all", label: "Tous", test: () => true },
  { id: "online", label: "En ligne", test: (e) => !e.onsite },
  { id: "fr", label: "En France", test: (e) => e.fr },
];
const PLATFORMS = [
  { name: "Hackropole", url: "https://hackropole.fr/", desc: "Les épreuves du FCSC (ANSSI), rejouables toute l'année." },
  { name: "Root-Me", url: "https://www.root-me.org/", desc: "Plateforme française d'entraînement : challenges, CTF et salles." },
  { name: "NewbieContest", url: "https://www.newbiecontest.org/", desc: "Challenges francophones pour débuter." },
  { name: "CTFtime", url: "https://ctftime.org/", desc: "Calendrier et classements mondiaux des CTF." },
  { name: "TryHackMe", url: "https://tryhackme.com/", desc: "Parcours guidés et salles d'entraînement." },
  { name: "Hack The Box", url: "https://www.hackthebox.com/", desc: "Machines, challenges et CTF d'équipe." },
  { name: "picoCTF", url: "https://picoctf.org/", desc: "CTF pédagogique, pratique pour apprendre." },
];

const state = { data: null, tab: store.get("ctfTab", "all") };

function whenPill(ev) {
  const start = new Date(ev.start), end = new Date(ev.finish), now = new Date();
  if (start <= now && end >= now) return h("span", { class: "when-pill now" }, "En cours");
  const d = dayDiff(start);
  return h("span", { class: "when-pill" }, d <= 0 ? "Aujourd'hui" : d === 1 ? "Demain" : `Dans ${d} j`);
}

function dateRange(ev) {
  const opt = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  const s = new Date(ev.start), e = new Date(ev.finish);
  return `${s.toLocaleString("fr-FR", opt)} → ${e.toLocaleString("fr-FR", opt)}`;
}

function renderEvent(ev) {
  const s = new Date(ev.start);
  const inProgress = s <= new Date();
  const shown = inProgress ? new Date() : s;
  return h("article", { class: "event" },
    h("div", { class: "date" },
      h("b", {}, shown.getDate()),
      h("span", {}, shown.toLocaleDateString("fr-FR", { month: "short" }))),
    h("div", {},
      h("h3", {}, h("a", { href: safeUrl(ev.url || ev.ctftime_url), target: "_blank", rel: "noopener noreferrer" }, ev.title)),
      h("div", { class: "info" },
        h("span", {}, dateRange(ev)),
        h("span", {}, ev.onsite ? `Sur place${ev.location ? " : " + ev.location : ""}` : "En ligne"),
        ev.fr ? h("span", { class: "tag fr" }, "France") : null,
        ev.format ? h("span", {}, ev.format) : null,
        ev.weight ? h("span", {}, `Poids ${ev.weight}`) : null,
        ev.restrictions && ev.restrictions !== "Open" ? h("span", {}, ev.restrictions) : null,
        ev.organizers.length ? h("span", {}, `Organisé par ${ev.organizers.join(", ")}`) : null),
      h("div", { class: "links" },
        ev.url ? h("a", { href: safeUrl(ev.url), target: "_blank", rel: "noopener noreferrer" }, "Site du CTF") : null,
        ev.ctftime_url ? h("a", { href: safeUrl(ev.ctftime_url), target: "_blank", rel: "noopener noreferrer" }, "Fiche CTFtime") : null)),
    whenPill(ev));
}

function renderEvents() {
  const evs = state.data.events.filter((e) => new Date(e.finish) >= new Date());
  $("#tabs").replaceChildren(...TABS.map((t) =>
    h("button", { type: "button", "aria-pressed": String(state.tab === t.id), onclick: () => { state.tab = t.id; store.set("ctfTab", t.id); renderEvents(); } },
      t.label, h("span", { class: "n" }, evs.filter(t.test).length))));
  const tab = TABS.find((t) => t.id === state.tab) || TABS[0];
  const list = evs.filter(tab.test);
  const box = $("#events");
  if (!list.length) {
    box.replaceChildren(h("div", { class: "empty" }, state.data.error
      ? `Le calendrier n'a pas pu être chargé (${state.data.error}).`
      : "Aucun CTF à venir dans cette catégorie."));
    return;
  }
  box.replaceChildren(...list.map(renderEvent));
}

function renderNews() {
  const box = $("#news");
  const items = state.data.news || [];
  if (!items.length) { box.replaceChildren(h("div", { class: "empty" }, "Pas d'actualité CTF récente.")); return; }
  box.replaceChildren(...items.slice(0, 12).map((i) => {
    const d = new Date(i.date);
    return h("article", { class: "row", "data-cat": "actu" },
      h("div", { class: "when" }, h("time", { datetime: i.date }, d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" }))),
      h("div", { class: "body" },
        h("div", { class: "meta" }, h("span", { class: "src" }, i.origin || i.source)),
        h("h3", {}, h("a", { href: safeUrl(i.url), target: "_blank", rel: "noopener noreferrer" }, i.title))));
  }));
}

function renderPlatforms() {
  $("#platforms").replaceChildren(...PLATFORMS.map((p) =>
    h("a", { href: p.url, target: "_blank", rel: "noopener noreferrer" }, h("b", {}, p.name), h("span", {}, p.desc))));
}

function renderStamp() {
  if (!state.data) return;
  $("#stamp").textContent = `Données ${ago(new Date(state.data.generated))}`;
}

async function load(manual = false) {
  const btn = $("#refresh");
  btn.disabled = true;
  try {
    state.data = await loadJSON("data/ctf.json");
    renderEvents(); renderNews(); renderStamp();
  } catch {
    if (!state.data) {
      $("#events").replaceChildren(h("div", { class: "error" }, h("strong", {}, "Impossible de charger le calendrier."), "Réessaie dans une minute."));
      $("#stamp").textContent = "Hors ligne";
    } else if (manual) {
      $("#stamp").textContent = "Actualisation impossible pour le moment";
    }
  } finally {
    btn.disabled = false;
  }
}

$("#refresh").addEventListener("click", () => load(true));
renderPlatforms();
setInterval(() => load(), 10 * 60 * 1000);
setInterval(renderStamp, 30 * 1000);
load();
