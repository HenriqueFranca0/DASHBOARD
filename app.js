/* ══════════════════════════════════════════════
   PROJFLOW — JavaScript
   ══════════════════════════════════════════════ */

'use strict';

// ── Configuração ──────────────────────────────
const API_URL =
  'https://script.google.com/macros/s/AKfycbxDii4YkRky-WIrwDvbHGZ2cKYWI2Asdw65wPcwnHTTfv8RJ2NFQv7FhnPGeHwlq_Fv/exec';

// ── Mapa de equipes ───────────────────────────
const EQ = {
  'Equipe Fire':           { key: 'fire',  icon: '🔥', tag: 'tag-fire',  color: 'var(--fire)'  },
  'Equipe Bilingada':      { key: 'bili',  icon: '🌐', tag: 'tag-bili',  color: 'var(--bili)'  },
  'Equipe Supapo':         { key: 'supa',  icon: '⚡', tag: 'tag-supa',  color: 'var(--supa)'  },
  'Equipe de Arquitetura': { key: 'arqui', icon: '📐', tag: 'tag-arqui', color: 'var(--arqui)' },
};

// ── Estado da aplicação ───────────────────────
let _cacheCad     = null;   // cache da planilha Cadastros
let _cacheReg     = null;   // cache da planilha Registros
let _codigoAtual  = null;   // código gerado para o cadastro em edição
let selEquipeVal  = null;   // equipe selecionada nos chips
let selectedCadId = null;   // id do cadastro selecionado no Registro


// ════════════════════════════════════════════════
// INICIALIZAÇÃO
// ════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', async () => {
  updateClocks();
  setInterval(updateClocks, 30_000);

  // Fecha o modal de protocolo ao clicar no backdrop
  document.getElementById('proto-modal').addEventListener('click', function (e) {
    if (e.target === this) cancelarRegistro();
  });

  showLoader(true);
  try {
    await Promise.all([loadCad(true), loadReg(true)]);
    await updateSideTotal();
    await prepararProximoCodigo();
  } catch (e) {
    toast('⚠ Erro ao conectar com o banco de dados.', true);
  } finally {
    showLoader(false);
  }
});


// ════════════════════════════════════════════════
// UI — Loader / Toast
// ════════════════════════════════════════════════

function showLoader(on) {
  const el = document.getElementById('global-loader');
  if (el) el.style.display = on ? 'flex' : 'none';
}

function toast(msg, isWarn = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = isWarn ? 'toast show warn' : 'toast show';
  setTimeout(() => t.classList.remove('show'), 3500);
}


// ════════════════════════════════════════════════
// API — Google Sheets
// ════════════════════════════════════════════════

/**
 * Lê todos os registros de uma aba do Sheets.
 * @param {string} sheet  Nome da aba ('Cadastros' | 'Registros')
 */
async function fetchSheet(sheet) {
  const res  = await fetch(`${API_URL}?sheet=${sheet}`);
  const data = await res.json();
  return data.map(row => ({
    ...row,
    id:         Number(row.id),
    anoGerado:  Number(row.anoGerado) || null,
  }));
}

/**
 * Grava uma linha nova em uma aba do Sheets.
 * @param {string}  sheet     Nome da aba
 * @param {Array}   rowArray  Valores na ordem das colunas
 */
async function postRow(sheet, rowArray) {
  await fetch(API_URL, {
    method:  'POST',
    mode:    'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ sheet, row: rowArray }),
  });
}

/** Retorna os cadastros (com cache). */
async function loadCad(force = false) {
  if (!_cacheCad || force) _cacheCad = await fetchSheet('Cadastros');
  return _cacheCad;
}

/** Retorna os registros de protocolo (com cache). */
async function loadReg(force = false) {
  if (!_cacheReg || force) _cacheReg = await fetchSheet('Registros');
  return _cacheReg;
}


// ════════════════════════════════════════════════
// NAVEGAÇÃO
// ════════════════════════════════════════════════

