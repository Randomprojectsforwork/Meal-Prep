/* ============================================================
 * MEAL PREP COORDINATOR — app.js
 * ============================================================ */

/* ----- STATE ------------------------------------------------ */
const STORAGE_KEY = 'mealprep.v2';

const DEFAULT_PANTRY = [
  { item: 'greek yogurt',           amount: 32, unit: 'oz',     aisle: 'dairy',  enabled: true },
  { item: 'coffee',                 amount: 1,  unit: 'bag',    aisle: 'pantry', enabled: true },
  { item: 'dark chocolate almonds', amount: 1,  unit: 'bag',    aisle: 'pantry', enabled: true },
  { item: 'sparkling water',        amount: 1,  unit: 'case',   aisle: 'pantry', enabled: true },
  { item: 'milk',                   amount: 1,  unit: 'gallon', aisle: 'dairy',  enabled: true },
];
const KCAL_SHARES = { breakfast: 0.25, lunch: 0.30, dinner: 0.30, snack: 0.15 };
const PREP_DAYS = 5;
const AISLES = ['produce','meat','seafood','dairy','eggs','bakery','pantry','spices','frozen','condiments','other'];

const defaultState = () => ({
  apiKey: '', model: 'claude-sonnet-4-5',
  profiles: {
    a: { name: 'Person A', weightLbs: 220, gender: 'male',
         activity: 'Daily exercise 45 min + 10k steps', goal: 'Lose 1 lb/week',
         kcalTarget: 2400, proteinTarget: 330, carbRangeLow: 100, carbRangeHigh: 150,
         notes: 'Low-carb-friendly. Emphasize healthy fats. Higher protein.' },
    b: { name: 'Person B', weightLbs: 150, gender: 'female',
         activity: 'Runs 2-3x/wk + lifts 1-2x/wk + 10k steps', goal: 'Lose weight gradually',
         kcalTarget: 1700, proteinTarget: 130, carbRangeLow: 150, carbRangeHigh: 220,
         notes: 'Struggles on low-carb. Prefer meals with optional add-on carbs.' },
  },
  styleNotes: '',
  favorites: [],
  pantryStaples: DEFAULT_PANTRY.map(x => ({ ...x })),
  weeklyExtrasA: [],
  lastGeneration: null,
  picks: { breakfast: [], lunch: [], dinner: [], snack: [] },
  includeFavoritesInGen: false,
  finalPlan: null,
  checkedItems: {},
});

let state = loadState();
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch (e) { return defaultState(); }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

/* ----- ROUTER ----------------------------------------------- */
const routes = ['setup','generate','picks','share','review','shopping','recipes','favorites','pantry'];
function currentRoute() {
  const h = location.hash.replace(/^#/, '');
  const base = h.split('?')[0] || 'setup';
  return routes.includes(base) ? base : 'setup';
}
function routeParams() {
  const h = location.hash;
  const qIdx = h.indexOf('?');
  if (qIdx < 0) return {};
  const out = {};
  h.slice(qIdx + 1).split('&').forEach(pair => {
    if (!pair) return;
    const eq = pair.indexOf('=');
    if (eq < 0) out[pair] = '';
    else out[pair.slice(0, eq)] = pair.slice(eq + 1);
  });
  return out;
}
function go(route, params = {}) {
  const qs = Object.entries(params).map(([k,v]) => `${k}=${v}`).join('&');
  location.hash = qs ? `${route}?${qs}` : route;
}
window.addEventListener('hashchange', render);

/* ----- UTIL ------------------------------------------------- */
let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.opacity = '0'), ms);
}
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const round = (n, p = 0) => { const f = Math.pow(10, p); return Math.round(n * f) / f; };
const uid = () => Math.random().toString(36).slice(2, 10);
function copyToClipboard(text) {
  return navigator.clipboard.writeText(text).then(
    () => toast('Copied to clipboard'),
    () => toast('Copy failed — select & copy manually')
  );
}

