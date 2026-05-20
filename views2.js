/* ============================================================
 * MEAL PREP COORDINATOR — views2.js (loaded after views.js)
 * Contains: review, shopping, recipes, favorites, pantry, boot
 * ============================================================ */

function decodeShare(d) {
  try { const json = LZString.decompressFromEncodedURIComponent(d); if (!json) return null; return JSON.parse(json); }
  catch (e) { return null; }
}
function computeAutoServings(profile, category, selectedMealsInCat) {
  if (!selectedMealsInCat || selectedMealsInCat.length === 0) return new Map();
  const share = KCAL_SHARES[category] ?? 0.25;
  const totalKcalNeeded = (profile.kcalTarget || 2000) * share * PREP_DAYS;
  const kcalPerMeal = totalKcalNeeded / selectedMealsInCat.length;
  const out = new Map();
  selectedMealsInCat.forEach(m => {
    const perServ = m.macrosPerServing?.kcal || 500;
    out.set(m.id, Math.max(0, Math.round(kcalPerMeal / perServ)));
  });
  return out;
}

/* ----- REVIEW VIEW ------------------------------------------ */
function renderReview(root, encodedData, shortId) {
  if (shortId && !encodedData) {
    root.innerHTML = `<div class="text-stone-600 flex items-center gap-2"><span class="spinner"></span> Fetching shared plan…</div>`;
    fetchFromPasteService(shortId).then(compressed => { location.hash = `review?d=${compressed}`; })
      .catch(e => { root.innerHTML = `<div class="bg-red-50 border border-red-200 p-4 rounded-md">Could not fetch: ${escapeHtml(e.message)}</div>`; });
    return;
  }
  if (!encodedData) {
    root.innerHTML = `<div class="bg-amber-50 border border-amber-200 p-4 rounded-md"><p>No data in URL. <a href="#share" class="underline">Go to share screen</a> to paste a code.</p></div>`;
    return;
  }
  const payload = decodeShare(encodedData);
  if (!payload) { root.innerHTML = `<div class="bg-red-50 border border-red-200 p-4 rounded-md"><p>Could not decode share link.</p></div>`; return; }

  if (!state.finalPlan || state.finalPlan.encoded !== encodedData) {
    const fp = { encoded: encodedData, from: payload.from, profiles: payload.profiles, prompt: payload.prompt,
                 picks: payload.picks, pantryStaples: payload.pantryStaples || state.pantryStaples,
                 weeklyExtrasA: payload.weeklyExtrasA || [], weeklyExtrasB: [], selections: {} };
    ['breakfast','lunch','dinner','snack'].forEach(cat => {
      (payload.picks[cat] || []).forEach(m => {
        fp.selections[m.id] = { selected: false, servingsA: null, servingsB: null, servingsManual: false,
                                 addonForB: !!m.carbAddon, addonForA: false };
      });
    });
    state.finalPlan = fp;
    saveState();
  }
  const fp = state.finalPlan;
  const autoServings = autoServingsForFinalPlan(fp);
  const order = [['breakfast','Breakfast','☕'],['lunch','Lunch','🥙'],['dinner','Dinner','🍽️'],['snack','Snacks','🍎']];

  root.innerHTML = `<div class="space-y-5">
    <header><h2 class="text-2xl font-semibold">Finalize the plan</h2>
      <p class="text-stone-600 mt-1">${escapeHtml(payload.from || 'Partner')} picked these. Check meals to cook — servings auto-calculate from each person's daily kcal target.</p>
      ${payload.prompt ? `<div class="mt-2 text-sm text-stone-500">Original prompt: <em>"${escapeHtml(payload.prompt)}"</em></div>` : ''}</header>
    ${order.map(([k,l,e]) => {
      const items = (payload.picks[k] || []);
      if (items.length === 0) return '';
      return `<section><h3 class="text-lg font-semibold mb-3">${e} ${l}</h3>
        <div class="space-y-3">${items.map(m => reviewMealCard(m, k, fp.selections[m.id], fp.profiles, autoServings)).join('')}</div></section>`;
    }).join('')}
    ${renderExtrasEditorForB(fp.weeklyExtrasA, fp.weeklyExtrasB)}
    <div class="pt-4 border-t border-stone-200 flex gap-3">
      <button id="build-shopping" class="px-5 py-2.5 bg-emerald-700 text-white rounded-md font-medium hover:bg-emerald-800">Generate shopping list →</button>
    </div>
  </div>`;

  document.querySelectorAll('[data-sel]').forEach(el => {
    el.onchange = () => {
      const id = el.getAttribute('data-sel'), field = el.getAttribute('data-field');
      const sel = fp.selections[id]; if (!sel) return;
      if (field === 'selected' || field === 'addonForA' || field === 'addonForB') sel[field] = el.checked;
      else if (field === 'servingsA' || field === 'servingsB') { sel[field] = Math.max(0, Number(el.value)||0); sel.servingsManual = true; }
      saveState();
      if (field === 'selected') renderReview(root, encodedData);
    };
  });
  attachExtrasHandlersForB();
  document.getElementById('build-shopping').onclick = () => { saveState(); go('shopping'); };
}
function autoServingsForFinalPlan(fp) {
  const result = { a: new Map(), b: new Map() };
  ['breakfast','lunch','dinner','snack'].forEach(cat => {
    const sel = (fp.picks[cat] || []).filter(m => fp.selections[m.id]?.selected);
    computeAutoServings(fp.profiles.a, cat, sel).forEach((v,k) => result.a.set(k,v));
    computeAutoServings(fp.profiles.b, cat, sel).forEach((v,k) => result.b.set(k,v));
  });
  return result;
}
function getEffectiveServings(fp, autoServings, mealId, personKey) {
  const sel = fp.selections[mealId];
  if (!sel || !sel.selected) return 0;
  const K = personKey.toUpperCase();
  if (sel.servingsManual && sel[`servings${K}`] !== null) return sel[`servings${K}`];
  return autoServings[personKey].get(mealId) || 0;
}
function reviewMealCard(m, category, sel, profiles, autoServings) {
  if (!sel) return '';
  const macros = m.macrosPerServing || {};
  const nameA = profiles?.a?.name || 'Person A', nameB = profiles?.b?.name || 'Person B';
  const aServ = sel.selected ? (sel.servingsManual && sel.servingsA !== null ? sel.servingsA : (autoServings.a.get(m.id) ?? 0)) : 0;
  const bServ = sel.selected ? (sel.servingsManual && sel.servingsB !== null ? sel.servingsB : (autoServings.b.get(m.id) ?? 0)) : 0;
  return `<article class="rounded-lg border border-stone-200 bg-white p-4 ${sel.selected ? '' : 'opacity-70'}">
    <div class="flex items-start gap-3">
      <input type="checkbox" data-sel="${m.id}" data-field="selected" ${sel.selected?'checked':''} class="w-5 h-5 mt-1 accent-emerald-600">
      <div class="flex-1">
        <div class="flex items-baseline justify-between gap-3">
          <h4 class="font-semibold">${escapeHtml(m.name)}</h4>
          <span class="text-xs text-stone-500">${macros.kcal||'?'} kcal · ${macros.protein||'?'}g P · ${macros.carbs||'?'}g C · ${macros.fat||'?'}g F per serving</span>
        </div>
        <p class="text-sm text-stone-600">${escapeHtml(m.description || '')}</p>
        ${sel.selected ? `<div class="mt-3 text-sm bg-emerald-50 border border-emerald-200 rounded p-2">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div><span class="font-medium">${escapeHtml(nameA)}:</span> ${aServ} servings · <span class="font-medium">${escapeHtml(nameB)}:</span> ${bServ} servings <span class="text-stone-500">(${sel.servingsManual?'manual':'auto'})</span></div>
            <button data-override-id="${m.id}" class="text-xs text-emerald-700 underline">${sel.servingsManual?'reset to auto':'override'}</button>
          </div>
          <div class="mt-2 grid grid-cols-2 gap-2 ${sel.servingsManual?'':'hidden'}">
            <label class="text-xs">Servings for ${escapeHtml(nameA)}<br><input type="number" min="0" data-sel="${m.id}" data-field="servingsA" value="${aServ}" class="w-20 mt-1 px-2 py-1 border border-stone-300 rounded"></label>
            <label class="text-xs">Servings for ${escapeHtml(nameB)}<br><input type="number" min="0" data-sel="${m.id}" data-field="servingsB" value="${bServ}" class="w-20 mt-1 px-2 py-1 border border-stone-300 rounded"></label>
          </div></div>` : ''}
        ${m.carbAddon ? `<div class="mt-3 text-sm bg-amber-50 border border-amber-200 p-2 rounded">
          <div class="font-medium">Optional carb add-on per serving:</div>
          <div class="text-stone-700">${escapeHtml(m.carbAddon.amount)} ${escapeHtml(m.carbAddon.unit)} ${escapeHtml(m.carbAddon.item)} (+${m.carbAddon.macros?.kcal||0} kcal, +${m.carbAddon.macros?.carbs||0}g C)</div>
          <div class="mt-2 flex gap-4">
            <label class="flex items-center gap-1"><input type="checkbox" data-sel="${m.id}" data-field="addonForA" ${sel.addonForA?'checked':''} class="accent-emerald-600"> Add for ${escapeHtml(nameA)}</label>
            <label class="flex items-center gap-1"><input type="checkbox" data-sel="${m.id}" data-field="addonForB" ${sel.addonForB?'checked':''} class="accent-emerald-600"> Add for ${escapeHtml(nameB)}</label>
          </div></div>` : ''}
        <details class="mt-3"><summary class="text-sm text-emerald-700 font-medium">View recipe</summary>
          <div class="mt-2 text-sm">
            <div class="font-medium">Ingredients (batch of ${m.servings||'?'}):</div>
            <ul class="list-disc list-inside text-stone-700">${(m.ingredients||[]).map(i => `<li>${escapeHtml(i.amount)} ${escapeHtml(i.unit)} ${escapeHtml(i.item)}</li>`).join('')}</ul>
            <div class="font-medium mt-2">Instructions:</div>
            <div class="text-stone-700 recipe-body">${escapeHtml(m.instructions || '')}</div>
            ${m.recipeUrl ? `<a href="${escapeHtml(m.recipeUrl)}" target="_blank" class="text-emerald-700 underline">Recipe link ↗</a>` : ''}
          </div></details>
      </div></div></article>`;
}
function renderExtrasEditorForB(extrasA, extrasB) {
  return `<section class="bg-white p-5 rounded-lg border border-stone-200">
    <h3 class="font-semibold mb-2">Additional shopping items</h3>
    <p class="text-sm text-stone-600 mb-3">Items not in any meal. Pantry staples are added separately in <a href="#pantry" class="underline">🧺 Pantry</a>.</p>
    <div class="text-sm bg-stone-50 border border-stone-200 rounded p-3 mb-3">
      <div class="font-medium text-stone-700 mb-1">${escapeHtml(state.finalPlan.profiles?.a?.name || 'Partner')} added:</div>
      ${(!extrasA || extrasA.length === 0) ? `<div class="text-stone-500 italic">(none)</div>` : `<ul class="list-disc list-inside text-stone-700">${extrasA.map(x => `<li>${escapeHtml(x.amount)} ${escapeHtml(x.unit)} ${escapeHtml(x.item)}</li>`).join('')}</ul>`}
    </div>
    <div class="font-medium text-sm mb-2">Your additions:</div>
    <div id="extras-list" class="space-y-2 mb-3">${(extrasB||[]).map((x,i) => extrasRow(x,i)).join('')}</div>
    <button id="add-extra" class="text-sm px-3 py-1.5 bg-white border border-emerald-300 text-emerald-700 rounded-md hover:bg-emerald-50">+ Add item</button>
  </section>`;
}
function attachExtrasHandlersForB() {
  attachExtrasHandlers('B');
  document.querySelectorAll('[data-override-id]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-override-id'); const sel = state.finalPlan.selections[id]; if (!sel) return;
      sel.servingsManual = !sel.servingsManual;
      if (sel.servingsManual && (sel.servingsA === null || sel.servingsB === null)) {
        const auto = autoServingsForFinalPlan(state.finalPlan);
        if (sel.servingsA === null) sel.servingsA = auto.a.get(id) ?? 0;
        if (sel.servingsB === null) sel.servingsB = auto.b.get(id) ?? 0;
      }
      saveState();
      renderReview(document.getElementById('app'), state.finalPlan.encoded);
    };
  });
}

