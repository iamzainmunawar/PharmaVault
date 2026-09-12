
(function () {
  "use strict";

  /* ======================================================================
   *  FUTURE EXTENSION POINT — Drug Interaction / Compatibility Checker
   * ----------------------------------------------------------------------
   *  Everything the checker needs is already sitting in VAULT_DATA:
   *    VAULT_DATA.classes[classId] = { title, path, color, drugs:[...] }
   *    each drug = { generic, brands:[{brand,form,manufacturer,strength}],
   *                  indications, overview, contraindications, sideEffects,
   *                  precautions, storage } — dosing fields were removed
   *                  entirely (no verified reference source for them)
   *
   *  To wire in a real checker later:
   *    1. Write a function  (drugA, drugB) => { risk, mechanism, advice }
   *       (or a whole rule engine — CYP tables, QT-risk flags, etc.)
   *    2. Call  window.PharmaGrid.registerInteractionEngine(fn)
   *    3. That automatically enables the "Interaction Checker" button in
   *       the header (see wireInteractionButton below) and hands it a
   *       two-drug picker UI. You only need to fill in `runInteractionCheck`.
   *  Nothing above needs to change for that to work — this file just
   *  reads window.PharmaGrid._interactionEngine when the button is used.
   * ==================================================================== */
  window.PharmaGrid = {
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
    // x/y are baked into the data file (generated once, offline — see
    // generate_layout.js). The browser never computes or randomizes the
    // layout itself; it just reads these fixed coordinates.
    if (typeof copy.x !== "number") copy.x = 0;
    if (typeof copy.y !== "number") copy.y = 0;
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

  // Resolve link endpoints to actual node object references. This used to
  // happen automatically inside d3.forceLink's initialize step; now that
  // positions come from a static tree layout instead of a live simulation,
  // we do it ourselves once, so draw() can read l.source.x/l.target.x directly.
  links.forEach(function (l) {
    l.source = nodesById[l.source];
    l.target = nodesById[l.target];
  });


  // Seed every node's starting position at roughly the angle/radius it will
  // end up settling near, instead of a random clump at the center. Force
  // simulations "unfold" from wherever they start, and starting from a
  // random jumble is what causes a whole branch to visibly swing/flip past
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
  window.addEventListener("resize", function () {
    resize();
    fitGraphToScreen(false);
  });

  // ---------------------------------------------------------------------
  //  Layout — generated once, offline (see generate_layout.js): an organic
  //  jittered-then-physics-settled radial tree, same spirit as Obsidian's
  //  own graph, searched across many random seeds until one came out with
  //  zero edge crossings. Those exact coordinates are baked into
  //  VAULT_DATA.nodes[i].x/y, so the browser just reads them — nothing is
  //  computed or randomized at load time, and nothing moves afterward.
  // ---------------------------------------------------------------------

  var quad = d3.quadtree(nodes, function (d) { return d.x; }, function (d) { return d.y; });

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

  d3.select(canvas).call(zoomBehavior);

  // No dragging — the layout is completely fixed once computed above.
  // Clicking a node still opens it; this is a plain click (press and
  // release without meaningful movement), not a drag gesture.
  var pressStart = null;
  canvas.addEventListener("mousedown", function (event) {
    pressStart = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("mouseup", function (event) {
    if (!pressStart) return;
    var moved = Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y);
    pressStart = null;
    if (moved > 4) return; // was a pan, not a click
    var rect = canvas.getBoundingClientRect();
    var p = screenToGraph(event.clientX - rect.left, event.clientY - rect.top);
    var n = findNodeAt(p[0], p[1]);
    if (n) selectNode(n);
  });

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
  // Pharmacy-themed node shapes: major classes render as a rounded "pharmacy
  // cross" badge; subclasses render as a small two-tone capsule/pill — both
  // drawn directly in canvas space so they still scale cleanly with zoom.
  function roundRectPath(x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawHubBadge(cx, cy, r, color, dim) {
    var s = r; // half-size of the badge square
    var rad = r * 0.32;
    ctx.beginPath();
    roundRectPath(cx - s, cy - s, s * 2, s * 2, rad);
    ctx.fillStyle = dim ? dimColor(color) : color;
    ctx.fill();
    ctx.lineWidth = 1.3 / transform.k;
    ctx.strokeStyle = dim ? "rgba(236,227,232,0.14)" : "rgba(236,227,232,0.6)";
    ctx.stroke();
    var armW = s * 0.56, armL = s * 1.5;
    ctx.fillStyle = dim ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.94)";
    ctx.fillRect(cx - armW / 2, cy - armL / 2, armW, armL);
    ctx.fillRect(cx - armL / 2, cy - armW / 2, armL, armW);
  }

  function drawClassPill(cx, cy, r, color, dim) {
    var w = r * 2.3, h = r * 1.3;
    var rad = h / 2;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + rad, cy - rad);
    ctx.lineTo(cx + w / 2 - rad, cy - rad);
    ctx.arc(cx + w / 2 - rad, cy, rad, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(cx - w / 2 + rad, cy + rad);
    ctx.arc(cx - w / 2 + rad, cy, rad, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
    ctx.fillStyle = dim ? dimColor(color) : color;
    ctx.fill();
    ctx.lineWidth = 1 / transform.k;
    ctx.strokeStyle = dim ? "rgba(236,227,232,0.10)" : "rgba(236,227,232,0.45)";
    ctx.stroke();
    // lighter left half + center divide line — classic capsule look
    ctx.save();
    ctx.clip();
    ctx.fillStyle = dim ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.30)";
    ctx.fillRect(cx - w / 2 - 1, cy - rad - 1, w / 2 + 1, h + 2);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(cx, cy - rad);
    ctx.lineTo(cx, cy + rad);
    ctx.lineWidth = 1 / transform.k;
    ctx.strokeStyle = dim ? "rgba(10,10,10,0.12)" : "rgba(10,10,10,0.3)";
    ctx.stroke();
  }

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
      ctx.strokeStyle = dim ? "rgba(150,120,140,0.10)" : "rgba(189,168,184,0.38)";
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
      if (n.type === "hub") {
        drawHubBadge(n.x, n.y, n.r, n.color, dim);
      } else {
        drawClassPill(n.x, n.y, n.r, n.color, dim);
      }
      if (isActive || isSearchHit) {
        ctx.lineWidth = 2 / transform.k;
        ctx.strokeStyle = "#e7e9ec";
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 5 / transform.k, 0, Math.PI * 2);
        ctx.stroke();
      }

      var wantLabel = isActive || isNeighbor || isSearchHit ||
        (n.type === "hub" && transform.k > 0.22) ||
        (n.type === "class" && transform.k > 0.88);
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
    var fontPx = isHub ? 12 : 9.5;
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

    ctx.fillStyle = "rgba(26,18,25,0.78)";
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
        chip.innerHTML = '<span class="chip-dot" style="background:' + kn.color + '"></span>' +
          escapeHtml(kn.label) + (kn.type === "class" ? " (" + kn.drugCount + ")" : "");
        chip.style.borderColor = kn.color + "55";
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
      c.drugs.forEach(function (d, idx) { items.push({ classId: cid, className: c.title, classColor: nodesById[cid].color, drug: d, idx: idx }); });
    });
    panelBody.innerHTML = "";
    if (!items.length) {
      panelBody.innerHTML = '<div class="empty-msg">No generics directly under this node. Pick a subgroup above.</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    items.forEach(function (item) {
      frag.appendChild(buildDrugCard(item.drug, item.className, item.classColor));
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
    ["storage", "Storage"]
  ];

  function buildDrugCard(d, classLabel, classColor) {
    var card = document.createElement("div");
    card.className = "drug-card";
    var head = document.createElement("div");
    head.className = "drug-card-head";
    head.innerHTML =
      '<div><div class="dc-name">' + escapeHtml(d.generic) + '</div>' +
      (classLabel ? '<div class="dc-classtag" style="' + (classColor ? "color:" + classColor + ";" : "") + '">' +
        (classColor ? '<span class="dc-classdot" style="background:' + classColor + '"></span>' : "") +
        escapeHtml(classLabel) + '</div>' : '') +
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
      html += '<div class="brand-table-scroll"><table class="brand-table"><thead><tr><th>Brand</th><th>Form</th><th>Strength</th><th>Manufacturer</th></tr></thead><tbody>';
      d.brands.forEach(function (b) {
        html += "<tr><td class=\"b-brand\">" + escapeHtml(b.brand) + "</td><td>" + escapeHtml(b.form || "N/A") +
          "</td><td class=\"b-strength\">" + escapeHtml(b.strength || "N/A") + "</td><td>" + escapeHtml(b.manufacturer || "N/A") + "</td></tr>";
      });
      html += "</tbody></table></div>";
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
    ["#d4a017", "Antifungal"],
    ["#7209b7", "Antiviral"],
    ["#4361ee", "Diagnostics & Antidotes"],
    ["#f72585", "NSAIDs & Anti-Rheumatics"],
    ["#ff6b35", "Anti-Diabetes"],
    ["#9d4edd", "Anticancer"],
    ["#588157", "Antihelminthic"],
    ["#ffd60a", "Antihistamines"],
    ["#457b9d", "Antihypertensive (Misc.)"],
    ["#bc6c25", "Antimalarial"],
    ["#06d6a0", "Antiprotozoal"],
    ["#ef476f", "Opioids"],
    ["#118ab2", "Vaccines"]
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
  /*  Header stats + interaction button stub                          */
  /* ---------------------------------------------------------------- */
  document.getElementById("stat-pill").textContent =
    VAULT_DATA.stats.genericDrugs.toLocaleString() + " generics · " +
    VAULT_DATA.stats.brandEntries.toLocaleString() + " brands · " +
    VAULT_DATA.stats.classFiles + " classes";

  document.getElementById("interaction-btn").addEventListener("click", function () {
    var engine = window.PharmaGrid._interactionEngine;
    if (!engine) return; // disabled attr already blocks this, kept as a safety net
    alert("Interaction engine registered. Build the picker UI here.");
  });

  /* ---------------------------------------------------------------- */
  /*  Sidebar — text/outline browser (the non-graph route)            */
  /* ---------------------------------------------------------------- */
  var sidebar = document.getElementById("sidebar");
  var sidebarTree = document.getElementById("sidebar-tree");

  function makeRow(label, hasChildren, showOpenIcon, color) {
    var row = document.createElement("div");
    row.className = "tree-row" + (showOpenIcon ? " tree-row-class" : "");
    row.innerHTML =
      (hasChildren ? '<span class="tree-chev">&#9656;</span>' : '<span class="tree-chev tree-chev-blank"></span>') +
      (color ? '<span class="tree-dot" style="background:' + color + '"></span>' : "") +
      '<span class="tree-label">' + escapeHtml(label) + "</span>" +
      (showOpenIcon ? '<span class="tree-open" title="Open full view">&#10530;</span>' : "");
    return row;
  }

  function buildHubNode(id, ancestry) {
    var n = nodesById[id];
    var li = document.createElement("li");
    var kids = (childrenOf[id] || []).filter(function (k) { return ancestry.indexOf(k) === -1; });
    var row = makeRow(n.label, kids.length > 0, true, n.color);
    li.appendChild(row);
    // chevron AND label both drill down into the tree (folder-style) — this
    // is how you browse from "Organ Systems" down to "CVS" down to
    // "ACE Inhibitors" without leaving the sidebar. The small open icon is
    // the shortcut straight to this hub's own full-page overview.
    row.querySelector(".tree-open").addEventListener("click", function (e) {
      e.stopPropagation();
      selectNode(n);
    });
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
        li.classList.toggle("tree-open-state");
      });
    }
    return li;
  }

  function buildClassNode(id) {
    var n = nodesById[id];
    var c = VAULT_DATA.classes[id];
    var li = document.createElement("li");
    var row = makeRow(n.label + " (" + c.drugs.length + ")", c.drugs.length > 0, true, n.color);
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

  var mmZoomBehavior, mmSvgSel, mmG;

  function fitMindmapToScreen(instant) {
    if (!mmG) return;
    var wrap = document.getElementById("mindmap-wrap");
    var rect = wrap.getBoundingClientRect();
    var w = rect.width, h = rect.height;
    var bbox = mmG.node().getBBox();
    if (!bbox.width || !bbox.height) return;
    var margin = 30;
    var scaleX = (w - margin * 2) / bbox.width;
    var scaleY = (h - margin * 2) / bbox.height;
    var scale;
    if (h > w) {
      // portrait / phone: the tree is wider than it is tall, so fitting
      // both axes leaves huge empty bands above and below and everything
      // reads as tiny. Fit to width instead and let height pan/scroll —
      // same trade-off a map app makes, and it keeps node/label size
      // consistent with the desktop view instead of shrinking further.
      scale = scaleX;
    } else {
      scale = Math.min(scaleX, scaleY);
    }
    scale = Math.max(0.15, Math.min(scale, 1.4)); // never blow it up huge on large desktop screens
    var cx = bbox.x + bbox.width / 2;
    var cy = bbox.y + bbox.height / 2;
    var t = d3.zoomIdentity.translate(w / 2 - cx * scale, h / 2 - cy * scale).scale(scale);
    if (instant) mmSvgSel.call(mmZoomBehavior.transform, t);
    else mmSvgSel.transition().duration(300).call(mmZoomBehavior.transform, t);
  }

  function buildMindmap() {
    if (mindmapBuilt) return;
    mindmapBuilt = true;

    // Fixed layout radius, independent of screen size — this is what keeps
    // the mind map's internal proportions (node spacing, label room)
    // identical on a phone and on a laptop. The *whole* tree is then
    // scaled as one unit to fit whatever viewport it's shown on, via
    // fitMindmapToScreen() below, instead of squeezing the layout itself
    // into a tiny radius on narrow screens (which is what was causing the
    // cramped/cluttered look on mobile).
    var radius = 340;

    var root = d3.hierarchy(buildMindmapHierarchy("Home"));
    var treeLayout = d3.tree()
      .size([2 * Math.PI, radius])
      .separation(function (a, b) { return (a.parent === b.parent ? 1.4 : 2.2) / Math.max(a.depth, 1); });
    treeLayout(root);

    var svg = d3.select("#mindmap-svg");
    svg.selectAll("*").remove();
    var g = svg.append("g");
    mmG = g;
    mmSvgSel = svg;

    mmZoomBehavior = d3.zoom().scaleExtent([0.15, 4]).on("zoom", function (event) {
      g.attr("transform", event.transform);
    }).on("start", function () { svg.classed("grabbing", true); })
      .on("end", function () { svg.classed("grabbing", false); });
    svg.call(mmZoomBehavior);

    var linkGen = d3.linkRadial().angle(function (d) { return d.x; }).radius(function (d) { return d.y; });

    g.append("g").attr("fill", "none").attr("stroke", "#4a3650").attr("stroke-width", 1.3)
      .selectAll("path").data(root.links()).join("path").attr("d", linkGen);

    // Node badges — a rounded "pharmacy cross" square — are appended to the
    // un-rotated container with plain cartesian math (same reasoning as the
    // labels below): keeps every badge upright regardless of which spoke
    // angle it sits on, instead of tumbling to match the spoke rotation.
    function cartX(d) { return d.depth === 0 ? 0 : d.y * Math.cos(d.x - Math.PI / 2); }
    function cartY(d) { return d.depth === 0 ? 0 : d.y * Math.sin(d.x - Math.PI / 2); }

    var badge = g.append("g").selectAll("g").data(root.descendants()).join("g")
      .attr("transform", function (d) { return "translate(" + cartX(d) + "," + cartY(d) + ")"; })
      .style("cursor", "pointer")
      .on("click", function (event, d) { selectNode(nodesById[d.data.id]); });

    badge.each(function (d) {
      var s = d.depth === 0 ? 9 : 6.5;
      var rad = s * 0.32;
      var b = d3.select(this);
      b.append("rect")
        .attr("x", -s).attr("y", -s).attr("width", s * 2).attr("height", s * 2).attr("rx", rad)
        .attr("fill", d.data.color).attr("stroke", "rgba(230,233,236,.55)").attr("stroke-width", 1.2);
      var armW = s * 0.56, armL = s * 1.5;
      b.append("rect").attr("x", -armW / 2).attr("y", -armL / 2).attr("width", armW).attr("height", armL).attr("fill", "rgba(255,255,255,.94)");
      b.append("rect").attr("x", -armL / 2).attr("y", -armW / 2).attr("width", armL).attr("height", armW).attr("fill", "rgba(255,255,255,.94)");
    });

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
      .style("stroke", "#1a1219").style("stroke-width", "4px").style("stroke-linejoin", "round");

    // fit the whole tree to whatever screen this is (phone or desktop) —
    // requestAnimationFrame so getBBox() reads real, laid-out text metrics
    requestAnimationFrame(function () { fitMindmapToScreen(true); });
  }

  /* ---------------------------------------------------------------- */
  /*  View toggle — Graph / Mind Map / Reference                       */
  /* ---------------------------------------------------------------- */
  var mainEl = document.querySelector("main");
  var mindmapWrap = document.getElementById("mindmap-wrap");
  var referenceWrap = document.getElementById("reference-wrap");
  var viewGraphBtn = document.getElementById("view-graph-btn");
  var viewMindmapBtn = document.getElementById("view-mindmap-btn");
  var viewReferenceBtn = document.getElementById("view-reference-btn");

  function deactivateAllViews() {
    viewGraphBtn.classList.remove("active");
    viewMindmapBtn.classList.remove("active");
    viewReferenceBtn.classList.remove("active");
    mainEl.classList.remove("mode-mindmap");
    mainEl.classList.remove("mode-reference");
    mindmapWrap.classList.remove("active");
    referenceWrap.classList.remove("active");
  }

  viewGraphBtn.addEventListener("click", function () {
    deactivateAllViews();
    viewGraphBtn.classList.add("active");
    resize();
  });
  viewMindmapBtn.addEventListener("click", function () {
    deactivateAllViews();
    viewMindmapBtn.classList.add("active");
    mainEl.classList.add("mode-mindmap");
    mindmapWrap.classList.add("active");
    var alreadyBuilt = mindmapBuilt;
    buildMindmap();
    // if the window/orientation changed since it was last built, re-fit now
    if (alreadyBuilt) requestAnimationFrame(function () { fitMindmapToScreen(true); });
  });
  viewReferenceBtn.addEventListener("click", function () {
    deactivateAllViews();
    viewReferenceBtn.classList.add("active");
    mainEl.classList.add("mode-reference");
    referenceWrap.classList.add("active");
    if (window.buildReferenceSection) window.buildReferenceSection();
  });

  window.addEventListener("resize", function () {
    if (mindmapWrap.classList.contains("active")) fitMindmapToScreen(false);
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

  function fitGraphToScreen(instant) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(function (n) {
      if (n.x - n.r < minX) minX = n.x - n.r;
      if (n.x + n.r > maxX) maxX = n.x + n.r;
      if (n.y - n.r < minY) minY = n.y - n.r;
      if (n.y + n.r > maxY) maxY = n.y + n.r;
    });
    var bw = maxX - minX, bh = maxY - minY;
    if (!bw || !bh) return;
    var margin = 60;
    var scale = Math.min((width - margin * 2) / bw, (height - margin * 2) / bh);
    scale = Math.max(0.08, Math.min(scale, 1.2));
    var cx = minX + bw / 2, cy = minY + bh / 2;
    var t = d3.zoomIdentity.translate(width / 2 - cx * scale, height / 2 - cy * scale).scale(scale);
    if (instant) d3.select(canvas).call(zoomBehavior.transform, t);
    else d3.select(canvas).transition().duration(300).call(zoomBehavior.transform, t);
  }

  /* ---------------------------------------------------------------- */
  /*  Boot                                                             */
  /* ---------------------------------------------------------------- */
  resize();
  fitGraphToScreen(true);

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

