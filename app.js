const API_URL =
  "https://script.google.com/macros/s/AKfycbyS6pIwrdEF0N6OA2rxGhX1rYtYqwQlxGMXrs5N1Da4SKNqcjly3vCqv3PiQXR9xAtHFg/exec";

const UNITS = {
  PA_SAO_PEDRO: "PA São Pedro",
  PA_PRAIA_SUA: "PA Praia do Suá",
};

const STOCKS = {
  RBE: "Estoque RBE",
  AGIR: "Estoque AGIR",
};

const store = {
  // ✅ COMEÇA EM BRANCO (OBRIGA SELECIONAR NO RELATÓRIO)
  // Pode ser: null | "PA_SAO_PEDRO" | "PA_PRAIA_SUA" | "ALL"
  currentUnit: null,

  // Pode ser: "RBE" | "AGIR" | "ALL"
  currentStock: "ALL",

  snapshot: [],
  viewCache: {
    PA_SAO_PEDRO: { RBE: [], AGIR: [] },
    PA_PRAIA_SUA: { RBE: [], AGIR: [] },
  },

  // ✅ agora preenchido pelo SERVIDOR (listar_meta)
  meta: {
    PA_SAO_PEDRO: {
      RBE: { lastUpdate: null, lastFile: null, lastCount: 0 },
      AGIR: { lastUpdate: null, lastFile: null, lastCount: 0 },
    },
    PA_PRAIA_SUA: {
      RBE: { lastUpdate: null, lastFile: null, lastCount: 0 },
      AGIR: { lastUpdate: null, lastFile: null, lastCount: 0 },
    },
  },
};

const state = {
  query: "",
  onlySelected: false,
  selectedIds: new Set(),
  sort: "qt_desc",
  consumoFilter: "TODOS",
};

function $(id) { return document.getElementById(id); }
function on(el, evt, fn) { if (el) el.addEventListener(evt, fn); }

const btnExportCsv = $("btnExportCsv");
const btnResetFilters = $("btnResetFilters");

const unitTabs = Array.from(document.querySelectorAll("[data-unit]"));
const stockTabs = Array.from(document.querySelectorAll("[data-stock]"));

const panelRBE = $("panelRBE");
const panelAGIR = $("panelAGIR");

const fileRBE = $("fileRBE");
const fileAGIR = $("fileAGIR");
const btnUploadRBE = $("btnUploadRBE");
const btnUploadAGIR = $("btnUploadAGIR");
const btnClearRBE = $("btnClearRBE");
const btnClearAGIR = $("btnClearAGIR");

const rbeLastUpdate = $("rbeLastUpdate");
const rbeLastFile = $("rbeLastFile");
const rbeLastCount = $("rbeLastCount");
const agirLastUpdate = $("agirLastUpdate");
const agirLastFile = $("agirLastFile");
const agirLastCount = $("agirLastCount");

const elList = $("itemsList");
const elTable = $("tableBody");
const elSearch = $("searchInput");
const elOnlySelected = $("onlySelected");
const elSelectedCount = $("selectedCount");
const elRowCount = $("rowCount");
const elTotalStock = $("totalStock");
const elSort = $("sortSelect");
const viewHint = $("viewHint");

const consumoFilterWrap = $("consumoFilterWrap");
const consumoFilter = $("consumoFilter");

const HAS_IMPORT_UI = !!(btnUploadRBE || btnUploadAGIR || fileRBE || fileAGIR);
const HAS_REPORT_UI = !!(elList || elTable || $("pieChart") || btnExportCsv || btnResetFilters);

// =====================================================
// PIN (IMPORTAÇÃO) - SOLICITA SEMPRE AO ABRIR importacao.html
// =====================================================
let __IMPORT_PIN__ = "";

function isImportPage_() {
  const p = (location.pathname || "").toLowerCase();
  return p.includes("importacao.html");
}

async function ensureImportPinOrRedirect_() {
  const pin = prompt("Acesso restrito: informe o PIN de importação:");
  if (!pin) {
    location.href = "index.html";
    return false;
  }

  try {
    await apiPost({ acao: "validar_pin", auth: String(pin).trim() }, { skipAutoAuth: true });
  } catch (err) {
    alert("PIN inválido.");
    location.href = "index.html";
    return false;
  }

  __IMPORT_PIN__ = String(pin).trim();
  return true;
}

