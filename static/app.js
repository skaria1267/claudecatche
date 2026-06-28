// 公共 JS：auth / fetch 封装 / fmt / modal / toast
(function(){
    const path = location.pathname;
    const isLogin = path === '/' || path === '';
    const T = localStorage.getItem('token');

    if(!T && !isLogin){ location.href = '/'; return; }

    window.T = T;
    window.H = T ? {'Authorization':'Bearer '+T,'Content-Type':'application/json'} : {};

    window.api = function(url, opts){
        opts = opts || {};
        opts.headers = Object.assign({}, window.H, opts.headers || {});
        return fetch(url, opts);
    };
    window.apiJson = async function(url, opts){
        const r = await window.api(url, opts);
        if(!r.ok) throw new Error('HTTP '+r.status);
        return r.json();
    };

    window.fmt = function(n){
        if(n==null) return '-';
        if(n>=1e6) return (n/1e6).toFixed(1)+'M';
        if(n>=1e3) return (n/1e3).toFixed(1)+'K';
        return String(n);
    };

    window.showModal = id => document.getElementById(id).classList.add('active');
    window.hideModal = id => document.getElementById(id).classList.remove('active');

    window.logout = function(){ localStorage.removeItem('token'); location.href = '/'; };

    window.showToast = function(msg, id){
        const t = document.getElementById(id || 'toast');
        if(!t) return;
        t.innerHTML = msg;
        t.style.display = 'block';
        clearTimeout(t._timer);
        t._timer = setTimeout(()=>{ t.style.display = 'none'; }, 1800);
    };

    window.escapeHtml = function(s){
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    };
})();
