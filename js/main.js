// 注意：這裡新增了 LINE_TERMINALS 的引用
import { LINE_COLORS, LINE_TERMINALS } from './config.js';
import { debounce, initTheme } from './utils.js';
import { appData, buildMtrDb } from './data.js';
import { preloadAllRoutes } from './api.js';
import { StorageManager } from './storage.js';
import { BusRouteCard, MTRStationCard, MTRLineCard, LRTLineCard } from './cards.js';

/* --- UI Functions --- */

function toggleSidebar(show) {
    const sb = document.getElementById('sidebar'), ov = document.getElementById('overlay');
    if (show) { sb.classList.add('active'); ov.classList.add('active'); }
    else {
        if (appData.isEditMode) { 
            appData.isEditMode = false; 
            StorageManager.discard(); 
            document.getElementById('edit-btn').innerHTML = '✎'; 
            document.getElementById('edit-btn').classList.remove('active'); 
            StorageManager.renderList(); 
        }
        sb.classList.remove('active'); ov.classList.remove('active');
    }
}

function toggleEditMode() {
    appData.isEditMode = !appData.isEditMode;
    const btn = document.getElementById('edit-btn');
    if (appData.isEditMode) { StorageManager.initTemp(); btn.innerHTML = '💾'; btn.classList.add('active'); }
    else { StorageManager.commit(); btn.innerHTML = '✎'; btn.classList.remove('active'); }
    StorageManager.renderList();
}

function saveCurrentAsGroup() {
    const cards = document.querySelectorAll('.card');
    if (cards.length === 0) return alert('目前沒有任何卡片可儲存');
    let defName;
    const firstCard = window.cardRegistry[cards[0].id];
    if (firstCard instanceof MTRLineCard) {
        defName = `港鐵 ${firstCard.lineInfo.lineName}`;
    } else if (firstCard instanceof MTRStationCard) {
        defName = `港鐵 ${firstCard.stationInfo.staName}`;
    } else if (firstCard instanceof LRTLineCard) {
        defName = `輕鐵 ${firstCard.route} 綫`;
    } else {
        defName = `${firstCard.company} ${firstCard.route}` + (firstCard.currentDestName ? ` 往 ${firstCard.currentDestName}` : '');
    }
    if (cards.length > 1) defName = '我的通勤組合';
    const name = prompt('請輸入名稱：', defName);
    if (name) {
        const data = Array.from(cards).map(c => {
            const o = window.cardRegistry[c.id];
            if (!o) return null;
            if (o instanceof MTRStationCard) {
                return { type: 'MTR', lineCode: o.lineCode, staCode: o.staCode };
            } else if (o instanceof MTRLineCard) {
                return { type: 'MTR_LINE', lineCode: o.lineCode, dir: o.dir, markedSeq: o.markedSeq, filteredSeq: o.filteredSeq };
            } else if (o instanceof LRTLineCard) {
                return { type: 'LRT_LINE', route: o.route, dir: o.dir, markedSeq: o.markedSeq, filteredSeq: o.filteredSeq };
            } else {
                return { type: 'BUS', route: o.route, dir: o.dir, co: o.company, destName: o.currentDestName, filteredSeq: o.filteredSeq, markedSeq: o.markedSeq };
            }
        }).filter(x=>x);
        StorageManager.saveItem(name, data);
    }
}

function clearAllCards(showEmpty = true) {
    document.getElementById('cards-container').innerHTML = showEmpty ? '<div id="empty-state"><div class="big-icon">🚍</div><div>請輸入巴士路線、港鐵綫或車站開始查詢</div></div>' : '';
    window.cardRegistry = {};
    document.getElementById('add-card-section').style.display = 'none';
}

