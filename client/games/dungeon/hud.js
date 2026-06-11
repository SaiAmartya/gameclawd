// DOM HUD: bars, counters, minimap with fog-of-war, toasts, overlays.

const $ = (id) => document.getElementById(id)

export class Hud {
  constructor () {
    this.hud = $('hud')
    this.hpFill = $('hp-fill')
    this.hpText = $('hp-text')
    this.dashFill = $('dash-fill')
    this.coins = $('coin-counter')
    this.kills = $('kill-counter')
    this.codeBadge = $('code-badge')
    this.codeText = $('code-text')
    this.bossWrap = $('boss-bar-wrap')
    this.bossFill = $('boss-fill')
    this.respawnMsg = $('respawn-msg')
    this.toasts = $('toasts')
    this.overlay = $('overlay')
    this.overlayTitle = $('overlay-title')
    this.overlayStats = $('overlay-stats')
    this.damageFlashEl = $('damage-flash')
    this.minimap = $('minimap')
    this.ctx = this.minimap.getContext('2d')

    this.dungeon = null
    this.visited = new Set()
  }

  reset (dungeon, code, solo) {
    this.dungeon = dungeon
    this.visited = new Set()
    this.codeText.textContent = code
    this.codeBadge.classList.toggle('hidden', !!solo)
    this.bossWrap.classList.add('hidden')
    this.respawnMsg.classList.add('hidden')
    this.overlay.classList.add('hidden')
    this.hud.classList.remove('hidden')
  }

  hide () {
    this.hud.classList.add('hidden')
    this.overlay.classList.add('hidden')
  }

  setVitals ({ hp, maxHp, coins, kills, dashFrac }) {
    this.hpFill.style.width = Math.max(0, (hp / maxHp) * 100) + '%'
    this.hpText.textContent = `${Math.max(0, Math.round(hp))} / ${maxHp}`
    this.dashFill.style.width = Math.round(dashFrac * 100) + '%'
    this.coins.innerHTML = '&#9679; ' + coins
    this.kills.innerHTML = '&#9876; ' + kills
  }

  setBoss (frac) {
    if (frac === null) {
      this.bossWrap.classList.add('hidden')
    } else {
      this.bossWrap.classList.remove('hidden')
      this.bossFill.style.width = Math.max(0, frac * 100) + '%'
    }
  }

  setRespawn (seconds) {
    if (seconds === null) {
      this.respawnMsg.classList.add('hidden')
    } else {
      this.respawnMsg.classList.remove('hidden')
      this.respawnMsg.innerHTML = `You have fallen...<br>your ally fights on. Respawn in ${seconds}`
    }
  }

  damageFlash () {
    this.damageFlashEl.classList.add('active')
    clearTimeout(this._flashTimer)
    this._flashTimer = setTimeout(() => this.damageFlashEl.classList.remove('active'), 90)
  }

  toast (msg) {
    const el = document.createElement('div')
    el.className = 'toast'
    el.textContent = msg
    this.toasts.appendChild(el)
    setTimeout(() => el.remove(), 3200)
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove()
  }

  showOverlay (kind, statsHtml) {
    this.overlay.classList.remove('hidden')
    this.overlayTitle.className = kind
    this.overlayTitle.textContent = kind === 'victory' ? 'VICTORY' : 'YOU DIED'
    this.overlayStats.innerHTML = statsHtml
  }

  hideOverlay () {
    this.overlay.classList.add('hidden')
  }

  // ---- minimap ----

  roomAt (x, y) {
    if (!this.dungeon) return -1
    for (const r of this.dungeon.rooms) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.i
    }
    return -1
  }

  markVisited (x, y) {
    const idx = this.roomAt(x, y)
    if (idx >= 0) this.visited.add(idx)
  }

  drawMinimap ({ self, allies, bossAlive, bossPos }) {
    if (!this.dungeon) return
    const ctx = this.ctx
    const size = this.minimap.width
    const scale = size / this.dungeon.size
    ctx.clearRect(0, 0, size, size)

    // corridors between visited rooms
    ctx.strokeStyle = 'rgba(140, 140, 160, 0.5)'
    ctx.lineWidth = 3
    for (const [a, b] of this.dungeon.edges) {
      if (!this.visited.has(a) && !this.visited.has(b)) continue
      const ra = this.dungeon.rooms[a]
      const rb = this.dungeon.rooms[b]
      ctx.beginPath()
      ctx.moveTo((ra.x + ra.w / 2) * scale, (ra.y + ra.h / 2) * scale)
      ctx.lineTo((rb.x + rb.w / 2) * scale, (rb.y + rb.h / 2) * scale)
      ctx.stroke()
    }

    // visited rooms (and rooms adjacent to visited, dimmer)
    const adjacent = new Set()
    for (const [a, b] of this.dungeon.edges) {
      if (this.visited.has(a)) adjacent.add(b)
      if (this.visited.has(b)) adjacent.add(a)
    }
    for (const r of this.dungeon.rooms) {
      const isVisited = this.visited.has(r.i)
      if (!isVisited && !adjacent.has(r.i)) continue
      ctx.fillStyle = r.boss ? (isVisited ? 'rgba(140, 40, 35, 0.9)' : 'rgba(140, 40, 35, 0.35)')
        : r.spawn ? 'rgba(60, 95, 70, 0.9)'
          : isVisited ? 'rgba(58, 62, 78, 0.92)' : 'rgba(58, 62, 78, 0.35)'
      ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale)
      if (isVisited) {
        ctx.strokeStyle = 'rgba(232, 181, 77, 0.35)'
        ctx.lineWidth = 1
        ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale)
      }
    }

    // boss marker
    if (bossAlive && bossPos) {
      const idx = this.roomAt(bossPos.x, bossPos.y)
      if (idx >= 0 && this.visited.has(idx)) {
        ctx.fillStyle = '#ff5240'
        ctx.beginPath()
        ctx.arc(bossPos.x * scale, bossPos.y * scale, 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // allies then self
    for (const a of allies) {
      ctx.fillStyle = '#ff9d3e'
      ctx.beginPath()
      ctx.arc(a.x * scale, a.y * scale, 3.4, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(self.x * scale, self.y * scale, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 1
    ctx.stroke()
  }
}
