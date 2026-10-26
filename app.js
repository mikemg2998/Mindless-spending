/* Mindless Spending — all app logic. Data lives in localStorage on each device (no account, no server).
   Views: home (month at a glance), movs (movements), pagos (fixed bills, subscriptions, fixed income), analisis, ahorro (goals), ajustes. */
'use strict';
const VERSION = '1.0.0';
const KEY = 'mindless-spending-v1';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sum = (arr, f = x => x) => arr.reduce((a, x) => a + f(x), 0);

/* ---------- Data ---------- */
const CURRENCIES = {
  COP: {locale: 'es-CO', dec: 0, label: 'Peso colombiano (COP)'},
  EUR: {locale: 'es-ES', dec: 2, label: 'Euro (EUR)'},
  USD: {locale: 'es-US', dec: 2, label: 'Dólar estadounidense (USD)'},
  MXN: {locale: 'es-MX', dec: 2, label: 'Peso mexicano (MXN)'},
};
const DEFAULT_CATS = [
  ['vivienda', 'Vivienda', '🏠', 'exp'], ['mercado', 'Mercado', '🛒', 'exp'], ['comida', 'Restaurantes y domicilios', '🍔', 'exp'],
  ['transporte', 'Transporte', '🚌', 'exp'], ['servicios', 'Servicios (luz, agua, gas, internet)', '💡', 'exp'], ['celular', 'Celular', '📱', 'exp'],
  ['salud', 'Salud', '💊', 'exp'], ['subs', 'Suscripciones', '📺', 'exp'], ['ropa', 'Ropa y cuidado personal', '👕', 'exp'],
  ['ocio', 'Ocio y salidas', '🎉', 'exp'], ['educacion', 'Educación', '📚', 'exp'], ['deudas', 'Deudas y tarjetas', '💳', 'exp'],
  ['regalos', 'Regalos', '🎁', 'exp'], ['otros', 'Otros gastos', '📦', 'exp'],
  ['salario', 'Salario', '💼', 'inc'], ['extra', 'Ingresos extra', '💸', 'inc'], ['otrosinc', 'Otros ingresos', '➕', 'inc'],
].map(([id, name, emoji, type]) => ({id, name, emoji, type, budget: 0}));

function fresh(currency = 'COP') { return {v: 1, settings: {currency}, cats: DEFAULT_CATS.map(c => ({...c})), tx: [], fixed: [], goals: []}; }
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.v === 1) return d; } catch (e) {}
  return fresh();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { toast('No se pudo guardar en este dispositivo.'); } }
let D = load();

/* ---------- Money & dates ---------- */
const cur = () => CURRENCIES[D.settings.currency] || CURRENCIES.COP;
function money(n, opt = {}) {
  const c = cur(), a = Math.abs(n);
  const dec = opt.compact ? 1 : (a % 1 ? c.dec : 0);
  const s = new Intl.NumberFormat(c.locale, {style: 'currency', currency: D.settings.currency, minimumFractionDigits: opt.compact ? 0 : dec, maximumFractionDigits: dec, notation: opt.compact ? 'compact' : 'standard'}).format(a);
  return (n < 0 ? '−' : opt.sign && n > 0 ? '+' : '') + s;
}
function parseAmount(s) {
  s = String(s).trim().replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (cur().dec === 0) return Number(s.replace(/[.,]/g, ''));
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (last > -1 && s.length - last - 1 <= 2) return Number(s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1));
  return Number(s.replace(/[.,]/g, ''));
}
const amountInput = n => n ? new Intl.NumberFormat(cur().locale, {maximumFractionDigits: cur().dec}).format(n) : '';
const pct = x => Math.round(x * 100) + '%';
const pad = n => String(n).padStart(2, '0');
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
const thisYm = () => todayISO().slice(0, 7);
const ymOf = iso => iso.slice(0, 7);
function addMonths(ym, k) { let [y, m] = ym.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${pad(m)}`; }
function monthsBetween(a, b) { const [y1, m1] = a.split('-').map(Number), [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); }
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function monthName(ym, mode) {
  const [y, m] = ym.split('-').map(Number), n = MONTHS[m - 1];
  if (mode === 'short') return cap(n.slice(0, 3));
  if (mode === 'only') return cap(n);
  return cap(n) + ' ' + y;
}
function daysIn(ym) { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); }
const dueDate = (f, ym) => `${ym}-${pad(Math.min(f.day || 1, daysIn(ym)))}`;
function dayLabel(iso) {
  const t = todayISO();
  if (iso === t) return 'Hoy';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}`) return 'Ayer';
  const d = new Date(iso + 'T12:00:00');
  return cap(d.toLocaleDateString('es', {weekday: 'long', day: 'numeric', month: 'long'}));
}

/* ---------- Derived numbers ---------- */
const catOf = id => D.cats.find(c => c.id === id) || {id, name: 'Sin categoría', emoji: '❔', type: 'exp', budget: 0};
const fixedDue = ym => D.fixed.filter(f => f.active !== false && f.start <= ym && (!f.end || f.end >= ym));
const paidTx = (f, ym) => D.tx.find(t => t.fixedId === f.id && t.forMonth === ym);
const txIn = ym => D.tx.filter(t => ymOf(t.date) === ym);
const catTotal = (ym, id) => sum(D.tx.filter(t => t.type === 'exp' && t.cat === id && ymOf(t.date) === ym), t => t.amount);
const goalSaved = g => sum(D.tx.filter(t => t.type === 'save' && t.goalId === g.id), t => t.amount);
const hasMonthData = ym => D.tx.some(t => ymOf(t.date) === ym);

function summary(ym) {
  const tx = txIn(ym);
  let inc = 0, exp = 0, sav = 0;
  for (const t of tx) { if (t.type === 'inc') inc += t.amount; else if (t.type === 'exp') exp += t.amount; else if (t.type === 'save') sav += t.amount; }
  const due = fixedDue(ym), pendList = [];
  let pend = 0, pendInc = 0;
  for (const f of due) if (!paidTx(f, ym)) { if (f.kind === 'inc') pendInc += f.amount; else pend += f.amount; pendList.push(f); }
  pendList.sort((a, b) => (a.day || 1) - (b.day || 1));
  return {tx, inc, exp, sav, pend, pendInc, left: inc - exp - sav - pend, due, pendList};
}
function byCat(ym) {
  const m = {};
  for (const t of D.tx) if (t.type === 'exp' && ymOf(t.date) === ym) m[t.cat] = (m[t.cat] || 0) + t.amount;
  return Object.entries(m).map(([id, v]) => ({cat: catOf(id), v})).sort((a, b) => b.v - a.v);
}
function fixedStatus(f, ym) {
  if (paidTx(f, ym)) return 'paid';
  const t = todayISO();
  if (dueDate(f, ym) < t) return 'late';
  const days = (new Date(dueDate(f, ym) + 'T12:00:00') - new Date(t + 'T12:00:00')) / 864e5;
  return days <= 3 ? 'soon' : 'pending';
}

