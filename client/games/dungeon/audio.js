// Tiny WebAudio synthesizer — all SFX generated procedurally, no assets.

// A 16s generative loop in A minor: slow detuned pads over a sub drone,
// a sparse plucked motif drowned in cavern echo, and a deep boom on each
// chord change. Chords as fundamental frequencies (Am, F, Dm, E).
const MUSIC = {
  step: 0.5, // seconds per melody step; 8 steps per chord, 4 chords per loop
  chords: [
    [110.0, 130.8, 164.8], // A minor
    [87.3, 110.0, 130.8],  // F major
    [73.4, 87.3, 110.0],   // D minor
    [82.4, 103.8, 123.5]   // E major
  ],
  // A harmonic minor, indices into this scale (-1 = rest)
  scale: [220.0, 246.9, 261.6, 293.7, 329.6, 349.2, 415.3, 440.0, 523.3],
  melody: [
    7, -1, -1, 4, -1, -1, 2, -1,   // Am: A4 . . E4 . . C4 .
    -1, -1, 5, -1, 7, -1, -1, -1,  // F:  . . F4 . A4 . . .
    3, -1, -1, 5, -1, 4, -1, -1,   // Dm: D4 . . F4 . E4 . .
    6, -1, -1, 8, -1, -1, 4, -1    // E:  G#4 . . C5 . . E4 .
  ]
}

class AudioFx {
  constructor () {
    this.ctx = null
    this.muted = false
    this.musicOn = false
    this.musicGain = null
    this.musicTimer = null
  }

  ensure () {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return null
      this.ctx = new Ctx()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.35
      this.master.connect(this.ctx.destination)
      // shared noise buffer
      const len = this.ctx.sampleRate
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const data = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
    return this.ctx
  }

  toggleMute () {
    this.muted = !this.muted
    if (this.musicOn && this.musicGain) {
      const t = this.ctx.currentTime
      this.musicGain.gain.cancelScheduledValues(t)
      this.musicGain.gain.setValueAtTime(this.muted ? 0.0001 : 0.5, t)
    }
    return this.muted
  }

  // ---- background music (generative dungeon ambience) ----

  toggleMusic () {
    this.musicOn ? this.stopMusic() : this.startMusic()
    return this.musicOn
  }

  startMusic () {
    const ctx = this.ensure()
    if (!ctx || this.musicOn) return
    this.musicOn = true

    this.musicGain = ctx.createGain()
    this.musicGain.gain.setValueAtTime(0.0001, ctx.currentTime)
    this.musicGain.gain.exponentialRampToValueAtTime(
      this.muted ? 0.0001 : 0.5, ctx.currentTime + 2.5)
    this.musicGain.connect(this.master)

    // cavernous echo bus for the plucked motif
    this.musicEcho = ctx.createDelay(1)
    this.musicEcho.delayTime.value = 0.52
    const feedback = ctx.createGain()
    feedback.gain.value = 0.38
    this.musicEcho.connect(feedback).connect(this.musicEcho)
    this.musicEcho.connect(this.musicGain)

    this.musicStep = 0
    this.musicNext = ctx.currentTime + 0.1
    this.musicTimer = setInterval(() => this.scheduleMusic(), 150)
  }

