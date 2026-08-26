(() => {
  const header = document.querySelector('.navbar, .form-header');
  if (!header) return;

  const syncHeaderHeight = () => {
    document.documentElement.style.setProperty('--app-navbar-height', `${header.offsetHeight}px`);
  };

  syncHeaderHeight();
  window.addEventListener('load', syncHeaderHeight);
  window.addEventListener('resize', syncHeaderHeight);

  if ('ResizeObserver' in window) {
    new ResizeObserver(syncHeaderHeight).observe(header);
  }
})();
