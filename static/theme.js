// 日间/夜间主题切换
function getTheme(){return localStorage.getItem('theme')||'light';}
function setTheme(t){
    localStorage.setItem('theme',t);
    document.documentElement.setAttribute('data-theme',t);
}
function toggleTheme(){
    setTheme(getTheme()==='light'?'dark':'light');
}
setTheme(getTheme());
