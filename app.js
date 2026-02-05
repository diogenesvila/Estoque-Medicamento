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
  currentUnit: "PA_SAO_PEDRO",
  currentStock: "RBE",
  snapshot: [],
  viewCache: {
    PA_SAO_PEDRO: { RBE: [], AGIR: [] },
    PA_PRAIA_SUA: { RBE: [], AGIR: [] },
  },
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
// - O backend (Code.gs) precisa ter acao=validar_pin e validar body.auth
// =====================================================
let __IMPORT_PIN__ = "";

function isImportPage_() {
  const p = (location.pathname || "").toLowerCase();
  return p.includes("importacao.html");
}

async function ensureImportPinOrRedirect_() {
  // pede sempre ao entrar na tela de importação
  const pin = prompt("Acesso restrito: informe o PIN de importação:");
  if (!pin) {
    location.href = "index.html";
    return false;
  }

  // valida no backend
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
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;

  let s = String(value).trim().toLowerCase();
  if (!s) return 0;

  const hasMil = s.includes("mil");
  s = s.replace("mil", "").trim();
  s = s.replace(/\s+/g, "");

  if (s.includes(".") && s.includes(",")) s = s.replaceAll(".", "").replaceAll(",", ".");
  else if (s.includes(",")) s = s.replaceAll(".", "").replaceAll(",", ".");
  else s = s.replaceAll(",", ".");

  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return hasMil ? n * 1000 : n;
}

// ---------- LocalStorage (meta + última visão) ----------
const LS_META_KEY = "sigea_meta_v3";
const LS_VIEW_KEY = "sigea_view_v3";

function loadLocal() {
  try {
    const meta = JSON.parse(localStorage.getItem(LS_META_KEY) || "null");
    if (meta) store.meta = meta;

    const view = JSON.parse(localStorage.getItem(LS_VIEW_KEY) || "null");
    if (view?.unit) store.currentUnit = view.unit;
    if (view?.stock) store.currentStock = view.stock;
  } catch (_) {}
}
function saveLocal() {
  try {
    localStorage.setItem(LS_META_KEY, JSON.stringify(store.meta));
    localStorage.setItem(LS_VIEW_KEY, JSON.stringify({ unit: store.currentUnit, stock: store.currentStock }));
  } catch (_) {}
}

function setMeta(stockKey, { fileName, count }) {
  const m = store.meta[store.currentUnit][stockKey];
  m.lastUpdate = nowBR();
  m.lastFile = fileName || "—";
  m.lastCount = count || 0;
  saveLocal();
  renderMeta();
}

function renderMeta() {
  if (!HAS_IMPORT_UI) return;

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
  renderMeta();
  resetSelectionsOnly();
  saveLocal();
  syncDataAndUI();
}