async function goTo(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById('page-' + id).classList.add('active');
  el.classList.add('active');

  if (id === 'relatorio') {
    showLoader(true);
    await populateFilters();
    await renderRelatorio();
    showLoader(false);
  }

  if (id === 'registro') await buscarCadastro();
  if (id === 'cadastro') await prepararProximoCodigo();

  await updateSideTotal();
}


// ════════════════════════════════════════════════
// DATAS
// ════════════════════════════════════════════════

/** Data por extenso em pt-BR. */
function nowFmt() {
  return new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}

/** Data no formato ISO (YYYY-MM-DD). */
function nowISO() {
  return new Date().toISOString().split('T')[0];
}

/** Formata ISO → DD/MM/AAAA para exibição. */
function fmtDate(iso) {
  if (!iso) return '—';
  const p = String(iso).split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso;
}

/** Atualiza os relógios visíveis na tela. */
function updateClocks() {
  const s = nowFmt();
  ['c-date-display', 'r-date-display'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = s;
  });
}


// ════════════════════════════════════════════════
// CÓDIGO SEQUENCIAL
// ════════════════════════════════════════════════

/**
 * Gera o próximo código de projeto no formato YY#### .
 * Ex.: 260001 (ano 2026, sequência 1).
 */
async function gerarCodigo() {
  const anoStr = String(new Date().getFullYear()).slice(-2); // '26'
  const cads   = await loadCad();
  let maiorSeq = 0;

  cads.forEach(c => {
    const cod = String(c.codigo || '');
    if (cod.startsWith(anoStr) && cod.length === 6) {
      const seq = parseInt(cod.slice(2), 10);
      if (seq > maiorSeq) maiorSeq = seq;
    }
  });

  return anoStr + String(maiorSeq + 1).padStart(4, '0');
}

/** Exibe o próximo código gerado no campo de preview. */
async function prepararProximoCodigo() {
  const codigo = await gerarCodigo();
  const el = document.getElementById('c-codigo-preview');
  el.textContent = codigo;
  el.classList.add('gerado');
  document.getElementById('btn-copy-preview').classList.add('visible');
  _codigoAtual = codigo;
}

function copiarCodigo() {
  if (!_codigoAtual) return;
  navigator.clipboard.writeText(_codigoAtual).then(() => toast('✓ Código copiado!'));
}

function copiarCodigoModal() {
  const code = document.getElementById('modal-code').textContent;
  navigator.clipboard.writeText(code).then(() => toast('✓ Código copiado!'));
}

function fecharModal() {
  document.getElementById('success-modal').classList.remove('show');
}

/** Atualiza o contador de projetos na sidebar. */
async function updateSideTotal() {
  const cads = await loadCad();
  document.getElementById('side-total').textContent = cads.length;
}


// ════════════════════════════════════════════════
// SELEÇÃO DE EQUIPE (chips)
// ════════════════════════════════════════════════

function selEquipe(nome, key, el) {
  selEquipeVal = nome;
  document.querySelectorAll('.eq-chip-btn').forEach(b => (b.className = 'eq-chip-btn'));
  el.classList.add('sel-' + key);
}


// ════════════════════════════════════════════════
// CADASTRO
// ════════════════════════════════════════════════

async function limparCadastro() {
  ['c-razao', 'c-projetista', 'c-parceiro'].forEach(
    id => (document.getElementById(id).value = '')
  );
  selEquipeVal = null;
  document.querySelectorAll('.eq-chip-btn').forEach(b => (b.className = 'eq-chip-btn'));
  await prepararProximoCodigo();
}