function loadSavedItem(id) {
    const item = StorageManager.getList().find(x => x.id === id);
    if (!item) return;
    clearAllCards(false);
    item.data.forEach(d => {
        if (d.type === 'MTR') createMtrCard(d.lineCode, d.staCode, d);
        else if (d.type === 'MTR_LINE') createMtrLineCard(d.lineCode, d, d.markedSeq);
        else if (d.type === 'LRT_LINE') createLrtLineCard(d.route, d, d.markedSeq);
        else createCard(d.route, d.co || 'KMB', d);
    });
    toggleSidebar(false);
}

function toggleMtrPopup(position) {
    event.stopPropagation();
    const popupId = `mtr-popup-${position}`;
    const btnId = `mtr-btn-${position}`;
    const popup = document.getElementById(popupId);
    const btn = document.getElementById(btnId);
    const isShowing = popup.classList.contains('show');
    document.querySelectorAll('.mtr-popup').forEach(el => el.classList.remove('show'));
    document.querySelectorAll('.mtr-trigger-btn').forEach(el => el.classList.remove('active'));
    if (!isShowing) {
        renderMtrGrid(position);
        popup.classList.add('show');
        btn.classList.add('active');
    }
}

function renderMtrGrid(position) {
    const gridId = `mtr-grid-${position}`;
    const grid = document.getElementById(gridId);
    if (grid.children.length > 0) return;
    grid.innerHTML = appData.allMtrLines.map(line => `
            <div class="mtr-line-item" onclick="onMtrLineSelect('${line.lineCode}', '${position}')">
                <div class="mtr-color-dot" style="background:${LINE_COLORS[line.lineCode] || '#999'}"></div>
                <div class="mtr-line-name">${line.lineName}</div>
            </div>
        `).join('');
}

function onMtrLineSelect(lineCode, source) {
    if (source === 'top') clearAllCards(false);
    createMtrLineCard(lineCode);
    document.querySelectorAll('.mtr-popup').forEach(el => el.classList.remove('show'));
    document.querySelectorAll('.mtr-trigger-btn').forEach(el => el.classList.remove('active'));
}

/* --- Search & Creation Functions --- */

function toggleAddSearch(show) {
    document.getElementById('show-add-btn').style.display = show ? 'none' : 'flex';
    const wrapper = document.getElementById('add-search-wrapper');
    wrapper.classList.toggle('active', show);
    if(show) document.getElementById('add-route-input').focus();
}

