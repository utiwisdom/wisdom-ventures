document.addEventListener('DOMContentLoaded', () => {
  const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 });
  const $ = (id) => document.getElementById(id);

  const grid = $('grid');
  const fleetStatus = $('fleet-status');
  const dialog = $('rent-dialog');
  const rentForm = $('rent-form');
  const rentMsg = $('rent-msg');
  const rentSubmit = $('rent-submit');
  const toast = $('toast');

  let bikes = [];
  let filter = 'all';
  let selectedBike = null;
  let toastTimer;

  // All text is inserted with textContent (never innerHTML), so database content can never inject scripts.
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    children.forEach((c) => c && node.append(c));
    return node;
  }

  function showToast(text) {
    if (!toast) return alert(text);
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
  }

  async function api(url, options) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  // ---------- Fleet ----------
  async function loadBikes() {
    try {
      bikes = await api('/api/bikes');
      fleetStatus.textContent = '';
      fleetStatus.classList.remove('error');
      renderBikes();
    } catch (e) {
      fleetStatus.textContent = 'We could not load the bikes. Refresh the page to try again.';
      fleetStatus.classList.add('error');
    }
  }

  function renderBikes() {
    grid.replaceChildren();
    const list = bikes.filter((b) => filter === 'all' || b.type === filter);
    if (!list.length) {
      fleetStatus.textContent = 'No bikes in this category yet.';
      return;
    }
    const free = bikes.filter((b) => b.available).length;
    fleetStatus.textContent = `${free} of ${bikes.length} bikes available now.`;

    list.forEach((b) => {
      const img = el('img', { src: `images/${encodeURIComponent(b.image || 'road-white.jpg')}`, alt: `${b.name || b.type + ' bike'}`, loading: 'lazy', width: '600', height: '400' });
      const tag = el('span', { class: b.available ? 'tag' : 'tag out', text: b.available ? 'Available' : 'Rented out' });
      const action = b.available
        ? el('button', { class: 'btn btn-red', type: 'button', text: 'Rent' })
        : el('button', { class: 'btn btn-ghost', type: 'button', text: 'Unavailable', disabled: '' });
      if (b.available) action.addEventListener('click', () => openRent(b));

      const price = el('span', { class: 'price', text: naira.format(b.price_per_day) });
      price.append(el('small', { text: ' / day' }));

      grid.append(
        el('article', { class: b.available ? 'card' : 'card is-out' },
          el('div', { class: 'card-img' }, img, tag),
          el('div', { class: 'card-body' },
            el('h3', { text: b.name || `${b.type} bike` }),
            el('p', { class: 'card-meta', text: `${b.type} bike, ${b.size}" wheels` }),
            el('div', { class: 'card-foot' }, price, action)
          )
        )
      );
    });
  }

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      filter = chip.dataset.filter;
      document.querySelectorAll('.chip').forEach((c) => {
        const on = c === chip;
        c.classList.toggle('is-on', on);
        c.setAttribute('aria-pressed', String(on));
      });
      renderBikes();
    });
  });

  // ---------- Rent ----------
  function openRent(bike) {
    if (!dialog || !rentForm) {
      showToast('The rent form is missing from index.html. Please check the file.');
      return;
    }
    selectedBike = bike;
    const label = $('rent-bike');
    if (label) label.textContent = `${bike.name || bike.type} · ${naira.format(bike.price_per_day)} / day`;
    rentForm.reset();
    if (rentMsg) rentMsg.textContent = '';
    dialog.showModal();
    const phoneInput = $('rent-phone');
    if (phoneInput) phoneInput.focus();
  }

  const cancelBtn = $('rent-cancel');
  if (cancelBtn && dialog) cancelBtn.addEventListener('click', () => dialog.close());

  if (rentForm) {
    rentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      rentMsg.textContent = '';
      rentSubmit.disabled = true;
      try {
        const data = await api('/api/rentals', {
          method: 'POST',
          body: JSON.stringify({
            bike_id: selectedBike.bike_id,
            phone: $('rent-phone').value,
            name: $('rent-name').value,
          }),
        });
        dialog.close();
        showToast(data.message);
      } catch (err) {
        rentMsg.textContent = err.message;
      } finally {
        rentSubmit.disabled = false;
        loadBikes();
      }
    });
  }

  // ---------- Return ----------
  const lookupForm = $('lookup-form');
  const returnMsg = $('return-msg');
  const rentalsList = $('my-rentals');

  async function lookup(phone) {
    returnMsg.textContent = '';
    rentalsList.replaceChildren();
    const rentals = await api('/api/rentals/lookup', { method: 'POST', body: JSON.stringify({ phone }) });
    if (!rentals.length) {
      returnMsg.textContent = 'No bikes are rented under that phone number.';
      return;
    }
    returnMsg.textContent = 'Here are your rentals:';
    rentals.forEach((r) => {
      const btn = el('button', { class: 'btn btn-red', type: 'button', text: 'Return' });
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const data = await api('/api/returns', { method: 'POST', body: JSON.stringify({ phone, bike_id: r.bike_id }) });
          showToast(data.message);
          await lookup(phone);
          loadBikes();
        } catch (err) {
          returnMsg.textContent = err.message;
          btn.disabled = false;
        }
      });
      rentalsList.append(
        el('li', {},
          el('img', { src: `images/${encodeURIComponent(r.image || 'road-white.jpg')}`, alt: '' }),
          el('div', { class: 'info' }, el('strong', { text: r.name || `${r.type} bike` }), el('span', { text: `${r.type} bike, ${r.size}" wheels` })),
          btn
        )
      );
    });
  }

  if (lookupForm) {
    lookupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await lookup($('return-phone').value);
      } catch (err) {
        returnMsg.textContent = err.message;
      }
    });
  }

  loadBikes();
});