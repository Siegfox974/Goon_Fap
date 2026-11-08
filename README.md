# GoonFap 🔞

FapHero pour adultes (18+) qui utilise une **manette PS4 (DualShock 4)** comme vibro.
Tout tourne dans le navigateur : aucune installation, aucune vidéo envoyée sur Internet.

## Sur un site porno : l'extension Chrome (recommandé)

L'extension marche sur **n'importe quel site** (Eporner ou autre) :

- elle capte le son de l'onglet ;
- elle détecte chaque beat de la vidéo en temps réel ;
- elle fait vibrer la manette dessus, à **100 % par défaut** ;
- elle affiche la piste, les messages et les boutons **par-dessus la vidéo du site**.

### Installer (une seule fois)

1. Ouvre `chrome://extensions` dans Chrome (ou `edge://extensions` dans Edge).
2. Active le **Mode développeur** (interrupteur en haut à droite).
3. Clique sur **Charger l'extension non empaquetée** et choisis le dossier **`extension`** du projet.
4. Épingle l'icône 💗 GoonFap dans la barre d'outils.

### Utiliser

1. Branche la DualShock 4 (USB ou Bluetooth) et appuie sur un bouton.
2. Ouvre la vidéo FapHero sur le site.
3. Clique sur l'icône GoonFap, puis sur **▶ Lancer sur cet onglet**.
4. Lance la vidéo : la manette vibre sur chaque beat.
5. Pour le plein écran, utilise le bouton **⛶ de GoonFap**, qui garde les messages visibles. Si le plein écran du site les cache, c'est le cas.

Le panneau en haut à droite permet de :

- régler la puissance ;
- mettre la vidéo en lecture ou en pause ;
- déclencher **🥵 Au bord !** : stop de 15 s ;
- déclencher **💦 Je jouis** : vibration longue à fond.

Quand le tempo est stable, GoonFap le verrouille 🔒 et **anticipe** les vibrations pour qu'elles tombent pile sur le beat.
Pendant les pauses de la vidéo, des **battements de cœur** légers continuent de te taquiner.

Si ça vibre sur des bruits qui ne sont pas des beats, monte la **sensibilité** dans le popup.
Si des beats sont ratés, baisse-la ou change les « Sons à suivre ».

## L'application web (vidéos sur ton PC, programmes générés)

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