function getImportPin_() {
  return __IMPORT_PIN__ || "";
}

// =====================
// Utils
// =====================
function nowBR() {
  const d = new Date();
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);
}
function formatInt(n) { return new Intl.NumberFormat("pt-BR").format(n); }

function normalize(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseNumberBR(value) {
  if (value === null || value === undefined) return NaN;
  if (typeof value === "number") return value;

  let s = String(value).trim().toLowerCase();
  if (!s) return NaN;

  s = s.replace(/\s+/g, "");
  s = s.replace(/r\$/g, "");
  s = s.replace(/[^\d,.\-]/g, "");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      s = s.replaceAll(".", "").replaceAll(",", ".");
    } else {
      s = s.replaceAll(",", "");
    }
  } else if (lastComma > -1) {
    s = s.replaceAll(".", "").replaceAll(",", ".");
  } else {
    s = s.replaceAll(",", ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// ✅ AGIR: inteiro “exato” (240,00 -> 240)
function parseQtyAGIR(val) {
  const n = parseNumberBR(val);
  if (!Number.isFinite(n)) return NaN;
  return Math.trunc(n);
}

// =====================================================
// CSV parser manual (detecta delimitador ; ou ,)
// =====================================================
function stripBom_(text) {
  if (!text) return text;
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function detectCsvDelimiter_(line) {
  const sc = (line.match(/;/g) || []).length;
  const cc = (line.match(/,/g) || []).length;
  return sc >= cc ? ";" : ",";
}

function parseCsvToRows_(text) {
  text = stripBom_(text);
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== "");
  if (!lines.length) return [];

  const delim = detectCsvDelimiter_(lines[0]);

  const rows = [];
  for (const line of lines) {
    const row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === delim && !inQuotes) {
        row.push(cur);
        cur = "";
        continue;
      }

      cur += ch;
    }
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

// ---------- LocalStorage (somente última visão; meta agora vem do servidor) ----------
const LS_VIEW_KEY = "sigea_view_v3";

function loadLocal() {
  try {
    const view = JSON.parse(localStorage.getItem(LS_VIEW_KEY) || "null");
    // ✅ NÃO restaura unidade automaticamente (obriga selecionar sempre)
    // if (view?.unit) store.currentUnit = view.unit;

    if (view?.stock) store.currentStock = view.stock;
  } catch (_) {}
}

function saveLocal() {
  try {
    localStorage.setItem(LS_VIEW_KEY, JSON.stringify({ unit: store.currentUnit, stock: store.currentStock }));
  } catch (_) {}
}

// ✅ render meta na tela de importação (vem do store.meta, que agora é do servidor)
function renderMeta() {
  if (!HAS_IMPORT_UI) return;
  if (!store.currentUnit || store.currentUnit === "ALL") return;

  const bRBE = store.meta[store.currentUnit].RBE;
  const bAGIR = store.meta[store.currentUnit].AGIR;

  if (rbeLastUpdate) rbeLastUpdate.textContent = bRBE.lastUpdate || "—";
  if (rbeLastFile) rbeLastFile.textContent = bRBE.lastFile || "—";
  if (rbeLastCount) rbeLastCount.textContent = String(bRBE.lastCount || 0);

  if (agirLastUpdate) agirLastUpdate.textContent = bAGIR.lastUpdate || "—";
  if (agirLastFile) agirLastFile.textContent = bAGIR.lastFile || "—";
  if (agirLastCount) agirLastCount.textContent = String(bAGIR.lastCount || 0);
}

// ---------- Tabs ----------
function setActiveUnit(unitKey) {
  store.currentUnit = unitKey;
  unitTabs.forEach((t) => t.classList.toggle("is-active", t.dataset.unit === unitKey));

  resetSelectionsOnly();
  saveLocal();
  syncDataAndUI();
}

function setActiveStock(stockKey) {
  store.currentStock = stockKey;
  stockTabs.forEach((t) => t.classList.toggle("is-active", t.dataset.stock === stockKey));

  if (panelRBE) panelRBE.classList.toggle("is-active", stockKey === "RBE");
  if (panelAGIR) panelAGIR.classList.toggle("is-active", stockKey === "AGIR");

  // ✅ consumo aparece no RBE e em ALL
  const show = (stockKey === "RBE" || stockKey === "ALL");
  if (consumoFilterWrap) consumoFilterWrap.style.display = show ? "block" : "none";

  if (!show && consumoFilter) {
    state.consumoFilter = "TODOS";
    consumoFilter.value = "TODOS";
  }

  resetSelectionsOnly();
  saveLocal();
  syncDataAndUI();
}

unitTabs.forEach((btn) => on(btn, "click", () => setActiveUnit(btn.dataset.unit)));
stockTabs.forEach((btn) => on(btn, "click", () => setActiveStock(btn.dataset.stock)));

// ---------- Leitura de arquivo ----------
async function readFirstSheetAsRows(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (ext === "csv") {
    const text = await file.text();
    return parseCsvToRows_(text);
  }

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

// =====================================================
// PARSER RBE (SÓ LINHA TOTAL)
// =====================================================
function parseRBE_CodDescQt(rows) {
  const norm = (s) =>
    (s ?? "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 120); i++) {
    const t = (rows[i] || []).map(norm).join(" | ");
    if (
      t.includes("codigo") &&
      (t.includes("medicamento") || t.includes("descricao") || t.includes("descrição")) &&
      t.includes("quantidade")
    ) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) throw new Error("RBE: cabeçalho não encontrado (Código/Medicamento/Quantidade).");

  const headers = (rows[headerRowIndex] || []).map((h) => String(h ?? "").trim());
  const hNorm = headers.map(norm);

  const idxCod = hNorm.indexOf("codigo") >= 0 ? hNorm.indexOf("codigo") : -1;

  const idxDesc =
    hNorm.indexOf("medicamento") >= 0 ? hNorm.indexOf("medicamento")
    : hNorm.indexOf("descricao") >= 0 ? hNorm.indexOf("descricao")
    : hNorm.indexOf("descrição");

  let idxQt = -1;
  const qtCands = ["quantidade", "qtd", "qtd.", "qt", "saldo", "estoque"];
  for (const c of qtCands) {
    const i = hNorm.indexOf(c);
    if (i >= 0) { idxQt = i; break; }
  }

  if (idxDesc < 0 || idxQt < 0) throw new Error("RBE: não achei colunas de Descrição/Quantidade.");

  const items = [];
  const get = (row, idx) => (idx >= 0 ? row[idx] : "");
  const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const codigo = String(get(r, idxCod) ?? "").trim();
    const descricao = String(get(r, idxDesc) ?? "").trim();
    const qtRaw = get(r, idxQt);

    if (![codigo, descricao, qtRaw].some(has)) continue;
    if (!(has(codigo) && has(descricao))) continue;

    const qt = Math.round(parseNumberBR(qtRaw));
    if (!Number.isFinite(qt)) continue;

    items.push({ codigo, descricao, qt, um: "" });
  }

  const map = new Map();
  for (const it of items) {
    const key = normalize(it.codigo) + "|" + normalize(it.descricao);
    const prev = map.get(key);
    if (!prev) map.set(key, { ...it });
    else prev.qt += it.qt;
  }

  return Array.from(map.values());
}

// =====================================================
// PARSER AGIR
// =====================================================
function parseAGIR_CodDescQt(rows) {
  const norm = (s) =>
    (s ?? "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  if (!rows || !rows.length) throw new Error("AGIR: arquivo vazio.");

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const t = (rows[i] || []).map(norm).join(" | ");
    if (t.includes("cod") && (t.includes("descricao") || t.includes("descrição")) && t.includes("dispon")) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex < 0) headerRowIndex = 0;

  const headers = (rows[headerRowIndex] || []).map(norm);

  const findIdx = (patterns) => {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i] || "";
      if (patterns.some((p) => h.includes(p))) return i;
    }
    return -1;
  };

  const idxCod = findIdx(["cód", "cod.", "cod", "codigo", "código"]);
  const idxDesc = findIdx(["descricao", "descrição"]);
  const idxUM = findIdx(["um", "u.m", "unidade"]);
  const idxQt = findIdx(["qtd. dispon", "qtd dispon", "qtd", "quantidade", "disponivel", "disponível", "saldo"]);

  if (idxDesc < 0 || idxQt < 0) {
    throw new Error("AGIR: não consegui identificar as colunas (Descrição / Qtd. Disponível).");
  }

  const itens = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const descricao = String(r[idxDesc] || "").trim();
    if (!descricao) continue;

    const codigo = idxCod >= 0 ? String(r[idxCod] || "").trim() : "";
    const um = idxUM >= 0 ? String(r[idxUM] || "").trim() : "";

    const qt = parseQtyAGIR(r[idxQt]);
    if (!Number.isFinite(qt)) continue;

    const dNorm = norm(descricao);
    if (dNorm === "total" || dNorm.includes("subtotal")) continue;

    itens.push({ codigo, descricao, qt, um });
  }

  const map = new Map();
  for (const it of itens) {
    const key = normalize(it.codigo) + "|" + normalize(it.descricao) + "|" + normalize(it.um);
    const prev = map.get(key);
    if (!prev) map.set(key, { ...it });
    else prev.qt += it.qt;
  }

  return Array.from(map.values());
}

