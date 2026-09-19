# Veille cyber

Site statique de veille cybersécurité : agrège une vingtaine de sources (presse cyber, CERT-FR, ANSSI, fuites de données, ransomware, géopolitique) et un calendrier de CTF. Hébergé gratuitement sur **GitHub Pages**, mis à jour automatiquement par **GitHub Actions**.

```
.github/workflows/update.yml   planificateur (toutes les 10 min) + déploiement
scripts/fetch.py               récupère les flux, filtre, dédoublonne, écrit les JSON
scripts/sources.json           la liste des sources (à éditer)
scripts/ctf_manual.json        vos CTF ajoutés à la main
site/                          le site : index.html (accueil), actus.html, ctf.html, assets/
site/data/                     news.json et ctf.json, générés à chaque exécution
```

## Mise en ligne

1. Créez un dépôt GitHub **public** (voir « Limites ») et poussez ce dossier sur la branche `main`.
2. Dépôt → **Settings → Pages → Build and deployment → Source : GitHub Actions**.
3. Onglet **Actions** → « Mise à jour du site » → **Run workflow** (le premier lancement ne dépend pas du cron).
4. Une minute plus tard, le site est en ligne sur `https://<votre-compte>.github.io/<nom-du-dépôt>/`.
5. Ouvrez le journal du job « Récupérer les flux » : il liste chaque source en `OK` ou `ERR`. Le même état est visible en bas du site (« État des sources »).

## Comportement

- **Fraîcheur** : le script ne garde que les articles des 72 dernières heures (`retention_hours` dans `sources.json`), et le navigateur refiltre aussi côté client, donc une page laissée ouverte se nettoie seule.
- **Actualisation** : le serveur (GitHub Actions) régénère les données toutes les 10 minutes (`refresh_minutes` dans `sources.json`, `cron` dans le workflow). Le navigateur relit ces données toutes les 3 minutes et au retour sur l'onglet.
- **Bouton « Actualiser »** : il relit immédiatement les données publiées, affiche un chargement, puis un message : nombre de nouveaux articles, « déjà à jour » avec l'heure de la prochaine collecte, ou erreur réseau. Il ne peut pas forcer une nouvelle collecte auprès des sites sources : celle-ci se fait côté serveur.
- **Rubriques** : Alertes et avis (CERT-FR), Fuites en France, Ransomware, Géopolitique, Impact France.
  - *Géopolitique* : requêtes Google Actualités ciblées (cyberattaques étatiques, hacktivistes, ingérences, conflits) + détection par mots-clés (Russie, Chine, Iran, Corée du Nord, APT, OTAN, etc.) sur toutes les sources.
  - *Impact France* : article qui mentionne explicitement la France, l'ANSSI, la CNIL, etc., victime française de ransomware, source française officielle.
- **Sources généralistes** (Korben, IT-Connect) : seuls les articles liés à la sécurité sont conservés.
- **Ransomware** : toutes les victimes françaises + les 40 dernières victimes mondiales.
- **Articles lus** : cliquer sur un titre le grise (stocké dans le navigateur uniquement).
- **Pages** :
  - `index.html` : accueil, avec le radar des articles, les chiffres clés, les **5 dernières actualités** (hors avis CERT-FR et listes de victimes, qui ont leurs rubriques) et les raccourcis par rubrique.
  - `actus.html` : **toutes les actualités** des 72 dernières heures, avec recherche, filtres, sources et suivi des articles lus (les liens `actus.html#geo`, `#fr`, `#alerte`, `#fuites`, `#ransomware` ouvrent directement une rubrique).
  - `ctf.html` : CTF en ligne / en France, actu CTF, plateformes d'entraînement.

## Ajouter ou retirer une source

Dans `scripts/sources.json`, ajoutez un bloc :

```json
{
  "id": "monsite",
  "name": "Mon site",
  "lang": "fr",
  "home": "https://exemple.fr/",
  "feeds": ["https://exemple.fr/feed/"]
}
```

Options utiles : `"filter": "cyber"` (ne garder que le sujet sécurité), `"cat": "fuites"`, `"fr": true`, `"geo": true`, `"sitemap": "https://…/sitemap.xml"`.
Ordre de récupération : URLs de `feeds` → flux détecté sur la page `home` → `sitemap` (dernier recours).

## Ajouter un CTF à la main

Dans `scripts/ctf_manual.json` :

```json
[
  {
    "title": "Nom du CTF",
    "url": "https://…",
    "start": "2026-11-14T09:00:00+01:00",
    "finish": "2026-11-15T18:00:00+01:00",
    "onsite": true,
    "location": "Rennes, France",
    "format": "Jeopardy",
    "organizers": ["Organisateur"],
    "fr": true
  }
]
```

## Limites à connaître

- **Quasi temps réel, pas instantané** : le planificateur de GitHub Actions peut retarder une exécution de plusieurs minutes aux heures de pointe.
- **Dépôt public** : GitHub Pages sur un dépôt privé exige un plan payant, et un cron toutes les 10 min consommerait le quota gratuit d'Actions. Le site ne contient que de l'information publique.
- **Inactivité** : GitHub désactive les workflows planifiés après 60 jours sans activité dans le dépôt. Le workflow tente de se réactiver lui-même ; si ça échoue, GitHub envoie un e-mail et un clic sur « Enable workflow » suffit.
- **Flux introuvables** : FrenchBreaches, l'ANSSI et Undernews n'ont pas de flux RSS confirmé. Le script essaie l'autodétection puis le sitemap ; vérifiez leur état au premier lancement.
- **Google Actualités** est utilisé pour la géopolitique : les liens passent par une redirection Google.

## Alternative d'hébergement

Cloudflare Pages, Netlify ou Vercel se branchent aussi à un dépôt GitHub gratuitement. Ils n'apportent un vrai temps réel que si vous déplacez `fetch.py` dans une fonction serverless planifiée : GitHub Pages reste le plus simple.
