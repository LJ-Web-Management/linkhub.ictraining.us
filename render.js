// Turns the link data into the public page's markup.
//
// Each site's links live in a JSON file in the public LJ-Web-Management/linkhub-data repo
// (hazwoper-osha.json, ictraining.json). The public page loads its file on each visit (live.js)
// and renders it with renderSections(); the admin dashboard edits and commits it.
// The same render.js, live.js and admin/ files run on every site; admin/config.json and the
// data-source attribute on live.js say which file belongs to which site.
// index.html also carries a built-in copy in
// <script type="application/json" id="links-data"> plus the rendered sections between
// <!-- links:start --> and <!-- links:end -->, for search engines, no-JS visitors and the case
// where GitHub is unreachable. buildPage() refreshes that copy.
//
// Loaded as a browser script by the page and the dashboard, and by Node (module.exports).
(function (root) {
  "use strict";

  var CHEV = '<svg class="chev" viewBox="0 0 8 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1l6 6-6 6"/></svg>';
  var DATA_RE = /(<script type="application\/json" id="links-data">)[\s\S]*?(<\/script>)/;
  var LINKS_RE = /(<!-- links:start -->)[\s\S]*?(<!-- links:end -->)/;

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
    return {
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
    return errors;
  }

  var api = { buildPage: buildPage, readData: readData, normalize: normalize, renderSections: renderSections, validate: validate, isSafeUrl: isSafeUrl, isSafeIcon: isSafeIcon, hostOf: hostOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LinkhubRender = api;
})(this);