// =====================================================
// API
// =====================================================
async function apiPost(payload, opts = {}) {
  const p = { ...(payload || {}) };

  if (!opts.skipAutoAuth) {
    const acao = String(p.acao || "").trim();
    const needsAuth =
      acao === "importar_rbe" ||
      acao === "importar_agir" ||
      acao === "limpar_rbe" ||
      acao === "limpar_agir";

    if (needsAuth) {
      const pin = getImportPin_();
      if (!pin) throw new Error("PIN não informado. Reabra a tela de importação.");
      p.auth = pin;
    }
  }

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(p),
  });

  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}

  if (!resp.ok) throw new Error(data?.erro || "Falha ao conectar com o Apps Script (verifique a implantação).");
  if (data && data.ok === false) throw new Error(data.erro || "Erro no backend.");

  return data;
}

async function apiGetSnapshot() {
  const resp = await fetch(`${API_URL}?acao=listar_snapshot`, { method: "GET" });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}

  if (!resp.ok) throw new Error(data?.erro || "Erro ao ler snapshot.");
  if (!Array.isArray(data)) throw new Error("Resposta inválida (esperado array).");

  return data;
}

// ✅ NOVO: ler meta do servidor
async function apiGetMeta() {
  const resp = await fetch(`${API_URL}?acao=listar_meta`, { method: "GET" });
  const text = await resp.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}

  if (!resp.ok) throw new Error(data?.erro || "Erro ao ler meta.");
  if (!data || data.ok !== true) throw new Error(data?.erro || "Meta inválida.");

  return data.data || {};
}

