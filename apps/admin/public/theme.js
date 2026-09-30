// The chosen theme before the first paint (see @af/ui theme.ts). A file of its own: the Content Security Policy runs no
// inline script.
try { var t = localStorage.getItem('af-theme'); if (t === 'light' || t === 'dark') { document.documentElement.setAttribute('data-theme', t); document.documentElement.style.colorScheme = t; } } catch (e) {}
