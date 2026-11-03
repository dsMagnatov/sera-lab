import { COMPACT_HERO_QUERY } from './scroll.js';

function initializeClinicMotion() {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches) return () => {};

  const tiles = document.querySelector('.clinic-benefits');
  const title = document.querySelector('#clinic-title');
  const counters = [...tiles.querySelectorAll('.clinic-count')].map((element) => ({
    element,
    value: Number(element.textContent),
  }));
  let frameId;
  let start;
  let hasStarted = false;

  function reset() {
    cancelAnimationFrame(frameId);
    start = undefined;
    hasStarted = false;
    for (const { element } of counters) element.textContent = '0';
  }

  function finish() {
    observer.disconnect();
    cancelAnimationFrame(frameId);
    title.classList.remove('has-line-reveal', 'is-revealed');
    for (const { element, value } of counters) element.textContent = value;
  }

  function tick(now) {
    start ??= now;
    const progress = Math.min(1, (now - start) / 1400);
    const eased = 1 - (1 - progress) ** 2;
    for (const { element, value } of counters) {
      element.textContent = Math.floor(value * eased);
    }
    if (progress < 1) frameId = requestAnimationFrame(tick);
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target === title) {
        if (!entry.isIntersecting) title.classList.remove('is-revealed');
        else if (entry.intersectionRatio >= 0.25) title.classList.add('is-revealed');
      } else if (!entry.isIntersecting) {
        reset();
      } else if (!hasStarted && entry.intersectionRatio >= 0.25) {
        hasStarted = true;
        frameId = requestAnimationFrame(tick);
      }
    }
  }, { threshold: [0, 0.25] });

  reset();
  title.classList.add('has-line-reveal');
  observer.observe(title);
  observer.observe(tiles);
  motion.addEventListener('change', finish, { once: true });
  return () => {
    motion.removeEventListener('change', finish);
    finish();
  };
}

export function initializeHero() {
  const root = document.querySelector('.lab-hero');
  const mobileLayout = matchMedia(COMPACT_HERO_QUERY);
  const spectrum = root.querySelector('.sample-spectrum');
  const controller = new AbortController();
  const links = [...root.querySelectorAll('.lab-nav a')];
  const notes = [...root.querySelectorAll('.lab-note')];
  const catalog = document.querySelector('.test-catalog');
  const expand = catalog.querySelector('.test-expand');
  const previewCards = catalog.querySelectorAll('.test-card-preview');
  const disposeClinicMotion = initializeClinicMotion();

  function showFullCatalog(expanded) {
    expand.setAttribute('aria-expanded', String(expanded));
    expand.textContent = expanded ? 'Show fewer blood tests' : 'See all blood tests';
    previewCards.forEach((card) => { card.inert = !expanded; });
  }

  showFullCatalog(false);
  expand.hidden = false;
  expand.addEventListener('click', () => {
    showFullCatalog(expand.getAttribute('aria-expanded') !== 'true');
  }, { signal: controller.signal });

  // A decorative sample spectrum, independent of the clinical example values.
  for (let index = 0; index < 32; index++) {
    const bar = document.createElement('span');
    for (let keyframe = 0; keyframe < 4; keyframe++) {
      const level = 0.22 + ((index * 47 + index * index * 13 + keyframe * (index * 19 + 31)) % 79) / 100;
      bar.style.setProperty(`--bar-level-${keyframe}`, level.toFixed(2));
    }
    bar.style.setProperty('--bar-duration', `${4.2 + (index * 11 % 23) * 0.1}s`);
    bar.style.setProperty('--bar-delay', `${-index * 0.23}s`);
    if (index % 6 === 3) bar.classList.add('is-peak');
    spectrum.appendChild(bar);
  }

  root.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    const destination = link.getAttribute('href');
    links.forEach((item) => {
      if (item.getAttribute('href') === destination) item.setAttribute('aria-current', 'location');
      else item.removeAttribute('aria-current');
    });
    notes.forEach((note) => note.classList.toggle('is-highlighted', note === target));
    target.focus({ preventScroll: true });
    if (mobileLayout.matches || !root.contains(target)) {
      const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const scrollTarget = destination === '#home' ? root.closest('.hero-story') : target;
      scrollTarget.scrollIntoView({ behavior: reduceMotion ? 'instant' : 'smooth' });
    }
  }, { signal: controller.signal });

  return () => {
    controller.abort();
    disposeClinicMotion();
    spectrum.replaceChildren();
  };
}
