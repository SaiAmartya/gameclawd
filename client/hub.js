// GameClawd hub — renders the prize pit from /api/games and drives the claw.

const pit = document.getElementById('pit')
const template = document.getElementById('capsule-template')
const statusEl = document.getElementById('machine-status')
const carriage = document.getElementById('claw-carriage')

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')

// Fallback registry so the hub still works if /api/games is unreachable
// (e.g. opened as a plain file). Kept to id/path essentials.
const FALLBACK_GAMES = [
  { id: 'dungeon', title: 'Dungeon of Doom', tagline: 'Descend. Slay. Run it back.', description: '3D co-op roguelite dungeon crawler.', players: '1–2 players', genre: 'Co-op roguelite', icon: '⚔️', accent: '#ff5436', path: '/games/dungeon/' },
  { id: 'aetherwing', title: 'AETHERWING', tagline: 'A 3D flappy odyssey above the glass sea.', description: 'Flap an origami bird through glowing crystal gates.', players: '1 player', genre: 'Arcade flight', icon: '🕊️', accent: '#5ad7ff', path: '/games/aetherwing/' },
]

function renderGames (games) {
  pit.replaceChildren()
  games.forEach((game, i) => {
    const node = template.content.cloneNode(true)
    const capsule = node.querySelector('.capsule')
    capsule.style.setProperty('--accent', game.accent)
    capsule.style.setProperty('--i', i)
    capsule.dataset.testid = `game-card-${game.id}`

    node.querySelector('.dome-icon').textContent = game.icon
    node.querySelector('.capsule-title').textContent = game.title
    node.querySelector('.capsule-tagline').textContent = game.tagline
    node.querySelector('.capsule-desc').textContent = game.description
    node.querySelector('.chip-players').textContent = game.players
    node.querySelector('.chip-genre').textContent = game.genre

    const play = node.querySelector('.play-btn')
    play.href = game.path
    play.dataset.testid = `play-${game.id}`
    play.setAttribute('aria-label', `Play ${game.title}`)
    play.addEventListener('click', (e) => {
      if (reducedMotion.matches) return // plain navigation
      e.preventDefault()
      grabAndLaunch(capsule, game.path)
    })

    pit.append(node)
  })
}

// The signature move: the claw rides over the chosen capsule, drops,
// closes its prongs, the capsule jolts — then we launch the game.
let grabbing = false
function grabAndLaunch (capsule, href) {
  if (grabbing) return
  grabbing = true

  const rig = document.getElementById('claw-rig')
  const rigBox = rig.getBoundingClientRect()
  const capBox = capsule.getBoundingClientRect()
  const targetX = capBox.left + capBox.width / 2 - (rigBox.left + rigBox.width / 2)

  carriage.classList.add('grabbing')
  const ride = carriage.animate(
    [{ transform: 'translateX(0)' }, { transform: `translateX(${targetX}px)` }],
    { duration: 420, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' }
  )
  ride.onfinish = () => {
    carriage.classList.add('grab-drop', 'grab-close')
    capsule.classList.add('grabbed')
    setTimeout(() => { location.href = href }, 1100)
  }
  // safety net — never strand the user on a stuck animation
  setTimeout(() => { location.href = href }, 2400)
}

async function boot () {
  try {
    const resp = await fetch('/api/games')
    if (!resp.ok) throw new Error()
    const data = await resp.json()
    renderGames(Array.isArray(data.games) && data.games.length ? data.games : FALLBACK_GAMES)
  } catch {
    renderGames(FALLBACK_GAMES)
  }

  try {
    const resp = await fetch('/healthz')
    const h = await resp.json()
    statusEl.textContent = `machine online · ${h.games} prizes loaded · up ${formatUptime(h.uptime)}`
  } catch {
    statusEl.textContent = 'machine offline — capsules shown from memory'
  }
}

function formatUptime (s) {
  if (!Number.isFinite(s)) return '—'
  if (s < 90) return `${s}s`
  if (s < 5400) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

boot()
