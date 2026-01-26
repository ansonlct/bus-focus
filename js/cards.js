import { MTR_API, KMB_API, CTB_API, NLB_API, LRT_API, LINE_TERMINALS, LINE_COLORS } from './config.js';
import { appData } from './data.js';
import { cleanName, calculateETA, formatTime } from './utils.js';
import { getStopName } from './api.js';

function checkClearAll(id) {
    if(Object.keys(window.cardRegistry).length === 0) {
        document.getElementById('cards-container').innerHTML = '<div id="empty-state"><div class="big-icon">🚍</div><div>請輸入巴士路線、港鐵綫或車站開始查詢</div></div>';
        document.getElementById('add-card-section').style.display = 'none';
    }
}

function getCardHeaderHtml(id, titleHtml, extraHtml = '') {
    return `
            <div class="card-header" 
                 onmousedown="if(!event.target.closest('.close-card-btn, .dir-opt, .update-time, .leaflet-container')) this.closest('.card').setAttribute('draggable', 'true')" 
                 onmouseup="this.closest('.card').setAttribute('draggable', 'false')"
                 ontouchstart="if(!event.target.closest('.close-card-btn, .dir-opt, .update-time, .leaflet-container')) this.closest('.card').setAttribute('draggable', 'true')" 
                 ontouchend="this.closest('.card').setAttribute('draggable', 'false')">
                <div class="close-card-btn" onclick="window.cardRegistry['${id}'].destroy()" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()">✕</div>
                <div class="header-top">
                    <div style="display:flex;align-items:center;">${titleHtml}</div>
                    <div class="update-time" onclick="window.cardRegistry['${id}'].manualRefresh()" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()"></div>
                </div>
                ${extraHtml}
            </div>`;
}

function getRouteColor(type, key) {
    if (type === 'KMB') return '#E3001B';
    if (type === 'CTB') return '#D1B100'; 
    if (type === 'NLB') return '#007D8F';
    if (type === 'LRT') return '#D3A809';
    if (type === 'MTR') return LINE_COLORS[key] || '#999';
    return '#999';
}

/* --- Focus Mode Logic --- */
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
        const destName = LINE_TERMINALS[card.lineCode][card.dir];
        params = `type=mtr&line=${card.lineCode}&stop=${uniqueId}&dir=${card.dir}&dest=${encodeURIComponent(destName)}&name=${encodeURIComponent(stationName)}`;
    } else if (card instanceof LRTLineCard) {
        const isCircular = ['705', '706'].includes(card.route);
        const destName = isCircular ? card.lineInfo.dest.UP : card.lineInfo.dest[card.dir];
        params = `type=lrt&route=${card.route}&stop=${uniqueId}&dir=${card.dir}&dest=${encodeURIComponent(destName)}&name=${encodeURIComponent(stationName)}`;
    }

    location.href = `focus/?${params}`;
}

window.openFocusMode = openFocusMode;

export class BaseCard {
    constructor() {
        this.isDestroyed = false;
        this.timer = null;
        this.isFetching = false;
    }

    destroy() {
        this.isDestroyed = true;
        if (this.map) { this.map.remove(); this.map = null; }
        if (this.timer) clearTimeout(this.timer);
        this.element.style.cssText = 'opacity:0; transform:scale(0.9); margin-bottom:0; max-height:0;';
        setTimeout(() => {
            this.element.remove();
            delete window.cardRegistry[this.id];
            checkClearAll(this.id);
        }, 300);
    }

    scheduleNextFetch() {
        if (this.isDestroyed) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.fetchData(), 30000);
    }

    manualRefresh() {
        if (this.isFetching) return;
        if (this.timer) clearTimeout(this.timer);
        this.fetchData();
    }

    toggleMode(el) {
        const item = el.closest('.schedule-item');
        if (!item) return;
        
        item.classList.toggle('mode-time');
        const showTime = item.classList.contains('mode-time');
        
        item.querySelectorAll('.min-tag').forEach(span => {
            span.innerHTML = ''; 
            if (showTime) {
                span.innerText = span.dataset.time; 
                span.classList.add('show-real-time');
            } else {
                // === 修正部分 ===
                let min = span.dataset.min.replace('分', ''); // 先移除可能存在的「分」

                // 只有「即將」不加單位，其他數字（包括 1）都加 <small>分</small>
                if (min === '即將') {
                    span.innerText = min; 
                } else {
                    span.innerHTML = `${min}<small>分</small>`;
                }
                // === 修正結束 ===
                
                span.classList.remove('show-real-time');
            }
        });
    }

    pin(e, id) {
        e.stopPropagation(); 
        if (this.filteredSeq === id) { 
            this.filteredSeq = null; this.markedSeq = null; 
        } else if (this.markedSeq === id) { 
            this.filteredSeq = id; 
        } else { 
            this.markedSeq = id; this.filteredSeq = null; 
        }
        this.applyVisual();
        if (this instanceof BusRouteCard) this.updateMap();
    }
}

