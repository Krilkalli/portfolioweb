(() => {
  const roleLabels = {
    department_head: { short: 'РД', full: 'Руководитель департамента' },
    chief_scrum: { short: 'ГСМ', full: 'Главный скрам-мастер' },
    scrum: { short: 'СМ', full: 'Скрам-мастер' },
    leader: { short: 'РП', full: 'Руководитель проекта' },
    admin: { short: 'АдминД', full: 'Администратор департамента' },
  };

  window.renderNavbarManager = (manager) => {
    const target = document.getElementById('navbarManager');
    if (!target || !manager) return;
    const labels = roleLabels[manager.role] || { short: manager.roleShortLabel || '—', full: manager.roleLabel || 'Пользователь' };
    target.textContent = '';
    target.classList.add('navbar-manager-context');
    const role = document.createElement('span');
    role.className = 'navbar-manager-role';
    role.textContent = manager.roleShortLabel || labels.short;
    role.title = manager.roleLabel || labels.full;
    const name = document.createElement('span');
    name.className = 'navbar-manager-name';
    name.textContent = manager.name || 'ФИО не указано';
    target.append(role, name);
  };

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

  fetch('/api/auth/me')
    .then(response => response.json())
    .then(auth => { if (auth.authenticated && auth.manager) window.renderNavbarManager(auth.manager); })
    .catch(() => {});

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
