(function () {
  "use strict";

  /* ======================================================================
   *  FUTURE EXTENSION POINT — Drug Interaction / Compatibility Checker
   * ----------------------------------------------------------------------
   *  Everything the checker needs is already sitting in VAULT_DATA:
   *    VAULT_DATA.classes[classId] = { title, path, color, drugs:[...] }
   *    each drug = { generic, brands:[{brand,form,manufacturer,strength}],
   *                  indications, overview, contraindications, sideEffects,
   *                  precautions, adultDose, pediatricDose, neonatalDose, storage }
   *
   *  To wire in a real checker later:
   *    1. Write a function  (drugA, drugB) => { risk, mechanism, advice }
   *       (or a whole rule engine — CYP tables, QT-risk flags, etc.)
   *    2. Call  window.PharmaVault.registerInteractionEngine(fn)
   *    3. That automatically enables the "Interaction Checker" button in
   *       the header (see wireInteractionButton below) and hands it a
   *       two-drug picker UI. You only need to fill in `runInteractionCheck`.
   *  Nothing above needs to change for that to work — this file just
   *  reads window.PharmaVault._interactionEngine when the button is used.
   * ==================================================================== */
  window.PharmaVault = {
    version: 1,
    data: VAULT_DATA,
    getClass: function (id) { return VAULT_DATA.classes[id]; },
    listGenerics: function () { return FLAT_DRUGS_PUBLIC(); },
    _interactionEngine: null,
    registerInteractionEngine: function (fn) {
      this._interactionEngine = fn;
      var btn = document.getElementById("interaction-btn");
      if (btn) {
        btn.removeAttribute("disabled");
        btn.querySelector(".dot").classList.add("ready");
        btn.querySelector(".label").textContent = "Interaction Checker";
      }
    }
  };
  function FLAT_DRUGS_PUBLIC() { return FLAT_DRUGS; }

  /* ---------------------------------------------------------------- */
  /*  Data prep                                                        */
  /* ---------------------------------------------------------------- */
  var nodesById = {};
  var childrenOf = {};   // hubId -> [childId,...]
  var parentOf = {};     // id -> hubId

  var nodes = VAULT_DATA.nodes.map(function (n) {
    var copy = Object.assign({}, n);
    copy.x = (Math.random() - 0.5) * 200;
    copy.y = (Math.random() - 0.5) * 200;
    nodesById[n.id] = copy;
    return copy;
  });

  var links = VAULT_DATA.edges.map(function (e) { return { source: e.source, target: e.target }; });
  VAULT_DATA.edges.forEach(function (e) {
    (childrenOf[e.source] = childrenOf[e.source] || []).push(e.target);
    parentOf[e.target] = e.source;
  });

  var adjacency = {};
  links.forEach(function (l) {
    (adjacency[l.source] = adjacency[l.source] || new Set()).add(l.target);
    (adjacency[l.target] = adjacency[l.target] || new Set()).add(l.source);
  });

  // flatten drugs for search, once
  var FLAT_DRUGS = [];
  Object.keys(VAULT_DATA.classes).forEach(function (classId) {
    var c = VAULT_DATA.classes[classId];
    c.drugs.forEach(function (d, idx) {
      var brandNames = d.brands.map(function (b) { return b.brand; });
      FLAT_DRUGS.push({
        classId: classId,
        className: c.title,
        idx: idx,
        generic: d.generic,
        genericLower: d.generic.toLowerCase(),
        brands: brandNames,
        brandsLower: brandNames.join(" ").toLowerCase()
      });
    });
  });

  var HUB_R = 12;
  var CLASS_R = 6.5;
  function radiusFor(n) {
    return n.type === "hub" ? HUB_R : CLASS_R;
  }
  nodes.forEach(function (n) { n.r = radiusFor(n); });

  // Live-adjustable physics, mirroring Obsidian's own graph-view engine:
  // its repel slider (range 0–20) is cubed before being fed to the charge
  // force, and link distance is a single global slider (range 30–500,
  // default 250). We split repel into two tiers (major class / subclass)
  // since this vault has far more structure than a typical note graph,
  // but keep the same cubic-scaling feel so the sliders behave the way
  // an Obsidian user already expects.
  var hubRepelSlider = 9;
  var classRepelSlider = 5.5;
  var linkSpacingSlider = 100; // 100 == the tuned baseline below, acts as a % scale
  function cube(v) { return v * v * v; }

  /* ---------------------------------------------------------------- */
  /*  Canvas + zoom/pan/drag plumbing                                  */
  /* ---------------------------------------------------------------- */
  var canvas = document.getElementById("graph");
  var ctx = canvas.getContext("2d");
  var DPR = Math.max(1, window.devicePixelRatio || 1);
  var width = 0, height = 0;
  var transform = d3.zoomIdentity;
  var hoverNode = null;
  var selectedNode = null;
  var searchGlowSet = null; // Set of classIds to highlight while searching

  function resize() {
    var rect = canvas.parentElement.getBoundingClientRect();
    width = rect.width; height = rect.height;
    canvas.width = width * DPR; canvas.height = height * DPR;
    canvas.style.width = width + "px"; canvas.style.height = height + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    draw();
  }
  window.addEventListener("resize", resize);

  function linkDistanceFn(l) {
    var s = l.source;
    var a = (typeof s === "object") ? s : nodesById[s];
    var base = 46;
    if (a && a.id === "Home") base = 135;
    else if (a && (a.id === "Organ Systems" || a.id === "Cross-System Classes")) base = 105;
    else if (a && a.type === "hub") base = 66;
    return base * (linkSpacingSlider / 100);
  }

  var simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id(function (d) { return d.id; })
      .distance(linkDistanceFn)
      .strength(0.9))
    .force("charge", d3.forceManyBody().strength(function (d) {
      if (d.id === "Home") return -cube(hubRepelSlider) * 1.6;
      return d.type === "hub" ? -cube(hubRepelSlider) : -cube(classRepelSlider);
    }).distanceMax(700))
    .force("collide", d3.forceCollide().radius(function (d) {
      return d.type === "hub" ? d.r + 36 : d.r + 22;
    }).iterations(3))
    .force("center", d3.forceCenter(0, 0))
    .force("x", d3.forceX(0).strength(0.035))
    .force("y", d3.forceY(0).strength(0.035))
    .velocityDecay(0.4)
    .alphaDecay(0.022)
    .on("tick", draw);

  var quad;
  simulation.on("tick.quad", function () {
    quad = d3.quadtree(nodes, function (d) { return d.x; }, function (d) { return d.y; });
  });

  function screenToGraph(px, py) { return transform.invert([px, py]); }

  function findNodeAt(gx, gy) {
    if (!quad) return null;
    var best = null, bestDist = Infinity;
    quad.visit(function (node, x0, y0, x1, y1) {
      if (!node.length) {
        do {
          var d = node.data;
          var dx = d.x - gx, dy = d.y - gy;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < d.r + 4 && dist < bestDist) { best = d; bestDist = dist; }
        } while (node = node.next);
      }
      return x0 > gx + 30 || x1 < gx - 30 || y0 > gy + 30 || y1 < gy - 30;
    });
    return best;
  }

  var zoomBehavior = d3.zoom()
    .scaleExtent([0.12, 7])
    .on("zoom", function (event) {
      transform = event.transform;
      draw();
    })
    .on("start", function () { canvas.classList.add("grabbing"); })
    .on("end", function () { canvas.classList.remove("grabbing"); });

  var dragMoved = false;
  var dragBehavior = d3.drag()
    .subject(function (event) {
      var p = screenToGraph(event.x, event.y);
      var n = findNodeAt(p[0], p[1]);
      return n || undefined;
    })
    .on("start", function (event) {
      dragMoved = false;
      if (!event.active) simulation.alphaTarget(0.25).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    })
    .on("drag", function (event) {
      dragMoved = true;
      var p = screenToGraph(event.x, event.y);
      event.subject.fx = p[0];
      event.subject.fy = p[1];
    })
    .on("end", function (event) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
      if (!dragMoved) selectNode(event.subject);
    });

  d3.select(canvas).call(dragBehavior).call(zoomBehavior);

  canvas.addEventListener("mousemove", function (event) {
    if (event.buttons) return; // dragging/panning, skip hover work
    var rect = canvas.getBoundingClientRect();
    var p = screenToGraph(event.clientX - rect.left, event.clientY - rect.top);
    var n = findNodeAt(p[0], p[1]);
    setHover(n);
  });
  canvas.addEventListener("mouseleave", function () { setHover(null); });

  function setHover(n) {
    if (n === hoverNode) return;
    hoverNode = n;
    var tip = document.getElementById("tooltip");
    if (n) {
      canvas.style.cursor = "pointer";
      tip.style.display = "block";
      var rect = canvas.getBoundingClientRect();
      var sp = transform.apply([n.x, n.y]);
      tip.style.left = (rect.left + sp[0] + 14) + "px";
      tip.style.top = (rect.top + sp[1] + 8) + "px";
      tip.innerHTML = escapeHtml(n.label) +
        (n.type === "class" ? '<span class="t-count">' + n.drugCount + " generics</span>" : '<span class="t-count">category</span>');
    } else {
      canvas.style.cursor = "grab";
      tip.style.display = "none";
    }
    draw();
  }

  /* ---------------------------------------------------------------- */
  /*  Draw                                                             */
  /* ---------------------------------------------------------------- */
  function draw() {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    var activeNode = hoverNode || selectedNode;
    var neighborSet = activeNode ? adjacency[activeNode.id] : null;

    // links
    ctx.lineWidth = 1 / transform.k;
    links.forEach(function (l) {
      var s = l.source, t = l.target;
      if (typeof s !== "object" || typeof t !== "object") return;
      var dim = activeNode && !(s === activeNode || t === activeNode);
      ctx.strokeStyle = dim ? "rgba(120,130,145,0.10)" : "rgba(150,165,180,0.4)";
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    });

    // node circles (world space — these are allowed to scale with zoom)
    var labelQueue = [];
    nodes.forEach(function (n) {
      var isActive = n === activeNode;
      var isNeighbor = neighborSet && neighborSet.has(n.id);
      var isSearchHit = searchGlowSet && searchGlowSet.has(n.id);
      var dim = activeNode && !isActive && !isNeighbor;
      if (searchGlowSet) dim = !isSearchHit;

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = dim ? dimColor(n.color) : n.color;
      ctx.fill();
      if (n.type === "hub") {
        ctx.lineWidth = 1.4 / transform.k;
        ctx.strokeStyle = dim ? "rgba(230,233,236,0.14)" : "rgba(230,233,236,0.6)";
        ctx.stroke();
      }
      if (isActive || isSearchHit) {
        ctx.lineWidth = 2 / transform.k;
        ctx.strokeStyle = "#e7e9ec";
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3 / transform.k, 0, Math.PI * 2);
        ctx.stroke();
      }

      var wantLabel = isActive || isNeighbor || isSearchHit ||
        (n.type === "hub" && transform.k > 0.22) ||
        (n.type === "class" && transform.k > 0.85);
      if (wantLabel && !dim) labelQueue.push(n);
    });
    ctx.restore();

    // labels — drawn AFTER restoring to identity transform, so font size is
    // always a crisp, fixed screen-space size regardless of zoom level.
    // Placed on the side AWAY from the incoming link (the direction from
    // this node's parent), so text doesn't sit on top of the connecting
    // line — same idiom as a radial tree/mind-map label flip.
    labelQueue.forEach(function (n) { drawLabel(n); });
  }

  function drawLabel(n) {
    var sp = transform.apply([n.x, n.y]);
    var isHub = n.type === "hub";
    var fontPx = isHub ? 12 : 10.5;
    ctx.font = (isHub ? "600 " : "500 ") + fontPx + "px " + LABEL_FONT;
    ctx.textBaseline = "middle";
    var text = n.label;
    var tw = ctx.measureText(text).width;
    var r = n.r * transform.k;
    var pad = 6;

    var pid = parentOf[n.id];
    var pn = pid ? nodesById[pid] : null;
    var dx = pn ? (n.x - pn.x) : 1;
    var dy = pn ? (n.y - pn.y) : 0;
    var mode;
    if (!pn || Math.abs(dx) >= Math.abs(dy) * 0.6) mode = dx >= 0 ? "right" : "left";
    else mode = dy >= 0 ? "bottom" : "top";

    var lx, ly, chipX;
    if (mode === "right") { lx = sp[0] + r + pad; ly = sp[1]; chipX = lx - 3; ctx.textAlign = "left"; }
    else if (mode === "left") { lx = sp[0] - r - pad; ly = sp[1]; chipX = lx - tw - 3; ctx.textAlign = "right"; }
    else if (mode === "bottom") { lx = sp[0] - tw / 2; ly = sp[1] + r + pad + fontPx * 0.5; chipX = lx - 3; ctx.textAlign = "left"; }
    else { lx = sp[0] - tw / 2; ly = sp[1] - r - pad - fontPx * 0.5; chipX = lx - 3; ctx.textAlign = "left"; }

    ctx.fillStyle = "rgba(6,7,8,0.72)";
    ctx.fillRect(chipX, ly - fontPx / 2 - 2, tw + 6, fontPx + 4);
    ctx.fillStyle = isHub ? "rgba(255,255,255,0.96)" : "rgba(220,224,229,0.92)";
    ctx.fillText(text, lx, ly + 0.5);
  }
  var LABEL_FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

  function dimColor(hex) {
    // return a desaturated/low-alpha version for dimmed state
    var c = hexToRgb(hex);
    return "rgba(" + c.r + "," + c.g + "," + c.b + ",0.22)";
  }
  function hexToRgb(hex) {
    var v = parseInt(hex.replace("#", ""), 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Camera focus helper                                              */
  /* ---------------------------------------------------------------- */
  function focusOn(n, targetK) {
    var k = targetK || Math.max(transform.k, 1.1);
    var t = d3.zoomIdentity.translate(width / 2, height / 2).scale(k).translate(-n.x, -n.y);
    d3.select(canvas).transition().duration(650).ease(d3.easeCubicOut).call(zoomBehavior.transform, t);
  }

  /* ---------------------------------------------------------------- */
  /*  Panel                                                            */
  /* ---------------------------------------------------------------- */
  var panel = document.getElementById("panel");
  var panelAccent = document.getElementById("panel-accent");
  var panelKicker = document.getElementById("panel-kicker");
  var panelTitle = document.getElementById("panel-title");
  var panelSub = document.getElementById("panel-sub");
  var panelBody = document.getElementById("panel-body");
  var panelSearch = document.getElementById("panel-search");
  var panelChips = document.getElementById("panel-chips");

  function selectNode(n) {
    selectedNode = n;
    draw();
    openPanelFor(n);
    focusOn(n);
  }

  function subtreeCount(id) {
    var kids = childrenOf[id] || [];
    var total = 0;
    kids.forEach(function (k) {
      var kn = nodesById[k];
      if (kn.type === "class") total += kn.drugCount;
      else total += subtreeCount(k);
    });
    return total;
  }

  function openPanelFor(n, opts) {
    opts = opts || {};
    panel.classList.add("open");
    panelAccent.style.background = n.color;
    panelSearch.value = "";
    panelChips.innerHTML = "";
    panelChips.style.display = "none";

    if (n.type === "class") {
      var c = VAULT_DATA.classes[n.id];
      panelKicker.textContent = "Therapeutic class";
      panelTitle.textContent = c.title;
      panelSub.textContent = c.drugs.length + " generic drug" + (c.drugs.length === 1 ? "" : "s") +
        " · " + c.drugs.reduce(function (s, d) { return s + d.brands.length; }, 0) + " brand entries";
      panelSearch.placeholder = "Filter " + c.title.toLowerCase() + "…";
      renderDrugList(c.drugs, opts.focusIdx);
    } else {
      var kids = childrenOf[n.id] || [];
      panelKicker.textContent = n.id === "Home" ? "Vault root" : "Category";
      panelTitle.textContent = n.label;
      var total = subtreeCount(n.id);
      panelSub.textContent = kids.length + " subgroup" + (kids.length === 1 ? "" : "s") +
        (total ? " · " + total + " generic drugs total" : "");
      panelSearch.placeholder = "Search within " + n.label + "…";
      panelChips.style.display = "flex";
      kids.forEach(function (kid) {
        var kn = nodesById[kid];
        var chip = document.createElement("div");
        chip.className = "child-chip";
        chip.textContent = kn.label + (kn.type === "class" ? " (" + kn.drugCount + ")" : "");
        chip.style.borderColor = "rgba(255,255,255,.08)";
        chip.addEventListener("click", function () { selectNode(kn); });
        panelChips.appendChild(chip);
      });
      renderHubDrugList(n.id);
    }
  }

  function collectClassIdsUnder(id) {
    var out = [];
    (function walk(cur) {
      var kids = childrenOf[cur] || [];
      kids.forEach(function (k) {
        var kn = nodesById[k];
        if (kn.type === "class") out.push(k); else walk(k);
      });
    })(id);
    return out;
  }

  function renderHubDrugList(hubId) {
    var classIds = collectClassIdsUnder(hubId);
    var items = [];
    classIds.forEach(function (cid) {
      var c = VAULT_DATA.classes[cid];
      c.drugs.forEach(function (d, idx) { items.push({ classId: cid, className: c.title, drug: d, idx: idx }); });
    });
    panelBody.innerHTML = "";
    if (!items.length) {
      panelBody.innerHTML = '<div class="empty-msg">No generics directly under this node — pick a subgroup above.</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    items.forEach(function (item) {
      frag.appendChild(buildDrugCard(item.drug, item.className));
    });
    panelBody.appendChild(frag);

    panelSearch.oninput = function () {
      var q = panelSearch.value.trim().toLowerCase();
      var cards = panelBody.querySelectorAll(".drug-card");
      cards.forEach(function (card, i) {
        var item = items[i];
        var hay = item.drug.generic.toLowerCase() + " " + item.className.toLowerCase() + " " +
          item.drug.brands.map(function (b) { return b.brand; }).join(" ").toLowerCase();
        card.style.display = (!q || hay.indexOf(q) !== -1) ? "" : "none";
      });
    };
  }

  function renderDrugList(drugs, focusIdx) {
    panelBody.innerHTML = "";
    var frag = document.createDocumentFragment();
    var cardEls = [];
    drugs.forEach(function (d) {
      var card = buildDrugCard(d, null);
      cardEls.push(card);
      frag.appendChild(card);
    });
    panelBody.appendChild(frag);

    panelSearch.oninput = function () {
      var q = panelSearch.value.trim().toLowerCase();
      cardEls.forEach(function (card, i) {
        var d = drugs[i];
        var hay = d.generic.toLowerCase() + " " + d.brands.map(function (b) { return b.brand; }).join(" ").toLowerCase();
        card.style.display = (!q || hay.indexOf(q) !== -1) ? "" : "none";
      });
    };

    if (typeof focusIdx === "number" && cardEls[focusIdx]) {
      var target = cardEls[focusIdx];
      target.classList.add("expanded");
      renderCardBody(target);
      requestAnimationFrame(function () {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        target.style.borderColor = "var(--accent)";
        setTimeout(function () { target.style.borderColor = ""; }, 1600);
      });
    }
  }

  var FIELD_META = [
    ["indications", "Indications"],
    ["overview", "Overview"],
    ["contraindications", "Contraindications"],
    ["sideEffects", "Side effects"],
    ["precautions", "Precautions"],
    ["adultDose", "Adult dose"],
    ["pediatricDose", "Pediatric dose"],
    ["neonatalDose", "Neonatal dose"],
    ["storage", "Storage"]
  ];

  function buildDrugCard(d, classLabel) {
    var card = document.createElement("div");
    card.className = "drug-card";
    var head = document.createElement("div");
    head.className = "drug-card-head";
    head.innerHTML =
      '<div><div class="dc-name">' + escapeHtml(d.generic) + '</div>' +
      (classLabel ? '<div style="font-size:10.5px;color:var(--ink-faint);margin-top:1px;">' + escapeHtml(classLabel) + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
      '<span class="dc-count">' + d.brands.length + ' brand' + (d.brands.length === 1 ? "" : "s") + '</span>' +
      '<span class="dc-chev">&#9656;</span></div>';
    var body = document.createElement("div");
    body.className = "drug-card-body";
    card.appendChild(head);
    card.appendChild(body);
    head.addEventListener("click", function () {
      var wasOpen = card.classList.contains("expanded");
      card.classList.toggle("expanded");
      if (!wasOpen && !body.dataset.built) renderCardBody(card);
    });
    card._drug = d;
    return card;
  }

  function renderCardBody(card) {
    var d = card._drug;
    var body = card.querySelector(".drug-card-body");
    body.dataset.built = "1";
    var html = "";
    if (d.brands.length) {
      html += '<table class="brand-table"><thead><tr><th>Brand</th><th>Form</th><th>Strength</th><th>Manufacturer</th></tr></thead><tbody>';
      d.brands.forEach(function (b) {
        html += "<tr><td class=\"b-brand\">" + escapeHtml(b.brand) + "</td><td>" + escapeHtml(b.form || "—") +
          "</td><td class=\"b-strength\">" + escapeHtml(b.strength || "—") + "</td><td>" + escapeHtml(b.manufacturer || "—") + "</td></tr>";
      });
      html += "</tbody></table>";
    }
    FIELD_META.forEach(function (pair) {
      var val = d[pair[0]];
      if (val && val.trim()) {
        html += '<div class="field"><div class="f-label">' + pair[1] + '</div><div class="f-body">' + escapeHtml(val) + "</div></div>";
      }
    });
    body.innerHTML = html;
  }

  document.getElementById("panel-close").addEventListener("click", function () {
    panel.classList.remove("open");
    selectedNode = null;
    draw();
  });

  /* ---------------------------------------------------------------- */
  /*  Global search                                                    */
  /* ---------------------------------------------------------------- */
  var searchInput = document.getElementById("search");
  var searchResults = document.getElementById("search-results");
  var searchTimer = null;

  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 110);
  });
  searchInput.addEventListener("focus", function () { if (searchInput.value.trim()) runSearch(); });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".search-wrap")) { searchResults.classList.remove("show"); }
  });

  function runSearch() {
    var q = searchInput.value.trim().toLowerCase();
    if (!q) {
      searchResults.classList.remove("show");
      searchGlowSet = null;
      draw();
      return;
    }
    // class-title matches
    var classMatches = VAULT_DATA.nodes.filter(function (n) {
      return n.type === "class" && n.label.toLowerCase().indexOf(q) !== -1;
    }).slice(0, 6);

    var drugMatches = FLAT_DRUGS.filter(function (d) {
      return d.genericLower.indexOf(q) !== -1 || d.brandsLower.indexOf(q) !== -1;
    }).slice(0, 30);

    searchGlowSet = new Set(classMatches.map(function (c) { return c.id; }).concat(drugMatches.map(function (d) { return d.classId; })));
    draw();

    var html = "";
    classMatches.forEach(function (c) {
      html += '<div class="sr-item" data-kind="class" data-id="' + escapeHtml(c.id) + '">' +
        '<div class="sr-name">' + escapeHtml(c.label) + '</div><div class="sr-meta">Therapeutic class · ' + c.drugCount + ' generics</div></div>';
    });
    drugMatches.forEach(function (d) {
      var viaBrand = d.genericLower.indexOf(q) === -1;
      html += '<div class="sr-item" data-kind="drug" data-class="' + escapeHtml(d.classId) + '" data-idx="' + d.idx + '">' +
        '<div class="sr-name">' + escapeHtml(d.generic) + '</div><div class="sr-meta">' + escapeHtml(d.className) +
        (viaBrand ? ' · matched brand' : '') + '</div></div>';
    });
    if (!classMatches.length && !drugMatches.length) {
      html = '<div class="sr-item" style="color:var(--ink-faint);cursor:default;">No matches</div>';
    }
    searchResults.innerHTML = html;
    searchResults.classList.add("show");

    searchResults.querySelectorAll(".sr-item[data-kind]").forEach(function (el) {
      el.addEventListener("click", function () {
        searchResults.classList.remove("show");
        if (el.dataset.kind === "class") {
          selectNode(nodesById[el.dataset.id]);
        } else {
          var n = nodesById[el.dataset.class];
          selectedNode = n;
          draw();
          openPanelFor(n, { focusIdx: parseInt(el.dataset.idx, 10) });
          focusOn(n);
        }
        searchGlowSet = null;
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Legend                                                           */
  /* ---------------------------------------------------------------- */
  var LEGEND = [
    ["#ffb703", "Vault root / index pages"],
    ["#e63946", "CVS"],
    ["#3a86ff", "Respiratory"],
    ["#fb8500", "GIT"],
    ["#2a9d8f", "Renal & Urinary"],
    ["#8338ec", "Brain (CNS / ANS)"],
    ["#ff5fa2", "Endocrine"],
    ["#00b4d8", "Eye & ENT"],
    ["#a9744f", "Skin (Dermatology)"],
    ["#d0006f", "Reproductive & Obstetric"],
    ["#c1121f", "Blood & Immune"],
    ["#6b8e23", "Bone & Joint"],
    ["#a3c96a", "Nutrition & Supplements"],
    ["#2d6a4f", "Antibiotics"],
    ["#5c677d", "Other cross-system classes"]
  ];
  var legendEl = document.getElementById("legend-swatches");
  legendEl.innerHTML = "<h3>Color coding</h3>" + LEGEND.map(function (l) {
    return '<div class="legend-row"><span class="sw" style="background:' + l[0] + '"></span>' + l[1] + "</div>";
  }).join("");
  document.getElementById("legend-toggle").addEventListener("click", function (e) {
    document.getElementById("legend").classList.toggle("collapsed");
    e.currentTarget.classList.toggle("active");
  });

  /* ---------------------------------------------------------------- */
  /*  Physics sliders — live control, same feel as Obsidian's own       */
  /*  graph-view engine (repel value is cubed; link distance is a       */
  /*  percentage-of-baseline scale across every tier)                   */
  /* ---------------------------------------------------------------- */
  var hubSlider = document.getElementById("slider-hub");
  var classSlider = document.getElementById("slider-class");
  var linkSlider = document.getElementById("slider-link");
  var hubSliderVal = document.getElementById("slider-hub-val");
  var classSliderVal = document.getElementById("slider-class-val");
  var linkSliderVal = document.getElementById("slider-link-val");

  hubSlider.addEventListener("input", function () {
    hubRepelSlider = parseFloat(hubSlider.value);
    hubSliderVal.textContent = hubSlider.value;
    simulation.alpha(0.5).restart();
  });
  classSlider.addEventListener("input", function () {
    classRepelSlider = parseFloat(classSlider.value);
    classSliderVal.textContent = classSlider.value;
    simulation.alpha(0.5).restart();
  });
  linkSlider.addEventListener("input", function () {
    linkSpacingSlider = parseFloat(linkSlider.value);
    linkSliderVal.textContent = linkSlider.value;
    simulation.force("link").distance(linkDistanceFn); // recompute cached per-link distances
    simulation.alpha(0.5).restart();
  });
  hubSliderVal.textContent = hubSlider.value;
  classSliderVal.textContent = classSlider.value;
  linkSliderVal.textContent = linkSlider.value;

  /* ---------------------------------------------------------------- */
  /*  Header stats + interaction button stub                          */
  /* ---------------------------------------------------------------- */
  document.getElementById("stat-pill").textContent =
    VAULT_DATA.stats.genericDrugs.toLocaleString() + " generics · " +
    VAULT_DATA.stats.brandEntries.toLocaleString() + " brands · " +
    VAULT_DATA.stats.classFiles + " classes";

  document.getElementById("interaction-btn").addEventListener("click", function () {
    var engine = window.PharmaVault._interactionEngine;
    if (!engine) return; // disabled attr already blocks this, kept as a safety net
    alert("Interaction engine registered — build the picker UI here.");
  });

  /* ---------------------------------------------------------------- */
  /*  Sidebar — text/outline browser (the non-graph route)            */
  /* ---------------------------------------------------------------- */
  var sidebar = document.getElementById("sidebar");
  var sidebarTree = document.getElementById("sidebar-tree");

  function makeRow(label, hasChildren, isLeafClass) {
    var row = document.createElement("div");
    row.className = "tree-row" + (isLeafClass ? " tree-row-class" : "");
    row.innerHTML =
      (hasChildren ? '<span class="tree-chev">&#9656;</span>' : '<span class="tree-chev tree-chev-blank"></span>') +
      '<span class="tree-label">' + escapeHtml(label) + "</span>";
    return row;
  }

  function buildHubNode(id, ancestry) {
    var n = nodesById[id];
    var li = document.createElement("li");
    var kids = (childrenOf[id] || []).filter(function (k) { return ancestry.indexOf(k) === -1; });
    var row = makeRow(n.label, kids.length > 0, false);
    li.appendChild(row);
    if (kids.length) {
      var ul = document.createElement("ul");
      ul.className = "tree-children";
      var nextAncestry = ancestry.concat([id]);
      kids.forEach(function (kid) {
        var kn = nodesById[kid];
        ul.appendChild(kn.type === "hub" ? buildHubNode(kid, nextAncestry) : buildClassNode(kid));
      });
      li.appendChild(ul);
      row.querySelector(".tree-chev").addEventListener("click", function (e) {
        e.stopPropagation();
        li.classList.toggle("tree-open-state");
      });
      row.querySelector(".tree-label").addEventListener("click", function () {
        selectNode(n);
      });
    }
    return li;
  }

  function buildClassNode(id) {
    var n = nodesById[id];
    var c = VAULT_DATA.classes[id];
    var li = document.createElement("li");
    var row = makeRow(n.label + " (" + c.drugs.length + ")", c.drugs.length > 0, true);
    li.appendChild(row);
    var ul = document.createElement("ul");
    ul.className = "tree-children";
    c.drugs.forEach(function (d, idx) {
      var gli = document.createElement("li");
      var grow = makeRow(d.generic, false, false);
      grow.classList.add("tree-row-generic");
      grow.addEventListener("click", function () {
        selectNode(n);
        openPanelFor(n, { focusIdx: idx });
      });
      gli.appendChild(grow);
      ul.appendChild(gli);
    });
    li.appendChild(ul);
    // chevron: expand/collapse the inline generic-name preview only
    row.querySelector(".tree-chev").addEventListener("click", function (e) {
      e.stopPropagation();
      li.classList.toggle("tree-open-state");
    });
    // label: opens the full class page directly (brand tables, dosing, etc.)
    row.querySelector(".tree-label").addEventListener("click", function () {
      selectNode(n);
    });
    return li;
  }

  (function buildTree() {
    var rootUl = document.createElement("ul");
    rootUl.className = "tree-children tree-root";
    (childrenOf["Home"] || []).forEach(function (id) {
      rootUl.appendChild(buildHubNode(id, ["Home"]));
    });
    sidebarTree.appendChild(rootUl);
  })();

  function animateResize(duration) {
    var startTime = performance.now();
    function step(t) {
      resize();
      if (t - startTime < duration) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  document.getElementById("sidebar-toggle").addEventListener("click", function (e) {
    sidebar.classList.toggle("open");
    e.currentTarget.classList.toggle("active");
    animateResize(280);
  });
  document.getElementById("sidebar-close").addEventListener("click", function () {
    sidebar.classList.remove("open");
    document.getElementById("sidebar-toggle").classList.remove("active");
    animateResize(280);
  });

  /* ---------------------------------------------------------------- */
  /*  Mind Map — major classes only, static radial layout (no physics) */
  /*  for anyone who prefers a plain hierarchical read over the graph  */
  /*  or the text sidebar.                                             */
  /* ---------------------------------------------------------------- */
  var mindmapBuilt = false;
  function buildMindmapHierarchy(id) {
    var n = nodesById[id];
    var kids = (childrenOf[id] || []).filter(function (k) { return nodesById[k].type === "hub"; });
    return { id: id, label: n.label, color: n.color, children: kids.map(buildMindmapHierarchy) };
  }

  function buildMindmap() {
    if (mindmapBuilt) return;
    mindmapBuilt = true;

    var wrap = document.getElementById("mindmap-wrap");
    var rect = wrap.getBoundingClientRect();
    var w = rect.width, h = rect.height;

    var root = d3.hierarchy(buildMindmapHierarchy("Home"));
    var radius = Math.min(w, h) / 2 - 100;
    var treeLayout = d3.tree()
      .size([2 * Math.PI, radius])
      .separation(function (a, b) { return (a.parent === b.parent ? 1.4 : 2.2) / Math.max(a.depth, 1); });
    treeLayout(root);

    var svg = d3.select("#mindmap-svg");
    svg.selectAll("*").remove();
    var g = svg.append("g");

    var mmZoom = d3.zoom().scaleExtent([0.25, 4]).on("zoom", function (event) {
      g.attr("transform", event.transform);
    }).on("start", function () { svg.classed("grabbing", true); })
      .on("end", function () { svg.classed("grabbing", false); });
    svg.call(mmZoom);
    svg.call(mmZoom.transform, d3.zoomIdentity.translate(w / 2, h / 2).scale(0.85));

    var linkGen = d3.linkRadial().angle(function (d) { return d.x; }).radius(function (d) { return d.y; });

    g.append("g").attr("fill", "none").attr("stroke", "#3f3f3f").attr("stroke-width", 1.3)
      .selectAll("path").data(root.links()).join("path").attr("d", linkGen);

    var node = g.append("g").selectAll("g").data(root.descendants()).join("g")
      .attr("transform", function (d) {
        if (d.depth === 0) return "translate(0,0)"; // root sits dead-center, no spoke angle to follow
        return "rotate(" + (d.x * 180 / Math.PI - 90) + ") translate(" + d.y + ",0)";
      })
      .style("cursor", "pointer")
      .on("click", function (event, d) { selectNode(nodesById[d.data.id]); });

    node.append("circle")
      .attr("r", function (d) { return d.depth === 0 ? 9 : 6.5; })
      .attr("fill", function (d) { return d.data.color; })
      .attr("stroke", "rgba(230,233,236,.55)").attr("stroke-width", 1.2);

    // labels are appended to the un-rotated container and positioned with
    // plain cartesian math, so text always renders upright and horizontal
    // (much more legible for long class names than following the spoke
    // angle) — and it flips to the outward side of the node, away from the
    // connecting line, exactly like the force-graph view.
    g.append("g").selectAll("text").data(root.descendants()).join("text")
      .attr("x", function (d) {
        if (d.depth === 0) return 0;
        var angle = d.x - Math.PI / 2;
        return d.y * Math.cos(angle) + (d.x < Math.PI ? 10 : -10);
      })
      .attr("y", function (d) {
        if (d.depth === 0) return 0;
        var angle = d.x - Math.PI / 2;
        return d.y * Math.sin(angle);
      })
      .attr("dy", "0.32em")
      .attr("text-anchor", function (d) { return d.depth === 0 ? "middle" : (d.x < Math.PI ? "start" : "end"); })
      .style("cursor", "pointer")
      .on("click", function (event, d) { selectNode(nodesById[d.data.id]); })
      .text(function (d) { return d.data.label; })
      .attr("fill", "#dadada")
      .style("font-size", function (d) { return d.depth <= 1 ? "12.5px" : "11px"; })
      .style("font-weight", function (d) { return d.depth <= 1 ? "600" : "500"; })
      .style("paint-order", "stroke")
      .style("stroke", "#1c1c1c").style("stroke-width", "4px").style("stroke-linejoin", "round");
  }

  /* ---------------------------------------------------------------- */
  /*  View toggle — Graph / Mind Map                                   */
  /* ---------------------------------------------------------------- */
  var mainEl = document.querySelector("main");
  var mindmapWrap = document.getElementById("mindmap-wrap");
  var viewGraphBtn = document.getElementById("view-graph-btn");
  var viewMindmapBtn = document.getElementById("view-mindmap-btn");

  viewGraphBtn.addEventListener("click", function () {
    viewGraphBtn.classList.add("active");
    viewMindmapBtn.classList.remove("active");
    mainEl.classList.remove("mode-mindmap");
    mindmapWrap.classList.remove("active");
    resize();
  });
  viewMindmapBtn.addEventListener("click", function () {
    viewMindmapBtn.classList.add("active");
    viewGraphBtn.classList.remove("active");
    mainEl.classList.add("mode-mindmap");
    mindmapWrap.classList.add("active");
    buildMindmap();
  });

  /* ---------------------------------------------------------------- */
  /*  Keyboard                                                         */
  /* ---------------------------------------------------------------- */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (panel.classList.contains("open")) {
        panel.classList.remove("open");
        selectedNode = null;
        draw();
      } else if (sidebar.classList.contains("open")) {
        sidebar.classList.remove("open");
        document.getElementById("sidebar-toggle").classList.remove("active");
        animateResize(280);
      }
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Boot                                                             */
  /* ---------------------------------------------------------------- */
  resize();
  // give it a moment to settle at a reasonable zoom
  transform = d3.zoomIdentity.translate(width / 2, height / 2).scale(0.55);
  d3.select(canvas).call(zoomBehavior.transform, transform);

  // opening animation: hold on the splash mark briefly, then fade into the
  // already-laid-out graph rather than popping straight to a busy screen
  var splash = document.getElementById("splash");
  var appEl = document.getElementById("app");
  setTimeout(function () {
    appEl.classList.add("ready");
    if (splash) {
      splash.classList.add("hide");
      setTimeout(function () { splash.style.display = "none"; }, 550);
    }
  }, 700);

  setTimeout(function () {
    var hint = document.getElementById("hint");
    if (hint) hint.style.opacity = "0";
    setTimeout(function () { if (hint) hint.style.display = "none"; }, 400);
  }, 6000);
})();