/* ----- SHOPPING VIEW ---------------------------------------- */
function buildFinalPlanPayload() {
  const fp = state.finalPlan; if (!fp) return null;
  return { v: 2, kind: 'finalPlan', from: state.profiles.a.name, profiles: fp.profiles, prompt: fp.prompt,
           picks: fp.picks, selections: fp.selections, weeklyExtrasA: fp.weeklyExtrasA,
           weeklyExtrasB: fp.weeklyExtrasB, pantryStaples: fp.pantryStaples,
           scaledRecipes: state.scaledRecipes || {},
           consolidatedShopping: state.consolidatedShopping || {} };
}
function applyIncomingFinalPlan(payload, encoded) {
  state.finalPlan = { encoded, from: payload.from, profiles: payload.profiles, prompt: payload.prompt,
                      picks: payload.picks, selections: payload.selections || {},
                      weeklyExtrasA: payload.weeklyExtrasA || [], weeklyExtrasB: payload.weeklyExtrasB || [],
                      pantryStaples: payload.pantryStaples || state.pantryStaples };
  if (payload.scaledRecipes && typeof payload.scaledRecipes === 'object') state.scaledRecipes = payload.scaledRecipes;
  if (payload.consolidatedShopping && typeof payload.consolidatedShopping === 'object') state.consolidatedShopping = payload.consolidatedShopping;
  saveState();
}
function renderShopping(root, encodedD, shortP) {
  if (shortP && (!state.finalPlan || state.finalPlan.encoded !== '__SHORT__' + shortP)) {
    root.innerHTML = `<div class="text-stone-600 flex items-center gap-2"><span class="spinner"></span> Fetching shared shopping list…</div>`;
    fetchFromPasteService(shortP).then(compressed => {
      const payload = decodeShare(compressed);
      if (!payload) { root.innerHTML = `<div class="bg-red-50 border border-red-200 p-4 rounded-md">Could not decode.</div>`; return; }
      applyIncomingFinalPlan(payload, '__SHORT__' + shortP);
      renderShopping(root);
    }).catch(e => { root.innerHTML = `<div class="bg-red-50 border border-red-200 p-4 rounded-md">Could not fetch: ${escapeHtml(e.message)}</div>`; });
    return;
  }
  if (encodedD && (!state.finalPlan || state.finalPlan.encoded !== encodedD)) {
    const payload = decodeShare(encodedD);
    if (payload && payload.kind === 'finalPlan') applyIncomingFinalPlan(payload, encodedD);
    else if (payload && payload.picks) { go('review', { d: encodedD }); return; }
    else { root.innerHTML = `<div class="bg-red-50 border border-red-200 p-4 rounded-md">Could not decode shopping link.</div>`; return; }
  }
  const fp = state.finalPlan;
  if (!fp) {
    root.innerHTML = `<div class="bg-amber-50 border border-amber-200 p-4 rounded-md">
      <p>No finalized plan yet on this device.</p>
      <p class="mt-2 text-sm">If your partner sent a link, paste it here:</p>
      <textarea id="incoming-shop" rows="2" class="w-full mt-2 px-3 py-2 border border-stone-300 rounded-md font-mono text-xs" placeholder="Paste shopping link or code..."></textarea>
      <button id="open-incoming-shop" class="mt-2 px-4 py-2 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-800">Open shopping list</button>
      <p class="mt-3 text-sm">Or <a href="#share" class="underline">go to share screen</a> to start your own.</p></div>`;
    const btn = document.getElementById('open-incoming-shop');
    if (btn) btn.onclick = () => {
      const raw = document.getElementById('incoming-shop').value.trim();
      if (!raw) { toast('Paste a link or code first'); return; }
      handleIncomingShopping(raw);
    };
    return;
  }
  const auto = autoServingsForFinalPlan(fp);
  const { groups, totalMacros, selectedMeals } = aggregateShoppingList(fp, auto);
  const nameA = fp.profiles?.a?.name || 'Person A', nameB = fp.profiles?.b?.name || 'Person B';
  const aisleOrder = ['produce','meat','seafood','dairy','eggs','bakery','pantry','spices','frozen','condiments','other'];

  const consolHash = hashShoppingInput(groups);
  let orderedGroups, isConsolidated = false;
  const consol = state.consolidatedShopping;
  if (consol && consol.hash === consolHash && Array.isArray(consol.items) && consol.items.length > 0) {
    const cg = {};
    consol.items.forEach(it => {
      const a = (it.aisle || 'other').toLowerCase();
      if (!cg[a]) cg[a] = [];
      cg[a].push({
        item: (it.item || '').toLowerCase().trim(),
        unit: (it.unit || '').toLowerCase().trim(),
        amount: Number(it.amount) || 0,
        source: 'consolidated',
      });
    });
    Object.keys(cg).forEach(a => cg[a].sort((x,y) => x.item.localeCompare(y.item)));
    orderedGroups = aisleOrder.map(a => [a, cg[a]]).filter(([a,it]) => it && it.length > 0);
    isConsolidated = true;
  } else {
    orderedGroups = aisleOrder.map(a => [a, groups[a]]).filter(([a,it]) => it && it.length > 0);
  }

  root.innerHTML = `<div class="space-y-5">
    <header class="flex items-start justify-between gap-3 flex-wrap">
      <div><h2 class="text-2xl font-semibold">Shopping list</h2>
        <p class="text-stone-600 mt-1">${selectedMeals.length} meals selected. Includes pantry staples and added items.</p></div>
      <div class="flex gap-2 no-print flex-wrap">
        <a href="#recipes" class="px-4 py-2 bg-white border border-stone-300 rounded-md text-sm hover:bg-stone-100">📖 View recipes</a>
        <button id="share-shopping" class="px-4 py-2 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-800">📤 Share</button>
        <button id="consolidate-list" class="px-4 py-2 ${isConsolidated?'bg-emerald-100 text-emerald-800 border border-emerald-300':'bg-amber-600 text-white hover:bg-amber-700'} rounded-md text-sm flex items-center gap-2">
          <span id="consol-spinner" class="hidden"><span class="spinner"></span></span>
          <span id="consol-label">${isConsolidated ? '✓ Consolidated · Refresh' : '✨ Consolidate units'}</span>
        </button>
        <button id="copy-list" class="px-4 py-2 bg-stone-700 text-white rounded-md text-sm hover:bg-stone-800">Copy as text</button>
        <button id="print-list" class="px-4 py-2 bg-white border border-stone-300 rounded-md text-sm hover:bg-stone-100">Print</button>
      </div>
    </header>
    <section id="share-shopping-panel" class="bg-white p-4 rounded-lg border border-stone-200 hidden no-print">
      <h3 class="font-semibold mb-2">Share this shopping list</h3>
      <p class="text-sm text-stone-600 mb-3">Send your partner a link that opens directly to this same shopping list. Re-share anytime if you change selections.</p>
      <div class="flex gap-2 items-center">
        <button id="make-short-shop" class="px-4 py-2 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-800 flex items-center gap-2">
          <span id="short-shop-spinner" class="hidden"><span class="spinner"></span></span>
          <span id="short-shop-label">Generate short link</span>
        </button>
        <span id="short-shop-status" class="text-sm text-stone-600"></span>
      </div>
      <div id="short-shop-result" class="mt-3"></div>
      <details class="mt-4 border-t border-stone-200 pt-3">
        <summary class="text-sm font-medium text-stone-700 hover:text-stone-900">Or use the long link (offline)</summary>
        <div class="mt-2">
          <textarea id="long-shop-link" readonly rows="3" class="w-full px-3 py-2 border border-stone-300 rounded-md font-mono text-xs bg-stone-50"></textarea>
          <button id="copy-long-shop" class="mt-2 px-4 py-2 bg-stone-700 text-white rounded-md text-sm hover:bg-stone-800">Copy long link</button>
        </div>
      </details>
    </section>
    <section class="bg-white p-4 rounded-lg border border-stone-200 text-sm">
      <div class="font-semibold mb-2">Plan summary</div>
      <ul class="list-disc list-inside text-stone-700">
        ${selectedMeals.map(m => {
          const aS = getEffectiveServings(fp, auto, m.id, 'a'), bS = getEffectiveServings(fp, auto, m.id, 'b');
          const sel = fp.selections[m.id];
          return `<li><strong>${escapeHtml(m.name)}</strong> — ${aS}× ${escapeHtml(nameA)}, ${bS}× ${escapeHtml(nameB)}${sel.addonForA||sel.addonForB ? ' (with add-on)' : ''}</li>`;
        }).join('')}
      </ul>
      <div class="mt-3 grid grid-cols-2 gap-2 text-stone-600">
        <div>${escapeHtml(nameA)} total: ${round(totalMacros.a.kcal)} kcal · ${round(totalMacros.a.protein)}g P · ${round(totalMacros.a.carbs)}g C · ${round(totalMacros.a.fat)}g F</div>
        <div>${escapeHtml(nameB)} total: ${round(totalMacros.b.kcal)} kcal · ${round(totalMacros.b.protein)}g P · ${round(totalMacros.b.carbs)}g C · ${round(totalMacros.b.fat)}g F</div>
      </div>
      <div class="mt-2 text-xs text-stone-500">Daily kcal target: ${escapeHtml(nameA)} ${fp.profiles.a.kcalTarget || '?'}, ${escapeHtml(nameB)} ${fp.profiles.b.kcalTarget || '?'}.</div>
    </section>
    ${orderedGroups.map(([aisle, items]) => `<section class="bg-white p-4 rounded-lg border border-stone-200">
      <h3 class="font-semibold text-stone-800 mb-2 capitalize">${aisle}</h3>
      <ul class="space-y-1">${items.map(it => {
        const key = `${aisle}::${it.item}::${it.unit}`;
        const checked = state.checkedItems[key] ? 'checked' : '';
        const lt = state.checkedItems[key] ? 'line-through text-stone-400' : '';
        const amt = it.unit === 'whole' || it.unit === '' ? round(it.amount, 1) : round(it.amount, 2);
        const tag = it.source ? `<span class="text-xs text-stone-400 ml-1">(${it.source})</span>` : '';
        const icUrl = `https://www.instacart.com/store/s?k=${encodeURIComponent(it.item)}`;
        return `<li class="flex items-center gap-2">
          <input type="checkbox" data-key="${escapeHtml(key)}" ${checked} class="w-4 h-4 accent-emerald-600">
          <span class="${lt}"><strong>${amt} ${escapeHtml(it.unit)}</strong> ${escapeHtml(it.item)}</span>
          <a href="${icUrl}" target="_blank" rel="noopener" class="text-sm text-emerald-700 hover:text-emerald-900 no-print" title="Search '${escapeHtml(it.item)}' on Instacart">🛒</a>${tag}</li>`;
      }).join('')}</ul></section>`).join('')}
    <div class="pt-4 border-t border-stone-200 flex gap-3 no-print">
      <a href="#review?d=${fp.encoded}" class="px-5 py-2.5 bg-white border border-stone-300 rounded-md hover:bg-stone-100">← Back to finalize</a>
      <button id="reset-check" class="px-5 py-2.5 bg-white border border-stone-300 rounded-md hover:bg-stone-100 text-sm">Uncheck all</button>
    </div>
  </div>`;
  document.querySelectorAll('input[data-key]').forEach(cb => {
    cb.onchange = () => {
      const k = cb.getAttribute('data-key'); state.checkedItems[k] = cb.checked; saveState();
      const span = cb.parentElement.querySelector('span');
      if (span) { span.classList.toggle('line-through'); span.classList.toggle('text-stone-400'); }
    };
  });
  document.getElementById('copy-list').onclick = () => copyToClipboard(buildInstacartText(orderedGroups));
  document.getElementById('print-list').onclick = () => window.print();
  document.getElementById('reset-check').onclick = () => { state.checkedItems = {}; saveState(); render(); };
  document.getElementById('consolidate-list').onclick = async () => {
    if (!state.apiKey) { toast('Set your API key in Setup first'); return; }
    const sp = document.getElementById('consol-spinner'), lbl = document.getElementById('consol-label');
    sp.classList.remove('hidden'); lbl.textContent = 'Consolidating…';
    try {
      const flat = [];
      Object.keys(groups).forEach(aisle => (groups[aisle] || []).forEach(it => flat.push({
        item: it.item, amount: round(it.amount, 3), unit: it.unit, aisle,
      })));
      const consolidated = await callClaudeForConsolidatedList(flat);
      state.consolidatedShopping = { hash: consolHash, items: consolidated };
      saveState();
      toast('Consolidated — ' + consolidated.length + ' items'); render();
    } catch (e) { toast('Error: ' + e.message); console.error(e); }
    finally { sp.classList.add('hidden'); lbl.textContent = isConsolidated ? '✓ Consolidated · Refresh' : '✨ Consolidate units'; }
  };
  const sharePanel = document.getElementById('share-shopping-panel');
  document.getElementById('share-shopping').onclick = () => {
    sharePanel.classList.toggle('hidden');
    const payload = buildFinalPlanPayload();
    const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(payload));
    const longUrl = location.origin + location.pathname + '#shopping?d=' + compressed;
    const ta = document.getElementById('long-shop-link'); if (ta) ta.value = longUrl;
  };
  document.getElementById('copy-long-shop').onclick = () => {
    const ta = document.getElementById('long-shop-link'); if (ta) copyToClipboard(ta.value);
  };
  document.getElementById('make-short-shop').onclick = async () => {
    const sp = document.getElementById('short-shop-spinner'), lbl = document.getElementById('short-shop-label');
    const stat = document.getElementById('short-shop-status'), result = document.getElementById('short-shop-result');
    sp.classList.remove('hidden'); lbl.textContent = 'Uploading…'; stat.textContent = ''; result.innerHTML = '';
    try {
      const payload = buildFinalPlanPayload();
      const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(payload));
      const id = await postToPasteService(compressed);
      const shortUrl = location.origin + location.pathname + '#shopping?p=' + id;
      result.innerHTML = `<label class="block text-sm font-medium text-stone-700 mb-1">Share this link:</label>
        <div class="flex gap-2">
          <input id="short-shop-url" readonly value="${escapeHtml(shortUrl)}" class="flex-1 px-3 py-2 border border-stone-300 rounded-md font-mono text-xs bg-emerald-50">
          <button id="copy-short-shop" class="px-4 py-2 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-800">Copy</button>
        </div><p class="text-xs text-stone-500 mt-1">${shortUrl.length} chars. Regenerate after changes — links are snapshots.</p>`;
      document.getElementById('copy-short-shop').onclick = () => copyToClipboard(shortUrl);
    } catch (e) { stat.innerHTML = `<span class="text-red-700">Error: ${escapeHtml(e.message)}. Use long link below.</span>`; }
    finally { sp.classList.add('hidden'); lbl.textContent = 'Generate short link'; }
  };
}
function hashShoppingInput(groups) {
  const flat = [];
  Object.keys(groups).sort().forEach(aisle => {
    (groups[aisle] || []).forEach(it => {
      flat.push(`${aisle}|${it.item}|${it.unit}|${(Number(it.amount) || 0).toFixed(3)}`);
    });
  });
  return flat.join('\n');
}

