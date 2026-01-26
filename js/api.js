import { KMB_API, CTB_API, NLB_API } from './config.js';
import { appData } from './data.js';

export async function preloadAllRoutes() {
    try {
        const [k, c, n] = await Promise.all([
            fetch(`${KMB_API}/route/`).then(r=>r.json()).catch(()=>({data:[]})),
            fetch(`${CTB_API}/route/CTB`).then(r=>r.json()).catch(()=>({data:[]})),
            fetch(`${NLB_API}/route.php?action=list`).then(r=>r.json()).catch(()=>({routes:[]}))
        ]);
        appData.nlbRouteMap = (n.routes || []).reduce((acc, r) => { 
            if(!acc[r.routeNo]) acc[r.routeNo] = []; 
            acc[r.routeNo].push(r); 
            return acc; 
        }, {});
        
        const nlbList = Object.keys(appData.nlbRouteMap).map(rNo => { 
            const parts = appData.nlbRouteMap[rNo][0].routeName_c.split('>'); 
            return { route: rNo, orig: parts[0]?.trim() || '?', dest: parts[1]?.trim() || '?', co: 'NLB' }; 
        });
        
        const seen = new Set();
        appData.allRoutesDB = [
            ...(k.data||[]).map(r=>({route:r.route,orig:r.orig_tc,dest:r.dest_tc,co:'KMB'})), 
            ...(c.data||[]).map(r=>({route:r.route,orig:r.orig_tc,dest:r.dest_tc,co:'CTB'})), 
            ...nlbList
        ].filter(r => seen.has(r.route+'_'+r.co) ? false : seen.add(r.route+'_'+r.co))
         .sort((a,b) => (parseInt(a.route.replace(/\D/g,''))||0) - (parseInt(b.route.replace(/\D/g,''))||0) || a.route.localeCompare(b.route));
    } catch (e) { console.error("Failed to preload routes", e); }
}

export async function getStopName(id, co) {
    const key = `${co}_${id}`; 
    if (appData.stopCache[key]) return appData.stopCache[key];
    
    try { 
        const d = await (await fetch(`${co==='KMB'?KMB_API:CTB_API}/stop/${id}`)).json(); 
        const info = {
            name: d.data.name_tc,
            lat: d.data.lat,
            long: d.data.long
        };
        return appData.stopCache[key] = info; 
    } catch { 
        return { name: '未知車站', lat: null, long: null }; 
    }
}