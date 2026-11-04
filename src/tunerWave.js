// Talas preko skale tunera: pojavi se kad zazvoni žica, klizi dok žica nije naštimovana
// (levo = prenisko, desno = previsoko; što dalje od tona, to brže), za sobom ostavlja blagi trag
// koji polako bledi, a kad je žica naštimovana — stane i zasvetli zeleno. Kad žica utihne, nestane.
// Crta se na <canvas> preko skale (prozirno, „screen“ mešanje — na crnoj pozadini svetli).

const HALF_TRAIL = 0.42;      // s — za koliko trag izbledi upola (polako, ali diskretno)
const HALF_TRAIL_OK = 0.3;
const DRIFT = 3.2;            // px/s po centu (na širini 390 px)
const RED = [255, 107, 91], ORANGE = [245, 165, 36], GREEN = [61, 214, 140];

const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const rgb = (c, a = 1) => `rgba(${c.map(Math.round).join(',')},${a})`;

export function createWave(host) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Slabiji telefoni: manja rezolucija i ~30 slika u sekundi (kazaljka i očitavanje imaju prednost)
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 2;
  const canvas = document.createElement('canvas');
  canvas.className = 'nm-wave';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  function size() {
    const vw = document.documentElement.clientWidth;
    const w = Math.min(vw, host.offsetWidth + 120), h = host.offsetHeight + 20;
    if (!w || !h) return;
    dpr = Math.min(window.devicePixelRatio || 1, lowEnd ? 1.5 : 2);
    W = w; H = h;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.style.left = Math.round((host.offsetWidth - w) / 2) + 'px';
    canvas.style.top = '-10px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(size).observe(host);
  size();

  const target = { active: false, cents: 0, ok: false, level: 0.6 };
  let amp = 0, cents = 0, phase = 0, col = ORANGE.slice(), raf = 0, last = 0, skip = false, idleFor = 0;

  function frame(ts) {
    raf = 0;
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016);
    last = ts;
    if (lowEnd && (skip = !skip)) { raf = requestAnimationFrame(frame); return; }
    const d = lowEnd ? dt * 2 : dt;
    // jačina: lagano se pojavi (~0,5 s), lagano nestane
    const want = target.active ? target.level : 0;
    amp += (want - amp) * (1 - Math.exp(-d / (want > amp ? 0.18 : 0.3)));
    cents += (target.cents - cents) * (1 - Math.exp(-d / 0.12));
    const tc = target.ok ? GREEN : mix(RED, ORANGE, Math.max(0, Math.min(1, (20 - Math.abs(cents)) / 17)));
    col = mix(col, tc, 1 - Math.exp(-d / 0.15));
    if (!target.ok && !reduce) phase += cents * DRIFT * (W / 390) * d;

    // trag: prethodna slika polako bledi
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0,0,0,${reduce ? 1 : 1 - Math.pow(0.5, d / (target.ok ? HALF_TRAIL_OK : HALF_TRAIL))})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    if (amp > 0.01) {
      const a = H * (target.ok ? 0.17 : 0.2) * amp;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 3) {
        const env = Math.sin(Math.PI * x / W);
        const y = H * 0.52 + env * env * a * Math.sin((x + phase) / W * Math.PI * 4);
        if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      const glow = Math.min(1, amp * 1.4);
      // tanka linija sa jačim sjajem: mekani sjaj + svetlo jezgro
      ctx.lineWidth = 3; ctx.strokeStyle = rgb(col, 0.55 * glow);
      ctx.shadowColor = rgb(col); ctx.shadowBlur = lowEnd ? 12 : (target.ok ? 26 : 20);
      ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = rgb(mix(col, [255, 255, 255], 0.35), glow);
      ctx.shadowBlur = lowEnd ? 6 : (target.ok ? 12 : 9);
      ctx.stroke();
      ctx.shadowBlur = 0;
      idleFor = 0;
    } else idleFor += d;

    // ništa ne zvoni i trag je izbledeo — stani (ne troši bateriju)
    if (!target.active && idleFor > 2) { ctx.clearRect(0, 0, W, H); last = 0; return; }
    raf = requestAnimationFrame(frame);
  }
  const run = () => { if (!raf) raf = requestAnimationFrame(frame); };

  return {
    /** Stanje iz tunera: žica zvoni (cents, ok) ili ne (active: false). */
    set(s) {
      Object.assign(target, s);
      if (target.active) run();
    },
    stop() { target.active = false; },
  };
}