function setActiveStock(stockKey) {
  store.currentStock = stockKey;
  stockTabs.forEach((t) => t.classList.toggle("is-active", t.dataset.stock === stockKey));

  if (panelRBE) panelRBE.classList.toggle("is-active", stockKey === "RBE");
  if (panelAGIR) panelAGIR.classList.toggle("is-active", stockKey === "AGIR");

  const show = stockKey === "RBE";
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

// ---------- SheetJS leitura ----------
async function readFirstSheetAsRows(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase();

  if (ext === "csv") {
    const text = await file.text();
    const wb = XLSX.read(text, { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  }

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
}

// ---------- Parser RBE: codigo/descricao/quantidade ----------
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

  const headers = (rows[headerRowIndex] || []).map((h) => (h ?? "").toString().trim());
  const hNorm = headers.map(norm);

  const idxCod = hNorm.indexOf("codigo") >= 0 ? hNorm.indexOf("codigo") : -1;
  const idxDesc =
    hNorm.indexOf("medicamento") >= 0 ? hNorm.indexOf("medicamento")
    : hNorm.indexOf("descricao") >= 0 ? hNorm.indexOf("descricao")
    : hNorm.indexOf("descrição");

  let idxQt = -1;
  const qtCands = ["quantidade", "qtd", "qt", "saldo", "estoque"];
  for (const c of qtCands) {
    const i = hNorm.indexOf(c);
    if (i >= 0) { idxQt = i; break; }
  }

  if (idxDesc < 0 || idxQt < 0) throw new Error("RBE: não achei colunas de Descrição/Quantidade.");

  const items = [];
  let current = null;
  const get = (row, idx) => (idx >= 0 ? row[idx] : "");
  const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";

  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const codigo = String(get(r, idxCod) ?? "").trim();
    const descricao = String(get(r, idxDesc) ?? "").trim();
    const qtRaw = get(r, idxQt);

    const any = [codigo, descricao, qtRaw].some(has);
    if (!any) continue;

    const isNew = has(codigo) || has(descricao);
    if (isNew) {
      if (current) items.push(current);
      current = { codigo, descricao, quantidade: qtRaw };
    } else if (current) {
      if (has(qtRaw)) current.quantidade = qtRaw;
    }
  }
  if (current) items.push(current);

  return items
    .filter((it) => it.descricao && String(it.descricao).trim() !== "")
    .map((it) => ({
      codigo: it.codigo || "",
      descricao: it.descricao,
      qt: Math.round(parseNumberBR(it.quantidade)),
      um: "",
    }))
    .filter((it) => Number.isFinite(it.qt));
}

// ---------- Parser AGIR: csv padrão ----------
function parseAGIR_CodDescQt(rows) {
  const norm = (s) =>
    (s ?? "")
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  if (!rows.length) throw new Error("AGIR: arquivo vazio.");

  const headers = (rows[0] || []).map((x) => String(x || "").trim());
  const h = headers.map(norm);

  const idxCod =
    h.indexOf("cod.") >= 0 ? h.indexOf("cod.")
    : h.indexOf("cod") >= 0 ? h.indexOf("cod")
    : h.indexOf("codigo") >= 0 ? h.indexOf("codigo")
    : -1;

  const idxDesc =
    h.indexOf("descricao") >= 0 ? h.indexOf("descricao")
    : h.indexOf("descrição") >= 0 ? h.indexOf("descrição")
    : -1;

  let idxQt = -1;
  const candQt = ["qtd. disponivel", "qtd. disponível", "quantidade", "qtd", "qt", "saldo", "estoque"];
  for (const c of candQt) {
    const i = h.indexOf(c);
    if (i >= 0) { idxQt = i; break; }
  }

  const idxUM = h.indexOf("um");

  if (idxDesc < 0 || idxQt < 0) throw new Error("AGIR: não achei colunas 'Descrição' e 'Qtd. Disponível/Quantidade'.");

  const itens = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const codigo = idxCod >= 0 ? String(r[idxCod] || "").trim() : "";
    const descricao = String(r[idxDesc] || "").trim();
    const qt = Math.round(parseNumberBR(r[idxQt]));
    const um = idxUM >= 0 ? String(r[idxUM] || "").trim() : "";

    if (!descricao) continue;
    if (!Number.isFinite(qt)) continue;

    itens.push({ codigo, descricao, qt, um });
  }
  return itens;
}

// ---------- API ----------
async function apiPost(payload, opts = {}) {
  const p = { ...(payload || {}) };

  // Anexa auth automaticamente para ações restritas
  if (!opts.skipAutoAuth) {
    const acao = String(p.acao || "").trim();
    const needsAuth = acao === "importar_rbe" || acao === "importar_agir" || acao === "limpar_rbe" || acao === "limpar_agir";
    if (needsAuth) {
      const pin = getImportPin_();
      if (!pin) throw new Error("PIN não informado. Reabra a tela de importação.");
      p.auth = pin;
    }
  }

  // Content-Type text/plain evita preflight (e costuma resolver o "Failed to fetch")
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

// ---------- Banco -> cache ----------
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
      consumo: "INTERNO",
      origem,
    });
  }

  // consolida
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

      store.viewCache[unitKey][stockKey] = Array.from(map.values()).map((it, idx) => ({
        ...it,
        id: idx + 1,
      }));
    }
  }
}

async function refreshSnapshot() {
  store.snapshot = await apiGetSnapshot();
  buildViewCacheFromSnapshot();
}

// ---------- Importação ----------
async function importRBE(file) {
  const rows = await readFirstSheetAsRows(file);
  const itens = parseRBE_CodDescQt(rows);

  await apiPost({
    acao: "importar_rbe",
    unidade: UNITS[store.currentUnit],
    itens: itens.map((x) => ({ codigo: x.codigo, descricao: x.descricao, qt: x.qt, um: "" })),
  });

  setMeta("RBE", { fileName: file.name, count: itens.length });
  await refreshSnapshot();
}

