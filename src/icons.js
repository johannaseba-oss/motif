const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  camera: svg('<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.4-2.2h6.2L16.500 7h2A1.500 1.500 0 0 1 20 8.500V18a1.500 1.500 0 0 1-1.500 1.500h-13A1.500 1.500 0 0 1 4 18z"/><circle cx="12" cy="13" r="3.600"/>'),
  person: svg('<circle cx="12" cy="8.200" r="3.700"/><path d="M4.800 20c.8-3.900 3.700-5.800 7.200-5.800s6.400 1.900 7.200 5.800"/>'),
  flip: svg('<path d="M4 11a8 8 0 0 1 13.700-4.700L20 8.500"/><path d="M20 4v4.500h-4.500"/><path d="M20 13a8 8 0 0 1-13.700 4.700L4 15.500"/><path d="M4 20v-4.500h4.500"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  export: svg('<path d="M12 15V4"/><path d="M8 7.5l4-4 4 4"/><path d="M6 11v8.5h12V11"/>'),
  trash: svg('<path d="M4.500 7h15"/><path d="M9.500 7V4.500h5V7"/><path d="M6.500 7l1 12.500h9l1-12.500"/>'),
};