// ✅ aplica meta do servidor no store.meta
function applyMetaServer_(metaServer) {
  // metaServer: { "PA São Pedro": { RBE:{...}, AGIR:{...} }, "PA Praia do Suá": {...} }
  for (const unitKey of Object.keys(UNITS)) {
    const unidadeTxt = UNITS[unitKey];
    const m = metaServer?.[unidadeTxt] || {};

    const rbe = m?.RBE || {};
    const agir = m?.AGIR || {};

    store.meta[unitKey].RBE.lastUpdate = rbe.lastUpdate || null;
    store.meta[unitKey].RBE.lastFile = rbe.lastFile || "—";
    store.meta[unitKey].RBE.lastCount = Number(rbe.lastCount || 0);

    store.meta[unitKey].AGIR.lastUpdate = agir.lastUpdate || null;
    store.meta[unitKey].AGIR.lastFile = agir.lastFile || "—";
    store.meta[unitKey].AGIR.lastCount = Number(agir.lastCount || 0);
  }
}

// =====================================================
// Banco -> cache
// =====================================================
function buildViewCacheFromSnapshot() {
  store.viewCache = {
    PA_SAO_PEDRO: { RBE: [], AGIR: [] },
    PA_PRAIA_SUA: { RBE: [], AGIR: [] },
  };

  for (const row of store.snapshot) {
    const unidadeTexto = String(row.unidade || "").trim();
    const origem = String(row.origem || "").trim().toUpperCase();
    const codigo = String(row.codigo || "").trim();
    const descricao = String(row.descricao || "").trim();
    const um = String(row.um || "").trim();
    const qt = Math.round(parseNumberBR(row.quantidade));

    const consumoRaw = String(row.consumo || "").trim();
    const consumo = consumoRaw ? consumoRaw : "INTERNO";

    if (!descricao || !Number.isFinite(qt)) continue;
    if (origem !== "RBE" && origem !== "AGIR") continue;

    const unitKey =
      unidadeTexto === UNITS.PA_SAO_PEDRO ? "PA_SAO_PEDRO"
      : unidadeTexto === UNITS.PA_PRAIA_SUA ? "PA_PRAIA_SUA"
      : null;
    if (!unitKey) continue;

    store.viewCache[unitKey][origem].push({
      codigo,
      descricao,
      qt,
      unidadeMedida: um,
      consumo,
      origem,

      // ✅ contexto para comparar no modo ALL
      unidade: UNITS[unitKey],
      estoque: STOCKS[origem],
    });
  }

  for (const unitKey of Object.keys(store.viewCache)) {
    for (const stockKey of ["RBE", "AGIR"]) {
      const rows = store.viewCache[unitKey][stockKey];
      const map = new Map();

      for (const r of rows) {
        const key = normalize(r.codigo) + "|" + normalize(r.descricao) + "|" + normalize(r.unidadeMedida);
        const prev = map.get(key);
        if (!prev) map.set(key, { ...r });
        else prev.qt += r.qt;
      }

      // ✅ ID único para funcionar no modo ALL
      store.viewCache[unitKey][stockKey] = Array.from(map.values()).map((it, idx) => ({
        ...it,
        id: `${unitKey}|${stockKey}|${idx + 1}`,
      }));
    }
  }
}

