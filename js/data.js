// data.js
import { MTR_DATA, LRT_DATA, LRT_STATION_NAMES } from './config.js';

// Global Data Storage
export const appData = {
    stopCache: {},
    allRoutesDB: [],
    nlbRouteMap: {},
    allMtrStations: [],
    allMtrLines: [],
    mtrStationNames: {},
    allLrtLines: [], // 新增輕鐵路線
    lrtStationNames: LRT_STATION_NAMES, // 新增輕鐵站名
    isMapEnabled: false,
    cardCounter: 0,
    isEditMode: false
};

// 用來掛載卡片物件，方便全域存取
window.cardRegistry = {};

export function buildMtrDb() {
    // Heavy Rail
    appData.allMtrLines = Object.entries(MTR_DATA).map(([lineCode, lineData]) => ({
        lineCode, 
        lineName: lineData.name, 
        stations: lineData.stations.reduce((acc, s) => { acc[s.c] = s.n; return acc; }, {}), 
        orderedStations: lineData.stations
    }));
    
    for (const [lineCode, lineData] of Object.entries(MTR_DATA)) {
        lineData.stations.forEach(s => {
            appData.allMtrStations.push({ lineCode, staCode: s.c, lineName: lineData.name, staName: s.n });
            if (!appData.mtrStationNames[s.c]) appData.mtrStationNames[s.c] = s.n;
        });
    }

    // Light Rail
    appData.allLrtLines = Object.entries(LRT_DATA).map(([route, data]) => ({
        route,
        dest: data.dest,
        stations: data.stations
    }));
}