function insights(ym) {
  const out = [], s = summary(ym);
  if (s.left < 0 && (s.inc > 0 || s.exp > 0)) out.push({tone: 'bad', icon: 'alert', title: 'Este mes vas en rojo', text: `Entre gastos, ahorro y lo que falta por pagar te pasas ${money(-s.left)} de lo que ha entrado.${s.pendInc ? ` Aún esperas ${money(s.pendInc)} de ingresos fijos.` : ''}`});
  for (const f of D.fixed.filter(f => f.kind === 'sub' && f.active !== false && f.used === false && f.start <= ym && (!f.end || f.end >= ym)))
    out.push({tone: 'warn', icon: 'x', title: `Cancela ${f.name}`, text: `Marcaste que no la usas: son ${money(f.amount)} al mes, ${money(f.amount * 12)} al año.`, act: 'edit-fixed', id: f.id, cta: 'Revisar'});
  for (const c of D.cats.filter(c => c.type === 'exp' && c.budget > 0)) {
    const v = catTotal(ym, c.id);
    if (v > c.budget) out.push({tone: 'bad', icon: 'alert', title: `Te pasaste en ${c.emoji} ${c.name}`, text: `Llevas ${money(v)} de un límite de ${money(c.budget)}: ${money(v - c.budget)} de más.`});
    else if (v >= c.budget * .8) out.push({tone: 'warn', icon: 'alert', title: `Casi llegas al límite de ${c.emoji} ${c.name}`, text: `Te quedan ${money(c.budget - v)} de los ${money(c.budget)} que te pusiste.`});
  }
  const prev = [1, 2, 3].map(k => addMonths(ym, -k)).filter(hasMonthData);
  if (prev.length) {
    const ups = [];
    for (const {cat, v} of byCat(ym)) {
      const avg = sum(prev, m => catTotal(m, cat.id)) / prev.length;
      if (cat.budget > 0 && v > cat.budget * .8) continue;
      if (avg > 0 && v > avg * 1.25 && v - avg > (s.inc || v) * .03) ups.push({cat, v, avg});
    }
    ups.sort((a, b) => (b.v - b.avg) - (a.v - a.avg));
    for (const u of ups.slice(0, 2)) out.push({tone: 'warn', icon: 'up', title: `${u.cat.emoji} ${u.cat.name}: ${pct(u.v / u.avg - 1)} más que tu promedio`, text: `Normalmente gastas ${money(u.avg)} y este mes vas en ${money(u.v)}. Ahí hay ${money(u.v - u.avg)} para recortar.`});
  }
  if (s.left > 0 && s.inc > 0) {
    const g = D.goals.find(g => goalSaved(g) < g.target);
    const half = cur().dec ? Math.round(s.left / 2 * 100) / 100 : Math.round(s.left / 2);
    out.push(g
      ? {tone: 'good', icon: 'target', title: `Te sobran ${money(s.left)}`, text: `Si apartas la mitad (${money(half)}) para ${g.emoji} ${g.name}, quedas en ${pct(Math.min(1, (goalSaved(g) + half) / g.target))} de tu meta.`, act: 'contrib', id: g.id, amount: half, cta: `Apartar ${money(half)}`}
      : {tone: 'good', icon: 'target', title: `Te sobran ${money(s.left)}`, text: 'Crea una meta de ahorro y aparta una parte antes de que se vaya en otras cosas.', act: 'new-goal', cta: 'Crear meta'});
  }
  const subs = fixedDue(ym).filter(f => f.kind === 'sub');
  if (subs.length) { const t = sum(subs, f => f.amount); out.push({tone: 'info', icon: 'repeat', title: `Suscripciones: ${money(t)} al mes`, text: `Tienes ${subs.length} activa${subs.length > 1 ? 's' : ''}, ${money(t * 12)} al año. Marca en Pagos las que no usas.`, act: 'nav', id: 'pagos', cta: 'Ver suscripciones'}); }
  const top = byCat(ym)[0];
  if (top && s.exp > 0) out.push({tone: 'info', icon: 'chart', title: `${top.cat.emoji} ${top.cat.name} es tu mayor gasto`, text: `${pct(top.v / s.exp)} de lo que llevas gastado este mes (${money(top.v)}).`});
  const P = {bad: 0, warn: 1, good: 2, info: 3};
  return out.map((x, i) => ({...x, i})).sort((a, b) => P[a.tone] - P[b.tone] || a.i - b.i);
}

/* ---------- Icons ---------- */
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  list: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01',
  calendar: 'M4 5h16v16H4zM4 10h16M9 3v4M15 3v4',
  chart: 'M3 21h18M6 17v-6M11 17V6M16 17v-4M20 17V9',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z',
  gear: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  plus: 'M12 5v14M5 12h14',
  chevL: 'M15 6l-6 6 6 6', chevR: 'M9 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6 6 18',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  alert: 'M12 3.5 2.5 20h19zM12 10v4.5M12 17.2h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  piggy: 'M12 5v14M16 8.5c-.6-1.5-2.2-2.5-4-2.5-2.2 0-4 1.2-4 3s1.6 2.5 4 3 4 1.3 4 3-1.8 3-4 3c-1.9 0-3.5-1-4-2.5',
  install: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;

/* ---------- UI state ---------- */
const UI = {view: 'home', ym: thisYm(), movFilter: 'all', movSearch: '', pagosTab: 'bill'};
const NAV = [['home', 'Inicio', 'home'], ['movs', 'Movimientos', 'list'], ['pagos', 'Pagos', 'calendar'], ['analisis', 'Análisis', 'chart'], ['ahorro', 'Ahorro', 'target'], ['ajustes', 'Ajustes', 'gear']];

function go(view) {
  UI.view = view;
  try { sessionStorage.setItem('cc-view', view); } catch (e) {}
  render();
  window.scrollTo(0, 0);
}

