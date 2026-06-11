// GameClawd game registry — the single source of truth for what's in the
// machine. Adding a game = drop its client under client/games/<id>/ and add
// an entry here (plus any server module it needs).

export const GAMES = [
  {
    id: 'dungeon',
    title: 'Dungeon of Doom',
    tagline: 'Descend. Slay. Run it back.',
    description:
      '3D co-op roguelite dungeon crawler. Telegraphed melee combat, ' +
      'procedural dungeons, and a Dungeon Overlord waiting at the bottom — ' +
      'solo or with a friend over a 4-letter room code.',
    players: '1–2 players',
    multiplayer: true,
    genre: 'Co-op roguelite',
    icon: '⚔️',
    accent: '#ff5436',
    accentSoft: '#3d140d',
    path: '/games/dungeon/',
  },
  {
    id: 'aetherwing',
    title: 'AETHERWING',
    tagline: 'A 3D flappy odyssey above the glass sea.',
    description:
      'Flap an origami bird through glowing crystal gates while the sky ' +
      'crossfades from golden hour to starlight. Procedural audio, a living ' +
      'world, and a global leaderboard that knows when you cheat.',
    players: '1 player',
    multiplayer: false,
    genre: 'Arcade flight',
    icon: '🕊️',
    accent: '#5ad7ff',
    accentSoft: '#0c2733',
    path: '/games/aetherwing/',
  },
]