// ✅ NOVO: atualiza snapshot + meta juntos
async function refreshAll() {
  const [snap, meta] = await Promise.all([apiGetSnapshot(), apiGetMeta()]);
  store.snapshot = snap;
  applyMetaServer_(meta);
  buildViewCacheFromSnapshot();
  renderMeta(); // atualiza importacao.html quando estiver aberta
}

// =====================================================
// Importação
// =====================================================
async function importRBE(file) {
  if (!store.currentUnit || store.currentUnit === "ALL") throw new Error("Selecione UMA unidade antes de importar.");
  const rows = await readFirstSheetAsRows(file);
  const itens = parseRBE_CodDescQt(rows);

  await apiPost({
    acao: "importar_rbe",
    unidade: UNITS[store.currentUnit],
    nomeArquivo: file.name, // ✅ NOVO
    itens: itens.map((x) => ({ codigo: x.codigo, descricao: x.descricao, qt: x.qt, um: "" })),
  });

  await refreshAll();
}

async function importAGIR(file) {
  if (!store.currentUnit || store.currentUnit === "ALL") throw new Error("Selecione UMA unidade antes de importar.");
  const rows = await readFirstSheetAsRows(file);
  const itens = parseAGIR_CodDescQt(rows);

  if (!itens.length) throw new Error("AGIR: não consegui extrair itens. Verifique as colunas do arquivo.");

  await apiPost({
    acao: "importar_agir",
    unidade: UNITS[store.currentUnit],
    nomeArquivo: file.name, // ✅ NOVO
    itens: itens.map((x) => ({ codigo: x.codigo, descricao: x.descricao, qt: x.qt, um: x.um || "" })),
  });

  await refreshAll();
}

function resetSelectionsOnly() {
  state.selectedIds.clear();
}

// =====================================================
// Relatório (ALL)
// =====================================================
function getViewData() {
  if (!store.currentUnit) return [];

  const unitsToUse =
    store.currentUnit === "ALL"
      ? ["PA_SAO_PEDRO", "PA_PRAIA_SUA"]
      : [store.currentUnit];

  const stocksToUse =
    store.currentStock === "ALL"
      ? ["RBE", "AGIR"]
      : [store.currentStock];

  const rows = [];
  for (const u of unitsToUse) {
    for (const s of stocksToUse) {
      const part = store.viewCache?.[u]?.[s] || [];
      rows.push(...part);
    }
  }
  return rows;
}

function getFilteredData() {
  const q = normalize(state.query);
  const consumoSel = state.consumoFilter;

  let rows = getViewData().filter((r) => {
    const okText =
      !q ||
      normalize(r.descricao).includes(q) ||
      normalize(r.codigo).includes(q);

    const okSelected = !state.onlySelected || state.selectedIds.has(r.id);

    // ✅ Consumo só filtra itens RBE (inclusive quando estoque=ALL)
    const okConsumo =
      (store.currentStock !== "RBE" && store.currentStock !== "ALL")
        ? true
        : (r.origem !== "RBE")
          ? true
          : (consumoSel === "TODOS" || normalize(r.consumo).includes(normalize(consumoSel)));

    return okText && okSelected && okConsumo;
  });

  switch (state.sort) {
    case "qt_asc": rows.sort((a, b) => a.qt - b.qt); break;
    case "qt_desc": rows.sort((a, b) => b.qt - a.qt); break;
    case "desc_asc": rows.sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR")); break;
    case "desc_desc": rows.sort((a, b) => b.descricao.localeCompare(a.descricao, "pt-BR")); break;
  }
  return rows;
}