async function salvarCadastro() {
  const razao      = document.getElementById('c-razao').value.trim();
  const projetista = document.getElementById('c-projetista').value.trim();
  const parceiro   = document.getElementById('c-parceiro').value.trim();

  // Validações
  if (!razao)        return toast('⚠ Informe a Razão Social.', true);
  if (!selEquipeVal) return toast('⚠ Selecione a equipe responsável.', true);
  if (!projetista)   return toast('⚠ Informe o projetista.', true);

  showLoader(true);
  try {
    const codigo   = await gerarCodigo();
    const idUnico  = Date.now();
    const dataHoje = nowISO();
    const anoAtual = new Date().getFullYear();

    // Colunas Sheets: id | codigo | razao | projetista | equipe | parceiro | dataCad | anoGerado
    await postRow('Cadastros', [
      idUnico, codigo, razao, projetista, selEquipeVal,
      parceiro || '', dataHoje, anoAtual,
    ]);

    // Atualiza cache local imediatamente (evita nova requisição)
    if (_cacheCad) {
      _cacheCad.push({
        id: idUnico, codigo, razao, projetista,
        equipe: selEquipeVal, parceiro: parceiro || '',
        dataCad: dataHoje, anoGerado: anoAtual,
      });
    }

    // Exibe modal de confirmação
    document.getElementById('modal-code').textContent = codigo;
    document.getElementById('modal-name').textContent = razao;
    document.getElementById('success-modal').classList.add('show');

    await limparCadastro();
    await updateSideTotal();
  } catch (e) {
    toast('⚠ Erro ao salvar. Tente novamente.', true);
  } finally {
    showLoader(false);
  }
}


// ════════════════════════════════════════════════
// REGISTRO
// ════════════════════════════════════════════════

async function buscarCadastro() {
  const q   = (document.getElementById('r-search').value || '').toLowerCase();
  const eqF = document.getElementById('r-filter-eq').value;
  const container = document.getElementById('r-results');

  const [cadsAll, regsAll] = await Promise.all([loadCad(), loadReg()]);
  const protocolados = new Set(regsAll.map(r => Number(r.cadId)));

  let cads = [...cadsAll];
  if (eqF) cads = cads.filter(c => c.equipe === eqF);
  if (q)   cads = cads.filter(c =>
    String(c.razao      || '').toLowerCase().includes(q) ||
    String(c.projetista || '').toLowerCase().includes(q) ||
    String(c.parceiro   || '').toLowerCase().includes(q)
  );

  if (!cads.length) {
    container.innerHTML =
      '<div class="empty"><div class="empty-icon">🔍</div><p>Nenhum cadastro encontrado.</p></div>';
    return;
  }

  container.innerHTML = cads.map(c => {
    const eq      = EQ[c.equipe] || { icon: '', tag: '' };
    const jaProto = protocolados.has(Number(c.id));
    return `
      <div class="result-item ${selectedCadId === Number(c.id) ? 'selected' : ''}"
           onclick="selecionarCad(${c.id})">
        <div class="ri-left">
          <div class="ri-name">
            ${c.razao}
            <span class="mono" style="color:var(--accent);font-size:0.75rem">#${c.codigo || '—'}</span>
          </div>
          <div class="ri-meta">
            <span>${eq.icon} ${c.equipe}</span>
            <span>👤 ${c.projetista}</span>
            ${c.parceiro ? `<span>🤝 ${c.parceiro}</span>` : ''}
            <span>📅 ${fmtDate(c.dataCad)}</span>
          </div>
        </div>
        <div>
          ${jaProto
            ? '<span class="already-tag">✓ Protocolado</span>'
            : '<span class="tag tag-accent">Pendente</span>'
          }
        </div>
      </div>`;
  }).join('');
}

async function selecionarCad(id) {
  selectedCadId = Number(id);
  const cads = await loadCad();
  const cad  = cads.find(c => Number(c.id) === selectedCadId);
  if (!cad) return;

  // Preenche o modal com os dados do cadastro selecionado
  document.getElementById('proto-modal-name').textContent = cad.razao;
  document.getElementById('proto-modal-code').textContent = `#${cad.codigo || '—'} · ${cad.equipe}`;
  document.getElementById('r-protocolo').value = '';

  // Abre o modal
  document.getElementById('proto-modal').classList.add('show');

  // Foca o campo de protocolo após a animação
  setTimeout(() => document.getElementById('r-protocolo').focus(), 150);
}

