// Contact address for the waitlist and school pilot buttons.
// Leave empty until a domain and inbox exist; the buttons then fall back to the free simulator.
const CONTACT_EMAIL = 'emmettseely@gmail.com';

for (const a of document.querySelectorAll<HTMLAnchorElement>('a[data-contact]')) {
  if (CONTACT_EMAIL) {
    a.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(a.dataset.contact || 'Tek Simulator')}`;
  } else {
    a.textContent = a.dataset.contact === 'School pilot' ? 'Pilots opening soon' : 'Try the free simulator';
  }
}
