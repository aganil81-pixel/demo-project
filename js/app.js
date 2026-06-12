/** CommLoan HTML Prototype — shared app logic */

const STORAGE_KEY = "commloan_prototype";
const LOGIN_GATED_URL_PATTERN = /linkedin\.com|login|auth/i;

const AppState = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  },
  set(partial) {
    const next = { ...this.get(), ...partial };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  },
  clear() {
    localStorage.removeItem(STORAGE_KEY);
  },
  getMode() {
    return this.get().mode || null;
  },
  setMode(mode) {
    return this.set({ mode, brokers: null, extracted: null, previewApproved: false, processingComplete: false });
  },
  isDemo() {
    return !!this.get().demoEntered;
  },
  enterDemo() {
    return this.set({ demoEntered: true });
  },
  getInputType() {
    return this.get().inputType || "excel";
  },
  setInputType(type) {
    return this.set({ inputType: type });
  },
  getBrokers() {
    const state = this.get();
    if (state.brokers && state.brokers.length) return state.brokers;
    return loadBrokersForMode();
  },
  setBrokers(brokers) {
    return this.set({ brokers });
  },
  getExtracted() {
    const state = this.get();
    if (state.extracted && state.extracted.length) return state.extracted;
    return getDefaultExtracted();
  },
  setExtracted(rows) {
    return this.set({ extracted: rows, previewApproved: false });
  },
  isPreviewApproved() {
    return !!this.get().previewApproved;
  },
  setPreviewApproved(val) {
    return this.set({ previewApproved: val });
  },
  getProcessingComplete() {
    return !!this.get().processingComplete;
  },
  setProcessingComplete(val) {
    return this.set({ processingComplete: val });
  },
};

function withCrmFields(broker) {
  return {
    ...broker,
    leadSource: broker.leadSource || CRM_PLACEHOLDER,
    fundedVolume: broker.fundedVolume || CRM_PLACEHOLDER,
    appraisalVolume: broker.appraisalVolume || CRM_PLACEHOLDER,
  };
}

function getDefaultExtracted() {
  if (isP2()) {
    const inputType = AppState.getInputType();
    if (inputType === "excel") return EXTRACTED_PROSPECTS_EXCEL || EXTRACTED_PROSPECTS;
    return EXTRACTED_PROSPECTS;
  }
  return EXTRACTED_BROKERS;
}

function getRawBrokersForMode() {
  return isP2() ? PROSPECTS_RAW : BROKERS_RAW.map(withCrmFields);
}

function toBrokerId(extractedId) {
  if (typeof extractedId === "string" && extractedId.startsWith("ext-")) {
    return "brk-" + extractedId.slice(4);
  }
  return extractedId;
}

function getExtractedBrokerIdSet(extractedRows) {
  return new Set(extractedRows.map((r) => toBrokerId(r.id)));
}

function loadBrokersForMode() {
  const raw = getRawBrokersForMode();
  const extractedIds = getExtractedBrokerIdSet(AppState.getExtracted());
  const filtered = extractedIds.size
    ? raw.filter((b) => extractedIds.has(b.id))
    : raw;
  return enrichAllBrokers(filtered.map((b) => (isP2() ? b : withCrmFields(b))));
}

function approvePreviewAndLoadBrokers() {
  const extracted = AppState.getExtracted();
  const raw = getRawBrokersForMode();
  const idSet = getExtractedBrokerIdSet(extracted);
  const brokers = enrichAllBrokers(
    raw.filter((b) => idSet.has(b.id)).map((b) => (isP2() ? b : withCrmFields(b)))
  );
  AppState.setBrokers(brokers);
  AppState.setPreviewApproved(true);
  return brokers;
}

function requireDemo() {
  if (!AppState.isDemo()) {
    window.location.href = "index.html";
    return false;
  }
  return true;
}

function requireMode() {
  if (!AppState.getMode()) {
    window.location.href = "index.html";
    return false;
  }
  return true;
}

function isP2() {
  return AppState.getMode() === "p2";
}

function modeLabel() {
  return isP2() ? "P2 — Prospect & Score" : "P1 — Verify & Enrich";
}

const CONTACT_SENTINEL_PATTERN = /not publicly listed|unverified|not publicly disclosed|^unknown$/i;

function isContactSentinel(value) {
  const s = String(value == null ? "" : value).trim();
  return !s || CONTACT_SENTINEL_PATTERN.test(s);
}

