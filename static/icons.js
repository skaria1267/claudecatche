// SVG 图标 — 淡雅配色，发光线条风格（全站无 emoji）
// 樱粉 #FFB7C5 / 水蓝 #5BB8D4 / 蛋黄 #FFD97D / 薄荷绿 #8FD9B6 / 浅紫 #C0A0FF
const ICONS = {
    // 品牌 logo：缓存层叠 + 中转节点
    brand: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="24" height="24" style="display:block;">
        <rect x="3" y="4" width="18" height="5" rx="2" fill="rgba(91,184,212,0.18)" stroke="rgba(91,184,212,0.9)" stroke-width="1.5"/>
        <rect x="3" y="11" width="18" height="5" rx="2" fill="rgba(255,183,197,0.18)" stroke="rgba(255,183,197,0.9)" stroke-width="1.5"/>
        <circle cx="12" cy="20" r="2" fill="rgba(192,160,255,0.3)" stroke="rgba(192,160,255,0.95)" stroke-width="1.5"/>
    </svg>`,

    // 渠道管理（控制台卡片）：中转/插头
    channels: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="44" height="44" rx="14" fill="rgba(91,184,212,0.10)" stroke="rgba(91,184,212,0.4)" stroke-width="1.5"/>
        <circle cx="14" cy="24" r="5" fill="none" stroke="rgba(91,184,212,0.95)" stroke-width="2"/>
        <circle cx="34" cy="24" r="5" fill="none" stroke="rgba(255,183,197,0.95)" stroke-width="2"/>
        <path d="M19 24h10" stroke="rgba(192,160,255,0.9)" stroke-width="2" stroke-linecap="round">
            <animate attributeName="stroke-opacity" values="0.9;0.4;0.9" dur="2.5s" repeatCount="indefinite"/>
        </path>
    </svg>`,

    settings: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="44" height="44" rx="14" fill="rgba(143,217,182,0.10)" stroke="rgba(143,217,182,0.4)" stroke-width="1.5"/>
        <circle cx="24" cy="24" r="5" stroke="rgba(143,217,182,0.95)" stroke-width="2" fill="none"/>
        <path d="M24 8v4M24 36v4M8 24h4M36 24h4M12.7 12.7l2.8 2.8M32.5 32.5l2.8 2.8M35.3 12.7l-2.8 2.8M15.5 32.5l-2.8 2.8" stroke="rgba(143,217,182,0.75)" stroke-width="2" stroke-linecap="round">
            <animate attributeName="stroke-opacity" values="0.75;0.35;0.75" dur="4s" repeatCount="indefinite"/>
        </path>
    </svg>`,

    usage: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="44" height="44" rx="14" fill="rgba(255,217,125,0.12)" stroke="rgba(255,217,125,0.45)" stroke-width="1.5"/>
        <polyline points="10,34 18,24 26,28 38,14" stroke="rgba(255,200,90,0.95)" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <animate attributeName="stroke-opacity" values="0.95;0.5;0.95" dur="3s" repeatCount="indefinite"/>
        </polyline>
        <circle cx="38" cy="14" r="2.5" fill="rgba(255,200,90,0.95)">
            <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite"/>
        </circle>
    </svg>`,

    logs: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="2" y="2" width="44" height="44" rx="14" fill="rgba(192,160,255,0.10)" stroke="rgba(192,160,255,0.4)" stroke-width="1.5"/>
        <rect x="12" y="10" width="24" height="28" rx="3" stroke="rgba(192,160,255,0.95)" stroke-width="2" fill="none"/>
        <line x1="17" y1="18" x2="31" y2="18" stroke="rgba(192,160,255,0.65)" stroke-width="2" stroke-linecap="round"/>
        <line x1="17" y1="24" x2="28" y2="24" stroke="rgba(192,160,255,0.65)" stroke-width="2" stroke-linecap="round"/>
        <line x1="17" y1="30" x2="25" y2="30" stroke="rgba(192,160,255,0.65)" stroke-width="2" stroke-linecap="round">
            <animate attributeName="stroke-opacity" values="0.65;0.25;0.65" dur="3s" repeatCount="indefinite"/>
        </line>
    </svg>`,

    login: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="28" fill="rgba(255,183,197,0.06)" stroke="rgba(255,183,197,0.3)" stroke-width="1.5"/>
        <circle cx="32" cy="32" r="18" fill="rgba(91,184,212,0.06)" stroke="rgba(91,184,212,0.3)" stroke-width="1.5"/>
        <path d="M24 32 L30 38 L40 26" stroke="rgba(192,160,255,0.8)" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <animate attributeName="stroke-opacity" values="0.8;0.4;0.8" dur="2.5s" repeatCount="indefinite"/>
        </path>
    </svg>`,

    // 主题切换：月亮+小星星
    theme: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22" style="display:block;">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" fill="rgba(192,160,255,0.35)" stroke="#9b7ed8" stroke-width="1.7" stroke-linejoin="round"/>
        <circle cx="17.5" cy="5.5" r="1.1" fill="#e8b94a"/>
        <circle cx="20" cy="9" r="0.7" fill="#e8b94a"/>
    </svg>`,

    // 渠道标题：插头/中转
    plug: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
        <circle cx="8" cy="12" r="4" fill="rgba(91,184,212,0.18)" stroke="rgba(91,184,212,0.9)" stroke-width="1.6"/>
        <circle cx="18" cy="12" r="3" fill="rgba(255,183,197,0.18)" stroke="rgba(255,183,197,0.9)" stroke-width="1.6"/>
        <line x1="12" y1="12" x2="15" y2="12" stroke="rgba(192,160,255,0.9)" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`,

    // 设置标题：齿轮
    gear: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
        <circle cx="12" cy="12" r="3" fill="rgba(143,217,182,0.18)" stroke="rgba(143,217,182,0.9)" stroke-width="1.6"/>
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" stroke="rgba(143,217,182,0.85)" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`,

    // 缓存模式：自动（cpu）
    auto: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
        <rect x="6" y="6" width="12" height="12" rx="2" fill="rgba(192,160,255,0.15)" stroke="rgba(192,160,255,0.9)" stroke-width="1.5"/>
        <rect x="9.5" y="9.5" width="5" height="5" rx="0.8" fill="rgba(192,160,255,0.6)"/>
        <path d="M9 6V3M12 6V3M15 6V3M9 21v-3M12 21v-3M15 21v-3M6 9H3M6 12H3M6 15H3M21 9h-3M21 12h-3M21 15h-3" stroke="rgba(192,160,255,0.7)" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,

    // 缓存模式：手动规则（滑块）
    slider: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="22" height="22">
        <line x1="4" y1="7" x2="20" y2="7" stroke="rgba(255,217,125,0.8)" stroke-width="1.6" stroke-linecap="round"/>
        <line x1="4" y1="12" x2="20" y2="12" stroke="rgba(255,217,125,0.8)" stroke-width="1.6" stroke-linecap="round"/>
        <line x1="4" y1="17" x2="20" y2="17" stroke="rgba(255,217,125,0.8)" stroke-width="1.6" stroke-linecap="round"/>
        <circle cx="9" cy="7" r="2.5" fill="rgba(255,217,125,0.25)" stroke="rgba(255,200,90,1)" stroke-width="1.6"/>
        <circle cx="15" cy="12" r="2.5" fill="rgba(255,217,125,0.25)" stroke="rgba(255,200,90,1)" stroke-width="1.6"/>
        <circle cx="7" cy="17" r="2.5" fill="rgba(255,217,125,0.25)" stroke="rgba(255,200,90,1)" stroke-width="1.6"/>
    </svg>`,

    // 已停用：垃圾桶
    trash: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
        <path d="M5 7h14M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="rgba(231,140,140,0.9)" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" fill="rgba(231,140,140,0.10)" stroke="rgba(231,140,140,0.9)" stroke-width="1.6" stroke-linejoin="round"/>
        <line x1="10" y1="11" x2="10" y2="17" stroke="rgba(231,140,140,0.7)" stroke-width="1.4" stroke-linecap="round"/>
        <line x1="14" y1="11" x2="14" y2="17" stroke="rgba(231,140,140,0.7)" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,

    // 勾选：用于 toast
    check: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="vertical-align:-3px;">
        <circle cx="12" cy="12" r="10" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.9)" stroke-width="1.6"/>
        <path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`,
};

// 通用主题按钮替换
function injectThemeIcons(){
    document.querySelectorAll('.theme-btn,.theme-toggle').forEach(b=>{
        if(b.dataset.iconified)return;
        b.dataset.iconified='1';
        b.innerHTML=ICONS.theme;
        b.style.display='inline-flex';
        b.style.alignItems='center';
        b.style.justifyContent='center';
        b.style.padding='4px';
        b.style.minWidth='30px';
        b.style.minHeight='30px';
    });
    document.querySelectorAll('.brand-logo').forEach(b=>{
        if(b.dataset.iconified)return;
        b.dataset.iconified='1';
        b.innerHTML=ICONS.brand;
    });
}
injectThemeIcons();
document.addEventListener('DOMContentLoaded',injectThemeIcons);
window.addEventListener('load',injectThemeIcons);
