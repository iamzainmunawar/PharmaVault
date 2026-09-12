(function () {
  "use strict";

  var tabsBar = document.getElementById("reference-tabs");
  var panelsWrap = document.getElementById("reference-panels");
  var searchBox = document.getElementById("reference-search");
  var built = false;

  function showRefTab(key, btnEl) {
    panelsWrap.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.remove("active"); });
    tabsBar.querySelectorAll(".tab-btn").forEach(function (b) { b.classList.remove("active"); });
    document.getElementById("reftab-" + key).classList.add("active");
    btnEl.classList.add("active");
    searchBox.value = "";
    filterRefContent();
  }

  function filterRefContent() {
    var query = searchBox.value.trim().toLowerCase();
    var activePanel = panelsWrap.querySelector(".tab-panel.active");
    if (!activePanel) return;
    activePanel.querySelectorAll("tr").forEach(function (row) {
      if (row.parentElement.tagName === "THEAD") return;
      var text = row.textContent.toLowerCase();
      row.style.display = query === "" || text.indexOf(query) !== -1 ? "" : "none";
    });
    activePanel.querySelectorAll(".int-card, .formula-box.searchable").forEach(function (card) {
      var text = card.textContent.toLowerCase();
      card.style.display = query === "" || text.indexOf(query) !== -1 ? "" : "none";
    });
  }

  window.buildReferenceSection = function () {
    if (built) return;
    built = true;

    REFERENCE_DATA.tabs.forEach(function (t, i) {
      var btn = document.createElement("button");
      btn.className = "tab-btn" + (i === 0 ? " active" : "");
      btn.textContent = t.label;
      btn.addEventListener("click", function () { showRefTab(t.key, btn); });
      tabsBar.appendChild(btn);

      var panel = document.createElement("div");
      panel.className = "tab-panel" + (i === 0 ? " active" : "");
      panel.id = "reftab-" + t.key;
      panel.innerHTML = REFERENCE_DATA.panels[t.key] || "";
      panelsWrap.appendChild(panel);
    });

    searchBox.addEventListener("input", filterRefContent);
  };
})();
