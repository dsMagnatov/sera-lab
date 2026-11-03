import { applyPreset, presets, mergeSettings } from './settings.js';

const icons = {
  sliders: '<path d="M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6"/>',
  close: '<path d="m8 5 7 7-7 7"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  reset: '<path d="M4 10a8 8 0 1 1 1.5 7M4 4v6h6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  camera: '<path d="M4 7h4l2-3h4l2 3h4v13H4Z"/><circle cx="12" cy="13" r="4"/>',
  cell: '<ellipse cx="12" cy="12" rx="8" ry="7"/><ellipse cx="12" cy="12" rx="3.5" ry="2.5"/>',
  flow: '<path d="M3 7h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 17h5a3 3 0 1 1-3 3"/>',
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  lens: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m12 3 4 5m4 8-6 1M5 7l-1 6m3 7 5-3"/>',
  vision: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M8 12h8m-4-4v8"/>',
};

const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] ?? ''}</svg>`;
const slider = (key, label, min, max, step, hint) => ({ key, label, min, max, step, hint });
const color = (key, label) => ({ key, label, type: 'color' });
const toggle = (key, label, hint) => ({ key, label, type: 'toggle', hint });

const tabs = [
  {
    id: 'cell', label: 'Еритроцит', icon: 'cell',
    sections: [
      { name: 'Геометрія', caption: 'Одна модель · усі клітини', open: true, controls: [
        slider('cell.radius', 'Радіус', 0.8, 2.2, 0.01),
        slider('cell.thickness', 'Випуклість', 0.2, 1.2, 0.01, 'Товщина об’ємного краю клітини'),
        slider('cell.dent', 'Глибина западини', 0, 0.96, 0.01, 'Двоввігнута форма без наскрізного отвору'),
        slider('cell.rim', 'Повнота краю', 0, 1.5, 0.01),
        slider('cell.asymmetry', 'Нерівність форми', 0, 0.3, 0.005),
        slider('flow.heroScale', 'Масштаб головної', 0.6, 2.4, 0.01),
      ] },
      { name: 'Орієнтація', caption: 'Поворот головного еритроцита', open: false, controls: [
        slider('flow.heroTiltX', 'Нахил X', -180, 180, 1),
        slider('flow.heroTiltY', 'Нахил Y', -180, 180, 1),
        slider('flow.heroTiltZ', 'Поворот Z', -180, 180, 1),
      ] },
      { name: 'Мембрана', caption: 'Матеріал і мікрорельєф', open: true, controls: [
        color('cell.color', 'Колір клітин'),
        slider('cell.roughness', 'Шорсткість', 0.08, 1, 0.01),
        slider('cell.texture', 'Рельєф текстури', 0, 0.5, 0.005),
        slider('cell.textureScale', 'Частота текстури', 1, 18, 0.1),
        slider('cell.clearcoat', 'Вологий блиск', 0, 1, 0.01),
        slider('cell.sheen', 'М’якість відблиску', 0, 1, 0.01),
        slider('cell.scatter', 'Просвічування краю', 0, 1.5, 0.01),
        slider('cell.variation', 'Варіація кольору', 0, 0.7, 0.01),
      ] },
    ],
  },
  {
    id: 'motion', label: 'Рух', icon: 'flow',
    sections: [
      { name: 'Великі клітини', caption: 'Потік уздовж глибини сцени', open: true, controls: [
        slider('flow.count', 'Кількість', 0, 140, 1),
        slider('flow.speed', 'Швидкість потоку', 0, 4, 0.01),
        slider('flow.direction', 'Кут течії', -180, 180, 1),
        slider('flow.rotation', 'Обертання', 0, 1.5, 0.01),
        slider('flow.swirl', 'Завихрення', 0, 2, 0.01),
        slider('flow.turbulence', 'Турбулентність', 0, 2, 0.01),
        slider('flow.spread', 'Ширина потоку', 0.6, 1.8, 0.01),
        slider('flow.edgeCoverage', 'Заповнення країв', 0.2, 0.85, 0.01, 'Частка потоку у зовнішніх ділянках кадру; решта може влучати в центр'),
        slider('flow.chaos', 'Хаотичність траєкторій', 0, 1.5, 0.01),
        slider('flow.sizeVariation', 'Різниця розмірів', 0, 1, 0.01),
      ] },
      { name: 'Фізика зіткнень', caption: 'Поштовхи, ковзання та інерція', open: true, controls: [
        toggle('physics.enabled', 'Зіткнення клітин'),
        toggle('physics.heroCollisions', 'Удари об головну клітину'),
        slider('physics.heroImpact', 'Сила реакції на удар', 1, 8, 0.1),
        slider('physics.heroTargeting', 'Частота влучань', 0, 1, 0.01, 'Частка великих клітин, спрямованих до головного еритроцита'),
        slider('physics.restitution', 'Пружність відскоку', 0, 0.95, 0.01),
        slider('physics.friction', 'Тертя між клітинами', 0, 1, 0.01),
        slider('physics.drag', 'Опір плазми', 0, 2.5, 0.01, 'Малий опір довше зберігає імпульс після удару'),
        slider('physics.heroReturn', 'Швидкість повернення', 0.4, 4, 0.05),
        slider('physics.heroDamping', 'Затухання після удару', 0.5, 1.5, 0.05),
        slider('physics.heroMass', 'Інерція головної', 3, 45, 0.5),
        slider('physics.appearance', 'Плавність появи', 8, 34, 1, 'Відстань, на якій далекі клітини плавно набирають розмір'),
      ] },
      { name: 'Малі клітини', caption: 'Власна швидкість та обертання', open: false, controls: [
        slider('particles.smallCount', 'Кількість', 0, 350, 1),
        slider('particles.smallSize', 'Розмір', 0.02, 0.2, 0.001),
        slider('particles.smallSpeed', 'Швидкість', 0, 5, 0.01),
        slider('particles.smallRotation', 'Обертання', 0, 3, 0.01),
        color('particles.smallColor', 'Колір'),
      ] },
      { name: 'Частинки плазми', caption: 'Світловий пил і боке', open: true, controls: [
        slider('particles.count', 'Кількість', 0, 3500, 10),
        slider('particles.size', 'Розмір', 0.008, 0.12, 0.001),
        slider('particles.speed', 'Швидкість', 0, 5, 0.01),
        slider('particles.turbulence', 'Хаотичність', 0, 3, 0.01),
        slider('particles.opacity', 'Яскравість', 0, 1, 0.01),
        color('particles.color', 'Колір'),
      ] },
    ],
  },
  {
    id: 'vision', label: 'Аналіз', icon: 'vision',
    sections: [
      { name: 'Рамка аналізу', caption: 'Перспектива та рух разом із клітиною', open: true, controls: [
        toggle('vision.enabled', 'Показувати рамку'),
        color('vision.color', 'Колір рамки та ліній'),
        slider('vision.opacity', 'Яскравість', 0.15, 1, 0.01),
        slider('vision.margin', 'Розмір рамки', 1.05, 1.8, 0.01),
        slider('vision.offset', 'Відступ перед клітиною', 0.05, 0.8, 0.01),
        slider('vision.ticks', 'Кількість поділок', 30, 120, 5),
      ] },
      { name: 'Computer Vision', caption: 'Маркери, координати та сканування', open: true, controls: [
        color('vision.textColor', 'Колір цифр'),
        color('vision.backgroundColor', 'Колір фону цифр'),
        slider('vision.backgroundOpacity', 'Непрозорість фону', 0, 1, 0.01),
        slider('vision.markers', 'Кількість квадратів', 3, 16, 1),
        slider('vision.speed', 'Швидкість аналізу', 0.1, 2, 0.05),
        slider('vision.fontSize', 'Розмір цифр', 0.04, 0.14, 0.005),
        slider('vision.links', 'Яскравість ліній', 0, 0.8, 0.01),
        toggle('vision.labels', 'Цифрові координати'),
        toggle('vision.scan', 'Лінія сканування'),
      ] },
    ],
  },
  {
    id: 'light', label: 'Світло', icon: 'light',
    sections: [
      { name: 'Головне світло', caption: 'Холодне · справа зверху', open: true, controls: [
        color('light.keyColor', 'Колір'),
        slider('light.key', 'Інтенсивність', 0, 12, 0.05),
        slider('light.keyX', 'Позиція X', -12, 12, 0.1),
        slider('light.keyY', 'Позиція Y', -12, 12, 0.1),
        slider('light.keyZ', 'Позиція Z', -12, 12, 0.1),
      ] },
      { name: 'Тепле заповнення', caption: 'М’який червоний відблиск зліва', open: true, controls: [
        color('light.fillColor', 'Тепле світло'),
        slider('light.fill', 'Сила заповнення', 0, 10, 0.05),
        slider('light.fillX', 'Позиція X', -12, 12, 0.1),
        slider('light.fillY', 'Позиція Y', -12, 12, 0.1),
        slider('light.fillZ', 'Позиція Z', -12, 12, 0.1),
      ] },
      { name: 'Контрове світло', caption: 'Холодний контур позаду клітин', open: true, controls: [
        color('light.rimColor', 'Контрове світло'),
        slider('light.rim', 'Сила контуру', 0, 12, 0.05),
        slider('light.rimX', 'Позиція X', -12, 12, 0.1),
        slider('light.rimY', 'Позиція Y', -12, 12, 0.1),
        slider('light.rimZ', 'Позиція Z', -12, 12, 0.1),
      ] },
      { name: 'Середовище', caption: 'Фонове світло й атмосфера', open: false, controls: [
        slider('light.ambient', 'Фонове світло', 0, 2, 0.01),
        slider('light.reflection', 'Відбиття середовища', 0, 3, 0.01),
        slider('light.glow', 'Світіння простору', 0, 1.8, 0.01),
      ] },
    ],
  },
  {
    id: 'camera', label: 'Камера', icon: 'lens',
    sections: [
      { name: 'Об’єктив', caption: 'Фокус, глибина і перспектива', open: true, controls: [
        toggle('camera.dof', 'Глибина різкості'),
        slider('camera.focus', 'Відстань фокусу', 5, 40, 0.1),
        slider('camera.aperture', 'Сила розфокусу', 0, 0.008, 0.0001),
        slider('camera.blur', 'Максимальне боке', 0, 0.035, 0.001),
        slider('camera.fov', 'Кут огляду', 25, 65, 0.5),
        slider('camera.zoom', 'Наближення', 0.7, 1.7, 0.01),
        slider('camera.parallax', 'Паралакс від миші', 0, 30, 0.01),
        slider('camera.parallaxSmoothing', 'Плавність паралаксу', 0, 5, 0.05, 'Час згладжування в секундах. Більше — повільніше й м’якше. 0 — миттєвий рух.'),
      ] },
      { name: 'Атмосфера', caption: 'Глибина, світіння і колір', open: true, controls: [
        color('effects.background', 'Колір простору'),
        color('effects.fogColor', 'Колір серпанку'),
        slider('effects.fog', 'Густина серпанку', 0, 0.07, 0.001),
        slider('effects.bloom', 'Bloom', 0, 1.5, 0.01),
        slider('effects.exposure', 'Експозиція', 0.4, 2.5, 0.01),
        slider('effects.saturation', 'Насиченість', 0, 1.7, 0.01),
        slider('effects.vignette', 'Віньєтка', 0, 1, 0.01),
        slider('effects.grain', 'Зерно плівки', 0, 0.15, 0.001),
        slider('effects.chromatic', 'Хроматична аберація', 0, 0.006, 0.0001),
      ] },
      { name: 'Рендер', caption: 'Баланс деталізації та швидкодії', open: false, controls: [
        slider('effects.quality', 'Роздільна здатність', 0.75, 2, 0.25, '1× — швидше. 2× — більше деталей на Retina-дисплеї.'),
      ] },
    ],
  },
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(icon, title, handler, className = '') {
  const button = element('button', `icon-button ${className}`);
  button.type = 'button';
  button.innerHTML = svg(icon);
  button.title = title;
  button.setAttribute('aria-label', title);
  button.addEventListener('click', handler);
  return button;
}

function format(value, step) {
  if (step >= 1) return String(Math.round(value));
  const digits = Math.max(0, Math.ceil(-Math.log10(step)));
  return value.toFixed(digits);
}

export class ControlPanel {
  constructor(container, settings, actions, { migrate = false } = {}) {
    this.settings = settings;
    this.actions = actions;
    this.controls = new Map();
    this.limits = new Map();
    this.activeTab = 'cell';
    this.hidden = false;
    this.paused = false;
    this.saveTimer = null;
    this.saving = false;
    this.pendingSave = null;
    this.container = container;
    this.build();
    if (migrate) {
      if (this.restore()) this.save({ migrate: true });
    } else {
      this.presetSelect.value = 'custom';
      this.saveStatus.textContent = 'Збережено в проєкті';
    }
    this.onKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target.closest('input[type="number"],input[type="text"],select,textarea')) return;
      if (event.code === 'KeyH') this.setHidden(!this.hidden);
      if (event.code === 'Space' && !event.target.closest('button,input,summary')) {
        event.preventDefault();
        this.togglePause();
      }
    };
    addEventListener('keydown', this.onKey);
  }

  build() {
    this.reveal = iconButton('sliders', 'Показати панель · H', () => this.setHidden(false), 'reveal-button');
    this.reveal.hidden = true;
    this.container.appendChild(this.reveal);
    this.panel = element('aside', 'control-panel');
    this.panel.setAttribute('aria-label', 'Панель керування 3D-сценою');

    const header = element('header', 'panel-header');
    const brand = element('div', 'panel-brand');
    const mark = element('span', 'brand-mark');
    mark.innerHTML = svg('cell');
    const titles = element('div');
    titles.append(element('div', 'eyebrow', 'BLOODSTREAM'), element('h2', '', 'Студія сцени'));
    brand.append(mark, titles);
    header.append(brand, iconButton('close', 'Приховати панель · H', () => this.setHidden(true)));
    this.panel.appendChild(header);

    const bar = element('div', 'playback-bar');
    const live = element('div', 'live-status');
    this.statusDot = element('span', 'status-dot');
    this.statusLabel = element('span', '', 'LIVE');
    this.fps = element('span', 'fps', '— FPS');
    live.append(this.statusDot, this.statusLabel, this.fps);
    const actions = element('div', 'playback-actions');
    this.pauseButton = iconButton('pause', 'Пауза · Пробіл', () => this.togglePause());
    actions.append(this.pauseButton, iconButton('camera', 'Зберегти знімок сцени', () => this.actions.capture()));
    bar.append(live, actions);
    this.panel.appendChild(bar);

    const presetRow = element('div', 'preset-row');
    const presetLabel = element('label', 'field-kicker', 'ПРЕСЕТ');
    presetLabel.htmlFor = 'preset';
    this.presetSelect = element('select', 'preset-select');
    this.presetSelect.id = 'preset';
    for (const [id, preset] of Object.entries(presets)) {
      const option = element('option', '', preset.label);
      option.value = id;
      this.presetSelect.appendChild(option);
    }
    const custom = element('option', '', 'Власні налаштування');
    custom.value = 'custom';
    custom.disabled = true;
    this.presetSelect.appendChild(custom);
    this.presetSelect.addEventListener('change', () => {
      applyPreset(this.settings, this.presetSelect.value);
      this.refresh();
      this.actions.update('all');
      this.actions.resetView();
      this.save();
    });
    presetRow.append(presetLabel, this.presetSelect);
    this.panel.appendChild(presetRow);

    const mode = this.createControl(toggle('flow.single', 'Лише головний еритроцит'));
    mode.classList.add('single-mode');
    this.panel.appendChild(mode);

    this.tabBar = element('div', 'tab-bar');
    this.tabBar.setAttribute('role', 'tablist');
    this.tabBar.setAttribute('aria-label', 'Категорії налаштувань');
    this.tabButtons = [];
    this.tabPanels = [];
    const scrollArea = element('div', 'panel-scroll');
    for (const [index, tab] of tabs.entries()) {
      const tabButton = element('button', `tab ${index === 0 ? 'is-active' : ''}`);
      tabButton.innerHTML = `${svg(tab.icon)}<span>${tab.label}</span>`;
      tabButton.type = 'button';
      tabButton.id = `tab-${tab.id}`;
      tabButton.setAttribute('role', 'tab');
      tabButton.setAttribute('aria-selected', String(index === 0));
      tabButton.setAttribute('aria-controls', `pane-${tab.id}`);
      tabButton.tabIndex = index === 0 ? 0 : -1;
      tabButton.addEventListener('click', () => this.selectTab(tab.id));
      tabButton.addEventListener('keydown', (event) => {
        if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        this.selectTab(tabs[next].id);
        this.tabButtons[next].focus();
      });
      this.tabButtons.push(tabButton);
      this.tabBar.appendChild(tabButton);

      const pane = element('div', 'tab-pane');
      pane.id = `pane-${tab.id}`;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', `tab-${tab.id}`);
      pane.hidden = index !== 0;
      for (const section of tab.sections) {
        const details = element('details', 'control-section');
        details.open = section.open;
        const summary = element('summary', 'section-summary');
        const sectionTitle = element('div');
        sectionTitle.append(element('span', 'section-title', section.name), element('span', 'section-caption', section.caption));
        summary.append(sectionTitle, element('span', 'section-chevron'));
        details.appendChild(summary);
        const body = element('div', 'section-body');
        section.controls.forEach((control) => body.appendChild(this.createControl(control)));
        details.appendChild(body);
        pane.appendChild(details);
      }
      this.tabPanels.push(pane);
      scrollArea.appendChild(pane);
    }
    this.panel.append(this.tabBar, scrollArea);

    const footer = element('footer', 'panel-footer');
    const fileButtons = element('div', 'file-actions');
    const exportButton = element('button', 'text-button');
    exportButton.type = 'button';
    exportButton.innerHTML = `${svg('download')}<span>Експорт JSON</span>`;
    exportButton.addEventListener('click', () => this.exportSettings());
    const importButton = iconButton('upload', 'Імпортувати налаштування JSON', () => this.fileInput.click());
    const resetButton = iconButton('reset', 'Повернути атмосферу референсу', () => {
      applyPreset(this.settings, 'reference');
      this.presetSelect.value = 'reference';
      this.refresh();
      this.actions.update('all');
      this.actions.resetView();
      this.save();
      this.actions.notify('Початкові налаштування відновлено');
    });
    fileButtons.append(exportButton, importButton, resetButton);
    const help = element('div', 'panel-help');
    help.innerHTML = '<span><kbd>H</kbd> панель</span><span><kbd>Пробіл</kbd> пауза</span>';
    this.saveStatus = element('span', 'autosave', 'Збереження в проєкт');
    this.saveStatus.setAttribute('role', 'status');
    help.appendChild(this.saveStatus);
    footer.append(fileButtons, help);
    this.panel.appendChild(footer);
    this.fileInput = element('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => this.importSettings());
    this.container.append(this.panel, this.fileInput);
  }

  createControl(definition) {
    const { key, label, type, hint } = definition;
    const [group, property] = key.split('.');
    const row = element('div', `control-row ${type ?? 'range'}-row`);
    const id = `control-${group}-${property}`;
    const text = element('label', 'control-label', label);
    text.htmlFor = id;
    if (hint) text.title = hint;
    const head = element('div', 'control-head');
    head.appendChild(text);
    row.appendChild(head);
    let input;
    let number;
    let display;
    if (type === 'color') {
      const swatch = element('div', 'color-field');
      input = element('input', 'color-input');
      input.type = 'color';
      input.id = id;
      input.value = this.settings[group][property];
      display = element('span', 'color-hex', input.value);
      swatch.append(display, input);
      head.appendChild(swatch);
    } else if (type === 'toggle') {
      input = element('input', 'toggle-input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = this.settings[group][property];
      const track = element('label', 'toggle-track');
      track.htmlFor = id;
      track.append(input, element('span', 'toggle-thumb'));
      head.appendChild(track);
    } else {
      const { min, max, step } = definition;
      this.limits.set(key, { min, max, step });
      input = element('input', 'range-input');
      input.type = 'range';
      input.id = id;
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = this.settings[group][property];
      number = element('input', 'number-input');
      number.type = 'number';
      number.setAttribute('aria-label', `${label}: точне значення`);
      number.min = min;
      number.max = max;
      number.step = step;
      number.value = format(this.settings[group][property], step);
      const commitNumber = () => {
        if (number.value.trim() === '' || !Number.isFinite(number.valueAsNumber)) {
          this.refreshControl(key);
          return;
        }
        const value = Math.min(max, Math.max(min, Math.round(number.valueAsNumber / step) * step));
        const previous = this.settings[group][property];
        this.settings[group][property] = value;
        this.refreshControl(key);
        if (value !== previous) this.changed(key);
      };
      number.addEventListener('change', commitNumber);
      number.addEventListener('input', () => {
        const value = number.valueAsNumber;
        if (!Number.isFinite(value) || value < min || value > max) return;
        const quantized = Math.round(value / step) * step;
        if (quantized === this.settings[group][property]) return;
        this.settings[group][property] = quantized;
        input.value = quantized;
        input.style.setProperty('--fill', `${(quantized - min) / (max - min) * 100}%`);
        this.changed(key);
      });
      number.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commitNumber();
          number.blur();
        }
      });
      head.appendChild(number);
      row.appendChild(input);
    }
    input.addEventListener('input', () => {
      this.settings[group][property] = type === 'toggle' ? input.checked : type === 'color' ? input.value : Number(input.value);
      this.refreshControl(key);
      this.changed(key);
    });
    this.controls.set(key, { input, number, display, definition });
    this.refreshControl(key);
    return row;
  }

  changed(key) {
    this.presetSelect.value = 'custom';
    this.actions.update(key);
    this.save();
  }

  refreshControl(key) {
    const control = this.controls.get(key);
    if (!control) return;
    const [group, property] = key.split('.');
    const value = this.settings[group][property];
    const { input, number, display, definition } = control;
    if (definition.type === 'toggle') input.checked = value;
    else input.value = value;
    if (number) {
      number.value = format(value, definition.step);
      input.style.setProperty('--fill', `${(value - definition.min) / (definition.max - definition.min) * 100}%`);
    }
    if (display) display.textContent = value.toUpperCase();
  }

  refresh() { this.controls.forEach((_, key) => this.refreshControl(key)); }

  selectTab(id) {
    this.activeTab = id;
    tabs.forEach((tab, i) => {
      const active = tab.id === id;
      this.tabButtons[i].classList.toggle('is-active', active);
      this.tabButtons[i].setAttribute('aria-selected', String(active));
      this.tabButtons[i].tabIndex = active ? 0 : -1;
      this.tabPanels[i].hidden = !active;
    });
    this.panel.querySelector('.panel-scroll').scrollTop = 0;
  }

  setHidden(hidden, { focus = true } = {}) {
    this.hidden = hidden;
    this.panel.hidden = hidden;
    this.reveal.hidden = !hidden;
    if (focus) {
      if (!hidden) this.panel.querySelector('button').focus({ preventScroll: true });
      else this.reveal.focus({ preventScroll: true });
    }
  }

  togglePause() {
    this.paused = !this.paused;
    this.actions.pause(this.paused);
    this.pauseButton.innerHTML = svg(this.paused ? 'play' : 'pause');
    const title = this.paused ? 'Продовжити · Пробіл' : 'Пауза · Пробіл';
    this.pauseButton.title = title;
    this.pauseButton.setAttribute('aria-label', title);
    this.pauseButton.setAttribute('aria-pressed', String(this.paused));
    this.statusLabel.textContent = this.paused ? 'PAUSED' : 'LIVE';
    this.statusDot.classList.toggle('is-paused', this.paused);
  }

  updateStats(fps) { this.fps.textContent = `${fps} FPS`; }

  save({ migrate = false } = {}) {
    this.pendingSave = JSON.stringify({ settings: this.settings, migrate });
    this.saveStatus.textContent = 'Зберігається…';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 150);
  }

  async flushSave() {
    if (this.saving || !this.pendingSave) return;
    this.saving = true;
    const body = this.pendingSave;
    this.pendingSave = null;
    try {
      const response = await fetch('/__studio/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      });
      if (response.status === 409) {
        this.saveStatus.textContent = 'Оновіть сторінку';
      } else if (response.status === 204) {
        this.saveStatus.textContent = 'Збережено в проєкті';
      } else {
        throw new Error('Project save failed');
      }
    } catch {
      this.saveStatus.textContent = 'Помилка збереження';
      if (!this.pendingSave) this.actions.notify('Не вдалося записати налаштування в проєкт. Перевірте локальний сервер або експортуйте JSON.');
    } finally {
      this.saving = false;
      if (this.pendingSave) void this.flushSave();
    }
  }

  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem('bloodstream-studio-v1'));
      if (saved?.version === 1 && saved.settings) {
        mergeSettings(this.settings, saved.settings, this.limits);
        this.refresh();
        this.presetSelect.value = presets[saved.preset] ? saved.preset : 'custom';
        return true;
      }
    } catch { /* A damaged save should never prevent the scene from loading. */ }
    return false;
  }

  exportSettings() {
    const blob = new Blob([JSON.stringify({ version: 1, settings: this.settings }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'bloodstream-settings.json');
    this.actions.notify('Налаштування експортовано');
  }

  async importSettings() {
    const file = this.fileInput.files[0];
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error('Файл завеликий');
      const parsed = JSON.parse(await file.text());
      const data = parsed.settings ?? parsed;
      if (!data || !data.cell || !data.light) throw new Error('Невідомий формат');
      mergeSettings(this.settings, data, this.limits);
      this.refresh();
      this.presetSelect.value = 'custom';
      this.actions.update('all');
      this.save();
      this.actions.notify('Налаштування імпортовано');
    } catch {
      this.actions.notify('Не вдалося прочитати налаштування. Оберіть JSON, експортований зі студії.');
    }
    this.fileInput.value = '';
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    clearTimeout(this.saveTimer);
    this.container.replaceChildren();
  }
}

export function downloadBlob(blob, filename) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