async function cancelarRegistro() {
  selectedCadId = null;
  document.getElementById('proto-modal').classList.remove('show');
  document.getElementById('r-protocolo').value = '';
}

async function salvarRegistro() {
  const protocolo = document.getElementById('r-protocolo').value.trim();
  if (!protocolo)     return toast('⚠ Informe o número do protocolo.', true);
  if (!selectedCadId) return toast('⚠ Selecione um cadastro.', true);

  showLoader(true);
  try {
    const idUnico  = Date.now();
    const dataHoje = nowISO();

    // Colunas Sheets: id | cadId | protocolo | dataReg
    await postRow('Registros', [idUnico, selectedCadId, protocolo, dataHoje]);

    // Atualiza cache local
    if (_cacheReg) {
      _cacheReg.push({ id: idUnico, cadId: selectedCadId, protocolo, dataReg: dataHoje });
    }

    // Fecha o modal e atualiza a lista
    document.getElementById('proto-modal').classList.remove('show');
    selectedCadId = null;
    await buscarCadastro();
    toast('✓ Protocolo registrado com sucesso!');
  } catch (e) {
    toast('⚠ Erro ao registrar. Tente novamente.', true);
  } finally {
    showLoader(false);
  }
}


// ════════════════════════════════════════════════
// RELATÓRIO
// ════════════════════════════════════════════════

/** Popula os selects de projetista e parceiro dinamicamente. */
async function populateFilters() {
  const cads = await loadCad();
  const projs = [...new Set(cads.map(c => c.projetista).filter(Boolean))].sort();
  const parcs = [...new Set(cads.map(c => c.parceiro).filter(Boolean))].sort();

  const fpEl = document.getElementById('f-proj');
  const curP = fpEl.value;
  fpEl.innerHTML =
    '<option value="">Todos</option>' +
    projs.map(p => `<option value="${p}" ${p === curP ? 'selected' : ''}>${p}</option>`).join('');

  const faEl = document.getElementById('f-parc');
  const curA = faEl.value;
  faEl.innerHTML =
    '<option value="">Todos</option>' +
    parcs.map(p => `<option value="${p}" ${p === curA ? 'selected' : ''}>${p}</option>`).join('');
}

async function limparFiltros() {
  ['f-de', 'f-ate'].forEach(id => (document.getElementById(id).value = ''));
  ['f-eq', 'f-proj', 'f-parc'].forEach(id => (document.getElementById(id).value = ''));
  await renderRelatorio();
}

