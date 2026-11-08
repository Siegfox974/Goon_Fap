# GoonFap 🔞

FapHero pour adultes (18+) qui utilise une **manette PS4 (DualShock 4)** comme vibro.
Tout tourne dans le navigateur : aucune installation, aucune vidéo envoyée sur Internet.

## Lancer

**Windows :** double-clique sur **`Lancer-GoonFap.bat`**. Le serveur démarre et le navigateur s'ouvre tout seul sur http://localhost:8000.
Laisse la fenêtre noire ouverte pendant que tu joues.

**À la main :**

```bash
python3 -m http.server 8000
```

Puis ouvre **http://localhost:8000** dans **Chrome** ou **Edge**. La commande seule ne fait que démarrer le serveur : il faut ouvrir cette adresse dans le navigateur. Firefox ne fait pas vibrer les manettes.

1. Branche la DualShock 4 (USB ou Bluetooth) et appuie sur un bouton pour qu'elle soit détectée.
2. Règle la puissance et fais un test.
3. Choisis une vidéo (fichier ou lien direct) : elle est lue en plein écran et l'app s'affiche par-dessus.
4. Dans **Ambiance**, mets ton GIF de fond et choisis le ton des messages (coquin ou explicite).

La manette sert **uniquement de vibro** : ses boutons ne déclenchent rien, pour pouvoir la frotter sans risque. Tout se contrôle à la souris ou au clavier.

## Les sources de rythme

| Mode | Description |
|---|---|
| **Programme coquin** | Séance générée : Douceur, Montée en pression, Edging, Hardcore ou Roulette. Fin au choix : jouir, orgasme ruiné, déni ou surprise. |
| **Détection auto** | Analyse la bande son d'une vidéo FapHero et fait vibrer sur chaque beat (sensibilité et fréquences réglables). |
| **Enregistrer au doigt** | Tu tapes le rythme pendant la vidéo. Le beatmap est sauvegardé pour cette vidéo. |
| **Charger un beatmap** | Fichier `.goonfap.json` exporté depuis l'app. |

## Contrôles en jeu

Barre de boutons en haut à droite (elle se cache quand la souris ne bouge plus), ou clavier :

| Clavier | Action |
|---|---|
| Espace / P | Pause |
| Échap | Quitter |
| ↑ / ↓ | Vibration plus / moins forte |
| E | « Je suis au bord ! » : stop de 15 s |
| H | Afficher/masquer la piste |

En mode enregistrement : Espace ou clic gauche = beat normal, B ou clic droit = beat fort.

## Format beatmap

```json
{ "version": 1, "name": "…", "duration": 600,
  "beats":  [{ "t": 3.0, "s": 0.8 }, { "t": 3.5, "s": 1, "d": 2500 }],
  "phases": [{ "t": 0, "end": 3, "kind": "pause", "label": "STOP", "msg": "Mains en l'air" }] }
```

`t` = temps en secondes, `s` = force (0–1), `d` = durée forcée de la vibration en ms.
`kind` vaut `stroke`, `pause`, `finale` ou `end`.
