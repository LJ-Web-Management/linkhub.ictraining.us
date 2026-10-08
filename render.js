// Turns the link data into the public page's markup.
//
// Each site's links live in a JSON file in the public LJ-Web-Management/linkhub-data repo
// (hazwoper-osha.json, ictraining.json). The public page loads its file on each visit (live.js)
// and renders it with renderSections(); the admin dashboard edits and commits it.
// The same render.js, live.js and admin/ files run on every site; admin/config.json and the
// data-source attribute on live.js say which file belongs to which site.
// index.html also carries a built-in copy in
// <script type="application/json" id="links-data"> plus the rendered sections between
// <!-- links:start --> and <!-- links:end --> (and the social row between <!-- social:start -->
// and <!-- social:end -->), for search engines, no-JS visitors and the case
// where GitHub is unreachable. buildPage() refreshes that copy.
//
// Loaded as a browser script by the page and the dashboard, and by Node (module.exports).
(function (root) {
  "use strict";

  var CHEV = '<svg class="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6"/></svg>';
  var DATA_RE = /(<script type="application\/json" id="links-data">)[\s\S]*?(<\/script>)/;
  var LINKS_RE = /(<!-- links:start -->)[\s\S]*?(<!-- links:end -->)/;
  var SOCIAL_RE = /(<!-- social:start -->)[\s\S]*?(<!-- social:end -->)/;

  // Social networks the page has icons for. The key is what links.json stores.
  var NETWORKS = {
    facebook: { label: "Facebook", svg: "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21z\"/></svg>" },
    instagram: { label: "Instagram", svg: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"5\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/><circle cx=\"17.5\" cy=\"6.5\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/></svg>" },
    youtube: { label: "YouTube", svg: "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.7 15.1V8.9l5.8 3.1z\"/></svg>" },
    x: { label: "X (Twitter)", svg: "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.5z\"/></svg>" },
    linkedin: { label: "LinkedIn", svg: "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4v11H3zM9.5 9.75h3.8v1.5h.06c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.77 2.65 4.77 6.1v5.45h-4v-4.83c0-1.15-.02-2.63-1.6-2.63-1.6 0-1.85 1.25-1.85 2.55v4.91h-4z\"/></svg>" },
    pinterest: { label: "Pinterest", svg: "<svg viewBox=\"0 0 24 24\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-5s-.3-.6-.3-1.5c0-1.4.8-2.4 1.8-2.4.9 0 1.3.6 1.3 1.4 0 .9-.5 2.1-.8 3.3-.2 1 .5 1.8 1.5 1.8 1.8 0 3.1-1.9 3.1-4.6 0-2.4-1.7-4.1-4.2-4.1-2.9 0-4.6 2.1-4.6 4.4 0 .9.3 1.8.8 2.3.1.1.1.2.1.3l-.3 1.2c0 .2-.2.3-.4.2-1.3-.6-2.1-2.5-2.1-4 0-3.3 2.4-6.3 6.9-6.3 3.6 0 6.4 2.6 6.4 6 0 3.6-2.3 6.5-5.4 6.5-1.1 0-2.1-.6-2.4-1.2l-.7 2.5c-.2.9-.9 2.1-1.3 2.8A10 10 0 1 0 12 2z\"/></svg>" },
    website: { label: "Website", svg: "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z\"/></svg>" }
  };

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Only plain web links may reach the page: no javascript:, data: or relative URLs.
  function isSafeUrl(url) {
    try {
      var u = new URL(url);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch (e) {
      return false;
    }
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
  }

  // Icons are site images (assets/icons/x.png) or full https addresses; nothing that could
  // climb out of the site or run code.
  function isSafeIcon(path) {
    if (/^https:\/\//i.test(path)) return isSafeUrl(path);
    return /^[a-z0-9_-][a-z0-9_.\/-]*\.(png|svg|jpe?g|webp|gif)$/i.test(path) && path.indexOf("..") < 0;
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
  }

  // links.json can be edited by hand on GitHub, so coerce it into the expected shape.
  function normalize(raw) {
    var str = function (v) { return typeof v === "string" ? v : ""; };
    var sections = raw && Array.isArray(raw.sections) ? raw.sections : [];
    var out = {
      sections: sections.filter(function (s) { return s && typeof s === "object"; }).map(function (s) {
        return {
          title: str(s.title),
          links: (Array.isArray(s.links) ? s.links : []).filter(function (l) { return l && typeof l === "object"; }).map(function (l) {
            var link = { title: str(l.title), subtitle: str(l.subtitle), url: str(l.url) };
            if (str(l.icon).trim()) link.icon = str(l.icon).trim();  // optional; omitted when empty
            return link;
          })
        };
      })
    };
    // A file without "social" leaves the page's social row alone; [] removes it.
    if (raw && Array.isArray(raw.social)) {
      out.social = raw.social.filter(function (x) { return x && typeof x === "object"; }).map(function (x) {
        return { network: str(x.network), url: str(x.url) };
      });
    }
    return out;
  }

  // What the page can actually show: named sections, titled links with web addresses.
  function publishable(link) { return link.title.trim() && isSafeUrl(link.url.trim()); }

  function renderLink(link) {
    var sub = link.subtitle && link.subtitle.trim() ? link.subtitle.trim() : hostOf(link.url);
    var icon = link.icon && isSafeIcon(link.icon)
      ? '            <img class="icon icon-logo" src="' + esc(link.icon) + '" width="48" height="48" alt="">\n'
      : "";
    return '        <li>\n' +
      '          <a class="link" href="' + esc(link.url.trim()) + '" target="_blank" rel="noopener">\n' +
      icon +
      '            <span class="label"><span class="text"><span class="title">' + esc(link.title.trim()) + '</span><span class="domain">' + esc(sub) + '</span></span>' + CHEV + '</span>\n' +
      '          </a>\n' +
      '        </li>';
  }

  // Sections with no publishable links are kept in the data but left off the page. A page with
  // a single section shows it as a plain list; headings appear once there are two or more.
  function renderSections(data) {
    var used = {};
    var shown = normalize(data).sections.map(function (s) {
      return { title: s.title, links: s.links.filter(publishable) };
    }).filter(function (s) { return s.title.trim() && s.links.length; });
    return shown.map(function (s) {
      if (shown.length === 1) {
        return '      <section aria-label="' + esc(s.title.trim()) + '">\n' +
          '        <ul class="group">\n' +
          s.links.map(renderLink).join("\n") + '\n' +
          '        </ul>\n' +
          '      </section>';
      }
      var id = "s-" + slug(s.title), n = 2;
      while (used[id]) id = "s-" + slug(s.title) + "-" + n++;
      used[id] = true;
      return '      <section aria-labelledby="' + id + '">\n' +
        '        <h2 id="' + id + '">' + esc(s.title.trim()) + '</h2>\n' +
        '        <ul class="group">\n' +
        s.links.map(renderLink).join("\n") + '\n' +
        '        </ul>\n' +
        '      </section>';
    }).join("\n\n");
  }

  function renderSocial(data) {
    var items = (normalize(data).social || []).filter(function (x) {
      return NETWORKS.hasOwnProperty(x.network) && isSafeUrl(x.url.trim());
    }).map(function (x) {
      var n = NETWORKS[x.network];
      return '        <li><a href="' + esc(x.url.trim()) + '" target="_blank" rel="noopener" aria-label="' + esc(n.label) + '">' + n.svg + "</a></li>";
    });
    return items.length ? '      <ul class="social">\n' + items.join("\n") + "\n      </ul>" : "";
  }

  // Puts the data into an already-loaded page (the public page after fetching the live file,
  // and the dashboard's preview while typing).
  function applyToPage(doc, data) {
    data = normalize(data);
    var main = doc.querySelector("main");
    if (main) main.innerHTML = "\n" + renderSections(data) + "\n    ";
    if (!data.social) return;
    var header = doc.querySelector("header");
    var old = doc.querySelector("header .social");
    var box = doc.createElement("div");
    box.innerHTML = renderSocial(data).trim();
    var fresh = box.firstElementChild;
    if (old && fresh) old.parentNode.replaceChild(fresh, old);
    else if (old) old.parentNode.removeChild(old);
    else if (fresh && header) {
      var lede = header.querySelector(".lede");
      header.insertBefore(fresh, lede ? lede.nextSibling : null);
    }
  }

  // "<" is escaped so a link title can never close the <script> block early.
  function serialize(data) {
    return JSON.stringify(normalize(data), null, 2).replace(/</g, "\\u003c");
  }

  function readData(html) {
    var m = html.match(DATA_RE);
    if (!m) throw new Error("links-data block not found in index.html");
    return JSON.parse(html.slice(m.index + m[1].length, m.index + m[0].length - m[2].length));
  }

  function buildPage(html, data) {
    if (!DATA_RE.test(html) || !LINKS_RE.test(html)) throw new Error("index.html is missing the links markers");
    // Function replacements: "$" in a title must not be read as a replacement pattern.
    if (normalize(data).social && SOCIAL_RE.test(html)) {
      html = html.replace(SOCIAL_RE, function (_, a, b) {
        var row = renderSocial(data);
        return a + "\n" + (row ? row + "\n" : "") + "      " + b;
      });
    }
    return html
      .replace(LINKS_RE, function (_, a, b) { return a + "\n" + renderSections(data) + "\n      " + b; })
      .replace(DATA_RE, function (_, a, b) { return a + "\n" + serialize(data) + "\n  " + b; });
  }

  // Returns a list of problems; an empty list means the data is safe to publish.
  function validate(data) {
    var errors = [];
    data.sections.forEach(function (s, i) {
      var where = s.title.trim() ? '"' + s.title.trim() + '"' : "Category " + (i + 1);
      if (!s.title.trim()) errors.push(where + " needs a name.");
      s.links.forEach(function (l, j) {
        var name = l.title.trim() ? '"' + l.title.trim() + '"' : "link " + (j + 1);
        if (!l.title.trim()) errors.push(where + ": " + name + " needs a title.");
        if (!isSafeUrl(l.url.trim())) errors.push(where + ": " + name + " needs a full web address starting with https://");
        if (l.icon && !isSafeIcon(l.icon)) errors.push(where + ": " + name + " has an icon that isn't an image on this site.");
      });
    });
    (data.social || []).forEach(function (x, i) {
      var name = NETWORKS.hasOwnProperty(x.network) ? NETWORKS[x.network].label : "Social link " + (i + 1);
      if (!NETWORKS.hasOwnProperty(x.network)) errors.push("Social media: " + name + " needs a network.");
      if (!isSafeUrl(x.url.trim())) errors.push("Social media: " + name + " needs a full web address starting with https://");
    });
    return errors;
  }

  var api = { buildPage: buildPage, readData: readData, normalize: normalize, renderSections: renderSections, renderSocial: renderSocial, applyToPage: applyToPage, networks: NETWORKS, validate: validate, isSafeUrl: isSafeUrl, isSafeIcon: isSafeIcon, hostOf: hostOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LinkhubRender = api;
})(this);
