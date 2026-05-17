/* ============================================================
 * MEAL PREP COORDINATOR — views.js (loaded after app.js)
 * Contains: Claude API, picks, extras, share, review, shopping,
 *           recipes, favorites, pantry, boot
 * ============================================================ */

/* ----- CLAUDE API ------------------------------------------- */
async function callClaude(body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': state.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const txt = await res.text(); throw new Error(`API ${res.status}: ${txt.slice(0,400)}`); }
  const json = await res.json();
  return (json.content && json.content[0] && json.content[0].text) || '';
}

const MEAL_SCHEMA_SPEC = `Each Meal object:
{
  "name": "string", "description": "1-2 sentence", "servings": <int>,
  "ingredients": [ { "item": "lowercase name", "amount": <number>, "unit": "cup|tbsp|tsp|oz|lb|g|ml|whole|clove|pinch|...", "aisle": "produce|meat|seafood|dairy|eggs|pantry|bakery|frozen|condiments|spices|other", "notes": "optional" } ],
  "instructions": "Numbered steps separated by newlines",
  "prepNotes": "1 sentence bulk-prep tip",
  "macrosPerServing": { "kcal": <int>, "protein": <int>, "carbs": <int>, "fat": <int> },
  "carbAddon": null OR { "item": "...", "amount": <number>, "unit": "...", "macros": {...} },
  "recipeUrl": null OR "https://real-public-url"
}
Rules: amount must be number (0.25, 0.5 — never strings like "1/4"). Include carbAddon on 60%+ of lunches/dinners. recipeUrl only when HIGH CONFIDENCE real, otherwise null. All ingredient quantities are TOTAL for the batch.`;

async function callClaudeForMeals(userPrompt) {
  const pA = state.profiles.a, pB = state.profiles.b;
  const favsBlock = (state.includeFavoritesInGen && state.favorites.length > 0)
    ? `\n\nUSER'S FAVORITED MEALS (lean toward similar styles):\n${state.favorites.map(f => `- ${f.name} (${f.category}): ${f.description}`).join('\n')}`
    : '';
  const sys = `You are a meal prep assistant for a couple. Output ONLY a JSON object — no prose, no markdown.
{ "breakfast": [Meal x5], "lunch": [Meal x5], "dinner": [Meal x5], "snack": [Meal x5] }
${MEAL_SCHEMA_SPEC}
Snacks: simple, ~150-350 kcal, servings=1 each. Vary cuisines unless prompt requests a theme. Optimize for bulk prep (holds 3-5 days refrigerated).`;
  const userMsg = `Generate this week's meal plan options.

PERSON A: ${pA.name}
- ${pA.weightLbs} lbs, ${pA.gender}
- ${pA.activity}
- Goal: ${pA.goal}
- Daily: ~${pA.kcalTarget} kcal, ~${pA.proteinTarget}g protein, carbs ${pA.carbRangeLow}-${pA.carbRangeHigh}g
- Notes: ${pA.notes}

PERSON B: ${pB.name}
- ${pB.weightLbs} lbs, ${pB.gender}
- ${pB.activity}
- Goal: ${pB.goal}
- Daily: ~${pB.kcalTarget} kcal, ~${pB.proteinTarget}g protein, carbs ${pB.carbRangeLow}-${pB.carbRangeHigh}g
- Notes: ${pB.notes}

GENERAL STYLE: ${state.styleNotes || '(none)'}${favsBlock}

THIS WEEK: ${userPrompt}

Aim macros at A's per-meal needs (~25% kcal breakfast, ~30% lunch, ~30% dinner, ~15% snacks). B eats smaller portion — use carbAddon generously so she can add rice/tortilla/fruit. Return ONLY JSON.`;
  const text = await callClaude({ model: state.model || 'claude-sonnet-4-5', max_tokens: 16000, system: sys, messages: [{ role:'user', content: userMsg }] });
  const parsed = extractJson(text);
  if (!parsed) throw new Error('Could not parse JSON. First 200 chars: ' + text.slice(0,200));
  ['breakfast','lunch','dinner','snack'].forEach(cat => {
    if (!Array.isArray(parsed[cat])) parsed[cat] = [];
    parsed[cat].forEach(m => { m.id = uid(); m.category = cat; });
  });
  return parsed;
}
async function callClaudeForMoreLikeThis(referenceMeal, category, count = 2) {
  const sys = `Output ONLY a JSON array of exactly ${count} Meal objects.\n${MEAL_SCHEMA_SPEC}`;
  const userMsg = `Generate ${count} more ${category} ideas similar to the reference. Different recipes, same vibe.

REFERENCE:
${JSON.stringify(referenceMeal, null, 2)}

A: ~${state.profiles.a.kcalTarget} kcal/day. B: ~${state.profiles.b.kcalTarget} kcal/day, use carbAddon.

Return ONLY a JSON array of ${count} Meal objects.`;
  const text = await callClaude({ model: state.model || 'claude-sonnet-4-5', max_tokens: 8000, system: sys, messages: [{ role:'user', content: userMsg }] });
  const parsed = extractJson(text);
  if (!parsed) throw new Error('Could not parse JSON. First 200 chars: ' + text.slice(0,200));
  const arr = Array.isArray(parsed) ? parsed : (parsed.meals || []);
  if (!Array.isArray(arr) || arr.length === 0) throw new Error('No meals in response');
  return arr;
}
function extractJson(text) {
  try { return JSON.parse(text); } catch {}
  const f = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (f) { try { return JSON.parse(f[1]); } catch {} }
  const fb = text.indexOf('['), lb = text.lastIndexOf(']'), fbr = text.indexOf('{'), lbr = text.lastIndexOf('}');
  if (fb >= 0 && lb > fb && (fbr < 0 || fb < fbr)) { try { return JSON.parse(text.slice(fb, lb+1)); } catch {} }
  if (fbr >= 0 && lbr > fbr) { try { return JSON.parse(text.slice(fbr, lbr+1)); } catch {} }
  return null;
}

