#!/usr/bin/env python3
"""
Agrège les sources de veille cyber et génère :
  site/data/news.json  -> actualités des dernières 72 h (durée réglable dans sources.json)
  site/data/ctf.json   -> calendrier des CTF + actualité CTF

Lancé toutes les 15 minutes par GitHub Actions (.github/workflows/update.yml).
Chaque source est isolée : si l'une tombe en panne, les autres continuent
et l'erreur est affichée dans le pied de page du site.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote_plus, urljoin, urlparse

import feedparser
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data"
CONFIG = json.loads((ROOT / "scripts" / "sources.json").read_text("utf-8"))

NOW = datetime.now(timezone.utc)
RETENTION = timedelta(hours=CONFIG.get("retention_hours", 72))
TIMEOUT = 25
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; VeilleCyberBot/1.0; +https://github.com)",
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, "
    "application/json, text/html;q=0.8, */*;q=0.5",
}

# --------------------------------------------------------------------------- #
# Mots-clés
# --------------------------------------------------------------------------- #
# Sources généralistes (Korben, IT-Connect) : on ne garde que ce qui parle de sécurité.
CYBER_KW = re.compile(
    r"(s[ée]curit|cyber|pirat|hack|faille|vuln[ée]rab|malware|ransom|ran[çc]on|phishing|hame[çc]on|"
    r"fuite|breach|leak|exploit|cve-\d|zero[- ]?day|0[- ]?day|backdoor|botnet|ddos|chiffr|encrypt|"
    r"mot de passe|password|attaque|arnaque|escroquer|spyware|trojan|stealer|rgpd|cnil|vpn|osint|"
    r"antivirus|edr|pentest|ctf|intrusion|usurpation|deepfake|authentification|2fa|mfa|passkey)",
    re.I,
)

# Sujets géopolitiques / étatiques.
GEO_KW = re.compile(
    r"\b(russ\w*|kremlin|moscou|moscow|chin(?:a|ese|e|ois\w*)|p[ée]kin|beijing|iran\w*|"
    r"cor[ée]e du nord|nord-cor\w*|north korea|dprk|ukrain\w*|otan|nato|apt\s?\d+|sandworm|lazarus|"
    r"(?:volt|salt|flax) typhoon|noname057\w*|killnet|hacktivis\w*|cyberguerre|cyber[- ]?war\w*|"
    r"espionnage|espionage|state[- ]sponsored|nation[- ]state|[ée]tatique|sanctions?|g[ée]opolit\w*|"
    r"geopolit\w*|isra[ëe]l|ta[ïi]wan|sabotage|ing[ée]rence|influence operation|"
    r"d[ée]sinformation|disinformation|[ée]lections?|jeux olympiques|olympics?|renseignement|intelligence agenc\w*)\b",
    re.I,
)

# Sujets qui touchent explicitement la France.
FR_STRONG = re.compile(
    r"\b(france|fran[çc]ais\w*|french|anssi|cert-fr|cnil|elys[ée]e|matignon|"
    r"minist[èe]re des arm[ée]es|dgse|dgsi|gendarmerie)\b",
    re.I,
)

# CTF
FR_LOC = re.compile(
    r"\b(france|paris|lyon|lille|rennes|toulouse|bordeaux|nantes|strasbourg|marseille|montpellier|"
    r"grenoble|nice|sophia|brest|nancy|metz|rouen|caen|dijon|clermont|limoges|poitiers|angers|"
    r"reims|amiens|orl[ée]ans|tours|saclay|villeurbanne|le havre|la rochelle|vannes|lorient|"
    r"saint-malo|cergy|evry|[ée]vry|bourges)\b",
    re.I,
)
FR_HINT = re.compile(
    r"(fcsc|404\s?ctf|root[- ]?me|\becw\b|european cyber week|cybersecurity challenge france|"
    r"hackropole|esiea|epita|ensibs|\binsa\b|ensta|isep|efrei|cybersecurity national challenge|\.fr\b)",
    re.I,
)


# --------------------------------------------------------------------------- #
# Utilitaires
# --------------------------------------------------------------------------- #
def fetch(url: str) -> requests.Response:
    r = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r


def clean(text: str | None, limit: int = 300) -> str:
    """HTML -> texte brut, espaces normalisés, tronqué proprement."""
    if not text:
        return ""
    t = BeautifulSoup(text, "html.parser").get_text(" ", strip=True)
    t = re.sub(r"\s+", " ", html.unescape(t)).strip()
    if len(t) <= limit:
        return t
    return t[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:.") + "…"


def parse_dt(value) -> datetime | None:
    if not value:
        return None
    s = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def entry_date(entry) -> datetime | None:
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        v = entry.get(key)
        if v:
            return datetime(*v[:6], tzinfo=timezone.utc)
    return None


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def norm_url(url: str) -> str:
    p = urlparse(url)
    return f"{p.netloc.lower().removeprefix('www.')}{p.path.rstrip('/')}"


def norm_title(title: str) -> str:
    t = unicodedata.normalize("NFKD", title.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", t)[:70]


def meta(soup: BeautifulSoup, name: str) -> str:
    tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
    return (tag.get("content") or "").strip() if tag else ""


def make_item(src: dict, title: str, link: str, dt: datetime, summary: str = "", origin: str | None = None):
    title = clean(title, 300)
    link = (link or "").strip()
    if not title or not link.startswith("http"):
        return None
    if dt > NOW + timedelta(hours=1):  # date dans le futur : on la ramène à maintenant
        dt = NOW
    summary = clean(summary, 300)
    if summary and (summary.lower().startswith(title.lower()[:40]) or len(summary) < 25):
        summary = ""
    return {
        "id": hashlib.sha1(norm_url(link).encode()).hexdigest()[:12],
        "title": title,
        "url": link,
        "date": iso(dt),
        "summary": summary,
        "source": src["name"],
        "sid": src.get("group", src["id"]),
        "origin": origin,
        "lang": src.get("lang", "fr"),
        "cat": src.get("cat", "actu"),
        "geo": bool(src.get("geo")),
        "fr": bool(src.get("fr")),
    }


def enrich(item: dict) -> dict:
    """Ajoute les marqueurs Géopolitique / France et affine la catégorie CERT-FR."""
    text = f"{item['title']} {item['summary']}"
    if GEO_KW.search(text):
        item["geo"] = True
    if FR_STRONG.search(text):
        item["fr"] = True
    if item["sid"] == "certfr":
        path = urlparse(item["url"]).path
        if "/avis/" in path:
            item["cat"] = "avis"
        elif "/alerte/" in path:
            item["cat"] = "alerte"
        else:
            item["cat"] = "actu"
    return item


def gnews_url(query: str, lang: str = "fr", days: int = 3) -> str:
    q = quote_plus(f"{query} when:{days}d")
    if lang == "fr":
        return f"https://news.google.com/rss/search?q={q}&hl=fr&gl=FR&ceid=FR:fr"
    return f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"


# --------------------------------------------------------------------------- #
# Récupération : flux RSS / Atom
# --------------------------------------------------------------------------- #
def from_feed(src: dict, url: str) -> list[dict]:
    d = feedparser.parse(fetch(url).content)
    if not d.entries:
        raise ValueError("flux vide ou illisible")
    out = []
    for e in d.entries:
        dt = entry_date(e)
        if not dt:
            continue
        title = e.get("title", "")
        summary = e.get("summary") or e.get("description") or ""
        tags = " ".join(t.get("term", "") for t in e.get("tags", []) if t.get("term"))
        if src.get("filter") == "cyber" and not CYBER_KW.search(f"{title} {clean(summary, 800)} {tags}"):
            continue
        origin = (e.get("source") or {}).get("title")  # Google Actualités indique le média d'origine
        if origin and title.endswith(f" - {origin}"):
            title = title[: -len(f" - {origin}")]
        item = make_item(src, title, e.get("link", ""), dt, summary, origin)
        if item:
            out.append(item)
    return out


def discover(home: str):
    """Cherche <link rel="alternate" type="application/rss+xml"> sur la page d'accueil."""
    soup = BeautifulSoup(fetch(home).text, "html.parser")
    for link in soup.find_all("link", rel="alternate"):
        if link.get("type") in ("application/rss+xml", "application/atom+xml") and link.get("href"):
            yield urljoin(home, link["href"])