/* ---------- Pieces ---------- */
function monthBar() {
  const isNow = UI.ym === thisYm();
  return `<div class="monthbar">
    <button class="icon-btn" data-act="month" data-d="-1" aria-label="Mes anterior">${ic('chevL')}</button>
    <div class="mb-label"><span class="eyebrow">${isNow ? 'Este mes' : UI.ym < thisYm() ? 'Mes pasado' : 'Mes futuro'}</span><strong>${monthName(UI.ym)}</strong></div>
    <button class="icon-btn" data-act="month" data-d="1" aria-label="Mes siguiente">${ic('chevR')}</button>
    ${isNow ? '' : `<button class="chip" data-act="month-now">Ir a hoy</button>`}
  </div>`;
}
function txRow(t) {
  const c = catOf(t.cat), g = t.goalId && D.goals.find(g => g.id === t.goalId);
  const title = t.type === 'save' ? (t.amount < 0 ? 'Retiro de ' : 'Ahorro para ') + (g ? g.name : 'meta') : (t.note || c.name);
  const sub = t.type === 'save' ? (t.note || 'Ahorro') : (t.note ? c.name : (t.type === 'inc' ? 'Ingreso' : 'Gasto'));
  const emoji = t.type === 'save' ? (g ? g.emoji : '🎯') : c.emoji;
  const amt = t.type === 'inc' ? money(t.amount, {sign: true}) : t.type === 'exp' ? money(-t.amount) : money(-t.amount);
  return `<button class="row-item" data-act="edit-tx" data-id="${t.id}">
    <span class="emo">${emoji}</span>
    <span class="ri-main"><span class="ri-title">${esc(title)}</span><span class="ri-sub">${esc(sub)}${t.fixedId ? ' · fijo' : ''}</span></span>
    <span class="amt ${t.type}">${amt}</span>
  </button>`;
}
const STATUS = {paid: ['good', 'check', 'Pagado'], late: ['bad', 'alert', 'Vencido'], soon: ['warn', 'clock', 'Vence pronto'], pending: ['warn', 'clock', 'Pendiente']};
function fixedRow(f, ym, compact) {
  const st = fixedStatus(f, ym), isInc = f.kind === 'inc';
  let [tone, icon, label] = STATUS[st];
  if (isInc) label = st === 'paid' ? 'Recibido' : st === 'late' ? 'Atrasado' : 'Por recibir';
  const paid = st === 'paid';
  const p = paidTx(f, ym), amt = p ? p.amount : f.amount;
  const c = catOf(f.cat);
  return `<div class="row-item fixed ${paid ? 'is-paid' : ''}">
    <button class="tick ${paid ? 'on' : ''}" data-act="pay" data-id="${f.id}" aria-pressed="${paid}" aria-label="${paid ? 'Marcar como no pagado' : (isInc ? 'Marcar como recibido' : 'Marcar como pagado')}: ${esc(f.name)}">${ic('check')}</button>
    <button class="ri-main as-btn" data-act="edit-fixed" data-id="${f.id}">
      <span class="ri-title">${c.emoji} ${esc(f.name)}${f.kind === 'sub' && f.used === false ? ' <span class="tag warn">No la uso</span>' : ''}</span>
      <span class="ri-sub"><span class="status ${tone}">${ic(icon)}${label}</span> · ${paid ? (isInc ? 'recibido el ' : 'pagado el ') + Number(p.date.slice(8)) : 'día ' + Math.min(f.day || 1, daysIn(ym))}${f.end && f.end === f.start ? ' · solo este mes' : ''}</span>
    </button>
    <span class="amt ${isInc ? 'inc' : 'exp'} ${compact ? '' : 'big'}">${isInc ? money(amt, {sign: true}) : money(-amt)}</span>
  </div>`;
}
function catBars(list, total, limit) {
  if (!list.length) return `<p class="empty-line">Aún no hay gastos este mes.</p>`;
  const max = list[0].v;
  return `<div class="catbars">${list.slice(0, limit || list.length).map(({cat, v}) => {
    const b = cat.budget > 0 ? cat.budget : 0, scale = Math.max(max, b);
    const over = b && v > b, near = b && !over && v >= b * .8;
    return `<div class="cb" data-tip="${esc(cat.name)}: ${money(v)}${b ? ` de ${money(b)} de límite` : ''} · ${pct(v / total)} del total">
      <div class="cb-head"><span class="cb-name">${cat.emoji} ${esc(cat.name)}</span><span class="cb-val num">${money(v)} <small>${pct(v / total)}</small></span></div>
      <div class="cb-track"><div class="cb-fill ${over ? 'over' : near ? 'near' : ''}" style="width:${Math.max(1.5, v / scale * 100)}%"></div>${b ? `<div class="cb-limit" style="left:${b / scale * 100}%"></div>` : ''}</div>
      ${b ? `<div class="cb-note ${over ? 'bad' : near ? 'warn' : ''}">${over ? ic('alert') + `Te pasaste ${money(v - b)}` : near ? ic('alert') + `Te quedan ${money(b - v)}` : `Límite ${money(b)} · te quedan ${money(b - v)}`}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}
function insightCards(list) {
  if (!list.length) return `<p class="empty-line">Cuando tengas unos días de movimientos, aquí verás dónde puedes ahorrar.</p>`;
  return `<div class="insights">${list.map(i => `<div class="insight ${i.tone}">
    <span class="in-ic">${ic(i.icon)}</span>
    <div><strong>${esc(i.title)}</strong><p>${esc(i.text)}</p>${i.cta ? `<button class="link" data-act="${i.act}" data-id="${i.id || ''}" data-amount="${i.amount || ''}">${esc(i.cta)} ${ic('chevR')}</button>` : ''}</div>
  </div>`).join('')}</div>`;
}
function goalCard(g, mini) {
  const s = goalSaved(g), p = g.target ? Math.min(1, s / g.target) : 0, done = s >= g.target;
  let plan = '';
  if (!done && g.deadline) {
    const left = monthsBetween(thisYm(), g.deadline) + 1;
    plan = left > 0 ? `Aparta ${money((g.target - s) / left)} al mes para llegar en ${monthName(g.deadline)}.` : `La fecha (${monthName(g.deadline)}) ya pasó: te faltan ${money(g.target - s)}.`;
  } else if (!done) plan = `Te faltan ${money(g.target - s)}.`;
  else plan = '¡Meta cumplida! 🎉';
  return `<div class="goal ${mini ? 'mini' : ''}">
    <div class="goal-head"><span class="emo">${g.emoji || '🎯'}</span><div class="ri-main"><span class="ri-title">${esc(g.name)}</span><span class="ri-sub num">${money(s)} de ${money(g.target)}</span></div><span class="goal-pct num">${pct(p)}</span></div>
    <div class="progress" role="progressbar" aria-valuenow="${Math.round(p * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Progreso de ${esc(g.name)}"><div style="width:${p * 100}%"></div></div>
    <p class="note">${plan}</p>
    ${mini ? '' : `<div class="row"><button class="btn primary sm" data-act="contrib" data-id="${g.id}">${ic('plus')}Aportar</button><button class="btn sm" data-act="contrib" data-id="${g.id}" data-mode="out">Retirar</button><button class="btn ghost sm" data-act="edit-goal" data-id="${g.id}">Editar</button></div>`}
  </div>`;
}

/* ---------- Views ---------- */
function viewHome() {
  const ym = UI.ym, s = summary(ym);
  if (!D.tx.length && !D.fixed.length && !D.goals.length) return welcome();
  const base = Math.max(s.inc, s.exp + s.sav + s.pend, 1);
  const seg = (v, cls, label) => v > 0 ? `<div class="seg ${cls}" style="width:${v / base * 100}%" data-tip="${label}: ${money(v)}"></div>` : '';
  const cats = byCat(ym), recent = [...s.tx].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 5);
  const ins = insights(ym).slice(0, 6);
  return `${demoBanner()}${monthBar()}
  <section class="hero ${s.left < 0 ? 'neg' : ''}">
    <div class="hero-top">
      <div><span class="eyebrow">Te queda</span><div class="hero-num num">${money(s.left)}</div>
      <p class="hero-sub">${s.inc ? `de ${money(s.inc)} que han entrado` : 'Registra tus ingresos para ver cuánto te queda'}${s.pend ? `, ya descontando ${money(s.pend)} por pagar` : ''}.</p></div>
    </div>
    <div class="stack" aria-hidden="true">${seg(s.exp, 'exp', 'Gastado')}${seg(s.sav, 'sav', 'Ahorrado')}${seg(s.pend, 'pend', 'Por pagar')}${seg(Math.max(0, s.left), 'left', 'Te queda')}</div>
    <div class="legend"><span><i class="exp"></i>Gastado</span><span><i class="sav"></i>Ahorrado</span><span><i class="pend"></i>Por pagar</span><span><i class="left"></i>Te queda</span></div>
  </section>
  <section class="tiles">
    <button class="tile inc" data-act="filter-movs" data-id="inc"><span class="t-ic">${ic('down')}</span><span class="t-label">Ingresos</span><span class="t-num num">${money(s.inc)}</span>${s.pendInc ? `<span class="t-sub">+ ${money(s.pendInc)} por recibir</span>` : '<span class="t-sub">este mes</span>'}</button>
    <button class="tile exp" data-act="filter-movs" data-id="exp"><span class="t-ic">${ic('up')}</span><span class="t-label">Gastos</span><span class="t-num num">${money(s.exp)}</span><span class="t-sub">${s.inc ? pct(s.exp / s.inc) + ' de tus ingresos' : 'este mes'}</span></button>
    <button class="tile pend" data-nav="pagos"><span class="t-ic">${ic('clock')}</span><span class="t-label">Por pagar</span><span class="t-num num">${money(s.pend)}</span><span class="t-sub">${s.pendList.filter(f => f.kind !== 'inc').length} pago${s.pendList.filter(f => f.kind !== 'inc').length === 1 ? '' : 's'} pendiente${s.pendList.filter(f => f.kind !== 'inc').length === 1 ? '' : 's'}</span></button>
    <button class="tile sav" data-nav="ahorro"><span class="t-ic">${ic('target')}</span><span class="t-label">Ahorrado</span><span class="t-num num">${money(s.sav)}</span><span class="t-sub">${s.inc ? pct(Math.max(0, s.sav) / s.inc) + ' de tus ingresos' : 'este mes'}</span></button>
  </section>
  <div class="grid">
    <section class="card">
      <div class="card-head"><h3>Por pagar</h3><button class="link" data-nav="pagos">Ver todo ${ic('chevR')}</button></div>
      ${s.pendList.length ? `<div class="rows">${s.pendList.slice(0, 6).map(f => fixedRow(f, ym, true)).join('')}</div>` : s.due.length ? `<p class="all-done">${ic('check')}Todo pagado este mes.</p>` : `<p class="empty-line">Agrega tus pagos fijos (arriendo, servicios, suscripciones) y aquí verás qué falta.</p><button class="btn sm" data-act="new-fixed" data-id="bill">${ic('plus')}Agregar pago fijo</button>`}
    </section>
    <section class="card">
      <div class="card-head"><h3>En qué se te va la plata</h3><button class="link" data-nav="analisis">Análisis ${ic('chevR')}</button></div>
      ${catBars(cats, s.exp, 5)}
    </section>
    <section class="card span2">
      <div class="card-head"><h3>Dónde puedes ahorrar</h3></div>
      ${insightCards(ins)}
    </section>
    <section class="card">
      <div class="card-head"><h3>Tus metas</h3><button class="link" data-nav="ahorro">Ahorro ${ic('chevR')}</button></div>
      ${D.goals.length ? D.goals.slice(0, 3).map(g => goalCard(g, true)).join('') : `<p class="empty-line">Ponte una meta (un viaje, un fondo de emergencia) y te digo cuánto apartar cada mes.</p><button class="btn sm" data-act="new-goal">${ic('plus')}Crear meta</button>`}
    </section>
    <section class="card">
      <div class="card-head"><h3>Últimos movimientos</h3><button class="link" data-nav="movs">Ver todos ${ic('chevR')}</button></div>
      ${recent.length ? `<div class="rows">${recent.map(txRow).join('')}</div>` : `<p class="empty-line">Sin movimientos en ${monthName(ym)}.</p>`}
    </section>
  </div>`;
}
function welcome() {
  return `<section class="welcome">
    <span class="eyebrow">Bienvenido</span>
    <h1>Todo claro,<br><em>cada mes.</em></h1>
    <p class="lead">Anota lo que entra y lo que sale, y la app te dice cuánto te queda, qué falta por pagar y dónde puedes ahorrar. Todo se guarda en este dispositivo, sin cuentas ni contraseñas.</p>
    <ol class="steps">
      <li><span>1</span><div><strong>Tu ingreso del mes</strong><p>Tu salario como ingreso fijo, para que la app sepa con cuánto cuentas.</p><button class="btn sm" data-act="new-fixed" data-id="inc">${ic('plus')}Agregar ingreso fijo</button></div></li>
      <li><span>2</span><div><strong>Tus pagos fijos</strong><p>Arriendo, servicios, celular, tarjetas y suscripciones, con el día en que vencen.</p><button class="btn sm" data-act="new-fixed" data-id="bill">${ic('plus')}Agregar pago fijo</button></div></li>
      <li><span>3</span><div><strong>Tus gastos del día a día</strong><p>Mercado, domicilios, transporte… con el botón verde de +.</p><button class="btn sm" data-act="add-tx">${ic('plus')}Agregar gasto</button></div></li>
    </ol>
    <div class="row"><button class="btn ghost" data-act="demo">Ver la app con datos de ejemplo</button></div>
  </section>`;
}
function demoBanner() {
  return D.demo ? `<div class="banner warn">${ic('info')}<span>Estás viendo <strong>datos de ejemplo</strong>.</span><button class="btn sm" data-act="clear-demo">Empezar con mis datos</button></div>` : '';
}

function viewMovs() {
  const ym = UI.ym, s = summary(ym), q = UI.movSearch.trim().toLowerCase();
  let list = s.tx.filter(t => UI.movFilter === 'all' || t.type === UI.movFilter);
  if (q) list = list.filter(t => (t.note || '').toLowerCase().includes(q) || catOf(t.cat).name.toLowerCase().includes(q));
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const groups = {};
  for (const t of list) (groups[t.date] = groups[t.date] || []).push(t);
  const F = [['all', 'Todos'], ['exp', 'Gastos'], ['inc', 'Ingresos'], ['save', 'Ahorro']];
  return `${demoBanner()}<div class="page-head"><h1>Movimientos</h1><button class="btn primary sm hide-phone" data-act="add-tx">${ic('plus')}Agregar</button></div>${monthBar()}
  <div class="summary-strip">
    <div><span>Entró</span><strong class="num inc-t">${money(s.inc, {sign: true})}</strong></div>
    <div><span>Salió</span><strong class="num exp-t">${money(-s.exp)}</strong></div>
    <div><span>Ahorrado</span><strong class="num sav-t">${money(s.sav)}</strong></div>
  </div>
  <div class="filters">
    <div class="seg-ctl" role="group" aria-label="Filtrar">${F.map(([k, l]) => `<button class="${UI.movFilter === k ? 'on' : ''}" data-act="mov-filter" data-id="${k}" aria-pressed="${UI.movFilter === k}">${l}</button>`).join('')}</div>
    <label class="search">${ic('search')}<input id="mov-search" type="search" placeholder="Buscar" value="${esc(UI.movSearch)}" aria-label="Buscar movimientos"></label>
  </div>
  ${list.length ? Object.entries(groups).map(([d, ts]) => `<section class="day"><div class="day-head"><span>${dayLabel(d)}</span><span class="num">${money(sum(ts, t => t.type === 'inc' ? t.amount : -t.amount), {sign: true})}</span></div><div class="rows card flat">${ts.map(txRow).join('')}</div></section>`).join('')
    : `<div class="card empty"><p>${q || UI.movFilter !== 'all' ? 'Nada coincide con el filtro.' : `Sin movimientos en ${monthName(ym)}.`}</p><button class="btn primary sm" data-act="add-tx">${ic('plus')}Agregar movimiento</button></div>`}`;
}

function viewPagos() {
  const ym = UI.ym, due = fixedDue(ym);
  const K = [['bill', 'Cuentas fijas'], ['sub', 'Suscripciones'], ['inc', 'Ingresos fijos']];
  const bills = due.filter(f => f.kind !== 'inc'), paidB = bills.filter(f => paidTx(f, ym));
  const tot = sum(bills, f => f.amount), paidAmt = sum(paidB, f => paidTx(f, ym).amount);
  const list = due.filter(f => f.kind === UI.pagosTab).sort((a, b) => (a.day || 1) - (b.day || 1));
  const subs = due.filter(f => f.kind === 'sub'), subsT = sum(subs, f => f.amount), unused = subs.filter(f => f.used === false);
  const inactive = D.fixed.filter(f => f.kind === UI.pagosTab && !due.includes(f) && f.end && f.end < ym && f.end !== f.start);
  return `${demoBanner()}<div class="page-head"><h1>Pagos</h1><button class="btn primary sm" data-act="new-fixed" data-id="${UI.pagosTab}">${ic('plus')}${UI.pagosTab === 'inc' ? 'Ingreso fijo' : UI.pagosTab === 'sub' ? 'Suscripción' : 'Cuenta fija'}</button></div>${monthBar()}
  ${bills.length ? `<section class="card pay-sum">
    <div class="ps-top"><div><span class="eyebrow">Pagado</span><strong class="num">${money(paidAmt)}</strong><span class="note"> de ${money(tot)}</span></div><div class="ps-right"><span class="status ${paidB.length === bills.length ? 'good' : 'warn'}">${ic(paidB.length === bills.length ? 'check' : 'clock')}${paidB.length} de ${bills.length} pagos</span></div></div>
    <div class="progress pay"><div style="width:${tot ? paidAmt / tot * 100 : 0}%"></div></div>
    <p class="note">${tot - paidAmt > 0 ? `Te falta pagar <strong class="warn-t">${money(tot - paidAmt)}</strong> este mes.` : 'Todo pagado este mes.'}</p>
  </section>` : ''}
  <div class="seg-ctl wide" role="tablist">${K.map(([k, l]) => `<button role="tab" class="${UI.pagosTab === k ? 'on' : ''}" aria-selected="${UI.pagosTab === k}" data-act="pagos-tab" data-id="${k}">${l} <small>${due.filter(f => f.kind === k).length}</small></button>`).join('')}</div>
  ${UI.pagosTab === 'sub' && subs.length ? `<div class="sub-sum"><div><span>Al mes</span><strong class="num">${money(subsT)}</strong></div><div><span>Al año</span><strong class="num">${money(subsT * 12)}</strong></div><div><span>Sin usar</span><strong class="num ${unused.length ? 'warn-t' : ''}">${unused.length ? money(sum(unused, f => f.amount)) + '/mes' : 'Ninguna'}</strong></div></div>` : ''}
  ${list.length ? `<div class="rows card flat">${list.map(f => fixedRow(f, ym)).join('')}</div>`
    : `<div class="card empty"><p>${UI.pagosTab === 'sub' ? 'Sin suscripciones. Netflix, Spotify, gimnasio, iCloud… agrégalas para ver cuánto te cuestan al año.' : UI.pagosTab === 'inc' ? 'Sin ingresos fijos. Agrega tu salario con el día en que te pagan.' : 'Sin cuentas fijas. Agrega arriendo, servicios, celular, cuotas de tarjeta…'}</p></div>`}
  <p class="note hint">Toca el círculo para marcarlo como ${UI.pagosTab === 'inc' ? 'recibido' : 'pagado'}: se anota solo en tus movimientos. Toca el nombre para editarlo.</p>
  ${inactive.length ? `<details class="card flat"><summary>Ya no activos (${inactive.length})</summary><div class="rows">${inactive.map(f => `<button class="row-item" data-act="edit-fixed" data-id="${f.id}"><span class="emo">${catOf(f.cat).emoji}</span><span class="ri-main"><span class="ri-title">${esc(f.name)}</span><span class="ri-sub">Hasta ${monthName(f.end)}</span></span><span class="amt">${money(f.amount)}</span></button>`).join('')}</div></details>` : ''}`;
}

function viewAnalisis() {
  const ym = UI.ym, s = summary(ym), cats = byCat(ym);
  const months = [5, 4, 3, 2, 1, 0].map(k => addMonths(ym, -k));
  const rows = months.map(m => { const x = summary(m); return {m, inc: x.inc, exp: x.exp, sav: x.sav, bal: x.inc - x.exp - x.sav}; });
  const withData = rows.filter(r => r.inc || r.exp);
  const avgExp = withData.length ? sum(withData, r => r.exp) / withData.length : 0;
  const budgets = D.cats.filter(c => c.type === 'exp' && c.budget > 0 && !cats.find(x => x.cat.id === c.id));
  return `${demoBanner()}<div class="page-head"><h1>Análisis</h1></div>${monthBar()}
  <div class="grid">
    <section class="card span2">
      <div class="card-head"><h3>Ingresos vs gastos</h3><span class="note">Últimos 6 meses</span></div>
      <div class="legend dark"><span><i class="inc"></i>Ingresos</span><span><i class="exp"></i>Gastos</span></div>
      <div class="chart" id="chart-ie" data-rows='${esc(JSON.stringify(rows))}'></div>
      <details class="table-toggle"><summary>Ver como tabla</summary>
        <table class="tbl"><thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Ahorro</th><th>Balance</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${monthName(r.m)}</td><td class="num">${money(r.inc)}</td><td class="num">${money(r.exp)}</td><td class="num">${money(r.sav)}</td><td class="num ${r.bal < 0 ? 'exp-t' : ''}">${money(r.bal)}</td></tr>`).join('')}</tbody></table>
      </details>
      ${avgExp ? `<p class="note">En promedio gastas <strong>${money(avgExp)}</strong> al mes${withData.length > 1 ? ` (${withData.length} meses con datos)` : ''}. ${s.exp ? (s.exp > avgExp ? `Este mes vas <strong class="exp-t">${money(s.exp - avgExp)} por encima</strong>.` : `Este mes vas <strong class="inc-t">${money(avgExp - s.exp)} por debajo</strong>.`) : ''}</p>` : ''}
    </section>
    <section class="card span2">
      <div class="card-head"><h3>Gastos por categoría</h3><span class="note num">${money(s.exp)}</span></div>
      ${catBars(cats, s.exp)}
      ${budgets.length ? `<p class="note">Sin gastos todavía en: ${budgets.map(c => `${c.emoji} ${esc(c.name)} (límite ${money(c.budget)})`).join(', ')}.</p>` : ''}
      <button class="link" data-nav="ajustes">Ponerle un límite a cada categoría ${ic('chevR')}</button>
    </section>
  </div>`;
}

function viewAhorro() {
  const total = sum(D.goals, goalSaved), s = summary(thisYm());
  return `${demoBanner()}<div class="page-head"><h1>Ahorro</h1><button class="btn primary sm" data-act="new-goal">${ic('plus')}Nueva meta</button></div>
  <section class="hero small">
    <span class="eyebrow">Ahorrado en tus metas</span><div class="hero-num num">${money(total)}</div>
    <p class="hero-sub">${s.left > 0 ? `Este mes te sobran ${money(s.left)}. Lo ideal es apartar algo apenas te pagan, antes de gastar.` : s.inc ? 'Este mes no te sobra nada todavía. Revisa en Inicio dónde puedes recortar.' : 'Registra tus ingresos y te digo cuánto puedes apartar.'}</p>
  </section>
  ${D.goals.length ? `<div class="goals">${D.goals.map(g => `<section class="card">${goalCard(g)}</section>`).join('')}</div>`
    : `<div class="card empty"><p>Aún no tienes metas. Por ejemplo: <em>Fondo de emergencia</em> (3 a 6 meses de gastos), un viaje, un computador nuevo…</p><button class="btn primary sm" data-act="new-goal">${ic('plus')}Crear mi primera meta</button></div>`}
  <section class="card tips">
    <h3>Dónde ahorrar</h3>
    ${insightCards(insights(thisYm()).filter(i => i.tone !== 'info' || i.icon === 'repeat'))}
  </section>`;
}

function viewAjustes() {
  const exp = D.cats.filter(c => c.type === 'exp'), inc = D.cats.filter(c => c.type === 'inc');
  const catList = list => `<div class="rows card flat">${list.map(c => `<button class="row-item" data-act="edit-cat" data-id="${c.id}"><span class="emo">${c.emoji}</span><span class="ri-main"><span class="ri-title">${esc(c.name)}</span>${c.type === 'exp' ? `<span class="ri-sub">${c.budget ? 'Límite ' + money(c.budget) + ' al mes' : 'Sin límite'}</span>` : ''}</span>${ic('chevR')}</button>`).join('')}</div>`;
  return `<div class="page-head"><h1>Ajustes</h1></div>
  <div class="grid">
  <section class="card">
    <h3>Moneda</h3>
    <label class="field"><span>Moneda de la app</span><select id="currency">${Object.entries(CURRENCIES).map(([k, c]) => `<option value="${k}" ${D.settings.currency === k ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
  </section>
  <section class="card">
    <h3>Instalar la app</h3>
    <p class="note">Funciona sin internet y se actualiza sola cuando hay conexión.</p>
    ${installPrompt ? `<button class="btn primary sm" data-act="install">${ic('install')}Instalar en este dispositivo</button>` : ''}
    <ul class="howto"><li><strong>iPhone:</strong> en Safari, botón Compartir → “Agregar a inicio”.</li><li><strong>Android:</strong> en Chrome, menú ⋮ → “Instalar app”.</li><li><strong>Computador:</strong> en Chrome o Edge, el ícono de instalar en la barra de direcciones.</li></ul>
  </section>
  <section class="card span2">
    <div class="card-head"><h3>Categorías de gasto</h3><button class="btn sm" data-act="new-cat" data-id="exp">${ic('plus')}Nueva</button></div>
    <p class="note">Ponle un límite mensual a las que quieras controlar: se pone amarilla al 80% y roja cuando te pasas.</p>
    ${catList(exp)}
  </section>
  <section class="card">
    <div class="card-head"><h3>Categorías de ingreso</h3><button class="btn sm" data-act="new-cat" data-id="inc">${ic('plus')}Nueva</button></div>
    ${catList(inc)}
  </section>
  <section class="card">
    <h3>Tus datos</h3>
    <p class="note">Se guardan solo en este dispositivo. Para pasarlos del celular al computador (o tener respaldo), descarga una copia y cárgala en el otro.</p>
    <div class="row"><button class="btn sm" data-act="export">${ic('download')}Descargar copia</button><label class="btn sm">${ic('upload')}Cargar copia<input type="file" id="import" accept="application/json,.json" hidden></label></div>
    <div class="row"><button class="btn sm danger" data-act="reset">${ic('trash')}Borrar todo</button></div>
  </section>
  </div>
  <p class="note center">Mindless Spending · versión ${VERSION}</p>`;
}

/* ---------- Chart: income vs expenses ---------- */
function drawIE() {
  const el = document.getElementById('chart-ie');
  if (!el) return;
  const rows = JSON.parse(el.dataset.rows), W = Math.max(280, el.clientWidth), H = 230, L = 8, R = 8, T = 20, B = 26;
  const max = Math.max(1, ...rows.map(r => Math.max(r.inc, r.exp)));
  const mag = Math.pow(10, Math.floor(Math.log10(max))), nice = [1, 2, 2.5, 5, 10].map(k => k * mag).find(v => v >= max / 4) * 4;
  const y = v => T + (H - T - B) * (1 - v / nice), gw = (W - L - R) / rows.length, bw = Math.min(28, (gw - 18) / 2);
  const bar = (x, v, cls) => { const h = Math.max(0, (H - B) - y(v)); if (h < .5) return ''; const r = Math.min(4, bw / 2, h), yy = H - B - h; return `<path class="${cls}" d="M${x},${H - B}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${H - B}Z"/>`; };
  let g = '';
  for (let i = 1; i <= 4; i++) { const v = nice / 4 * i; g += `<line class="grid-l" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L}" y="${y(v) - 4}">${money(v, {compact: true})}</text>`; }
  g += `<line class="base" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>`;
  rows.forEach((r, i) => {
    const cx = L + gw * i + gw / 2;
    g += `<g class="grp ${r.m === UI.ym ? 'cur' : ''}" data-i="${i}"><rect class="hit" x="${L + gw * i}" y="${T}" width="${gw}" height="${H - T}"/>${bar(cx - bw - 1, r.inc, 'b-inc')}${bar(cx + 1, r.exp, 'b-exp')}<text class="ax mx" x="${cx}" y="${H - 8}" text-anchor="middle">${monthName(r.m, 'short')}</text></g>`;
  });
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ingresos y gastos de los últimos 6 meses">${g}</svg>`;
  el.querySelectorAll('.grp').forEach(n => {
    const r = rows[n.dataset.i];
    n.dataset.tip = `<strong>${monthName(r.m)}</strong><br><span class="dot inc"></span>Ingresos ${money(r.inc)}<br><span class="dot exp"></span>Gastos ${money(r.exp)}<br>Balance ${money(r.inc - r.exp)}`;
    n.dataset.tipHtml = '1';
  });
}

/* ---------- Render ---------- */
function render() {
  const v = UI.view;
  const views = {home: viewHome, movs: viewMovs, pagos: viewPagos, analisis: viewAnalisis, ahorro: viewAhorro, ajustes: viewAjustes};
  $('#main').innerHTML = (views[v] || viewHome)();
  $('#side-nav').innerHTML = NAV.map(([k, l, i]) => `<button class="${v === k ? 'on' : ''}" data-nav="${k}" ${v === k ? 'aria-current="page"' : ''}>${ic(i)}<span>${l}</span></button>`).join('');
  $('#tabbar').innerHTML = NAV.filter(n => n[0] !== 'ajustes').map(([k, l, i]) => `<button class="${v === k ? 'on' : ''}" data-nav="${k}" ${v === k ? 'aria-current="page"' : ''}>${ic(i)}<span>${l === 'Movimientos' ? 'Movs' : l}</span></button>`).join('');
  const s = summary(thisYm());
  $('#side-foot').innerHTML = `<div class="mini-left"><span class="eyebrow">Te queda este mes</span><strong class="num ${s.left < 0 ? 'exp-t' : ''}">${money(s.left)}</strong></div>${installPrompt ? `<button class="btn sm ghost" data-act="install">${ic('install')}Instalar app</button>` : ''}`;
  drawIE();
  const srch = $('#mov-search');
  if (srch) srch.addEventListener('input', () => { UI.movSearch = srch.value; const pos = srch.selectionStart; render(); const n = $('#mov-search'); n.focus(); n.setSelectionRange(pos, pos); });
  const curSel = $('#currency');
  if (curSel) curSel.addEventListener('change', () => { D.settings.currency = curSel.value; save(); render(); toast('Moneda cambiada. Los montos no se convierten.'); });
  const imp = $('#import');
  if (imp) imp.addEventListener('change', importFile);
}

/* ---------- Sheets (forms) ---------- */
let sheetClose = null;
function openSheet(html, onMount) {
  const root = $('#sheet-root'), prev = document.activeElement;
  root.innerHTML = `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.classList.add('locked');
  const sheet = root.querySelector('.sheet');
  root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeSheet));
  const onKey = e => { if (e.key === 'Escape') closeSheet(); };
  document.addEventListener('keydown', onKey);
  sheetClose = () => { document.removeEventListener('keydown', onKey); root.innerHTML = ''; document.body.classList.remove('locked'); if (prev && prev.focus) prev.focus(); };
  onMount && onMount(sheet);
  const f = sheet.querySelector('[autofocus]') || sheet.querySelector('input,select,button');
  if (f) setTimeout(() => f.focus(), 30);
}
function closeSheet() { if (sheetClose) { const f = sheetClose; sheetClose = null; f(); } }
const sheetHead = (title) => `<div class="sh-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Cerrar">${ic('x')}</button></div>`;
function catPicker(type, selected) {
  return `<div class="cat-grid" role="radiogroup" aria-label="Categoría">${D.cats.filter(c => c.type === type).map(c => `<button type="button" role="radio" class="cat-opt ${c.id === selected ? 'on' : ''}" aria-checked="${c.id === selected}" data-cat="${c.id}"><span>${c.emoji}</span><small>${esc(c.name)}</small></button>`).join('')}</div>`;
}
function wireCatPicker(sheet, onPick) {
  sheet.addEventListener('click', e => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    sheet.querySelectorAll('[data-cat]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    onPick(b.dataset.cat);
  });
}
function amountField(id, value, label = 'Monto') {
  return `<label class="field amount"><span>${label}</span><div class="amt-in"><span class="cur-sign">${D.settings.currency === 'EUR' ? '€' : '$'}</span><input id="${id}" inputmode="${cur().dec ? 'decimal' : 'numeric'}" autocomplete="off" placeholder="0" value="${amountInput(value)}" autofocus></div></label>`;
}
function wireAmount(input) {
  input.addEventListener('input', () => {
    if (cur().dec) return;
    const n = parseAmount(input.value);
    input.value = isNaN(n) ? '' : amountInput(n);
  });
}

function txSheet(t, preset = {}) {
  const editing = !!t;
  t = t ? {...t} : {type: preset.type || 'exp', amount: preset.amount || 0, cat: '', date: UI.ym === thisYm() ? todayISO() : `${UI.ym}-01`, note: '', goalId: preset.goalId || (D.goals[0] && D.goals[0].id)};
  let type = t.type, cat = t.cat || (type === "inc" ? "salario" : "mercado");
  const body = () => `
    <div class="seg-ctl wide type-ctl" role="group" aria-label="Tipo">${[['exp', 'Gasto'], ['inc', 'Ingreso'], ['save', 'Ahorro']].map(([k, l]) => `<button type="button" class="${type === k ? 'on ' + k : ''}" data-type="${k}" aria-pressed="${type === k}">${l}</button>`).join('')}</div>
    ${amountField('f-amt', Math.abs(t.amount))}
    ${type === 'save' ? (D.goals.length ? `<label class="field"><span>Meta</span><select id="f-goal">${D.goals.map(g => `<option value="${g.id}" ${g.id === t.goalId ? 'selected' : ''}>${g.emoji} ${esc(g.name)}</option>`).join('')}</select></label>
      <div class="seg-ctl" role="group" aria-label="Aportar o retirar"><button type="button" data-dir="in" class="${t.amount >= 0 ? 'on' : ''}">Aportar</button><button type="button" data-dir="out" class="${t.amount < 0 ? 'on' : ''}">Retirar</button></div>` : `<p class="note">Primero crea una meta de ahorro.</p><button type="button" class="btn sm" data-act="new-goal">${ic('plus')}Crear meta</button>`)
      : `<div class="field"><span>Categoría</span>${catPicker(type === 'inc' ? 'inc' : 'exp', cat)}</div>`}
    <div class="two"><label class="field"><span>Fecha</span><input id="f-date" type="date" value="${t.date}"></label>
    <label class="field"><span>Nota (opcional)</span><input id="f-note" maxlength="60" placeholder="${type === 'inc' ? 'Ej. Pago freelance' : type === 'save' ? 'Ej. Prima' : 'Ej. Domicilio Rappi'}" value="${esc(t.note)}"></label></div>
    <p class="err" id="f-err" hidden></p>
    <div class="sh-actions">${editing ? `<button type="button" class="btn danger" data-del>${ic('trash')}Borrar</button>` : ''}<button type="submit" class="btn primary grow">${editing ? 'Guardar' : 'Agregar'}</button></div>`;
  openSheet(`${sheetHead(editing ? 'Editar movimiento' : 'Nuevo movimiento')}<form id="tx-form" novalidate>${body()}</form>`, sheet => {
    const form = sheet.querySelector('form');
    let dir = t.amount < 0 ? 'out' : 'in';
    const keep = () => { t.amount = parseAmount(form.querySelector('#f-amt').value) || 0; t.date = form.querySelector('#f-date').value; t.note = form.querySelector('#f-note').value; const g = form.querySelector('#f-goal'); if (g) t.goalId = g.value; };
    const redraw = () => { form.innerHTML = body(); wireAmount(form.querySelector('#f-amt')); };
    wireAmount(form.querySelector('#f-amt'));
    wireCatPicker(sheet, id => { cat = id; });
    form.addEventListener('click', e => {
      const tb = e.target.closest('[data-type]');
      if (tb && tb.dataset.type !== type) { keep(); type = tb.dataset.type; cat = (D.cats.find(c => c.type === (type === 'inc' ? 'inc' : 'exp')) || {}).id; redraw(); }
      const db = e.target.closest('[data-dir]');
      if (db) { dir = db.dataset.dir; form.querySelectorAll('[data-dir]').forEach(x => x.classList.toggle('on', x === db)); }
      if (e.target.closest('[data-del]')) { D.tx = D.tx.filter(x => x.id !== t.id); save(); closeSheet(); render(); toast('Movimiento borrado.'); }
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const amt = parseAmount(form.querySelector('#f-amt').value), err = form.querySelector('#f-err');
      const date = form.querySelector('#f-date').value;
      if (!(amt > 0)) { err.textContent = 'Escribe un monto mayor que cero.'; err.hidden = false; form.querySelector('#f-amt').focus(); return; }
      if (!date) { err.textContent = 'Elige una fecha.'; err.hidden = false; return; }
      if (type === 'save' && !D.goals.length) { err.textContent = 'Crea una meta antes de ahorrar.'; err.hidden = false; return; }
      const rec = {id: t.id || uid(), type, amount: type === 'save' && dir === 'out' ? -amt : amt, date, note: form.querySelector('#f-note').value.trim()};
      if (type === 'save') rec.goalId = form.querySelector('#f-goal').value; else rec.cat = cat;
      if (t.fixedId) { rec.fixedId = t.fixedId; rec.forMonth = t.forMonth; }
      if (editing) D.tx = D.tx.map(x => x.id === t.id ? rec : x); else D.tx.push(rec);
      save(); closeSheet();
      if (ymOf(date) !== UI.ym && !editing) UI.ym = ymOf(date);
      render(); toast(editing ? 'Guardado.' : type === 'inc' ? 'Ingreso agregado.' : type === 'save' ? 'Ahorro anotado.' : 'Gasto agregado.');
    });
  });
}

function fixedSheet(f, kind) {
  const editing = !!f;
  f = f ? {...f} : {kind: kind || 'bill', name: '', amount: 0, cat: kind === 'inc' ? 'salario' : kind === 'sub' ? 'subs' : 'vivienda', day: Number(todayISO().slice(8)), start: UI.ym, end: '', used: true};
  let k = f.kind, cat = f.cat, once = !!(f.end && f.end === f.start);
  const body = () => `
    <div class="seg-ctl wide" role="group" aria-label="Tipo">${[['bill', 'Cuenta fija'], ['sub', 'Suscripción'], ['inc', 'Ingreso fijo']].map(([x, l]) => `<button type="button" class="${k === x ? 'on' : ''}" data-kind="${x}" aria-pressed="${k === x}">${l}</button>`).join('')}</div>
    <label class="field"><span>Nombre</span><input id="f-name" maxlength="40" placeholder="${k === 'inc' ? 'Ej. Salario' : k === 'sub' ? 'Ej. Netflix' : 'Ej. Arriendo'}" value="${esc(f.name)}" autofocus></label>
    ${amountField('f-amt', f.amount, k === 'inc' ? 'Monto' : 'Monto aproximado').replace(' autofocus', '')}
    <div class="two"><label class="field"><span>${k === 'inc' ? 'Día en que te pagan' : 'Día en que vence'}</span><input id="f-day" type="number" min="1" max="31" inputmode="numeric" value="${f.day}"></label>
    <label class="field"><span>Se repite</span><select id="f-once"><option value="0" ${once ? '' : 'selected'}>Cada mes</option><option value="1" ${once ? 'selected' : ''}>Solo en ${monthName(f.start)}</option></select></label></div>
    <div class="field"><span>Categoría</span>${catPicker(k === 'inc' ? 'inc' : 'exp', cat)}</div>
    ${k === 'sub' ? `<label class="switch"><input type="checkbox" id="f-used" ${f.used !== false ? 'checked' : ''}><span class="sw"></span><span>La uso de verdad<small>Si la apagas, te la muestro como algo que podrías cancelar.</small></span></label>` : ''}
    <p class="err" id="f-err" hidden></p>
    <div class="sh-actions">${editing ? `<button type="button" class="btn danger" data-del>${ic('trash')}Quitar</button>` : ''}<button type="submit" class="btn primary grow">${editing ? 'Guardar' : 'Agregar'}</button></div>`;
  openSheet(`${sheetHead(editing ? 'Editar ' + (k === 'inc' ? 'ingreso fijo' : k === 'sub' ? 'suscripción' : 'cuenta fija') : k === 'inc' ? 'Nuevo ingreso fijo' : k === 'sub' ? 'Nueva suscripción' : 'Nueva cuenta fija')}<form novalidate>${body()}</form>`, sheet => {
    const form = sheet.querySelector('form');
    const keep = () => { f.name = form.querySelector('#f-name').value; f.amount = parseAmount(form.querySelector('#f-amt').value) || 0; f.day = Number(form.querySelector('#f-day').value) || 1; once = form.querySelector('#f-once').value === '1'; const u = form.querySelector('#f-used'); if (u) f.used = u.checked; };
    wireAmount(form.querySelector('#f-amt'));
    wireCatPicker(sheet, id => { cat = id; });
    form.addEventListener('click', e => {
      const kb = e.target.closest('[data-kind]');
      if (kb && kb.dataset.kind !== k) { keep(); const was = k; k = kb.dataset.kind; if ((was === 'inc') !== (k === 'inc') || k === 'sub') cat = k === 'inc' ? 'salario' : k === 'sub' ? 'subs' : 'vivienda'; form.innerHTML = body(); wireAmount(form.querySelector('#f-amt')); }
      if (e.target.closest('[data-del]')) {
        const ym = UI.ym, paidBefore = D.tx.some(t => t.fixedId === f.id);
        if (!paidBefore || f.start >= ym) { D.fixed = D.fixed.filter(x => x.id !== f.id); }
        else D.fixed = D.fixed.map(x => x.id === f.id ? {...x, end: addMonths(ym, -1)} : x);
        save(); closeSheet(); render();
        toast(paidBefore && f.start < ym ? `Quitado desde ${monthName(ym)}. Los meses anteriores quedan igual.` : 'Quitado.');
      }
    });
    form.addEventListener('submit', e => {
      e.preventDefault(); keep();
      const err = form.querySelector('#f-err');
      if (!f.name.trim()) { err.textContent = 'Ponle un nombre.'; err.hidden = false; return; }
      if (!(f.amount > 0)) { err.textContent = 'Escribe un monto mayor que cero.'; err.hidden = false; return; }
      const rec = {id: f.id || uid(), kind: k, name: f.name.trim(), amount: f.amount, cat, day: Math.min(31, Math.max(1, f.day)), start: f.start, end: once ? f.start : (f.end && f.end !== f.start ? f.end : ''), active: true};
      if (k === 'sub') rec.used = f.used !== false;
      if (editing) D.fixed = D.fixed.map(x => x.id === f.id ? rec : x); else D.fixed.push(rec);
      save(); closeSheet(); UI.pagosTab = k; render(); toast(editing ? 'Guardado.' : 'Agregado. Ya aparece en Pagos.');
    });
  });
}

function goalSheet(g) {
  const editing = !!g;
  g = g ? {...g} : {name: '', emoji: '🎯', target: 0, deadline: ''};
  const EMO = ['🎯', '🛟', '✈️', '🏠', '🚗', '💻', '🎓', '💍', '🎁', '🏖️', '📱', '🐶'];
  openSheet(`${sheetHead(editing ? 'Editar meta' : 'Nueva meta de ahorro')}<form novalidate>
    <label class="field"><span>¿Para qué ahorras?</span><input id="g-name" maxlength="40" placeholder="Ej. Fondo de emergencia" value="${esc(g.name)}" autofocus></label>
    <div class="field"><span>Ícono</span><div class="emo-pick">${EMO.map(e => `<button type="button" class="${e === g.emoji ? 'on' : ''}" data-emo="${e}" aria-label="${e}">${e}</button>`).join('')}</div></div>
    ${amountField('g-amt', g.target, 'Cuánto quieres juntar').replace(' autofocus', '')}
    <label class="field"><span>¿Para cuándo? (opcional)</span><input id="g-date" type="month" value="${g.deadline || ''}" min="${thisYm()}"></label>
    <p class="note">Con una fecha te digo cuánto apartar cada mes.</p>
    <p class="err" id="f-err" hidden></p>
    <div class="sh-actions">${editing ? `<button type="button" class="btn danger" data-del>${ic('trash')}Borrar meta</button>` : ''}<button type="submit" class="btn primary grow">${editing ? 'Guardar' : 'Crear meta'}</button></div>
  </form>`, sheet => {
    const form = sheet.querySelector('form');
    wireAmount(form.querySelector('#g-amt'));
    form.addEventListener('click', e => {
      const b = e.target.closest('[data-emo]');
      if (b) { g.emoji = b.dataset.emo; form.querySelectorAll('[data-emo]').forEach(x => x.classList.toggle('on', x === b)); }
      if (e.target.closest('[data-del]')) {
        if (!confirm('¿Borrar esta meta? Los aportes que hiciste también se borran de tus movimientos.')) return;
        D.goals = D.goals.filter(x => x.id !== g.id); D.tx = D.tx.filter(t => t.goalId !== g.id); save(); closeSheet(); render(); toast('Meta borrada.');
      }
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = form.querySelector('#g-name').value.trim(), target = parseAmount(form.querySelector('#g-amt').value), err = form.querySelector('#f-err');
      if (!name) { err.textContent = 'Ponle un nombre a la meta.'; err.hidden = false; return; }
      if (!(target > 0)) { err.textContent = 'Escribe cuánto quieres juntar.'; err.hidden = false; return; }
      const rec = {id: g.id || uid(), name, emoji: g.emoji, target, deadline: form.querySelector('#g-date').value || ''};
      if (editing) D.goals = D.goals.map(x => x.id === g.id ? rec : x); else D.goals.push(rec);
      save(); closeSheet(); render(); toast(editing ? 'Guardado.' : 'Meta creada.');
    });
  });
}

function catSheet(c, type) {
  const editing = !!c;
  c = c ? {...c} : {name: '', emoji: type === 'inc' ? '💰' : '🏷️', type, budget: 0};
  const used = editing && (D.tx.some(t => t.cat === c.id) || D.fixed.some(f => f.cat === c.id));
  openSheet(`${sheetHead(editing ? 'Editar categoría' : 'Nueva categoría')}<form novalidate>
    <div class="two narrow-first"><label class="field"><span>Emoji</span><input id="c-emo" maxlength="4" value="${esc(c.emoji)}"></label>
    <label class="field"><span>Nombre</span><input id="c-name" maxlength="36" value="${esc(c.name)}" autofocus></label></div>
    ${c.type === 'exp' ? amountField('c-bud', c.budget, 'Límite al mes (opcional)').replace(' autofocus', '') : ''}
    <p class="err" id="f-err" hidden></p>
    <div class="sh-actions">${editing && !used ? `<button type="button" class="btn danger" data-del>${ic('trash')}Borrar</button>` : ''}<button type="submit" class="btn primary grow">Guardar</button></div>
    ${editing && used ? '<p class="note">Esta categoría tiene movimientos, por eso no se puede borrar.</p>' : ''}
  </form>`, sheet => {
    const form = sheet.querySelector('form'), bud = form.querySelector('#c-bud');
    if (bud) wireAmount(bud);
    form.addEventListener('click', e => { if (e.target.closest('[data-del]')) { D.cats = D.cats.filter(x => x.id !== c.id); save(); closeSheet(); render(); toast('Categoría borrada.'); } });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = form.querySelector('#c-name').value.trim(), err = form.querySelector('#f-err');
      if (!name) { err.textContent = 'Ponle un nombre.'; err.hidden = false; return; }
      const b = bud ? parseAmount(bud.value) : 0;
      const rec = {id: c.id || uid(), type: c.type, name, emoji: form.querySelector('#c-emo').value.trim() || '🏷️', budget: b > 0 ? b : 0};
      if (editing) D.cats = D.cats.map(x => x.id === c.id ? rec : x); else D.cats.push(rec);
      save(); closeSheet(); render(); toast('Guardado.');
    });
  });
}

/* ---------- Actions ---------- */
function togglePay(id) {
  const f = D.fixed.find(x => x.id === id), ym = UI.ym, p = paidTx(f, ym);
  if (p) { D.tx = D.tx.filter(t => t !== p); save(); render(); toast(f.kind === 'inc' ? 'Marcado como no recibido.' : 'Marcado como no pagado.'); return; }
  const date = ym === thisYm() ? todayISO() : dueDate(f, ym);
  const t = {id: uid(), type: f.kind === 'inc' ? 'inc' : 'exp', amount: f.amount, cat: f.cat, date, note: f.name, fixedId: f.id, forMonth: ym};
  D.tx.push(t); save(); render();
  toast(f.kind === 'inc' ? `${f.name}: recibido.` : `${f.name}: pagado.`, {label: '¿Otro valor?', run: () => txSheet(D.tx.find(x => x.id === t.id))});
}
function exportData() {
  const blob = new Blob([JSON.stringify(D, null, 1)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `mindless-spending-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Copia descargada.');
}
function importFile(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || d.v !== 1 || !Array.isArray(d.tx)) throw new Error('bad');
      if (!confirm('Esto reemplaza los datos de este dispositivo por los de la copia. ¿Seguir?')) return;
      D = d; save(); render(); toast('Copia cargada.');
    } catch (err) { toast('Ese archivo no es una copia de Mindless Spending.'); }
  };
  r.readAsText(file);
}

