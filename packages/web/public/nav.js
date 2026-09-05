/* Hash screens: overview | ledger | autonomy | work | growth */
const SCREENS = ['overview', 'ledger', 'autonomy', 'work', 'growth'];

function currentScreen() {
  const hash = (location.hash || '#overview').replace('#', '').toLowerCase();
  return SCREENS.includes(hash) ? hash : 'overview';
}

function showScreen(name) {
  const screen = SCREENS.includes(name) ? name : 'overview';
  if (location.hash !== `#${screen}`) history.replaceState(null, '', `#${screen}`);
  document.querySelectorAll('[data-screen]').forEach(el => {
    el.hidden = el.dataset.screen !== screen;
  });
  document.querySelectorAll('.nav a').forEach(a => {
    a.setAttribute('aria-current', a.dataset.nav === screen ? 'page' : 'false');
  });
}

document.querySelectorAll('.nav a').forEach(a => {
  a.addEventListener('click', event => {
    event.preventDefault();
    showScreen(a.dataset.nav);
  });
});

window.addEventListener('hashchange', () => showScreen(currentScreen()));
showScreen(currentScreen());