  stopMusic () {
    if (!this.musicOn) return
    this.musicOn = false
    clearInterval(this.musicTimer)
    this.musicTimer = null
    const gain = this.musicGain
    this.musicGain = null
    if (!gain) return
    const t = this.ctx.currentTime
    gain.gain.cancelScheduledValues(t)
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8)
    setTimeout(() => gain.disconnect(), 1000) // takes scheduled notes with it
  }

  // schedule a beat or so ahead so timer jitter never gaps the loop
  scheduleMusic () {
    const ctx = this.ctx
    if (!ctx || !this.musicOn) return
    while (this.musicNext < ctx.currentTime + 1.2) {
      this.musicAtStep(this.musicStep, this.musicNext)
      this.musicStep = (this.musicStep + 1) % MUSIC.melody.length
      this.musicNext += MUSIC.step
    }
  }

  musicAtStep (step, t) {
    const chordLen = 8 * MUSIC.step
    if (step % 8 === 0) {
      const chord = MUSIC.chords[(step / 8) | 0]
      for (const freq of chord) this.padNote(freq, t, chordLen + 1.6, 0.07)
      this.padNote(chord[0] / 2, t, chordLen + 1.6, 0.11, 'sine') // sub drone
      this.boom(t)
    }
    const note = MUSIC.melody[step]
    // occasional dropped note keeps the loop from feeling mechanical
    if (note >= 0 && Math.random() > 0.12) this.pluck(MUSIC.scale[note], t)
  }

  padNote (freq, t, dur, vol, type = 'sawtooth') {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = type
    osc.frequency.value = freq
    osc.detune.value = (Math.random() - 0.5) * 14
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 420
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(vol, t + dur * 0.35)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(filter).connect(gain).connect(this.musicGain)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }

  pluck (freq, t, vol = 0.16) {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(vol, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
    osc.connect(gain)
    gain.connect(this.musicGain)
    gain.connect(this.musicEcho)
    osc.start(t)
    osc.stop(t + 1.2)
  }

  boom (t) {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(55, t)
    osc.frequency.exponentialRampToValueAtTime(27, t + 0.9)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.4, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
    osc.connect(gain).connect(this.musicGain)
    osc.start(t)
    osc.stop(t + 1.2)
  }

  tone ({ from, to, dur, type = 'sine', vol = 0.5, delay = 0 }) {
    const ctx = this.ensure()
    if (!ctx || this.muted) return
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, t0)
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur)
    gain.gain.setValueAtTime(vol, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
    osc.connect(gain).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  whoosh ({ from = 3000, to = 600, dur = 0.16, vol = 0.4 }) {
    const ctx = this.ensure()
    if (!ctx || this.muted) return
    const t0 = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuf
    const filter = ctx.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 1.2
    filter.frequency.setValueAtTime(from, t0)
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(vol, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
    src.connect(filter).connect(gain).connect(this.master)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  }

  swing () { this.whoosh({ from: 2600, to: 500, dur: 0.15, vol: 0.35 }) }
  dash () { this.whoosh({ from: 900, to: 2800, dur: 0.22, vol: 0.35 }) }
  hit () {
    this.tone({ from: 200, to: 70, dur: 0.12, type: 'square', vol: 0.3 })
    this.whoosh({ from: 4000, to: 1500, dur: 0.06, vol: 0.25 })
  }
  hurt () { this.tone({ from: 320, to: 90, dur: 0.22, type: 'sawtooth', vol: 0.4 }) }
  coin () {
    this.tone({ from: 980, to: 980, dur: 0.07, type: 'triangle', vol: 0.3 })
    this.tone({ from: 1320, to: 1320, dur: 0.18, type: 'triangle', vol: 0.3, delay: 0.07 })
  }
  heal () {
    this.tone({ from: 520, to: 520, dur: 0.1, type: 'sine', vol: 0.3 })
    this.tone({ from: 660, to: 660, dur: 0.1, type: 'sine', vol: 0.3, delay: 0.09 })
    this.tone({ from: 780, to: 780, dur: 0.2, type: 'sine', vol: 0.3, delay: 0.18 })
  }
  enemyDeath () { this.tone({ from: 260, to: 40, dur: 0.3, type: 'sawtooth', vol: 0.3 }) }
  playerDeath () { this.tone({ from: 240, to: 30, dur: 0.9, type: 'sawtooth', vol: 0.5 }) }
  bossRoar () {
    this.tone({ from: 70, to: 45, dur: 0.6, type: 'sawtooth', vol: 0.55 })
    this.tone({ from: 110, to: 60, dur: 0.6, type: 'square', vol: 0.3 })
  }
  victory () {
    const notes = [523, 659, 784, 1046]
    notes.forEach((n, i) => this.tone({ from: n, to: n, dur: 0.3, type: 'triangle', vol: 0.35, delay: i * 0.14 }))
  }
  gameover () {
    const notes = [392, 330, 262, 196]
    notes.forEach((n, i) => this.tone({ from: n, to: n * 0.97, dur: 0.4, type: 'sawtooth', vol: 0.3, delay: i * 0.22 }))
  }
  join () { this.tone({ from: 660, to: 880, dur: 0.18, type: 'triangle', vol: 0.3 }) }
  cast () {
    this.tone({ from: 720, to: 180, dur: 0.25, type: 'sawtooth', vol: 0.2 })
    this.whoosh({ from: 1800, to: 420, dur: 0.2, vol: 0.2 })
  }
  arrow () {
    this.whoosh({ from: 5200, to: 900, dur: 0.12, vol: 0.4 })
    this.tone({ from: 1300, to: 220, dur: 0.08, type: 'square', vol: 0.15 })
  }
  aim () { this.tone({ from: 220, to: 460, dur: 0.55, type: 'sine', vol: 0.13 }) }
  shatter () { this.whoosh({ from: 2800, to: 2000, dur: 0.08, vol: 0.16 }) }
}

export const audio = new AudioFx()