function handleInput(input, listId, clearId) {
    const val = input.value.trim();
    const upperVal = val.toUpperCase();
    document.getElementById(clearId).style.display = val.length ? 'flex' : 'none';
    const list = document.getElementById(listId);
    if (!val) {
        list.classList.remove('show');
        return;
    }
    const busMatches = appData.allRoutesDB.filter(r => r.route.startsWith(upperVal)).slice(0, 50);
    const mtrLineMatches = appData.allMtrLines.filter(l => l.lineName.includes(val) || l.lineCode.startsWith(upperVal));
    const mtrStationMatches = appData.allMtrStations.filter(s => s.staName.includes(val) || s.staCode.startsWith(upperVal)).slice(0, 20);
    const lrtLineMatches = appData.allLrtLines.filter(l => l.route.startsWith(upperVal));

    const getBadgeClass = co => ({'KMB':'badge-kmb', 'CTB':'badge-ctb', 'NLB':'badge-nlb', 'MTR': 'badge-mtr', 'LRT': 'badge-mtr'}[co]);
    const getBadgeText = co => ({'KMB':'九巴', 'CTB':'城巴', 'NLB':'嶼巴', 'MTR':'港鐵', 'LRT':'輕鐵'}[co]);

    const mtrLineHtml = mtrLineMatches.map(l => `
            <div class="suggestion-item" onmousedown="selectSuggestion({type: 'MTR_LINE', lineCode: '${l.lineCode}', inputId: '${input.id}', listId: '${listId}'})">
                 <div class="sug-left"><span class="co-badge ${getBadgeClass('MTR')}">${getBadgeText('MTR')}</span><span class="sug-route">${l.lineName}</span></div>
                <span class="sug-desc">顯示整條路綫</span>
            </div>`).join('');

    const lrtLineHtml = lrtLineMatches.map(l => `
            <div class="suggestion-item" onmousedown="selectSuggestion({type: 'LRT_LINE', route: '${l.route}', inputId: '${input.id}', listId: '${listId}'})">
                 <div class="sug-left"><span class="co-badge ${getBadgeClass('LRT')}">${getBadgeText('LRT')}</span><span class="sug-route">${l.route}</span></div>
                <span class="sug-desc">輕鐵路綫</span>
            </div>`).join('');

    const mtrStationHtml = mtrStationMatches.map(s => `
            <div class="suggestion-item" onmousedown="selectSuggestion({type: 'MTR_STATION', lineCode: '${s.lineCode}', staCode: '${s.staCode}', inputId: '${input.id}', listId: '${listId}'})">
                 <div class="sug-left"><span class="co-badge ${getBadgeClass('MTR')}">${getBadgeText('MTR')}</span><span class="sug-route">${s.staName}</span></div>
                <span class="sug-desc">跳轉至 ${s.lineName}</span>
            </div>`).join('');

    const busHtml = busMatches.map(r => `
            <div class="suggestion-item" onmousedown="selectSuggestion({type: 'BUS', route: '${r.route}', co: '${r.co}', inputId: '${input.id}', listId: '${listId}'})">
                <div class="sug-left"><span class="co-badge ${getBadgeClass(r.co)}">${getBadgeText(r.co)}</span><span class="sug-route">${r.route}</span></div>
                <span class="sug-desc">${r.orig} ⇄ ${r.dest}</span>
            </div>`).join('');

    list.innerHTML = mtrLineHtml + lrtLineHtml + mtrStationHtml + busHtml;
    list.classList.toggle('show', list.innerHTML.length > 0);
}

function clearSearch(id) {
    const el = document.getElementById(id); el.value = ''; el.focus();
    document.getElementById(id==='route-input'?'clear-search':'add-clear-search').style.display='none';
}

function selectSuggestion(params) {
    const { type, inputId, listId } = params;
    const inputEl = document.getElementById(inputId);
    document.getElementById(listId).classList.remove('show');
    const actionMap = {
        'BUS': () => createCard(params.route, params.co),
        'MTR_LINE': () => createMtrLineCard(params.lineCode),
        'MTR_STATION': () => createMtrLineCard(params.lineCode, null, params.staCode),
        'LRT_LINE': () => createLrtLineCard(params.route)
    };
    if (inputId === 'route-input') { clearAllCards(false); actionMap[type](); }
    else { actionMap[type](); toggleAddSearch(false); }
    inputEl.value = '';
}

function triggerShake(id) {
    const el = document.getElementById(id);
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 400);
    el.focus();
}

function performSearch(inputId) {
    const input = document.getElementById(inputId);
    const val = input.value.trim().toUpperCase();
    const listId = inputId === 'route-input' ? 'suggestions' : 'add-suggestions';

    if (!val) { triggerShake(inputId); return; }

    const line = appData.allMtrLines.find(l => l.lineName === val || l.lineCode === val);
    if (line) {
        if(inputId === 'route-input') clearAllCards(false);
        createMtrLineCard(line.lineCode);
        finishSearch(inputId, listId);
        return;
    }
    const lrt = appData.allLrtLines.find(l => l.route === val);
    if (lrt) {
        if(inputId === 'route-input') clearAllCards(false);
        createLrtLineCard(lrt.route);
        finishSearch(inputId, listId);
        return;
    }
    const station = appData.allMtrStations.find(s => s.staName === val || s.staCode === val);
    if (station) {
        if(inputId === 'route-input') clearAllCards(false);
        createMtrCard(station.lineCode, station.staCode);
        finishSearch(inputId, listId);
        return;
    }
    const bus = appData.allRoutesDB.find(r => r.route === val);
    if (bus) {
        if(inputId === 'route-input') clearAllCards(false);
        createCard(bus.route, bus.co);
        finishSearch(inputId, listId);
        return;
    }
    triggerShake(inputId);
}