async function renderRelatorio() {
  const de   = document.getElementById('f-de').value;
  const ate  = document.getElementById('f-ate').value;
  const eq   = document.getElementById('f-eq').value;
  const proj = document.getElementById('f-proj').value;
  const parc = document.getElementById('f-parc').value;

  let cads   = await loadCad();
  const regs = await loadReg();

  // Monta mapa cadId → primeiro registro de protocolo
  const regMap = {};
  regs.forEach(r => {
    const cid = Number(r.cadId);
    if (!regMap[cid]) regMap[cid] = r;
  });

  // Aplica filtros
  if (eq)   cads = cads.filter(c => c.equipe      === eq);
  if (proj) cads = cads.filter(c => c.projetista  === proj);
  if (parc) cads = cads.filter(c => c.parceiro    === parc);
  if (de)   cads = cads.filter(c => String(c.dataCad) >= de);
  if (ate)  cads = cads.filter(c => String(c.dataCad) <= ate);

  // ── KPIs ──
  document.getElementById('k-total').textContent = cads.length;
  document.getElementById('k-proto').textContent = cads.filter(c => regMap[Number(c.id)]).length;
  document.getElementById('k-fire').textContent  = cads.filter(c => c.equipe === 'Equipe Fire').length;
  document.getElementById('k-bili').textContent  = cads.filter(c => c.equipe === 'Equipe Bilingada').length;
  document.getElementById('k-supa').textContent  = cads.filter(c => c.equipe === 'Equipe Supapo').length;
  document.getElementById('k-arqui').textContent = cads.filter(c => c.equipe === 'Equipe de Arquitetura').length;

  // ── Rankings ──
  renderRank('rank-proj', buildCount(cads, 'projetista'), 'rf-accent', 'var(--accent)');
  renderRank('rank-parc', buildCount(cads, 'parceiro'),   'rf-accent', 'var(--amber)');

  // ── Tabela ──
  const tbody = document.getElementById('rel-tbody');

  if (!cads.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty">
            <div class="empty-icon">📭</div>
            <p>Nenhum resultado.</p>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = [...cads]
    .sort((a, b) => Number(b.id) - Number(a.id))
    .map(c => {
      const eq  = EQ[c.equipe] || { icon: '', tag: '' };
      const reg = regMap[Number(c.id)];
      return `
        <tr>
          <td class="mono" style="color:var(--accent);font-weight:600">${c.codigo || '—'}</td>
          <td style="font-weight:600">${c.razao}</td>
          <td>${c.projetista}</td>
          <td><span class="tag ${eq.tag}">${eq.icon} ${c.equipe}</span></td>
          <td>${c.parceiro || '<span style="color:var(--muted)">—</span>'}</td>
          <td class="mono">${fmtDate(c.dataCad)}</td>
          <td class="mono">${reg ? reg.protocolo : '<span style="color:var(--muted)">—</span>'}</td>
          <td>
            ${reg
              ? `<span class="tag tag-green">✓ ${fmtDate(reg.dataReg)}</span>`
              : '<span style="color:var(--muted);font-size:.75rem">Pendente</span>'
            }
          </td>
        </tr>`;
    })
    .join('');
}

// ── Acordeão ──────────────────────────────────

function toggleAccordion(id, header) {
  const item   = header.closest('.accordion-item');
  const isOpen = item.classList.contains('open');
  item.classList.toggle('open', !isOpen);

  // Anima as barras de progresso quando abre
  if (!isOpen) {
    setTimeout(() => {
      item.querySelectorAll('.rank-fill').forEach(b => {
        b.style.width = b.dataset.w + '%';
      });
    }, 60);
  }
}

// ── Helpers de ranking ────────────────────────

/**
 * Conta ocorrências de cada valor de uma chave.
 * @returns {Array} [['nome', contagem], ...] ordenado desc.
 */
function buildCount(arr, key) {
  const map = {};
  arr.forEach(item => {
    const v = item[key];
    if (v) map[v] = (map[v] || 0) + 1;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

/**
 * Renderiza uma lista de barras de ranking.
 * @param {string} containerId  ID do elemento pai
 * @param {Array}  entries      Resultado de buildCount()
 * @param {string} fillCls      Classe CSS da barra (ex.: 'rf-accent')
 * @param {string} color        Cor do contador (ex.: 'var(--amber)')
 */
function renderRank(containerId, entries, fillCls, color) {
  const el = document.getElementById(containerId);
  if (!entries.length) {
    el.innerHTML = '<div class="empty"><p>Sem dados.</p></div>';
    return;
  }
  const max = entries[0][1];
  el.innerHTML = entries
    .map(([name, n]) => `
      <div class="rank-row">
        <div class="rank-head">
          <span class="rank-name">${name}</span>
          <span class="rank-count" style="color:${color}">${n}</span>
        </div>
        <div class="rank-bar">
          <div class="rank-fill ${fillCls}"
               data-w="${((n / max) * 100).toFixed(1)}"
               style="width:0%">
          </div>
        </div>
      </div>`)
    .join('');
}