import { KMB_API, CTB_API, NLB_API, MTR_API, LRT_API, LINE_COLORS, LINE_TERMINALS } from './config.js';
import { calculateETA, formatTime, cleanName, initTheme } from './utils.js';
import { appData, buildMtrDb } from './data.js';

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    buildMtrDb(); 
    initFocus();
});

let refreshTimer = null;

function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

function initFocus() {
    const name = decodeURIComponent(getQueryParam('name') || '');
    document.getElementById('focus-station').innerText = name;
    
    fetchData();
    refreshTimer = setInterval(fetchData, 10000); 
}

async function fetchData() {
    const type = getQueryParam('type');
    document.getElementById('last-update').innerText = formatTime(new Date());

    try {
        if (type === 'bus') await fetchBusData();
        else if (type === 'mtr') await fetchMtrData();
        else if (type === 'lrt') await fetchLrtData();
    } catch (e) {
        console.error(e);
        document.getElementById('focus-main-time').innerText = '!';
        document.getElementById('focus-main-desc').innerText = '資料載入失敗';
    }
}

// --- Bus Logic ---
async function fetchBusData() {
    const co = getQueryParam('co');
    const route = getQueryParam('route');
    const stopId = getQueryParam('stop');
    const dir = getQueryParam('dir'); 
    const destName = decodeURIComponent(getQueryParam('dest') || '');

    const badge = document.getElementById('focus-badge');
    badge.innerText = `${co} ${route}`;
    badge.style.backgroundColor = co === 'KMB' ? '#E3001B' : (co === 'CTB' ? '#F9D300' : '#007D8F');
    if (co === 'CTB') badge.style.color = 'black'; else badge.style.color = 'white';
    
    document.getElementById('focus-dir').innerText = `往 ${destName}`;
    setThemeColor(badge.style.backgroundColor);

    let etas = [];
    if (co === 'KMB') {
        const res = await fetch(`${KMB_API}/eta/${stopId}/${route}/1`).then(r => r.json());
        const dirCode = dir === 'outbound' ? 'O' : 'I';
        etas = (res.data || []).filter(e => e.dir === dirCode && e.eta);
    } else if (co === 'CTB') {
        const res = await fetch(`${CTB_API}/eta/CTB/${stopId}/${route}`).then(r => r.json());
        const dirCode = dir === 'outbound' ? 'O' : 'I';
        etas = (res.data || []).filter(e => e.dir === dirCode && e.eta);
    } else if (co === 'NLB') {
        document.getElementById('focus-main-desc').innerText = '嶼巴資料需回主頁查看';
        return;
    }

    etas.sort((a,b) => new Date(a.eta) - new Date(b.eta));
    renderEtas(etas.map(e => ({ time: new Date(e.eta), note: '' })));
}

// --- MTR Logic (Fix: Strict Direction Filter) ---
async function fetchMtrData() {
    const line = getQueryParam('line');
    const sta = getQueryParam('stop');
    const dir = getQueryParam('dir'); // 這裡會拿到 UP 或 DOWN
    const destName = decodeURIComponent(getQueryParam('dest') || '');
    
    // console.log(`MTR Fetch: Line=${line}, Sta=${sta}, Dir=${dir}, Dest=${destName}`);

    const badge = document.getElementById('focus-badge');
    const lineInfo = appData.allMtrLines.find(l=>l.lineCode===line);
    badge.innerText = lineInfo ? lineInfo.lineName : line; 
    
    const color = LINE_COLORS[line] || '#999';
    badge.style.backgroundColor = color;
    badge.style.color = 'white';
    
    document.getElementById('focus-dir').innerText = `往 ${destName}`;
    setThemeColor(color);

    const res = await fetch(`${MTR_API}?line=${line}&sta=${sta}&lang=TC`).then(r => r.json());
    if (res.status === 0) return renderEtas([]);

    const data = res.data[`${line}-${sta}`];
    if (!data) return renderEtas([]);

    let trains = [];
    
    // 嚴格過濾邏輯：如果 URL 有指定 dir (UP/DOWN)，只取該方向的資料
    if (dir && data[dir]) {
        trains = data[dir];
    } else if (!dir) {
        // 如果網址沒有參數 (fallback)，才合併兩邊
        if (data.UP) trains.push(...data.UP);
        if (data.DOWN) trains.push(...data.DOWN);
    }
    
    // 額外過濾：如果是東鐵線或將軍澳線，過濾終點站
    if (line === 'EAL' && dir === 'UP') {
        trains = trains.filter(t => ['LOW', 'LMC', 'SHT', 'TAP', 'FAN', 'SHS'].includes(t.dest));
    }
    if (line === 'TKL' && dir === 'UP') {
        trains = trains.filter(t => ['POA', 'LHP'].includes(t.dest));
    }

    trains.sort((a,b) => new Date(a.time) - new Date(b.time));
    
    const destNames = appData.mtrStationNames;
    
    renderEtas(trains.map(t => ({
        time: new Date(t.time),
        note: `往 ${destNames[t.dest] || t.dest} (${t.plat}號月台)`
    })));
}