function finishSearch(inputId, listId) {
    const el = document.getElementById(inputId);
    el.value = ''; el.blur();
    document.getElementById(listId).classList.remove('show');
    document.getElementById(inputId==='route-input'?'clear-search':'add-clear-search').style.display='none';
    if (inputId === 'add-route-input') toggleAddSearch(false);
}

function searchTopItem() { performSearch('route-input'); }
function addItem() { performSearch('add-route-input'); }

/* --- Card Creation Wrappers --- */
function createCard(route, company, saved = null) {
    const id = `card-${++appData.cardCounter}`;
    const card = new BusRouteCard(route, id, saved, company);
    window.cardRegistry[id] = card;
    card.init();
    document.getElementById('add-card-section').style.display = 'flex';
}

function createMtrCard(lineCode, staCode, saved = null) {
    const id = `card-${++appData.cardCounter}`;
    const card = new MTRStationCard(lineCode, staCode, id, saved);
    window.cardRegistry[id] = card;
    card.init();
    document.getElementById('add-card-section').style.display = 'flex';
}

function createMtrLineCard(lineCode, saved = null, initialPin = null) {
    const id = `card-${++appData.cardCounter}`;
    const card = new MTRLineCard(lineCode, id, saved, initialPin);
    window.cardRegistry[id] = card;
    card.init();
    document.getElementById('add-card-section').style.display = 'flex';
}

function createLrtLineCard(route, saved = null, initialPin = null) {
    const id = `card-${++appData.cardCounter}`;
    const card = new LRTLineCard(route, id, saved, initialPin);
    window.cardRegistry[id] = card;
    card.init();
    document.getElementById('add-card-section').style.display = 'flex';
}

/* --- Settings & Init --- */
function toggleDarkMode() { 
    const on = document.getElementById('dm-toggle').checked; 
    document.body.classList.toggle('dark-mode', on); 
    localStorage.setItem('darkMode', on ? 'enabled' : 'disabled'); 
}

function toggleMapSetting() { 
    appData.isMapEnabled = document.getElementById('map-toggle').checked; 
    localStorage.setItem('mapEnabled', appData.isMapEnabled ? 'enabled' : 'disabled'); 
    Object.values(window.cardRegistry).forEach(card => {
        if(card instanceof BusRouteCard) card.updateMap();
    });
}
function initMapSetting() { 
    const m = localStorage.getItem('mapEnabled'); 
    appData.isMapEnabled = (m === 'enabled');
    document.getElementById('map-toggle').checked = appData.isMapEnabled; 
}

/* --- Flash Setting Logic --- */
function toggleFlashSetting() {
    const on = document.getElementById('flash-toggle').checked;
    document.body.classList.toggle('disable-flash', !on);
    localStorage.setItem('flashEnabled', on ? 'enabled' : 'disabled');
}

function onSavedItemClick(id) { appData.isEditMode ? StorageManager.renameItem(id) : loadSavedItem(id); }
function deleteSaved(e, id) { e.stopPropagation(); if(confirm('確定要刪除嗎？')) StorageManager.deleteItem(id); }

