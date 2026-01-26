import { appData } from './data.js';

export const StorageManager = {
    key: 'hk_transport_saved_list',
    tempList: null,
    
    getList: () => (appData.isEditMode && StorageManager.tempList) ? StorageManager.tempList : JSON.parse(localStorage.getItem(StorageManager.key) || '[]'),
    
    saveItem: (name, data) => {
        let list = JSON.parse(localStorage.getItem(StorageManager.key) || '[]');
        list.push({ id: Date.now(), name: name, data: data });
        localStorage.setItem(StorageManager.key, JSON.stringify(list));
        if (appData.isEditMode) StorageManager.tempList = list;
        StorageManager.renderList();
    },
    
    deleteItem: (id) => {
        const filter = list => list.filter(item => item.id !== id);
        if (appData.isEditMode) StorageManager.tempList = filter(StorageManager.tempList);
        else localStorage.setItem(StorageManager.key, JSON.stringify(filter(StorageManager.getList())));
        StorageManager.renderList();
    },
    
    renameItem: (id) => {
        if (!appData.isEditMode) return;
        const item = StorageManager.tempList.find(x => x.id === id);
        const newName = prompt("請輸入新名稱:", item ? item.name : "");
        if (item && newName && newName.trim()) { item.name = newName.trim(); StorageManager.renderList(); }
    },
    
    updateOrder: () => {
        if (!appData.isEditMode) return;
        const els = document.querySelectorAll('#saved-list-container .saved-item');
        const oldList = StorageManager.tempList;
        StorageManager.tempList = Array.from(els).map(el => oldList.find(x => x.id === parseInt(el.dataset.id))).filter(x=>x);
        StorageManager.renderList();
    },
    
    commit: () => { if (StorageManager.tempList) { localStorage.setItem(StorageManager.key, JSON.stringify(StorageManager.tempList)); StorageManager.tempList = null; } },
    discard: () => { StorageManager.tempList = null; },
    initTemp: () => { StorageManager.tempList = JSON.parse(localStorage.getItem(StorageManager.key) || '[]'); },
    loadAll: () => { StorageManager.renderList(); },
    
    renderList: () => {
        const list = StorageManager.getList();
        const container = document.getElementById('saved-list-container');
        if (list.length === 0) { container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-sub);">暫無儲存項目</div>'; return; }
        container.innerHTML = list.map((item, i) => {
            const isDefault = i === 0;
            let desc;
            const firstItem = item.data[0];
            const { allMtrLines, allMtrStations } = appData;
            
             if (firstItem.type === 'MTR_LINE') {
                const line = allMtrLines.find(l => l.lineCode === firstItem.lineCode);
                desc = `[港鐵] ${line ? line.lineName : firstItem.lineCode}`;
            } else if (firstItem.type === 'MTR') {
                const station = allMtrStations.find(s => s.staCode === firstItem.staCode);
                desc = `[港鐵] ${station ? station.staName : firstItem.staCode} (${station ? station.lineName : ''})`;
            } else {
                 desc = `[${firstItem.co||'KMB'}] ${firstItem.route} ${firstItem.destName ? '往 '+firstItem.destName : (firstItem.dir==='outbound'?'去程':'回程')}`;
            }
            if (item.data.length > 1) desc = `${item.data.length} 個項目組合`;

            return `
                    <div class="saved-item" draggable="${appData.isEditMode}" data-id="${item.id}" onclick="onSavedItemClick(${item.id})">
                        <div class="saved-drag-handle">≡</div>
                        <div class="saved-info">
                            <div class="saved-name">${item.name} ${isDefault ? '<span class="default-badge">預設</span>' : ''}</div>
                            <div class="saved-detail">${desc}</div>
                        </div>
                        <div class="delete-btn" onclick="deleteSaved(event, ${item.id})">🗑</div>
                    </div>`;
        }).join('');
        container.classList.toggle('editing', appData.isEditMode);
        StorageManager.bindEvents();
    },
    
    bindEvents: () => {
        document.querySelectorAll('.saved-item').forEach(item => {
            item.addEventListener('dragstart', () => item.classList.add('dragging'));
            item.addEventListener('dragend', () => { item.classList.remove('dragging'); if(appData.isEditMode) StorageManager.updateOrder(); });
        });
    }
};