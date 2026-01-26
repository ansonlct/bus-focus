export function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

export const cleanName = (n) => n ? n.replace(/\s*\([A-Z0-9\s]+\)$/, '').trim() : '';

export function calculateETA(etaTime) {
    const now = new Date();
    const diffMins = Math.floor((etaTime - now) / 60000);
    if (diffMins < 0) return null; // Permanently cancel departed logic

    const isUrgent = diffMins <= 1;
    const minStr = diffMins === 0 ? '即將' : `${diffMins}分`;
    const timeStr = formatTime(etaTime);

    return {
        minStr,
        timeStr,
        isUrgent,
        classes: `eta-minutes ${isUrgent ? 'urgent' : ''}`
    };
}

export function formatTime(date) {
    if (!date) return '';
    return date.toLocaleTimeString('zh-HK', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
}

// === 這是您缺少的關鍵部分 ===
export function initTheme() {
    // Dark Mode
    const isDark = localStorage.getItem('darkMode') === 'enabled' || 
                  (!localStorage.getItem('darkMode') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.toggle('dark-mode', isDark);

    // Flash Mode
    const flashEnabled = localStorage.getItem('flashEnabled');
    if (flashEnabled === 'disabled') document.body.classList.add('disable-flash');

    return isDark;
}