/* --- Focus Mode Logic (已修復：確保 MTR/LRT 參數正確) --- */
function openFocusMode(cardId, uniqueId) {
    const card = window.cardRegistry[cardId];
    if (!card) return;

    let rowEl = null;
    const seqRow = document.querySelector(`#${cardId} .schedule-item[data-seq="${uniqueId}"]`);
    const staRow = document.querySelector(`#${cardId} .schedule-item[data-stacode="${uniqueId}"]`);
    rowEl = seqRow || staRow;

    if (!rowEl) return;

    const stationName = rowEl.querySelector('.dest-name').innerText;
    let params = '';

    if (card instanceof BusRouteCard) {
        params = `type=bus&co=${card.company}&route=${card.route}&dir=${card.dir}&stop=${card.stopMapData.find(s=>s.seq===uniqueId).stopId}&dest=${encodeURIComponent(card.currentDestName)}&name=${encodeURIComponent(stationName)}`;
    } else if (card instanceof MTRLineCard) {
        // 修復：加入 dir 和 dest，解決 Focus 頁面混雜方向問題
        const destName = LINE_TERMINALS[card.lineCode][card.dir];
        params = `type=mtr&line=${card.lineCode}&stop=${uniqueId}&dir=${card.dir}&dest=${encodeURIComponent(destName)}&name=${encodeURIComponent(stationName)}`;
    } else if (card instanceof LRTLineCard) {
        const isCircular = ['705', '706'].includes(card.route);
        const destName = isCircular ? card.lineInfo.dest.UP : card.lineInfo.dest[card.dir];
        params = `type=lrt&route=${card.route}&stop=${uniqueId}&dir=${card.dir}&dest=${encodeURIComponent(destName)}&name=${encodeURIComponent(stationName)}`;
    }

    location.href = `focus/?${params}`;
}

function closeFocusMode() {}

/* --- Loading State Logic --- */
function setLoadingState(isLoading) {
    const inputs = document.querySelectorAll('.search-input');
    const btns = document.querySelectorAll('.search-btn');
    
    inputs.forEach(input => {
        if (isLoading) {
            input.disabled = true;
            input.dataset.originalPlaceholder = input.placeholder;
            input.placeholder = "正在準備資料...";
            input.style.opacity = '0.7'; 
        } else {
            input.disabled = false;
            input.placeholder = input.dataset.originalPlaceholder || "輸入路線 / 車站";
            input.style.opacity = '1';
        }
    });
    
    btns.forEach(btn => {
        btn.disabled = isLoading;
        btn.style.opacity = isLoading ? '0.5' : '1';
        btn.style.pointerEvents = isLoading ? 'none' : 'auto'; 
    });
}

// Throttle Helper
function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

// Drag setup (Optimized: Throttled & Ghosting)
const setupDrag = (containerId, selector) => {
        const el = document.getElementById(containerId);
        if(!el) return;

        // Desktop
        const handleDragOver = throttle((e) => {
            e.preventDefault();
            const draggable = document.querySelector(`${selector}.dragging`);
            if (!draggable) return;
            const afterEl = getDragAfterElement(el, e.clientY, selector);
            if (afterEl == null) el.appendChild(draggable); else el.insertBefore(draggable, afterEl);
        }, 50);

        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            handleDragOver(e);
        });

        // Desktop Drag Start
        el.addEventListener('dragstart', (e) => {
            const item = e.target.closest(selector);
            if(!item) return;
        
            item.classList.add('dragging');
        
            // 增加 requestAnimationFrame 來確保渲染幀數正確
            requestAnimationFrame(() => {
                item.classList.add('hide-original');
            });
        });


        el.addEventListener('dragend', (e) => {
            const item = e.target.closest(selector);
            if(!item) return;
            
            item.classList.remove('dragging');
            item.classList.remove('hide-original');
            
            if (selector === '.saved-item' && appData.isEditMode) StorageManager.updateOrder();
        });

        // Mobile
        let touchEl = null;
        let dragTimer = null;

        const handleTouchMove = throttle((e) => {
            if (!touchEl) return;
            const touch = e.touches[0];
            const afterEl = getDragAfterElement(el, touch.clientY, selector);
            if (afterEl == null) el.appendChild(touchEl); else el.insertBefore(touchEl, afterEl);
        }, 50);

        el.addEventListener('touchstart', e => {
            const item = e.target.closest(selector);
            if (!item) return;
            let canDrag = false;
            if (selector === '.card') {
                const header = e.target.closest('.card-header');
                if (header && !e.target.closest('.close-card-btn, .dir-opt, .update-time')) canDrag = true;
            } else if (selector === '.saved-item') {
                if (appData.isEditMode && !e.target.closest('.delete-btn')) canDrag = true;
            }
            if (canDrag) {
                dragTimer = setTimeout(() => {
                    touchEl = item;
                    item.classList.add('dragging');
                    item.classList.add('mobile-dragging'); 
                    document.body.style.overflow = 'hidden'; 
                    if (navigator.vibrate) navigator.vibrate(50);
                }, 400); 
            }
        }, {passive: false});

        el.addEventListener('touchmove', e => {
            if (!touchEl) { clearTimeout(dragTimer); return; }
            e.preventDefault();
            handleTouchMove(e);
        }, {passive: false});

        el.addEventListener('touchend', e => {
            clearTimeout(dragTimer);
            if (!touchEl) return;
            touchEl.classList.remove('dragging');
            touchEl.classList.remove('mobile-dragging');
            touchEl = null;
            document.body.style.overflow = '';
            if (selector === '.saved-item' && appData.isEditMode) StorageManager.updateOrder();
        });
};

