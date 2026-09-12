(function () {
  "use strict";

  var homepage = document.getElementById("homepage");
  var mobileNav = document.getElementById("home-mobile-nav");
  var hamburgerBtn = document.getElementById("home-hamburger-btn");

  if (hamburgerBtn) {
    hamburgerBtn.addEventListener("click", function () {
      mobileNav.classList.toggle("open");
    });
  }

  function enterApp(view) {
    homepage.classList.add("hidden");
    document.body.style.overflow = "";

    if (view === "graph") {
      var g = document.getElementById("view-graph-btn");
      if (g) g.click();
    } else if (view === "mindmap") {
      var m = document.getElementById("view-mindmap-btn");
      if (m) m.click();
    } else if (view === "reference") {
      var r = document.getElementById("view-reference-btn");
      if (r) r.click();
    } else if (view === "browse") {
      var s = document.getElementById("sidebar-toggle");
      if (s) s.click();
    } else if (view === "search") {
      var search = document.getElementById("search");
      if (search) setTimeout(function () { search.focus(); }, 150);
    }
  }

  ["home-enter-btn-header", "home-enter-btn-hero", "home-enter-btn-mobile"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("click", function () { enterApp("graph"); });
  });

  document.querySelectorAll(".home-tool-open").forEach(function (btn) {
    btn.addEventListener("click", function () { enterApp(btn.getAttribute("data-view")); });
  });
})();