// --- LRT Logic ---
async function fetchLrtData() {
    const route = getQueryParam('route');
    const stopId = getQueryParam('stop');
    let targetDest = decodeURIComponent(getQueryParam('dest') || '');
    targetDest = targetDest.replace(/^往\s?/, '').trim();
    
    const badge = document.getElementById('focus-badge');
    badge.innerText = `輕鐵 ${route}`;
    const color = LINE_COLORS['LRT'];
    badge.style.backgroundColor = color;
    badge.style.color = 'black';
    
    document.getElementById('focus-dir').innerText = targetDest ? `往 ${targetDest}` : '';
    setThemeColor(color);

    const res = await fetch(`${LRT_API}?station_id=${stopId}`).then(r => r.json());
    if (res.status !== 1) return renderEtas([]);

    let trains = [];
    const isCircular = ['705', '706'].includes(route);

    (res.platform_list || []).forEach(plat => {
        (plat.route_list || []).forEach(r => {
            if (r.route_no === route) {
                if (!isCircular && targetDest) {
                    if (r.dest_ch !== targetDest) return; 
                }

                let min = 0;
                let timeStr = r.time_en.toLowerCase();
                if (timeStr.includes('min')) min = parseInt(r.time_en) || 0;
                else if (timeStr.includes('arriving') || timeStr.includes('departing')) min = 0;
                
                const etaTime = new Date(Date.now() + min * 60000);
                trains.push({
                    time: etaTime,
                    note: `往 ${r.dest_ch} (${plat.platform_id}號月台)`,
                    rawMin: r.time_en 
                });
            }
        });
    });

    trains.sort((a,b) => a.time - b.time);
    renderEtas(trains);
}

// --- Rendering ---
function renderEtas(items) {
    const mainContainer = document.getElementById('focus-main-time');
    const descContainer = document.getElementById('focus-main-desc');
    const listContainer = document.getElementById('focus-list');
    
    listContainer.innerHTML = '';

    if (items.length === 0) {
        mainContainer.innerText = '暫無';
        mainContainer.classList.remove('focus-urgent', 'focus-normal');
        descContainer.innerText = '目前沒有班次資料';
        return;
    }

    // Main Time (最近班次)
    const first = items[0];
    const etaInfo = calculateETA(first.time);
    
    if (etaInfo) {
        // 修復邏輯：只有 "即將" 不加單位，其他 (包括 1) 都要顯示 "1分"
        let rawMin = etaInfo.minStr.replace('分', '');
        
        if (rawMin === '即將') {
             mainContainer.innerText = rawMin;
             mainContainer.style.fontSize = '4.5rem';
        } else {
             mainContainer.innerText = rawMin + '分';
             mainContainer.style.fontSize = '6rem';
        }

        mainContainer.className = `focus-big-time ${etaInfo.isUrgent ? 'focus-urgent' : 'focus-normal'}`;
        
        let desc = etaInfo.timeStr;
        if (first.note) desc += ` • ${first.note}`;
        descContainer.innerText = desc;
    }

    // List (後續班次)
    items.slice(1).forEach(item => {
        const info = calculateETA(item.time);
        if (!info) return;
        
        const div = document.createElement('div');
        div.className = 'focus-item';
        div.innerHTML = `
            <div class="focus-item-left">
                <span class="focus-item-time ${info.isUrgent ? 'focus-urgent-text' : ''}">${info.minStr}</span>
                <span class="focus-item-real">${info.timeStr}</span>
            </div>
            <div class="focus-item-note">${item.note}</div>
        `;
        listContainer.appendChild(div);
    });
}

function setThemeColor(color) {
    const bg = document.getElementById('focus-bg');
    bg.style.background = `radial-gradient(circle at 50% 30%, ${color} 0%, transparent 70%)`;
    bg.style.opacity = '0.15';
}