async function importAGIR(file) {
  const rows = await readFirstSheetAsRows(file);
  const itens = parseAGIR_CodDescQt(rows);

  await apiPost({
    acao: "importar_agir",
    unidade: UNITS[store.currentUnit],
    itens: itens.map((x) => ({ codigo: x.codigo, descricao: x.descricao, qt: x.qt, um: x.um || "" })),
  });

  setMeta("AGIR", { fileName: file.name, count: itens.length });
  await refreshSnapshot();
}

function resetSelectionsOnly() {
  state.selectedIds.clear();
}

// ---------- Relatório ----------
function getViewData() {
  return store.viewCache[store.currentUnit][store.currentStock] || [];
}

function getFilteredData() {
  const q = normalize(state.query);
  const consumoSel = state.consumoFilter;

  let rows = getViewData().filter((r) => {
    const okText = !q || normalize(r.descricao).includes(q);
    const okSelected = !state.onlySelected || state.selectedIds.has(r.id);

    const okConsumo =
      store.currentStock !== "RBE" ||
      consumoSel === "TODOS" ||
      (r.consumo || "INTERNO") === consumoSel;

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
  if (viewHint) viewHint.textContent = `${UNITS[store.currentUnit]} • ${STOCKS[store.currentStock]}`;
}

function renderList(rows) {
  if (!elList) return;
  elList.innerHTML = "";

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
    desc.textContent = r.descricao;

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

  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");

    const tdIdx = document.createElement("td");
    tdIdx.textContent = `${idx + 1}.`;

    const tdCod = document.createElement("td");
    tdCod.textContent = r.codigo || "—";

    const tdDesc = document.createElement("td");
    tdDesc.textContent = r.descricao;

    const tdQt = document.createElement("td");
    tdQt.className = "right";
    tdQt.textContent = formatInt(r.qt);

    const tdUM = document.createElement("td");
    tdUM.textContent = r.unidadeMedida ? r.unidadeMedida : "—";

    const tdCons = document.createElement("td");
    tdCons.textContent = "Interno";

    tr.appendChild(tdIdx);
    tr.appendChild(tdCod);
    tr.appendChild(tdDesc);
    tr.appendChild(tdQt);
    tr.appendChild(tdUM);
    tr.appendChild(tdCons);

    elTable.appendChild(tr);
  });

  if (elRowCount) elRowCount.textContent = rows.length;
}

// ---------- Chart ----------
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

// ---------- Sync UI ----------
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
  if (!HAS_REPORT_UI) { renderMeta(); return; }
  if (!store.snapshot.length) await refreshSnapshot();
  syncUI();
}

// ---------- Export CSV ----------
function exportCsv(rows) {
  const header = ["Codigo", "Descricao", "Quantidade", "UnidadeMedida", "Consumo", "Origem"];
  const lines = [header.join(";")];

  rows.forEach((r) => {
    const cod = `"${String(r.codigo || "").replaceAll('"', '""')}"`;
    const desc = `"${String(r.descricao || "").replaceAll('"', '""')}"`;
    const qt = String(r.qt ?? "");
    const um = `"${String(r.unidadeMedida || "").replaceAll('"', '""')}"`;
    const cons = `"INTERNO"`;
    const origem = `"${String(r.origem || "").replaceAll('"', '""')}"`;
    lines.push([cod, desc, qt, um, cons, origem].join(";"));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `estoque_${store.currentUnit}_${store.currentStock}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------- Eventos ----------
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

on(btnExportCsv, "click", () => exportCsv(getFilteredData()));

// ---------- Init ----------
(async function init() {
  loadLocal();

  // ✅ Se for a página de importação, pede PIN SEMPRE
  if (isImportPage_() && HAS_IMPORT_UI) {
    const ok = await ensureImportPinOrRedirect_();
    if (!ok) return;
  }

  unitTabs.forEach((t) => t.classList.toggle("is-active", t.dataset.unit === store.currentUnit));
  stockTabs.forEach((t) => t.classList.toggle("is-active", t.dataset.stock === store.currentStock));

  if (panelRBE) panelRBE.classList.toggle("is-active", store.currentStock === "RBE");
  if (panelAGIR) panelAGIR.classList.toggle("is-active", store.currentStock === "AGIR");

  if (consumoFilterWrap) consumoFilterWrap.style.display = store.currentStock === "RBE" ? "block" : "none";

  renderMeta();

  if (HAS_REPORT_UI) {
    await refreshSnapshot();
  }

  syncUI();
})();

