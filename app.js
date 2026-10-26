/* Mindless Spending — all app logic. Data lives in localStorage on each device (no account, no server).
   Money lives in accounts, each with its own currency (e.g. EUR bank, COP savings). Totals show in the chosen view currency,
   converted with the day's exchange rate. Transfers and debt payments between currencies keep both real amounts.
   Views: home, movs, pagos (fixed bills, subscriptions, fixed income), cuentas (accounts, debts, rate), analisis, ahorro (goals), ajustes. */
'use strict';
const VERSION = '2.1.0';
const KEY = 'mindless-spending-v1';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sum = (arr, f = x => x) => arr.reduce((a, x) => a + f(x), 0);

/* ---------- Data ---------- */
const CURRENCIES = {
  EUR: {locale: 'es-ES', dec: 2, label: 'Euro', sign: '€'},
  COP: {locale: 'es-CO', dec: 0, label: 'Peso colombiano', sign: '$'},
  USD: {locale: 'es-US', dec: 2, label: 'Dólar estadounidense', sign: 'US$'},
  MXN: {locale: 'es-MX', dec: 2, label: 'Peso mexicano', sign: 'MX$'},
  GBP: {locale: 'en-GB', dec: 2, label: 'Libra esterlina', sign: '£'},
};
// Units per 1 EUR. Used until the first online update.
const FALLBACK_RATES = {EUR: 1, COP: 4600, USD: 1.08, MXN: 20, GBP: 0.85};
const DEFAULT_CATS = [
  ['vivienda', 'Vivienda', '🏠', 'exp'], ['mercado', 'Mercado', '🛒', 'exp'], ['comida', 'Restaurantes y domicilios', '🍔', 'exp'],
  ['transporte', 'Transporte', '🚌', 'exp'], ['servicios', 'Servicios (luz, agua, gas, internet)', '💡', 'exp'], ['celular', 'Celular', '📱', 'exp'],
  ['salud', 'Salud', '💊', 'exp'], ['subs', 'Suscripciones', '📺', 'exp'], ['ropa', 'Ropa y cuidado personal', '👕', 'exp'],
  ['ocio', 'Ocio y salidas', '🎉', 'exp'], ['educacion', 'Educación', '📚', 'exp'], ['deudas', 'Deudas y tarjetas', '💳', 'exp'],
  ['regalos', 'Regalos', '🎁', 'exp'], ['envios', 'Envíos y comisiones', '🔁', 'exp'], ['otros', 'Otros gastos', '📦', 'exp'],
  ['salario', 'Salario', '💼', 'inc'], ['extra', 'Ingresos extra', '💸', 'inc'], ['otrosinc', 'Otros ingresos', '➕', 'inc'],
].map(([id, name, emoji, type]) => ({id, name, emoji, type, budget: 0}));

function fresh(main = 'EUR', second = 'COP') {
  return {
    v: 2,
    settings: {main, second, view: main, rates: {...FALLBACK_RATES}, ratesAt: '', ratesManual: false, lastAcc: 'acc-main'},
    accounts: [
      {id: 'acc-main', name: `Cuenta en ${main === 'EUR' ? 'euros' : main}`, emoji: '🏦', cur: main, initial: 0},
      {id: 'acc-second', name: second === 'COP' ? 'Cuenta en Colombia' : `Cuenta en ${second}`, emoji: '🇨🇴', cur: second, initial: 0},
    ],
    cats: DEFAULT_CATS.map(c => ({...c})), tx: [], fixed: [], goals: [], debts: [],
  };
}
function migrate(d) {
  if (d.v === 2) return d;
  if (d.v !== 1) return null;
  const c = d.settings.currency || 'COP';
  const n = fresh(c, c === 'EUR' ? 'COP' : 'EUR');
  n.accounts = [{id: 'acc-main', name: 'Cuenta principal', emoji: '🏦', cur: c, initial: 0}];
  n.cats = d.cats;
  if (!n.cats.find(x => x.id === 'envios')) n.cats.splice(n.cats.findIndex(x => x.id === 'otros'), 0, {id: 'envios', name: 'Envíos y comisiones', emoji: '🔁', type: 'exp', budget: 0});
  n.tx = d.tx.map(t => ({...t, acc: 'acc-main', cur: c}));
  n.fixed = d.fixed.map(f => ({...f, acc: 'acc-main', cur: c}));
  n.goals = d.goals.map(g => ({...g, cur: c}));
  n.demo = d.demo;
  return n;
}
function load() {
  try { const d = migrate(JSON.parse(localStorage.getItem(KEY))); if (d) return d; } catch (e) {}
  return fresh();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) { toast('No se pudo guardar en este dispositivo.'); } }
let D = load();

/* ---------- Currencies ---------- */
const MAIN = () => D.settings.main, SECOND = () => D.settings.second;
const VIEW = () => D.settings.view || MAIN();
const OTHER = c => c === MAIN() ? SECOND() : MAIN();
const curInfo = c => CURRENCIES[c] || CURRENCIES.EUR;
const usedCurs = () => [...new Set([MAIN(), SECOND(), ...D.accounts.map(a => a.cur), ...D.debts.map(d => d.cur)])];
function conv(a, from, to = VIEW()) {
  if (!a || from === to) return a || 0;
  const R = D.settings.rates;
  return a / (R[from] || FALLBACK_RATES[from]) * (R[to] || FALLBACK_RATES[to]);
}
const roundCur = (a, c) => curInfo(c).dec ? Math.round(a * 100) / 100 : Math.round(a);
function money(n, opt = {}) {
  const code = opt.cur || VIEW(), c = curInfo(code), a = Math.abs(n);
  const dec = opt.compact ? 1 : (Math.abs(a - Math.round(a)) > .004 ? c.dec : 0);
  const s = new Intl.NumberFormat(c.locale, {style: 'currency', currency: code, currencyDisplay: 'narrowSymbol', minimumFractionDigits: opt.compact ? 0 : dec, maximumFractionDigits: dec, notation: opt.compact ? 'compact' : 'standard'}).format(a);
  const tag = opt.code ? ' ' + code : '';
  return (n < 0 ? '−' : opt.sign && n > 0 ? '+' : '') + s + tag;
}
// Amount in its own currency, plus "≈ value" in the view currency when they differ.
const approx = (n, c, to = VIEW()) => c === to ? '' : `≈ ${money(conv(n, c, to), {cur: to})}`;
function parseAmount(s, c) {
  s = String(s).trim().replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (curInfo(c).dec === 0) return Number(s.replace(/[.,]/g, ''));
  const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  if (last > -1 && s.length - last - 1 <= 2) return Number(s.slice(0, last).replace(/[.,]/g, '') + '.' + s.slice(last + 1));
  return Number(s.replace(/[.,]/g, ''));
}
const amountInput = (n, c) => n ? new Intl.NumberFormat(curInfo(c).locale, {maximumFractionDigits: curInfo(c).dec, useGrouping: true}).format(n) : '';
function rateText(a = MAIN(), b = SECOND()) {
  const n = conv(1, a, b) < .1 ? 1000 : 1, r = conv(n, a, b);
  return `${n === 1 ? 1 : '1.000'} ${n === 1 ? curInfo(a).sign : a} = ${money(r, {cur: b})} ${b}`;
}
async function fetchRates(force) {
  const s = D.settings;
  if (s.ratesManual && !force) return false;
  if (!force && s.ratesAt && Date.now() - new Date(s.ratesAt) < 6 * 36e5) return false;
  const sources = [
    ['https://open.er-api.com/v6/latest/EUR', j => j.rates],
    ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json', j => j.eur && Object.fromEntries(Object.entries(j.eur).map(([k, v]) => [k.toUpperCase(), v]))],
  ];
  for (const [url, pick] of sources) {
    try {
      const r = await fetch(url, {cache: 'no-store'});
      const src = pick(await r.json());
      if (!src || !src.COP) continue;
      const next = {EUR: 1};
      for (const k of Object.keys(CURRENCIES)) if (k !== 'EUR') next[k] = src[k] || s.rates[k] || FALLBACK_RATES[k];
      s.rates = next; s.ratesAt = new Date().toISOString(); s.ratesManual = false;
      save(); render();
      return true;
    } catch (e) {}
  }
  return false;
}
function ratesAge() {
  const s = D.settings;
  if (s.ratesManual) return 'puesta a mano';
  if (!s.ratesAt) return 'aproximada, sin actualizar todavía';
  const d = new Date(s.ratesAt), t = new Date();
  const hm = d.toLocaleTimeString('es', {hour: '2-digit', minute: '2-digit'});
  return d.toDateString() === t.toDateString() ? `actualizada hoy ${hm}` : `actualizada el ${d.toLocaleDateString('es', {day: 'numeric', month: 'short'})}`;
}

/* ---------- Dates ---------- */
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

/* ---------- Derived numbers (in the view currency unless said otherwise) ---------- */
const catOf = id => D.cats.find(c => c.id === id) || {id, name: 'Sin categoría', emoji: '❔', type: 'exp', budget: 0};
const accOf = id => D.accounts.find(a => a.id === id) || D.accounts[0] || {id, name: 'Cuenta', emoji: '🏦', cur: MAIN(), initial: 0};
const fixedDue = ym => D.fixed.filter(f => f.active !== false && f.start <= ym && (!f.end || f.end >= ym));
const paidTx = (f, ym) => D.tx.find(t => t.fixedId === f.id && t.forMonth === ym);
const txIn = ym => D.tx.filter(t => ymOf(t.date) === ym);
const tv = (t, to = VIEW()) => conv(t.amount, t.cur, to);
const catTotal = (ym, id, to = VIEW()) => sum(D.tx.filter(t => t.type === 'exp' && t.cat === id && ymOf(t.date) === ym), t => tv(t, to));
const goalSaved = g => sum(D.tx.filter(t => t.type === 'save' && t.goalId === g.id), t => t.goalAmount ?? conv(t.amount, t.cur, g.cur));
const debtPaid = d => sum(D.tx.filter(t => t.debtId === d.id), t => t.debtAmount ?? conv(t.amount, t.cur, d.cur));
const debtLeft = d => Math.max(0, d.total - debtPaid(d));
const hasMonthData = ym => D.tx.some(t => ymOf(t.date) === ym && t.type !== 'transfer');
function accBalance(a) {
  let b = a.initial || 0;
  for (const t of D.tx) {
    if (t.acc === a.id) b += t.type === 'inc' ? t.amount : -t.amount;
    if (t.type === 'transfer' && t.to === a.id) b += t.toAmount;
  }
  return b;
}
const budgetIn = (c, to = VIEW()) => conv(c.budget, MAIN(), to);