# --------------------------------------------------------------------------- #
# Récupération : sitemap (dernier recours quand un site n'a pas de flux)
# --------------------------------------------------------------------------- #
SM = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def sitemap_entries(url: str, depth: int = 0) -> list[tuple[str, datetime]]:
    root = ET.fromstring(fetch(url).content)
    out: list[tuple[str, datetime]] = []
    if root.tag.endswith("sitemapindex"):
        if depth >= 1:
            return out
        for s in root.findall(f"{SM}sitemap"):
            lm = parse_dt(s.findtext(f"{SM}lastmod"))
            if lm and lm < NOW - RETENTION:
                continue
            loc = (s.findtext(f"{SM}loc") or "").strip()
            if loc:
                try:
                    out += sitemap_entries(loc, depth + 1)
                except Exception:
                    pass
    else:
        for u in root.findall(f"{SM}url"):
            loc = (u.findtext(f"{SM}loc") or "").strip()
            lm = parse_dt(u.findtext(f"{SM}lastmod"))
            if loc and lm:
                out.append((loc, lm))
    return out


def from_sitemap(src: dict) -> list[dict]:
    cutoff = NOW - RETENTION
    skip = re.compile(r"/(tag|tags|category|categorie|author|page|archives?)(/|$)", re.I)
    entries = [
        (u, d)
        for u, d in sitemap_entries(src["sitemap"])
        if d >= cutoff and urlparse(u).path.strip("/") and not skip.search(u)
    ]
    entries.sort(key=lambda x: x[1], reverse=True)
    out = []
    for url, dt in entries[:20]:
        try:
            soup = BeautifulSoup(fetch(url).text, "html.parser")
        except Exception:
            continue
        title = meta(soup, "og:title") or (soup.title.string if soup.title and soup.title.string else "")
        desc = meta(soup, "og:description") or meta(soup, "description")
        item = make_item(src, title, url, dt, desc)
        if item:
            out.append(item)
    return out


