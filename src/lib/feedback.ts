let ctx: AudioContext | null = null

export const feedbackEnabled = () => localStorage.getItem("scan-feedback") !== "off"

/** Short haptic + beep. `ok=false` gives a lower double buzz for "not found". */
export function scanFeedback(ok = true) {
  if (!feedbackEnabled()) return
  try {
    navigator.vibrate?.(ok ? 40 : [60, 50, 60])
  } catch {}
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx ??= new AC()
    if (ctx.state === "suspended") void ctx.resume()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = ok ? 1650 : 320
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.12 : 0.25))
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
  } catch {}
}
