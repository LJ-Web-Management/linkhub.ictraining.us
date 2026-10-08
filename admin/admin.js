// Link Hub admin dashboard.
//
// Each site's links live in a JSON file in the public LJ-Web-Management/linkhub-data repo.
// admin/config.json names the file (and the brand colour and icon choices) for this site, so
// these admin files are identical on every site. This page reads the file through the GitHub
// API, edits it and commits it back. The public page loads
// links.json on every visit (../live.js), so there is no deploy step: a save is live within
// about 5 minutes (GitHub's file cache).
(function () {
  "use strict";

  var R = window.LinkhubRender;
  // Filled in from config.json before anything talks to GitHub.
  var REPO = "", BRANCH = "main", FILE = "", API = "", RAW = "";
  var ICONS = [];  // [{ label, path }] offered in each link's Icon menu; empty hides the menu
  var TOKEN_KEY = "linkhub-admin-token";

  var token = "";
  var sha = "";       // blob sha of links.json as loaded; GitHub rejects a save if it moved
  var pageHtml = "";  // the live public page, used as the template for the preview
  var data = null;    // the working copy being edited
  var saved = "";     // JSON of the last loaded/published data, for the unsaved-changes check
  var undo = null;    // snapshot taken before the last delete
  var pollTimer = 0;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

  // Storage can be blocked (private mode, strict settings); signing in must still work.
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function saveToken(t, remember) {
    var s = store(remember ? "localStorage" : "sessionStorage");
    try { if (s) s.setItem(TOKEN_KEY, t); } catch (e) {}
  }
  function loadToken() {
    var t = "";
    ["sessionStorage", "localStorage"].forEach(function (k) {
      var s = store(k);
      try { if (!t && s) t = s.getItem(TOKEN_KEY) || ""; } catch (e) {}
    });
    return t;
  }
  function clearToken() {
    ["sessionStorage", "localStorage"].forEach(function (k) {
      var s = store(k);
      try { if (s) s.removeItem(TOKEN_KEY); } catch (e) {}
    });
  }

  // Base64 <-> UTF-8, since the page contains characters like en dashes and curly quotes.
  function decode64(b64) {
    var bin = atob(b64.replace(/\s/g, ""));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function encode64(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function gh(path, opts) {
    opts = opts || {};
    return fetch(API + path, {
      method: opts.method || "GET",
      cache: "no-store",
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; });
    });
  }

  /* ---------- Status line ---------- */

  function setStatus(html, kind) {
    var el = $("status");
    el.className = "status" + (kind ? " " + kind : "");
    el.innerHTML = html;
  }
  function isDirty() { return data && JSON.stringify(data) !== saved; }
  function refreshDirty() {
    var dirty = isDirty();
    $("save").disabled = !dirty;
    $("discard").disabled = !dirty;
    if (dirty) setStatus(undo ? 'Deleted. <button type="button" class="btn ghost" id="undo">Undo</button>' : "Unsaved changes", "dirty");
    else if (!pollTimer) setStatus("All changes published");
  }

  /* ---------- Sign in ---------- */

  function showSignin(message) {
    $("signin").hidden = false;
    $("editor").hidden = true;
    $("actions").hidden = true;
    setStatus("");
    var err = $("signin-error");
    err.hidden = !message;
    err.textContent = message || "";
    $("token").focus();
  }

  var attempt = 0;
  function signIn(t, remember) {
    var mine = ++attempt;  // a slower, older attempt must not undo a newer one
    token = t.trim();
    if (!token) return Promise.resolve(showSignin("Paste your GitHub access token."));
    setStatus("Checking access…");
    return gh("").then(function (r) {
      if (mine !== attempt) return;
      if (r.status === 401) throw new Error("GitHub didn't accept that token. Check it was copied in full and hasn't expired.");
      if (r.status === 404 || r.status === 403) throw new Error("That token can't see " + REPO + ". Give it access to that repository.");
      if (r.status !== 200) throw new Error("GitHub returned an error (" + r.status + "). Try again in a moment.");
      if (r.body.permissions && r.body.permissions.push === false) throw new Error("Your GitHub account can only read " + REPO + ". Ask an owner for write access.");
      if (remember !== undefined) saveToken(token, remember);
      return load();
    }).catch(function (e) {
      if (mine !== attempt) return;
      clearToken();
      token = "";
      showSignin(e.message === "Failed to fetch" ? "Couldn't reach GitHub. Check your connection." : e.message);
    });
  }

  function load() {
    setStatus("Loading links…");
    var page = fetch(new URL("../", location.href).href, { cache: "no-store" }).then(function (res) { return res.text(); });
    return Promise.all([gh("/contents/" + FILE + "?ref=" + BRANCH), page]).then(function (got) {
      var r = got[0];
      if (r.status !== 200) throw new Error("Couldn't load " + FILE + " (" + r.status + ").");
      sha = r.body.sha;
      pageHtml = got[1];
      try { data = R.normalize(JSON.parse(decode64(r.body.content))); }
      catch (e) { throw new Error(FILE + " in " + REPO + " isn't valid JSON. Fix it on GitHub, then reload."); }
      saved = JSON.stringify(data);
      undo = null;
      $("signin").hidden = true;
      $("editor").hidden = false;
      $("actions").hidden = false;
      renderEditor();
      renderPreview(true);
      refreshDirty();
    });
  }

  /* ---------- Editor ---------- */

  var ICON = {
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    open: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };
  function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + "</svg>";
  }
  function tool(act, icon, label, disabled, danger) {
    return '<button type="button" class="tool' + (danger ? " danger" : "") + '" data-act="' + act + '" title="' + label + '" aria-label="' + label + '"' + (disabled ? " disabled" : "") + ">" + svg(icon) + "</button>";
  }

  function iconOptions(current) {
    var known = ICONS.some(function (i) { return i.path === current; });
    return '<option value="">None</option>' +
      ICONS.map(function (i) {
        return '<option value="' + esc(i.path) + '"' + (i.path === current ? " selected" : "") + ">" + esc(i.label) + "</option>";
      }).join("") +
      (current && !known ? '<option value="' + esc(current) + '" selected>' + esc(current) + "</option>" : "");
  }

  function rowHtml(link, si, li, count) {
    var host = R.hostOf(link.url);
    var moveOptions = data.sections.map(function (s, i) {
      return '<option value="' + i + '"' + (i === si ? " selected" : "") + ">" + esc(s.title || "Untitled category") + "</option>";
    }).join("");
    return '<li class="row" data-s="' + si + '" data-l="' + li + '">' +
      '<span class="num">' + (li + 1) + "</span>" +
      '<div class="fields">' +
        '<input type="text" class="title-in" data-f="title" value="' + esc(link.title) + '" placeholder="Title" aria-label="Link title">' +
        '<input type="text" data-f="subtitle" value="' + esc(link.subtitle) + '" placeholder="' + esc(host || "Subtitle (optional)") + '" aria-label="Subtitle (optional, defaults to the website name)">' +
        '<input type="url" class="url" data-f="url" value="' + esc(link.url) + '" placeholder="https://" aria-label="Web address" spellcheck="false" autocomplete="off">' +
      "</div>" +
      '<div class="tools">' +
        tool("link-up", "up", "Move up", li === 0) +
        tool("link-down", "down", "Move down", li === count - 1) +
        tool("link-open", "open", "Open link in a new tab", !R.isSafeUrl(link.url)) +
        tool("link-del", "del", "Delete link", false, true) +
      "</div>" +
      ((data.sections.length > 1 || ICONS.length) ? '<div class="move">' +
        (data.sections.length > 1 ? '<label>Category <select data-act="link-move" aria-label="Move to category">' + moveOptions + "</select></label>" : "") +
        (ICONS.length ? '<label>Icon <select data-act="link-icon" aria-label="Icon">' + iconOptions(link.icon) + "</select></label>" : "") +
        "</div>" : "") +
      "</li>";
  }

  /* ---------- Social media buttons ---------- */

  function socialRowHtml(item, i, count) {
    var options = '<option value="">Choose…</option>' + Object.keys(R.networks).map(function (k) {
      return '<option value="' + k + '"' + (k === item.network ? " selected" : "") + ">" + esc(R.networks[k].label) + "</option>";
    }).join("");
    return '<li class="row srow" data-i="' + i + '">' +
      '<span class="num">' + (i + 1) + "</span>" +
      '<div class="fields sfields">' +
        '<select data-sf="network" aria-label="Network">' + options + "</select>" +
        '<input type="url" class="url" data-sf="url" value="' + esc(item.url) + '" placeholder="https://" aria-label="Profile address" spellcheck="false" autocomplete="off">' +
      "</div>" +
      '<div class="tools">' +
        tool("social-up", "up", "Move left", i === 0) +
        tool("social-down", "down", "Move right", i === count - 1) +
        tool("social-open", "open", "Open profile in a new tab", !R.isSafeUrl(item.url)) +
        tool("social-del", "del", "Delete social link", false, true) +
      "</div>" +
      "</li>";
  }

  function renderSocialEditor(focus) {
    var list = data.social || [];
    $("social").innerHTML = '<section class="section social-card">' +
      '<div class="section-head"><h2 class="card-title">Social media buttons</h2>' +
        '<span class="count">' + plural(list.length, "button") + "</span></div>" +
      (list.length
        ? '<ol class="links">' + list.map(function (x, i) { return socialRowHtml(x, i, list.length); }).join("") + "</ol>"
        : '<p class="empty">No social buttons. The row is hidden on the page until you add one.</p>') +
      '<button type="button" class="add-link" data-act="social-add">' + svg("plus") + " Add social link</button>" +
      "</section>";
    if (focus) {
      var el = null;
      [].concat(focus.sel).some(function (sel) { return (el = $("social").querySelector(sel)); });
      if (el) {
        if (focus.flash) el.closest(".row").classList.add("new");
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        el.focus({ preventScroll: true });
      }
    }
  }

  function onSocialClick(e) {
    var btn = e.target.closest("[data-act]");
    if (!btn || btn.tagName === "SELECT") return;
    var act = btn.getAttribute("data-act");
    var row = btn.closest(".srow");
    var i = row ? +row.getAttribute("data-i") : -1;
    if (act === "social-add") {
      if (!data.social) data.social = [];
      data.social.push({ network: "", url: "" });
      renderSocialEditor({ sel: '.srow[data-i="' + (data.social.length - 1) + '"] select', flash: true });
      return changed();
    }
    var list = data.social;
    if (act === "social-open") {
      if (R.isSafeUrl(list[i].url.trim())) window.open(list[i].url.trim(), "_blank", "noopener");
      return;
    }
    if (act === "social-up" || act === "social-down") {
      var to = act === "social-up" ? i - 1 : i + 1;
      swap(list, i, to);
      renderSocialEditor({ sel: ['.srow[data-i="' + to + '"] [data-act="' + act + '"]:not(:disabled)', '.srow[data-i="' + to + '"] select'] });
      return changed();
    }
    if (act === "social-del") {
      snapshot();
      list.splice(i, 1);
      renderSocialEditor();
      return changed({ keepUndo: true });
    }
  }

  function onSocialEdit(e) {
    var el = e.target, row = el.closest(".srow");
    if (!row || !el.hasAttribute("data-sf")) return;
    var item = data.social[+row.getAttribute("data-i")];
    item[el.getAttribute("data-sf")] = el.value;
    el.classList.remove("bad");
    if (el.getAttribute("data-sf") === "url") row.querySelector('[data-act="social-open"]').disabled = !R.isSafeUrl(el.value.trim());
    changed();
  }

  function renderEditor(focus) {
    renderSocialEditor();
    var n = data.sections.length;
    $("sections").innerHTML = data.sections.map(function (s, si) {
      var rows = s.links.map(function (l, li) { return rowHtml(l, si, li, s.links.length); }).join("");
      return '<section class="section" data-s="' + si + '">' +
        '<div class="section-head">' +
          '<input type="text" class="sec-title" value="' + esc(s.title) + '" placeholder="Category name" aria-label="Category name">' +
          '<span class="count">' + plural(s.links.length, "link") + "</span>" +
          '<div class="tools">' +
            tool("sec-up", "up", "Move category up", si === 0) +
            tool("sec-down", "down", "Move category down", si === n - 1) +
            tool("sec-del", "del", "Delete category", false, true) +
          "</div>" +
        "</div>" +
        (rows ? '<ol class="links">' + rows + "</ol>" : '<p class="empty">No links yet. This category stays hidden on the page until it has one.</p>') +
        '<button type="button" class="add-link" data-act="link-add">' + svg("plus") + " Add link</button>" +
        "</section>";
    }).join("");
    if (focus) {
      // sel may list fallbacks in priority order, e.g. the arrow first, then the title field.
      var el = null;
      [].concat(focus.sel).some(function (sel) { return (el = $("sections").querySelector(sel)); });
      if (el) {
        if (focus.flash) {
          var row = el.closest(".row");
          if (row) row.classList.add("new");
        }
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        el.focus({ preventScroll: true });
        if (focus.select && el.select) el.select();
      }
    }
  }

  function changed(opts) {
    if (!opts || !opts.keepUndo) undo = null;
    refreshDirty();
    renderPreview();
  }

  function snapshot() { undo = clone(data); }

  function swap(arr, a, b) { var t = arr[a]; arr[a] = arr[b]; arr[b] = t; }

  function onClick(e) {
    var btn = e.target.closest("[data-act]");
    if (!btn || btn.tagName === "SELECT") return;
    var sec = btn.closest("[data-s]");
    var si = sec ? +sec.getAttribute("data-s") : -1;
    var row = btn.closest(".row");
    var li = row ? +row.getAttribute("data-l") : -1;
    var links = si >= 0 ? data.sections[si].links : null;
    var act = btn.getAttribute("data-act");

    if (act === "link-open") {
      var url = links[li].url.trim();
      if (R.isSafeUrl(url)) window.open(url, "_blank", "noopener");
      return;
    }
    if (act === "link-up" || act === "link-down") {
      var to = act === "link-up" ? li - 1 : li + 1;
      swap(links, li, to);
      renderEditor({ sel: ['.row[data-s="' + si + '"][data-l="' + to + '"] [data-act="' + act + '"]:not(:disabled)', '.row[data-s="' + si + '"][data-l="' + to + '"] .title-in'] });
      return changed();
    }
    if (act === "link-del") {
      snapshot();
      links.splice(li, 1);
      renderEditor();
      return changed({ keepUndo: true });
    }
    if (act === "link-add") {
      links.push({ title: "", subtitle: "", url: "" });
      renderEditor({ sel: '.row[data-s="' + si + '"][data-l="' + (links.length - 1) + '"] .title-in', flash: true });
      return changed();
    }
    if (act === "sec-up" || act === "sec-down") {
      var dest = act === "sec-up" ? si - 1 : si + 1;
      swap(data.sections, si, dest);
      renderEditor({ sel: ['.section[data-s="' + dest + '"] [data-act="' + act + '"]:not(:disabled)', '.section[data-s="' + dest + '"] .sec-title'] });
      return changed();
    }
    if (act === "sec-del") {
      var s = data.sections[si];
      if (s.links.length && !window.confirm('Delete the "' + (s.title || "Untitled") + '" category and its ' + plural(s.links.length, "link") + "?")) return;
      snapshot();
      data.sections.splice(si, 1);
      renderEditor();
      return changed({ keepUndo: true });
    }
  }

  function onInput(e) {
    var el = e.target;
    var sec = el.closest("[data-s]");
    if (!sec) return;
    var si = +sec.getAttribute("data-s");
    el.classList.remove("bad");
    if (el.classList.contains("sec-title")) {
      data.sections[si].title = el.value;
      // Keep the "Category" dropdowns in step with the new name.
      $("sections").querySelectorAll('select[data-act="link-move"] option[value="' + si + '"]').forEach(function (o) { o.textContent = el.value || "Untitled category"; });
    } else if (el.hasAttribute("data-f")) {
      var row = el.closest(".row");
      var link = data.sections[si].links[+row.getAttribute("data-l")];
      link[el.getAttribute("data-f")] = el.value;
      if (el.getAttribute("data-f") === "url") {
        row.querySelector('[data-f="subtitle"]').placeholder = R.hostOf(el.value) || "Subtitle (optional)";
        row.querySelector('[data-act="link-open"]').disabled = !R.isSafeUrl(el.value.trim());
      }
    } else return;
    changed();
  }

  function onChange(e) {
    var sel = e.target;
    if (sel.getAttribute("data-act") === "link-icon") {
      var r = sel.closest(".row");
      var l = data.sections[+r.getAttribute("data-s")].links[+r.getAttribute("data-l")];
      if (sel.value) l.icon = sel.value;
      else delete l.icon;  // stay identical to normalize(), which leaves out empty icons
      return changed();
    }
    if (sel.getAttribute("data-act") !== "link-move") return;
    var row = sel.closest(".row");
    var from = +row.getAttribute("data-s"), li = +row.getAttribute("data-l"), to = +sel.value;
    if (from === to) return;
    var link = data.sections[from].links.splice(li, 1)[0];
    data.sections[to].links.push(link);
    renderEditor({ sel: '.row[data-s="' + to + '"][data-l="' + (data.sections[to].links.length - 1) + '"] select', flash: true });
    changed();
  }

  /* ---------- Preview ---------- */

  var previewTimer = 0;
  function renderPreview(full) {
    var frame = $("frame");
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () {
      var doc = null;
      try { doc = frame.contentDocument; } catch (e) {}
      var main = !full && doc && doc.querySelector("main");
      if (main) {
        // Update the page in place so the preview keeps its scroll position while typing.
        R.applyToPage(doc, data);
        return;
      }
      var base = new URL("../", location.href).href;
      frame.srcdoc = R.buildPage(pageHtml, data).replace("<head>", '<head>\n  <base href="' + esc(base) + '" target="_blank">');
    }, full ? 0 : 200);
  }

  /* ---------- Save ---------- */

  function cleaned() {
    var out = clone(data);
    out.sections.forEach(function (s) {
      s.title = s.title.trim();
      s.links.forEach(function (l) { l.title = l.title.trim(); l.subtitle = l.subtitle.trim(); l.url = l.url.trim(); });
    });
    (out.social || []).forEach(function (x) { x.url = x.url.trim(); });
    return out;
  }

  function markProblems() {
    var first = null;
    $("sections").querySelectorAll(".section").forEach(function (sec) {
      var s = data.sections[+sec.getAttribute("data-s")];
      var t = sec.querySelector(".sec-title");
      if (!s.title.trim()) { t.classList.add("bad"); first = first || t; }
      sec.querySelectorAll(".row").forEach(function (row) {
        var l = s.links[+row.getAttribute("data-l")];
        var ti = row.querySelector('[data-f="title"]'), ui = row.querySelector('[data-f="url"]');
        if (!l.title.trim()) { ti.classList.add("bad"); first = first || ti; }
        if (!R.isSafeUrl(l.url.trim())) { ui.classList.add("bad"); first = first || ui; }
      });
    });
    $("social").querySelectorAll(".srow").forEach(function (row) {
      var x = data.social[+row.getAttribute("data-i")];
      var ns = row.querySelector('[data-sf="network"]'), us = row.querySelector('[data-sf="url"]');
      if (!R.networks.hasOwnProperty(x.network)) { ns.classList.add("bad"); first = first || ns; }
      if (!R.isSafeUrl(x.url.trim())) { us.classList.add("bad"); first = first || us; }
    });
    if (first) { first.scrollIntoView({ block: "center", behavior: "smooth" }); first.focus({ preventScroll: true }); }
  }

  function summary(before, after) {
    var items = [];
    var all = function (d) { var m = {}; d.sections.forEach(function (s) { s.links.forEach(function (l) { m[l.url] = l; }); }); return m; };
    var count = function (d) { return d.sections.reduce(function (n, s) { return n + s.links.length; }, 0); };
    var a = all(before), b = all(after);
    var added = Object.keys(b).filter(function (u) { return !a[u]; });
    var removed = Object.keys(a).filter(function (u) { return !b[u]; });
    var edited = Object.keys(b).filter(function (u) { return a[u] && (a[u].title !== b[u].title || a[u].subtitle !== b[u].subtitle || (a[u].icon || "") !== (b[u].icon || "")); });
    var names = function (urls, m) { return urls.slice(0, 4).map(function (u) { return "“" + esc(m[u].title || u) + "”"; }).join(", ") + (urls.length > 4 ? " and " + (urls.length - 4) + " more" : ""); };
    items.push(plural(count(after), "link") + " in " + plural(after.sections.length, "category").replace("categorys", "categories"));
    if (added.length) items.push("Added " + names(added, b));
    if (removed.length) items.push("Removed " + names(removed, a));
    if (edited.length) items.push("Edited " + plural(edited.length, "link"));
    // Where each surviving link sits, ignoring links that were added or removed.
    var place = function (d) {
      var m = {}, seen = {};
      d.sections.forEach(function (s, si) {
        s.links.filter(function (l) { return a[l.url] && b[l.url]; }).forEach(function (l, li) { m[l.url] = si + ":" + li; });
      });
      return m;
    };
    var pa = place(before), pb = place(after);
    var titleOf = function (d) { var m = {}; d.sections.forEach(function (s) { s.links.forEach(function (l) { m[l.url] = s.title; }); }); return m; };
    var ta = titleOf(before), tb = titleOf(after);
    var moved = Object.keys(pb).filter(function (u) { return ta[u] !== tb[u]; });
    var reordered = Object.keys(pb).some(function (u) { return pa[u] !== pb[u]; });
    if (moved.length) items.push("Moved " + names(moved, b) + " to another category");
    else if (reordered) items.push("Reordered links");
    var cats = function (d) { return d.sections.map(function (s) { return s.title; }); };
    var ca = cats(before), cb = cats(after);
    var newCats = cb.filter(function (c) { return ca.indexOf(c) < 0; });
    var goneCats = ca.filter(function (c) { return cb.indexOf(c) < 0; });
    if (newCats.length) items.push("New or renamed categories: " + newCats.map(function (c) { return "“" + esc(c) + "”"; }).join(", "));
    if (goneCats.length) items.push("Removed or renamed categories: " + goneCats.map(function (c) { return "“" + esc(c) + "”"; }).join(", "));
    if (!newCats.length && !goneCats.length && ca.join("\n") !== cb.join("\n")) items.push("Reordered categories");
    if (JSON.stringify(before.social || []) !== JSON.stringify(after.social || [])) {
      var sb = (before.social || []).length, sa = (after.social || []).length;
      items.push("Updated social media buttons" + (sb !== sa ? " (" + sb + " → " + sa + ")" : ""));
    }
    after.sections.forEach(function (s) {
      if (!s.links.length) items.push('<span class="warn">“' + esc(s.title) + "” has no links and won’t show on the page</span>");
    });
    return items.map(function (i) { return "<li>" + i + "</li>"; }).join("");
  }

  function openSave() {
    var problems = R.validate(data);
    if (problems.length) {
      setStatus(esc(problems[0]) + (problems.length > 1 ? " (+" + (problems.length - 1) + " more)" : ""), "err");
      markProblems();
      return;
    }
    $("save-summary").innerHTML = summary(JSON.parse(saved), cleaned());
    $("message").value = "";
    $("save-dialog").showModal();
  }

  function commit(force) {
    var next = cleaned();
    var note = $("message").value.trim();
    var json = JSON.stringify(next, null, 2) + "\n";
    $("save").disabled = true;
    setStatus("Publishing…");
    return gh("/contents/" + FILE, {
      method: "PUT",
      body: {
        message: (note || "Update links") + "\n\nEdited with the Link Hub admin dashboard.",
        content: encode64(json),
        sha: sha,
        branch: BRANCH
      }
    }).then(function (r) {
      if (r.status === 409 || r.status === 422 && /sha/i.test(r.body.message || "")) return conflict(force);
      if (r.status === 401) { clearToken(); throw new Error("Your sign-in expired. Sign out and sign in again; your edits are still here."); }
      if (r.status === 403 || r.status === 404) throw new Error("This token can't save to " + REPO + ". It needs Contents: Read and write.");
      if (r.status !== 200 && r.status !== 201) throw new Error("GitHub refused the save (" + r.status + "): " + (r.body.message || "unknown error"));
      sha = r.body.content.sha;
      data = next;
      saved = JSON.stringify(next);
      undo = null;
      renderEditor();
      $("discard").disabled = true;
      watchLive(saved, r.body.commit && r.body.commit.html_url);
    }).catch(function (e) {
      setStatus(esc(e.message === "Failed to fetch" ? "Couldn't reach GitHub. Your edits are still here; try again." : e.message), "err");
      $("save").disabled = !isDirty();
    });
  }

  // Someone else published since this page loaded. Saving again over their commit replaces
  // their link edits with the ones on screen, so it needs a yes first.
  function conflict(force) {
    if (force) throw new Error("The page changed again while saving. Try once more.");
    var overwrite = window.confirm("Someone else published changes to the links since you opened this page.\n\nOK: publish your version anyway (replaces their link changes).\nCancel: keep editing (reload the page to see theirs).");
    if (!overwrite) throw new Error("Not published: the links were changed elsewhere. Reload to see the latest.");
    return gh("/contents/" + FILE + "?ref=" + BRANCH).then(function (r) {
      if (r.status !== 200) throw new Error("Couldn't load the latest version (" + r.status + ").");
      sha = r.body.sha;
      return commit(true);
    });
  }

  // Polls GitHub until links.json serves the data just published. Visitors' browsers ask for a
  // per-minute version (see ../live.js) of the same cached file, so when this matches the page is
  // updated; GitHub's servers elsewhere can lag by up to 5 minutes.
  function watchLive(json, commitUrl) {
    clearInterval(pollTimer);
    var tries = 0;
    var link = commitUrl ? ' <a href="' + esc(commitUrl) + '" target="_blank" rel="noopener">View change</a>' : "";
    setStatus("Published. The page updates within about 5 minutes…" + link, "ok");
    pollTimer = setInterval(function () {
      tries++;
      fetch(RAW + "?t=" + Date.now(), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (live) {
          if (JSON.stringify(R.normalize(live)) === json) {
            clearInterval(pollTimer); pollTimer = 0;
            if (!isDirty()) setStatus("Live ✓" + link, "ok");
          } else if (tries >= 96) {
            clearInterval(pollTimer); pollTimer = 0;
            if (!isDirty()) setStatus("Saved. The live page is taking longer than usual to update." + link, "ok");
          }
        }).catch(function () {});
    }, 5000);
  }

  /* ---------- Wiring ---------- */

  $("signin-form").addEventListener("submit", function (e) {
    e.preventDefault();
    $("signin-btn").disabled = true;
    signIn($("token").value, $("remember").checked).then(function () {
      $("signin-btn").disabled = false;
      $("token").value = "";
    });
  });
  $("social").addEventListener("click", onSocialClick);
  $("social").addEventListener("input", onSocialEdit);
  $("social").addEventListener("change", onSocialEdit);
  $("sections").addEventListener("click", onClick);
  $("sections").addEventListener("input", onInput);
  $("sections").addEventListener("change", onChange);
  $("status").addEventListener("click", function (e) {
    if (e.target.id !== "undo" || !undo) return;
    data = undo; undo = null;
    renderEditor();
    changed();
  });
  $("add-section").addEventListener("click", function () {
    data.sections.push({ title: "New category", links: [] });
    renderEditor({ sel: '.section[data-s="' + (data.sections.length - 1) + '"] .sec-title', select: true });
    changed();
  });
  $("discard").addEventListener("click", function () {
    if (!window.confirm("Discard all unsaved changes?")) return;
    data = JSON.parse(saved); undo = null;
    renderEditor();
    changed();
  });
  $("save").addEventListener("click", openSave);
  $("save-cancel").addEventListener("click", function () { $("save-dialog").close(); });
  $("save-form").addEventListener("submit", function (e) {
    e.preventDefault();
    $("save-dialog").close();
    commit(false);
  });
  $("signout").addEventListener("click", function () {
    if (isDirty() && !window.confirm("You have unsaved changes. Sign out anyway?")) return;
    clearToken();
    saved = data ? JSON.stringify(data) : "";
    location.reload();
  });
  $("preview-open").addEventListener("click", function () { $("preview").classList.add("open"); renderPreview(true); });
  $("preview-close").addEventListener("click", function () { $("preview").classList.remove("open"); });
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s" && !$("editor").hidden) { e.preventDefault(); if (isDirty()) openSave(); }
    if (e.key === "Escape") $("preview").classList.remove("open");
  });
  window.addEventListener("beforeunload", function (e) {
    if (isDirty()) { e.preventDefault(); e.returnValue = ""; }
  });

  // config.json: { "repo", "file", "branch"?, "brand": { "color", "ink" }?, "icons": [{ label, path }]? }
  fetch("config.json", { cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error(res.status);
    return res.json();
  }).then(function (cfg) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo || "") || !/^[\w.\/-]+\.json$/.test(cfg.file || "")) throw new Error("bad config");
    REPO = cfg.repo; FILE = cfg.file; BRANCH = cfg.branch || "main";
    API = "https://api.github.com/repos/" + REPO;
    RAW = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/" + FILE;
    ICONS = (Array.isArray(cfg.icons) ? cfg.icons : []).filter(function (i) { return i && R.isSafeIcon(String(i.path || "")); });
    var hex = /^#[0-9a-f]{6}$/i;
    if (cfg.brand && hex.test(cfg.brand.color || "")) document.documentElement.style.setProperty("--brand", cfg.brand.color);
    if (cfg.brand && hex.test(cfg.brand.press || "")) document.documentElement.style.setProperty("--brand-press", cfg.brand.press);
    if (cfg.brand && hex.test(cfg.brand.ink || "")) document.documentElement.style.setProperty("--ink-on-brand", cfg.brand.ink);
    document.querySelectorAll("[data-cfg=repo]").forEach(function (el) { el.textContent = REPO; });
    document.querySelectorAll("[data-cfg=repo-name]").forEach(function (el) { el.textContent = REPO.split("/")[1]; });
    document.querySelectorAll("[data-cfg=owner]").forEach(function (el) { el.textContent = REPO.split("/")[0]; });
    var existing = loadToken();
    if (existing) signIn(existing);
    else showSignin();
  }).catch(function () {
    setStatus("This dashboard isn't set up: admin/config.json is missing or invalid.", "err");
  });
})();
