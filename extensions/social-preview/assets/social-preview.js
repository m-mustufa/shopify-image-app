(() => {
  const version = document.querySelector('meta[name="social-image-version"]')?.content;
  if (!version) return;
  const url = new URL(window.location.href);
  if (url.searchParams.get('pv') === version) return;
  url.searchParams.set('pv', version);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
})();