function summary(ym) {
  const tx = txIn(ym);
  let inc = 0, exp = 0, sav = 0;
  for (const t of tx) { const v = tv(t); if (t.type === 'inc') inc += v; else if (t.type === 'exp') exp += v; else if (t.type === 'save') sav += v; }
  const due = fixedDue(ym), pendList = [];
  let pend = 0, pendInc = 0;
  for (const f of due) if (!paidTx(f, ym)) { const v = conv(f.amount, f.cur); if (f.kind === 'inc') pendInc += v; else pend += v; pendList.push(f); }
  pendList.sort((a, b) => (a.day || 1) - (b.day || 1));
  return {tx, inc, exp, sav, pend, pendInc, left: inc - exp - sav - pend, due, pendList};
}
function byCat(ym) {
  const m = {};
  for (const t of D.tx) if (t.type === 'exp' && ymOf(t.date) === ym) m[t.cat] = (m[t.cat] || 0) + tv(t);
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
    out.push({tone: 'warn', icon: 'x', title: `Cancela ${f.name}`, text: `Marcaste que no la usas: son ${money(f.amount, {cur: f.cur})} al mes, ${money(f.amount * 12, {cur: f.cur})} al año.`, act: 'edit-fixed', id: f.id, cta: 'Revisar'});
  for (const c of D.cats.filter(c => c.type === 'exp' && c.budget > 0)) {
    const v = catTotal(ym, c.id), b = budgetIn(c);
    if (v > b) out.push({tone: 'bad', icon: 'alert', title: `Te pasaste en ${c.emoji} ${c.name}`, text: `Llevas ${money(v)} de un límite de ${money(b)}: ${money(v - b)} de más.`});
    else if (v >= b * .8) out.push({tone: 'warn', icon: 'alert', title: `Casi llegas al límite de ${c.emoji} ${c.name}`, text: `Te quedan ${money(b - v)} de los ${money(b)} que te pusiste.`});
  }
  const prev = [1, 2, 3].map(k => addMonths(ym, -k)).filter(hasMonthData);
  if (prev.length) {
    const ups = [];
    for (const {cat, v} of byCat(ym)) {
      if (cat.budget > 0 && v > budgetIn(cat) * .8) continue;
      const avg = sum(prev, m => catTotal(m, cat.id)) / prev.length;
      if (avg > 0 && v > avg * 1.25 && v - avg > (s.inc || v) * .03) ups.push({cat, v, avg});
    }
    ups.sort((a, b) => (b.v - b.avg) - (a.v - a.avg));
    for (const u of ups.slice(0, 2)) out.push({tone: 'warn', icon: 'up', title: `${u.cat.emoji} ${u.cat.name}: ${pct(u.v / u.avg - 1)} más que tu promedio`, text: `Normalmente gastas ${money(u.avg)} y este mes vas en ${money(u.v)}. Ahí hay ${money(u.v - u.avg)} para recortar.`});
  }
  if (s.left > 0 && s.inc > 0) {
    const g = D.goals.find(g => goalSaved(g) < g.target);
    const half = roundCur(s.left / 2, VIEW());
    out.push(g
      ? {tone: 'good', icon: 'target', title: `Te sobran ${money(s.left)}`, text: `Si apartas la mitad (${money(half)}) para ${g.emoji} ${g.name}, quedas en ${pct(Math.min(1, (goalSaved(g) + conv(half, VIEW(), g.cur)) / g.target))} de tu meta.`, act: 'contrib', id: g.id, amount: half, cta: `Apartar ${money(half)}`}
      : {tone: 'good', icon: 'target', title: `Te sobran ${money(s.left)}`, text: 'Crea una meta de ahorro y aparta una parte antes de que se vaya en otras cosas.', act: 'new-goal', cta: 'Crear meta'});
  }
  const debts = D.debts.filter(d => debtLeft(d) > 0);
  if (debts.length) {
    const t = sum(debts, d => conv(debtLeft(d), d.cur));
    out.push({tone: 'info', icon: 'card', title: `Te faltan ${money(t)} de deudas`, text: debts.map(d => `${d.name}: ${money(debtLeft(d), {cur: d.cur})}`).join(' · '), act: 'nav', id: 'cuentas', cta: 'Ver deudas'});
  }
  const subs = fixedDue(ym).filter(f => f.kind === 'sub');
  if (subs.length) { const t = sum(subs, f => conv(f.amount, f.cur)); out.push({tone: 'info', icon: 'repeat', title: `Suscripciones: ${money(t)} al mes`, text: `Tienes ${subs.length} activa${subs.length > 1 ? 's' : ''}, ${money(t * 12)} al año. Marca en Pagos las que no usas.`, act: 'nav', id: 'pagos', cta: 'Ver suscripciones'}); }
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
  wallet: 'M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V18a2 2 0 0 0 2 2h14V8H6.5A2.5 2.5 0 0 1 4 5.5M16.5 14h.01',
  card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  gear: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  plus: 'M12 5v14M5 12h14',
  chevL: 'M15 6l-6 6 6 6', chevR: 'M9 6l6 6-6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  x: 'M6 6l12 12M18 6 6 18',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
  alert: 'M12 3.5 2.5 20h19zM12 10v4.5M12 17.2h.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  install: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3',
  menu: 'M4 7h16M4 12h16M4 17h10',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n]}"/></svg>`;

/* ---------- UI state ---------- */
const UI = {view: 'home', ym: thisYm(), movFilter: 'all', movSearch: '', pagosTab: 'bill'};
const NAV = [['home', 'Inicio', 'home'], ['movs', 'Movimientos', 'list'], ['pagos', 'Pagos', 'calendar'], ['cuentas', 'Cuentas', 'wallet'], ['analisis', 'Análisis', 'chart'], ['ahorro', 'Ahorro', 'target'], ['ajustes', 'Ajustes', 'gear']];

function go(view) {
  UI.view = view;
  try { sessionStorage.setItem('ms-view', view); } catch (e) {}
  render();
  window.scrollTo(0, 0);
}