def from_rss_with_fallbacks(src: dict) -> tuple[list[dict], str]:
    errors = []
    tried = set()
    for url in src.get("feeds", []):
        tried.add(url)
        try:
            return from_feed(src, url), "flux RSS"
        except Exception as ex:
            errors.append(f"{url} : {ex}")
    if src.get("home"):
        try:
            for url in discover(src["home"]):
                if url in tried:
                    continue
                tried.add(url)
                try:
                    return from_feed(src, url), "flux détecté automatiquement"
                except Exception as ex:
                    errors.append(f"{url} : {ex}")
        except Exception as ex:
            errors.append(f"{src['home']} : {ex}")
    if src.get("sitemap"):
        try:
            return from_sitemap(src), "sitemap"
        except Exception as ex:
            errors.append(f"{src['sitemap']} : {ex}")
    raise RuntimeError(" | ".join(errors) or "aucune méthode disponible")


# --------------------------------------------------------------------------- #
# Récupération : ransomware.live (API publique v2)
# --------------------------------------------------------------------------- #
def from_ransomware(src: dict) -> list[dict]:
    rows = fetch("https://api.ransomware.live/v2/recentvictims").json()
    try:  # toutes les victimes françaises récentes, même si elles ont quitté la liste mondiale
        rows += fetch("https://api.ransomware.live/v2/countryvictims/FR").json()
    except Exception:
        pass

    seen, fr_items, world_items = set(), [], []
    for v in rows:
        dt = parse_dt(v.get("discovered") or v.get("attackdate") or v.get("published"))
        name = (v.get("victim") or v.get("post_title") or "").strip()
        group = (v.get("group") or v.get("group_name") or "").strip()
        if not dt or not name or dt < NOW - RETENTION:
            continue
        key = (name.lower(), group.lower())
        if key in seen:
            continue
        seen.add(key)

        country = (v.get("country") or "").upper()
        link = v.get("permalink") or ""
        if not link.startswith("https://www.ransomware.live"):
            link = f"https://www.ransomware.live/group/{quote_plus(group)}" if group else "https://www.ransomware.live/"
        bits = [b for b in (f"Pays : {country}" if country else "", v.get("activity") or "", v.get("description") or "") if b]
        item = make_item(src, f"{name} — revendiqué par {group or 'groupe inconnu'}", link, dt, ". ".join(bits))
        if not item:
            continue
        item["id"] = hashlib.sha1(f"{name}|{group}".lower().encode()).hexdigest()[:12]
        item["fr"] = country == "FR"
        (fr_items if item["fr"] else world_items).append(item)

    world_items.sort(key=lambda i: i["date"], reverse=True)
    return fr_items + world_items[: CONFIG.get("ransomware_world_cap", 40)]


