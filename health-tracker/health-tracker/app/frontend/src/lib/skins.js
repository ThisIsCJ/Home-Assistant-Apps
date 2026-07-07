/**
 * Skin definitions — each entry overrides the CSS custom properties on :root.
 * dots: three representative colors shown in the picker card.
 */
export const SKINS = [
  {
    id: 'default',
    name: 'Default',
    dots: ['#f59e0b', '#f97316', '#3b82f6'],
    vars: {
      '--bg':      '#090e1a',
      '--surface': '#0f172a',
      '--card':    '#131f35',
      '--card2':   '#1a2744',
      '--border':  '#1e3050',
      '--border2': '#243660',
      '--text':    '#e2e8f0',
      '--muted':   '#64748b',
      '--muted2':  '#94a3b8',
      '--accent':  '#3b82f6',
      '--accent2': '#60a5fa',
    },
  },
  {
    id: 'ares',
    name: 'Ares',
    dots: ['#ef4444', '#f87171', '#b91c1c'],
    vars: {
      '--bg':      '#110808',
      '--surface': '#1c0f0f',
      '--card':    '#271414',
      '--card2':   '#321a1a',
      '--border':  '#4a1c1c',
      '--border2': '#5c2424',
      '--text':    '#f1e8e8',
      '--muted':   '#7a5555',
      '--muted2':  '#a08080',
      '--accent':  '#ef4444',
      '--accent2': '#f87171',
    },
  },
  {
    id: 'mono',
    name: 'Mono',
    dots: ['#888888', '#aaaaaa', '#555555'],
    vars: {
      '--bg':      '#0f0f0f',
      '--surface': '#181818',
      '--card':    '#222222',
      '--card2':   '#2c2c2c',
      '--border':  '#383838',
      '--border2': '#444444',
      '--text':    '#e8e8e8',
      '--muted':   '#666666',
      '--muted2':  '#999999',
      '--accent':  '#909090',
      '--accent2': '#b8b8b8',
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    dots: ['#818cf8', '#a5b4fc', '#6366f1'],
    vars: {
      '--bg':      '#0a0d14',
      '--surface': '#10141f',
      '--card':    '#161b2d',
      '--card2':   '#1d2438',
      '--border':  '#252e47',
      '--border2': '#2e3955',
      '--text':    '#e2e4f0',
      '--muted':   '#5b6282',
      '--muted2':  '#8b92b0',
      '--accent':  '#818cf8',
      '--accent2': '#a5b4fc',
    },
  },
  {
    id: 'poseidon',
    name: 'Poseidon',
    dots: ['#0ea5e9', '#06b6d4', '#67e8f9'],
    vars: {
      '--bg':      '#030d14',
      '--surface': '#061520',
      '--card':    '#091e30',
      '--card2':   '#0d2840',
      '--border':  '#0f3558',
      '--border2': '#144268',
      '--text':    '#d0f0f8',
      '--muted':   '#3a6a7a',
      '--muted2':  '#6090a0',
      '--accent':  '#0ea5e9',
      '--accent2': '#67e8f9',
    },
  },
  {
    id: 'sisyphus',
    name: 'Sisyphus',
    dots: ['#a855f7', '#d8b4fe', '#7c3aed'],
    vars: {
      '--bg':      '#090814',
      '--surface': '#10101e',
      '--card':    '#161428',
      '--card2':   '#1e1c35',
      '--border':  '#2a2650',
      '--border2': '#343062',
      '--text':    '#e8e0f8',
      '--muted':   '#5a4870',
      '--muted2':  '#8a70a8',
      '--accent':  '#a855f7',
      '--accent2': '#d8b4fe',
    },
  },
  {
    id: 'charizard',
    name: 'Charizard',
    dots: ['#f97316', '#fdba74', '#ea580c'],
    vars: {
      '--bg':      '#110a04',
      '--surface': '#1c1008',
      '--card':    '#28160a',
      '--card2':   '#341e0e',
      '--border':  '#4a2e14',
      '--border2': '#5c3c1c',
      '--text':    '#f5e8d0',
      '--muted':   '#7a5030',
      '--muted2':  '#a07050',
      '--accent':  '#f97316',
      '--accent2': '#fdba74',
    },
  },
  {
    id: 'sienna',
    name: 'Sienna',
    dots: ['#d97706', '#f59e0b', '#fcd34d'],
    vars: {
      '--bg':      '#110e07',
      '--surface': '#1c1808',
      '--card':    '#28220c',
      '--card2':   '#342c10',
      '--border':  '#4a3c18',
      '--border2': '#5c4e24',
      '--text':    '#f2e8c8',
      '--muted':   '#7a6040',
      '--muted2':  '#a08860',
      '--accent':  '#d97706',
      '--accent2': '#fcd34d',
    },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    dots: ['#cba6f7', '#89b4fa', '#f38ba8'],
    vars: {
      '--bg':      '#1e1e2e',
      '--surface': '#181825',
      '--card':    '#1e1e2e',
      '--card2':   '#313244',
      '--border':  '#45475a',
      '--border2': '#585b70',
      '--text':    '#cdd6f4',
      '--muted':   '#6c7086',
      '--muted2':  '#9399b2',
      '--accent':  '#cba6f7',
      '--accent2': '#f5c2e7',
    },
  },
  {
    id: 'hepburn',
    name: 'Hepburn',
    dots: ['#ec4899', '#f9a8d4', '#be185d'],
    vars: {
      '--bg':      '#12080e',
      '--surface': '#1e0d18',
      '--card':    '#2a1020',
      '--card2':   '#361528',
      '--border':  '#4a1e38',
      '--border2': '#5c2848',
      '--text':    '#f0d8e8',
      '--muted':   '#7a4060',
      '--muted2':  '#a06080',
      '--accent':  '#ec4899',
      '--accent2': '#f9a8d4',
    },
  },
  {
    id: 'nous',
    name: 'Nous',
    dots: ['#14b8a6', '#5eead4', '#0d9488'],
    vars: {
      '--bg':      '#041110',
      '--surface': '#081c1a',
      '--card':    '#0c2826',
      '--card2':   '#103432',
      '--border':  '#184040',
      '--border2': '#1e4e4e',
      '--text':    '#ccf0ee',
      '--muted':   '#2d6060',
      '--muted2':  '#508888',
      '--accent':  '#14b8a6',
      '--accent2': '#5eead4',
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    dots: ['#00ff88', '#00ccff', '#ff00ff'],
    vars: {
      '--bg':      '#030308',
      '--surface': '#07070f',
      '--card':    '#0c0c1a',
      '--card2':   '#12122a',
      '--border':  '#1a1a3a',
      '--border2': '#22224a',
      '--text':    '#e0e8ff',
      '--muted':   '#3a3a6a',
      '--muted2':  '#6060a8',
      '--accent':  '#00ff88',
      '--accent2': '#00ccff',
    },
  },
  {
    id: 'geist',
    name: 'Geist Contrast',
    dots: ['#ffffff', '#fef08a', '#a3a3a3'],
    vars: {
      '--bg':      '#000000',
      '--surface': '#0a0a0a',
      '--card':    '#111111',
      '--card2':   '#1a1a1a',
      '--border':  '#2a2a2a',
      '--border2': '#333333',
      '--text':    '#ffffff',
      '--muted':   '#666666',
      '--muted2':  '#999999',
      '--accent':  '#ffffff',
      '--accent2': '#d4d4d4',
    },
  },
];

const SKIN_KEY = 'ht_skin';

export function applySkin(id) {
  const skin = SKINS.find(s => s.id === id) ?? SKINS[0];
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(skin.vars)) {
    root.style.setProperty(prop, value);
  }
  try { localStorage.setItem(SKIN_KEY, skin.id); } catch {}
}

export function loadSavedSkin() {
  try {
    const id = localStorage.getItem(SKIN_KEY);
    if (id && id !== 'custom') applySkin(id);
  } catch {}
}

export function currentSkinId() {
  try { return localStorage.getItem(SKIN_KEY) ?? 'default'; } catch { return 'default'; }
}

export const CUSTOM_SKIN_DEFAULTS = { ...SKINS[0].vars };

export function applyCustomVars(vars) {
  const root = document.documentElement;
  const merged = { ...CUSTOM_SKIN_DEFAULTS, ...vars };
  for (const [prop, value] of Object.entries(merged)) {
    root.style.setProperty(prop, value);
  }
  try { localStorage.setItem(SKIN_KEY, 'custom'); } catch {}
}
