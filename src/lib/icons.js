export function heartSvg({ filled = false } = {}) {
  const stroke = "rgba(255,255,255,.86)";
  const fill = filled ? "rgba(255,136,162,.78)" : "none";
  return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z" stroke="${stroke}" stroke-width="2.2" fill="${fill}" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

export function closeSvg() {
  return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="rgba(255,255,255,.86)" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
  `;
}

export function downloadSvg() {
  return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 3v10" stroke="rgba(255,255,255,.86)" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M8 11l4 4 4-4" stroke="rgba(255,255,255,.86)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M5 20h14" stroke="rgba(255,255,255,.70)" stroke-width="2.2" stroke-linecap="round"/>
    </svg>
  `;
}

export function linkSvg() {
  return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10 13a4 4 0 0 1 0-6l1-1a4 4 0 0 1 6 6l-1 1" stroke="rgba(255,255,255,.86)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M14 11a4 4 0 0 1 0 6l-1 1a4 4 0 0 1-6-6l1-1" stroke="rgba(255,255,255,.86)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

export function shareSvg() {
  return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M12 3v10" stroke="rgba(255,255,255,.86)" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M8 7l4-4 4 4" stroke="rgba(255,255,255,.86)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" stroke="rgba(255,255,255,.78)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

export function wallpaperSvg() {
  return `
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M5.5 6.5A2.5 2.5 0 0 1 8 4h8a2.5 2.5 0 0 1 2.5 2.5V17A3 3 0 0 1 15.5 20h-7A3 3 0 0 1 5.5 17V6.5Z" stroke="rgba(255,255,255,.90)" stroke-width="2" stroke-linejoin="round"/>
      <path d="M8.2 15.5l2.1-2.2a1.2 1.2 0 0 1 1.8 0l1.2 1.3a1.2 1.2 0 0 0 1.8 0l1.4-1.5" stroke="rgba(255,255,255,.85)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M9.2 10.1h.02" stroke="rgba(255,255,255,.92)" stroke-width="3" stroke-linecap="round"/>
    </svg>
  `;
}
