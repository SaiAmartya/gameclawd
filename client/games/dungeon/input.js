// Keyboard, mouse and touch input.
// Screen-up is world -y (north); screen-right is world +x.

export class Input {
  constructor ({ onAttack, onDash, onMute, onMusic }) {
    this.keys = new Set()
    this.joyVec = { x: 0, y: 0 }
    this.onAttack = onAttack
    this.onDash = onDash
    this.onMute = onMute
    this.onMusic = onMusic
    this.enabled = false

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      const k = e.key.toLowerCase()
      this.keys.add(k)
      if (!this.enabled) return
      if (k === ' ' || k === 'j') { e.preventDefault(); this.onAttack() }
      if (k === 'shift' || k === 'k') this.onDash()
      if (k === 'm') this.onMute()
      if (k === 'b') this.onMusic()
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()))
    window.addEventListener('blur', () => this.keys.clear())

    // click / tap on the 3D canvas attacks
    document.getElementById('game-root').addEventListener('pointerdown', (e) => {
      if (this.enabled && e.pointerType === 'mouse') this.onAttack()
    })

    this.setupTouch()
  }

  setupTouch () {
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0
    if (!isTouch) return
    this.touchUi = document.getElementById('touch-ui')

    const joystick = document.getElementById('joystick')
    const knob = document.getElementById('joystick-knob')
    let activeId = null

    const setKnob = (dx, dy) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`
    }
    joystick.addEventListener('pointerdown', (e) => {
      activeId = e.pointerId
      joystick.setPointerCapture(e.pointerId)
    })
    joystick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== activeId) return
      const rect = joystick.getBoundingClientRect()
      let dx = e.clientX - (rect.left + rect.width / 2)
      let dy = e.clientY - (rect.top + rect.height / 2)
      const len = Math.hypot(dx, dy)
      const max = rect.width / 2 - 10
      if (len > max) { dx = dx / len * max; dy = dy / len * max }
      setKnob(dx, dy)
      this.joyVec.x = dx / max
      this.joyVec.y = dy / max
    })
    const release = (e) => {
      if (e.pointerId !== activeId) return
      activeId = null
      this.joyVec.x = 0
      this.joyVec.y = 0
      setKnob(0, 0)
    }
    joystick.addEventListener('pointerup', release)
    joystick.addEventListener('pointercancel', release)

    document.getElementById('btn-attack').addEventListener('pointerdown', (e) => {
      e.preventDefault()
      if (this.enabled) this.onAttack()
    })
    document.getElementById('btn-dash').addEventListener('pointerdown', (e) => {
      e.preventDefault()
      if (this.enabled) this.onDash()
    })
  }

  setEnabled (on) {
    this.enabled = on
    if (this.touchUi) this.touchUi.classList.toggle('hidden', !on)
  }

  // normalized movement vector in tile coordinates
  getMove () {
    let mx = 0
    let my = 0
    if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1
    if (this.keys.has('w') || this.keys.has('arrowup')) my -= 1
    if (this.keys.has('s') || this.keys.has('arrowdown')) my += 1
    mx += this.joyVec.x
    my += this.joyVec.y
    const len = Math.hypot(mx, my)
    if (len > 1) { mx /= len; my /= len }
    if (Math.abs(mx) < 0.08) mx = 0
    if (Math.abs(my) < 0.08) my = 0
    return { mx, my }
  }
}