/* ----- PICKS VIEW ------------------------------------------- */
function renderPicks(root) {
  if (!state.lastGeneration) {
    root.innerHTML = `<div class="bg-amber-50 border border-amber-200 p-4 rounded-md"><p>No meals generated yet. <a href="#generate" class="underline">Generate some first</a>.</p></div>`;
    return;
  }
  const meals = state.lastGeneration.meals;
  const order = [['breakfast','Breakfast','☕'],['lunch','Lunch','🥙'],['dinner','Dinner','🍽️'],['snack','Snacks','🍎']];
  root.innerHTML = `<div class="space-y-5">
    <header><h2 class="text-2xl font-semibold">Pick your top 3 in each category</h2>
      <p class="text-stone-600 mt-1">Select up to 3 per category. ★ saves meals; "More like this" adds 2 similar ideas.</p></header>
    ${order.map(([k,l,e]) => `
      <section data-category="${k}">
        <div class="flex items-baseline justify-between mb-3">
          <h3 class="text-lg font-semibold">${e} ${l}</h3>
          <span class="text-sm text-stone-600" data-count="${k}">${state.picks[k].length} / 3 selected</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3" id="grid-${k}">
          ${(meals[k] || []).map(m => mealCard(m, k, true, state.picks[k].includes(m.id))).join('')}
        </div>
      </section>`).join('')}
    ${renderExtrasEditor()}
    <div class="pt-4 border-t border-stone-200 flex gap-3">
      <a href="#generate" class="px-5 py-2.5 bg-white border border-stone-300 rounded-md hover:bg-stone-100">← Back</a>
      <button id="go-share" class="px-5 py-2.5 bg-emerald-700 text-white rounded-md font-medium hover:bg-emerald-800">Next: share →</button>
    </div>
  </div>`;
  attachMealCardHandlers();
  attachExtrasHandlers('A');
  document.getElementById('go-share').onclick = () => {
    const all = ['breakfast','lunch','dinner','snack'].every(c => state.picks[c].length > 0);
    if (!all && !confirm("You haven't picked in every category. Continue anyway?")) return;
    go('share');
  };
}

