import './styles.css';
import './mobile-hero.css';
import './membership.css';
import './faq.css';
import { Bloodstream } from './scene.js';
import { ControlPanel, downloadBlob } from './panel.js';
import { createSettings } from './settings.js';
import { initializePhysics } from './physics.js';
import { initializeHero } from './hero.js';
import { ScrollTransition } from './scroll.js';

let scene;
let panel;
let scrollTransition;
let noticeTimeout;
let disposed = false;
const disposeHero = initializeHero();

function notify(message) {
  const notice = document.querySelector('#notice');
  notice.textContent = message;
  notice.classList.add('is-visible');
  clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => notice.classList.remove('is-visible'), 3200);
}

function createPanel(studio, settings, migrate) {
  const editor = new ControlPanel(studio, settings, {
    update: (path) => scene?.update(path),
    pause: (paused) => {
      scene?.setPaused(paused);
      document.body.classList.toggle('is-animation-paused', paused);
    },
    resetView: () => scene?.resetView(),
    capture: async () => {
      if (!scene) return;
      const image = await scene.capture();
      if (image) { downloadBlob(image, 'bloodstream-scene.png'); notify('Знімок сцени збережено'); }
      else notify('Не вдалося зберегти знімок');
    },
    notify,
  }, { migrate });
  editor.setHidden(true, { focus: false });
  return editor;
}

async function start() {
  const loading = document.querySelector('#loading');
  const progress = loading?.querySelector('.scene-progress');
  const progressValue = progress?.querySelector('.scene-progress-value');
  function showProgress(percent) {
    progress?.setAttribute('aria-valuenow', String(percent));
    if (progressValue) progressValue.textContent = `${percent}%`;
  }

  // Allow the progress update to paint before synchronous WebGL work begins.
  const afterPaint = () => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

  try {
    let progressPercent = 10;
    showProgress(progressPercent);
    function completePreparationStage() {
      progressPercent += 25;
      showProgress(progressPercent);
    }
    const [projectSettings] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}bloodstream-settings.json`, { cache: 'no-store' })
        .then((response) => {
          if (!response.ok) throw new Error('Could not load project settings');
          return response.json();
        })
        .then((settings) => {
          completePreparationStage();
          return settings;
        }),
      initializePhysics().then(completePreparationStage),
    ]);
    if (progress) await afterPaint();
    if (disposed) return;
    const settings = projectSettings ?? createSettings();
    const studio = document.querySelector('#studio');
    if (import.meta.env.DEV && studio) panel = createPanel(studio, settings, projectSettings === null);
    scrollTransition = new ScrollTransition((state) => scene?.setPresentation(state));
    scene = new Bloodstream(document.querySelector('#scene'), settings, (fps) => panel?.updateStats(fps), notify);
    scene.setPaused(panel?.paused ?? false);
    scene.setPresentation(scrollTransition.state);
    showProgress(90);
    if (progress) await afterPaint();
    if (disposed) return;
    scene.start();
    showProgress(100);
    document.body.classList.add('is-scene-ready');
    loading?.classList.add('is-ready');
    setTimeout(() => loading?.remove(), 600);
  } catch (error) {
    if (disposed) return;
    console.error('Bloodstream could not initialize:', error);
    if (loading) {
      loading.className = 'has-error';
      loading.textContent = 'Не вдалося запустити 3D-сцену. Перезавантажте сторінку.';
    }
  }
}
void start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => { disposed = true; scrollTransition?.dispose(); scene?.dispose(); panel?.dispose(); disposeHero(); clearTimeout(noticeTimeout); });
}
