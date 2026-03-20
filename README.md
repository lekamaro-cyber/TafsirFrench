# Tafsir en Francais

Plateforme de publication du Tafsir du Coran en langue francaise, avec systeme de relecture et publication planifiee.

## Structure du projet

```
TafsirFrench/
  data/                    # Contenu du tafsir (fichiers Markdown)
    surahs/                # Un fichier .md par sourate
      001-al-fatiha.md
      002-al-baqara.md
      ...
    README.md              # Guide du format des fichiers
  site/                    # Application Astro
    src/
      pages/               # Pages du site
        index.astro        # Page d'accueil
        surahs/            # Pages des sourates
        admin/             # Interface de gestion
      layouts/             # Layouts Astro
      lib/                 # Logique metier
      styles/              # CSS
    scripts/               # Scripts utilitaires
    public/                # Fichiers statiques
```

## Demarrage rapide

```bash
# 1. Installer les dependances
cd site
npm install

# 2. Ajouter du contenu
# Copiez le modele depuis data/surahs/.samples/001-al-fatiha.md
# et creez vos fichiers dans data/surahs/

# 3. Lancer en mode developpement
npm run dev
# -> http://localhost:4321

# 4. Construire pour la production
npm run build
```

## Workflow de publication

### Statuts du contenu

| Statut | Description |
|--------|-------------|
| `draft` | En cours de redaction |
| `review` | Pret pour relecture |
| `scheduled` | Relu et approuve, date de publication fixee |
| `published` | Visible sur le site public |

### Processus

1. **Rediger** : Creer le fichier .md avec `status: "draft"`
2. **Soumettre** : Passer en `status: "review"` quand c'est pret
3. **Relire** : Utiliser l'interface `/admin/` pour relire le contenu
4. **Planifier** : Mettre `status: "scheduled"` + `publish_date: "YYYY-MM-DD"`
5. **Publier** : Le script `publish-scheduled.js` passe automatiquement en `published`

### Publication automatique

```bash
# Verifier et publier les sourates dont la date est arrivee
cd site
npm run publish-scheduled

# Puis reconstruire le site
npm run build
```

Pour automatiser avec un cron :
```cron
0 6 * * * cd /path/to/TafsirFrench/site && node scripts/publish-scheduled.js && npm run build
```

## Scripts utilitaires

```bash
# Verifier la coherence du contenu
npm run sync

# Publier les sourates planifiees
npm run publish-scheduled
```

## Deploiement

### Sur une VM (recommande)

```bash
# Construire le site
cd site && npm install && npm run build

# Servir les fichiers statiques (dist/) avec nginx
# Voir le fichier nginx.conf fourni
```

### Hebergement gratuit

Le site genere est 100% statique et peut etre deploye sur :
- **Netlify** : connecter le repo GitHub, build command `cd site && npm run build`, publish directory `site/dist`
- **Cloudflare Pages** : meme configuration
- **GitHub Pages** : utiliser une GitHub Action pour build et deployer
- **Vercel** : configurer le root directory sur `site/`