/* ---------- Pieces ---------- */
function curToggle() {
  const cs = [MAIN(), SECOND()].filter((c, i, a) => a.indexOf(c) === i);
  if (cs.length < 2) return '';
  return `<div class="seg-ctl cur-ctl" role="group" aria-label="Ver totales en">${cs.map(c => `<button class="${VIEW() === c ? 'on' : ''}" data-act="view-cur" data-id="${c}" aria-pressed="${VIEW() === c}">${c}</button>`).join('')}</div>`;
}
function monthBar(noMonth) {
  const isNow = UI.ym === thisYm();
  return `<div class="monthbar">
    ${noMonth ? '' : `<button class="icon-btn" data-act="month" data-d="-1" aria-label="Mes anterior">${ic('chevL')}</button>
    <div class="mb-label"><span class="eyebrow">${isNow ? 'Este mes' : UI.ym < thisYm() ? 'Mes pasado' : 'Mes futuro'}</span><strong>${monthName(UI.ym)}</strong></div>
    <button class="icon-btn" data-act="month" data-d="1" aria-label="Mes siguiente">${ic('chevR')}</button>
    ${isNow ? '' : `<button class="chip" data-act="month-now">Hoy</button>`}`}
    <span class="mb-right">${curToggle()}</span>
  </div>`;
}
function amtCell(n, c, cls, opt = {}) {
  const a = approx(Math.abs(n), c);
  return `<span class="amt-wrap"><span class="amt ${cls}">${money(n, {cur: c, sign: opt.sign})}</span>${a ? `<small class="approx">${a}</small>` : ''}</span>`;
}
function txRow(t) {
  const c = catOf(t.cat), a = accOf(t.acc);
  if (t.type === 'transfer') {
    const to = accOf(t.to);
    return `<button class="row-item" data-act="edit-transfer" data-id="${t.id}">
      <span class="emo">${ic('swap')}</span>
      <span class="ri-main"><span class="ri-title">${esc(t.note || 'Transferencia')}</span><span class="ri-sub">${esc(a.name)} → ${esc(to.name)}</span></span>
      <span class="amt-wrap"><span class="amt">${money(-t.amount, {cur: t.cur})}</span><small class="approx inc-t">${money(t.toAmount, {cur: t.toCur, sign: true})}</small></span>
    </button>`;
  }
  const g = t.goalId && D.goals.find(g => g.id === t.goalId), debt = t.debtId && D.debts.find(d => d.id === t.debtId);
  const title = t.type === 'save' ? (t.amount < 0 ? 'Retiro de ' : 'Ahorro para ') + (g ? g.name : 'meta') : debt ? `Abono a ${debt.name}` : (t.note || c.name);
  const sub = [t.type === 'save' ? (t.note || 'Ahorro') : debt ? (t.note || c.name) : (t.note ? c.name : (t.type === 'inc' ? 'Ingreso' : 'Gasto')), a.name].filter(Boolean).join(' · ');
  const emoji = t.type === 'save' ? (g ? g.emoji : '🎯') : debt ? (debt.emoji || '💳') : c.emoji;
  return `<button class="row-item" data-act="edit-tx" data-id="${t.id}">
    <span class="emo">${emoji}</span>
    <span class="ri-main"><span class="ri-title">${esc(title)}</span><span class="ri-sub">${esc(sub)}${t.fixedId ? ' · fijo' : ''}</span></span>
    ${amtCell(t.type === 'inc' ? t.amount : -t.amount, t.cur, t.type, {sign: true})}
  </button>`;
}
const STATUS = {paid: ['good', 'check', 'Pagado'], late: ['bad', 'alert', 'Vencido'], soon: ['warn', 'clock', 'Vence pronto'], pending: ['warn', 'clock', 'Pendiente']};
function fixedRow(f, ym) {
  const st = fixedStatus(f, ym), isInc = f.kind === 'inc';
  let [tone, icon, label] = STATUS[st];
  if (isInc) label = st === 'paid' ? 'Recibido' : st === 'late' ? 'Atrasado' : 'Por recibir';
  const paid = st === 'paid', p = paidTx(f, ym);
  const amt = p ? p.amount : f.amount, cur = p ? p.cur : f.cur;
  const c = catOf(f.cat);
  return `<div class="row-item fixed ${paid ? 'is-paid' : ''}">
    <button class="tick ${paid ? 'on' : ''}" data-act="pay" data-id="${f.id}" aria-pressed="${paid}" aria-label="${paid ? 'Marcar como no pagado' : (isInc ? 'Marcar como recibido' : 'Marcar como pagado')}: ${esc(f.name)}">${ic('check')}</button>
    <button class="ri-main as-btn" data-act="edit-fixed" data-id="${f.id}">
      <span class="ri-title">${c.emoji} ${esc(f.name)}${f.kind === 'sub' && f.used === false ? ' <span class="tag warn">No la uso</span>' : ''}</span>
      <span class="ri-sub"><span class="status ${tone}">${ic(icon)}${label}</span> · ${paid ? (isInc ? 'recibido el ' : 'pagado el ') + Number(p.date.slice(8)) : 'día ' + Math.min(f.day || 1, daysIn(ym))}${f.end && f.end === f.start ? ' · solo este mes' : ''}</span>
    </button>
    ${amtCell(isInc ? amt : -amt, cur, isInc ? 'inc' : 'exp', {sign: isInc})}
  </div>`;
}
function catBars(list, total, limit) {
  if (!list.length) return `<p class="empty-line">Aún no hay gastos este mes.</p>`;
  const max = list[0].v;
  return `<div class="catbars">${list.slice(0, limit || list.length).map(({cat, v}) => {
    const b = cat.budget > 0 ? budgetIn(cat) : 0, scale = Math.max(max, b);
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
  const s = goalSaved(g), p = g.target ? Math.min(1, s / g.target) : 0, done = s >= g.target, c = g.cur;
  let plan = '';
  if (!done && g.deadline) {
    const left = monthsBetween(thisYm(), g.deadline) + 1;
    plan = left > 0 ? `Aparta ${money((g.target - s) / left, {cur: c})} al mes para llegar en ${monthName(g.deadline)}.` : `La fecha (${monthName(g.deadline)}) ya pasó: te faltan ${money(g.target - s, {cur: c})}.`;
  } else if (!done) plan = `Te faltan ${money(g.target - s, {cur: c})}.`;
  else plan = '¡Meta cumplida! 🎉';
  return `<div class="goal ${mini ? 'mini' : ''}">
    <div class="goal-head"><span class="emo">${g.emoji || '🎯'}</span><div class="ri-main"><span class="ri-title">${esc(g.name)}</span><span class="ri-sub num">${money(s, {cur: c})} de ${money(g.target, {cur: c})} ${c}</span></div><span class="goal-pct num">${pct(p)}</span></div>
    <div class="progress" role="progressbar" aria-valuenow="${Math.round(p * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Progreso de ${esc(g.name)}"><div style="width:${p * 100}%"></div></div>
    <p class="note">${plan}</p>
    ${mini ? '' : `<div class="row"><button class="btn primary sm" data-act="contrib" data-id="${g.id}">${ic('plus')}Aportar</button><button class="btn sm" data-act="contrib" data-id="${g.id}" data-mode="out">Retirar</button><button class="btn ghost sm" data-act="edit-goal" data-id="${g.id}">Editar</button></div>`}
  </div>`;
}
function debtCard(d) {
  const left = debtLeft(d), paid = debtPaid(d), p = d.total ? Math.min(1, paid / d.total) : 0;
  return `<div class="debt">
    <div class="goal-head"><span class="emo">${d.emoji || '💳'}</span><button class="ri-main as-btn" data-act="edit-debt" data-id="${d.id}"><span class="ri-title">${esc(d.name)}</span><span class="ri-sub">Pagado ${money(paid, {cur: d.cur})} de ${money(d.total, {cur: d.cur})} ${d.cur}</span></button>
    <span class="amt-wrap"><span class="amt exp">${money(left, {cur: d.cur})}</span>${approx(left, d.cur) ? `<small class="approx">${approx(left, d.cur)}</small>` : ''}</span></div>
    <div class="progress pay" role="progressbar" aria-valuenow="${Math.round(p * 100)}" aria-valuemin="0" aria-valuemax="100" aria-label="Pagado de ${esc(d.name)}"><div style="width:${p * 100}%"></div></div>
    ${left > 0 ? `<div class="row"><button class="btn sm" data-act="pay-debt" data-id="${d.id}">${ic('check')}Abonar</button>${d.note ? `<span class="note">${esc(d.note)}</span>` : ''}</div>` : `<p class="all-done">${ic('check')}Deuda pagada.</p>`}
  </div>`;
}

/* ---------- Views ---------- */
function viewHome() {
  const ym = UI.ym, s = summary(ym), isNow = ym === thisYm();
  if (!D.tx.length && !D.fixed.length && !D.goals.length && !D.debts.length && !D.accounts.some(a => a.initial)) return welcome();
  const o = OTHER(VIEW()), ins = insights(ym), alerts = ins.filter(i => i.tone === 'bad' || i.tone === 'warn');
  const feed = [...s.tx].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 8);
  const groups = {};
  for (const t of feed) (groups[t.date] = groups[t.date] || []).push(t);
  const pend = s.pendList.filter(f => f.kind !== 'inc');
  const QA = [['add-tx', 'exp', 'Gasto', 'up', 'exp'], ['add-tx', 'inc', 'Ingreso', 'down', 'inc'], ['transfer', '', 'Transferir', 'swap', 'neu'], ['nav', 'pagos', 'Pagar', 'card', 'warn']];
  return `<section class="bank-head ${s.left < 0 ? 'neg' : ''}">
    <div class="bh-top">
      <div class="bh-month"><button class="bh-ic" data-act="month" data-d="-1" aria-label="Mes anterior">${ic('chevL')}</button><span>${isNow ? 'Este mes' : monthName(ym)}</span><button class="bh-ic" data-act="month" data-d="1" aria-label="Mes siguiente">${ic('chevR')}</button></div>
      <div class="bh-right">${curToggle()}<button class="bh-ic" data-nav="ajustes" aria-label="Ajustes">${ic('gear')}</button></div>
    </div>
    <span class="bh-label">Te queda</span>
    <div class="bh-num num">${money(s.left)}</div>
    <p class="bh-sub">${o !== VIEW() ? `≈ ${money(conv(s.left, VIEW(), o), {cur: o})} ${o}` : ''}${!s.inc ? `${o !== VIEW() ? ' · ' : ''}aún no registras ingresos` : ''}</p>
    <div class="bh-pills"><button class="bh-pill" data-act="filter-movs" data-id="inc">${ic('down')}Entró ${money(s.inc)}</button><button class="bh-pill" data-act="filter-movs" data-id="exp">${ic('up')}Salió ${money(s.exp)}</button>${s.pend ? `<button class="bh-pill pend" data-nav="pagos">${ic('clock')}Por pagar ${money(s.pend)}</button>` : ''}${s.sav ? `<button class="bh-pill" data-nav="ahorro">${ic('target')}Ahorrado ${money(s.sav)}</button>` : ''}</div>
  </section>
  <div class="acc-cards" role="list">${D.accounts.map(a => { const b = accBalance(a); return `<button class="acc-card" role="listitem" data-act="edit-acc" data-id="${a.id}"><span class="ac-name">${a.emoji || '🏦'} ${esc(a.name)}</span><span class="ac-bal num ${b < 0 ? 'exp-t' : ''}">${money(b, {cur: a.cur})}</span><span class="ac-sub">${a.cur}${a.cur !== VIEW() ? ' · ' + approx(b, a.cur) : ''}</span></button>`; }).join('')}<button class="acc-card add" data-act="new-acc">${ic('plus')}<span>Cuenta</span></button></div>
  ${demoBanner()}
  <div class="quick">${QA.map(([act, id, l, i, tone]) => `<button class="qa" data-act="${act}" data-id="${id}"><span class="qa-ic ${tone}">${ic(i)}</span>${l}</button>`).join('')}</div>
  ${alerts.length ? `<button class="card alert-card" data-act="show-insights"><span class="ac-bar"></span><span class="ri-main"><span class="ri-title">${alerts.length} aviso${alerts.length > 1 ? 's' : ''}</span><span class="ri-sub">${esc(alerts.slice(0, 2).map(a => a.title).join(' · '))}</span></span>${ic('chevR')}</button>`
    : ins.length ? `<button class="card alert-card good" data-act="show-insights"><span class="ac-bar"></span><span class="ri-main"><span class="ri-title">Vas bien</span><span class="ri-sub">${esc(ins[0].title)}</span></span>${ic('chevR')}</button>` : ''}
  ${pend.length ? `<section class="card"><div class="card-head"><h3>Por pagar</h3><button class="link" data-nav="pagos">Ver todo ${ic('chevR')}</button></div><div class="rows">${pend.slice(0, 2).map(f => fixedRow(f, ym)).join('')}</div></section>` : ''}
  <section class="card feed">
    <div class="card-head"><h3>Movimientos</h3><button class="link" data-nav="movs">Ver todos ${ic('chevR')}</button></div>
    ${feed.length ? Object.entries(groups).map(([d, ts]) => `<div class="day-head"><span>${dayLabel(d)}</span></div><div class="rows">${ts.map(txRow).join('')}</div>`).join('') : `<p class="empty-line">Sin movimientos en ${monthName(ym)}. Toca el + para anotar el primero.</p>`}
  </section>`;
}
function welcome() {
  return `<section class="welcome">
    <span class="eyebrow">Bienvenido</span>
    <h1>Todo claro,<br><em>cada mes.</em></h1>
    <p class="lead">Anota lo que entra y lo que sale, y la app te dice cuánto te queda, qué falta por pagar y dónde puedes ahorrar. Funciona con euros y pesos a la vez. Todo se guarda en este dispositivo, sin cuentas ni contraseñas.</p>
    <ol class="steps">
      <li><span>1</span><div><strong>Tus cuentas y deudas</strong><p>Ya tienes una cuenta en euros y otra en pesos: ponles cuánto tienes hoy. Agrega también lo que debes, en su moneda.</p><button class="btn sm" data-nav="cuentas">${ic('wallet')}Ir a Cuentas</button></div></li>
      <li><span>2</span><div><strong>Tu ingreso del mes</strong><p>Tu salario como ingreso fijo, para que la app sepa con cuánto cuentas.</p><button class="btn sm" data-act="new-fixed" data-id="inc">${ic('plus')}Agregar ingreso fijo</button></div></li>
      <li><span>3</span><div><strong>Tus pagos fijos</strong><p>Arriendo, servicios, celular, cuotas y suscripciones, con el día en que vencen y la moneda en que se pagan.</p><button class="btn sm" data-act="new-fixed" data-id="bill">${ic('plus')}Agregar pago fijo</button></div></li>
      <li><span>4</span><div><strong>Tus gastos del día a día</strong><p>Mercado, domicilios, transporte… con el botón verde de +.</p><button class="btn sm" data-act="add-tx">${ic('plus')}Agregar gasto</button></div></li>
    </ol>
    <div class="row"><button class="btn ghost" data-act="demo">Ver la app con datos de ejemplo</button></div>
  </section>`;
}
function demoBanner() {
  return D.demo ? `<div class="banner warn">${ic('info')}<span>Datos de ejemplo</span><button class="link" data-act="clear-demo">Empezar con los míos ${ic('chevR')}</button></div>` : '';
}

function viewMovs() {
  const ym = UI.ym, s = summary(ym), q = UI.movSearch.trim().toLowerCase();
  let list = s.tx.filter(t => UI.movFilter === 'all' || t.type === UI.movFilter);
  if (q) list = list.filter(t => (t.note || '').toLowerCase().includes(q) || catOf(t.cat).name.toLowerCase().includes(q) || accOf(t.acc).name.toLowerCase().includes(q));
  list.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const groups = {};
  for (const t of list) (groups[t.date] = groups[t.date] || []).push(t);
  const F = [['all', 'Todos'], ['exp', 'Gastos'], ['inc', 'Ingresos'], ['save', 'Ahorro'], ['transfer', 'Transferencias']];
  const dayTotal = ts => sum(ts.filter(t => t.type !== 'transfer'), t => t.type === 'inc' ? tv(t) : -tv(t));
  return `${demoBanner()}<div class="page-head"><h1>Movimientos</h1><button class="btn primary sm hide-phone" data-act="add-tx">${ic('plus')}Agregar</button></div>${monthBar()}
  <div class="summary-strip">
    <div><span>Entró</span><strong class="num inc-t">${money(s.inc, {sign: true})}</strong></div>
    <div><span>Salió</span><strong class="num exp-t">${money(-s.exp)}</strong></div>
    <div><span>Ahorrado</span><strong class="num sav-t">${money(s.sav)}</strong></div>
  </div>
  <div class="filters">
    <div class="seg-ctl scroll" role="group" aria-label="Filtrar">${F.map(([k, l]) => `<button class="${UI.movFilter === k ? 'on' : ''}" data-act="mov-filter" data-id="${k}" aria-pressed="${UI.movFilter === k}">${l}</button>`).join('')}</div>
    <label class="search">${ic('search')}<input id="mov-search" type="search" placeholder="Buscar" value="${esc(UI.movSearch)}" aria-label="Buscar movimientos"></label>
  </div>
  ${list.length ? Object.entries(groups).map(([d, ts]) => `<section class="day"><div class="day-head"><span>${dayLabel(d)}</span><span class="num">${ts.some(t => t.type !== 'transfer') ? money(dayTotal(ts), {sign: true}) : ''}</span></div><div class="rows card flat">${ts.map(txRow).join('')}</div></section>`).join('')
    : `<div class="card empty"><p>${q || UI.movFilter !== 'all' ? 'Nada coincide con el filtro.' : `Sin movimientos en ${monthName(ym)}.`}</p><button class="btn primary sm" data-act="add-tx">${ic('plus')}Agregar movimiento</button></div>`}`;
}

function viewPagos() {
  const ym = UI.ym, due = fixedDue(ym);
  const K = [['bill', 'Cuentas fijas'], ['sub', 'Suscripciones'], ['inc', 'Ingresos fijos']];
  const bills = due.filter(f => f.kind !== 'inc'), paidB = bills.filter(f => paidTx(f, ym));
  const tot = sum(bills, f => paidTx(f, ym) ? tv(paidTx(f, ym)) : conv(f.amount, f.cur)), paidAmt = sum(paidB, f => tv(paidTx(f, ym)));
  const list = due.filter(f => f.kind === UI.pagosTab).sort((a, b) => (a.day || 1) - (b.day || 1));
  const subs = due.filter(f => f.kind === 'sub'), subsT = sum(subs, f => conv(f.amount, f.cur)), unused = subs.filter(f => f.used === false);
  const inactive = D.fixed.filter(f => f.kind === UI.pagosTab && !due.includes(f) && f.end && f.end < ym && f.end !== f.start);
  return `${demoBanner()}<div class="page-head"><h1>Pagos</h1><button class="btn primary sm" data-act="new-fixed" data-id="${UI.pagosTab}">${ic('plus')}${UI.pagosTab === 'inc' ? 'Ingreso fijo' : UI.pagosTab === 'sub' ? 'Suscripción' : 'Cuenta fija'}</button></div>${monthBar()}
  ${bills.length ? `<section class="card pay-sum">
    <div class="ps-top"><div><span class="eyebrow">Pagado</span><strong class="num">${money(paidAmt)}</strong><span class="note"> de ${money(tot)}</span></div><div class="ps-right"><span class="status ${paidB.length === bills.length ? 'good' : 'warn'}">${ic(paidB.length === bills.length ? 'check' : 'clock')}${paidB.length} de ${bills.length} pagos</span></div></div>
    <div class="progress pay"><div style="width:${tot ? paidAmt / tot * 100 : 0}%"></div></div>
    <p class="note">${tot - paidAmt > 0.5 ? `Te falta pagar <strong class="warn-t">${money(tot - paidAmt)}</strong> este mes.` : 'Todo pagado este mes.'}</p>
  </section>` : ''}
  <div class="seg-ctl wide" role="tablist">${K.map(([k, l]) => `<button role="tab" class="${UI.pagosTab === k ? 'on' : ''}" aria-selected="${UI.pagosTab === k}" data-act="pagos-tab" data-id="${k}">${l} <small>${due.filter(f => f.kind === k).length}</small></button>`).join('')}</div>
  ${UI.pagosTab === 'sub' && subs.length ? `<div class="sub-sum"><div><span>Al mes</span><strong class="num">${money(subsT)}</strong></div><div><span>Al año</span><strong class="num">${money(subsT * 12)}</strong></div><div><span>Sin usar</span><strong class="num ${unused.length ? 'warn-t' : ''}">${unused.length ? money(sum(unused, f => conv(f.amount, f.cur))) + '/mes' : 'Ninguna'}</strong></div></div>` : ''}
  ${list.length ? `<div class="rows card flat">${list.map(f => fixedRow(f, ym)).join('')}</div>`
    : `<div class="card empty"><p>${UI.pagosTab === 'sub' ? 'Sin suscripciones. Netflix, Spotify, gimnasio, iCloud… agrégalas para ver cuánto te cuestan al año.' : UI.pagosTab === 'inc' ? 'Sin ingresos fijos. Agrega tu salario con el día en que te pagan.' : 'Sin cuentas fijas. Agrega arriendo, servicios, celular, cuotas de tarjeta…'}</p></div>`}
  <p class="note hint">Toca el círculo para marcarlo como ${UI.pagosTab === 'inc' ? 'recibido' : 'pagado'}: se anota solo en tus movimientos, desde la cuenta que elegiste. Toca el nombre para editarlo.</p>
  ${inactive.length ? `<details class="card flat"><summary>Ya no activos (${inactive.length})</summary><div class="rows">${inactive.map(f => `<button class="row-item" data-act="edit-fixed" data-id="${f.id}"><span class="emo">${catOf(f.cat).emoji}</span><span class="ri-main"><span class="ri-title">${esc(f.name)}</span><span class="ri-sub">Hasta ${monthName(f.end)}</span></span><span class="amt">${money(f.amount, {cur: f.cur})}</span></button>`).join('')}</div></details>` : ''}`;
}

function viewCuentas() {
  const accTotal = sum(D.accounts, a => conv(accBalance(a), a.cur)), debtTotal = sum(D.debts, d => conv(debtLeft(d), d.cur));
  const net = accTotal - debtTotal, o = OTHER(VIEW());
  const byCur = {};
  for (const a of D.accounts) byCur[a.cur] = (byCur[a.cur] || 0) + accBalance(a);
  return `${demoBanner()}<div class="page-head"><h1>Cuentas</h1><button class="btn primary sm" data-act="transfer">${ic('swap')}Transferir</button></div>${monthBar(true)}
  <section class="hero small ${net < 0 ? 'neg' : ''}">
    <span class="eyebrow">Lo que tienes menos lo que debes</span><div class="hero-num num">${money(net)}</div>
    ${o !== VIEW() ? `<p class="hero-alt num">≈ ${money(conv(net, VIEW(), o), {cur: o})} ${o}</p>` : ''}
    <p class="hero-sub">Tienes ${Object.entries(byCur).map(([c, v]) => `${money(v, {cur: c})} ${c}`).join(' y ')}${debtTotal ? ` y debes ${money(debtTotal)}` : ''}.</p>
  </section>
  <div class="grid">
    <section class="card">
      <div class="card-head"><h3>Cuentas</h3><button class="btn sm" data-act="new-acc">${ic('plus')}Cuenta</button></div>
      <div class="rows">${D.accounts.map(a => `<button class="row-item" data-act="edit-acc" data-id="${a.id}"><span class="emo">${a.emoji || '🏦'}</span><span class="ri-main"><span class="ri-title">${esc(a.name)}</span><span class="ri-sub">${curInfo(a.cur).label} (${a.cur})</span></span>${amtCell(accBalance(a), a.cur, accBalance(a) < 0 ? 'exp' : '')}</button>`).join('')}</div>
      <p class="note">El saldo es lo que pusiste al crear la cuenta más lo que ha entrado y menos lo que ha salido. Si no cuadra con tu banco, toca la cuenta y corrígelo.</p>
    </section>
    <section class="card">
      <div class="card-head"><h3>Deudas</h3><button class="btn sm" data-act="new-debt">${ic('plus')}Deuda</button></div>
      ${D.debts.length ? `<div class="debts">${D.debts.map(debtCard).join('')}</div><p class="note">Debes en total <strong class="exp-t">${money(debtTotal)}</strong>${o !== VIEW() ? ` (≈ ${money(conv(debtTotal, VIEW(), o), {cur: o})} ${o})` : ''}.</p>`
        : `<p class="empty-line">Agrega lo que debes (tarjeta, préstamo…) en su moneda. Cuando abones desde otra moneda, anotas lo que pagaste y lo que bajó la deuda.</p>`}
    </section>
    <section class="card span2 rate-card">
      <div class="card-head"><h3>Tasa de cambio</h3><span class="note">${ratesAge()}</span></div>
      <div class="rate-big num">${rateText()}</div>
      <p class="note">${rateText(SECOND(), MAIN())}. Se actualiza sola cuando hay internet y se guarda para usarla sin conexión. Solo se usa para mostrar totales y sugerir montos: en transferencias y abonos se guarda lo que de verdad te cobraron.</p>
      <div class="row"><button class="btn sm" data-act="refresh-rates">${ic('refresh')}Actualizar ahora</button><button class="btn sm ghost" data-act="manual-rate">Ponerla a mano</button></div>
    </section>
  </div>`;
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
      <div class="card-head"><h3>Ingresos vs gastos</h3><span class="note">Últimos 6 meses, en ${VIEW()}</span></div>
      <div class="legend dark"><span><i class="inc"></i>Ingresos</span><span><i class="exp"></i>Gastos</span></div>
      <div class="chart" id="chart-ie" data-rows='${esc(JSON.stringify(rows))}'></div>
      <details class="table-toggle"><summary>Ver como tabla</summary>
        <table class="tbl"><thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Ahorro</th><th>Balance</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${monthName(r.m)}</td><td class="num">${money(r.inc)}</td><td class="num">${money(r.exp)}</td><td class="num">${money(r.sav)}</td><td class="num ${r.bal < 0 ? 'exp-t' : ''}">${money(r.bal)}</td></tr>`).join('')}</tbody></table>
      </details>
      ${avgExp ? `<p class="note">En promedio gastas <strong>${money(avgExp)}</strong> al mes${withData.length > 1 ? ` (${withData.length} meses con datos)` : ''}. ${s.exp ? (s.exp > avgExp ? `Este mes vas <strong class="exp-t">${money(s.exp - avgExp)} por encima</strong>.` : `Este mes vas <strong class="inc-t">${money(avgExp - s.exp)} por debajo</strong>.`) : ''}</p>` : ''}
      <p class="note">Los montos en otra moneda se convierten con la tasa de hoy.</p>
    </section>
    <section class="card span2">
      <div class="card-head"><h3>Gastos por categoría</h3><span class="note num">${money(s.exp)}</span></div>
      ${catBars(cats, s.exp)}
      ${budgets.length ? `<p class="note">Sin gastos todavía en: ${budgets.map(c => `${c.emoji} ${esc(c.name)} (límite ${money(budgetIn(c))})`).join(', ')}.</p>` : ''}
      <button class="link" data-nav="ajustes">Ponerle un límite a cada categoría ${ic('chevR')}</button>
    </section>
  </div>`;
}

function viewAhorro() {
  const total = sum(D.goals, g => conv(goalSaved(g), g.cur)), s = summary(thisYm());
  return `${demoBanner()}<div class="page-head"><h1>Ahorro</h1><button class="btn primary sm" data-act="new-goal">${ic('plus')}Nueva meta</button></div>${monthBar(true)}
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
  const catList = list => `<div class="rows card flat">${list.map(c => `<button class="row-item" data-act="edit-cat" data-id="${c.id}"><span class="emo">${c.emoji}</span><span class="ri-main"><span class="ri-title">${esc(c.name)}</span>${c.type === 'exp' ? `<span class="ri-sub">${c.budget ? 'Límite ' + money(c.budget, {cur: MAIN()}) + ' al mes' : 'Sin límite'}</span>` : ''}</span>${ic('chevR')}</button>`).join('')}</div>`;
  const opts = sel => Object.entries(CURRENCIES).map(([k, c]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${c.label} (${k})</option>`).join('');
  return `<div class="page-head"><h1>Ajustes</h1></div>
  <div class="grid">
  <section class="card">
    <h3>Monedas</h3>
    <div class="two"><label class="field"><span>Principal</span><select id="cur-main">${opts(MAIN())}</select></label>
    <label class="field"><span>Segunda moneda</span><select id="cur-second">${opts(SECOND())}</select></label></div>
    <p class="note">Los totales se ven en la principal, y con el botón ${MAIN()} / ${SECOND()} cambias a la otra. Los límites de las categorías van en la principal.</p>
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
  const views = {home: viewHome, movs: viewMovs, pagos: viewPagos, cuentas: viewCuentas, analisis: viewAnalisis, ahorro: viewAhorro, ajustes: viewAjustes};
  $('#main').innerHTML = (views[v] || viewHome)();
  $('#side-nav').innerHTML = NAV.map(([k, l, i]) => `<button class="${v === k ? 'on' : ''}" data-nav="${k}" ${v === k ? 'aria-current="page"' : ''}>${ic(i)}<span>${l}</span></button>`).join('');
  const tab = ([k, l, i]) => `<button class="${v === k ? 'on' : ''}" data-nav="${k}" ${v === k ? 'aria-current="page"' : ''}>${ic(i)}<span>${l}</span></button>`;
  const more = !['home', 'movs', 'pagos'].includes(v);
  $('#tabbar').innerHTML = tab(NAV[0]) + tab(NAV[1]) + `<button class="tab-add" data-act="add-tx" aria-label="Agregar movimiento">${ic('plus')}</button>` + tab(NAV[2]) + `<button class="${more ? 'on' : ''}" data-act="more">${ic('menu')}<span>Más</span></button>`;
  document.body.classList.toggle('on-home', v === 'home' && !!document.querySelector('.bank-head'));
  const s = summary(thisYm());
  $('#side-foot').innerHTML = `<div class="mini-left"><span class="eyebrow">Te queda este mes</span><strong class="num ${s.left < 0 ? 'exp-t' : ''}">${money(s.left)}</strong><small class="note">${rateText()}</small></div>${installPrompt ? `<button class="btn sm ghost" data-act="install">${ic('install')}Instalar app</button>` : ''}`;
  drawIE();
  const srch = $('#mov-search');
  if (srch) srch.addEventListener('input', () => { UI.movSearch = srch.value; const pos = srch.selectionStart; render(); const n = $('#mov-search'); n.focus(); n.setSelectionRange(pos, pos); });
  for (const [sel, key] of [['#cur-main', 'main'], ['#cur-second', 'second']]) {
    const el = $(sel);
    if (el) el.addEventListener('change', () => { D.settings[key] = el.value; D.settings.view = D.settings.main; save(); render(); fetchRates(true); toast('Monedas cambiadas.'); });
  }
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
const sheetHead = title => `<div class="sh-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Cerrar">${ic('x')}</button></div>`;
const showErr = (form, msg) => { const e = form.querySelector('.err'); e.textContent = msg; e.hidden = false; };
function catPicker(type, selected) {
  return `<div class="cat-grid" role="radiogroup" aria-label="Categoría">${D.cats.filter(c => c.type === type).map(c => `<button type="button" role="radio" class="cat-opt ${c.id === selected ? 'on' : ''}" aria-checked="${c.id === selected}" data-cat="${c.id}"><span>${c.emoji}</span><small>${esc(c.name)}</small></button>`).join('')}</div>`;
}
function accPicker(selected, name = 'acc', label = 'Cuenta') {
  return `<div class="field"><span>${label}</span><div class="acc-pick" role="radiogroup" aria-label="${label}">${D.accounts.map(a => `<button type="button" role="radio" class="acc-opt ${a.id === selected ? 'on' : ''}" aria-checked="${a.id === selected}" data-${name}="${a.id}"><span>${a.emoji || '🏦'}</span><span class="ao-t">${esc(a.name)}<small>${a.cur} · ${money(accBalance(a), {cur: a.cur})}</small></span></button>`).join('')}</div></div>`;
}
function amountField(id, value, cur, label = 'Monto', small) {
  return `<label class="field amount ${small ? 'small' : ''}"><span>${label}</span><div class="amt-in"><span class="cur-sign">${curInfo(cur).sign}</span><input id="${id}" data-cur="${cur}" inputmode="${curInfo(cur).dec ? 'decimal' : 'numeric'}" autocomplete="off" placeholder="0" value="${amountInput(value, cur)}" ${small ? '' : 'autofocus'}><span class="cur-code">${cur}</span></div></label>`;
}
function wireAmounts(root) {
  root.querySelectorAll('input[data-cur]').forEach(input => input.addEventListener('input', () => {
    if (curInfo(input.dataset.cur).dec) return;
    const n = parseAmount(input.value, input.dataset.cur);
    input.value = isNaN(n) ? '' : amountInput(n, input.dataset.cur);
  }));
}
const readAmt = (form, id) => { const el = form.querySelector('#' + id); return el ? parseAmount(el.value, el.dataset.cur) : NaN; };
// Second amount in another currency (what the debt/goal/receiving account gets). Prefilled from the rate until the user edits it.
function wirePair(form, srcId, dstId, rateEl) {
  const src = form.querySelector('#' + srcId), dst = form.querySelector('#' + dstId);
  if (!src || !dst) return;
  let touched = !!dst.value;
  const showRate = () => {
    if (!rateEl) return;
    const a = parseAmount(src.value, src.dataset.cur), b = parseAmount(dst.value, dst.dataset.cur), el = form.querySelector(rateEl);
    if (!el) return;
    if (a > 0 && b > 0) {
      const [x, y, r] = curInfo(src.dataset.cur).dec >= curInfo(dst.dataset.cur).dec ? [src.dataset.cur, dst.dataset.cur, b / a] : [dst.dataset.cur, src.dataset.cur, a / b];
      const diff = b / conv(a, src.dataset.cur, dst.dataset.cur) - 1;
      el.innerHTML = `Tasa que te dieron: 1 ${curInfo(x).sign} = ${money(r, {cur: y})} ${y}${Math.abs(diff) > .005 ? ` · ${diff < 0 ? `${pct(-diff)} peor` : `${pct(diff)} mejor`} que la del día` : ' · igual a la del día'}`;
    } else el.textContent = `Tasa del día: ${rateText(src.dataset.cur, dst.dataset.cur)}`;
  };
  src.addEventListener('input', () => {
    if (!touched) { const a = parseAmount(src.value, src.dataset.cur); dst.value = a > 0 ? amountInput(roundCur(conv(a, src.dataset.cur, dst.dataset.cur), dst.dataset.cur), dst.dataset.cur) : ''; }
    showRate();
  });
  dst.addEventListener('input', () => { touched = !!dst.value; showRate(); });
  showRate();
}

function txSheet(t, preset = {}) {
  const editing = !!t;
  t = t ? {...t} : {type: preset.type || 'exp', amount: preset.amount || 0, cat: preset.cat || '', acc: preset.acc || D.settings.lastAcc, date: UI.ym === thisYm() ? todayISO() : `${UI.ym}-01`, note: '', goalId: preset.goalId || (D.goals[0] && D.goals[0].id), debtId: preset.debtId || '', amountCur: preset.amountCur};
  if (!D.accounts.find(a => a.id === t.acc)) t.acc = D.accounts[0].id;
  // A preset amount in another currency (e.g. "apartar la mitad" in the view currency) is converted to the account's currency.
  if (t.amountCur && t.amountCur !== accOf(t.acc).cur) t.amount = roundCur(conv(t.amount, t.amountCur, accOf(t.acc).cur), accOf(t.acc).cur);
  const lastCat = ty => (D.settings.lastCat || {})[ty] || (ty === 'inc' ? 'salario' : 'mercado');
  let type = t.type, cat = t.cat || lastCat(type), acc = t.acc, dir = t.amount < 0 ? 'out' : 'in';
  let goalId = t.goalId, debtId = t.debtId || '';
  const keep = form => {
    const a = readAmt(form, 'f-amt'); t.amount = a > 0 ? a : 0;
    t.date = form.querySelector('#f-date').value; t.note = form.querySelector('#f-note').value;
    const g = form.querySelector('#f-goal'); if (g) goalId = g.value;
    const d = form.querySelector('#f-debt'); if (d) debtId = d.value;
    const p = readAmt(form, 'f-amt2'); t.second = p > 0 ? p : 0;
  };
  const body = () => {
    const ac = accOf(acc), goal = D.goals.find(g => g.id === goalId), debt = D.debts.find(d => d.id === debtId);
    const pairCur = type === 'save' && goal && goal.cur !== ac.cur ? goal.cur : type === 'exp' && debt && debt.cur !== ac.cur ? debt.cur : '';
    const dl = t.date === todayISO() ? 'Hoy' : dayLabel(t.date);
    return `
    <div class="seg-ctl wide type-ctl" role="group" aria-label="Tipo">${[['exp', 'Gasto'], ['inc', 'Ingreso'], ['save', 'Ahorro']].map(([k, l]) => `<button type="button" class="${type === k ? 'on ' + k : ''}" data-type="${k}" aria-pressed="${type === k}">${l}</button>`).join('')}</div>
    ${amountField('f-amt', Math.abs(t.amount), ac.cur, type === 'exp' && debt ? 'Lo que pagaste' : type === 'inc' ? '¿Cuánto entró?' : type === 'save' ? '¿Cuánto apartas?' : '¿Cuánto gastaste?')}
    ${D.accounts.length > 1 ? accPicker(acc, 'acc', type === 'inc' ? 'Entra a' : 'Sale de') : ''}
    ${type === 'save' ? (D.goals.length ? `<label class="field"><span>Meta</span><select id="f-goal">${D.goals.map(g => `<option value="${g.id}" ${g.id === goalId ? 'selected' : ''}>${g.emoji} ${esc(g.name)} (${g.cur})</option>`).join('')}</select></label>
      <div class="seg-ctl" role="group" aria-label="Aportar o retirar"><button type="button" data-dir="in" class="${dir === 'in' ? 'on' : ''}">Aportar</button><button type="button" data-dir="out" class="${dir === 'out' ? 'on' : ''}">Retirar</button></div>` : `<p class="note">Primero crea una meta de ahorro.</p><button type="button" class="btn sm" data-act="new-goal">${ic('plus')}Crear meta</button>`)
      : `<div class="field"><span>¿En qué?</span>${catPicker(type === 'inc' ? 'inc' : 'exp', cat)}</div>`}
    ${type === 'exp' && cat === 'deudas' && D.debts.length ? `<label class="field"><span>¿A qué deuda abona?</span><select id="f-debt"><option value="">A ninguna</option>${D.debts.map(d => `<option value="${d.id}" ${d.id === debtId ? 'selected' : ''}>${d.emoji || '💳'} ${esc(d.name)} (faltan ${money(debtLeft(d), {cur: d.cur})} ${d.cur})</option>`).join('')}</select></label>` : ''}
    ${pairCur ? `<div class="pair">${amountField('f-amt2', t.second, pairCur, type === 'save' ? `Suma a la meta (${pairCur})` : `Baja de la deuda (${pairCur})`, true)}<p class="note" id="f-rate"></p><p class="note">Se calcula solo con la tasa del día. Cámbialo solo si te cobraron distinto.</p></div>` : ''}
    <details class="more" ${editing || t.note ? 'open' : ''}><summary>${ic('calendar')}<span>${dl}</span><span class="note">· cambiar fecha o agregar nota</span></summary>
    <div class="two"><label class="field"><span>Fecha</span><input id="f-date" type="date" value="${t.date}"></label>
    <label class="field"><span>Nota (opcional)</span><input id="f-note" maxlength="60" placeholder="${type === 'inc' ? 'Ej. Pago freelance' : type === 'save' ? 'Ej. Prima' : 'Ej. Domicilio'}" value="${esc(t.note)}"></label></div></details>
    <p class="err" hidden></p>
    <div class="sh-actions">${editing ? `<button type="button" class="btn danger" data-del>${ic('trash')}Borrar</button>` : ''}<button type="submit" class="btn primary grow">${editing ? 'Guardar' : 'Agregar'}</button></div>`;
  };
  if (editing) t.second = t.type === 'save' ? t.goalAmount : t.debtAmount;
  if (editing) t.second = t.second && Math.abs(t.second);
  openSheet(`${sheetHead(editing ? 'Editar movimiento' : 'Nuevo movimiento')}<form novalidate>${body()}</form>`, sheet => {
    const form = sheet.querySelector('form');
    const redraw = () => { keep(form); form.innerHTML = body(); wire(); };
    const wire = () => { wireAmounts(form); wirePair(form, 'f-amt', 'f-amt2', '#f-rate'); const d = form.querySelector('#f-debt'); if (d) d.addEventListener('change', () => { debtId = d.value; t.second = 0; redraw(); }); const g = form.querySelector('#f-goal'); if (g) g.addEventListener('change', () => { goalId = g.value; t.second = 0; redraw(); }); };
    wire();
    form.addEventListener('click', e => {
      const cb = e.target.closest('[data-cat]');
      if (cb) {
        const was = cat; cat = cb.dataset.cat;
        if ((was === 'deudas') !== (cat === 'deudas') && D.debts.length) { debtId = cat === 'deudas' ? ((D.debts.find(d => debtLeft(d) > 0) || {}).id || '') : ''; t.second = 0; redraw(); }
        else form.querySelectorAll('[data-cat]').forEach(x => { x.classList.toggle('on', x === cb); x.setAttribute('aria-checked', x === cb); });
      }
      const ab = e.target.closest('[data-acc]');
      if (ab && ab.dataset.acc !== acc) { keep(form); const from = accOf(acc).cur; acc = ab.dataset.acc; const to = accOf(acc).cur; if (t.amount && from !== to) t.amount = roundCur(conv(t.amount, from, to), to); t.second = 0; form.innerHTML = body(); wire(); }
      const tb = e.target.closest('[data-type]');
      if (tb && tb.dataset.type !== type) { type = tb.dataset.type; cat = lastCat(type); debtId = ''; redraw(); }
      const db = e.target.closest('[data-dir]');
      if (db) { dir = db.dataset.dir; form.querySelectorAll('[data-dir]').forEach(x => x.classList.toggle('on', x === db)); }
      if (e.target.closest('[data-del]')) { D.tx = D.tx.filter(x => x.id !== t.id); save(); closeSheet(); render(); toast('Movimiento borrado.'); }
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const amt = readAmt(form, 'f-amt'), date = form.querySelector('#f-date').value, ac = accOf(acc);
      if (!(amt > 0)) return showErr(form, 'Escribe un monto mayor que cero.');
      if (!date) return showErr(form, 'Elige una fecha.');
      if (type === 'save' && !D.goals.length) return showErr(form, 'Crea una meta antes de ahorrar.');
      const second = readAmt(form, 'f-amt2');
      if (form.querySelector('#f-amt2') && !(second > 0)) return showErr(form, 'Escribe también cuánto fue en la otra moneda.');
      const sign = type === 'save' && dir === 'out' ? -1 : 1;
      const rec = {id: t.id || uid(), type, acc: ac.id, cur: ac.cur, amount: sign * amt, date, note: form.querySelector('#f-note').value.trim()};
      if (type === 'save') { rec.goalId = form.querySelector('#f-goal').value; const g = D.goals.find(x => x.id === rec.goalId); rec.goalAmount = sign * (g.cur === ac.cur ? amt : second); }
      else rec.cat = cat;
      if (type === 'exp' && debtId) { const d = D.debts.find(x => x.id === debtId); rec.debtId = debtId; rec.debtAmount = d.cur === ac.cur ? amt : second; }
      if (t.fixedId) { rec.fixedId = t.fixedId; rec.forMonth = t.forMonth; }
      if (editing) D.tx = D.tx.map(x => x.id === t.id ? rec : x); else D.tx.push(rec);
      D.settings.lastAcc = ac.id;
      if (type !== 'save' && !t.fixedId) D.settings.lastCat = {...(D.settings.lastCat || {}), [type]: cat};
      save(); closeSheet();
      if (ymOf(date) !== UI.ym && !editing) UI.ym = ymOf(date);
      render(); toast(editing ? 'Guardado.' : rec.debtId ? 'Abono anotado.' : type === 'inc' ? 'Ingreso agregado.' : type === 'save' ? 'Ahorro anotado.' : 'Gasto agregado.');
    });
  });
}

function transferSheet(t) {
  const editing = !!t;
  const a0 = D.accounts.find(a => a.cur === SECOND()) || D.accounts[0], b0 = D.accounts.find(a => a.id !== a0.id && a.cur === MAIN()) || D.accounts.find(a => a.id !== a0.id) || a0;
  t = t ? {...t} : {acc: a0.id, to: b0.id, amount: 0, toAmount: 0, date: todayISO(), note: ''};
  let from = t.acc, to = t.to;
  const body = () => {
    const A = accOf(from), B = accOf(to);
    return `${accPicker(from, 'from', 'Sale de')}${accPicker(to, 'to', 'Llega a')}
    ${amountField('t-amt', t.amount, A.cur, 'Lo que salió')}
    ${A.cur !== B.cur ? `<div class="pair">${amountField('t-amt2', t.toAmount, B.cur, 'Lo que llegó (ya con comisiones)', true)}<p class="note" id="t-rate"></p></div>` : ''}
    <div class="two"><label class="field"><span>Fecha</span><input id="t-date" type="date" value="${t.date}"></label>
    <label class="field"><span>Nota (opcional)</span><input id="t-note" maxlength="60" placeholder="Ej. Wise, Western Union" value="${esc(t.note)}"></label></div>
    <p class="err" hidden></p>
    <div class="sh-actions">${editing ? `<button type="button" class="btn danger" data-del>${ic('trash')}Borrar</button>` : ''}<button type="submit" class="btn primary grow">${editing ? 'Guardar' : 'Transferir'}</button></div>`;
  };
  if (D.accounts.length < 2) { toast('Necesitas al menos dos cuentas para transferir.'); return; }
  openSheet(`${sheetHead(editing ? 'Editar transferencia' : 'Transferir entre cuentas')}<form novalidate>${body()}</form>`, sheet => {
    const form = sheet.querySelector('form');
    const keep = () => { t.amount = readAmt(form, 't-amt') || 0; t.toAmount = readAmt(form, 't-amt2') || 0; t.date = form.querySelector('#t-date').value; t.note = form.querySelector('#t-note').value; };
    const wire = () => { wireAmounts(form); wirePair(form, 't-amt', 't-amt2', '#t-rate'); };
    wire();
    form.addEventListener('click', e => {
      const fb = e.target.closest('[data-from]'), tb = e.target.closest('[data-to]');
      if (fb || tb) {
        keep();
        if (fb) { from = fb.dataset.from; if (from === to) to = D.accounts.find(a => a.id !== from).id; }
        if (tb) { to = tb.dataset.to; if (to === from) from = D.accounts.find(a => a.id !== to).id; }
        t.toAmount = 0; form.innerHTML = body(); wire();
      }
      if (e.target.closest('[data-del]')) { D.tx = D.tx.filter(x => x.id !== t.id); save(); closeSheet(); render(); toast('Transferencia borrada.'); }
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const A = accOf(from), B = accOf(to), amt = readAmt(form, 't-amt'), got = A.cur === B.cur ? amt : readAmt(form, 't-amt2'), date = form.querySelector('#t-date').value;
      if (!(amt > 0)) return showErr(form, 'Escribe cuánto salió.');
      if (!(got > 0)) return showErr(form, 'Escribe cuánto llegó.');
      if (!date) return showErr(form, 'Elige una fecha.');
      const rec = {id: t.id || uid(), type: 'transfer', acc: A.id, cur: A.cur, amount: amt, to: B.id, toCur: B.cur, toAmount: got, date, note: form.querySelector('#t-note').value.trim()};
      if (editing) D.tx = D.tx.map(x => x.id === t.id ? rec : x); else D.tx.push(rec);
      save(); closeSheet(); render(); toast(editing ? 'Guardado.' : 'Transferencia anotada.');
    });
  });
}

function fixedSheet(f, kind) {
  const editing = !!f;
  const defAcc = D.accounts.find(a => a.id === D.settings.lastAcc) || D.accounts[0];
  f = f ? {...f} : {kind: kind || 'bill', name: '', amount: 0, cur: defAcc.cur, acc: defAcc.id, cat: kind === 'inc' ? 'salario' : kind === 'sub' ? 'subs' : 'vivienda', day: Number(todayISO().slice(8)), start: UI.ym, end: '', used: true, debtId: ''};
  let k = f.kind, cat = f.cat, acc = f.acc, once = !!(f.end && f.end === f.start);
  const keep = form => { f.name = form.querySelector('#f-name').value; f.cur = form.querySelector('#f-cur').value; f.amount = readAmt(form, 'f-amt') || 0; f.day = Number(form.querySelector('#f-day').value) || 1; once = form.querySelector('#f-once').value === '1'; const u = form.querySelector('#f-used'); if (u) f.used = u.checked; const d = form.querySelector('#f-debt'); if (d) f.debtId = d.value; };
  const body = () => `
    <div class="seg-ctl wide" role="group" aria-label="Tipo">${[['bill', 'Cuenta fija'], ['sub', 'Suscripción'], ['inc', 'Ingreso fijo']].map(([x, l]) => `<button type="button" class="${k === x ? 'on' : ''}" data-kind="${x}" aria-pressed="${k === x}">${l}</button>`).join('')}</div>
    <label class="field"><span>Nombre</span><input id="f-name" maxlength="40" placeholder="${k === 'inc' ? 'Ej. Salario' : k === 'sub' ? 'Ej. Netflix' : 'Ej. Arriendo'}" value="${esc(f.name)}" autofocus></label>
    <div class="amt-cur">${amountField('f-amt', f.amount, f.cur, k === 'inc' ? 'Monto' : 'Monto aproximado', true)}
    <label class="field"><span>Moneda</span><select id="f-cur">${usedCurs().map(c => `<option ${c === f.cur ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
    ${accPicker(acc, 'acc', k === 'inc' ? 'Entra a' : 'Se paga desde')}
    <div class="two"><label class="field"><span>${k === 'inc' ? 'Día en que te pagan' : 'Día en que vence'}</span><input id="f-day" type="number" min="1" max="31" inputmode="numeric" value="${f.day}"></label>
    <label class="field"><span>Se repite</span><select id="f-once"><option value="0" ${once ? '' : 'selected'}>Cada mes</option><option value="1" ${once ? 'selected' : ''}>Solo en ${monthName(f.start)}</option></select></label></div>
    <div class="field"><span>Categoría</span>${catPicker(k === 'inc' ? 'inc' : 'exp', cat)}</div>
    ${k === 'bill' && D.debts.length ? `<label class="field"><span>¿Es la cuota de una deuda?</span><select id="f-debt"><option value="">No</option>${D.debts.map(d => `<option value="${d.id}" ${d.id === f.debtId ? 'selected' : ''}>${d.emoji || '💳'} ${esc(d.name)} (${d.cur})</option>`).join('')}</select></label>` : ''}
    ${k === 'sub' ? `<label class="switch"><input type="checkbox" id="f-used" ${f.used !== false ? 'checked' : ''}><span class="sw"></span><span>La uso de verdad<small>Si la apagas, te la muestro como algo que podrías cancelar.</small></span></label>` : ''}
    <p class="note">Si la cuenta es de otra moneda, al marcarlo como pagado se convierte con la tasa del día y puedes corregir el valor real.</p>
    <p class="err" hidden></p>
    <div class="sh-actions">${editing ? `<button type="button" class="btn danger" data-del>${ic('trash')}Quitar</button>` : ''}<button type="submit" class="btn primary grow">${editing ? 'Guardar' : 'Agregar'}</button></div>`;
  openSheet(`${sheetHead(editing ? 'Editar ' + (k === 'inc' ? 'ingreso fijo' : k === 'sub' ? 'suscripción' : 'cuenta fija') : k === 'inc' ? 'Nuevo ingreso fijo' : k === 'sub' ? 'Nueva suscripción' : 'Nueva cuenta fija')}<form novalidate>${body()}</form>`, sheet => {
    const form = sheet.querySelector('form');
    const redraw = () => { form.innerHTML = body(); wire(); };
    const wire = () => { wireAmounts(form); form.querySelector('#f-cur').addEventListener('change', () => { keep(form); redraw(); }); };
    wire();
    form.addEventListener('click', e => {
      const cb = e.target.closest('[data-cat]');
      if (cb) { cat = cb.dataset.cat; form.querySelectorAll('[data-cat]').forEach(x => { x.classList.toggle('on', x === cb); x.setAttribute('aria-checked', x === cb); }); }
      const ab = e.target.closest('[data-acc]');
      if (ab) { keep(form); const was = accOf(acc).cur; acc = ab.dataset.acc; if (!f.amount && f.cur === was) f.cur = accOf(acc).cur; redraw(); }
      const kb = e.target.closest('[data-kind]');
      if (kb && kb.dataset.kind !== k) { keep(form); const was = k; k = kb.dataset.kind; if ((was === 'inc') !== (k === 'inc') || k === 'sub') cat = k === 'inc' ? 'salario' : k === 'sub' ? 'subs' : 'vivienda'; redraw(); }
      if (e.target.closest('[data-del]')) {
        const ym = UI.ym, paidBefore = D.tx.some(t => t.fixedId === f.id);
        if (!paidBefore || f.start >= ym) D.fixed = D.fixed.filter(x => x.id !== f.id);
        else D.fixed = D.fixed.map(x => x.id === f.id ? {...x, end: addMonths(ym, -1)} : x);
        save(); closeSheet(); render();
        toast(paidBefore && f.start < ym ? `Quitado desde ${monthName(ym)}. Los meses anteriores quedan igual.` : 'Quitado.');
      }
    });
    form.addEventListener('submit', e => {
      e.preventDefault(); keep(form);
      if (!f.name.trim()) return showErr(form, 'Ponle un nombre.');
      if (!(f.amount > 0)) return showErr(form, 'Escribe un monto mayor que cero.');
      const rec = {id: f.id || uid(), kind: k, name: f.name.trim(), amount: f.amount, cur: f.cur, acc, cat, day: Math.min(31, Math.max(1, f.day)), start: f.start, end: once ? f.start : (f.end && f.end !== f.start ? f.end : ''), active: true};
      if (k === 'sub') rec.used = f.used !== false;
      if (k === 'bill' && f.debtId) rec.debtId = f.debtId;
      if (editing) D.fixed = D.fixed.map(x => x.id === f.id ? rec : x); else D.fixed.push(rec);
      save(); closeSheet(); UI.pagosTab = k; render(); toast(editing ? 'Guardado.' : 'Agregado. Ya aparece en Pagos.');
    });
  });
}

function goalSheet(g) {
  const editing = !!g;
  g = g ? {...g} : {name: '', emoji: '🎯', target: 0, deadline: '', cur: MAIN()};
  const EMO = ['🎯', '🛟', '✈️', '🏠', '🚗', '💻', '🎓', '💍', '🎁', '🏖️', '📱', '🐶'];
  const body = () => `
    <label class="field"><span>¿Para qué ahorras?</span><input id="g-name" maxlength="40" placeholder="Ej. Fondo de emergencia" value="${esc(g.name)}" autofocus></label>
    <div class="field"><span>Ícono</span><div class="emo-pick">${EMO.map(e => `<button type="button" class="${e === g.emoji ? 'on' : ''}" data-emo="${e}" aria-label="${e}">${e}</button>`).join('')}</div></div>
    <div class="amt-cur">${amountField('g-amt', g.target, g.cur, 'Cuánto quieres juntar', true)}
    <label class="field"><span>Moneda</span><select id="g-cur" ${editing && goalSaved(g) ? 'disabled' : ''}>${usedCurs().map(c => `<option ${c === g.cur ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
    <label class="field"><span>¿Para cuándo? (opcional)</span><input id="g-date" type="month" value="${g.deadline || ''}" min="${thisYm()}"></label>
    <p class="note">Con una fecha te digo cuánto apartar cada mes.</p>
    <p class="err" hidden></p>
    <div class="sh-actions">${editing ? `<button type="button" class="btn danger" data-del>${ic('trash')}Borrar meta</button>` : ''}<button type="submit" class="btn primary grow">${editing ? 'Guardar' : 'Crear meta'}</button></div>`;
  openSheet(`${sheetHead(editing ? 'Editar meta' : 'Nueva meta de ahorro')}<form novalidate>${body()}</form>`, sheet => {
    const form = sheet.querySelector('form');
    const wire = () => { wireAmounts(form); form.querySelector('#g-cur').addEventListener('change', e => { g.name = form.querySelector('#g-name').value; g.target = readAmt(form, 'g-amt') || 0; g.deadline = form.querySelector('#g-date').value; g.cur = e.target.value; form.innerHTML = body(); wire(); }); };
    wire();
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
      const name = form.querySelector('#g-name').value.trim(), target = readAmt(form, 'g-amt');
      if (!name) return showErr(form, 'Ponle un nombre a la meta.');
      if (!(target > 0)) return showErr(form, 'Escribe cuánto quieres juntar.');
      const rec = {id: g.id || uid(), name, emoji: g.emoji, target, cur: g.cur, deadline: form.querySelector('#g-date').value || ''};
      if (editing) D.goals = D.goals.map(x => x.id === g.id ? rec : x); else D.goals.push(rec);
      save(); closeSheet(); render(); toast(editing ? 'Guardado.' : 'Meta creada.');
    });
  });
}

function accountSheet(a) {
  const editing = !!a;
  a = a ? {...a} : {name: '', emoji: '🏦', cur: MAIN(), initial: 0};
  const used = editing && D.tx.some(t => t.acc === a.id || t.to === a.id || false) || D.fixed.some(f => f.acc === a.id);
  const EMO = ['🏦', '💶', '💵', '🇨🇴', '🇪🇺', '🇪🇸', '💳', '👛', '🐷', '📈'];
  const body = () => `
    <label class="field"><span>Nombre</span><input id="a-name" maxlength="36" placeholder="Ej. Bancolombia, Revolut, Efectivo" value="${esc(a.name)}" autofocus></label>
    <div class="field"><span>Ícono</span><div class="emo-pick">${EMO.map(e => `<button type="button" class="${e === a.emoji ? 'on' : ''}" data-emo="${e}" aria-label="${e}">${e}</button>`).join('')}</div></div>
    <label class="field"><span>Moneda</span><select id="a-cur" ${used ? 'disabled' : ''}>${Object.entries(CURRENCIES).map(([k, c]) => `<option value="${k}" ${k === a.cur ? 'selected' : ''}>${c.label} (${k})</option>`).join('')}</select></label>
    ${used ? '<p class="note">La moneda no se puede cambiar porque la cuenta ya tiene movimientos.</p>' : ''}
    ${amountField('a-amt', editing ? accBalance(a) : a.initial, a.cur, editing ? 'Saldo de hoy' : '¿Cuánto tienes hoy?', true)}
    ${editing ? '<p class="note">Si lo cambias, la app ajusta el saldo inicial para que cuadre con tu banco.</p>' : ''}
    <p class="err" hidden></p>
    <div class="sh-actions">${editing && !used && D.accounts.length > 1 ? `<button type="button" class="btn danger" data-del>${ic('trash')}Borrar</button>` : ''}<button type="submit" class="btn primary grow">Guardar</button></div>`;
  openSheet(`${sheetHead(editing ? 'Editar cuenta' : 'Nueva cuenta')}<form novalidate>${body()}</form>`, sheet => {
    const form = sheet.querySelector('form');
    const wire = () => { wireAmounts(form); const c = form.querySelector('#a-cur'); c.addEventListener('change', () => { a.name = form.querySelector('#a-name').value; a.cur = c.value; form.innerHTML = body(); wire(); }); };
    wire();
    form.addEventListener('click', e => {
      const b = e.target.closest('[data-emo]');
      if (b) { a.emoji = b.dataset.emo; form.querySelectorAll('[data-emo]').forEach(x => x.classList.toggle('on', x === b)); }
      if (e.target.closest('[data-del]')) { D.accounts = D.accounts.filter(x => x.id !== a.id); save(); closeSheet(); render(); toast('Cuenta borrada.'); }
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = form.querySelector('#a-name').value.trim(), bal = readAmt(form, 'a-amt') || 0;
      if (!name) return showErr(form, 'Ponle un nombre a la cuenta.');
      const rec = {id: a.id || uid(), name, emoji: a.emoji, cur: a.cur, initial: 0};
      rec.initial = editing ? (a.initial || 0) + bal - accBalance(a) : bal;
      if (editing) D.accounts = D.accounts.map(x => x.id === a.id ? rec : x); else D.accounts.push(rec);
      save(); closeSheet(); render(); toast('Guardado.');
    });
  });
}

function debtSheet(d) {
  const editing = !!d;
  d = d ? {...d} : {name: '', emoji: '💳', cur: SECOND(), total: 0, note: ''};
  const EMO = ['💳', '🏦', '🎓', '🚗', '🏠', '🤝', '📱'];
  const body = () => `
    <label class="field"><span>¿Qué debes?</span><input id="d-name" maxlength="40" placeholder="Ej. Tarjeta Bancolombia, préstamo de mi mamá" value="${esc(d.name)}" autofocus></label>
    <div class="field"><span>Ícono</span><div class="emo-pick">${EMO.map(e => `<button type="button" class="${e === d.emoji ? 'on' : ''}" data-emo="${e}" aria-label="${e}">${e}</button>`).join('')}</div></div>
    <div class="amt-cur">${amountField('d-amt', editing ? d.total : 0, d.cur, editing ? 'Total de la deuda' : '¿Cuánto debes hoy?', true)}
    <label class="field"><span>Moneda</span><select id="d-cur" ${editing && debtPaid(d) ? 'disabled' : ''}>${Object.keys(CURRENCIES).map(c => `<option ${c === d.cur ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div>
    ${editing ? `<p class="note">Ya abonaste ${money(debtPaid(d), {cur: d.cur})}. Te faltan ${money(debtLeft(d), {cur: d.cur})}.</p>` : ''}
    <label class="field"><span>Nota (opcional)</span><input id="d-note" maxlength="60" placeholder="Ej. cuota de 450.000 el 28" value="${esc(d.note)}"></label>
    <p class="err" hidden></p>
    <div class="sh-actions">${editing ? `<button type="button" class="btn danger" data-del>${ic('trash')}Borrar</button>` : ''}<button type="submit" class="btn primary grow">Guardar</button></div>`;
  openSheet(`${sheetHead(editing ? 'Editar deuda' : 'Nueva deuda')}<form novalidate>${body()}</form>`, sheet => {
    const form = sheet.querySelector('form');
    const wire = () => { wireAmounts(form); form.querySelector('#d-cur').addEventListener('change', e => { d.name = form.querySelector('#d-name').value; d.note = form.querySelector('#d-note').value; d.cur = e.target.value; form.innerHTML = body(); wire(); }); };
    wire();
    form.addEventListener('click', e => {
      const b = e.target.closest('[data-emo]');
      if (b) { d.emoji = b.dataset.emo; form.querySelectorAll('[data-emo]').forEach(x => x.classList.toggle('on', x === b)); }
      if (e.target.closest('[data-del]')) {
        if (!confirm('¿Borrar esta deuda? Los abonos quedan en tus movimientos como gastos normales.')) return;
        D.debts = D.debts.filter(x => x.id !== d.id); D.tx.forEach(t => { if (t.debtId === d.id) { delete t.debtId; delete t.debtAmount; } }); D.fixed.forEach(f => { if (f.debtId === d.id) delete f.debtId; });
        save(); closeSheet(); render(); toast('Deuda borrada.');
      }
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = form.querySelector('#d-name').value.trim(), total = readAmt(form, 'd-amt');
      if (!name) return showErr(form, 'Ponle un nombre.');
      if (!(total > 0)) return showErr(form, 'Escribe cuánto debes.');
      const rec = {id: d.id || uid(), name, emoji: d.emoji, cur: d.cur, total, note: form.querySelector('#d-note').value.trim()};
      if (editing) D.debts = D.debts.map(x => x.id === d.id ? rec : x); else D.debts.push(rec);
      save(); closeSheet(); render(); toast('Guardado.');
    });
  });
}

function rateSheet() {
  const a = MAIN(), b = SECOND();
  openSheet(`${sheetHead('Tasa de cambio a mano')}<form novalidate>
    ${amountField('r-amt', roundCur(conv(1, a, b), b), b, `¿Cuánto vale 1 ${a} en ${b}?`)}
    <p class="note">Mientras la tengas a mano, la app no la actualiza sola. Con "Actualizar ahora" vuelve a la automática.</p>
    <p class="err" hidden></p>
    <div class="sh-actions"><button type="submit" class="btn primary grow">Guardar</button></div>
  </form>`, sheet => {
    const form = sheet.querySelector('form');
    wireAmounts(form);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const r = readAmt(form, 'r-amt');
      if (!(r > 0)) return showErr(form, 'Escribe la tasa.');
      const R = D.settings.rates;
      R[b] = r * R[a];
      D.settings.ratesManual = true; D.settings.ratesAt = new Date().toISOString();
      save(); closeSheet(); render(); toast('Tasa guardada.');
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
    ${c.type === 'exp' ? amountField('c-bud', c.budget, MAIN(), `Límite al mes en ${MAIN()} (opcional)`, true) : ''}
    <p class="err" hidden></p>
    <div class="sh-actions">${editing && !used ? `<button type="button" class="btn danger" data-del>${ic('trash')}Borrar</button>` : ''}<button type="submit" class="btn primary grow">Guardar</button></div>
    ${editing && used ? '<p class="note">Esta categoría tiene movimientos, por eso no se puede borrar.</p>' : ''}
  </form>`, sheet => {
    const form = sheet.querySelector('form');
    wireAmounts(form);
    form.addEventListener('click', e => { if (e.target.closest('[data-del]')) { D.cats = D.cats.filter(x => x.id !== c.id); save(); closeSheet(); render(); toast('Categoría borrada.'); } });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const name = form.querySelector('#c-name').value.trim();
      if (!name) return showErr(form, 'Ponle un nombre.');
      const b = readAmt(form, 'c-bud');
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
  const a = accOf(f.acc), date = ym === thisYm() ? todayISO() : dueDate(f, ym);
  const t = {id: uid(), type: f.kind === 'inc' ? 'inc' : 'exp', acc: a.id, cur: a.cur, amount: roundCur(conv(f.amount, f.cur, a.cur), a.cur), cat: f.cat, date, note: f.name, fixedId: f.id, forMonth: ym};
  const debt = f.debtId && D.debts.find(d => d.id === f.debtId);
  if (debt) { t.debtId = debt.id; t.debtAmount = roundCur(conv(f.amount, f.cur, debt.cur), debt.cur); }
  D.tx.push(t); save(); render();
  toast(f.kind === 'inc' ? `${f.name}: recibido.` : `${f.name}: pagado${a.cur !== f.cur ? ` (${money(t.amount, {cur: a.cur})} ${a.cur})` : ''}.`, {label: '¿Otro valor?', run: () => txSheet(D.tx.find(x => x.id === t.id))});
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
      const d = migrate(JSON.parse(r.result));
      if (!d || !Array.isArray(d.tx)) throw new Error('bad');
      if (!confirm('Esto reemplaza los datos de este dispositivo por los de la copia. ¿Seguir?')) return;
      D = d; save(); render(); toast('Copia cargada.');
    } catch (err) { toast('Ese archivo no es una copia de Mindless Spending.'); }
  };
  r.readAsText(file);
}

function loadDemo() {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const d = fresh('EUR', 'COP'), now = thisYm(), today = Number(todayISO().slice(8));
  d.settings.rates = {...D.settings.rates}; d.settings.ratesAt = D.settings.ratesAt; d.settings.ratesManual = D.settings.ratesManual;
  const R = d.settings.rates.COP || FALLBACK_RATES.COP;
  d.accounts = [
    {id: 'acc-main', name: 'Banco en euros', emoji: '🏦', cur: 'EUR', initial: 1200},
    {id: 'acc-cash', name: 'Efectivo', emoji: '👛', cur: 'EUR', initial: 80},
    {id: 'acc-second', name: 'Ahorros Colombia', emoji: '🇨🇴', cur: 'COP', initial: 18000000},
  ];
  d.debts = [{id: uid(), name: 'Tarjeta de crédito Colombia', emoji: '💳', cur: 'COP', total: 6500000, note: 'Cuota de 450.000 el 28'}];
  const F = (kind, name, amount, cur, acc, cat, day, extra = {}) => ({id: uid(), kind, name, amount, cur, acc, cat, day, start: addMonths(now, -5), end: '', active: true, ...extra});
  d.fixed = [
    F('inc', 'Salario', 2400, 'EUR', 'acc-main', 'salario', 1), F('bill', 'Arriendo', 850, 'EUR', 'acc-main', 'vivienda', 5), F('bill', 'Luz y agua', 70, 'EUR', 'acc-main', 'servicios', 18),
    F('bill', 'Internet', 30, 'EUR', 'acc-main', 'servicios', 22), F('bill', 'Plan celular', 15, 'EUR', 'acc-main', 'celular', 12),
    F('bill', 'Cuota tarjeta Colombia', 450000, 'COP', 'acc-main', 'deudas', 28, {debtId: d.debts[0].id}),
    F('sub', 'Netflix', 13.99, 'EUR', 'acc-main', 'subs', 9, {used: true}), F('sub', 'Spotify', 10.99, 'EUR', 'acc-main', 'subs', 14, {used: true}),
    F('sub', 'Disney+', 9.99, 'EUR', 'acc-main', 'subs', 20, {used: false}), F('sub', 'Gimnasio', 35, 'EUR', 'acc-main', 'salud', 3, {used: false}),
  ];
  d.goals = [{id: uid(), name: 'Fondo de emergencia', emoji: '🛟', cur: 'EUR', target: 5000, deadline: ''}, {id: uid(), name: 'Viaje a Colombia', emoji: '✈️', cur: 'EUR', target: 1500, deadline: addMonths(now, 2)}];
  const add = (type, amount, acc, cat, date, note, extra = {}) => { const a = d.accounts.find(x => x.id === acc); d.tx.push({id: uid(), type, acc, cur: a.cur, amount: roundCur(amount, a.cur), cat, date, note, ...extra}); };
  const daily = [['mercado', 'Mercado', 35, 80, 5, 'acc-main'], ['comida', 'Domicilio', 12, 28, 6, 'acc-main'], ['transporte', 'Bus / metro', 2, 9, 8, 'acc-cash'], ['ocio', 'Salida con amigos', 20, 60, 2, 'acc-cash'], ['comida', 'Almuerzo', 9, 16, 5, 'acc-main'], ['ropa', '', 25, 70, 1, 'acc-main']];
  for (let m = 5; m >= 0; m--) {
    const ym = addMonths(now, -m), last = m === 0 ? today : daysIn(ym);
    for (const f of d.fixed) if (f.day <= last) {
      const a = d.accounts.find(x => x.id === f.acc), extra = {fixedId: f.id, forMonth: ym};
      if (f.debtId) { extra.debtId = f.debtId; extra.debtAmount = f.amount; }
      const k = f.name === 'Luz y agua' ? .85 + rnd() * .3 : 1;
      add(f.kind === 'inc' ? 'inc' : 'exp', f.cur === a.cur ? f.amount * k : f.amount / R * 1.02, f.acc, f.cat, `${ym}-${pad(f.day)}`, f.name, extra);
    }
    for (const [cat, note, lo, hi, n, acc] of daily) for (let i = 0; i < n * (m === 0 ? today / daysIn(ym) * 1.15 : 1); i++) add('exp', lo + rnd() * (hi - lo), acc, cat, `${ym}-${pad(1 + Math.floor(rnd() * last))}`, note);
    if (m === 2) add('inc', 300, 'acc-main', 'extra', `${ym}-15`, 'Trabajo freelance');
    if (m > 0 || today >= 2) { add('save', 150, 'acc-main', null, `${ym}-02`, '', {goalId: d.goals[0].id, goalAmount: 150}); }
    if (m > 0 && m < 4) add('save', 100, 'acc-main', null, `${ym}-03`, '', {goalId: d.goals[1].id, goalAmount: 100});
    if (m === 3) d.tx.push({id: uid(), type: 'transfer', acc: 'acc-second', cur: 'COP', amount: 2000000, to: 'acc-main', toCur: 'EUR', toAmount: roundCur(2000000 / R * .97, 'EUR'), date: `${ym}-10`, note: 'Wise'});
    d.tx.push({id: uid(), type: 'transfer', acc: 'acc-main', cur: 'EUR', amount: 140, to: 'acc-cash', toCur: 'EUR', toAmount: 140, date: `${ym}-01`, note: 'Cajero'});
  }
  for (let i = 0; i < 2; i++) add('exp', 24, 'acc-main', 'comida', `${now}-${pad(Math.max(1, today - i))}`, 'Domicilio');
  d.cats.find(c => c.id === 'comida').budget = 180;
  d.cats.find(c => c.id === 'mercado').budget = 300;
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
    case 'add-tx': txSheet(null, id ? {type: id} : {}); break;
    case 'more': openSheet(`${sheetHead('Más')}<div class="more-grid">${NAV.slice(3).map(([k, l, i]) => `<button class="more-item ${UI.view === k ? 'on' : ''}" data-nav="${k}"><span class="mi-ic">${ic(i)}</span><span><strong>${l}</strong><small>${{cuentas: 'Saldos, deudas y tasa de cambio', analisis: 'Gastos por categoría y meses', ahorro: 'Metas y dónde ahorrar', ajustes: 'Monedas, categorías, copia de datos'}[k]}</small></span></button>`).join('')}</div>`); break;
    case 'show-insights': openSheet(`${sheetHead('Dónde puedes ahorrar')}${insightCards(insights(UI.ym))}`); break;
    case 'edit-tx': txSheet(D.tx.find(t => t.id === id)); break;
    case 'transfer': transferSheet(); break;
    case 'edit-transfer': transferSheet(D.tx.find(t => t.id === id)); break;
    case 'month': UI.ym = addMonths(UI.ym, Number(a.dataset.d)); render(); break;
    case 'month-now': UI.ym = thisYm(); render(); break;
    case 'view-cur': D.settings.view = id; save(); render(); break;
    case 'pay': togglePay(id); break;
    case 'new-fixed': closeSheet(); fixedSheet(null, id); break;
    case 'edit-fixed': fixedSheet(D.fixed.find(f => f.id === id)); break;
    case 'new-goal': closeSheet(); goalSheet(); break;
    case 'edit-goal': goalSheet(D.goals.find(g => g.id === id)); break;
    case 'contrib': {
      txSheet(null, {type: 'save', amount: Number(a.dataset.amount) || 0, amountCur: VIEW(), goalId: id});
      if (a.dataset.mode === 'out') setTimeout(() => { const b = document.querySelector('[data-dir="out"]'); if (b) b.click(); }, 0);
      break;
    }
    case 'new-acc': accountSheet(); break;
    case 'edit-acc': accountSheet(D.accounts.find(x => x.id === id)); break;
    case 'new-debt': debtSheet(); break;
    case 'edit-debt': debtSheet(D.debts.find(x => x.id === id)); break;
    case 'pay-debt': { const d = D.debts.find(x => x.id === id), acc = (D.accounts.find(x => x.id === D.settings.lastAcc) || D.accounts[0]).id; txSheet(null, {type: 'exp', cat: 'deudas', debtId: id, acc}); break; }
    case 'refresh-rates': toast('Buscando la tasa del día…'); fetchRates(true).then(ok => toast(ok ? `Tasa actualizada: ${rateText()}` : 'No se pudo actualizar. ¿Hay internet?')); break;
    case 'manual-rate': rateSheet(); break;
    case 'nav': go(id); break;
    case 'filter-movs': UI.movFilter = id; go('movs'); break;
    case 'mov-filter': UI.movFilter = id; render(); break;
    case 'pagos-tab': UI.pagosTab = id; render(); break;
    case 'new-cat': catSheet(null, id); break;
    case 'edit-cat': catSheet(D.cats.find(c => c.id === id)); break;
    case 'export': exportData(); break;
    case 'reset': if (confirm('¿Borrar todos tus datos de este dispositivo? No se puede deshacer. (Descarga una copia antes si la quieres.)')) { D = fresh(MAIN(), SECOND()); save(); go('home'); fetchRates(true); toast('Datos borrados.'); } break;
    case 'demo': loadDemo(); break;
    case 'clear-demo': { const s = D.settings; D = fresh('EUR', 'COP'); Object.assign(D.settings, {rates: s.rates, ratesAt: s.ratesAt, ratesManual: s.ratesManual}); save(); go('home'); toast('Listo, empieza con tus datos.'); break; }
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
  tip.innerHTML = el.dataset.tipHtml ? el.dataset.tip : esc(el.dataset.tip); tip.hidden = false;
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
window.addEventListener('online', () => fetchRates());

/* ---------- Start ---------- */
try { const v = sessionStorage.getItem('ms-view'); if (v) UI.view = v; } catch (e) {}
render();
fetchRates();
try {
  const last = localStorage.getItem('ms-version');
  if (last && last !== VERSION) toast(last < '2' ? 'Nueva versión: ahora con cuentas en euros y pesos.' : 'La app se actualizó.');
  localStorage.setItem('ms-version', VERSION);
} catch (e) {}
