/* Volume III — runtime
   1. unlock: passcode -> PBKDF2 -> unwrap master key
   2. decrypt book.bin (all words) and photos on demand
   3. build pages, hand them to StPageFlip
*/
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const te = new TextEncoder();
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  };
  const local = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let master = null, book = null, flip = null;
  const urlCache = new Map();

  // ---------- crypto ----------
  async function aesKey(raw) {
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  }
  async function open(key, buf) {
    const u = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, key, u.slice(12));
  }
  async function tryUnlock(code) {
    const vault = await (await fetch("vault.json", { cache: "no-store" })).json();
    const pw = await crypto.subtle.importKey("raw", te.encode(code), "PBKDF2", false, ["deriveBits"]);
    for (const k of vault.keys) {
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: b64(k.salt), iterations: vault.iter }, pw, 256);
      try {
        const raw = await open(await aesKey(bits), b64(k.wrapped));
        return new Uint8Array(raw);
      } catch { /* wrong spelling, try next */ }
    }
    return null;
  }
  async function fetchPlain(name) {
    const res = await fetch(name);
    return open(master, await res.arrayBuffer());
  }
  async function photoURL(key) {
    if (urlCache.has(key)) return urlCache.get(key);
    const file = book._photos[key];
    if (!file) return null;
    const p = fetchPlain(file).then(buf => URL.createObjectURL(new Blob([buf], { type: "image/jpeg" })));
    urlCache.set(key, p);
    return p;
  }

  // ---------- lock screen ----------
  const form = $("#lockForm"), input = $("#code"), hint = $("#hint");
  $("#sealBtn").addEventListener("click", () => input.focus());
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const code = input.value.replace(/\D/g, "");
    if (!code) return;
    hint.textContent = "Checking…";
    const key = await tryUnlock(code);
    if (!key) {
      hint.textContent = "Not quite. Think about January.";
      form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake");
      return;
    }
    store.set("v3k", btoa(String.fromCharCode(...key)));
    master = await aesKey(key);
    $("#lock").classList.add("open");
    hint.textContent = "";
    setTimeout(start, 1700);
  });

  (async () => {
    const saved = store.get("v3k");
    if (saved) {
      try { master = await aesKey(b64(saved)); $("#lock").hidden = true; start(); } catch {}
    }
  })();

  // ---------- build ----------
  async function start() {
    $("#loading").hidden = false;
    try {
      book = JSON.parse(new TextDecoder().decode(await fetchPlain("book.bin")));
    } catch (e) {
      store.set("v3k", "");
      location.reload();
      return;
    }
    $("#lock").hidden = true;
    render();
    $("#loading").hidden = true;
    $("#stage").hidden = false;
    initFlip();
    hearts();
  }

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rich = s => esc(s).replace(/\*(.+?)\*/g, "<em>$1</em>");
  const ph = (p, cls = "", cap = "") =>
    `<div class="ph ${cls}" data-p="${esc(p)}" data-cap="${esc(cap)}"><img alt=""></div>`;

  const T = {
    cover: d => `
      <div class="page cover" data-density="hard">
        ${ph(d.photo)}
        <div class="cover-shade"></div>
        <div class="cover-top">
          <div class="cover-meta"><span>${esc(d.issue)}</span><span>${esc(d.date)}</span></div>
          <div class="masthead">${esc(d.masthead)}</div>
        </div>
        <div class="cover-lines">${d.lines.map(l => `<div class="cl"><b>${rich(l.t)}</b><span>${esc(l.s)}</span></div>`).join("")}</div>
        <div class="cover-badge"><strong>${esc(d.badge.n)}</strong><small>${esc(d.badge.s)}</small></div>
      </div>`,

    dedication: d => `
      <div class="page dedication"><div class="page-inner">
        <p class="kicker">${esc(d.kicker)}</p>
        <h2>${esc(d.title)}</h2>
        <div class="orn"></div>
        ${d.lines.map(l => `<p>${rich(l)}</p>`).join("")}
        <div class="orn"></div>
        <p class="epi">${rich(d.epigraph)}</p>
      </div></div>`,

    contents: d => `
      <div class="page contents"><div class="page-inner">
        <p class="kicker">In this issue</p>
        <h2>Contents</h2>
        <ol class="toc-list">${d.items.map((it, i) => `
          <li data-go="${esc(it.go)}"><span class="n">${String(i + 1).padStart(2, "0")}</span>
            <span class="t">${rich(it.t)}</span><span class="d"></span><span class="s">${esc(it.s)}</span></li>`).join("")}
        </ol>
      </div></div>`,

    letter: d => `
      <div class="page letter"><div class="page-inner">
        ${ph(d.photo, "bw")}
        <div class="letter-body">
          <p class="salute">${esc(d.salute)}</p>
          ${d.paras.map(p => `<p>${rich(p)}</p>`).join("")}
          <p class="sign">${esc(d.close)}<br><span class="sig">${esc(d.sig)}</span></p>
        </div>
        <div class="brand">${esc(d.brand)}</div>
      </div></div>`,

    numbers: d => `
      <div class="page numbers mauve"><div class="page-inner">
        <p class="kicker">${esc(d.kicker)}</p>
        <h2>${rich(d.title)}</h2>
        <div class="num-grid">
          <div class="num wide"><strong data-since="${d.proposal}">—</strong><span>days since the first question · 14.12.2021</span>
            <div class="ticker" data-tick="${d.proposal}"></div></div>
          <div class="num"><strong data-since="${d.official}">—</strong><span>days official · since 07.01.2022</span></div>
          <div class="num"><strong data-until="${d.five}">—</strong><span>days until five years</span></div>
          ${d.extra.map(x => `<div class="num"><strong>${esc(x.n)}</strong><span>${esc(x.s)}</span></div>`).join("")}
        </div>
        ${d.photo ? `<div class="fill">${ph(d.photo, "bw", d.cap || "")}</div>` : ""}
      </div></div>`,

    chapter: d => `
      <div class="page chapter dark">
        ${ph(d.photo)}
        <div class="shade"></div>
        <div class="ch-text">
          <p class="ch-no">${esc(d.no)}</p>
          <h2 class="ch-title">${rich(d.title)}</h2>
          <p class="ch-dek">${rich(d.dek)}</p>
        </div>
      </div>`,

    spread: d => `
      <div class="page spread ${d.tone || ""}"><div class="page-inner">
        <div class="head"><h3>${rich(d.title)}</h3><span class="kicker">${esc(d.label || "")}</span></div>
        <div class="grid ${d.layout || "g-a"}">
          ${d.photos.map(x => `<div class="cell">${ph(x.p, x.bw ? "bw" : "", x.cap)}${x.cap ? `<p class="cap">${rich(x.cap)}</p>` : ""}</div>`).join("")}
        </div>
        ${d.body ? `<p class="body-copy">${rich(d.body)}</p>` : ""}
        ${d.pull ? `<p class="pull">${rich(d.pull)}</p>` : ""}
      </div></div>`,

    feature: d => `
      <div class="page feature ${d.tone || ""}"><div class="page-inner">
        ${ph(d.photo, "hero", d.cap)}
        <p class="kicker">${esc(d.kicker)}</p>
        <h3>${rich(d.title)}</h3>
        <p class="body-copy">${rich(d.body)}</p>
        ${d.pull ? `<p class="pull">${rich(d.pull)}</p>` : ""}
      </div></div>`,

    scrap: d => `
      <div class="page scrap ${d.tone || "mauve"}"><div class="page-inner">
        <div class="head"><h3>${rich(d.title)}</h3><span class="kicker">${esc(d.label || "")}</span></div>
        <div class="scrap-board">
          ${d.items.map(x => `<div class="pol" style="left:${x.x}%;top:${x.y}%;width:${x.w}%;height:${x.h}%;transform:rotate(${x.r}deg)">
              ${x.tape ? '<span class="tape"></span>' : ""}${ph(x.p, "", x.cap)}<span class="pcap">${esc(x.cap || "")}</span></div>`).join("")}
          ${(d.notes || []).map(n => `<p class="note" style="left:${n.x}%;top:${n.y}%;transform:rotate(${n.r || 0}deg)">${esc(n.t)}</p>`).join("")}
        </div>
      </div></div>`,

    film: d => `
      <div class="page film dark"><div class="page-inner">
        <div class="head"><h3>${rich(d.title)}</h3><span class="kicker">${esc(d.label || "")}</span></div>
        <div class="strip">${d.photos.map(x => ph(x.p, "", x.cap)).join("")}</div>
      </div></div>`,

    qa: d => `
      <div class="page qa"><div class="page-inner">
        <p class="kicker">${esc(d.kicker)}</p>
        <h2>${rich(d.title)}</h2>
        <p class="intro">${rich(d.intro)}</p>
        ${d.questions.map((q, i) => `<div class="q"><label><b>${i + 1}.</b>${esc(q)}</label>
          <textarea data-qa="${i}" rows="1" placeholder="…"></textarea></div>`).join("")}
        ${d.photo ? `<div class="fill">${ph(d.photo, "bw", d.cap || "")}</div>` : ""}
      </div></div>`,

    likely: d => `
      <div class="page likely mauve"><div class="page-inner">
        <p class="kicker">${esc(d.kicker)}</p>
        <h2 style="font-family:var(--display);font-size:2rem;line-height:1">${rich(d.title)}</h2>
        <p class="intro" style="font-style:italic;color:var(--ink-soft);margin-top:.4rem">${rich(d.intro)}</p>
        <div class="ml-list">${d.items.map((t, i) => `<div class="ml" data-ml="${i}"><span>${esc(t)}</span>
          <button data-who="G">GURMEHAR</button><button data-who="A">AMAN</button></div>`).join("")}</div>
        ${d.photo ? `<div class="fill">${ph(d.photo, "bw", d.cap || "")}</div>` : ""}
      </div></div>`,

    envelopes: d => `
      <div class="page envelopes"><div class="page-inner">
        <p class="kicker">${esc(d.kicker)}</p>
        <h2 style="font-family:var(--display);font-size:2rem;font-style:italic;font-weight:400">${rich(d.title)}</h2>
        <p style="font-style:italic;color:var(--ink-soft);margin-top:.3rem">${rich(d.intro)}</p>
        <div class="env-grid">${d.letters.map((l, i) => `<button class="mini-env" data-env="${d.id}:${i}"><i></i><span>${esc(l.label)}</span></button>`).join("")}</div>
        ${d.photo ? `<div class="fill">${ph(d.photo, "bw", d.cap || "")}</div>` : ""}
      </div></div>`,

    mosaic: d => `
      <div class="page mosaic dark"><div class="page-inner">
        <h3>${rich(d.title)}</h3>
        <p class="sub">${esc(d.sub)}</p>
        <div class="heart" data-heart></div>
      </div></div>`,

    sealed: d => `
      <div class="page sealed mauve"><div class="page-inner">
        <p class="kicker">${esc(d.kicker)}</p>
        <h3>${rich(d.title)}</h3>
        <div class="big-env"><button class="seal" data-sealed="${d.id}" aria-label="Open the five-year letter"><span>V</span></button></div>
        <p class="count" data-until-full="${d.date}"></p>
        <p style="font-style:italic;color:var(--ink-soft)">${rich(d.note)}</p>
      </div></div>`,

    end: d => `
      <div class="page end"><div class="page-inner">
        <p class="kicker">${esc(d.kicker)}</p>
        <h2>${rich(d.title)}</h2>
        <div class="orn"></div>
        ${d.lines.map(l => `<p style="font-size:1.2rem;line-height:1.5;max-width:28ch">${rich(l)}</p>`).join("")}
        <p class="script">${esc(d.script)}</p>
      </div></div>`,

    reel: d => `
      <div class="page reelpage dark"><div class="page-inner">
        <div class="head"><h3>${rich(d.title)}</h3><span class="kicker">${esc(d.label || "")}</span></div>
        <div class="reel-wrap">
          <button class="reel-btn prev" aria-label="Scroll back">&lsaquo;</button>
          <div class="reel">${d.photos.map((x, i) => `<div class="rf">${ph(x.p, "", x.cap || "")}<span class="rn">${String(i + 1).padStart(2, "0")}</span></div>`).join("")}</div>
          <button class="reel-btn next" aria-label="Scroll forward">&rsaquo;</button>
        </div>
        <p class="reel-hint">${esc(d.hint || "swipe the reel · tap a frame to open it")}</p>
      </div></div>`,

    game: d => `
      <div class="page gamepage dark"><div class="page-inner">
        <div class="head"><h3>${rich(d.title)}</h3><span class="kicker">${esc(d.label || "")}</span></div>
        <div class="meet-wrap"><canvas class="meet" data-game="${esc(d.id)}" aria-label="Interactive map game"></canvas></div>
        <p class="reel-hint">${esc(d.hint || "")}</p>
      </div></div>`,

    atlas: d => `
      <div class="page atlas"><div class="page-inner">
        <p class="kicker">${esc(d.kicker)}</p>
        <h2 class="atlas-title">${rich(d.title)}</h2>
        <div class="route-wrap"><ol class="route">${d.places.map(p => `<li><span class="pin"></span><div><b>${esc(p.name)}</b><small>${esc(p.note)}</small></div></li>`).join("")}</ol>
        <p class="scroll-hint">scroll the route ↓</p>
        <p class="pull">${rich(d.foot)}</p>
      </div></div>`,

    list: d => `
      <div class="page listpage mauve"><div class="page-inner">
        <p class="kicker">${esc(d.kicker)}</p>
        <h2 class="atlas-title">${rich(d.title)}</h2>
        <ol class="truths">${d.items.map(t => `<li>${rich(t)}</li>`).join("")}</ol>
        ${d.photo ? `<div class="fill">${ph(d.photo, "bw", d.cap || "")}</div>` : ""}
      </div></div>`,

    colophon: d => `
      <div class="page colophon"><div class="page-inner">
        <p class="kicker">A Note to Close</p>
        ${d.lines.map(l => `<p>${rich(l)}</p>`).join("")}
      </div></div>`,

    back: d => `
      <div class="page back" data-density="hard">
        ${ph(d.photo)}
        <div class="page-inner">
          <div class="masthead">${esc(d.masthead)}</div>
          <p class="kicker" style="color:#d8c4c0;margin-top:.6rem">${esc(d.line)}</p>
        </div>
      </div>`,
  };

  function render() {
    const el = $("#book");
    el.innerHTML = book.pages.map((p, i) => {
      const html = T[p.type](p).trim();
      return html.replace('class="page', `data-i="${i}" data-id="${esc(p.id || "")}" class="page`);
    }).join("");
    // folios
    $$(".page", el).forEach((pg, i) => {
      if (i === 0 || pg.classList.contains("cover") || pg.classList.contains("back") || pg.classList.contains("chapter")) return;
      const f = document.createElement("div");
      f.className = "folio"; f.textContent = `Vol. III · ${i}`;
      pg.appendChild(f);
    });
    wire();
  }

  // ---------- interactions ----------
  function wire() {
    // contents
    $$("[data-go]").forEach(li => li.addEventListener("click", () => goTo(li.dataset.go)));
    // photos -> lightbox
    $$("#book .ph").forEach(p => p.addEventListener("click", ev => {
      if (p.closest(".cover,.chapter,.back")) return;
      const img = $("img", p);
      if (!img.src) return;
      openLightbox(img.src, p.dataset.cap);
      ev.stopPropagation();
    }));
    // questionnaire
    const answers = local.get("v3-qa", {});
    $$("[data-qa]").forEach(t => {
      t.value = answers[t.dataset.qa] || "";
      t.addEventListener("input", () => { answers[t.dataset.qa] = t.value; local.set("v3-qa", answers); });
      ["mousedown", "touchstart", "pointerdown"].forEach(ev => t.addEventListener(ev, e => e.stopPropagation()));
    });
    // most likely
    const picks = local.get("v3-ml", {});
    $$("[data-ml]").forEach(row => {
      const set = who => { $$("button", row).forEach(b => b.classList.toggle("on", b.dataset.who === who)); };
      set(picks[row.dataset.ml]);
      $$("button", row).forEach(b => b.addEventListener("click", e => {
        e.stopPropagation();
        picks[row.dataset.ml] = b.dataset.who; local.set("v3-ml", picks); set(b.dataset.who); burst(e);
      }));
    });
    // envelopes
    $$("[data-env]").forEach(b => b.addEventListener("click", e => {
      e.stopPropagation();
      const [id, i] = b.dataset.env.split(":");
      const page = book.pages.find(p => p.id === id);
      const l = page.letters[+i];
      sheet(l.title, l.paras, l.sig || "Gur");
    }));
    // sealed
    $$("[data-sealed]").forEach(b => b.addEventListener("click", e => {
      e.stopPropagation();
      const page = book.pages.find(p => p.id === b.dataset.sealed);
      const when = new Date(page.date + "T00:00:00");
      if (Date.now() >= when.getTime() || location.hash === "#iamgurmehar") {
        sheet(page.letter.title, page.letter.paras, page.letter.sig);
      } else {
        const days = Math.ceil((when - Date.now()) / 864e5);
        sheet("Not yet, Amango.", [`This one opens on the fourteenth of December — five years to the day.`, `${days} more ${days === 1 ? "day" : "days"}. I promise it's worth the wait.`], "Gur");
      }
    }));
    // vertical scroll areas (atlas route) shouldn't turn the page
    $$(".route").forEach(r => ["mousedown", "pointerdown", "touchstart", "touchmove", "wheel"].forEach(ev =>
      r.addEventListener(ev, e => e.stopPropagation(), { passive: true })));
    // vertical scroll areas (atlas route, contents) shouldn't turn pages
    $$(".route-wrap, .toc-list").forEach(el => ["mousedown", "pointerdown", "touchstart", "touchmove", "wheel"].forEach(ev =>
      el.addEventListener(ev, e => e.stopPropagation(), { passive: true })));
    // film reels: scroll sideways without turning the page
    $$(".reel").forEach(r => {
      ["mousedown", "pointerdown", "touchstart", "touchmove", "wheel"].forEach(ev =>
        r.addEventListener(ev, e => e.stopPropagation(), { passive: true }));
      // desktop: click-and-drag to scroll the reel
      let dragX = null, startLeft = 0, moved = false;
      r.addEventListener("mousedown", e => { dragX = e.clientX; startLeft = r.scrollLeft; moved = false; r.classList.add("dragging"); e.preventDefault(); });
      window.addEventListener("mousemove", e => { if (dragX === null) return; const dx = e.clientX - dragX; if (Math.abs(dx) > 4) moved = true; r.scrollLeft = startLeft - dx; });
      window.addEventListener("mouseup", () => { if (dragX === null) return; dragX = null; r.classList.remove("dragging"); });
      r.addEventListener("click", e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
      const wrap = r.parentElement;
      const step = () => (r.querySelector(".rf")?.offsetWidth || 200) + 10;
      wrap.querySelector(".prev").addEventListener("click", e => { e.stopPropagation(); r.scrollBy({ left: -step(), behavior: "smooth" }); });
      wrap.querySelector(".next").addEventListener("click", e => { e.stopPropagation(); r.scrollBy({ left: step(), behavior: "smooth" }); });
      ["mousedown", "pointerdown", "touchstart"].forEach(ev => wrap.querySelectorAll(".reel-btn").forEach(b => b.addEventListener(ev, e => e.stopPropagation(), { passive: true })));
    });
    tickers();
    setInterval(tickers, 1000);
  }

  function sheet(title, paras, sig) {
    const o = document.createElement("div");
    o.className = "overlay";
    o.innerHTML = `<div class="sheet"><button class="x" aria-label="Close">&times;</button><h4>${rich(title)}</h4>
      ${paras.map(p => `<p>${rich(p)}</p>`).join("")}<p class="sig">${esc(sig)}</p></div>`;
    o.addEventListener("click", e => { if (e.target === o || e.target.classList.contains("x")) o.remove(); });
    document.body.appendChild(o);
  }

  const lb = $("#lightbox");
  function openLightbox(src, cap) {
    $("img", lb).src = src; $(".lb-cap", lb).textContent = cap || ""; lb.hidden = false;
  }
  lb.addEventListener("click", () => { lb.hidden = true; });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { lb.hidden = true; $$(".overlay").forEach(o => o.remove()); }
    if (!flip || !lb.hidden || $(".overlay")) return;
    if (e.key === "ArrowRight") flip.flipNext();
    if (e.key === "ArrowLeft") flip.flipPrev();
  });

  // live numbers
  function tickers() {
    const now = Date.now();
    $$("[data-since]").forEach(el => {
      el.textContent = Math.floor((now - new Date(el.dataset.since + "T00:00:00")) / 864e5).toLocaleString();
    });
    $$("[data-until]").forEach(el => {
      const d = Math.ceil((new Date(el.dataset.until + "T00:00:00") - now) / 864e5);
      el.textContent = d > 0 ? d : "0 ♥";
    });
    $$("[data-tick]").forEach(el => {
      let s = Math.floor((now - new Date(el.dataset.tick + "T00:00:00")) / 1000);
      const y = Math.floor(s / 31557600); s -= y * 31557600;
      const d = Math.floor(s / 86400); s -= d * 86400;
      const h = Math.floor(s / 3600); s -= h * 3600;
      const m = Math.floor(s / 60); s -= m * 60;
      el.textContent = `${y} years · ${d} days · ${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
    });
    $$("[data-until-full]").forEach(el => {
      let s = Math.floor((new Date(el.dataset.untilFull + "T00:00:00") - now) / 1000);
      if (s <= 0) { el.textContent = "It's time. Break the seal."; return; }
      const d = Math.floor(s / 86400); s -= d * 86400;
      const h = Math.floor(s / 3600); s -= h * 3600;
      const m = Math.floor(s / 60); s -= m * 60;
      el.textContent = `opens in ${d}d ${h}h ${m}m ${s}s`;
    });
  }

  // ---------- images ----------
  async function loadPage(i) {
    const pg = $(`#book .page[data-i="${i}"]`) || $$("#book .page")[i];
    if (!pg || pg.dataset.loaded) return;
    pg.dataset.loaded = 1;
    for (const p of $$(".ph", pg)) {
      const img = $("img", p);
      photoURL(p.dataset.p).then(u => { if (u) { img.onload = () => img.classList.add("in"); img.src = u; } });
    }
    const game = $("canvas[data-game]", pg);
    if (game && !game.dataset.on && window.MeetGame) {
      game.dataset.on = 1;
      const d = book.pages.find(x => x.id === game.dataset.game);
      window.MeetGame(game, { landmarks: d.landmarks, message: d.message });
    }
    const heart = $("[data-heart]", pg);
    if (heart) buildHeart(heart);
  }
  function loadAround(i) {
    for (let k = i - 2; k <= i + 5; k++) if (k >= 0) loadPage(k);
  }

  const HEART = (() => {
    const W = 18, H = 15, rows = [];
    for (let r = 0; r < H; r++) {
      let line = "";
      for (let c = 0; c < W; c++) {
        const x = (c - (W - 1) / 2) / ((W - 1) / 2) * 1.2, y = 1.2 - (r / 14.5) * 2.25;
        line += Math.pow(x * x + y * y - 1, 3) - x * x * y * y * y <= 0 ? "X" : ".";
      }
      rows.push(line);
    }
    return rows;
  })();
  let mosaicP = null;
  function mosaicURLs() {
    mosaicP ??= fetchPlain("mosaic.bin").then(buf => {
      const m = JSON.parse(new TextDecoder().decode(buf));
      return Object.values(m).map(b => URL.createObjectURL(new Blob([b64(b)], { type: "image/jpeg" })));
    });
    return mosaicP;
  }
  async function buildHeart(el) {
    const keys = await mosaicURLs();
    const cols = HEART[0].length;
    const w = (window.__pageW || 360) * 0.88, h = (window.__pageH || 500) * 0.72;
    const size = Math.max(14, Math.floor(Math.min(w / cols, h / HEART.length)) - 2);
    el.style.gridTemplateColumns = `repeat(${cols}, ${size}px)`;
    let k = 0;
    for (const row of HEART) for (const c of row) {
      const t = document.createElement("div");
      t.className = "t" + (c === "X" ? "" : " e");
      if (c === "X" && keys.length) {
        const key = keys[k++ % keys.length];
        const img = document.createElement("img");
        t.appendChild(img);
        img.onload = () => img.classList.add("in"); img.src = key;
        t.addEventListener("click", e => { e.stopPropagation(); if (img.src) openLightbox(img.src, ""); });
      }
      el.appendChild(t);
    }
  }

  // ---------- flip ----------
  function initFlip() {
    const el = $("#book");
    const availH = window.innerHeight - 90;
    const availW = window.innerWidth - 20;
    const ratio = 0.72;
    let pageH = Math.min(availH, 900), pageW = Math.round(pageH * ratio);
    const portrait = availW < pageW * 2 + 20;
    if (portrait) {
      pageW = Math.min(availW, 560);
      pageH = Math.min(availH, Math.round(pageW * 1.75));
    } else if (pageW * 2 > availW) {
      pageW = Math.floor(availW / 2); pageH = Math.round(pageW / ratio);
    }
    window.__pageW = pageW; window.__pageH = pageH;
    el.style.width = (portrait ? pageW : pageW * 2) + "px";
    el.style.height = pageH + "px";

    flip = new St.PageFlip(el, {
      width: pageW, height: pageH, size: "fixed",
      showCover: true, usePortrait: true, autoSize: false,
      maxShadowOpacity: 0.35, mobileScrollSupport: false,
      disableFlipByClick: true, flippingTime: 900, startZIndex: 2,
    });
    flip.loadFromHTML($$(".page", el));
    const total = flip.getPageCount();
    const update = () => {
      const i = flip.getCurrentPageIndex();
      $("#pageNum").textContent = `${i + 1} / ${total}`;
      if (!portrait) {
        const shift = i === 0 ? -pageW / 2 : (i >= total - 1 ? pageW / 2 : 0);
        el.style.transform = `translateX(${shift}px)`;
      }
      loadAround(i);
    };
    flip.on("flip", update);
    flip.on("changeOrientation", update);
    update();
    $("#prev").onclick = () => flip.flipPrev();
    $("#next").onclick = () => flip.flipNext();
    $("#toc").onclick = () => goTo("contents");

    let lastW = window.innerWidth;
    window.addEventListener("resize", () => {
      if (Math.abs(window.innerWidth - lastW) > 160) location.reload();
    });
  }

  function goTo(id) {
    const pg = $(`#book .page[data-id="${id}"]`);
    if (!pg || !flip) return;
    const i = +pg.dataset.i;
    loadAround(i);
    flip.flip(i);
  }

  // ---------- hearts ----------
  function hearts() {
    const box = $(".hearts");
    setInterval(() => {
      if (document.hidden) return;
      const h = document.createElement("i");
      h.textContent = "♥";
      h.style.left = Math.random() * 100 + "vw";
      h.style.fontSize = 10 + Math.random() * 16 + "px";
      h.style.animationDuration = 9 + Math.random() * 8 + "s";
      box.appendChild(h);
      setTimeout(() => h.remove(), 18000);
    }, 1400);
  }
  function burst(e) {
    for (let k = 0; k < 6; k++) {
      const h = document.createElement("i");
      h.textContent = "♥";
      Object.assign(h.style, { position: "fixed", left: e.clientX + "px", top: e.clientY + "px", color: "#b9848f", zIndex: 80,
        pointerEvents: "none", transition: "transform .9s ease-out, opacity .9s", fontStyle: "normal" });
      document.body.appendChild(h);
      requestAnimationFrame(() => {
        h.style.transform = `translate(${(Math.random() - .5) * 120}px, ${-40 - Math.random() * 80}px) scale(1.4)`;
        h.style.opacity = 0;
      });
      setTimeout(() => h.remove(), 1000);
    }
  }
})();