function aggregateShoppingList(fp, autoServings) {
  const groups = {}; const totalMacros = { a:{kcal:0,protein:0,carbs:0,fat:0}, b:{kcal:0,protein:0,carbs:0,fat:0} };
  const selectedMeals = [];
  const addIng = (item, amount, unit, aisle, source) => {
    aisle = (aisle || 'other').toLowerCase(); item = (item || '').toLowerCase().trim(); unit = (unit || '').toLowerCase().trim();
    if (!item || !Number.isFinite(amount) || amount <= 0) return;
    if (!groups[aisle]) groups[aisle] = [];
    const existing = groups[aisle].find(x => x.item === item && x.unit === unit);
    if (existing) { existing.amount += amount; if (source && existing.source && !existing.source.includes(source)) existing.source = existing.source + ',' + source; }
    else groups[aisle].push({ item, unit, amount, source: source || 'meals' });
  };
  const allMeals = [].concat(fp.picks.breakfast||[]).concat(fp.picks.lunch||[]).concat(fp.picks.dinner||[]).concat(fp.picks.snack||[]);
  allMeals.forEach(m => {
    const sel = fp.selections[m.id]; if (!sel || !sel.selected) return;
    selectedMeals.push(m);
    const aServ = getEffectiveServings(fp, autoServings, m.id, 'a');
    const bServ = getEffectiveServings(fp, autoServings, m.id, 'b');
    const servingsTotal = aServ + bServ; if (servingsTotal === 0) return;
    const scale = servingsTotal / Math.max(1, m.servings || 1);
    (m.ingredients || []).forEach(i => { addIng(i.item, (Number(i.amount)||0) * scale, i.unit, i.aisle, 'meals'); });
    if (m.carbAddon) {
      const addonServings = (sel.addonForA ? aServ : 0) + (sel.addonForB ? bServ : 0);
      if (addonServings > 0) { const a = m.carbAddon; addIng(a.item, (Number(a.amount)||0) * addonServings, a.unit, 'pantry', 'add-on'); }
    }
    const macros = m.macrosPerServing || {};
    ['kcal','protein','carbs','fat'].forEach(k => { totalMacros.a[k] += (macros[k]||0) * aServ; totalMacros.b[k] += (macros[k]||0) * bServ; });
    if (m.carbAddon && m.carbAddon.macros) {
      const am = m.carbAddon.macros;
      ['kcal','protein','carbs','fat'].forEach(k => {
        if (sel.addonForA) totalMacros.a[k] += (am[k]||0) * aServ;
        if (sel.addonForB) totalMacros.b[k] += (am[k]||0) * bServ;
      });
    }
  });
  (fp.pantryStaples || []).forEach(s => { if (s.enabled) addIng(s.item, Number(s.amount)||0, s.unit, s.aisle, 'pantry'); });
  (fp.weeklyExtrasA || []).forEach(x => addIng(x.item, Number(x.amount)||0, x.unit, x.aisle, 'A'));
  (fp.weeklyExtrasB || []).forEach(x => addIng(x.item, Number(x.amount)||0, x.unit, x.aisle, 'B'));
  Object.keys(groups).forEach(a => groups[a].sort((x,y) => x.item.localeCompare(y.item)));
  return { groups, totalMacros, selectedMeals };
}
function buildInstacartText(orderedGroups) {
  const lines = [];
  orderedGroups.forEach(([aisle, items]) => {
    items.forEach(it => {
      const amt = it.unit === 'whole' || it.unit === '' ? round(it.amount, 1) : round(it.amount, 2);
      lines.push(`${amt} ${it.unit} ${it.item}`.trim());
    });
  });
  return lines.join('\n');
}