function getDragAfterElement(container, y, selector) {
    return [...container.querySelectorAll(`${selector}:not(.dragging)`)].reduce((closest, child) => {
        const offset = y - child.getBoundingClientRect().top - child.getBoundingClientRect().height / 2;
        return (offset < 0 && offset > closest.offset) ? { offset, element: child } : closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

const debouncedHandleInput = debounce((input, listId, clearId) => handleInput(input, listId, clearId), 150);

// --- Expose Globals ---
window.toggleSidebar = toggleSidebar;
window.toggleDarkMode = toggleDarkMode;
window.toggleMapSetting = toggleMapSetting;
window.toggleFlashSetting = toggleFlashSetting;
window.saveCurrentAsGroup = saveCurrentAsGroup;
window.toggleEditMode = toggleEditMode;
window.toggleMtrPopup = toggleMtrPopup;
window.handleInput = handleInput;
window.debouncedHandleInput = debouncedHandleInput;
window.searchTopItem = searchTopItem;
window.clearSearch = clearSearch;
window.toggleAddSearch = toggleAddSearch;
window.addItem = addItem;
window.onMtrLineSelect = onMtrLineSelect;
window.selectSuggestion = selectSuggestion;
window.onSavedItemClick = onSavedItemClick;
window.deleteSaved = deleteSaved;
window.openFocusMode = openFocusMode;
window.closeFocusMode = closeFocusMode;
window.manualRefresh = (id) => { if(window.cardRegistry[id]) window.cardRegistry[id].manualRefresh(); };

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    const isDark = initTheme();
    document.getElementById('dm-toggle').checked = isDark;
    
    initMapSetting();
    const flashEnabled = localStorage.getItem('flashEnabled');
    document.getElementById('flash-toggle').checked = (flashEnabled === 'enabled' || flashEnabled === null);

    buildMtrDb();
    StorageManager.loadAll();
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-wrapper')) {
            document.querySelectorAll('.suggestions-list').forEach(el => el.classList.remove('show'));
        }
        if (!e.target.closest('.mtr-popup') && !e.target.closest('.mtr-trigger-btn')) {
            document.querySelectorAll('.mtr-popup').forEach(el => el.classList.remove('show'));
            document.querySelectorAll('.mtr-trigger-btn').forEach(el => el.classList.remove('active'));
        }
    });
    setupDrag('cards-container', '.card');
    setupDrag('saved-list-container', '.saved-item');

    setLoadingState(true);
    try {
        await preloadAllRoutes();
    } catch (e) {
        console.error("Route preload failed:", e);
    } finally {
        setLoadingState(false);
    }
    
    if (StorageManager.getList().length > 0) loadSavedItem(StorageManager.getList()[0].id);
});
