// Loads the current links and social row from the public linkhub-data repo and swaps them in. Which file is
// set by the page: <script src="live.js" data-source="https://raw.githubusercontent.com/...">.
//
// The page already shows a built-in copy (rendered into the HTML), so if GitHub is slow or
// unreachable visitors still get working links. GitHub's file servers cache each file for up to
// 5 minutes and ignore query strings, so an edit can take that long to appear; the ?v= minute
// bucket only stops the visitor's own browser cache adding more delay on top.
(function () {
  "use strict";

  var script = document.currentScript;
  var SOURCE = script && script.getAttribute("data-source");
  var R = window.LinkhubRender;
  var main = document.querySelector("main");
  var builtIn = document.getElementById("links-data");
  if (!SOURCE || !R || !main || !window.fetch) return;

  var current = "";
  try { current = JSON.stringify(R.normalize(JSON.parse(builtIn.textContent))); } catch (e) {}

  fetch(SOURCE + "?v=" + Math.floor(Date.now() / 60000))
    .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
    .then(function (raw) {
      var data = R.normalize(raw);
      // An empty or broken file must never blank the page; keep the built-in links instead.
      if (!R.renderSections(data) || JSON.stringify(data) === current) return;
      R.applyToPage(document, data);
    })
    .catch(function () {});
})();
