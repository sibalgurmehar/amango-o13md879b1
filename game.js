/* "Find Your Way to Me" — a tiny pseudo-3D walking game.
   Tap / click anywhere on the map to walk Aman there (arrow keys work too).
   Gur starts walking towards him once he moves. When they meet: hearts. */
window.MeetGame = function (canvas, opts) {
  const ctx = canvas.getContext("2d");
  const L = opts.landmarks;           // [{name, note, x, y}]
  const msg = opts.message;
  let W = 300, H = 400, dpr = Math.min(2, window.devicePixelRatio || 1);
  const A = { x: 0.1, y: 0.92, tx: 0.1, ty: 0.92, label: "A", name: "Aman", col: "#2f4a6b", step: 0 };
  const G = { x: 0.9, y: 0.9, tx: 0.9, ty: 0.9, label: "G", name: "Gur", col: "#6e2f42", step: 0 };
  let started = false, met = false, t0 = performance.now(), toast = null, hearts = [], visited = new Set(), keys = {};

  function size() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return false;
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }
  // perspective projection of the floor plane
  const HZ = () => H * 0.2;
  function proj(x, y) {
    const z = 1 + (1 - y) * 1.7;
    return { x: W / 2 + (x - 0.5) * W * 1.25 / z, y: HZ() + (H * 0.97 - HZ()) / z, s: 1 / z };
  }
  function unproj(sx, sy) {
    const z = Math.max(1, (H * 0.97 - HZ()) / Math.max(1, sy - HZ()));
    return { x: Math.min(.97, Math.max(.03, (sx - W / 2) * z / (W * 1.25) + 0.5)), y: Math.min(.98, Math.max(.02, 1 - (z - 1) / 1.7)) };
  }

  function drawFloor() {
    const sky = ctx.createLinearGradient(0, 0, 0, HZ() + 40);
    sky.addColorStop(0, "#2a1a20"); sky.addColorStop(1, "#5a3540");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    // stars
    ctx.fillStyle = "rgba(255,230,230,.6)";
    for (let i = 0; i < 26; i++) { const sx = (i * 97) % W, sy = (i * 53) % (HZ() * .9); ctx.fillRect(sx, sy, 1.4, 1.4); }
    // ground
    const a = proj(-0.3, 0), b = proj(1.3, 0), c = proj(1.3, 1), d = proj(-0.3, 1);
    const g = ctx.createLinearGradient(0, HZ(), 0, H);
    g.addColorStop(0, "#cdbdb8"); g.addColorStop(1, "#efe6e1");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.fill();
    // grid
    ctx.strokeStyle = "rgba(110,47,66,.12)"; ctx.lineWidth = 1;
    for (let i = -3; i <= 13; i++) { const p = proj(i / 10, 0), q = proj(i / 10, 1); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    for (let j = 0; j <= 10; j++) { const p = proj(-0.3, j / 10), q = proj(1.3, j / 10); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    // dotted route through the landmarks, in order
    ctx.strokeStyle = "rgba(110,47,66,.55)"; ctx.setLineDash([4, 6]); ctx.lineWidth = 2;
    ctx.beginPath(); L.forEach((l, i) => { const p = proj(l.x, l.y); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
    ctx.setLineDash([]);
  }
  function drawLandmark(l, now) {
    const p = proj(l.x, l.y), s = p.s, on = visited.has(l.name);
    ctx.fillStyle = "rgba(0,0,0,.12)"; ctx.beginPath(); ctx.ellipse(p.x, p.y, 14 * s * 2, 5 * s * 2, 0, 0, 7); ctx.fill();
    const h = 34 * s * 2 + (on ? Math.sin(now / 300) * 2 : 0);
    ctx.fillStyle = on ? "#b9848f" : "#8a6f74";
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 7 * s * 2, p.y - h * .55); ctx.arc(p.x, p.y - h * .62, 7.5 * s * 2, Math.PI * .85, Math.PI * .15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y - h * .62, 3 * s * 2, 0, 7); ctx.fill();
    ctx.fillStyle = "#2f2226"; ctx.font = `${Math.max(9, 13 * s * 1.6)}px "Cormorant Garamond", Georgia, serif`;
    ctx.textAlign = "center"; ctx.fillText(l.name, p.x, p.y - h - 4);
  }
  function drawPerson(P, now) {
    const p = proj(P.x, P.y), s = p.s * 2.1;
    const moving = Math.hypot(P.tx - P.x, P.ty - P.y) > .004;
    const bob = moving ? Math.abs(Math.sin(P.step)) * 4 * s : Math.sin(now / 500) * 1.2 * s;
    ctx.fillStyle = "rgba(0,0,0,.18)"; ctx.beginPath(); ctx.ellipse(p.x, p.y, 11 * s, 4 * s, 0, 0, 7); ctx.fill();
    // legs
    ctx.strokeStyle = "#2f2226"; ctx.lineWidth = 3 * s; ctx.lineCap = "round";
    const sw = moving ? Math.sin(P.step) * 5 * s : 0;
    ctx.beginPath(); ctx.moveTo(p.x - 3 * s, p.y - 14 * s - bob); ctx.lineTo(p.x - 3 * s + sw, p.y - 1);
    ctx.moveTo(p.x + 3 * s, p.y - 14 * s - bob); ctx.lineTo(p.x + 3 * s - sw, p.y - 1); ctx.stroke();
    // body
    ctx.fillStyle = P.col; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(p.x - 8 * s, p.y - 34 * s - bob, 16 * s, 22 * s, 7 * s) : ctx.rect(p.x - 8 * s, p.y - 34 * s - bob, 16 * s, 22 * s); ctx.fill();
    // head
    ctx.fillStyle = "#f2d6c4"; ctx.beginPath(); ctx.arc(p.x, p.y - 42 * s - bob, 9 * s, 0, 7); ctx.fill();
    ctx.fillStyle = P === G ? "#2b1a14" : "#1d1412";
    ctx.beginPath(); ctx.arc(p.x, p.y - 45 * s - bob, 9 * s, Math.PI, 0); ctx.fill();
    if (P === G) { ctx.fillRect(p.x - 9 * s, p.y - 45 * s - bob, 3.5 * s, 16 * s); ctx.fillRect(p.x + 5.5 * s, p.y - 45 * s - bob, 3.5 * s, 16 * s); }
    // glasses (both wear them!)
    ctx.strokeStyle = "#2f2226"; ctx.lineWidth = 1.1 * s;
    ctx.beginPath(); ctx.arc(p.x - 3.4 * s, p.y - 41 * s - bob, 2.6 * s, 0, 7); ctx.moveTo(p.x + 6 * s, p.y - 41 * s - bob); ctx.arc(p.x + 3.4 * s, p.y - 41 * s - bob, 2.6 * s, 0, 7); ctx.stroke();
    // name tag
    ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = `600 ${Math.max(9, 10 * s)}px Jost, system-ui, sans-serif`; ctx.textAlign = "center";
    const tw = ctx.measureText(P.name).width + 10;
    ctx.fillRect(p.x - tw / 2, p.y - 66 * s - bob, tw, 14); ctx.fillStyle = P.col; ctx.fillText(P.name, p.x, p.y - 66 * s - bob + 11);
  }
  function drawHearts(dt) {
    hearts = hearts.filter(h => (h.life -= dt) > 0);
    hearts.forEach(h => {
      h.x += h.vx * dt; h.y += h.vy * dt; h.vy += 30 * dt;
      ctx.globalAlpha = Math.min(1, h.life); ctx.fillStyle = h.c; ctx.font = `${h.size}px serif`; ctx.fillText("♥", h.x, h.y);
    });
    ctx.globalAlpha = 1;
  }
  function burst(x, y, n, spread) {
    for (let i = 0; i < n; i++) hearts.push({ x, y, vx: (Math.random() - .5) * spread, vy: -Math.random() * spread - 40, life: 1.4 + Math.random(), size: 10 + Math.random() * 14, c: ["#b9848f", "#6e2f42", "#e3b9c2", "#d8b25a"][i % 4] });
  }
  function drawUI(now) {
    ctx.textAlign = "center";
    if (!started) {
      ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.font = `italic ${Math.max(13, W / 26)}px "Cormorant Garamond", Georgia, serif`;
      ctx.fillText("Tap anywhere to walk Aman to Gur", W / 2, HZ() - 18);
    }
    if (toast && now - toast.t < 2600) {
      const a = Math.min(1, (2600 - (now - toast.t)) / 400);
      ctx.globalAlpha = a; ctx.fillStyle = "rgba(36,22,27,.85)";
      ctx.font = `italic ${Math.max(12, W / 30)}px "Cormorant Garamond", Georgia, serif`;
      const tw = ctx.measureText(toast.text).width + 26; ctx.fillRect(W / 2 - tw / 2, 12, tw, 30);
      ctx.fillStyle = "#f6ece8"; ctx.fillText(toast.text, W / 2, 32); ctx.globalAlpha = 1;
    }
    if (met) {
      ctx.fillStyle = "rgba(36,22,27,.72)"; ctx.fillRect(0, H * .3, W, H * .32);
      ctx.fillStyle = "#f6ece8"; ctx.font = `${Math.max(26, W / 11)}px "Pinyon Script", cursive`;
      ctx.fillText("Found you.", W / 2, H * .3 + H * .12);
      ctx.font = `italic ${Math.max(12, W / 30)}px "Cormorant Garamond", Georgia, serif`;
      wrap(msg, W / 2, H * .3 + H * .19, W * .82, Math.max(15, W / 24));
      ctx.font = `${Math.max(9, W / 48)}px Jost, sans-serif`; ctx.fillStyle = "#d8c4c0";
      ctx.fillText("TAP TO PLAY AGAIN", W / 2, H * .3 + H * .3);
    }
  }
  function wrap(text, x, y, max, lh) {
    const words = text.split(" "); let line = "";
    for (const w of words) { const t = line + w + " "; if (ctx.measureText(t).width > max && line) { ctx.fillText(line.trim(), x, y); line = w + " "; y += lh; } else line = t; }
    ctx.fillText(line.trim(), x, y);
  }
  function move(P, speed, dt) {
    const dx = P.tx - P.x, dy = P.ty - P.y, d = Math.hypot(dx, dy);
    if (d < .004) return;
    const st = Math.min(d, speed * dt);
    P.x += dx / d * st; P.y += dy / d * st; P.step += dt * 11;
  }
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (canvas.isConnected && canvas.getBoundingClientRect().width > 0) {
      if (Math.abs(canvas.getBoundingClientRect().width - W) > 2) size();
      // keyboard
      const kx = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0), ky = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
      if ((kx || ky) && !met) { started = true; A.tx = Math.min(.97, Math.max(.03, A.x + kx * .05)); A.ty = Math.min(.98, Math.max(.02, A.y + ky * .05)); }
      if (!met) {
        move(A, .32, dt);
        if (started) { G.tx = A.x; G.ty = A.y; move(G, .09, dt); }
        for (const l of L) {
          if (!visited.has(l.name) && Math.hypot(A.x - l.x, A.y - l.y) < .07) {
            visited.add(l.name); toast = { text: `${l.name} — ${l.note}`, t: now };
            const p = proj(l.x, l.y); burst(p.x, p.y - 30, 6, 60);
          }
        }
        if (started && Math.hypot(A.x - G.x, A.y - G.y) < .045) {
          met = true; const p = proj((A.x + G.x) / 2, (A.y + G.y) / 2); burst(p.x, p.y - 50, 40, 220);
        }
        if (started && Math.random() < dt * 3 && Math.hypot(A.tx - A.x, A.ty - A.y) > .01) { const p = proj(A.x, A.y); burst(p.x, p.y - 10, 1, 20); }
      }
      drawFloor();
      const things = L.map(l => ({ y: l.y, d: n => drawLandmark(l, n) })).concat([{ y: A.y, d: n => drawPerson(A, n) }, { y: G.y, d: n => drawPerson(G, n) }]);
      things.sort((a, b) => a.y - b.y).forEach(t => t.d(now));
      drawHearts(dt);
      drawUI(now);
    }
    requestAnimationFrame(frame);
  }
  function reset() {
    Object.assign(A, { x: .1, y: .92, tx: .1, ty: .92 }); Object.assign(G, { x: .9, y: .9, tx: .9, ty: .9 });
    started = false; met = false; visited.clear(); hearts = []; toast = null;
  }
  function tap(e) {
    e.stopPropagation(); e.preventDefault();
    if (met) { reset(); return; }
    const r = canvas.getBoundingClientRect();
    const pt = e;
    if (pt.clientY - r.top < HZ() - 4) return;
    const w = unproj(pt.clientX - r.left, pt.clientY - r.top);
    A.tx = w.x; A.ty = w.y; started = true;
  }
  ["mousedown", "mouseup", "touchstart", "touchmove", "touchend", "wheel", "click"].forEach(ev => canvas.addEventListener(ev, e => e.stopPropagation(), { passive: true }));
  canvas.addEventListener("pointerdown", e => { canvas.focus({ preventScroll: true }); tap(e); });
  window.addEventListener("keydown", e => { if (canvas.getBoundingClientRect().width > 0 && e.key.startsWith("Arrow") && document.activeElement === canvas) { keys[e.key] = true; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  window.addEventListener("keyup", e => { keys[e.key] = false; });
  canvas.tabIndex = 0;
  size(); requestAnimationFrame(frame);
  return { reset };
};