/* ----- RENDER DISPATCH -------------------------------------- */
function render() {
  const route = currentRoute();
  const params = routeParams();
  renderNav(route);
  const app = document.getElementById('app');
  app.innerHTML = '';
  if (route === 'setup')     return renderSetup(app);
  if (route === 'generate')  return renderGenerate(app);
  if (route === 'picks')     return renderPicks(app);
  if (route === 'share')     return renderShare(app);
  if (route === 'review')    return renderReview(app, params.d, params.u);
  if (route === 'shopping')  return renderShopping(app, params.d, params.p);
  if (route === 'recipes')   return renderRecipes(app);
  if (route === 'favorites') return renderFavorites(app);
  if (route === 'pantry')    return renderPantry(app);
}
function renderNav(active) {
  const links = [
    ['setup','Setup'],['generate','1. Generate'],['picks','2. Pick'],
    ['share','3. Share'],['shopping','4. Shop'],['recipes','📖 Recipes'],
    ['favorites','★ Favs'],['pantry','🧺 Pantry'],
  ];
  document.getElementById('nav-links').innerHTML = links
    .map(([id,label]) => {
      const cls = id === active ? 'bg-emerald-100 text-emerald-900' : 'text-stone-600 hover:bg-stone-100';
      return `<a href="#${id}" class="px-2.5 py-1.5 rounded-md ${cls}">${label}</a>`;
    }).join('');
}