function maskSeedHash(seed, field) {
  const str = String(seed || "") + ":" + field;
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const MASK_WORDS = [
  "lara", "lamsam", "kven", "mshra", "brtn", "lee", "elna", "vasq", "marc", "whtf",
  "tmas", "wrgt", "drek", "wlsn", "fona", "oknk", "greg", "tanb", "hann", "prce",
  "ian", "coop", "jlia", "park", "kevn", "mrsh", "cbre", "jll", "nmrk", "berk",
];

function scrambleToken(seed, field) {
  const h = maskSeedHash(seed, field);
  const w1 = MASK_WORDS[h % MASK_WORDS.length];
  const w2 = MASK_WORDS[(h >> 4) % MASK_WORDS.length];
  return w1 + " " + w2;
}

function maskContactText(value, seed, field) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return "Not publicly listed";
  if (isContactSentinel(s)) return s;
  return scrambleToken(seed, field || "contact");
}

function maskContactEmail(email, seed) {
  const s = String(email == null ? "" : email).trim();
  if (!s) return "Not publicly listed";
  if (isContactSentinel(s)) return s;
  const token = scrambleToken(seed, "email").replace(/\s+/g, "");
  return token + "@enc";
}

function maskContactPhone(phone, seed) {
  const s = String(phone == null ? "" : phone).trim();
  if (!s) return "Not publicly listed";
  if (isContactSentinel(s)) return s;
  const parts = scrambleToken(seed, "phone").split(" ");
  return "(•••) " + parts[0] + "-" + parts[1];
}

function maskLinkedIn(url, seed) {
  const s = String(url == null ? "" : url).trim();
  if (!s) return "Not publicly listed";
  if (isContactSentinel(s)) return s;
  if (!s.toLowerCase().startsWith("http")) return s;
  const token = scrambleToken(seed, "linkedin").replace(/\s+/g, "-");
  return "linkedin.com/in/" + token;
}

function formatMaskedEmailHtml(email, seed) {
  return `<span class="text-muted">${maskContactEmail(email, seed)}</span>`;
}

function formatMaskedLinkedInHtml(url, seed) {
  return `<span class="text-muted">${maskLinkedIn(url, seed)}</span>`;
}

function formatEvidenceSourceHtml(source, seed) {
  const url = source.url || "";
  if (/linkedin\.com\/in\//i.test(url)) {
    return `${source.label} <span class="badge badge-low">Tier ${source.tier}</span>`;
  }
  return `<a href="${url}" target="_blank" rel="noopener">${source.label}</a> <span class="badge badge-low">Tier ${source.tier}</span>`;
}

function formatEvidenceSourcesForExport(sources, seed) {
  return (sources || []).map((s) => {
    if (/linkedin\.com\/in\//i.test(s.url || "")) {
      return s.label + " (" + maskLinkedIn(s.url, seed) + ")";
    }
    return s.label + " (" + s.url + ")";
  }).join("; ");
}