# --------------------------------------------------------------------------- #
# Orchestration des actualités
# --------------------------------------------------------------------------- #
def fetch_source(src: dict) -> tuple[dict, list[dict]]:
    res = {"id": src["id"], "name": src["name"], "status": "ok", "via": None, "count": 0, "error": None}
    items: list[dict] = []
    try:
        kind = src.get("type", "rss")
        if kind == "ransomware_live":
            items, res["via"] = from_ransomware(src), "API ransomware.live"
        elif kind == "gnews":
            items = from_feed(src, gnews_url(src["query"], src.get("lang", "fr")))
            res["via"] = "Google Actualités"
            res["name"] = f"{src['name']} : {src['query'][:40]}"
        else:
            items, res["via"] = from_rss_with_fallbacks(src)
    except Exception as ex:  # une source en panne ne doit jamais bloquer les autres
        res["status"], res["error"] = "error", str(ex)[:400]
    return res, items


def build_news() -> dict:
    sources = CONFIG["sources"]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(fetch_source, sources))

    cutoff = NOW - RETENTION
    seen_urls, seen_titles = set(), set()
    items, status = [], []
    for src, (res, fetched) in zip(sources, results):
        fresh = [i for i in fetched if parse_dt(i["date"]) >= cutoff]
        fresh.sort(key=lambda i: i["date"], reverse=True)
        fresh = fresh[: src.get("max", CONFIG.get("max_per_source", 40))]
        kept = 0
        for it in fresh:
            uk, tk = norm_url(it["url"]), norm_title(it["title"])
            if uk in seen_urls or tk in seen_titles:
                continue
            seen_urls.add(uk)
            seen_titles.add(tk)
            items.append(enrich(it))
            kept += 1
        res["count"] = kept
        status.append(res)

    items.sort(key=lambda i: i["date"], reverse=True)
    return {
        "generated": iso(NOW),
        "refresh_minutes": CONFIG.get("refresh_minutes", 10),
        "retention_hours": CONFIG.get("retention_hours", 72),
        "items": items,
        "sources": status,
    }


# --------------------------------------------------------------------------- #
# CTF : calendrier CTFtime + agenda manuel + actualité
# --------------------------------------------------------------------------- #
def ctf_event(e: dict, origin: str) -> dict | None:
    start, finish = parse_dt(e.get("start")), parse_dt(e.get("finish"))
    if not start or not finish or finish < NOW:
        return None
    organizers = [o["name"] if isinstance(o, dict) else str(o) for o in e.get("organizers", [])]
    onsite = bool(e.get("onsite"))
    location = (e.get("location") or "").strip()
    blob = f"{e.get('title', '')} {' '.join(organizers)} {e.get('url', '')}"
    fr = bool(e.get("fr")) or (onsite and bool(FR_LOC.search(location))) or bool(FR_HINT.search(blob))
    return {
        "id": str(e.get("id") or hashlib.sha1(f"{e.get('title')}{start}".encode()).hexdigest()[:10]),
        "title": clean(e.get("title", ""), 160),
        "url": e.get("url") or e.get("ctftime_url") or "",
        "ctftime_url": e.get("ctftime_url") or "",
        "start": iso(start),
        "finish": iso(finish),
        "onsite": onsite,
        "location": location,
        "format": e.get("format") or "",
        "weight": e.get("weight"),
        "restrictions": e.get("restrictions") or "",
        "organizers": organizers,
        "fr": fr,
        "origin": origin,
    }