/* ----- RECIPES VIEW ----------------------------------------- */
function findMealForRecipes(mealId) {
  const fp = state.finalPlan;
  if (fp) {
    for (const cat of ['breakfast','lunch','dinner','snack']) {
      const list = fp.picks[cat] || [];
      const idx = list.findIndex(m => m.id === mealId);
      if (idx >= 0) return { meal: list[idx], save: url => { list[idx].recipeUrl = url; saveState(); } };
    }
  }
  const gen = state.lastGeneration?.meals || {};
  for (const cat of ['breakfast','lunch','dinner','snack']) {
    const list = gen[cat] || [];
    const idx = list.findIndex(m => m.id === mealId);
    if (idx >= 0) return { meal: list[idx], save: url => { list[idx].recipeUrl = url; saveState(); } };
  }
  const favIdx = state.favorites.findIndex(f => f.id === mealId);
  if (favIdx >= 0) return { meal: state.favorites[favIdx], save: url => { state.favorites[favIdx].recipeUrl = url; saveState(); } };
  return null;
}
function recipesViewMeals() {
  const fp = state.finalPlan;
  if (fp) {
    const out = [];
    ['breakfast','lunch','dinner','snack'].forEach(cat => {
      (fp.picks[cat] || []).forEach(m => { const sel = fp.selections[m.id]; if (sel && sel.selected) out.push({ meal: m, category: cat }); });
    });
    if (out.length > 0) return { meals: out, label: "meals you're cooking this week" };
  }
  const gen = state.lastGeneration?.meals;
  if (gen && state.picks) {
    const out = [];
    ['breakfast','lunch','dinner','snack'].forEach(cat => {
      (state.picks[cat] || []).forEach(id => { const m = (gen[cat] || []).find(x => x.id === id); if (m) out.push({ meal: m, category: cat }); });
    });
    if (out.length > 0) return { meals: out, label: 'your top picks' };
  }
  if (gen) {
    const out = [];
    ['breakfast','lunch','dinner','snack'].forEach(cat => { (gen[cat] || []).forEach(m => out.push({ meal: m, category: cat })); });
    if (out.length > 0) return { meals: out, label: 'all generated meals this week' };
  }
  return { meals: [], label: '' };
}
function renderRecipes(root, encodedD, shortP) {
  // Cross-device sharing: fetch finalPlan from URL params if needed
  if (shortP && (!state.finalPlan || state.finalPlan.encoded !== '__SHORT__' + shortP)) {
    root.innerHTML = `<div class="text-stone-600 flex items-center gap-2"><span class="spinner"></span> Fetching shared recipes…</div>`;
    fetchFromPasteService(shortP).then(compressed => {
      const payload = decodeShare(compressed);
      if (!payload) { root.innerHTML = `<div class="bg-red-50 border border-red-200 p-4 rounded-md">Could not decode.</div>`; return; }
      applyIncomingFinalPlan(payload, '__SHORT__' + shortP);
      renderRecipes(root);
    }).catch(e => { root.innerHTML = `<div class="bg-red-50 border border-red-200 p-4 rounded-md">Could not fetch: ${escapeHtml(e.message)}</div>`; });
    return;
  }
  if (encodedD && (!state.finalPlan || state.finalPlan.encoded !== encodedD)) {
    const payload = decodeShare(encodedD);
    if (payload && payload.kind === 'finalPlan') applyIncomingFinalPlan(payload, encodedD);
    else { root.innerHTML = `<div class="bg-red-50 border border-red-200 p-4 rounded-md">Could not decode recipes link.</div>`; return; }
  }

  const { meals, label } = recipesViewMeals();
  if (meals.length === 0) {
    root.innerHTML = `<div class="bg-amber-50 border border-amber-200 p-4 rounded-md"><p>No recipes to show yet. <a href="#generate" class="underline">Generate meals</a>, pick some, or finalize a plan.</p></div>`;
    return;
  }

  // Compute target servings per meal (only meaningful if finalPlan exists)
  const fp = state.finalPlan;
  const targetServings = {};
  let canScale = false;
  if (fp) {
    const autoSrv = autoServingsForFinalPlan(fp);
    meals.forEach(({ meal }) => {
      const a = getEffectiveServings(fp, autoSrv, meal.id, 'a');
      const b = getEffectiveServings(fp, autoSrv, meal.id, 'b');
      targetServings[meal.id] = a + b;
    });
    canScale = true;
  }

  // Which meals need scaling (no cached scaled version, or target servings changed)
  const needsScaling = canScale ? meals.filter(({ meal }) => {
    const t = targetServings[meal.id]; if (!t || t <= 0) return false;
    const cached = state.scaledRecipes?.[meal.id];
    return !cached || cached.targetServings !== t;
  }) : [];
  const scaledCount = canScale ? meals.filter(({ meal }) => {
    const t = targetServings[meal.id]; if (!t || t <= 0) return false;
    const cached = state.scaledRecipes?.[meal.id];
    return cached && cached.targetServings === t;
  }).length : 0;

  const catLabels = { breakfast:'☕ Breakfast', lunch:'🥙 Lunch', dinner:'🍽️ Dinner', snack:'🍎 Snacks' };

  const scaleBannerHtml = (() => {
    if (!canScale) return `<div class="bg-stone-50 border border-stone-200 p-3 rounded text-sm text-stone-600 no-print">
      ℹ️ Recipe scaling is available after you finalize a plan (when you know each person's target servings).
    </div>`;
    if (needsScaling.length === 0 && scaledCount > 0) return `<div class="bg-emerald-50 border border-emerald-200 p-3 rounded text-sm flex items-center justify-between gap-3 no-print">
      <span class="text-emerald-800">✓ All ${scaledCount} recipe${scaledCount===1?' is':'s are'} scaled to this week's servings.</span>
      <button id="rescale-all" class="text-xs px-3 py-1 bg-white border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50">Re-scale</button>
    </div>`;
    return `<div class="bg-amber-50 border border-amber-200 p-3 rounded text-sm flex items-center justify-between gap-3 flex-wrap no-print">
      <div class="text-amber-900">
        ${needsScaling.length} recipe${needsScaling.length===1?'':'s'} ${needsScaling.length===1?'is':'are'} unscaled (still shows original batch sizes).
      </div>
      <button id="scale-all" class="px-3 py-1.5 bg-amber-600 text-white rounded text-sm hover:bg-amber-700 flex items-center gap-2">
        <span id="scale-spinner" class="hidden"><span class="spinner"></span></span>
        <span id="scale-label">✨ Scale to weekly servings</span>
      </button>
    </div>`;
  })();

  root.innerHTML = `<div class="space-y-5">
    <header class="flex items-start justify-between gap-3 flex-wrap">
      <div><h2 class="text-2xl font-semibold">📖 Recipes</h2>
        <p class="text-stone-600 mt-1">Full ingredients & instructions for ${label} (${meals.length} recipe${meals.length===1?'':'s'}). Click ✎ to save a website link to a recipe.</p></div>
      <div class="flex gap-2 no-print flex-wrap">
        ${fp ? `<button id="share-recipes" class="px-4 py-2 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-800">📤 Share recipes</button>` : ''}
        <button id="print-recipes" class="px-4 py-2 bg-stone-700 text-white rounded-md text-sm hover:bg-stone-800">Print all</button>
      </div></header>
    ${scaleBannerHtml}
    <section id="share-recipes-panel" class="bg-white p-4 rounded-lg border border-stone-200 hidden no-print">
      <h3 class="font-semibold mb-2">Share these recipes</h3>
      <p class="text-sm text-stone-600 mb-3">Generates a link that opens directly to this recipes view (with scaled versions if you've scaled them). Same payload as the shopping share — your partner can navigate to either.</p>
      <div class="flex gap-2 items-center">
        <button id="make-short-rec" class="px-4 py-2 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-800 flex items-center gap-2">
          <span id="short-rec-spinner" class="hidden"><span class="spinner"></span></span>
          <span id="short-rec-label">Generate short link</span>
        </button>
        <span id="short-rec-status" class="text-sm text-stone-600"></span>
      </div>
      <div id="short-rec-result" class="mt-3"></div>
    </section>
    ${['breakfast','lunch','dinner','snack'].map(cat => {
      const items = meals.filter(x => x.category === cat);
      if (items.length === 0) return '';
      return `<section><h3 class="text-lg font-semibold mb-3 mt-2 border-b border-stone-200 pb-1">${catLabels[cat]}</h3>
        <div class="space-y-5">${items.map(x => recipeCard(x.meal, targetServings[x.meal.id])).join('')}</div></section>`;
    }).join('')}
  </div>`;
  document.getElementById('print-recipes').onclick = () => window.print();
  document.querySelectorAll('[data-recipe-edit]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-recipe-edit');
      const ed = document.querySelector(`[data-recipe-editor="${id}"]`), dp = document.querySelector(`[data-recipe-display="${id}"]`);
      if (ed) ed.classList.toggle('hidden'); if (dp) dp.classList.toggle('hidden');
      const inp = ed?.querySelector('input'); if (inp && !ed.classList.contains('hidden')) inp.focus();
    };
  });
  document.querySelectorAll('[data-recipe-save]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-recipe-save');
      const inp = document.querySelector(`[data-recipe-input="${id}"]`); if (!inp) return;
      const url = inp.value.trim();
      const r = findMealForRecipes(id); if (!r) { toast('Could not find meal'); return; }
      r.save(url || null);
      toast(url ? 'Recipe link saved' : 'Recipe link cleared');
      renderRecipes(root);
    };
  });
  // Toggle original/scaled per recipe
  document.querySelectorAll('[data-toggle-orig]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-toggle-orig');
      const orig = document.querySelector(`[data-recipe-orig="${id}"]`);
      const scaled = document.querySelector(`[data-recipe-scaled="${id}"]`);
      if (!orig || !scaled) return;
      const showingScaled = !scaled.classList.contains('hidden');
      scaled.classList.toggle('hidden', showingScaled);
      orig.classList.toggle('hidden', !showingScaled);
      btn.textContent = showingScaled ? 'Show scaled' : 'Show original';
    };
  });
  // Scale-all and re-scale handlers
  const scaleBtn = document.getElementById('scale-all') || document.getElementById('rescale-all');
  if (scaleBtn) {
    scaleBtn.onclick = async () => {
      if (!state.apiKey) { toast('Set your API key in Setup first'); return; }
      const targets = (scaleBtn.id === 'scale-all' ? needsScaling : meals).map(({ meal }) => ({
        meal, targetServings: targetServings[meal.id] || 0,
      })).filter(x => x.targetServings > 0);
      if (targets.length === 0) { toast('Nothing to scale'); return; }
      const sp = document.getElementById('scale-spinner'), lbl = document.getElementById('scale-label');
      if (sp) sp.classList.remove('hidden'); if (lbl) lbl.textContent = `Scaling ${targets.length}…`;
      scaleBtn.disabled = true;
      try {
        const scaled = await callClaudeForScaledRecipes(targets);
        if (!state.scaledRecipes) state.scaledRecipes = {};
        scaled.forEach(r => {
          if (!r.id) return;
          state.scaledRecipes[r.id] = {
            targetServings: Number(r.targetServings) || 0, name: r.name,
            ingredients: r.ingredients || [], instructions: r.instructions || '',
            prepNotes: r.prepNotes || '',
          };
        });
        saveState();
        toast(`Scaled ${scaled.length} recipe${scaled.length===1?'':'s'}`);
        renderRecipes(root);
      } catch (e) { toast('Error: ' + e.message); console.error(e); }
      finally { if (sp) sp.classList.add('hidden'); scaleBtn.disabled = false; }
    };
  }
  // Share recipes panel
  const shareBtn = document.getElementById('share-recipes');
  if (shareBtn) {
    const panel = document.getElementById('share-recipes-panel');
    shareBtn.onclick = () => panel.classList.toggle('hidden');
    document.getElementById('make-short-rec').onclick = async () => {
      const sp = document.getElementById('short-rec-spinner'), lbl = document.getElementById('short-rec-label');
      const stat = document.getElementById('short-rec-status'), result = document.getElementById('short-rec-result');
      sp.classList.remove('hidden'); lbl.textContent = 'Uploading…'; stat.textContent = ''; result.innerHTML = '';
      try {
        const payload = buildFinalPlanPayload();
        const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(payload));
        const id = await postToPasteService(compressed);
        const shortUrl = location.origin + location.pathname + '#recipes?p=' + id;
        result.innerHTML = `<label class="block text-sm font-medium text-stone-700 mb-1">Share this link:</label>
          <div class="flex gap-2">
            <input id="short-rec-url" readonly value="${escapeHtml(shortUrl)}" class="flex-1 px-3 py-2 border border-stone-300 rounded-md font-mono text-xs bg-emerald-50">
            <button id="copy-short-rec" class="px-4 py-2 bg-emerald-700 text-white rounded-md text-sm hover:bg-emerald-800">Copy</button>
          </div><p class="text-xs text-stone-500 mt-1">${shortUrl.length} chars. Re-share after scaling or changing selections.</p>`;
        document.getElementById('copy-short-rec').onclick = () => copyToClipboard(shortUrl);
      } catch (e) { stat.innerHTML = `<span class="text-red-700">Error: ${escapeHtml(e.message)}</span>`; }
      finally { sp.classList.add('hidden'); lbl.textContent = 'Generate short link'; }
    };
  }
}
function recipeCard(m, targetServings) {
  const macros = m.macrosPerServing || {};
  const urlDisplay = m.recipeUrl
    ? `<a href="${escapeHtml(m.recipeUrl)}" target="_blank" rel="noopener" class="text-emerald-700 underline break-all">${escapeHtml(m.recipeUrl)}</a>`
    : `<span class="text-stone-400 italic">no link saved</span>`;
  const scaled = state.scaledRecipes?.[m.id];
  const hasFreshScaled = scaled && targetServings && scaled.targetServings === targetServings;
  const ingredientsBlock = (servingsLabel, ings, notesItalic) => `
    <h5 class="font-semibold text-sm text-stone-800 mb-1">Ingredients</h5>
    <p class="text-xs text-stone-500 mb-1">${servingsLabel}</p>
    <ul class="text-sm text-stone-700 space-y-0.5">
      ${(ings || []).map(i => `<li><strong>${escapeHtml(i.amount)} ${escapeHtml(i.unit)}</strong> ${escapeHtml(i.item)}${i.notes ? ` <span class="text-stone-500">(${escapeHtml(i.notes)})</span>` : ''}</li>`).join('')}
    </ul>
    ${notesItalic ? `<div class="mt-2 text-xs text-stone-600 italic">${notesItalic}</div>` : ''}`;
  const instructionsBlock = (instr, notes) => `
    <h5 class="font-semibold text-sm text-stone-800 mb-1">Instructions</h5>
    <div class="text-sm text-stone-700 recipe-body">${escapeHtml(instr || '')}</div>
    ${notes ? `<div class="mt-3 text-xs text-stone-600 italic"><strong>Prep tip:</strong> ${escapeHtml(notes)}</div>` : ''}`;
  const addonNote = m.carbAddon ? `+ optional add-on per serving: ${escapeHtml(m.carbAddon.amount)} ${escapeHtml(m.carbAddon.unit)} ${escapeHtml(m.carbAddon.item)}` : '';
  const scaledHtml = hasFreshScaled ? `<div data-recipe-scaled="${m.id}" class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
    <div class="md:col-span-1 bg-emerald-50 p-3 rounded">
      ${ingredientsBlock(`✨ scaled to ${scaled.targetServings} servings (this week)`, scaled.ingredients, addonNote)}
    </div>
    <div class="md:col-span-2">
      ${instructionsBlock(scaled.instructions, scaled.prepNotes)}
    </div></div>` : '';
  const originalHtml = `<div data-recipe-orig="${m.id}" class="${hasFreshScaled ? 'hidden' : ''} mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
    <div class="md:col-span-1">
      ${ingredientsBlock(`original batch of ${m.servings || '?'}`, m.ingredients, addonNote)}
    </div>
    <div class="md:col-span-2">
      ${instructionsBlock(m.instructions, m.prepNotes)}
    </div></div>`;
  const toggleBtn = hasFreshScaled ? `<button data-toggle-orig="${m.id}" class="text-xs text-emerald-700 underline ml-3 no-print">Show original</button>` : '';
  return `<article class="bg-white p-5 rounded-lg border border-stone-200">
    <div class="flex items-start justify-between gap-3 mb-2">
      <div class="flex-1"><h4 class="font-semibold text-lg">${escapeHtml(m.name)}${hasFreshScaled ? ` <span class="text-xs font-normal text-emerald-700 align-middle">· ✨ scaled to ${scaled.targetServings}</span>` : ''}${toggleBtn}</h4>
        <p class="text-sm text-stone-600">${escapeHtml(m.description || '')}</p></div>
      <div class="flex flex-wrap gap-1 macro text-xs justify-end shrink-0">
        <span class="pill bg-stone-100 text-stone-700">${macros.kcal||'?'} kcal</span>
        <span class="pill bg-rose-100 text-rose-800">${macros.protein||'?'}g P</span>
        <span class="pill bg-amber-100 text-amber-800">${macros.carbs||'?'}g C</span>
        <span class="pill bg-yellow-100 text-yellow-800">${macros.fat||'?'}g F</span>
      </div></div>
    <div class="text-sm mt-3">
      <span class="font-medium text-stone-700">Source:</span>
      <span data-recipe-display="${m.id}">${urlDisplay} <button data-recipe-edit="${m.id}" class="text-stone-500 hover:text-emerald-700 ml-1" title="Edit link">✎</button></span>
      <div data-recipe-editor="${m.id}" class="hidden mt-1 flex gap-2">
        <input data-recipe-input="${m.id}" type="url" placeholder="https://..." value="${escapeHtml(m.recipeUrl || '')}" class="flex-1 px-2 py-1 border border-stone-300 rounded text-xs">
        <button data-recipe-save="${m.id}" class="px-3 py-1 bg-emerald-700 text-white rounded text-xs hover:bg-emerald-800">Save</button>
        <button data-recipe-edit="${m.id}" class="px-3 py-1 bg-white border border-stone-300 text-stone-700 rounded text-xs hover:bg-stone-100">Cancel</button>
      </div></div>
    ${scaledHtml}
    ${originalHtml}
  </article>`;
}