function renderCounters() {
  if (!HAS_REPORT_UI) return;

  const base = getViewData();
  const total = base.reduce((acc, r) => acc + (Number(r.qt) || 0), 0);

  if (elTotalStock) elTotalStock.textContent = formatInt(total);
  if (elSelectedCount) elSelectedCount.textContent = `${state.selectedIds.size} selecionados`;

  if (viewHint) {
    if (!store.currentUnit) {
      viewHint.textContent = "Selecione uma unidade para visualizar o relatório.";
      return;
    }

    const unitLabel =
      store.currentUnit === "ALL"
        ? "Todas as Unidades"
        : UNITS[store.currentUnit];

    const stockLabel =
      store.currentStock === "ALL"
        ? "Todos os Estoques"
        : STOCKS[store.currentStock];

    // ✅ meta do servidor
    let lastUpdate = "";
    if (store.currentUnit !== "ALL" && store.currentStock !== "ALL") {
      const meta = store.meta?.[store.currentUnit]?.[store.currentStock];
      if (meta?.lastUpdate) lastUpdate = ` • Atualizado em ${meta.lastUpdate}`;
    }

    viewHint.textContent = `${unitLabel} • ${stockLabel}${lastUpdate}`;
  }
}

function renderList(rows) {
  if (!elList) return;
  elList.innerHTML = "";

  if (!store.currentUnit) {
    elList.innerHTML = `<div class="small" style="padding:12px;">Selecione uma unidade acima para carregar os dados.</div>`;
    return;
  }

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "small";
    empty.style.padding = "12px";
    empty.textContent = getViewData().length
      ? "Nenhum item encontrado com esses filtros."
      : "Nenhum dado no banco para esta visão. Faça a importação.";
    elList.appendChild(empty);
    return;
  }

  const showCtx = (store.currentUnit === "ALL" || store.currentStock === "ALL");

  rows.forEach((r) => {
    const wrap = document.createElement("div");
    wrap.className = "item";

    const left = document.createElement("div");
    left.className = "item__left";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "item__check";
    check.checked = state.selectedIds.has(r.id);
    check.addEventListener("change", () => {
      if (check.checked) state.selectedIds.add(r.id);
      else state.selectedIds.delete(r.id);
      syncUI();
    });

    const desc = document.createElement("div");
    desc.className = "item__desc";
    desc.title = r.descricao;

    desc.textContent = showCtx
      ? `[${r.unidade || "—"} • ${r.estoque || "—"}] ${r.descricao}`
      : r.descricao;

    left.appendChild(check);
    left.appendChild(desc);

    const qt = document.createElement("div");
    qt.className = "item__qt";
    qt.textContent = formatInt(r.qt);

    wrap.appendChild(left);
    wrap.appendChild(qt);
    elList.appendChild(wrap);
  });
}

function renderTable(rows) {
  if (!elTable) return;
  elTable.innerHTML = "";

  if (!store.currentUnit) {
    if (elRowCount) elRowCount.textContent = "0";
    return;
  }

  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");

    const tdIdx = document.createElement("td");
    tdIdx.textContent = `${idx + 1}.`;

    const tdCod = document.createElement("td");
    tdCod.textContent = r.codigo || "—";

    const tdDesc = document.createElement("td");
    tdDesc.textContent = r.descricao;

    const tdUnidade = document.createElement("td");
    tdUnidade.textContent = r.unidade || "—";

    const tdEstoque = document.createElement("td");
    tdEstoque.textContent = r.estoque || (r.origem ? STOCKS[r.origem] : "—");

    const tdQt = document.createElement("td");
    tdQt.className = "right";
    tdQt.textContent = formatInt(r.qt);

    const tdUM = document.createElement("td");
    tdUM.textContent = r.unidadeMedida ? r.unidadeMedida : "—";

    const tdCons = document.createElement("td");
    tdCons.textContent = String(r.consumo || "INTERNO").trim() || "INTERNO";

    tr.appendChild(tdIdx);
    tr.appendChild(tdCod);
    tr.appendChild(tdDesc);
    tr.appendChild(tdUnidade);
    tr.appendChild(tdEstoque);
    tr.appendChild(tdQt);
    tr.appendChild(tdUM);
    tr.appendChild(tdCons);

    elTable.appendChild(tr);
  });

  if (elRowCount) elRowCount.textContent = rows.length;
}

