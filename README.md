# GoonFap 🔞

FapHero pour adultes (18+) qui utilise une **manette PS4 (DualShock 4)** comme vibro.
Tout tourne dans le navigateur : aucune installation, aucune vidéo envoyée sur Internet.

## Lancer

La Gamepad API demande une page servie en `http://localhost` ou en HTTPS :

```bash
python3 -m http.server 8000
```

Puis ouvre http://localhost:8000 dans **Chrome** ou **Edge** (Firefox ne gère pas la vibration des manettes).
Ça marche aussi en ligne avec GitHub Pages.

1. Branche la DualShock 4 (USB ou Bluetooth) et appuie sur un bouton.
2. Règle la puissance, la durée des pulsations et le mélange des moteurs, puis fais un test.
3. Choisis une vidéo (ou rien) et une source de rythme, puis **C'est parti**.

## Les sources de rythme

| Mode | Description |
|---|---|
| **Programme coquin** | Séance générée : Douceur, Montée en pression, Edging, Hardcore ou Roulette. Fin au choix : jouir, orgasme ruiné, déni ou surprise. |
| **Détection auto** | Analyse la bande son d'une vidéo FapHero et fait vibrer sur chaque beat (sensibilité et fréquences réglables). |
| **Enregistrer au doigt** | Tu tapes le rythme pendant la vidéo. Le beatmap est sauvegardé pour cette vidéo. |
| **Charger un beatmap** | Fichier `.goonfap.json` exporté depuis l'app. |

## Contrôles en jeu

| Manette | Clavier | Action |
|---|---|---|
| Options | Espace / P | Pause |
| ○ | Échap | Quitter |
| R1 / R2 | ↑ | Vibration plus forte |
| L1 / L2 | ↓ | Vibration moins forte |
| ✕ | E | « Je suis au bord ! » : stop de 15 s |
| △ | H | Afficher/masquer la piste |

En mode enregistrement : ✕ / Espace = beat normal, □ / B = beat fort.

## Format beatmap

```json
{ "version": 1, "name": "…", "duration": 600,
  "beats":  [{ "t": 3.0, "s": 0.8 }, { "t": 3.5, "s": 1, "d": 2500 }],
  "phases": [{ "t": 0, "end": 3, "kind": "pause", "label": "STOP", "msg": "Mains en l'air" }] }
```

`t` = temps en secondes, `s` = force (0–1), `d` = durée forcée de la vibration en ms.
`kind` vaut `stroke`, `pause`, `finale` ou `end`.
