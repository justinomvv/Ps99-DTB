/* ===========================================================
   PS99Sounds — tiny synthesized UI cues via WebAudio.
   No external audio files: keeps the site lightweight and
   sidesteps any licensing questions around sourced sfx.
=========================================================== */
const PS99Sounds = (() => {
  let ctx = null;
  let enabled = localStorage.getItem("ps99_sound") !== "off";

  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, gainPeak, type = "sine") {
    const c = ensureCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, c.currentTime + start);
    gain.gain.setValueAtTime(0, c.currentTime + start);
    gain.gain.linearRampToValueAtTime(gainPeak, c.currentTime + start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime + start);
    osc.stop(c.currentTime + start + dur + 0.02);
  }

  function tick() {
    if (!enabled) return;
    tone(720, 0, 0.09, 0.05, "sine");
  }

  function chime() {
    if (!enabled) return;
    tone(660, 0, 0.16, 0.06, "triangle");
    tone(990, 0.07, 0.22, 0.05, "triangle");
  }

  function errorTone() {
    if (!enabled) return;
    tone(220, 0, 0.18, 0.05, "sawtooth");
  }

  function setEnabled(v) {
    enabled = v;
    localStorage.setItem("ps99_sound", v ? "on" : "off");
    if (v) ensureCtx();
  }

  function isEnabled() { return enabled; }

  return { tick, chime, errorTone, setEnabled, isEnabled };
})();
