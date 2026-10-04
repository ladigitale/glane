# ADR-0024 — Connecteur Claude (MCP) par relais vers l'onglet ouvert

## Contexte

On veut pouvoir demander à Claude « fais-moi un morceau avec mes sons » et obtenir un arrangement complet, prêt à écouter, composé avec sa propre logique à partir de la bibliothèque — sans passer par le générateur interne. Or Glane est local-first (ADR-0002) : bibliothèque, analyses et arrangements vivent dans IndexedDB / OPFS ; la sync serveur (P5) n'est qu'un stub. Un serveur MCP classique, adossé à l'API, n'aurait aucune donnée à servir.

## Décision

1. **Relais sans état** — `apps/mcp` (Node, SDK MCP, transport streamable HTTP sans session) expose `POST /mcp/<token>` pour Claude et `WS /agent/bridge?token=…` pour l'app. Il apparie un appel d'outil avec l'onglet Glane qui porte le même token et lui transmet l'appel. Il ne persiste rien.
2. **Token = secret partagé** — généré dans l'app (Compte › Connecteur Claude, 32 octets base64url, stocké dans `UserPrefs.agentToken`), inclus dans l'URL du connecteur. Rotation possible ; l'ancienne URL cesse alors de fonctionner. `AGENT_ALLOWED_ORIGINS` restreint en plus l'origine des sockets navigateur.
3. **Partition déclarative** — `@glane/agent` définit `ScoreSchema` : pistes (gain, pan, insert FX, filtres, ADSR, sends), master, spaces A/B, sections, automation, clips en mesure/temps et *patterns* en pas (`X..x`) pour ne pas lister chaque coup. `compileScore` la valide (erreurs avec chemin), résout les ids courts, applique les régions de boucle seamless et produit des lignes Project / Track / Clip ; `decompileArrangement` fait le chemin inverse pour les relectures.
4. **Écriture dans l'onglet** — le pont (`apps/web/src/app/agent/`) compile contre la bibliothèque locale, prend un snapshot (`agentSnapshots`, 10 par projet), remplace l'arrangement en une transaction, journalise les ops comme le générateur, calcule les crossfades de chevauchement et recharge le séquenceur sans recréer le moteur audio. Lecture possible dans la foulée.
5. **Rôles** — la bibliothèque exposée à Claude réutilise `resolveExprRole` (même inférence que le générateur) et les descripteurs d'analyse.

## Conséquences

- Les masters ne quittent jamais l'appareil ; le rendu est celui du moteur de l'app.
- L'onglet doit être ouvert (et l'audio débloqué par un premier geste pour la lecture à distance).
- Quand la sync P5 existera, le relais pourra répondre aux lectures sans onglet ; l'écriture et l'écoute resteront côté app.
- À terme : auth OAuth via le SSO Tadaaa à la place du token dans l'URL.
