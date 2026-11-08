// Botão hamburguer abre/fecha o menu no mobile
const btnMenu = document.getElementById('btnMenu');
const nav = document.getElementById('nav');

if (btnMenu && nav) {
  btnMenu.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    btnMenu.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('no-scroll', open);
  });
}

// Abre/fecha submenu "Produção" no clique (útil para mobile)
document.addEventListener('click', function (e) {
  const linkMenuPrincipal = e.target.closest('.nav__item.has-sub > .nav__link');
  const itemSubmenu = e.target.closest('.nav__item.has-sub');
  const abertos = document.querySelectorAll('.nav__item.has-sub.is-open');

  // Clique fora do item fecha submenus
  if (!itemSubmenu && !e.target.closest('.submenu')) {
    abertos.forEach(i => i.classList.remove('is-open'));
  }

  // Clique no link "Produção"
  if (linkMenuPrincipal) {
    e.preventDefault(); // evita navegação no '#'
    const item = linkMenuPrincipal.parentElement;
    const isOpen = item.classList.contains('is-open');
    abertos.forEach(i => i.classList.remove('is-open'));
    item.classList.toggle('is-open', !isOpen);

    // A11y
    linkMenuPrincipal.setAttribute('aria-expanded', String(!isOpen));
  }
});

// Teclas (Enter/Espaço) para abrir submenu com foco no link
document.querySelectorAll('.nav__item.has-sub > .nav__link').forEach(link => {
  link.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      link.click();
    }
  });
});