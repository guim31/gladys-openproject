# OpenProject

Les lots de travaux de votre [OpenProject](https://www.openproject.org) dans
Gladys : les lots ouverts, ceux à échéance aujourd'hui, ceux en retard, ceux
qui vous sont assignés, ceux terminés aujourd'hui et la prochaine échéance,
pour toute l'instance et pour les projets que vous choisissez. Une scène réagit
quand un lot vous est assigné, arrive à échéance ou passe en retard, une autre
crée « vérifier les détecteurs de fumée » chaque mois, et Gladys peut lire les
lots du jour chaque matin.

> **Vos retours sont les bienvenus.** Cette intégration a été testée contre un
> vrai serveur OpenProject (image Docker `openproject/openproject:16`, édition
> Community, octobre 2026), pas encore à l'usage au quotidien. Si quelque chose
> ne marche pas comme décrit, dites-le sur le
> [forum Gladys](https://community.gladysassistant.com) ou dans les
> [issues](https://github.com/guim31/gladys-openproject/issues).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- Un **OpenProject** joignable depuis Gladys : auto-hébergé (l'édition
  Community suffit) ou dans le cloud d'OpenProject.
- Une **clé d'API** d'un utilisateur d'OpenProject : dans OpenProject, avatar
  → **Mon compte** → **Jetons d'accès** → **API** → **+ Jeton d'API**. Si la
  section API manque, un administrateur l'active dans **Administration** →
  **API et webhooks** (« Activer le service web REST »).

L'intégration voit les projets et les lots que voit cet utilisateur, et agit
**en son nom** : les lots créés depuis Gladys l'ont pour auteur, et « Assignés
à moi » compte les lots qui lui sont assignés. Un utilisateur dédié, membre des
projets à suivre, est une bonne idée.

## Configuration

1. Dans Gladys, **Intégrations** → installez **OpenProject**.
2. Dans l'écran **Configuration**, renseignez :
   - **Adresse** : l'adresse d'OpenProject comme dans le navigateur, par
     exemple `http://192.168.1.20:8080`, ou `https://projets.example.org`
     derrière un proxy inverse (un préfixe comme `/openproject` est conservé) ;
   - **Clé d'API**.
3. Options :
   - **Projets suivis** : des noms ou des identifiants (celui de l'adresse du
     projet, `/projects/maison`) séparés par des virgules, 20 au plus. Chacun a
     son appareil, en plus de celui de toute l'instance. Vide : l'appareil de
     l'instance seul ;
   - **Heure de l'événement « à échéance »** : l'heure du déclencheur **Lot
     OpenProject à échéance**, le jour de l'échéance (8 h par défaut) ;
   - **Accepter les certificats auto-signés** : pour une adresse en
     `https://` avec un certificat auto-signé, sur votre propre serveur
     seulement ;
   - **Intervalle de rafraîchissement** : 1 à 10 minutes (5 par défaut). Les
     heures des événements et minuit sont toujours suivis à l'heure, quel que
     soit l'intervalle ;
   - **Langue des noms de fonctionnalités** : les noms donnés aux
     fonctionnalités à l'ajout d'un appareil (français par défaut), et les
     textes envoyés aux scènes.
4. Enregistrez, puis **Tester la connexion** : elle lit OpenProject et donne
   l'utilisateur de la clé, le nombre de lots ouverts et de projets suivis.
5. Dans l'onglet **Découverte**, ajoutez les appareils voulus.

## Appareils

**OpenProject**, pour toute l'instance (tous les projets que voit
l'utilisateur), et **OpenProject _projet_** pour chaque projet suivi, avec ces
fonctionnalités :

| Fonctionnalité           | Ce qu'elle indique                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `Lots ouverts`           | les lots dont le statut n'est pas un statut fermé                                          |
| `À échéance aujourd'hui` | les lots ouverts dont la date de fin tombe aujourd'hui                                     |
| `En retard`              | les lots ouverts dont la date de fin est passée                                            |
| `Assignés à moi`         | les lots ouverts assignés à l'utilisateur de la clé                                        |
| `Terminés aujourd'hui`   | les lots fermés modifiés pour la dernière fois aujourd'hui                                 |
| `Prochaine échéance`     | le lot ouvert dont la date de fin est la plus proche, aujourd'hui compris ; `Aucune` sinon |

Un lot est **ouvert** tant que son statut n'est pas marqué « fermé » dans
OpenProject (`Closed`, `Rejected` dans la configuration par défaut). Son
échéance est sa **date de fin**, ou la date d'un **jalon**. « Aujourd'hui » est
le jour dans le fuseau horaire de Gladys. OpenProject ne garde pas la date de
fermeture d'un lot : « Terminés aujourd'hui » compte les lots fermés modifiés
aujourd'hui, et donc aussi un lot fermé plus tôt puis commenté aujourd'hui.
Les compteurs d'un projet ne comprennent pas ses sous-projets ; l'appareil de
l'instance compte tout.

## Tableau de bord

Le widget **Lots du jour** affiche deux tuiles (aujourd'hui, en retard) et la
liste des lots à finir ce soir (10 au plus), ceux en retard d'abord avec leur
date, puis ceux du jour, avec leur projet. Choisissez un appareil projet dans
les réglages du widget pour ne voir que ses lots, et cochez **Seulement ceux
assignés à moi** pour ne voir que les vôtres. Quand rien n'est dû, le widget le
dit et donne la prochaine échéance. Les projets portent le nom donné dans
Gladys une fois leur appareil ajouté.

Les compteurs peuvent aussi aller sur le tableau de bord comme toute
fonctionnalité d'appareil.

## Scènes

### Déclencheurs

- **Lot OpenProject assigné à moi** : un lot ouvert est désormais assigné à
  l'utilisateur de la clé : on vient de le lui assigner, il l'a créé à son nom,
  ou un lot qui lui était assigné a été rouvert.
- **Lot OpenProject à échéance** : le jour de son échéance, à l'heure choisie
  dans la configuration, un lot est toujours ouvert.
- **Lot OpenProject en retard** : à minuit, un lot dû ce jour-là est toujours
  ouvert. Une fois par lot et par échéance.

Filtre : le projet (un appareil projet, pas celui de l'instance). Informations
transmises aux actions : le lot, son identifiant, son projet, son type, son
statut, la personne assignée, son échéance (`AAAA-MM-JJ`) et son adresse dans
OpenProject.

Un changement est vu à la lecture suivante : dans l'intervalle de
rafraîchissement. Une échéance déplacée à la main sur un jour déjà passé ne
déclenche rien. Un redémarrage ne déclenche rien deux fois ; un lot assigné
pendant l'arrêt de l'intégration déclenche à son redémarrage, de même qu'une
échéance de moins d'une heure.

### Actions

- **Créer un lot OpenProject** : un sujet ; le projet par son nom ou son
  identifiant (vide : le premier projet suivi) ; le type par son nom, exactement
  comme dans OpenProject (vide : le premier type du projet qui n'est pas un
  jalon, `Task` par défaut) ; une **échéance** facultative : `2026-10-24`, ou
  `+3d` pour dans trois jours. Le lot est créé au nom de l'utilisateur de la
  clé, sans assignation. OpenProject place une échéance tombant un jour non
  ouvré (le week-end, par défaut) au jour ouvré suivant : le résultat donne la
  date retenue. Résultats : le lot, son identifiant, son adresse, son projet,
  son type, son échéance.
- **Lire les lots OpenProject du jour** : les lots à finir ce soir en une
  phrase (`3 lot(s) à finir ce soir : …. 1 en retard.`), pour toute l'instance
  ou un projet, et pour tous les lots ou ceux assignés à l'utilisateur.
  Résultats : la phrase, le nombre de lots à finir ce soir, de lots en retard.
  Envoyez la phrase dans un message, ou faites-la dire par Gladys.

Les champs acceptent les variables de scène, par exemple
`{{triggerEvent.data.work_package}}`.

### Idées de scènes

- À 8 h, **Lire les lots OpenProject du jour** (assignés à moi), puis envoyer
  la phrase sur Telegram.
- **Lot OpenProject assigné à moi** : envoyer le sujet et l'adresse du lot en
  message.
- **Lot OpenProject en retard** dans le projet `Maison` : allumer la lampe de
  rappel en orange.
- Le premier du mois, **Créer un lot OpenProject** `Vérifier les détecteurs de
fumée` dans `maison`, échéance `+7d`.

## Dépannage

- **« OpenProject ne répond pas »** : vérifiez l'adresse et le port depuis la
  machine de Gladys (l'adresse ouvre OpenProject dans un navigateur).
- **« Clé d'API refusée »** : la clé a été révoquée, ou son utilisateur est
  verrouillé : créez une nouvelle clé.
- **« Aucune API d'OpenProject à cette adresse »** : l'adresse répond, mais pas
  avec l'API d'OpenProject : vérifiez le port et le préfixe.
- **« L'adresse redirige »** : saisissez l'adresse en `https://`.
- **« Cet utilisateur n'a pas ce droit »** : son rôle dans le projet ne permet
  pas de créer des lots.
- **« Valeurs refusées »** : OpenProject a refusé le lot ; la suite du message
  est son explication (une date mal écrite, un champ personnalisé
  obligatoire…).
- **Un projet manque** : l'utilisateur doit en être membre ; un nom saisi dans
  **Projets suivis** qui ne correspond à aucun projet est ignoré, et **Tester
  la connexion** le signale. Les projets archivés sont écartés.
- **« Plusieurs projets portent ce nom »** : indiquez son identifiant.
- Logs : `LOG_LEVEL=debug` sur le conteneur montre chaque lecture.

## Limites

- OpenProject est lu toutes les 1 à 10 minutes (et à l'heure des événements et
  à minuit) : un changement dans OpenProject apparaît dans Gladys dans ce
  délai. Les webhooks d'OpenProject ne servent pas. Chaque lecture fait cinq
  requêtes (projets, deux comptages, lots datés, lots assignés).
- Seuls comptent pour les échéances les lots dus jusqu'à 60 jours devant, au
  plus 1000 (et 1000 lots assignés au plus) ; au-delà, les logs le signalent.
- L'intégration crée des lots ; elle ne les modifie, ne les ferme, ne les
  assigne ni ne les supprime, et ne lit ni leurs commentaires, ni leurs
  pièces jointes, ni le temps passé.
- La clé d'API est conservée par Gladys dans la configuration de l'intégration
  et n'est envoyée qu'à l'adresse configurée. Gladys ne garde aucune donnée
  d'OpenProject en dehors de `/data/openproject-state.json` (l'heure de la
  dernière lecture et les identifiants des lots assignés, pour qu'aucun
  événement ne parte deux fois).
- Sans lien avec OpenProject GmbH. OpenProject est une marque d'OpenProject
  GmbH.
