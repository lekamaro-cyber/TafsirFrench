# Donnees du Tafsir

Ce dossier contient les fichiers source du tafsir en francais.

## Structure attendue

```
data/surahs/
  001-al-fatiha.md
  002-al-baqara.md
  003-ali-imran.md
  ...
  114-an-nas.md
```

## Format des fichiers Markdown

Chaque fichier de sourate doit suivre ce format :

```markdown
---
number: 1
name_ar: "الفاتحة"
name_fr: "L'Ouverture"
name_transliteration: "Al-Fatiha"
verses_count: 7
revelation_type: "mecquoise"
status: "draft"           # draft | review | scheduled | published
publish_date: ""          # Date de publication planifiee (YYYY-MM-DD)
reviewer: ""              # Nom du relecteur
last_reviewed: ""         # Date de derniere relecture
---

## Verset 1

> بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ

**Traduction :** Au nom d'Allah, le Tout Misericordieux, le Tres Misericordieux.

**Tafsir :**

Votre commentaire/explication du verset ici...

---

## Verset 2

> الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ

**Traduction :** Louange a Allah, Seigneur de l'Univers.

**Tafsir :**

Votre commentaire/explication du verset ici...
```

## Statuts possibles

| Statut | Description |
|--------|-------------|
| `draft` | Brouillon, en cours de redaction |
| `review` | En attente de relecture |
| `scheduled` | Relu et approuve, publication planifiee |
| `published` | Publie et visible sur le site |
