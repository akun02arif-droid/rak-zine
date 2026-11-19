(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var CFG_KEY = "rakzine-github";
  var DEFAULT_NAME = "Rak Zine";
  var DEFAULT_TAG = "Kumpulan zine buatan sendiri. Klik sampul, lalu geser untuk membuka halamannya.";
  var MAX_EDGE = 2600, JPEG_Q = 0.9;
  var S = { cfg: null, gh: null, owner: false, zines: [], loaded: false, failed: false, site: {}, local: {} };

  function h(tag, props) {
    var e = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2), k, v;
    props = props || {};
    for (k in props) {
      v = props[k];
      if (k === "class") e.className = v;
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    [].concat.apply([], kids).forEach(function (c) {
      if (c == null || c === false) return;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return e;
  }
  var toastTimer;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 4200);
  }
  /* page images live in the img/ folder; ones just uploaded show from memory until the site rebuilds */
  function blobUrl(name) { return S.local[name] || ("img/" + name); }
  function slug(t) {
    var s = String(t || "").toLowerCase();
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "zine";
  }

  /* ---------- owner sign-in (GitHub token kept in this browser only) ---------- */
  function loadCfg() {
    try {
      var c = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
      if (c && c.owner && c.repo && c.token) { S.cfg = c; S.gh = window.GH(c); S.owner = true; }
    } catch (e) {}
  }
  function openLogin() {
    var c = S.cfg || {};
    $("#lgOwner").value = c.owner || ""; $("#lgRepo").value = c.repo || "";
    $("#lgBranch").value = c.branch || "main"; $("#lgToken").value = "";
    $("#lgStatus").textContent = ""; $("#lgStatus").className = "status";
    $("#loginSheet").hidden = false; document.body.classList.add("lock");
    $("#lgOwner").focus();
  }
  function closeLogin() {
    $("#loginSheet").hidden = true;
    if ($("#reader").hidden && $("#sheet").hidden) document.body.classList.remove("lock");
  }
  function ghErr(e) {
    var s = e && e.status;
    if (s === 401) return "Token ditolak atau sudah kedaluwarsa. Buat token baru lalu masuk lagi lewat tautan Masuk pemilik di bawah halaman.";
    if (s === 403) return "Token tidak punya izin menulis ke repositori ini. Pastikan izin Contents diatur ke Read and write.";
    if (s === 404) return "Repositori atau cabang tidak ditemukan. Periksa username, nama repositori, dan nama cabang.";
    if (s === 409 || s === 422) return "GitHub menolak perubahan ini. Coba simpan lagi.";
    if (e instanceof TypeError) return "Tidak bisa terhubung ke GitHub. Periksa koneksi internet.";
    return "Gagal menyimpan. Coba lagi.";
  }
  $("#ownerLink").addEventListener("click", openLogin);
  $("#lgCancel").addEventListener("click", closeLogin);
  $("#loginSheet").addEventListener("mousedown", function (e) { if (e.target === $("#loginSheet")) closeLogin(); });
  $("#loginForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var cfg = {
      owner: $("#lgOwner").value.trim(), repo: $("#lgRepo").value.trim(),
      branch: $("#lgBranch").value.trim() || "main", token: $("#lgToken").value.trim()
    };
    var st = $("#lgStatus"); st.className = "status"; st.textContent = "Menguji koneksi...";
    $("#lgSave").disabled = true;
    window.GH(cfg).check().then(function (info) {
      if (!info.permissions || !info.permissions.push) {
        st.className = "status err"; st.textContent = "Token ini hanya bisa membaca. Buat token dengan izin Contents: Read and write.";
        return;
      }
      try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {}
      S.cfg = cfg; S.gh = window.GH(cfg); S.owner = true;
      closeLogin(); renderSite(); renderShelf(); toast("Mode pemilik aktif.");
    }).catch(function (e) {
      st.className = "status err"; st.textContent = ghErr(e);
    }).then(function () { $("#lgSave").disabled = false; });
  });
  $("#logoutBtn").addEventListener("click", function () {
    try { localStorage.removeItem(CFG_KEY); } catch (e) {}
    S.cfg = null; S.gh = null; S.owner = false;
    $("#siteForm").hidden = true; renderSite(); renderShelf(); toast("Keluar dari mode pemilik.");
  });

  /* ---------- saving: one commit to the GitHub repo ---------- */
  function updateData(mutator, files, deletes, message, onProgress) {
    var gh = S.gh, newData;
    return gh.readJson("zines.json").then(function (remote) {
      remote = remote && typeof remote === "object" ? remote : {};
      if (!Array.isArray(remote.zines)) remote.zines = [];
      if (!remote.site || typeof remote.site !== "object") remote.site = {};
      newData = mutator(remote) || remote;
      var all = files.concat([{ path: "zines.json", text: JSON.stringify(newData, null, 2) + "\n" }]);
      return gh.commit(all, deletes, message, onProgress).catch(function (e) {
        if (deletes.length && e && e.status === 422) return gh.commit(all, [], message, onProgress);
        throw e;
      });
    }).then(function () {
      applyData(newData); renderSite(); renderShelf();
    });
  }

  /* ---------- data ---------- */
  function applyData(d) {
    d = d || {};
    S.site = d.site || {};
    S.zines = (d.zines || []).filter(function (x) {
      return x && x.id && x.title && Array.isArray(x.pages) && x.pages.length && x.cover;
    }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }
  function loadData() {
    return fetch("zines.json?v=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }).then(function (d) {
      applyData(d); S.loaded = true; S.failed = false;
      renderSite(); renderShelf(); syncHash();
    }).catch(function () {
      S.loaded = true; S.failed = true; renderShelf();
    });
  }

  /* ---------- header / site ---------- */
  function renderSite() {
    var name = S.site.name || DEFAULT_NAME;
    $("#siteName").textContent = name;
    document.title = name;
    $("#siteTagline").textContent = S.site.tagline != null && S.site.tagline !== "" ? S.site.tagline : DEFAULT_TAG;
    $("#ownerbar").hidden = !S.owner;
    if (!S.owner) $("#siteForm").hidden = true;
    renderLinks();
  }

  /* ---------- contact links ---------- */
  function normLink(v) {
    v = (v || "").trim(); if (!v) return null;
    if (/^https?:\/\//i.test(v)) return { href: v };
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { copy: v };
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return { href: "https://" + v };
    return { copy: v };
  }
  function copyText(t) {
    try { navigator.clipboard.writeText(t).then(function () { toast("Disalin: " + t); }, function () { toast(t); }); }
    catch (e) { toast(t); }
  }
  function chipFor(l) {
    var n = normLink(l.url); if (!n) return null;
    return n.href
      ? h("a", { class: "chip", href: n.href, target: "_blank", rel: "noopener noreferrer" }, l.label)
      : h("button", { class: "chip", type: "button", onclick: function () { copyText(n.copy); } }, l.label, h("small", null, "salin"));
  }
  function renderLinks() {
    var ls = (S.site.links || []).filter(function (l) { return l && l.label && l.url; }).slice(0, 8);
    var box = $("#links"), rbox = $("#rLinks");
    box.replaceChildren(); rbox.replaceChildren();
    ls.forEach(function (l) {
      var a = chipFor(l); if (a) box.append(a);
      var b = chipFor(l); if (b) rbox.append(b);
    });
    if (S.owner && !ls.length) box.append(h("button", { class: "chip", type: "button", onclick: openSiteForm }, "+ Tambah kontak dan media sosial"));
    box.hidden = !box.children.length;
  }
  function linkRow(l) {
    var row = h("div", { class: "linkrow" },
      h("input", { type: "text", class: "lk-label", placeholder: "Nama, mis. Instagram", "aria-label": "Nama tautan", maxlength: "30", value: l.label || "" }),
      h("input", { type: "text", class: "lk-url", placeholder: "https://instagram.com/usernamekamu atau email", "aria-label": "Alamat tautan", maxlength: "200", value: l.url || "" }),
      h("button", { type: "button", "aria-label": "Hapus tautan", onclick: function () { row.remove(); } }, "×"));
    return row;
  }
  function fillSiteForm() {
    $("#sfName").value = S.site.name || DEFAULT_NAME;
    $("#sfTag").value = S.site.tagline != null ? S.site.tagline : DEFAULT_TAG;
    var box = $("#sfLinks"); box.replaceChildren();
    (S.site.links || []).forEach(function (l) { box.append(linkRow(l)); });
    if (!box.children.length) box.append(linkRow({}));
    $("#sfName").focus();
  }
  function openSiteForm() {
    if (!S.owner) return;
    var f = $("#siteForm"); f.hidden = false; fillSiteForm();
    f.scrollIntoView({ block: "nearest" });
  }

  /* ---------- shelf ---------- */
  function renderShelf() {
    var shelf = $("#shelf"); shelf.replaceChildren();
    if (S.failed) {
      shelf.append(h("div", { class: "empty" },
        h("h2", null, "Rak belum bisa dimuat"),
        h("p", null, "Daftar zine tidak bisa dibuka. Periksa koneksi lalu muat ulang halaman. Kalau halaman ini dibuka langsung dari file di perangkat, buka lewat alamat situsnya.")));
      return;
    }
    if (!S.loaded) { shelf.append(h("p", { class: "note" }, "Memuat rak...")); return; }
    if (!S.zines.length) {
      shelf.append(h("div", { class: "empty" },
        h("h2", null, "Rak masih kosong"),
        h("p", null, S.owner ? "Belum ada zine di sini. Tambahkan zine pertamamu dari PDF atau gambar per halaman." : "Zine akan muncul di sini begitu pemiliknya menambahkan."),
        S.owner ? h("button", { class: "btn primary", type: "button", onclick: function () { openEditor(null); } }, "+ Tambah zine pertama") : null));
      return;
    }
    shelf.append(h("div", { class: "sec" }, h("h2", null, "Koleksi"), h("span", null, S.zines.length + " zine")));
    var grid = h("div", { class: "grid" });
    S.zines.forEach(function (z) {
      var cover = h("button", { class: "cover", type: "button", "aria-label": "Buka zine " + z.title, onclick: function () { openReader(z, true); } },
        h("img", { src: blobUrl(z.cover), alt: "Sampul " + z.title, loading: "lazy" }));
      cover.style.aspectRatio = String(z.ratio || 0.72);
      var n = (z.pages || []).length;
      grid.append(h("article", { class: "zine" }, cover,
        h("h3", null, z.title),
        h("div", { class: "meta" }, n + " halaman" + (z.year ? " · " + z.year : "")),
        S.owner ? h("button", { class: "edit", type: "button", onclick: function () { openEditor(z); } }, "Ubah") : null));
    });
    shelf.append(grid);
  }

  /* ---------- reader ---------- */
  var R = { z: null, pf: null, idx: 0, fb: false, timer: null, reading: false, zoom: false, mode: "auto" };
  try { var sm = localStorage.getItem("rakzine-mode"); if (sm === "single" || sm === "double") R.mode = sm; } catch (e) {}
  function stageWidth() { return Math.max(200, $("#stage").getBoundingClientRect().width - 16); }
  function effMode(aw) { return R.mode === "auto" ? (aw < 640 ? "single" : "double") : R.mode; }
  function syncModeBtn() {
    $("#rMode").textContent = effMode(stageWidth()) === "double" ? "1 halaman" : "2 halaman";
    $("#rMode").hidden = !R.z || R.z.pages.length < 2;
  }
  function readerSize() {
    var st = $("#stage").getBoundingClientRect();
    var aw = Math.max(200, st.width - 16), ah = Math.max(200, st.height - 16);
    var r = (R.z && R.z.ratio) || 0.72;
    var portrait = effMode(aw) === "single";
    var w, hgt;
    if (portrait) { w = Math.min(aw, ah * r); hgt = w / r; }
    else { w = Math.min(aw, ah * r * 2); hgt = w / (2 * r); }
    return { w: Math.floor(w), h: Math.floor(hgt), r: r, single: portrait };
  }
  function updateCount() {
    if (!R.z) return;
    var n = R.z.pages.length, a = R.idx + 1, label = String(a);
    if (R.pf && R.pf.getOrientation && R.pf.getOrientation() === "landscape" && R.idx > 0 && a < n) label = a + "–" + (a + 1);
    $("#rCount").textContent = label + " / " + n;
  }
  function destroyBook() {
    if (R.pf) { try { R.pf.destroy(); } catch (e) {} R.pf = null; }
    $("#book").replaceChildren();
  }
  function buildBook() {
    if (!R.z || R.reading) return;
    destroyBook();
    var sz = readerSize(), book = $("#book"), n = R.z.pages.length;
    syncModeBtn();
    book.style.width = sz.w + "px"; book.style.height = sz.h + "px";
    if (window.St && window.St.PageFlip) {
      R.fb = false;
      var el = h("div"); book.append(el);
      el.style.width = sz.w + "px"; el.style.height = sz.h + "px";
      R.z.pages.forEach(function (name, i) {
        var pg = h("div", { class: "bpage" }, h("img", { src: blobUrl(name), alt: "Halaman " + (i + 1), draggable: "false" }));
        if (i === 0 || i === n - 1) pg.setAttribute("data-density", "hard");
        el.append(pg);
      });
      try {
        R.pf = new window.St.PageFlip(el, {
          width: 400, height: Math.round(400 / sz.r), size: "stretch",
          minWidth: sz.single ? Math.round(sz.w * 0.6) : 80, maxWidth: 4000,
          minHeight: Math.round((sz.single ? sz.w * 0.6 : 80) / sz.r), maxHeight: 8000,
          showCover: true, usePortrait: !!sz.single, mobileScrollSupport: false,
          drawShadow: true, maxShadowOpacity: 0.4, flippingTime: 650
        });
        R.pf.loadFromHTML(el.querySelectorAll(".bpage"));
        R.pf.on("flip", function (e) { R.idx = e.data; updateCount(); });
        if (R.idx > 0) R.pf.turnToPage(R.idx);
        updateCount();
        return;
      } catch (err) { destroyBook(); }
    }
    R.fb = true;
    var img = h("img", { alt: "Halaman" });
    book.style.width = "100%"; book.style.height = "100%";
    book.append(h("div", { class: "fallback" }, img));
    R.show = function () { img.src = blobUrl(R.z.pages[R.idx]); img.alt = "Halaman " + (R.idx + 1); updateCount(); };
    R.show();
  }
  function go(dir) {
    if (!R.z || R.reading) return;
    if (R.fb) {
      R.idx = Math.max(0, Math.min(R.z.pages.length - 1, R.idx + dir));
      if (R.show) R.show();
    } else if (R.pf) {
      if (dir > 0) R.pf.flipNext(); else R.pf.flipPrev();
    }
  }
  function setReading(on) {
    R.reading = on;
    var sc = $("#scroll");
    $("#stage").hidden = on; sc.hidden = !on;
    $("#rFoot").hidden = on; $("#hint").hidden = on;
    $("#rZoom").hidden = !on;
    $("#rMode").hidden = on || R.z.pages.length < 2;
    $("#rRead").textContent = on ? "Kembali ke buku" : "Mode baca";
    if (on) {
      destroyBook();
      R.zoom = false; sc.classList.remove("z2"); $("#rZoom").textContent = "Perbesar";
      sc.replaceChildren();
      R.z.pages.forEach(function (name, i) {
        sc.append(h("div", { class: "pg" }, h("img", { src: blobUrl(name), alt: "Halaman " + (i + 1), loading: i < 3 ? "eager" : "lazy" })));
      });
      requestAnimationFrame(function () {
        var t = sc.children[R.idx];
        if (t) sc.scrollTop = t.offsetTop - sc.offsetTop - 8;
      });
    } else {
      var best = 0, top = sc.scrollTop + sc.clientHeight / 3;
      Array.prototype.forEach.call(sc.children, function (c, i) { if (c.offsetTop - sc.offsetTop <= top) best = i; });
      R.idx = best; sc.replaceChildren();
      requestAnimationFrame(buildBook);
    }
  }
  $("#rRead").addEventListener("click", function () { if (R.z) setReading(!R.reading); });
  $("#rMode").addEventListener("click", function () {
    if (!R.z || R.reading) return;
    R.mode = effMode(stageWidth()) === "double" ? "single" : "double";
    try { localStorage.setItem("rakzine-mode", R.mode); } catch (e) {}
    buildBook();
  });
  $("#rZoom").addEventListener("click", function () {
    R.zoom = !R.zoom;
    $("#scroll").classList.toggle("z2", R.zoom);
    $("#rZoom").textContent = R.zoom ? "Ukuran pas" : "Perbesar";
  });
  function openReader(z, push) {
    R.z = z; R.idx = 0; R.reading = false;
    $("#rTitle").textContent = z.title;
    $("#stage").hidden = false; $("#scroll").hidden = true; $("#rFoot").hidden = false; $("#hint").hidden = false;
    $("#rZoom").hidden = true; $("#rRead").textContent = "Mode baca";
    $("#reader").hidden = false; document.body.classList.add("lock");
    if (push) { try { location.hash = "z-" + z.id; } catch (e) {} }
    requestAnimationFrame(buildBook);
    $("#rClose").focus();
  }
  function closeReader(push) {
    destroyBook(); $("#scroll").replaceChildren(); R.z = null; R.reading = false;
    $("#reader").hidden = true; document.body.classList.remove("lock");
    if (push && /^#z-/.test(location.hash)) { try { location.hash = ""; } catch (e) {} }
  }
  function syncHash() {
    var m = /^#z-(.+)$/.exec(location.hash);
    if (m) {
      var z = S.zines.filter(function (x) { return x.id === m[1]; })[0];
      if (z && (!R.z || R.z.id !== z.id)) openReader(z, false);
    } else if (R.z) { closeReader(false); }
  }
  window.addEventListener("hashchange", syncHash);
  window.addEventListener("resize", function () {
    if (!R.z || R.reading) return;
    clearTimeout(R.timer); R.timer = setTimeout(buildBook, 200);
  });
  document.addEventListener("keydown", function (e) {
    if (!$("#loginSheet").hidden) { if (e.key === "Escape") closeLogin(); return; }
    if (!$("#sheet").hidden) { if (e.key === "Escape") closeEditor(); return; }
    if ($("#reader").hidden) return;
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "Escape") closeReader(true);
  });
  $("#rClose").addEventListener("click", function () { closeReader(true); });
  $("#rNext").addEventListener("click", function () { go(1); });
  $("#rPrev").addEventListener("click", function () { go(-1); });

  /* ---------- editor (owner) ---------- */
  var E = { id: null, orig: null, pages: [], busy: false, delArmed: false, delTimer: null };

  function setStatus(msg, isErr) {
    var s = $("#edStatus"); s.textContent = msg || ""; s.className = "status" + (isErr ? " err" : "");
  }
  function renderThumbs() {
    var ul = $("#thumbs"); ul.replaceChildren();
    $("#pgCount").textContent = E.pages.length ? E.pages.length + " halaman" : "Belum ada halaman";
    $("#clearBtn").hidden = !E.pages.length; $("#clearBtn").disabled = E.busy;
    E.pages.forEach(function (p, i) {
      var pg = h("div", { class: "pg" }, h("img", { src: p.url, alt: "Halaman " + (i + 1) }), h("span", { class: "num" }, String(i + 1)));
      ul.append(h("li", null, pg, h("div", { class: "ctl" },
        h("button", { type: "button", "aria-label": "Geser ke kiri", disabled: i === 0 || E.busy, onclick: function () { move(i, -1); } }, "←"),
        h("button", { type: "button", "aria-label": "Geser ke kanan", disabled: i === E.pages.length - 1 || E.busy, onclick: function () { move(i, 1); } }, "→"),
        h("button", { type: "button", "aria-label": "Hapus halaman", disabled: E.busy, onclick: function () { dropPage(i); } }, "×"))));
    });
  }
  function dropPage(i) {
    var p = E.pages[i]; if (p && p.blob && !p.keep) URL.revokeObjectURL(p.url);
    E.pages.splice(i, 1); renderThumbs();
  }
  function move(i, d) {
    var j = i + d; if (j < 0 || j >= E.pages.length) return;
    var t = E.pages[i]; E.pages[i] = E.pages[j]; E.pages[j] = t; renderThumbs();
  }
  function setBusy(b) {
    E.busy = b;
    ["saveBtn", "cancelBtn", "pickBtn", "delBtn"].forEach(function (id) { $("#" + id).disabled = b; });
    renderThumbs();
  }
  $("#clearBtn").addEventListener("click", function () {
    E.pages.forEach(function (p) { if (p.blob && !p.keep) URL.revokeObjectURL(p.url); });
    E.pages = []; renderThumbs(); setStatus("");
  });
  function openEditor(z) {
    if (!S.owner) return;
    E.id = z ? z.id : null; E.orig = z || null;
    E.pages = z ? z.pages.map(function (name) { return { name: name, url: blobUrl(name), ratio: z.ratio }; }) : [];
    E.delArmed = false;
    $("#edTitle").textContent = z ? "Ubah zine" : "Zine baru";
    $("#fTitle").value = z ? z.title : "";
    $("#fYear").value = z && z.year ? z.year : new Date().getFullYear();
    $("#fDesc").value = z && z.description ? z.description : "";
    $("#delBtn").hidden = !z; $("#delBtn").textContent = "Hapus zine";
    setStatus(""); setBusy(false);
    $("#sheet").hidden = false; document.body.classList.add("lock");
    $("#fTitle").focus();
  }
  function closeEditor() {
    if (E.busy) return;
    E.pages.forEach(function (p) { if (p.blob && !p.keep && p.url) URL.revokeObjectURL(p.url); });
    $("#sheet").hidden = true;
    if ($("#reader").hidden) document.body.classList.remove("lock");
  }

  /* ---- page sources: image or PDF page, with optional white-margin trim ---- */
  function newCanvas(w, hgt) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(hgt));
    var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    return c;
  }
  var FULL = { x0: 0, y0: 0, x1: 1, y1: 1 };
  function imageSource(bm) {
    return {
      close: function () { if (bm.close) bm.close(); },
      render: function (crop, maxEdge) {
        var sx = crop.x0 * bm.width, sy = crop.y0 * bm.height;
        var sw = (crop.x1 - crop.x0) * bm.width, sh = (crop.y1 - crop.y0) * bm.height;
        var sc = Math.min(1, maxEdge / Math.max(sw, sh));
        var c = newCanvas(sw * sc, sh * sc);
        c.getContext("2d").drawImage(bm, sx, sy, sw, sh, 0, 0, c.width, c.height);
        return Promise.resolve(c);
      }
    };
  }
  function pdfSource(page) {
    var v1 = page.getViewport({ scale: 1 });
    return {
      close: function () { try { page.cleanup(); } catch (e) {} },
      render: function (crop, maxEdge) {
        var cw = (crop.x1 - crop.x0) * v1.width, ch = (crop.y1 - crop.y0) * v1.height;
        var sc = maxEdge / Math.max(cw, ch);
        var vp = page.getViewport({ scale: sc });
        var c = newCanvas(cw * sc, ch * sc);
        return page.render({
          canvasContext: c.getContext("2d"), viewport: vp,
          transform: [1, 0, 0, 1, -crop.x0 * vp.width, -crop.y0 * vp.height]
        }).promise.then(function () { return c; });
      }
    };
  }
  function contentBounds(c) {
    var w = c.width, hh = c.height, d = c.getContext("2d").getImageData(0, 0, w, hh).data;
    var rows = new Array(hh).fill(0), cols = new Array(w).fill(0), x, y, i;
    for (y = 0; y < hh; y++) for (x = 0; x < w; x++) {
      i = (y * w + x) * 4;
      if (d[i] < 236 || d[i + 1] < 236 || d[i + 2] < 236) { rows[y]++; cols[x]++; }
    }
    var y0 = -1, y1 = -1, x0 = -1, x1 = -1;
    for (y = 0; y < hh; y++) if (rows[y] >= 2) { if (y0 < 0) y0 = y; y1 = y; }
    for (x = 0; x < w; x++) if (cols[x] >= 2) { if (x0 < 0) x0 = x; x1 = x; }
    if (y0 < 0 || x0 < 0) return null;
    return { x0: x0 / w, y0: y0 / hh, x1: (x1 + 1) / w, y1: (y1 + 1) / hh };
  }
  function toJpeg(canvas) {
    return new Promise(function (res, rej) {
      canvas.toBlob(function (b) { b ? res(b) : rej(new Error("toBlob")); }, "image/jpeg", JPEG_Q);
    });
  }
  function processSources(srcs, label) {
    var crop = FULL;
    var scan = Promise.resolve();
    if ($("#fTrim").checked && srcs.length) {
      var u = { x0: 1, y0: 1, x1: 0, y1: 0 };
      srcs.forEach(function (s, i) {
        scan = scan.then(function () {
          setStatus("Mendeteksi tepi putih " + label + " (" + (i + 1) + "/" + srcs.length + ")...");
          return s.render(FULL, 220).then(function (c) {
            var b = contentBounds(c); if (!b) return;
            u.x0 = Math.min(u.x0, b.x0); u.y0 = Math.min(u.y0, b.y0);
            u.x1 = Math.max(u.x1, b.x1); u.y1 = Math.max(u.y1, b.y1);
          });
        });
      });
      scan = scan.then(function () {
        if (u.x1 <= u.x0 || u.y1 <= u.y0) return;
        var pad = 0.012;
        var c = { x0: Math.max(0, u.x0 - pad), y0: Math.max(0, u.y0 - pad), x1: Math.min(1, u.x1 + pad), y1: Math.min(1, u.y1 + pad) };
        if ((c.x1 - c.x0) * (c.y1 - c.y0) < 0.985) crop = c;
      });
    }
    var chain = scan;
    srcs.forEach(function (s, i) {
      chain = chain.then(function () {
        setStatus("Menyiapkan " + label + ": halaman " + (i + 1) + "/" + srcs.length + "...");
        return s.render(crop, MAX_EDGE).then(function (c) {
          return toJpeg(c).then(function (blob) {
            E.pages.push({ blob: blob, url: URL.createObjectURL(blob), ratio: c.width / c.height });
            renderThumbs();
            s.close();
          });
        });
      });
    });
    return chain;
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("load " + src)); };
      document.head.append(s);
    });
  }
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  function ensurePdfjs() {
    if (window.pdfjsLib) return Promise.resolve();
    return loadScript(PDFJS + "pdf.min.js").then(function () {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
    });
  }
  function pdfToSources(file) {
    return ensurePdfjs().then(function () { return file.arrayBuffer(); }).then(function (buf) {
      return window.pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      var out = [], chain = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) {
        (function (num) { chain = chain.then(function () { return pdf.getPage(num).then(function (p) { out.push(pdfSource(p)); }); }); })(i);
      }
      return chain.then(function () { return out; });
    });
  }
  function addFiles(list) {
    var files = Array.prototype.slice.call(list).sort(function (a, b) {
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    setBusy(true);
    var chain = Promise.resolve(), imgs = [];
    function fail(name) {
      setStatus("Tidak bisa membaca " + name + ". Coba simpan ulang sebagai JPG, PNG, atau PDF.", true);
      return new Promise(function (r) { setTimeout(r, 2200); });
    }
    files.forEach(function (f) {
      var isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      chain = chain.then(function () {
        if (isPdf) {
          setStatus("Membuka " + f.name + "...");
          return pdfToSources(f).then(function (srcs) { return processSources(srcs, f.name); }).catch(function () { return fail(f.name); });
        }
        return createImageBitmap(f).then(function (bm) { imgs.push(imageSource(bm)); }).catch(function () { return fail(f.name); });
      });
    });
    chain = chain.then(function () { return imgs.length ? processSources(imgs, "gambar") : null; });
    return chain.then(function () {
      setBusy(false);
      setStatus(E.pages.length ? E.pages.length + " halaman siap." : "");
    }, function () {
      setBusy(false); setStatus("Terjadi kendala saat menyiapkan halaman.", true);
    });
  }
  $("#pickBtn").addEventListener("click", function () { $("#fFiles").click(); });
  $("#fFiles").addEventListener("change", function (e) {
    var fl = e.target.files; if (fl && fl.length) addFiles(fl); e.target.value = "";
  });
  var drop = $("#drop");
  ["dragenter", "dragover"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function (e) {
    var fl = e.dataTransfer && e.dataTransfer.files; if (fl && fl.length && !E.busy) addFiles(fl);
  });

  $("#editForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (E.busy || !S.owner || !S.gh) return;
    var title = $("#fTitle").value.trim();
    if (!title) { setStatus("Isi judul zine dulu.", true); return; }
    if (!E.pages.length) { setStatus("Tambahkan minimal satu halaman.", true); return; }
    var zid = E.id || (slug(title) + "-" + Date.now().toString(36));
    var names = [], files = [], fresh = [];
    E.pages.forEach(function (p) {
      if (p.name) { names.push(p.name); return; }
      var nm = zid + "-" + Math.random().toString(36).slice(2, 8) + ".jpg";
      p.newName = nm; names.push(nm); fresh.push(p);
      files.push({ path: "img/" + nm, blob: p.blob });
    });
    var deletes = E.orig ? E.orig.pages.filter(function (n) { return names.indexOf(n) < 0; }).map(function (n) { return "img/" + n; }) : [];
    var ratio = E.pages[0].ratio || (E.orig && E.orig.ratio) || 0.72;
    var year = parseInt($("#fYear").value, 10);
    var desc = $("#fDesc").value.trim();
    setBusy(true); setStatus("Menyimpan ke GitHub...");
    updateData(function (d) {
      var now = Date.now(), i, entry = {
        id: zid, title: title, year: isNaN(year) ? null : year, description: desc,
        pages: names, cover: names[0], ratio: ratio, createdAt: now, updatedAt: now
      };
      for (i = 0; i < d.zines.length; i++) if (d.zines[i].id === zid) break;
      if (i < d.zines.length) { entry.createdAt = d.zines[i].createdAt || now; d.zines[i] = entry; }
      else d.zines.push(entry);
      return d;
    }, files, deletes, (E.orig ? "Ubah zine: " : "Tambah zine: ") + title, function (i, n) {
      setStatus("Mengunggah halaman " + i + "/" + n + "...");
    }).then(function () {
      fresh.forEach(function (p) { S.local[p.newName] = p.url; p.keep = true; });
      setBusy(false); closeEditor();
      toast("Tersimpan. Perubahan muncul di situs dalam sekitar 1 menit.");
    }).catch(function (e) {
      setBusy(false); setStatus(ghErr(e), true);
    });
  });
  $("#cancelBtn").addEventListener("click", closeEditor);
  $("#sheet").addEventListener("mousedown", function (e) { if (e.target === $("#sheet")) closeEditor(); });
  $("#delBtn").addEventListener("click", function () {
    var b = $("#delBtn");
    if (!E.orig || E.busy) return;
    if (!E.delArmed) {
      E.delArmed = true; b.textContent = "Yakin? Klik lagi untuk hapus";
      clearTimeout(E.delTimer);
      E.delTimer = setTimeout(function () { E.delArmed = false; b.textContent = "Hapus zine"; }, 4000);
      return;
    }
    var z = E.orig;
    setBusy(true); setStatus("Menghapus...");
    updateData(function (d) {
      d.zines = d.zines.filter(function (x) { return x.id !== z.id; });
      return d;
    }, [], z.pages.map(function (n) { return "img/" + n; }), "Hapus zine: " + z.title).then(function () {
      setBusy(false); closeEditor(); toast("Zine dihapus. Situs diperbarui dalam sekitar 1 menit.");
    }).catch(function (e) {
      setBusy(false); setStatus(ghErr(e), true);
    });
  });

  /* ---------- site settings ---------- */
  $("#addBtn").addEventListener("click", function () { openEditor(null); });
  $("#siteBtn").addEventListener("click", function () {
    var f = $("#siteForm"); f.hidden = !f.hidden;
    if (!f.hidden) fillSiteForm();
  });
  $("#sfCancel").addEventListener("click", function () { $("#siteForm").hidden = true; });
  $("#sfAddLink").addEventListener("click", function () {
    var box = $("#sfLinks");
    if (box.children.length >= 8) { toast("Maksimal 8 tautan."); return; }
    var row = linkRow({}); box.append(row); row.querySelector("input").focus();
  });
  $("#siteForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!S.owner || !S.gh) return;
    var name = $("#sfName").value.trim() || DEFAULT_NAME, tag = $("#sfTag").value.trim();
    var links = [];
    document.querySelectorAll("#sfLinks .linkrow").forEach(function (r) {
      var lb = r.querySelector(".lk-label").value.trim(), u = r.querySelector(".lk-url").value.trim();
      if (lb && u) links.push({ label: lb, url: u });
    });
    var btn = $("#siteForm button[type=submit]"); btn.disabled = true;
    updateData(function (d) { d.site = { name: name, tagline: tag, links: links }; return d; }, [], [], "Perbarui info situs")
      .then(function () { $("#siteForm").hidden = true; toast("Tersimpan. Situs diperbarui dalam sekitar 1 menit."); })
      .catch(function (err) { toast(ghErr(err)); })
      .then(function () { btn.disabled = false; });
  });

  /* ---------- boot ---------- */
  loadCfg();
  renderSite(); renderShelf();
  loadData();
})();