function loadDemo() {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const d = fresh(D.settings.currency), now = thisYm(), today = Number(todayISO().slice(8)), k = cur().dec ? 1 / 4000 : 1;
  const A = n => cur().dec ? Math.round(n * k * 100) / 100 : Math.round(n / 100) * 100;
  const F = (kind, name, amount, cat, day, extra = {}) => ({id: uid(), kind, name, amount: A(amount), cat, day, start: addMonths(now, -5), end: '', active: true, ...extra});
  d.fixed = [
    F('inc', 'Salario', 4200000, 'salario', 1), F('bill', 'Arriendo', 1350000, 'vivienda', 5), F('bill', 'Luz y agua', 185000, 'servicios', 18),
    F('bill', 'Internet', 95000, 'servicios', 22), F('bill', 'Plan celular', 65000, 'celular', 12), F('bill', 'Cuota tarjeta', 280000, 'deudas', 28),
    F('sub', 'Netflix', 44900, 'subs', 9, {used: true}), F('sub', 'Spotify', 18900, 'subs', 14, {used: true}), F('sub', 'Disney+', 32900, 'subs', 20, {used: false}), F('sub', 'Gimnasio', 120000, 'salud', 3, {used: false}),
  ];
  d.goals = [{id: uid(), name: 'Fondo de emergencia', emoji: '🛟', target: A(6000000), deadline: ''}, {id: uid(), name: 'Viaje de fin de año', emoji: '✈️', target: A(3000000), deadline: addMonths(now, 2)}];
  const add = (type, amount, cat, date, note, extra = {}) => d.tx.push({id: uid(), type, amount: A(amount), cat, date, note, ...extra});
  const daily = [['mercado', 'Mercado', 90000, 180000, 4], ['comida', 'Domicilio', 25000, 60000, 7], ['transporte', 'Uber', 9000, 25000, 9], ['ocio', 'Salida con amigos', 40000, 120000, 2], ['comida', 'Almuerzo', 15000, 30000, 6], ['ropa', '', 60000, 180000, 1]];
  for (let m = 5; m >= 0; m--) {
    const ym = addMonths(now, -m), last = m === 0 ? today : daysIn(ym);
    for (const f of d.fixed) if (f.day <= last && (m > 0 || f.day <= today)) add(f.kind === 'inc' ? 'inc' : 'exp', f.amount * (f.cat === 'servicios' && f.name !== 'Internet' ? .85 + rnd() * .3 : 1), f.cat, `${ym}-${pad(f.day)}`, f.name, {fixedId: f.id, forMonth: ym});
    for (const [cat, note, lo, hi, n] of daily) for (let i = 0; i < n * (m === 0 ? today / daysIn(ym) * 1.15 : 1); i++) { const day = 1 + Math.floor(rnd() * last); add('exp', lo + rnd() * (hi - lo), cat, `${ym}-${pad(day)}`, note); }
    if (m % 3 === 1) add('inc', 450000, 'extra', `${ym}-${pad(Math.min(last, 15))}`, 'Trabajo freelance');
    if (m > 0 || today >= 2) add('save', 300000, null, `${ym}-02`, '', {goalId: d.goals[0].id, cat: undefined});
    if (m > 0 && m < 4) add('save', 250000, null, `${ym}-03`, '', {goalId: d.goals[1].id, cat: undefined});
  }
  // this month a little heavy on deliveries, so the comparison insight shows up
  for (let i = 0; i < 2; i++) add('exp', 42000, 'comida', `${now}-${pad(Math.max(1, today - i))}`, 'Domicilio');
  d.cats.find(c => c.id === 'comida').budget = A(450000);
  d.cats.find(c => c.id === 'mercado').budget = A(700000);
  d.demo = true;
  D = d; save(); render(); toast('Datos de ejemplo cargados.');
}