// =====================================================
// Chart
// =====================================================
let pieChart = null;

function buildPieDataset(rows, topN = 10) {
  const sorted = [...rows].sort((a, b) => b.qt - a.qt);
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN);

  const labels = top.map((r) => r.descricao);
  const values = top.map((r) => r.qt);

  const restSum = rest.reduce((acc, r) => acc + r.qt, 0);
  if (restSum > 0) {
    labels.push("Outros");
    values.push(restSum);
  }
  return { labels, values };
}

function renderChart(rows) {
  const ctx = $("pieChart");
  if (!ctx) return;
  if (typeof Chart === "undefined") return;

  if (!store.currentUnit) {
    if (pieChart) { pieChart.destroy(); pieChart = null; }
    return;
  }

  const { labels, values } = buildPieDataset(rows, 10);
  if (pieChart) pieChart.destroy();

  pieChart = new Chart(ctx, {
    type: "pie",
    data: { labels, datasets: [{ data: values }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "right" } },
    },
  });
}

// =====================================================
// Sync UI
// =====================================================
function syncUI() {
  const rows = getFilteredData();
  renderCounters();
  renderList(rows);
  renderTable(rows);

  if (HAS_REPORT_UI) {
    const baseRows = getViewData();
    const selectedRows = baseRows.filter((r) => state.selectedIds.has(r.id));
    const chartRows = state.selectedIds.size > 0 ? selectedRows : rows;
    renderChart(chartRows.length ? chartRows : rows);
  }
}

async function syncDataAndUI() {
  // importacao.html: apenas renderizar meta (quando unidade estiver selecionada)
  if (!HAS_REPORT_UI) { renderMeta(); return; }

  if (!store.currentUnit) {
    if (viewHint) viewHint.textContent = "Selecione uma unidade para visualizar o relatório.";
    if (elTotalStock) elTotalStock.textContent = "0";
    if (elSelectedCount) elSelectedCount.textContent = "0 selecionados";
    if (elRowCount) elRowCount.textContent = "0";
    if (elList) elList.innerHTML = `<div class="small" style="padding:12px;">Selecione uma unidade acima para carregar os dados.</div>`;
    if (elTable) elTable.innerHTML = "";
    if (pieChart) { try { pieChart.destroy(); } catch(_) {} pieChart = null; }
    return;
  }

  // ✅ carrega snapshot+meta do servidor
  if (!store.snapshot.length) await refreshAll();
  else {
    // mesmo com snapshot, atualiza meta do servidor (leve)
    try {
      const meta = await apiGetMeta();
      applyMetaServer_(meta);
    } catch (_) {}
  }

  syncUI();
}

