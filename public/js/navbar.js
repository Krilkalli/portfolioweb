(() => {
  const header = document.querySelector('.navbar, .form-header');
  if (!header) return;

  const actions = header.querySelector('.navbar-actions');
  if (actions) {
    actions.querySelectorAll('a').forEach(link => link.remove());
    const themeButton = actions.querySelector('#themeToggle');
    const managerLabel = actions.querySelector('#navbarManager');
    const currentPath = window.location.pathname;
    const links = [
      ['/index.html', 'Дашборд'],
      ['/projects.html', 'Проекты'],
    ];
    if (['/index.html', '/archive.html'].includes(currentPath)) {
      links.push(['/archive.html', 'Архив']);
    }
    if (['/projects.html', '/project.html', '/projects-archive.html'].includes(currentPath)) {
      links.push(['/projects-archive.html', 'Архив проектов']);
    }
    links.push(['/settings.html', 'Настройки']);
    const nav = document.createElement('div');
    nav.className = 'navbar-nav-links';
    nav.setAttribute('aria-label', 'Основная навигация');
    links.forEach(([href, label]) => {
      const link = document.createElement('a');
      const isActive = currentPath === href || (href === '/projects.html' && currentPath === '/project.html');
      link.href = href;
      link.className = `btn ${isActive ? 'btn-primary' : 'btn-ghost'} btn-sm`;
      link.textContent = label;
      if (isActive) link.setAttribute('aria-current', 'page');
      nav.appendChild(link);
    });
    actions.insertBefore(nav, managerLabel || actions.querySelector('#logoutBtn'));
    if (themeButton) actions.insertBefore(themeButton, nav);
  }

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