document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { closeSheet(); go(nav.dataset.nav); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const id = a.dataset.id;
  switch (a.dataset.act) {
    case 'add-tx': txSheet(); break;
    case 'edit-tx': txSheet(D.tx.find(t => t.id === id)); break;
    case 'month': UI.ym = addMonths(UI.ym, Number(a.dataset.d)); render(); break;
    case 'month-now': UI.ym = thisYm(); render(); break;
    case 'pay': togglePay(id); break;
    case 'new-fixed': closeSheet(); fixedSheet(null, id); break;
    case 'edit-fixed': fixedSheet(D.fixed.find(f => f.id === id)); break;
    case 'new-goal': closeSheet(); goalSheet(); break;
    case 'edit-goal': goalSheet(D.goals.find(g => g.id === id)); break;
    case 'contrib': {
      const t = {type: 'save', amount: Number(a.dataset.amount) || 0, goalId: id};
      txSheet(null, t);
      if (a.dataset.mode === 'out') setTimeout(() => { const b = document.querySelector('[data-dir="out"]'); if (b) b.click(); }, 0);
      break;
    }
    case 'nav': go(id); break;
    case 'filter-movs': UI.movFilter = id; go('movs'); break;
    case 'mov-filter': UI.movFilter = id; render(); break;
    case 'pagos-tab': UI.pagosTab = id; render(); break;
    case 'new-cat': catSheet(null, id); break;
    case 'edit-cat': catSheet(D.cats.find(c => c.id === id)); break;
    case 'export': exportData(); break;
    case 'reset': if (confirm('¿Borrar todos tus datos de este dispositivo? No se puede deshacer. (Descarga una copia antes si la quieres.)')) { D = fresh(D.settings.currency); save(); go('home'); toast('Datos borrados.'); } break;
    case 'demo': loadDemo(); break;
    case 'clear-demo': D = fresh(D.settings.currency); save(); go('home'); toast('Listo, empieza con tus datos.'); break;
    case 'install': if (installPrompt) { installPrompt.prompt(); installPrompt.userChoice.finally(() => { installPrompt = null; render(); }); } break;
  }
});

/* ---------- Toast & tooltip ---------- */
let toastT;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="link">${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.run(); };
  t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, action ? 5000 : 2600);
}
const tip = $('#tip');
function showTip(el, x, y) {
  const html = el.dataset.tipHtml ? el.dataset.tip : esc(el.dataset.tip);
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2)) + 'px';
  tip.style.top = Math.max(8, y - r.height - 14) + 'px';
}
document.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest('[data-tip]');
  if (el) showTip(el, e.clientX, e.clientY); else tip.hidden = true;
});
document.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  const el = e.target.closest('.grp[data-tip], .cb[data-tip], .seg[data-tip]');
  if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left + r.width / 2, r.top); } else tip.hidden = true;
});
document.addEventListener('scroll', () => { tip.hidden = true; }, {passive: true});
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(drawIE, 120); });

/* ---------- Install & offline ---------- */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; render(); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

/* ---------- Start ---------- */
try { const v = sessionStorage.getItem('cc-view'); if (v) UI.view = v; } catch (e) {}
render();
try {
  const last = localStorage.getItem('cc-version');
  if (last && last !== VERSION) toast('La app se actualizó.');
  localStorage.setItem('cc-version', VERSION);
} catch (e) {}