// =====================================================
// Export CSV
// =====================================================
function exportCsv(rows) {
  const header = ["Codigo", "Descricao", "Unidade", "Estoque", "Quantidade", "UnidadeMedida", "Consumo", "Origem"];
  const lines = [header.join(";")];

  rows.forEach((r) => {
    const cod = `"${String(r.codigo || "").replaceAll('"', '""')}"`;
    const desc = `"${String(r.descricao || "").replaceAll('"', '""')}"`;
    const unidade = `"${String(r.unidade || "").replaceAll('"', '""')}"`;
    const estoque = `"${String(r.estoque || "").replaceAll('"', '""')}"`;
    const qt = String(r.qt ?? "");
    const um = `"${String(r.unidadeMedida || "").replaceAll('"', '""')}"`;
    const cons = `"${String((r.consumo || "INTERNO")).replaceAll('"', '""')}"`;
    const origem = `"${String(r.origem || "").replaceAll('"', '""')}"`;
    lines.push([cod, desc, unidade, estoque, qt, um, cons, origem].join(";"));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `estoque_${store.currentUnit || "SEM_UNIDADE"}_${store.currentStock}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// =====================================================
// Eventos
// =====================================================
on(btnUploadRBE, "click", () => fileRBE && fileRBE.click());
on(btnUploadAGIR, "click", () => fileAGIR && fileAGIR.click());

on(fileRBE, "change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await importRBE(file);
    resetSelectionsOnly();
    syncUI();
    alert("RBE importado e salvo no Google Sheets.");
  } catch (err) {
    console.error(err);
    alert(err.message || "Erro ao importar RBE.");
  } finally {
    e.target.value = "";
  }
});

on(fileAGIR, "change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await importAGIR(file);
    resetSelectionsOnly();
    syncUI();
    alert("AGIR importado e salvo no Google Sheets.");
  } catch (err) {
    console.error(err);
    alert(err.message || "Erro ao importar AGIR.");
  } finally {
    e.target.value = "";
  }
});

on(btnClearRBE, "click", () => alert("Nesta versão (Sheets), 'Limpar' não apaga do banco. Se quiser, eu adiciono apagar por unidade/estoque."));
on(btnClearAGIR, "click", () => alert("Nesta versão (Sheets), 'Limpar' não apaga do banco. Se quiser, eu adiciono apagar por unidade/estoque."));

on(elSearch, "input", (e) => { state.query = e.target.value; syncUI(); });
on(elOnlySelected, "change", (e) => { state.onlySelected = e.target.checked; syncUI(); });
on(elSort, "change", (e) => { state.sort = e.target.value; syncUI(); });

on(consumoFilter, "change", (e) => {
  state.consumoFilter = e.target.value;
  state.selectedIds.clear();
  syncUI();
});

on(btnResetFilters, "click", () => {
  state.query = "";
  state.onlySelected = false;
  state.selectedIds.clear();
  state.sort = "qt_desc";
  state.consumoFilter = "TODOS";

  if (elSearch) elSearch.value = "";
  if (elOnlySelected) elOnlySelected.checked = false;
  if (elSort) elSort.value = "qt_desc";
  if (consumoFilter) consumoFilter.value = "TODOS";

  syncUI();
});

on(btnExportCsv, "click", () => {
  if (!store.currentUnit) {
    alert("Selecione uma unidade antes de exportar.");
    return;
  }
  exportCsv(getFilteredData());
});

// =====================================================
// Init
// =====================================================
(async function init() {
  loadLocal();

  if (isImportPage_() && HAS_IMPORT_UI) {
    const ok = await ensureImportPinOrRedirect_();
    if (!ok) return;
  }

  // ✅ início: nenhuma unidade ativa
  unitTabs.forEach((t) => t.classList.remove("is-active"));

  // ✅ estoque padrão: ALL
  stockTabs.forEach((t) => t.classList.toggle("is-active", t.dataset.stock === store.currentStock));

  if (panelRBE) panelRBE.classList.toggle("is-active", store.currentStock === "RBE");
  if (panelAGIR) panelAGIR.classList.toggle("is-active", store.currentStock === "AGIR");

  if (consumoFilterWrap) {
    consumoFilterWrap.style.display = (store.currentStock === "RBE" || store.currentStock === "ALL") ? "block" : "none";
  }

  // ✅ carrega meta do servidor logo no início (para importacao.html mostrar datas)
  try {
    const meta = await apiGetMeta();
    applyMetaServer_(meta);
  } catch (_) {}

  renderMeta();
  syncUI();
})();

// =====================
// MENU MOBILE (somente index.html)
// =====================
(function () {
  if (!document.body.classList.contains("page-report")) return;

  const btn = document.getElementById("hamburger");
  const menu = document.getElementById("mobileMenu");
  if (!btn || !menu) return;

  function closeMenu() {
    menu.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle("is-open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });

  document.addEventListener("click", (e) => {
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    closeMenu();
  });

  const mExport = document.getElementById("mExportCsv");
  const mReset  = document.getElementById("mResetFilters");
  const dExport = document.getElementById("btnExportCsv");
  const dReset  = document.getElementById("btnResetFilters");

  if (mExport && dExport) {
    mExport.addEventListener("click", () => {
      dExport.click();
      closeMenu();
    });
  }

  if (mReset && dReset) {
    mReset.addEventListener("click", () => {
      dReset.click();
      closeMenu();
    });
  }
})();