/* ----- SETUP VIEW ------------------------------------------- */
function renderSetup(root) {
  const p = state.profiles;
  root.innerHTML = `
    <div class="space-y-6">
      <header><h2 class="text-2xl font-semibold">Setup</h2>
        <p class="text-stone-600 mt-1">Configure profiles, API key, and preferences. Everything is stored only in this browser.</p></header>
      <section class="bg-white p-5 rounded-lg border border-stone-200">
        <h3 class="font-semibold mb-3">Claude API</h3>
        <label class="block text-sm font-medium text-stone-700 mb-1">Anthropic API key</label>
        <input id="api-key" type="password" placeholder="sk-ant-..." value="${escapeHtml(state.apiKey)}"
          class="w-full px-3 py-2 border border-stone-300 rounded-md font-mono text-sm" />
        <p class="text-xs text-stone-500 mt-1">Stored in localStorage. Get one at console.anthropic.com.</p>
        <label class="block text-sm font-medium text-stone-700 mb-1 mt-4">Model</label>
        <select id="model" class="px-3 py-2 border border-stone-300 rounded-md text-sm">
          <option value="claude-sonnet-4-5" ${state.model==='claude-sonnet-4-5'?'selected':''}>claude-sonnet-4-5 (recommended)</option>
          <option value="claude-opus-4-6" ${state.model==='claude-opus-4-6'?'selected':''}>claude-opus-4-6 (slower, smarter)</option>
          <option value="claude-haiku-4-5" ${state.model==='claude-haiku-4-5'?'selected':''}>claude-haiku-4-5 (fastest, cheapest)</option>
        </select>
      </section>
      ${profileCard('a', p.a, 'Person A')}
      ${profileCard('b', p.b, 'Person B')}
      <section class="bg-white p-5 rounded-lg border border-stone-200">
        <h3 class="font-semibold mb-3">Cooking style preferences (optional)</h3>
        <textarea id="style-notes" rows="3" placeholder="e.g., Mediterranean-leaning, easy bulk prep on Sundays, no shellfish, love spicy food..."
          class="w-full px-3 py-2 border border-stone-300 rounded-md text-sm">${escapeHtml(state.styleNotes)}</textarea>
      </section>
      <div class="flex gap-3">
        <button id="save-setup" class="px-5 py-2.5 bg-emerald-700 text-white rounded-md font-medium hover:bg-emerald-800">Save & continue</button>
        <button id="reset-state" class="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-md hover:bg-stone-100">Reset all data</button>
      </div>
    </div>`;
  document.getElementById('save-setup').onclick = () => {
    state.apiKey = document.getElementById('api-key').value.trim();
    state.model = document.getElementById('model').value;
    state.styleNotes = document.getElementById('style-notes').value;
    ['a','b'].forEach(k => { state.profiles[k] = readProfile(k); });
    saveState(); toast('Saved'); go('generate');
  };
  document.getElementById('reset-state').onclick = () => {
    if (!confirm('Wipe all data (profiles, API key, picks, favorites, pantry)?')) return;
    localStorage.removeItem(STORAGE_KEY); state = defaultState(); render();
  };
}
function profileCard(key, p, fallback) {
  return `<section class="bg-white p-5 rounded-lg border border-stone-200">
    <h3 class="font-semibold mb-3">${escapeHtml(p.name || fallback)} — profile</h3>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
      <label class="block text-sm">Name<br><input data-pf="${key}.name" value="${escapeHtml(p.name)}" class="w-full mt-1 px-3 py-2 border border-stone-300 rounded-md"></label>
      <label class="block text-sm">Weight (lbs)<br><input data-pf="${key}.weightLbs" type="number" value="${p.weightLbs}" class="w-full mt-1 px-3 py-2 border border-stone-300 rounded-md"></label>
      <label class="block text-sm">Activity<br><input data-pf="${key}.activity" value="${escapeHtml(p.activity)}" class="w-full mt-1 px-3 py-2 border border-stone-300 rounded-md"></label>
      <label class="block text-sm">Goal<br><input data-pf="${key}.goal" value="${escapeHtml(p.goal)}" class="w-full mt-1 px-3 py-2 border border-stone-300 rounded-md"></label>
      <label class="block text-sm">Daily kcal target<br><input data-pf="${key}.kcalTarget" type="number" value="${p.kcalTarget}" class="w-full mt-1 px-3 py-2 border border-stone-300 rounded-md"></label>
      <label class="block text-sm">Daily protein target (g)<br><input data-pf="${key}.proteinTarget" type="number" value="${p.proteinTarget}" class="w-full mt-1 px-3 py-2 border border-stone-300 rounded-md"></label>
      <label class="block text-sm">Carb range low (g)<br><input data-pf="${key}.carbRangeLow" type="number" value="${p.carbRangeLow}" class="w-full mt-1 px-3 py-2 border border-stone-300 rounded-md"></label>
      <label class="block text-sm">Carb range high (g)<br><input data-pf="${key}.carbRangeHigh" type="number" value="${p.carbRangeHigh}" class="w-full mt-1 px-3 py-2 border border-stone-300 rounded-md"></label>
      <label class="block text-sm md:col-span-2">Notes / preferences<br><textarea data-pf="${key}.notes" rows="2" class="w-full mt-1 px-3 py-2 border border-stone-300 rounded-md">${escapeHtml(p.notes)}</textarea></label>
    </div>
  </section>`;
}
function readProfile(k) {
  const get = f => { const el = document.querySelector(`[data-pf="${k}.${f}"]`); return el ? el.value : ''; };
  return {
    name: get('name'), weightLbs: Number(get('weightLbs'))||0, gender: state.profiles[k].gender,
    activity: get('activity'), goal: get('goal'),
    kcalTarget: Number(get('kcalTarget'))||0, proteinTarget: Number(get('proteinTarget'))||0,
    carbRangeLow: Number(get('carbRangeLow'))||0, carbRangeHigh: Number(get('carbRangeHigh'))||0,
    notes: get('notes'),
  };
}