/* ----- EXTRAS EDITOR ---------------------------------------- */
function renderExtrasEditor(otherPersonExtras = null) {
  const extras = state.weeklyExtrasA || [];
  const otherBlock = otherPersonExtras ? `
    <div class="text-sm bg-stone-50 border border-stone-200 rounded p-3 mb-3">
      <div class="font-medium text-stone-700 mb-1">Partner's added items:</div>
      ${otherPersonExtras.length === 0 ? `<div class="text-stone-500 italic">(none)</div>` : `<ul class="list-disc list-inside text-stone-700">${otherPersonExtras.map(x => `<li>${escapeHtml(x.amount)} ${escapeHtml(x.unit)} ${escapeHtml(x.item)}</li>`).join('')}</ul>`}
    </div>` : '';
  return `<section class="bg-white p-5 rounded-lg border border-stone-200">
    <h3 class="font-semibold mb-2">Anything else for the shopping list?</h3>
    <p class="text-sm text-stone-600 mb-3">Items not in any meal. Pantry staples are managed in <a href="#pantry" class="underline">🧺 Pantry</a>.</p>
    ${otherBlock}
    <div id="extras-list" class="space-y-2 mb-3">${extras.map((x,i) => extrasRow(x,i)).join('')}</div>
    <button id="add-extra" class="text-sm px-3 py-1.5 bg-white border border-emerald-300 text-emerald-700 rounded-md hover:bg-emerald-50">+ Add item</button>
  </section>`;
}
function extrasRow(x, idx) {
  return `<div class="flex flex-wrap items-center gap-2 text-sm" data-extra-idx="${idx}">
    <input type="number" step="0.1" min="0" data-extra-field="amount" value="${escapeHtml(x.amount)}" class="w-20 px-2 py-1 border border-stone-300 rounded" placeholder="amt">
    <input type="text" data-extra-field="unit" value="${escapeHtml(x.unit)}" class="w-24 px-2 py-1 border border-stone-300 rounded" placeholder="unit">
    <input type="text" data-extra-field="item" value="${escapeHtml(x.item)}" class="flex-1 min-w-[180px] px-2 py-1 border border-stone-300 rounded" placeholder="item">
    <select data-extra-field="aisle" class="px-2 py-1 border border-stone-300 rounded">
      ${AISLES.map(a => `<option value="${a}" ${x.aisle===a?'selected':''}>${a}</option>`).join('')}
    </select>
    <button data-extra-remove="${idx}" class="px-2 py-1 text-red-600 hover:bg-red-50 rounded">✕</button>
  </div>`;
}
function attachExtrasHandlers(person) {
  const getList = () => person === 'A' ? state.weeklyExtrasA : (state.finalPlan.weeklyExtrasB || (state.finalPlan.weeklyExtrasB = []));
  const addBtn = document.getElementById('add-extra');
  if (addBtn) addBtn.onclick = () => { getList().push({ item:'', amount:1, unit:'', aisle:'other' }); saveState(); render(); };
  document.querySelectorAll('[data-extra-idx]').forEach(row => {
    const idx = Number(row.getAttribute('data-extra-idx'));
    row.querySelectorAll('[data-extra-field]').forEach(inp => {
      inp.onchange = () => {
        const field = inp.getAttribute('data-extra-field');
        const list = getList(); if (!list[idx]) return;
        list[idx][field] = field === 'amount' ? (Number(inp.value)||0) : inp.value;
        saveState();
      };
    });
  });
  document.querySelectorAll('[data-extra-remove]').forEach(btn => {
    btn.onclick = () => { getList().splice(Number(btn.getAttribute('data-extra-remove')),1); saveState(); render(); };
  });
}

