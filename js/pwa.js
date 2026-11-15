// Installing the site as an app (home screen / desktop) and keeping it
// working offline. Android and desktop Chrome/Edge can install from a button;
// iPhone and iPad can only add it from Safari's Share menu, so for those the
// panel shows the steps. Open the page with #install to show the panel at once.

const $ = (id) => document.getElementById(id);

export const isStandalone = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** The link that opens the install steps (to send to students). */
export const installLink = () => `${location.origin}${location.pathname}#install`;

let deferred = null; // Chrome/Edge's install prompt, saved until the button is pressed

export function setupPwa() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* still works online */ });
  }
  const btn = $('installBtn');
  const panel = $('installPanel');
  if (!btn || !panel) return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    refresh();
  });
  window.addEventListener('appinstalled', () => { deferred = null; refresh(); });

  btn.addEventListener('click', () => open());
  $('installClose').addEventListener('click', () => close());
  panel.addEventListener('click', (e) => { if (e.target === panel) close(); });
  panel.addEventListener('cancel', () => close());
  $('installNow').addEventListener('click', async () => {
    if (!deferred) return;
    const d = deferred;
    deferred = null;
    d.prompt();
    const choice = await d.userChoice.catch(() => null);
    if (choice && choice.outcome === 'accepted') close();
    refresh();
  });
  $('installCopy').addEventListener('click', async () => {
    const msg = $('installCopyMsg');
    try { await navigator.clipboard.writeText(installLink()); msg.textContent = 'Link copied.'; }
    catch { msg.textContent = installLink(); }
  });
  window.addEventListener('hashchange', () => { if (/^#install\b/.test(location.hash)) open(); });

  refresh();
  if (/^#install\b/.test(location.hash)) open();
}

function refresh() {
  const installed = isStandalone();
  $('installBtn').hidden = installed;
  // which instructions fit this device
  const ios = isIOS();
  $('installDone').hidden = !installed;
  $('installPrompt').hidden = installed || !deferred;
  $('installIOS').hidden = installed || !ios;
  $('installOther').hidden = installed || ios || !!deferred;
  $('installLink').textContent = installLink();
}

function open() {
  refresh();
  const panel = $('installPanel');
  if (panel.showModal && !panel.open) panel.showModal();
  else panel.setAttribute('open', '');
}

function close() {
  const panel = $('installPanel');
  if (panel.close && panel.open) panel.close();
  else panel.removeAttribute('open');
  // leave the #install link so a reload does not open it again
  if (/^#install\b/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
}