/* ----- GENERATE VIEW ---------------------------------------- */
function renderGenerate(root) {
  const lastPrompt = state.lastGeneration?.prompt || '';
  const favCount = state.favorites.length;
  root.innerHTML = `
    <div class="space-y-5">
      <header><h2 class="text-2xl font-semibold">Generate meal ideas</h2>
        <p class="text-stone-600 mt-1">Describe what kind of menu you want this week. Claude returns 5 breakfasts, 5 lunches, 5 dinners, and 5 snacks tailored to both profiles.</p></header>
      <section class="bg-white p-5 rounded-lg border border-stone-200">
        <label class="block text-sm font-medium mb-1">Menu prompt</label>
        <textarea id="prompt" rows="5" placeholder="e.g., Mediterranean theme this week, big batch prep on Sunday. Lean toward bowls and sheet-pan dinners. Include one breakfast that travels well."
          class="w-full px-3 py-2 border border-stone-300 rounded-md text-sm">${escapeHtml(lastPrompt)}</textarea>
        <div class="flex flex-wrap gap-2 mt-3">
          ${['Mediterranean','Tex-Mex bowls','Asian-inspired','Sheet-pan & one-pot','Comfort food, lighter']
            .map(t => `<button class="quick-prompt text-xs px-3 py-1 bg-stone-100 hover:bg-stone-200 rounded-full">${t}</button>`).join('')}
        </div>
        ${favCount > 0 ? `<label class="flex items-center gap-2 text-sm mt-3 text-stone-700">
          <input id="include-favs" type="checkbox" ${state.includeFavoritesInGen?'checked':''} class="accent-emerald-600">
          Bias toward my <a href="#favorites" class="underline text-emerald-700">${favCount} favorite${favCount===1?'':'s'}</a>
        </label>` : ''}
        <div class="mt-4 flex items-center gap-3">
          <button id="generate-btn" class="px-5 py-2.5 bg-emerald-700 text-white rounded-md font-medium hover:bg-emerald-800 disabled:opacity-60 flex items-center gap-2">
            <span id="gen-spinner" class="hidden"><span class="spinner"></span></span>
            <span id="gen-label">Generate meals</span>
          </button>
          <span id="gen-status" class="text-sm text-stone-600"></span>
        </div>
        ${!state.apiKey ? `<p class="mt-3 text-sm text-amber-700">No API key set. <a href="#setup" class="underline">Add one in Setup</a> first.</p>` : ''}
      </section>
      <div id="results"></div>
    </div>`;
  document.querySelectorAll('.quick-prompt').forEach(btn => {
    btn.onclick = () => { const ta = document.getElementById('prompt'); ta.value = (ta.value ? ta.value + ' ' : '') + btn.textContent + '.'; };
  });
  if (document.getElementById('include-favs')) {
    document.getElementById('include-favs').onchange = e => { state.includeFavoritesInGen = e.target.checked; saveState(); };
  }
  document.getElementById('generate-btn').onclick = onGenerate;
  if (state.lastGeneration) renderResults(state.lastGeneration.meals);
}
function setGenerateLoading(loading, label = '') {
  const sp = document.getElementById('gen-spinner');
  const btn = document.getElementById('generate-btn');
  const lbl = document.getElementById('gen-label');
  const stat = document.getElementById('gen-status');
  if (sp) sp.classList.toggle('hidden', !loading);
  if (btn) btn.disabled = loading;
  if (lbl) lbl.textContent = loading ? (label || 'Calling Claude…') : 'Generate meals';
  if (stat) stat.innerHTML = loading ? `<span class="text-stone-500">Typically 20–40s</span>` : '';
}
async function onGenerate() {
  const userPrompt = document.getElementById('prompt').value.trim();
  if (!state.apiKey) { toast('Set an API key in Setup'); return; }
  if (!userPrompt) { toast('Enter a prompt'); return; }
  setGenerateLoading(true);
  try {
    const result = await callClaudeForMeals(userPrompt);
    state.lastGeneration = { prompt: userPrompt, timestamp: Date.now(), meals: result };
    state.picks = { breakfast: [], lunch: [], dinner: [], snack: [] };
    saveState();
    renderResults(result);
  } catch (e) {
    console.error(e);
    const stat = document.getElementById('gen-status');
    if (stat) stat.innerHTML = `<span class="text-red-700">Error: ${escapeHtml(e.message)}</span>`;
  } finally { setGenerateLoading(false); }
}
function renderResults(meals) {
  const root = document.getElementById('results');
  if (!root) return;
  const order = [['breakfast','Breakfast','☕'],['lunch','Lunch','🥙'],['dinner','Dinner','🍽️'],['snack','Snacks','🍎']];
  root.innerHTML = `<div class="space-y-6 mt-2">
    ${order.map(([key,label,emoji]) => `
      <section data-category="${key}">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-semibold">${emoji} ${label} <span class="text-stone-400 text-sm font-normal" id="count-${key}">(${(meals[key]||[]).length})</span></h3>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3" id="grid-${key}">
          ${(meals[key] || []).map(m => mealCard(m, key, false)).join('')}
        </div>
      </section>`).join('')}
    <div class="pt-4 border-t border-stone-200">
      <button id="go-pick" class="px-5 py-2.5 bg-emerald-700 text-white rounded-md font-medium hover:bg-emerald-800">Next: pick my top 3 in each category →</button>
    </div>
  </div>`;
  attachMealCardHandlers();
  const gp = document.getElementById('go-pick'); if (gp) gp.onclick = () => go('picks');
}