function truncateText(text, maxLen) {
  const s = String(text == null ? "" : text);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

function renderHeader(activePage) {
  const el = document.getElementById("site-header");
  if (!el) return;

  const mode = AppState.getMode();
  const nav = [];

  if (mode) {
    nav.push({ href: "input.html", label: "Input" });
    nav.push({ href: "results.html", label: "Results" });
    nav.push({ href: "dashboard.html", label: "Dashboard" });
  }

  el.innerHTML = `
    <a href="index.html" class="logo">
      <span class="logo-icon">CL</span>
      CommLoan Broker Intelligence
    </a>
    <div class="header-nav">
      ${mode ? `<span class="mode-pill">${modeLabel()}</span>` : ""}
      ${nav.map((n) => `<a href="${n.href}" class="btn btn-ghost btn-sm">${n.label}</a>`).join("")}
      ${AppState.isDemo() ? `<button class="btn btn-ghost btn-sm" onclick="AppState.clear();location.href='index.html'">Reset Demo</button>` : ""}
    </div>
  `;
}

function statusBadge(status) {
  const map = {
    Complete: "badge-complete",
    Partial: "badge-partial",
    "Review Required": "badge-review",
    "No Match": "badge-low",
  };
  return `<span class="badge ${map[status] || "badge-low"}">${status}</span>`;
}

function activityBadge(level) {
  const map = { High: "badge-high", Medium: "badge-medium", Low: "badge-low", Unknown: "badge-low" };
  return `<span class="badge ${map[level] || "badge-low"}">${level}</span>`;
}

function confidenceBadge(conf) {
  const map = { High: "badge-high", Medium: "badge-medium", Low: "badge-low" };
  return `<span class="badge ${map[conf] || "badge-low"}">${conf}</span>`;
}

function getBrokerById(id) {
  return AppState.getBrokers().find((b) => b.id === id);
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function csvEscape(val) {
  const s = String(val == null ? "" : val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function exportCSV() {
  const brokers = AppState.getBrokers();
  const p2 = isP2();
  const headers = [
    "Name", "Company", "State", "Last Employer", "CRE Status", "Years CRE", "Volume 2025",
    "Email", "Phone", "LinkedIn", "Activity", "Deal Signals", "Affiliations", "Personalization",
    "Confidence", "Status",
  ];
  if (!p2) {
    headers.push("Lead Source", "Funded Volume", "Appraisal Volume");
  }
  if (p2) headers.push("Score", "Priority Tier", "Score Breakdown");

  const rows = brokers.map((b) => {
    const base = [
      b.name, b.company, b.state, b.lastEmployer, b.onlyCreMortgage, b.yearsInCre, b.volume2025,
      maskContactEmail(b.email, b.id), maskContactPhone(b.phone, b.id), maskLinkedIn(b.linkedin, b.id),
      b.activityLevel, b.dealSignals, b.affiliations, b.personalizationHook,
      b.confidence, b.rowStatus,
    ];
    if (!p2) base.push(b.leadSource, b.fundedVolume, b.appraisalVolume);
    if (p2) base.push(b.score, b.priorityTier, JSON.stringify(b.scoreBreakdown || {}));
    return base.map(csvEscape).join(",");
  });

  downloadFile("commloan-brokers-export.csv", [headers.join(","), ...rows].join("\n"), "text/csv");
}

function exportResearchPack() {
  const brokers = AppState.getBrokers();
  const p2 = isP2();
  const content = brokers.map((b) => {
    const lines = [
      `=== ${b.name} | ${b.company} ===`,
      `State: ${b.state} | Status: ${b.rowStatus} | Confidence: ${b.confidence}`,
      `Email: ${maskContactEmail(b.email, b.id)} | Phone: ${maskContactPhone(b.phone, b.id)}`,
      `Last Employer: ${b.lastEmployer} | Only CRE: ${b.onlyCreMortgage} | Years: ${b.yearsInCre}`,
      `Volume 2025: ${b.volume2025} | Activity: ${b.activityLevel}`,
      `Deal Signals: ${b.dealSignals}`,
      `Personalization: ${b.personalizationHook}`,
      `Evidence: ${b.evidenceNotes}`,
      `Sources: ${formatEvidenceSourcesForExport(b.evidenceSources, b.id)}`,
    ];
    if (!p2) {
      lines.push(`Lead Source: ${b.leadSource} | Funded Volume: ${b.fundedVolume} | Appraisal Volume: ${b.appraisalVolume}`);
    }
    if (p2) {
      lines.push(`Score: ${b.score} | Tier: ${b.priorityTier}`);
      lines.push(`Score Breakdown: ${JSON.stringify(b.scoreBreakdown || {})}`);
    }
    return lines.join("\n");
  }).join("\n---\n");

  downloadFile(p2 ? "commloan-research-pack-p2.json" : "commloan-research-pack.txt", content.trim(), "text/plain");
}

function exportDashboardSummary() {
  const brokers = AppState.getBrokers();
  const p2 = isP2();
  const statuses = {};
  brokers.forEach((b) => { statuses[b.rowStatus] = (statuses[b.rowStatus] || 0) + 1; });

  let content = `CommLoan Broker Intelligence — Dashboard Export
Generated: ${new Date().toLocaleString()}
Mode: ${modeLabel()}

Total Brokers: ${brokers.length}
`;

  Object.entries(statuses).forEach(([k, v]) => {
    content += `${k}: ${v}\n`;
  });

  if (p2) {
    const tiers = { Priority: 0, Nurture: 0, "Low Priority": 0 };
    brokers.forEach((b) => { if (b.priorityTier) tiers[b.priorityTier]++; });
    const avg = brokers.reduce((s, b) => s + (b.score || 0), 0) / brokers.length;
    content += `\nAverage Score: ${avg.toFixed(1)}
Priority: ${tiers.Priority} | Nurture: ${tiers.Nurture} | Low Priority: ${tiers["Low Priority"]}

Top 10 by Score:
${brokers.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 10).map((b, i) => `${i + 1}. ${b.name} — ${b.score} (${b.priorityTier})`).join("\n")}
`;
  }

  downloadFile("commloan-dashboard-export.txt", content, "text/plain");
}

function isLoginGatedUrl(url) {
  return LOGIN_GATED_URL_PATTERN.test(url || "");
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function initTabs(container) {
  const tabs = container.querySelectorAll(".tab");
  const panels = container.querySelectorAll(".tab-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.classList.contains("disabled")) return;
      const target = tab.dataset.tab;
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === target));
      panels.forEach((p) => p.classList.toggle("active", p.id === target));
    });
  });
}

function sortBrokers(brokers, key, dir) {
  const mult = dir === "desc" ? -1 : 1;
  return [...brokers].sort((a, b) => {
    let av = a[key];
    let bv = b[key];
    if (key === "score") {
      av = a.score || 0;
      bv = b.score || 0;
      return (av - bv) * mult;
    }
    av = String(av || "").toLowerCase();
    bv = String(bv || "").toLowerCase();
    if (av < bv) return -1 * mult;
    if (av > bv) return 1 * mult;
    return 0;
  });
}