/* ----- FAVORITES VIEW --------------------------------------- */
function renderFavorites(root) {
  const favs = state.favorites || [];
  root.innerHTML = `<div class="space-y-5">
    <header class="flex items-baseline justify-between gap-2">
      <div><h2 class="text-2xl font-semibold">★ Favorite meals</h2>
        <p class="text-stone-600 mt-1">${favs.length} saved. Toggle "Bias toward favorites" on Generate to use them.</p></div>
      ${favs.length ? `<button id="clear-favs" class="text-sm px-3 py-1.5 text-red-700 hover:bg-red-50 rounded">Clear all</button>` : ''}
    </header>
    ${favs.length === 0 ? `<div class="bg-white p-6 rounded-lg border border-stone-200 text-stone-600 text-sm">No favorites yet. Click the ★ on any meal card to save it.</div>` : ''}
    ${['breakfast','lunch','dinner','snack'].map(cat => {
      const items = favs.filter(f => f.category === cat); if (items.length === 0) return '';
      const labels = { breakfast:'☕ Breakfast', lunch:'🥙 Lunch', dinner:'🍽️ Dinner', snack:'🍎 Snacks' };
      return `<section><h3 class="text-lg font-semibold mb-3">${labels[cat]}</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">${items.map(m => mealCard(m, cat, false)).join('')}</div></section>`;
    }).join('')}
  </div>`;
  attachMealCardHandlers();
  const clr = document.getElementById('clear-favs');
  if (clr) clr.onclick = () => { if (!confirm('Remove all favorites?')) return; state.favorites = []; saveState(); render(); };
}

/* ----- PANTRY VIEW ------------------------------------------ */
function renderPantry(root) {
  const staples = state.pantryStaples || [];
  root.innerHTML = `<div class="space-y-5">
    <header><h2 class="text-2xl font-semibold">🧺 Pantry staples</h2>
      <p class="text-stone-600 mt-1">Items added to every shopping list when enabled. Defaults: Greek yogurt, coffee, dark chocolate almonds, sparkling water, milk.</p></header>
    <section class="bg-white p-5 rounded-lg border border-stone-200">
      <div id="staples-list" class="space-y-2 mb-3">${staples.map((x,i) => stapleRow(x,i)).join('')}</div>
      <div class="flex gap-2">
        <button id="add-staple" class="text-sm px-3 py-1.5 bg-white border border-emerald-300 text-emerald-700 rounded-md hover:bg-emerald-50">+ Add staple</button>
        <button id="reset-staples" class="text-sm px-3 py-1.5 text-stone-600 hover:bg-stone-100 rounded">Reset to defaults</button>
      </div>
    </section>
  </div>`;
  document.getElementById('add-staple').onclick = () => { state.pantryStaples.push({ item:'', amount:1, unit:'', aisle:'pantry', enabled:true }); saveState(); render(); };
  document.getElementById('reset-staples').onclick = () => { if (!confirm('Reset?')) return; state.pantryStaples = DEFAULT_PANTRY.map(x => ({ ...x })); saveState(); render(); };
  document.querySelectorAll('[data-staple-idx]').forEach(row => {
    const idx = Number(row.getAttribute('data-staple-idx'));
    row.querySelectorAll('[data-staple-field]').forEach(inp => {
      inp.onchange = () => {
        const field = inp.getAttribute('data-staple-field'); const list = state.pantryStaples; if (!list[idx]) return;
        if (field === 'enabled') list[idx][field] = inp.checked;
        else if (field === 'amount') list[idx][field] = Number(inp.value) || 0;
        else list[idx][field] = inp.value;
        saveState();
      };
    });
  });
  document.querySelectorAll('[data-staple-remove]').forEach(btn => {
    btn.onclick = () => { state.pantryStaples.splice(Number(btn.getAttribute('data-staple-remove')),1); saveState(); render(); };
  });
}
function stapleRow(x, idx) {
  return `<div class="flex flex-wrap items-center gap-2 text-sm" data-staple-idx="${idx}">
    <input type="checkbox" data-staple-field="enabled" ${x.enabled?'checked':''} class="w-4 h-4 accent-emerald-600">
    <input type="number" step="0.1" min="0" data-staple-field="amount" value="${escapeHtml(x.amount)}" class="w-20 px-2 py-1 border border-stone-300 rounded">
    <input type="text" data-staple-field="unit" value="${escapeHtml(x.unit)}" class="w-24 px-2 py-1 border border-stone-300 rounded" placeholder="unit">
    <input type="text" data-staple-field="item" value="${escapeHtml(x.item)}" class="flex-1 min-w-[180px] px-2 py-1 border border-stone-300 rounded" placeholder="item">
    <select data-staple-field="aisle" class="px-2 py-1 border border-stone-300 rounded">
      ${AISLES.map(a => `<option value="${a}" ${x.aisle===a?'selected':''}>${a}</option>`).join('')}
    </select>
    <button data-staple-remove="${idx}" class="px-2 py-1 text-red-600 hover:bg-red-50 rounded">✕</button>
  </div>`;
}

/* ----- BOOT ------------------------------------------------- */
if (!location.hash) location.hash = 'setup';
render();