def build_ctf() -> dict:
    events: dict[str, dict] = {}
    error = None

    days = CONFIG.get("ctf_days_ahead", 120)
    step = 15
    for w in range(0, days, step):
        a = NOW - timedelta(days=1) + timedelta(days=w)
        b = NOW - timedelta(days=1) + timedelta(days=w + step)
        url = f"https://ctftime.org/api/v1/events/?limit=100&start={int(a.timestamp())}&finish={int(b.timestamp())}"
        try:
            for e in fetch(url).json():
                ev = ctf_event(e, "CTFtime")
                if ev:
                    events[ev["id"]] = ev
        except Exception as ex:
            error = f"CTFtime : {str(ex)[:200]}"

    manual_path = ROOT / "scripts" / "ctf_manual.json"
    if manual_path.exists():
        try:
            for i, e in enumerate(json.loads(manual_path.read_text("utf-8"))):
                ev = ctf_event({**e, "id": f"manuel-{i}"}, "Agenda manuel")
                if ev:
                    events[ev["id"]] = ev
        except Exception as ex:
            error = (error + " | " if error else "") + f"ctf_manual.json : {str(ex)[:120]}"

    ordered = sorted(events.values(), key=lambda e: e["start"])

    news, seen = [], set()
    cutoff = NOW - timedelta(hours=CONFIG.get("ctf_news_retention_hours", 336))
    for n, q in enumerate(CONFIG.get("ctf_news", [])):
        src = {"id": f"ctfnews{n}", "name": "Google Actualités", "lang": q.get("lang", "fr"), "cat": "ctf"}
        try:
            days_back = max(1, CONFIG.get("ctf_news_retention_hours", 336) // 24)
            for it in from_feed(src, gnews_url(q["query"], q.get("lang", "fr"), days_back)):
                key = norm_title(it["title"])
                if key not in seen and parse_dt(it["date"]) >= cutoff:
                    seen.add(key)
                    news.append(it)
        except Exception:
            pass
    news.sort(key=lambda i: i["date"], reverse=True)

    return {"generated": iso(NOW), "refresh_minutes": CONFIG.get("refresh_minutes", 10), "events": ordered, "news": news[:30], "error": error}


# --------------------------------------------------------------------------- #
def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    news = build_news()
    ok = sum(1 for s in news["sources"] if s["status"] == "ok")
    print(f"Actualités : {len(news['items'])} articles, {ok}/{len(news['sources'])} sources OK")
    for s in news["sources"]:
        mark = "OK " if s["status"] == "ok" else "ERR"
        detail = f"{s['count']:>3} via {s['via']}" if s["status"] == "ok" else s["error"]
        print(f"  [{mark}] {s['name']:<45} {detail}")

    ctf = build_ctf()
    print(f"CTF : {len(ctf['events'])} événements, {len(ctf['news'])} articles" + (f" (erreur : {ctf['error']})" if ctf["error"] else ""))

    if ok == 0:  # rien de frais : on n'écrase pas (et ne redéploie pas) un site qui fonctionne
        print("Aucune source disponible : abandon.", file=sys.stderr)
        return 1

    (OUT / "news.json").write_text(json.dumps(news, ensure_ascii=False, separators=(",", ":")), "utf-8")
    (OUT / "ctf.json").write_text(json.dumps(ctf, ensure_ascii=False, separators=(",", ":")), "utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