/* ----- MEAL CARD -------------------------------------------- */
function isFavorite(meal) { return state.favorites.some(f => f.name === meal.name && f.category === meal.category); }
function mealCard(m, category, pickable, isPicked) {
  const macros = m.macrosPerServing || {};
  const ringClass = pickable && isPicked ? 'ring-2 ring-emerald-500 bg-emerald-50' : 'bg-white';
  const fav = isFavorite(m);
  const starColor = fav ? 'text-amber-400' : 'text-stone-300 hover:text-amber-400';
  const checkboxHtml = pickable ? `<label class="flex items-center gap-2 cursor-pointer ml-2">
       <input type="checkbox" data-pick="${m.id}" data-cat="${category}" ${isPicked?'checked':''} class="w-5 h-5 accent-emerald-600">
       <span class="text-sm font-medium">${isPicked?'Picked':'Pick'}</span></label>` : '';
  const linkHtml = m.recipeUrl ? `<a href="${escapeHtml(m.recipeUrl)}" target="_blank" rel="noopener" class="text-sm text-emerald-700 underline">Recipe link ↗</a>` : '';
  const addonHtml = m.carbAddon ? `<div class="mt-2 text-xs text-stone-600 italic">+ optional carb add-on: ${escapeHtml(m.carbAddon.amount)} ${escapeHtml(m.carbAddon.unit)} ${escapeHtml(m.carbAddon.item)} (+${m.carbAddon.macros?.kcal||0} kcal)</div>` : '';
  return `<article class="rounded-lg border border-stone-200 ${ringClass} p-4 shadow-sm" data-meal-id="${m.id}">
    <div class="flex items-start justify-between gap-2">
      <div class="flex items-start gap-2 flex-1 min-w-0">
        <button class="star-btn ${starColor} text-xl leading-none mt-0.5" data-fav="${m.id}" title="${fav?'Unfavorite':'Save to favorites'}">★</button>
        <div class="flex-1 min-w-0">
          <h4 class="font-semibold text-base">${escapeHtml(m.name)}</h4>
          <p class="text-sm text-stone-600 mt-0.5">${escapeHtml(m.description || '')}</p>
        </div>
      </div>
      ${checkboxHtml}
    </div>
    <div class="mt-2 flex flex-wrap gap-2 macro text-xs">
      <span class="pill bg-stone-100 text-stone-700">${macros.kcal||'?'} kcal</span>
      <span class="pill bg-rose-100 text-rose-800">${macros.protein||'?'}g P</span>
      <span class="pill bg-amber-100 text-amber-800">${macros.carbs||'?'}g C</span>
      <span class="pill bg-yellow-100 text-yellow-800">${macros.fat||'?'}g F</span>
      <span class="pill bg-emerald-100 text-emerald-800">batch of ${m.servings||'?'}</span>
    </div>
    ${addonHtml}
    <details class="mt-3">
      <summary class="text-sm font-medium text-emerald-700 hover:text-emerald-900">Show ingredients & recipe</summary>
      <div class="mt-2 text-sm space-y-2">
        <div><div class="font-medium text-stone-700">Ingredients (for batch of ${m.servings||'?'}):</div>
          <ul class="list-disc list-inside text-stone-700">
            ${(m.ingredients || []).map(i => `<li>${escapeHtml(i.amount)} ${escapeHtml(i.unit)} ${escapeHtml(i.item)}${i.notes ? ' <span class="text-stone-500">('+escapeHtml(i.notes)+')</span>' : ''}</li>`).join('')}
          </ul>
        </div>
        <div><div class="font-medium text-stone-700">Instructions:</div>
          <div class="text-stone-700 recipe-body">${escapeHtml(m.instructions || '')}</div>
        </div>
        ${m.prepNotes ? `<div class="text-stone-600 italic">Prep tip: ${escapeHtml(m.prepNotes)}</div>` : ''}
        ${linkHtml ? `<div>${linkHtml}</div>` : ''}
      </div>
    </details>
    <div class="mt-3 flex justify-end">
      <button data-more="${m.id}" data-more-cat="${category}" class="text-xs px-3 py-1 bg-white border border-emerald-300 text-emerald-700 rounded-full hover:bg-emerald-50 flex items-center gap-1.5">
        <span class="more-spinner-${m.id} hidden"><span class="spinner" style="width:0.9em;height:0.9em"></span></span>
        More like this
      </button>
    </div>
  </article>`;
}
function attachMealCardHandlers() {
  document.querySelectorAll('[data-fav]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-fav');
      const meal = findMealById(id); if (!meal) return;
      toggleFavorite(meal);
      const fav = isFavorite(meal);
      btn.className = `star-btn ${fav?'text-amber-400':'text-stone-300 hover:text-amber-400'} text-xl leading-none mt-0.5`;
      btn.title = fav ? 'Unfavorite' : 'Save to favorites';
    };
  });
  document.querySelectorAll('[data-more]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-more');
      const cat = btn.getAttribute('data-more-cat');
      const meal = findMealById(id); if (!meal) return;
      await onMoreLikeThis(meal, cat, btn);
    };
  });
  document.querySelectorAll('input[data-pick]').forEach(cb => {
    cb.onchange = () => {
      const id = cb.getAttribute('data-pick'); const cat = cb.getAttribute('data-cat');
      const picks = state.picks[cat]; const i = picks.indexOf(id);
      if (cb.checked) {
        if (picks.length >= 3) { cb.checked = false; toast(`Max 3 ${cat}s — uncheck one first`); return; }
        if (i < 0) picks.push(id);
      } else { if (i >= 0) picks.splice(i, 1); }
      saveState();
      if (currentRoute() === 'picks') renderPicks(document.getElementById('app'));
    };
  });
}
function findMealById(id) {
  const meals = state.lastGeneration?.meals || {};
  for (const cat of ['breakfast','lunch','dinner','snack']) {
    const m = (meals[cat] || []).find(x => x.id === id); if (m) return m;
  }
  return state.favorites.find(f => f.id === id);
}
function toggleFavorite(meal) {
  const idx = state.favorites.findIndex(f => f.name === meal.name && f.category === meal.category);
  if (idx >= 0) { state.favorites.splice(idx, 1); toast('Removed from favorites'); }
  else { const clone = JSON.parse(JSON.stringify(meal)); if (!clone.id) clone.id = uid(); state.favorites.push(clone); toast('Saved to favorites ★'); }
  saveState();
}
async function onMoreLikeThis(meal, category, btn) {
  if (!state.apiKey) { toast('Set an API key in Setup'); return; }
  const spin = document.querySelector(`.more-spinner-${meal.id}`);
  if (spin) spin.classList.remove('hidden');
  btn.disabled = true;
  try {
    const newMeals = await callClaudeForMoreLikeThis(meal, category, 2);
    if (!state.lastGeneration) state.lastGeneration = { prompt: '', timestamp: Date.now(), meals: { breakfast:[],lunch:[],dinner:[],snack:[] } };
    if (!state.lastGeneration.meals[category]) state.lastGeneration.meals[category] = [];
    newMeals.forEach(m => { m.id = uid(); m.category = category; });
    state.lastGeneration.meals[category].push(...newMeals);
    saveState();
    const grid = document.getElementById(`grid-${category}`);
    if (grid) {
      const pickable = currentRoute() === 'picks';
      const wrap = document.createElement('div');
      wrap.innerHTML = newMeals.map(m => mealCard(m, category, pickable, false)).join('');
      Array.from(wrap.children).forEach(c => grid.appendChild(c));
      attachMealCardHandlers();
      const c = document.getElementById(`count-${category}`); if (c) c.textContent = `(${state.lastGeneration.meals[category].length})`;
    }
    toast(`Added ${newMeals.length} more ${category}${newMeals.length===1?'':'s'}`);
  } catch (e) { console.error(e); toast('Error: ' + e.message); }
  finally { if (spin) spin.classList.add('hidden'); btn.disabled = false; }
}