export class MTRStationCard extends BaseCard {
    constructor(lineCode, staCode, id, saved) {
        super();
        this.id = id; this.lineCode = lineCode; this.staCode = staCode;
        this.stationInfo = appData.allMtrStations.find(s => s.lineCode === lineCode && s.staCode === staCode);
        this.element = null;
    }
    init() {
        document.getElementById('empty-state')?.remove();
        const div = document.createElement('div');
        div.setAttribute('draggable', 'false');
        div.className = 'card mtr-card timeline-card'; 
        div.id = this.id;
        const color = getRouteColor('MTR', this.lineCode);
        div.style.setProperty('--route-color', color);
        div.innerHTML = `
                ${getCardHeaderHtml(this.id, `<span class="icon">🚇</span><span class="card-title">${this.stationInfo.staName} <small>(${this.stationInfo.lineName})</small></span>`)}
                <div class="card-content"><div class="status-msg">正在獲取列車資料...</div></div>`;
        document.getElementById('cards-container').appendChild(div);
        this.element = div;
        setTimeout(() => div.scrollIntoView({behavior:'smooth', block:'start'}), 100);
        div.addEventListener('dragstart', () => { div.classList.add('dragging'); setTimeout(() => div.classList.add('hide-original'), 0); });
        div.addEventListener('dragend', () => { div.classList.remove('dragging', 'hide-original'); });
        this.fetchData();
    }
    renderError(message) { this.element.querySelector('.card-content').innerHTML = `<div class="status-msg error">${message}</div>`; }
    async fetchData() {
        if (this.isDestroyed) return;
        this.isFetching = true;
        this.element.querySelector('.update-time').innerText = '更新中...';
        try {
            const response = await fetch(`${MTR_API}?line=${this.lineCode}&sta=${this.staCode}&lang=TC`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (this.isDestroyed) return;
            if (data.status === 0) { this.renderError(data.message || '服務現正暫停'); }
            else {
                this.render(data.data[`${this.lineCode}-${this.staCode}`]);
                this.element.querySelector('.update-time').innerText = '更新於 ' + formatTime(new Date());
            }
        } catch (e) { if (!this.isDestroyed) this.renderError('資料載入失敗'); console.error(e); } finally { this.isFetching = false; this.scheduleNextFetch(); }
    }
    _formatTrains(trains) {
        if (!trains || trains.length === 0) return '';
        return trains.map(train => {
            const etaInfo = calculateETA(new Date(train.time));
            if (!etaInfo) return null; 
            const destName = appData.mtrStationNames[train.dest] || train.dest;
            const platCircled = ['⓪','①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩'][parseInt(train.plat)] || `(${train.plat})`;
            const minStr = etaInfo.minStr.replace('分','');
            return `<span class="min-tag ${etaInfo.isUrgent?'urgent':''}" data-min="${minStr}" data-time="${etaInfo.timeStr}">${minStr}<small>分</small></span> 
                    <span class="dest-tag">${destName} ${platCircled}</span>`;
        }).filter(x => x).join('<span class="sep">,</span> ');
    }
    render(data) {
        const contentEl = this.element.querySelector('.card-content');
        if (!data || (!data.UP && !data.DOWN)) { this.renderError('暫無班次資料'); return; }
        let html = '';
        if (data.UP && data.UP.length) html += `<div class="schedule-item" onclick="window.cardRegistry['${this.id}'].toggleMode(this)"><div class="stop-info"><span class="dest-name">往 ${LINE_TERMINALS[this.lineCode].UP}</span></div><div class="eta-container">${this._formatTrains(data.UP)}</div></div>`;
        if (data.DOWN && data.DOWN.length) html += `<div class="schedule-item" onclick="window.cardRegistry['${this.id}'].toggleMode(this)"><div class="stop-info"><span class="dest-name">往 ${LINE_TERMINALS[this.lineCode].DOWN}</span></div><div class="eta-container">${this._formatTrains(data.DOWN)}</div></div>`;
        contentEl.innerHTML = html || '<div class="status-msg">暫無班次</div>';
    }
}

export class MTRLineCard extends BaseCard {
    constructor(lineCode, id, saved, initialPin = null) {
        super();
        this.id = id; this.lineCode = lineCode;
        this.lineInfo = appData.allMtrLines.find(l => l.lineCode === lineCode);
        const s = saved || {};
        this.dir = s.dir || 'UP';
        this.markedSeq = s.markedSeq || initialPin || null;
        this.filteredSeq = s.filteredSeq || (initialPin ? initialPin : null);
        this.element = null;
    }
    init() {
        document.getElementById('empty-state')?.remove();
        const div = document.createElement('div');
        div.setAttribute('draggable', 'false');
        div.className = 'card mtr-card timeline-card'; 
        div.id = this.id;
        const color = getRouteColor('MTR', this.lineCode);
        div.style.setProperty('--route-color', color);
        const terminals = LINE_TERMINALS[this.lineCode];
        const extraHtml = `<div class="direction-switch" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()"><span class="dir-opt btn-up" onclick="window.cardRegistry['${this.id}'].switchDir('UP')">往 ${terminals.UP}</span><span class="dir-opt btn-down" onclick="window.cardRegistry['${this.id}'].switchDir('DOWN')">往 ${terminals.DOWN}</span></div>`;
        div.innerHTML = `
                ${getCardHeaderHtml(this.id, `<span class="icon">🚇</span><span class="card-title">${this.lineInfo.lineName}</span>`, extraHtml)}
                <div class="card-content"><div class="status-msg">正在獲取整條綫列車資料...</div></div>`;
        document.getElementById('cards-container').appendChild(div);
        this.element = div;
        div.addEventListener('dragstart', () => { div.classList.add('dragging'); setTimeout(() => div.classList.add('hide-original'), 0); });
        div.addEventListener('dragend', () => { div.classList.remove('dragging', 'hide-original'); });
        this.updateUI(); 
        this.fetchData(); 
        setTimeout(() => div.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
    switchDir(dir) { if (this.dir === dir) return; this.dir = dir; this.filteredSeq = null; this.markedSeq = null; this.updateUI(); this.manualRefresh(); }
    updateUI() { this.element.querySelector('.btn-up').classList.toggle('active', this.dir === 'UP'); this.element.querySelector('.btn-down').classList.toggle('active', this.dir === 'DOWN'); }
    renderError(message) { this.element.querySelector('.card-content').innerHTML = `<div class="status-msg error">${message}</div>`; }
    applyVisual() {
        this.element.querySelectorAll('.schedule-item').forEach(el => {
            const staCode = el.dataset.stacode; 
            el.classList.toggle('hidden-row', this.filteredSeq !== null && this.filteredSeq !== staCode);
            el.classList.toggle('marked', this.markedSeq === staCode);
        });
        if (this.filteredSeq) { const targetEl = this.element.querySelector(`.schedule-item[data-stacode="${this.filteredSeq}"]`); if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    }
    async fetchData() {
        if (this.isDestroyed) return;
        this.isFetching = true;
        this.element.querySelector('.update-time').innerText = '更新中...';
        const stationList = this.lineInfo.orderedStations;
        try {
            const responses = await Promise.all(stationList.map(s => 
                fetch(`${MTR_API}?line=${this.lineCode}&sta=${s.c}&lang=TC`).then(res => res.json())
            ));
            
            if (this.isDestroyed) return;
            
            const allData = responses.map((data, i) => ({ 
                staCode: stationList[i].c, 
                schedule: data.data ? data.data[`${this.lineCode}-${stationList[i].c}`] : null, 
            }));
            
            this.render(allData);
            this.element.querySelector('.update-time').innerText = '更新於 ' + formatTime(new Date());
        } catch (e) { 
            if(!this.isDestroyed) this.renderError('全綫資料載入失敗'); 
            console.error(e); 
        } finally { 
            this.isFetching = false; 
            this.scheduleNextFetch(); 
        }
    }
    render(data) {
        const activeStaCodes = new Set();
        this.element.querySelectorAll('.schedule-item.mode-time').forEach(el => activeStaCodes.add(el.dataset.stacode));
        const contentEl = this.element.querySelector('.card-content');
        let finalHtml = '';
        
        let displayData = [...data];
        if (this.dir === 'DOWN') displayData.reverse();
        
        let serial = 1;
        for (const stationData of displayData) {
            const { staCode, schedule } = stationData;
            let trainHtml = '';
            if (schedule) {
                const trains = schedule[this.dir] || [];
                const items = trains.map(train => {
                    if (this.lineCode === 'EAL' && this.dir === 'UP' && !['LOW', 'LMC', 'SHT', 'TAP', 'FAN', 'SHS'].includes(train.dest)) return null;
                    if (this.lineCode === 'TKL' && this.dir === 'UP' && !['POA', 'LHP'].includes(train.dest)) return null;
                    const etaInfo = calculateETA(new Date(train.time));
                    if (!etaInfo) return null; 
                    const minStr = etaInfo.minStr.replace('分','');
                    return `<span class="min-tag ${etaInfo.isUrgent?'urgent':''}" data-min="${etaInfo.minStr}" data-time="${etaInfo.timeStr}">${minStr}${minStr==='即將'?'':'<small>分</small>'}</span>`;
                }).filter(x => x);
                if (items.length > 0) trainHtml = items.join('<span class="sep">,</span> ');
            }
            if (!trainHtml) trainHtml = '<span class="no-time">-</span>';
            
            finalHtml += `
                <div class="schedule-item" data-stacode="${staCode}">
                    <div class="pin-trigger" onclick="window.cardRegistry['${this.id}'].pin(event, '${staCode}')"></div>
                    <div class="stop-info">
                        <span class="dest-seq">${serial}</span>
                        <span class="dest-name" onclick="openFocusMode('${this.id}', '${staCode}')">${appData.mtrStationNames[staCode]}</span>
                    </div>
                    <div class="eta-container" onclick="window.cardRegistry['${this.id}'].toggleMode(this)">${trainHtml}</div>
                </div>`;
            serial++;
        }
        contentEl.innerHTML = finalHtml;
        this.applyVisual();
        activeStaCodes.forEach(code => {
            const row = this.element.querySelector(`.schedule-item[data-stacode="${code}"]`);
            if(row) this.toggleMode(row.querySelector('.eta-container'));
        });
    }
}

export class LRTLineCard extends BaseCard {
    constructor(route, id, saved, initialPin = null) {
        super();
        this.id = id; this.route = route;
        this.lineInfo = appData.allLrtLines.find(l => l.route === route);
        const s = saved || {};
        this.dir = s.dir || 'UP';
        this.markedSeq = s.markedSeq || initialPin || null;
        this.filteredSeq = s.filteredSeq || (initialPin ? initialPin : null);
        this.element = null;
    }
    init() {
        document.getElementById('empty-state')?.remove();
        const div = document.createElement('div');
        div.setAttribute('draggable', 'false');
        div.className = 'card mtr-card timeline-card'; 
        div.id = this.id;
        const color = getRouteColor('LRT');
        div.style.setProperty('--route-color', color);
        const dest = this.lineInfo.dest;
        const isCircular = ['705', '706'].includes(this.route);
        let extraHtml = isCircular ? 
            `<div class="direction-switch" style="background:rgba(0,0,0,0.1); cursor:default; justify-content:center; padding:6px;"><span style="color:white; font-weight:700; font-size:0.9rem;">↺ ${dest.UP}</span></div>` :
            `<div class="direction-switch" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()"><span class="dir-opt btn-up" onclick="window.cardRegistry['${this.id}'].switchDir('UP')">往 ${dest.UP}</span><span class="dir-opt btn-down" onclick="window.cardRegistry['${this.id}'].switchDir('DOWN')">往 ${dest.DOWN}</span></div>`;
        div.innerHTML = `
                ${getCardHeaderHtml(this.id, `<span class="icon">🚇</span><span class="card-title">輕鐵 ${this.route}</span>`, extraHtml)}
                <div class="card-content"><div class="status-msg">正在獲取輕鐵實時資料...</div></div>`;
        document.getElementById('cards-container').appendChild(div);
        this.element = div;
        div.addEventListener('dragstart', () => { div.classList.add('dragging'); setTimeout(() => div.classList.add('hide-original'), 0); });
        div.addEventListener('dragend', () => { div.classList.remove('dragging', 'hide-original'); });
        if(!isCircular) this.updateUI(); 
        this.fetchData(); 
        setTimeout(() => div.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
    switchDir(dir) { if (this.dir === dir) return; this.dir = dir; this.filteredSeq = null; this.markedSeq = null; this.updateUI(); this.manualRefresh(); }
    updateUI() { this.element.querySelector('.btn-up').classList.toggle('active', this.dir === 'UP'); this.element.querySelector('.btn-down').classList.toggle('active', this.dir === 'DOWN'); }
    renderError(message) { this.element.querySelector('.card-content').innerHTML = `<div class="status-msg error">${message}</div>`; }
    applyVisual() {
        this.element.querySelectorAll('.schedule-item').forEach(el => {
            const staCode = el.dataset.stacode; 
            el.classList.toggle('hidden-row', this.filteredSeq !== null && this.filteredSeq !== staCode);
            el.classList.toggle('marked', this.markedSeq === staCode);
        });
        if (this.filteredSeq) { const targetEl = this.element.querySelector(`.schedule-item[data-stacode="${this.filteredSeq}"]`); if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    }
    async fetchData() {
        if (this.isDestroyed) return;
        this.isFetching = true;
        this.element.querySelector('.update-time').innerText = '更新中...';
        const stationList = this.lineInfo.stations; 
        try {
            const responses = await Promise.all(stationList.map(id => fetch(`${LRT_API}?station_id=${id}`).then(res => res.json())));
            if (this.isDestroyed) return;
            const allData = responses.map((data, i) => ({ staCode: stationList[i], platformInfo: data.status === 1 ? data.platform_list : [] }));
            this.render(allData);
            this.element.querySelector('.update-time').innerText = '更新於 ' + formatTime(new Date());
        } catch (e) { if(!this.isDestroyed) this.renderError('輕鐵資料載入失敗'); console.error(e); } finally { this.isFetching = false; this.scheduleNextFetch(); }
    }
    render(data) {
        const activeStaCodes = new Set();
        this.element.querySelectorAll('.schedule-item.mode-time').forEach(el => activeStaCodes.add(el.dataset.stacode));
        const contentEl = this.element.querySelector('.card-content');
        let displayData = [...data];
        if (this.dir === 'UP' && !['705', '706'].includes(this.route)) displayData.reverse();
        const targetDest = this.lineInfo.dest[this.dir];
        const isCircular = ['705', '706'].includes(this.route);

        let serial = 1;
        let finalHtml = displayData.map(stationData => {
            const { staCode, platformInfo } = stationData;
            let relevantTrains = [];
            if (platformInfo && platformInfo.length > 0) {
                platformInfo.forEach(plat => {
                    if (plat.route_list) {
                        plat.route_list.forEach(r => {
                            if (r.route_no === this.route) {
                                if (!isCircular && r.dest_ch !== targetDest) return;
                                relevantTrains.push({ time: r.time_en, plat: plat.platform_id, dest: r.dest_ch });
                            }
                        });
                    }
                });
            }
            relevantTrains.sort((a, b) => {
                const getMins = (t) => { const text = t.toLowerCase(); if (text.includes('arriving') || text.includes('departing')) return 0; return parseInt(t) || 999; };
                return getMins(a.time) - getMins(b.time);
            });

            let trainHtml = '';
            if (relevantTrains.length > 0) {
                 const items = relevantTrains.map(train => {
                     let minStr = train.time.replace(/s? ?min(s?)/gi, '').replace('Arriving', '即將').replace('Departing', '即將');
                     if(minStr === '-') return null;
                     const isUrgent = minStr === '即將' || minStr === '1';
                     let minutesInt = parseInt(train.time); if(isNaN(minutesInt)) minutesInt = 0;
                     const timeStr = formatTime(new Date(Date.now() + minutesInt * 60000));
                     
                     return `<span class="min-tag ${isUrgent?'urgent':''}" data-min="${minStr}" data-time="${timeStr}">${minStr}${minStr==='即將'?'':'<small>分</small>'}</span>`;
                 }).filter(x=>x);
                 if (items.length > 0) trainHtml = items.join('<span class="sep">,</span> ');
            }
            if (!trainHtml) trainHtml = '<span class="no-time">-</span>';
            
            const stationName = appData.lrtStationNames[staCode] || staCode;
            const html = `
                <div class="schedule-item" data-stacode="${staCode}">
                    <div class="pin-trigger" onclick="window.cardRegistry['${this.id}'].pin(event, '${staCode}')"></div>
                    <div class="stop-info">
                        <span class="dest-seq">${serial}</span>
                        <span class="dest-name" onclick="openFocusMode('${this.id}', '${staCode}')">${stationName}</span>
                    </div>
                    <div class="eta-container" onclick="window.cardRegistry['${this.id}'].toggleMode(this)">${trainHtml}</div>
                </div>`;
            serial++;
            return html;
        }).join('');
        contentEl.innerHTML = finalHtml;
        this.applyVisual();
        activeStaCodes.forEach(code => {
            const row = this.element.querySelector(`.schedule-item[data-stacode="${code}"]`);
            if(row) this.toggleMode(row.querySelector('.eta-container'));
        });
    }
}

export class BusRouteCard extends BaseCard {
    constructor(route, id, saved, company) {
        super();
        this.id = id; this.route = route; this.company = (saved ? saved.co : company) || company;
        const s = saved || {};
        this.dir = s.dir || 'outbound';
        this.markedSeq = s.markedSeq || null;
        this.filteredSeq = s.filteredSeq || null;
        this.currentDestName = s.destName || '';
        this.element = null; this.timer = null; this.currentStops = [];
        this.nlbIds = {}; this.lastRenderedDir = null;
        this.map = null; this.mapGroup = null; this.stopMapData = [];
    }
    init() {
        document.getElementById('empty-state')?.remove();
        let cardClass = '', coName = '九巴';
        if (this.company === 'CTB') { cardClass = 'ctb-card'; coName = '城巴'; }
        else if (this.company === 'NLB') { cardClass = 'nlb-card'; coName = '嶼巴'; }
        const div = document.createElement('div');
        div.setAttribute('draggable', 'false');
        div.className = `card ${cardClass} timeline-card`; 
        div.id = this.id;
        const color = getRouteColor(this.company, this.route);
        div.style.setProperty('--route-color', color);
        const extraHtml = `<div class="direction-switch" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()"><span class="dir-opt btn-out" onclick="window.cardRegistry['${this.id}'].switchDir('outbound')">往 ...</span><span class="dir-opt btn-in" onclick="window.cardRegistry['${this.id}'].switchDir('inbound')">往 ...</span></div>`;
        div.innerHTML = `
                ${getCardHeaderHtml(this.id, `<span class="icon">🚌</span><span class="card-title">${coName} ${this.route}</span>`, extraHtml)}
                <div class="card-content">
                    <div id="map-container-${this.id}" class="route-map-container" onmousedown="event.stopPropagation()" ontouchstart="event.stopPropagation()"></div>
                    <div id="list-${this.id}"><div class="status-msg">正在分析路線資料...</div></div>
                </div>`;
        document.getElementById('cards-container').appendChild(div);
        this.element = div;
        setTimeout(() => div.scrollIntoView({behavior:'smooth', block:'start'}), 100);
        div.addEventListener('dragstart', () => { div.classList.add('dragging'); setTimeout(() => div.classList.add('hide-original'), 0); });
        div.addEventListener('dragend', () => { div.classList.remove('dragging', 'hide-original'); });
        this.updateUI();
        this.fetchBoundaries().then(() => { this.fetchData(); }); 
    }
    async fetchBoundaries() {
        let outStops = [], inStops = [], outName = '', inName = '';
        if (this.company === 'NLB') {
            const variants = appData.nlbRouteMap[this.route] || [];
            const processNLB = async (variant, dirKey) => {
                if (!variant) return [];
                this.nlbIds[dirKey] = variant.routeId;
                try {
                    const data = await fetch(`${NLB_API}/stop.php?action=list&routeId=${variant.routeId}`).then(r=>r.json());
                    const stops = data.stops || [];
                    stops.forEach(s => {
                        appData.stopCache[`NLB_${s.stopId}`] = { name: s.stopName_c, lat: s.latitude, long: s.longitude };
                    });
                    return stops.map((s, i) => ({ stop: s.stopId, seq: i+1, name: cleanName(s.stopName_c) }));
                } catch { return []; }
            };
            [outStops, inStops] = await Promise.all([processNLB(variants[0], 'outbound'), processNLB(variants[1], 'inbound')]);
            outName = variants[0] ? variants[0].routeName_c.split('>')[1]?.trim() || variants[0].routeName_c : '';
            inName = variants[1] ? variants[1].routeName_c.split('>')[1]?.trim() || variants[1].routeName_c : '';
        } else {
            const api = this.company === 'KMB' ? KMB_API : CTB_API;
            const getStops = async (d) => { try { return (await (await fetch(`${api}/route-stop/${this.company==='KMB'?'': 'CTB/'}${this.route}/${d}${this.company==='KMB'?'/1':''}`)).json()).data; } catch{ return []; } };
            [outStops, inStops] = await Promise.all([getStops('outbound'), getStops('inbound')]);
            const getName = async (list) => {
                if (!list.length) return '';
                const lastStop = list[list.length-1];
                const info = await getStopName(lastStop.stop, this.company);
                return info ? info.name : '';
            };
            [outName, inName] = await Promise.all([getName(outStops), getName(inStops)]);
        }
        outName = cleanName(outName);
        inName = cleanName(inName);
        this.element.querySelector('.btn-out').innerText = outStops.length ? `往 ${outName || '去程'}` : '去程 (無資料)';
        this.element.querySelector('.btn-in').innerText = inStops.length ? `往 ${inName || '回程'}` : '回程 (無資料)';
        this.element.querySelector('.btn-in').style.display = inStops.length ? 'block' : 'none';
        if(!inStops.length && outStops.length) this.element.querySelector('.btn-out').innerText += ' (循環線)';
        this.destMap = { outbound: outName || '去程', inbound: inName || '回程' };
        this.currentDestName = this.destMap[this.dir];
        this.stopLists = { outbound: outStops, inbound: inStops };
    }
    switchDir(dir) { if(this.dir === dir) return; this.dir = dir; this.markedSeq = null; this.filteredSeq = null; this.currentDestName = this.destMap[dir]; this.updateUI(); if(this.mapGroup) this.mapGroup.clearLayers(); this.manualRefresh(); }
    updateUI() { this.element.querySelector('.btn-out').classList.toggle('active', this.dir === 'outbound'); this.element.querySelector('.btn-in').classList.toggle('active', this.dir === 'inbound'); }
    
    initMap() {
        const containerId = `map-container-${this.id}`;
        if (!this.map) {
            this.map = L.map(containerId, { attributionControl: false, zoomControl: false, dragging: true, touchZoom: true, scrollWheelZoom: false });
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { opacity: 0.7 }).addTo(this.map);
            this.mapGroup = L.layerGroup().addTo(this.map);
        }
        setTimeout(() => this.map.invalidateSize(), 200);
    }

    updateMap() {
        const container = document.getElementById(`map-container-${this.id}`);
        if (!appData.isMapEnabled || this.filteredSeq) { container.classList.remove('show'); return; }
        container.classList.add('show');
        this.initMap();
        this.mapGroup.clearLayers();
        if (!this.stopMapData || this.stopMapData.length === 0) return;
        const points = [];
        let targetLatLong = null;
        this.stopMapData.forEach(s => {
            if (s.lat && s.long) {
                const latLng = [parseFloat(s.lat), parseFloat(s.long)];
                points.push(latLng);
                if (this.markedSeq === s.seq) targetLatLong = latLng;
                L.circleMarker(latLng, {
                    radius: this.markedSeq === s.seq ? 8 : 5,
                    color: 'white', weight: 1,
                    fillColor: this.company === 'KMB' ? '#E3001B' : (this.company === 'NLB' ? '#007D8F' : '#F9D300'),
                    fillOpacity: 1
                }).bindPopup(`${s.seq}. ${s.name}`).addTo(this.mapGroup);
            }
        });
        if (points.length > 0) {
            let lineColor = this.company === 'KMB' ? '#E3001B' : (this.company === 'CTB' ? '#F9D300' : '#007AFF'); 
            L.polyline(points, { color: lineColor, weight: 3, opacity: 0.8 }).addTo(this.mapGroup);
            if (targetLatLong) { this.map.setView(targetLatLong, 16, { animate: true }); } 
            else { this.map.fitBounds(L.latLngBounds(points), { padding: [20, 20] }); }
        }
    }
    
    async fetchData() {
        if (this.isDestroyed) return;
        this.isFetching = true;
        const listEl = document.getElementById(`list-${this.id}`);
        this.element.querySelector('.update-time').innerText = '更新中...';
        if(listEl.innerText.includes('暫無')) listEl.classList.add('fading');
        
        try {
            this.currentStops = this.stopLists?.[this.dir];
            if (!this.currentStops?.length) await this.fetchBoundaries();
            this.currentStops = this.stopLists?.[this.dir];
            
            if (this.isDestroyed) return;
            if (!this.currentStops?.length) { 
                listEl.innerHTML = '<div class="status-msg">此方向無車站資料</div>'; 
                listEl.classList.remove('fading');
                return; 
            }
            
            const needsRender = this.dir !== this.lastRenderedDir || !this.element.querySelector('.schedule-item');
            let rows = [];
            this.stopMapData = []; 

            const processStopInfo = async (s) => {
                let info = { name: s.name, lat: null, long: null };
                if (this.company === 'NLB') {
                    const cached = appData.stopCache[`NLB_${s.stop}`];
                    if (cached) info = cached;
                } else {
                    const cached = await getStopName(s.stop, this.company);
                    if (cached) info = cached;
                }
                this.stopMapData.push({ seq: parseInt(s.seq), stopId: s.stop, name: cleanName(info.name), lat: info.lat, long: info.long });
                return { seq: parseInt(s.seq), stopId: s.stop, name: cleanName(info.name) };
            };

            if (this.company === 'NLB') {
                if (needsRender) { 
                    await Promise.all(this.currentStops.map(s => processStopInfo(s)));
                    this.stopMapData.sort((a,b) => a.seq - b.seq);
                    this.render(this.stopMapData.map(s => ({seq: s.seq, stopId: s.stopId, name: s.name, etas: []}))); 
                    this.lastRenderedDir = this.dir; 
                }
                const routeId = this.nlbIds[this.dir];
                this.currentStops.forEach(s => { 
                    fetch(`${NLB_API}/stop.php?action=estimatedArrivals&routeId=${routeId}&stopId=${s.stop}&language=zh`)
                    .then(r => r.json())
                    .then(data => this.updateRow(s.seq, (data.estimatedArrivals || []).map(e => ({ eta: e.estimatedArrivalTime })).sort((a,b)=>new Date(a.eta)-new Date(b.eta))))
                    .catch(() => this.updateRow(s.seq, null)); 
                });
            } else {
                if (this.company === 'KMB') {
                    const allEtas = (await (await fetch(`${KMB_API}/route-eta/${this.route}/1`)).json()).data || [];
                    const dirCode = this.dir === 'outbound' ? 'O' : 'I';
                    rows = await Promise.all(this.currentStops.map(async s => {
                        const info = await processStopInfo(s);
                        return { ...info, etas: allEtas.filter(e => e.seq === parseInt(s.seq) && e.dir === dirCode && e.eta).sort((a,b)=>new Date(a.eta)-new Date(b.eta)) };
                    }));
                } else {
                    rows = await Promise.all(this.currentStops.map(async s => { 
                        const info = await processStopInfo(s);
                        const data = (await (await fetch(`${CTB_API}/eta/CTB/${s.stop}/${this.route}`)).json()).data || []; 
                        return { ...info, etas: data.filter(e => e.dir === (this.dir === 'outbound' ? 'O' : 'I') && e.eta).sort((a,b)=>new Date(a.eta)-new Date(b.eta)) }; 
                    }));
                }
                this.stopMapData.sort((a,b) => a.seq - b.seq);
                this.render(rows); 
                this.lastRenderedDir = this.dir;
            }
            this.updateMap();
            this.element.querySelector('.update-time').innerText = '更新於 ' + formatTime(new Date());
        } catch (e) { 
            if(!this.isDestroyed) { listEl.innerHTML = '<div class="status-msg error">資料載入失敗</div>'; console.error(e); }
        } finally {
            listEl.classList.remove('fading');
            this.isFetching = false;
            this.scheduleNextFetch();
        }
    }
    
    generateTimeHtml(etas) {
        if (!etas || !etas.length) return '<span class="no-time">-</span>';
        const items = etas.map(e => calculateETA(new Date(e.eta))).filter(x => x).slice(0, 3);
        if (items.length === 0) return '<span class="no-time">-</span>';
        return items.map(info => {
            const minStr = info.minStr.replace('分','');
            return `<span class="min-tag ${info.isUrgent?'urgent':''}" data-min="${info.minStr}" data-time="${info.timeStr}">${minStr}${minStr==='即將'?'':'<small>分</small>'}</span>`;
        }).join('<span class="sep">,</span> ');
    }
    render(rows) {
        const activeSeqs = new Set();
        this.element.querySelectorAll('.schedule-item.mode-time').forEach(el => activeSeqs.add(parseInt(el.dataset.seq)));
        const el = document.getElementById(`list-${this.id}`);
        if(!rows.length) { el.innerHTML = '<div class="status-msg">暫無資料</div>'; return; }
        el.innerHTML = rows.sort((a,b)=>a.seq-b.seq).map(r => `
                <div class="schedule-item" data-seq="${r.seq}">
                    <div class="pin-trigger" onclick="window.cardRegistry['${this.id}'].pin(event,${r.seq})"></div>
                    <div class="stop-info">
                        <span class="dest-seq">${r.seq}</span>
                        <span class="dest-name" onclick="openFocusMode('${this.id}', ${r.seq})">${r.name}</span>
                    </div>
                    <div class="eta-container" onclick="window.cardRegistry['${this.id}'].toggleMode(this)">${this.generateTimeHtml(r.etas)}</div>
                </div>`).join('');
        this.applyVisual();
        activeSeqs.forEach(seq => {
            const row = this.element.querySelector(`.schedule-item[data-seq="${seq}"]`);
            if(row) this.toggleMode(row.querySelector('.eta-container'));
        });
        this.updateMap();
    }
    updateRow(seq, etas) {
        const container = this.element.querySelector(`.schedule-item[data-seq="${seq}"] .eta-container`);
        if (!container) return;
        container.innerHTML = this.generateTimeHtml(etas);
        if (container.closest('.schedule-item').classList.contains('mode-time')) {
            this.toggleMode(container);
        }
    }
    applyVisual() {
        this.element.querySelectorAll('.schedule-item').forEach(el => {
            const seq = parseInt(el.dataset.seq), span = el.querySelector('.dest-seq');
            el.classList.toggle('hidden-row', this.filteredSeq !== null && this.filteredSeq !== seq);
            el.classList.toggle('marked', this.markedSeq === seq);
        });
        if (this.filteredSeq) { const targetEl = this.element.querySelector(`.schedule-item[data-seq="${this.filteredSeq}"]`); if (targetEl) targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    }
}
