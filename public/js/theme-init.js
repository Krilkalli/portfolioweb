(() => {
  let isLightTheme = false;

  try {
    isLightTheme = localStorage.getItem('theme') === 'light';
  } catch {
    // Если хранилище недоступно, остаёмся на теме по умолчанию.
  }

  if (!isLightTheme) return;

  // Класс ставится на <html> до загрузки CSS и первого отображения страницы.
  document.documentElement.classList.add('theme-light-preload');

  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('light-theme');
    document.documentElement.classList.remove('theme-light-preload');
  }, { once: true });
})();