/* ----- PASTE SERVICE ---------------------------------------- */
async function postToPasteService(text) {
  const form = new URLSearchParams();
  form.append('content', text); form.append('syntax', 'text');
  form.append('expiry_days', '180'); form.append('title', 'mealprep-share');
  const res = await fetch('https://dpaste.com/api/v2/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Paste service returned ${res.status}`);
  const url = (await res.text()).trim();
  const m = url.match(/\/([A-Za-z0-9]+)$/);
  if (!m) throw new Error('Could not parse short-id: ' + url);
  return m[1];
}
async function fetchFromPasteService(id) {
  if (!/^[A-Za-z0-9]{3,40}$/.test(id)) throw new Error('Invalid share ID');
  const res = await fetch(`https://dpaste.com/${id}.txt`);
  if (!res.ok) throw new Error(`Paste service returned ${res.status}`);
  return (await res.text()).trim();
}

/* ----- SHARE VIEW ------------------------------------------- */
function buildPayload() {
  const meals = state.lastGeneration.meals;
  const picked = {};
  ['breakfast','lunch','dinner','snack'].forEach(cat => {
    picked[cat] = state.picks[cat].map(id => (meals[cat] || []).find(m => m.id === id)).filter(Boolean);
  });
  return { v: 2, profiles: state.profiles, prompt: state.lastGeneration.prompt, picks: picked,
           weeklyExtrasA: state.weeklyExtrasA, pantryStaples: state.pantryStaples, from: state.profiles.a.name };
}
function buildShareLink() {
  const payload = buildPayload();
  const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(payload));
  return { url: location.origin + location.pathname + '#review?d=' + compressed, compressed, payload };
}
function renderShare(root) {
  if (!state.lastGeneration) {
    root.innerHTML = `<div class="bg-amber-50 border border-amber-200 p-4 rounded-md"><p>No meals generated yet. <a href="#generate" class="underline">Generate some first</a>.</p></div>`;
    return;
  }
  const { url, compressed } = buildShareLink();
  const counts = ['breakfast','lunch','dinner','snack'].map(c => state.picks[c].length);
  root.innerHTML = `<div class="space-y-5">
    <header><h2 class="text-2xl font-semibold">Share with your partner</h2>
      <p class="text-stone-600 mt-1">Generate a short link they can tap from their phone.</p></header>
    <section class="bg-white p-5 rounded-lg border border-stone-200">
      <div class="text-sm text-stone-600 mb-3">Your picks: ${counts[0]} breakfast, ${counts[1]} lunch, ${counts[2]} dinner, ${counts[3]} snack. Plus ${state.weeklyExtrasA.length} extra item${state.weeklyExtrasA.length===1?'':'s'}.</div>
      <div class="mb-5">
        <label class="block text-sm font-medium text-stone-700 mb-1">Short link (SMS-friendly) ⭐</label>
        <div class="flex gap-2">
          <button id="make-short" class="px-4 py-2 bg-emerald-700 text-white rounded-md hover:bg-emerald-800 text-sm flex items-center gap-2">
            <span id="short-spinner" class="hidden"><span class="spinner"></span></span>
            <span id="short-label">Generate short link</span>
          </button>
          <span id="short-status" class="text-sm text-stone-600 self-center"></span>
        </div>
        <div id="short-result" class="mt-2"></div>
        <p class="text-xs text-stone-500 mt-1">Uses dpaste.com (180-day expiry). Data is public to anyone with the link; never includes your API key.</p>
      </div>
      <details class="border-t border-stone-200 pt-4">
        <summary class="text-sm font-medium text-stone-700 hover:text-stone-900">Or use the long link / code (offline-friendly)</summary>
        <div class="mt-3 space-y-3">
          <div><label class="block text-sm font-medium text-stone-700 mb-1">Full link (${url.length} chars)</label>
            <div class="flex gap-2">
              <input id="share-url" readonly value="${escapeHtml(url)}" class="flex-1 px-3 py-2 border border-stone-300 rounded-md font-mono text-xs bg-stone-50">
              <button id="copy-link" class="px-4 py-2 bg-stone-700 text-white rounded-md hover:bg-stone-800 text-sm">Copy</button>
            </div></div>
          <div><label class="block text-sm font-medium text-stone-700 mb-1">Or copy this code (paste in partner's app)</label>
            <textarea id="share-code" readonly class="w-full px-3 py-2 border border-stone-300 rounded-md font-mono text-xs bg-stone-50" rows="3">${escapeHtml(compressed)}</textarea>
            <button id="copy-code" class="mt-2 px-4 py-2 bg-stone-700 text-white rounded-md text-sm hover:bg-stone-800">Copy code</button>
          </div>
        </div>
      </details>
    </section>
    <section class="bg-white p-5 rounded-lg border border-stone-200">
      <h3 class="font-semibold mb-2">Receiving a link from your partner?</h3>
      <p class="text-sm text-stone-600 mb-2">Paste a picks link (to review) <em>or</em> a shopping-list link (to view final shopping list).</p>
      <textarea id="paste-code" placeholder="Paste here..." rows="2" class="w-full px-3 py-2 border border-stone-300 rounded-md font-mono text-xs"></textarea>
      <button id="open-paste" class="mt-2 px-4 py-2 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-800">Open</button>
    </section>
    <div class="pt-4 border-t border-stone-200 flex gap-3">
      <a href="#picks" class="px-5 py-2.5 bg-white border border-stone-300 rounded-md hover:bg-stone-100">← Back</a>
      <button id="self-review" class="px-5 py-2.5 bg-stone-800 text-white rounded-md hover:bg-stone-900">Or finalize myself →</button>
    </div>
  </div>`;
  document.getElementById('copy-link').onclick = () => copyToClipboard(url);
  document.getElementById('copy-code').onclick = () => copyToClipboard(compressed);
  document.getElementById('self-review').onclick = () => go('review', { d: compressed });
  document.getElementById('open-paste').onclick = () => {
    const raw = document.getElementById('paste-code').value.trim();
    if (!raw) { toast('Paste something first'); return; }
    handleIncomingShare(raw);
  };
  document.getElementById('make-short').onclick = async () => {
    const sp = document.getElementById('short-spinner'), lbl = document.getElementById('short-label');
    const stat = document.getElementById('short-status'), result = document.getElementById('short-result');
    sp.classList.remove('hidden'); lbl.textContent = 'Uploading…'; stat.textContent = ''; result.innerHTML = '';
    try {
      const id = await postToPasteService(compressed);
      const shortUrl = location.origin + location.pathname + '#review?u=' + id;
      result.innerHTML = `<label class="block text-sm font-medium text-stone-700 mb-1">Your short link:</label>
        <div class="flex gap-2">
          <input id="short-url" readonly value="${escapeHtml(shortUrl)}" class="flex-1 px-3 py-2 border border-stone-300 rounded-md font-mono text-xs bg-emerald-50">
          <button id="copy-short" class="px-4 py-2 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-800">Copy</button>
        </div><p class="text-xs text-stone-500 mt-1">Length: ${shortUrl.length} chars. Safe for SMS.</p>`;
      document.getElementById('copy-short').onclick = () => copyToClipboard(shortUrl);
    } catch (e) { stat.innerHTML = `<span class="text-red-700">Error: ${escapeHtml(e.message)}. Use the long link below.</span>`; }
    finally { sp.classList.add('hidden'); lbl.textContent = 'Generate short link'; }
  };
}
async function handleIncomingShare(raw) {
  const s = raw.trim();
  if (s.indexOf('#shopping') >= 0) return handleIncomingShopping(s);
  let stage = '', val = '';
  const ri = s.indexOf('#review');
  if (ri >= 0) {
    const tail = s.slice(ri); const qi = tail.indexOf('?');
    if (qi < 0) { toast('Link has no params'); return; }
    tail.slice(qi+1).split('&').forEach(pair => {
      const eq = pair.indexOf('='); const k = pair.slice(0,eq), v = pair.slice(eq+1);
      if (k === 'd') { stage='D'; val=v; } else if (k === 'u') { stage='U'; val=v; }
    });
  } else if (/^[A-Za-z0-9]{3,40}$/.test(s)) { stage='U'; val=s; }
  else { stage='D'; val=s; }
  if (stage === 'U') {
    toast('Fetching shared plan…');
    try {
      const compressed = await fetchFromPasteService(val);
      const payload = decodeShare(compressed);
      if (payload && payload.kind === 'finalPlan') go('shopping', { p: val });
      else go('review', { d: compressed });
    } catch (e) { toast('Fetch failed: ' + e.message); }
  } else if (stage === 'D') {
    const payload = decodeShare(val);
    if (payload && payload.kind === 'finalPlan') go('shopping', { d: val });
    else go('review', { d: val });
  }
}
async function handleIncomingShopping(raw) {
  let s = raw.trim();
  const si = s.indexOf('#shopping'); const ri = s.indexOf('#review');
  if (si >= 0) {
    const qi = s.indexOf('?', si); if (qi < 0) { toast('Link missing params'); return; }
    let target = null;
    s.slice(qi+1).split('&').forEach(pair => {
      const eq = pair.indexOf('='); const k = pair.slice(0,eq), v = pair.slice(eq+1);
      if (k === 'd') target = { kind:'d', val:v }; else if (k === 'p') target = { kind:'p', val:v };
    });
    if (!target) { toast('Link missing d/p param'); return; }
    if (target.kind === 'p') go('shopping', { p: target.val }); else go('shopping', { d: target.val });
  } else if (ri >= 0) handleIncomingShare(raw);
  else if (/^[A-Za-z0-9]{3,40}$/.test(s)) go('shopping', { p: s });
  else go('shopping', { d: s });
}
