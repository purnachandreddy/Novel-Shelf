const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rawHtml = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const cleanHtml = rawHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
const buildInfoJs = fs.readFileSync(path.resolve(__dirname, '../build-info.js'), 'utf8');
const statsCalcJs = fs.readFileSync(path.resolve(__dirname, '../stats-calculator.js'), 'utf8');
const sheetJs = fs.readFileSync(path.resolve(__dirname, '../sheet.js'), 'utf8');
const js = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../style.css'), 'utf8');

function createDom(initialStorage = {}) {
  const dom = new JSDOM(cleanHtml, {
    url: 'https://appassets.androidplatform.net/assets/www/index.html',
    runScripts: 'dangerously'
  });

  const { window } = dom;

  // Inject CSS stylesheet into DOM head for computed style assertions
  const styleEl = window.document.createElement('style');
  styleEl.textContent = css;
  window.document.head.appendChild(styleEl);

  // Set initial storage items in standard localStorage before executing app.js
  if (initialStorage) {
    Object.entries(initialStorage).forEach(([k, v]) => {
      window.localStorage.setItem(k, String(v));
    });
  }

  // Mock scroll methods
  window.HTMLElement.prototype.scrollIntoView = function() {};
  window.HTMLElement.prototype.scrollTo = function() {};
  window.scrollTo = function() {};
  window.requestAnimationFrame = function(cb) { return setTimeout(cb, 0); };
  window.cancelAnimationFrame = function(id) { clearTimeout(id); };

  // Mock history navigation for JSDOM
  const historyStack = [];
  const origPushState = window.history.pushState.bind(window.history);
  window.history.pushState = function(state, unused, url) {
    historyStack.push(state);
    origPushState(state, unused, url);
  };
  window.history.back = function() {
    historyStack.pop();
    const prevState = historyStack[historyStack.length - 1] || null;
    origPushState(prevState, '', '');
    window.dispatchEvent(new window.PopStateEvent('popstate', { state: prevState }));
  };

  // Evaluate scripts in order
  window.eval(buildInfoJs);
  window.eval(statsCalcJs);
  window.eval(sheetJs);
  window.eval(js);
  return { dom, window };
}

async function runTests() {
  const results = [];

  async function test(id, desc, fn) {
    try {
      await fn();
      results.push({ id, desc, status: 'PASS' });
      console.log(`[PASS] ${id}: ${desc}`);
    } catch (e) {
      results.push({ id, desc, status: 'FAIL', error: e.message });
      console.error(`[FAIL] ${id}: ${desc}\n  ${e.stack || e.message}`);
    }
  }

  console.log('--- Running Tests ---');

  // A1: Edit-from-details navigation desync
  await test('A1', 'Edit-from-details returns to details showing updated data and restores navigation', () => {
    const { window } = createDom();
    const doc = window.document;

    // Load sample data first
    doc.getElementById('btn-load-sample').click();
    assert.strictEqual(doc.querySelectorAll('.novel-card').length, 5);

    // Click first card to view details
    const firstCard = doc.querySelector('.novel-card');
    firstCard.click();
    assert.strictEqual(doc.getElementById('view-novel-details').style.display, 'flex');
    assert.strictEqual(doc.getElementById('view-shelf').style.display, 'none');

    // Click Edit from details
    doc.getElementById('btn-detail-edit').click();
    assert.strictEqual(doc.getElementById('modal-novel-form').style.display, 'flex');
    assert.strictEqual(doc.getElementById('view-novel-details').style.display, 'none');

    // Change title and save
    doc.getElementById('form-title').value = 'Updated Novel Title';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true }));

    // Should return to details (display 'flex'), shelf remains hidden
    assert.strictEqual(doc.getElementById('modal-novel-form').style.display, 'none');
    assert.strictEqual(doc.getElementById('view-novel-details').style.display, 'flex');
    assert.strictEqual(doc.getElementById('view-shelf').style.display, 'none');
    assert.strictEqual(doc.getElementById('detail-header-title').textContent, 'Updated Novel Title');

    // Close details returns to shelf
    doc.getElementById('btn-back-shelf').click();
    assert.strictEqual(doc.getElementById('view-novel-details').style.display, 'none');
    assert.strictEqual(doc.getElementById('view-shelf').style.display, '');
  });

  // A3: HTML injection via imported dates
  await test('A3', 'normalizeImportedNovel strips HTML injection in dates and renderNovelDetailsContent escapes dates', () => {
    const badNovel = {
      id: 'bad_1',
      title: 'XSS Test',
      started: '<img src=x onerror=alert(1)>',
      finished: '"><script>alert(2)</script>',
      status: 'Reading'
    };
    const { window } = createDom({ 'novelshelf_library_v1': JSON.stringify([badNovel]) });
    const doc = window.document;

    // Click card
    const card = doc.querySelector('.novel-card');
    assert.ok(card, 'Card should render');
    card.click();

    // Verify dates container does not contain injected tags
    const datesEl = doc.querySelector('.meta-item:nth-child(2) .meta-item-value');
    assert.ok(datesEl, 'Dates element should exist');
    assert.ok(!datesEl.innerHTML.includes('<img'), 'Should not contain <img> tag');
    assert.ok(!datesEl.innerHTML.includes('<script>'), 'Should not contain <script> tag');
  });

  // A4: Failed saves must not report success & rollback
  await test('A4', 'Failed save rolls back mutation and shows error toast', () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-load-sample').click();

    // Force Storage.prototype.setItem to throw
    const origSetItem = window.Storage.prototype.setItem;
    window.Storage.prototype.setItem = function() { throw new Error('QuotaExceeded'); };

    // Try to add a novel
    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'Should Fail Novel';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true }));

    // Must have rolled back in memory and not rendered new novel
    const toasts = Array.from(doc.querySelectorAll('.toast'));
    const hasStorageToast = toasts.some(t => t.textContent.includes('Storage limit'));
    assert.ok(hasStorageToast, 'Must display storage error toast');

    const hasSuccessToast = toasts.some(t => t.textContent.includes('Added "Should Fail Novel"'));
    assert.ok(!hasSuccessToast, 'Must NOT show success toast on save failure');

    // Restore setItem
    window.Storage.prototype.setItem = origSetItem;
  });

  // A5: Corrupt storage bricks the app
  await test('A5', 'Corrupt localStorage loads safely into empty shelf', () => {
    ['null', '{}', '"abc"', '42', '{"broken":true}'].forEach(badVal => {
      const { window } = createDom({
        'novelshelf_library_v1': badVal,
        'novelshelf_view_mode': 'invalid_mode'
      });
      const doc = window.document;
      assert.strictEqual(doc.getElementById('empty-state').style.display, 'flex');
      assert.strictEqual(doc.querySelectorAll('.novel-card').length, 0);
    });
  });

  // A6: Merge import local progress wins & deduplication
  await test('A6', 'Merge import preserves local progress on id collision and reports accurate added count', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Load sample data
    doc.getElementById('btn-load-sample').click();
    const firstNovelId = 'novel_sample_1';

    // Increment progress locally on sample 1
    const firstCard = doc.querySelector(`[data-id="${firstNovelId}"]`);
    const quickAddBtn = firstCard.querySelector('[data-action="quick-add"]');
    quickAddBtn.click(); // read = 561

    // Simulate import containing novel_sample_1 with old chaptersRead=560 and a new novel
    const fileData = {
      novels: [
        { id: firstNovelId, title: 'Lord of the Mysteries', chaptersRead: 100, status: 'Reading' },
        { id: 'new_novel_99', title: 'New Imported Novel', chaptersRead: 10, status: 'Reading' }
      ]
    };

    const input = doc.getElementById('import-json-file');
    // Mock FileReader to execute onload synchronously
    window.FileReader = class {
      readAsText() {
        this.onload({ target: { result: JSON.stringify(fileData) } });
      }
    };

    const file = new window.File([JSON.stringify(fileData)], 'backup.json');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new window.Event('change'));

    // Wait microtask for showImportChoiceDialog promise
    await new Promise(r => setTimeout(r, 20));

    // Choice dialog pops up - click Merge
    const mergeBtn = doc.querySelector('.confirm-buttons button.btn-secondary:nth-child(2)');
    assert.ok(mergeBtn && mergeBtn.textContent === 'Merge', 'Merge button should exist');
    mergeBtn.click();

    await new Promise(r => setTimeout(r, 20));

    // Verify local progress won on first novel: chaptersRead should remain 561 (not 100)
    const card1 = doc.querySelector(`[data-id="${firstNovelId}"]`);
    assert.ok(card1.querySelector('.progress-info').textContent.includes('Ch. 561'), 'Local chaptersRead must win');

    // Verify new novel was added
    assert.ok(doc.querySelector('[data-id="new_novel_99"]'), 'New novel should be added');

    // Verify toast message "Merged: 1 new novels added"
    const toasts = Array.from(doc.querySelectorAll('.toast'));
    assert.ok(toasts.some(t => t.textContent.includes('Merged: 1 new novels added')), 'Toast should report 1 new novel added');
  });

  // A7: Quick +1 in-place DOM update (suppress resort)
  await test('A7', 'Quick +1 updates DOM in-place without re-sorting list under finger', () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-load-sample').click();
    const cardsBefore = Array.from(doc.querySelectorAll('.novel-card')).map(c => c.dataset.id);

    // Increment an active card
    const cardWithBtn = Array.from(doc.querySelectorAll('.novel-card')).find(c => c.querySelector('[data-action="quick-add"]'));
    assert.ok(cardWithBtn, 'Active card with quick-add button should exist');
    const btn = cardWithBtn.querySelector('[data-action="quick-add"]');
    btn.click();

    const cardsAfter = Array.from(doc.querySelectorAll('.novel-card')).map(c => c.dataset.id);
    assert.deepStrictEqual(cardsBefore, cardsAfter, 'Card order must not change after quick +1');
  });

  // A8: Genre filter goes stale
  await test('A8', 'Genre dropdown de-duplicates case-insensitively and resets to ALL if genre removed', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-load-sample').click();
    const genreFilter = doc.getElementById('genre-filter');

    // Select 'LitRPG'
    genreFilter.value = 'LitRPG';
    genreFilter.dispatchEvent(new window.Event('change'));
    assert.strictEqual(genreFilter.value, 'LitRPG');

    // Delete the only LitRPG novel ('Omniscient Reader\'s Viewpoint')
    const orvCard = doc.querySelector('[data-id="novel_sample_2"]');
    orvCard.click();
    doc.getElementById('btn-detail-delete').click();

    // Wait for showConfirm promise
    await new Promise(r => setTimeout(r, 20));

    // Confirm delete
    doc.getElementById('btn-confirm-yes').click();

    await new Promise(r => setTimeout(r, 20));

    // After deletion, genreFilter should reset to ALL
    assert.strictEqual(genreFilter.value, 'ALL', 'Genre filter must reset to ALL when genre disappears');
  });

  // A10: Chapter validation
  await test('A10', 'Chapter validation clamps read <= total and auto-fills completion date', () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'Validation Test Novel';
    doc.getElementById('form-chapters-read').value = '150';
    doc.getElementById('form-chapters-total').value = '100';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true }));

    // Click created novel
    const card = doc.querySelector('.novel-card');
    assert.ok(card.textContent.includes('Ch. 100 / 100'), 'Chapters read must be clamped to total');
  });

  // A11: Keyboard Enter on +1 Ch button
  await test('A11', 'Enter key on child button does not trigger card click details open', () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-load-sample').click();
    const firstCard = doc.querySelector('.novel-card');
    const quickAddBtn = firstCard.querySelector('[data-action="quick-add"]');

    // Dispatch Enter on the button
    const enterEvent = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    quickAddBtn.dispatchEvent(enterEvent);

    // Detail view should NOT open
    assert.strictEqual(doc.getElementById('view-novel-details').style.display, 'none');
  });

  // A12: Link and Cover URL normalization
  await test('A12', 'normalizeUrl prepends https:// and rejects invalid schemes', () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'URL Test Novel';
    doc.getElementById('form-link').value = 'example.com/novel';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true }));

    const card = doc.querySelector('.novel-card');
    card.click();

    const readBtn = doc.querySelector('.detail-read-btn');
    assert.ok(readBtn, 'Read button should be present for normalized URL');
    assert.strictEqual(readBtn.getAttribute('href'), 'https://example.com/novel');
  });

  // A13: Already at last chapter guard & On Hold -> Reading
  await test('A13', 'incrementChapter guards against incrementing past total and switches On Hold to Reading', () => {
    const { window } = createDom();
    const doc = window.document;

    // Load sample data (novel_sample_5 is On Hold, 420/500)
    doc.getElementById('btn-load-sample').click();
    const card5 = doc.querySelector('[data-id="novel_sample_5"]');
    assert.ok(card5.textContent.includes('On Hold'));

    // Increment 1 ch
    card5.querySelector('[data-action="quick-add"]').click();
    assert.ok(card5.textContent.includes('Reading'), 'Status must switch from On Hold to Reading');
    assert.ok(card5.textContent.includes('Ch. 421 / 500'));
  });

  // A14: Dialog Accessibility (inert background, aria-modal, role="dialog", focus restore)
  await test('A14', 'Dialogs set role="dialog", aria-modal, inert background, and restore focus on close', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Load sample to have cards
    doc.getElementById('btn-load-sample').click();
    const appEl = doc.getElementById('app');
    const navEl = doc.getElementById('floating-bottom-nav');
    const formModal = doc.getElementById('modal-novel-form');
    const confirmModal = doc.getElementById('confirm-dialog');

    // 1. Verify attributes on dialogs
    assert.strictEqual(formModal.getAttribute('role'), 'dialog');
    assert.strictEqual(formModal.getAttribute('aria-modal'), 'true');
    assert.strictEqual(confirmModal.getAttribute('role'), 'dialog');
    assert.strictEqual(confirmModal.getAttribute('aria-modal'), 'true');

    // 2. Open form from shelf Add button
    const addBtn = doc.getElementById('btn-add-novel-top');
    addBtn.focus();
    addBtn.click();

    // Check background view screens & nav are inert and aria-hidden
    assert.strictEqual(doc.getElementById('view-shelf').inert, true);
    assert.strictEqual(doc.getElementById('view-shelf').getAttribute('aria-hidden'), 'true');
    assert.strictEqual(navEl.inert, true);
    assert.strictEqual(navEl.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(formModal.inert, false);

    // Close form
    doc.getElementById('btn-close-form').click();
    assert.strictEqual(doc.getElementById('view-shelf').inert, false);
    assert.strictEqual(doc.getElementById('view-shelf').getAttribute('aria-hidden'), null);
    assert.strictEqual(navEl.inert, false);
    assert.strictEqual(doc.activeElement, addBtn, 'Focus should be restored to add button');

    // 3. Confirm dialog
    const card = doc.querySelector('.novel-card');
    card.click();
    const deleteBtn = doc.getElementById('btn-detail-delete');
    deleteBtn.focus();
    deleteBtn.click(); // Triggers showConfirm()

    await new Promise(r => setTimeout(r, 20));

    // Confirm dialog is open
    assert.strictEqual(confirmModal.style.display, 'flex');
    assert.strictEqual(appEl.inert, true);
    assert.strictEqual(appEl.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(navEl.inert, true);
    assert.strictEqual(doc.activeElement, doc.getElementById('btn-confirm-no'), 'Focus should move inside dialog to Cancel button');

    // Cancel confirm
    doc.getElementById('btn-confirm-no').click();
    await new Promise(r => setTimeout(r, 20));

    assert.strictEqual(confirmModal.style.display, 'none');
    assert.strictEqual(appEl.inert, false);
    assert.strictEqual(appEl.getAttribute('aria-hidden'), null);
    assert.strictEqual(doc.activeElement, deleteBtn, 'Focus should be restored to delete button');
  });

  // A15: Glass Bottom-Sheet & Custom Select
  await test('A15', 'Custom select opens glass bottom sheet, shows options, updates native select on choice, and closes via back handler with focus restored', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Load sample library to populate genres
    doc.getElementById('btn-load-sample').click();

    const sortSelect = doc.getElementById('sort-filter');
    const genreSelect = doc.getElementById('genre-filter');
    const sortBtn = doc.querySelector('.custom-select-btn[data-target="sort-filter"]');
    const genreBtn = doc.querySelector('.custom-select-btn[data-target="genre-filter"]');

    assert.ok(sortBtn, 'Custom select button for sort-filter should exist');
    assert.ok(genreBtn, 'Custom select button for genre-filter should exist');
    assert.ok(sortSelect.classList.contains('sr-only-select'), 'Native sort-filter should have sr-only-select class');
    assert.ok(genreSelect.classList.contains('sr-only-select'), 'Native genre-filter should have sr-only-select class');

    // 1. Open sort sheet via custom button, verifying active input is blurred first
    const searchInput = doc.getElementById('search-input');
    searchInput.focus();
    assert.strictEqual(doc.activeElement, searchInput, 'Search input should initially be focused');

    sortBtn.click();
    assert.notStrictEqual(doc.activeElement, searchInput, 'Active input must be blurred before popup opens');

    const sheetContainer = doc.getElementById('glass-sheet-container');
    const sheetEl = doc.getElementById('glass-sheet');
    const appEl = doc.getElementById('app');
    const navEl = doc.getElementById('floating-bottom-nav');

    assert.ok(window.BottomSheet.isOpen(), 'BottomSheet should be open');
    assert.strictEqual(sheetContainer.style.display, 'grid');
    assert.ok(sheetContainer.classList.contains('glass-popup-container'));
    assert.ok(sheetEl.classList.contains('glass-popup-card'));
    assert.strictEqual(sheetEl.getAttribute('role'), 'dialog');
    assert.strictEqual(sheetEl.getAttribute('aria-modal'), 'true');
    assert.strictEqual(appEl.inert, true, 'App should be inert while sheet is open');
    assert.strictEqual(appEl.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(navEl.inert, true, 'Nav should be inert while sheet is open');

    // Verify all 5 sort options are rendered and 'updated-desc' is selected
    const optionRows = doc.querySelectorAll('.sheet-option-row');
    assert.strictEqual(optionRows.length, 5, 'Should render 5 sort option rows');
    const selectedRow = doc.querySelector('.sheet-option-row.selected');
    assert.ok(selectedRow, 'Should have a selected row');
    assert.strictEqual(selectedRow.dataset.value, 'updated-desc');
    assert.strictEqual(selectedRow.getAttribute('aria-selected'), 'true');

    // 2. Choose 'Highest Rated' (rating-desc)
    let changeFired = false;
    sortSelect.addEventListener('change', () => { changeFired = true; });

    const ratingRow = doc.querySelector('.sheet-option-row[data-value="rating-desc"]');
    ratingRow.click();

    assert.strictEqual(sortSelect.value, 'rating-desc', 'Native select value should be updated');
    assert.ok(changeFired, 'Native change event should fire on selection');
    assert.strictEqual(sortBtn.querySelector('.custom-select-label').textContent, 'Highest Rated');

    // Wait for auto-close timeout (120ms + 260ms animation)
    await new Promise(r => setTimeout(r, 450));

    assert.strictEqual(window.BottomSheet.isOpen(), false, 'BottomSheet should close after selection');
    assert.strictEqual(appEl.inert, false, 'App should no longer be inert');
    assert.strictEqual(doc.activeElement, sortBtn, 'Focus should be restored to sort button');

    // 3. Test closing via Back handler
    genreBtn.focus();
    genreBtn.click();
    assert.ok(window.BottomSheet.isOpen(), 'BottomSheet should open for genre-filter');
    assert.strictEqual(appEl.inert, true);

    // Call window.handleAppBack()
    const handled = window.handleAppBack();
    assert.strictEqual(handled, true, 'handleAppBack should handle and close sheet');

    // Wait for close animation
    await new Promise(r => setTimeout(r, 350));
    assert.strictEqual(window.BottomSheet.isOpen(), false, 'Sheet should be closed by back handler');
    assert.strictEqual(appEl.inert, false, 'App inert should be cleared');
    assert.strictEqual(doc.activeElement, genreBtn, 'Focus should return to genre button');
  });

  // A16: Glass Date Picker — Selection and Clear
  await test('A16', 'Glass date picker selects date, updates hidden input, fires change event, and clear button empties it', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Open novel form
    doc.getElementById('btn-add-novel-top').click();

    const startedInput = doc.getElementById('form-started');
    const startedBtn = doc.querySelector('.custom-date-btn[data-target="form-started"]');
    assert.ok(startedBtn, 'Custom date button for form-started should exist');
    assert.ok(startedInput.classList.contains('sr-only-input'), 'Native input should have sr-only-input');

    // Click custom date button to open calendar bottom sheet
    startedBtn.click();
    assert.ok(window.BottomSheet.isOpen(), 'BottomSheet should open for date picker');

    const calWrap = doc.querySelector('.glass-calendar-wrap');
    assert.ok(calWrap, 'Calendar container should exist in sheet');

    // Pick a day cell from current month
    const dayBtn = calWrap.querySelector('.calendar-day:not(.outside-month)');
    assert.ok(dayBtn, 'Day cell should exist');
    dayBtn.click();

    // Find selected day and confirm Set button
    const setBtn = calWrap.querySelector('.btn-set');
    assert.strictEqual(setBtn.disabled, false, 'Set button should be enabled');

    let changeFired = false;
    startedInput.addEventListener('change', () => { changeFired = true; });

    setBtn.click();
    await new Promise(r => setTimeout(r, 450)); // wait for sheet close

    assert.ok(startedInput.value.length > 0, 'Started input value should be set');
    assert.ok(changeFired, 'Change event should have fired');
    assert.notStrictEqual(startedBtn.querySelector('.custom-date-label').textContent, 'Select date');
    assert.strictEqual(window.BottomSheet.isOpen(), false, 'BottomSheet should be closed');

    // Now test Clear button
    startedBtn.click();
    assert.ok(window.BottomSheet.isOpen(), 'Sheet reopens');

    let clearChangeFired = false;
    startedInput.addEventListener('change', () => { clearChangeFired = true; });

    const clearBtn = doc.querySelector('.calendar-action-btn.btn-clear');
    clearBtn.click();
    await new Promise(r => setTimeout(r, 450));

    assert.strictEqual(startedInput.value, '', 'Input should be empty after clear');
    assert.ok(clearChangeFired, 'Change event should fire after clear');
    assert.strictEqual(startedBtn.querySelector('.custom-date-label').textContent, 'Select date');
    assert.strictEqual(window.BottomSheet.isOpen(), false, 'Sheet closes after clear');
  });

  // A17: Glass Date Picker — Leap year February 29 and Month-end navigation
  await test('A17', 'Glass date picker correctly handles leap year Feb 29 and month-end transitions', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    const startedBtn = doc.querySelector('.custom-date-btn[data-target="form-started"]');
    startedBtn.click();

    // Leap year date helper verification
    assert.strictEqual(new Date(2028, 2, 0).getDate(), 29, '2028 Feb has 29 days');
    assert.strictEqual(new Date(2027, 2, 0).getDate(), 28, '2027 Feb has 28 days');

    // Click month-year button to enter jump mode
    const monthYearBtn = doc.querySelector('.calendar-month-year-btn');
    monthYearBtn.click();

    const jumpGrid = doc.querySelector('.calendar-jump-grid');
    assert.ok(jumpGrid, 'Jump grid should appear');

    // Navigate to 2028
    const curYear = new Date().getFullYear();
    const yearDiff = 2028 - curYear;
    const prevBtn = doc.querySelector('.calendar-nav-btn[aria-label="Previous year"]');
    const nextBtn = doc.querySelector('.calendar-nav-btn[aria-label="Next year"]');
    for (let i = 0; i < Math.abs(yearDiff); i++) {
      if (yearDiff > 0) nextBtn.click();
      else prevBtn.click();
    }

    // Click February in 2028
    jumpGrid.querySelector('.calendar-month-card[data-month="2"]').click();

    // Verify 29th exists and is inside current month
    const day29 = doc.querySelector('.calendar-day[data-date="2028-02-29"]');
    assert.ok(day29, 'Feb 29 should exist in 2028');
    assert.strictEqual(day29.classList.contains('outside-month'), false, 'Feb 29 should be inside current month');

    // Also verify April has 30 days and no day 31
    monthYearBtn.click();
    doc.querySelector('.calendar-jump-grid .calendar-month-card[data-month="4"]').click();
    const apr30 = doc.querySelector('.calendar-day[data-date="2028-04-30"]');
    assert.ok(apr30, 'Apr 30 should exist');
    assert.strictEqual(apr30.classList.contains('outside-month'), false);
    const apr31 = doc.querySelector('.calendar-day[data-date="2028-04-31"]');
    assert.strictEqual(apr31, null, 'Apr 31 must not exist');

    window.BottomSheet.close();
    await new Promise(r => setTimeout(r, 450));
  });

  // A18: Glass Date Picker — Started after finished validation
  await test('A18', 'Glass date picker validates that finished date cannot be earlier than started date', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    const startedInput = doc.getElementById('form-started');
    const finishedInput = doc.getElementById('form-finished');
    const finishedBtn = doc.querySelector('.custom-date-btn[data-target="form-finished"]');

    // Set started to 2026-10-15
    startedInput.value = '2026-10-15';
    window.updateCustomDate(startedInput);

    // Open finished date picker
    finishedBtn.click();

    // Check that "Same as started" chip is present
    const chips = Array.from(doc.querySelectorAll('.calendar-chip'));
    const sameChip = chips.find(c => c.textContent.includes('Same as started'));
    assert.ok(sameChip, 'Same as started chip should exist when started is filled');

    // Jump to 2026-10
    const monthYearBtn = doc.querySelector('.calendar-month-year-btn');
    monthYearBtn.click();
    const curYear = new Date().getFullYear();
    const yearDiff = 2026 - curYear;
    const prevBtn = doc.querySelector('.calendar-nav-btn[aria-label="Previous year"]');
    const nextBtn = doc.querySelector('.calendar-nav-btn[aria-label="Next year"]');
    for (let i = 0; i < Math.abs(yearDiff); i++) {
      if (yearDiff > 0) nextBtn.click();
      else prevBtn.click();
    }
    const jumpGrid = doc.querySelector('.calendar-jump-grid');
    jumpGrid.querySelector('.calendar-month-card[data-month="10"]').click();

    // Verify 2026-10-10 (earlier than started date 2026-10-15) is disabled
    const day10 = doc.querySelector('.calendar-day[data-date="2026-10-10"]');
    assert.ok(day10, 'Day 10 should exist');
    assert.ok(day10.classList.contains('disabled'), 'Day 10 should be disabled since it is earlier than started date');
    assert.strictEqual(day10.getAttribute('aria-disabled'), 'true');

    // Click 'Same as started' chip
    const sameChipNow = Array.from(doc.querySelectorAll('.calendar-chip')).find(c => c.textContent.includes('Same as started'));
    assert.ok(sameChipNow, 'Same as started chip should be present in DOM');
    sameChipNow.click();

    const setBtnAfterSame = doc.querySelector('.calendar-action-btn.btn-set');
    assert.strictEqual(setBtnAfterSame.disabled, false, 'Set button should be enabled after picking same as started');

    // Pick 2026-10-20 (after started date) — should NOT be disabled
    const day20 = doc.querySelector('.calendar-day[data-date="2026-10-20"]');
    assert.ok(day20, 'Day 20 should exist');
    assert.strictEqual(day20.classList.contains('disabled'), false, 'Day 20 should be enabled');
    day20.click();
    const setBtnFinal = doc.querySelector('.calendar-action-btn.btn-set');
    assert.strictEqual(setBtnFinal.disabled, false);

    setBtnFinal.click();
    await new Promise(r => setTimeout(r, 450));
    assert.strictEqual(finishedInput.value, '2026-10-20');
  });

  // A19: Date format helper: parses and formats correctly across months/years
  await test('A19', 'formatDisplayDate parses and formats correctly across months, years, leap days', () => {
    const { window } = createDom();
    assert.strictEqual(window.formatDisplayDate('2026-11-17'), '17 Nov 2026');
    assert.strictEqual(window.formatDisplayDate('2028-02-29'), '29 Feb 2028');
    assert.strictEqual(window.formatDisplayDate('2024-01-01'), '1 Jan 2024');
    assert.strictEqual(window.formatDisplayDate('2025-12-31'), '31 Dec 2025');
    assert.strictEqual(window.formatDisplayDate(''), '');
    assert.strictEqual(window.formatDisplayDate(null), '');
  });

  // A20: Empty title validation shows error and does not save
  await test('A20', 'Empty title validation shows inline error, shakes input, and prevents saving', () => {
    const { window } = createDom();
    const doc = window.document;

    // Open novel form
    doc.getElementById('btn-add-novel-top').click();

    const form = doc.getElementById('novel-form');
    const titleInput = doc.getElementById('form-title');
    const titleError = doc.getElementById('form-title-error');

    titleInput.value = '   '; // empty/whitespace
    form.dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

    // Verify inline error is visible
    assert.strictEqual(titleError.style.display, 'block');
    assert.strictEqual(titleError.textContent, 'Title is required');
    assert.ok(titleInput.classList.contains('input-error'), 'Title input should have input-error class');
    assert.ok(titleInput.classList.contains('input-shake'), 'Title input should have input-shake class');

    // Verify no novel was saved to shelf
    const novelCards = doc.querySelectorAll('.novel-card');
    assert.strictEqual(novelCards.length, 0, 'No novel should be added on validation error');

    // Type a title and verify error disappears
    titleInput.value = 'Lord of the Mysteries';
    titleInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.strictEqual(titleError.style.display, 'none');
    assert.strictEqual(titleInput.classList.contains('input-error'), false);
  });

  // A21: Form layout — action bar in normal flow, scroll body separation, auto-grow notes
  await test('A21', 'Form layout places actions in normal flow and auto-grows notes textarea', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();

    const form = doc.getElementById('novel-form');
    const scrollBody = form.querySelector('.form-scroll-body');
    const actionsBottom = form.querySelector('.form-actions-bottom');

    assert.ok(scrollBody, 'Form must contain a .form-scroll-body container');
    assert.ok(actionsBottom, 'Form must contain a .form-actions-bottom container');
    assert.strictEqual(scrollBody.nextElementSibling, actionsBottom, 'Actions bar must be in normal flow directly following the scroll body');

    // Verify notes textarea auto-grow
    const notesArea = doc.getElementById('form-notes');
    assert.ok(notesArea, 'Notes textarea should exist');
    notesArea.value = 'A long note\nwith multiple\nlines of text\nthat should trigger\nauto-growing.';
    notesArea.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.ok(notesArea.style.height, 'Notes textarea height should be set on input');
  });

  // A22: Date picker — Future dates allowed, out-of-order resilience
  await test('A22', 'Date picker allows choosing future dates and handles existing out-of-order dates safely', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    const startedInput = doc.getElementById('form-started');
    const startedBtn = doc.querySelector('.custom-date-btn[data-target="form-started"]');

    // Future year selection (e.g. 2030-05-15)
    startedBtn.click();
    const monthYearBtn = doc.querySelector('.calendar-month-year-btn');
    monthYearBtn.click();
    const curYear = new Date().getFullYear();
    const nextBtn = doc.querySelector('.calendar-nav-btn[aria-label="Next year"]');
    for (let i = 0; i < (2030 - curYear); i++) nextBtn.click();
    doc.querySelector('.calendar-jump-grid .calendar-month-card[data-month="5"]').click();

    const futureDay = doc.querySelector('.calendar-day[data-date="2030-05-15"]');
    assert.ok(futureDay, '2030-05-15 should exist');
    assert.strictEqual(futureDay.classList.contains('disabled'), false, 'Future date should NOT be disabled by default');
    futureDay.click();

    const setBtn = doc.querySelector('.calendar-action-btn.btn-set');
    assert.strictEqual(setBtn.disabled, false, 'Set button should be enabled for future date');
    setBtn.click();
    await new Promise(r => setTimeout(r, 450));
    assert.strictEqual(startedInput.value, '2030-05-15');

    // Out-of-order pre-existing values: Started 2030-05-15, set Finished to 2029-01-01
    const finishedInput = doc.getElementById('form-finished');
    const finishedBtn = doc.querySelector('.custom-date-btn[data-target="form-finished"]');
    finishedInput.value = '2029-01-01';
    window.updateCustomDate(finishedInput);

    // Open Finished picker with out-of-order date: should not throw, should show Set enabled
    finishedBtn.click();
    assert.ok(window.BottomSheet.isOpen(), 'Picker should open safely even with out-of-order dates');
    const setBtn2 = doc.querySelector('.calendar-action-btn.btn-set');
    assert.strictEqual(setBtn2.disabled, false, 'Set button should remain enabled');
    window.BottomSheet.close();
    await new Promise(r => setTimeout(r, 450));
  });

  // A23: Labels, dialogs, toasts and undo for deletes
  await test('A23', 'Labels, confirm dialog structure, and delete undo restore original state', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Add a novel without rating
    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'Reverend Insanity';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

    // Check shelf card unrated badge
    const card = doc.querySelector('.novel-card');
    assert.ok(card, 'Novel card should exist');
    const unratedShelf = card.querySelector('.rating-unrated');
    assert.ok(unratedShelf, 'Unrated shelf badge should have rating-unrated class');
    assert.strictEqual(unratedShelf.textContent, 'Not rated');

    // Click card to open details
    card.click();
    const unratedDetail = doc.querySelector('.detail-unrated');
    assert.ok(unratedDetail, 'Detail screen should have detail-unrated class');
    assert.strictEqual(unratedDetail.textContent, 'Not rated');

    // Trigger delete
    doc.getElementById('btn-detail-delete').click();
    const confirmDialog = doc.getElementById('confirm-dialog');
    assert.strictEqual(confirmDialog.style.display, 'flex');
    assert.strictEqual(doc.getElementById('confirm-title').textContent, 'Delete novel?');
    assert.ok(doc.getElementById('confirm-message').textContent.includes('Reverend Insanity'));

    // Confirm deletion
    doc.getElementById('btn-confirm-yes').click();
    await new Promise(r => setTimeout(r, 50));

    // Verify novel removed from shelf
    assert.strictEqual(doc.querySelectorAll('.novel-card').length, 0, 'Novel should be deleted from shelf');

    // Check toast with Undo button
    const toast = doc.querySelector('.toast-undo') || doc.querySelector('.toast:last-child');
    assert.ok(toast, 'Toast notification should be displayed');
    const undoBtn = toast.querySelector('.toast-action-btn');
    assert.ok(undoBtn, 'Toast should contain an Undo button');
    assert.strictEqual(undoBtn.textContent, 'Undo');

    // Click Undo
    undoBtn.click();
    await new Promise(r => setTimeout(r, 50));

    // Verify novel is restored
    const restoredCards = doc.querySelectorAll('.novel-card');
    assert.strictEqual(restoredCards.length, 1, 'Novel should be restored by Undo');
    assert.ok(restoredCards[0].textContent.includes('Reverend Insanity'));
  });

  // A24: Shelf quick-action "+1 Ch" hidden on completed novels
  await test('A24', 'Quick +1 Ch action is hidden on Completed novels and visible on active ones', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Add a Reading novel
    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'Active Reading Novel';
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

    // Add a Completed novel
    doc.getElementById('btn-add-novel-top').click();
    doc.getElementById('form-title').value = 'Finished Story';
    doc.querySelector('.status-pill-btn[data-status="Completed"]').click();
    doc.getElementById('novel-form').dispatchEvent(new window.Event('submit', { cancelable: true, bubbles: true }));

    const cards = Array.from(doc.querySelectorAll('.novel-card'));
    const readingCard = cards.find(c => c.textContent.includes('Active Reading Novel'));
    const completedCard = cards.find(c => c.textContent.includes('Finished Story'));

    assert.ok(readingCard, 'Reading card should exist');
    assert.ok(completedCard, 'Completed card should exist');

    const readingPlusBtn = readingCard.querySelector('[data-action="quick-add"]');
    const completedPlusBtn = completedCard.querySelector('[data-action="quick-add"]');

    assert.ok(readingPlusBtn, 'Reading novel should have +1 Ch button');
    assert.strictEqual(completedPlusBtn, null, 'Completed novel must NOT have +1 Ch button');
  });

  // A25: Form Enter key does not submit, tag preview chips render and delete, genre pills sync
  await test('A25', 'Form input navigation, live tag preview chips, and genre chip sync', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    const novelForm = doc.getElementById('novel-form');
    const formTitle = doc.getElementById('form-title');
    const formTags = doc.getElementById('form-tags');
    const tagsContainer = doc.getElementById('tags-preview-container');

    // 1. Enter key on title does not submit form
    formTitle.value = 'Test Novel';
    let submitFired = false;
    novelForm.addEventListener('submit', () => { submitFired = true; }, { once: true });
    
    const enterEvt = new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true });
    formTitle.dispatchEvent(enterEvt);
    assert.strictEqual(enterEvt.defaultPrevented, true, 'Enter key on single-line input must prevent form submit');
    assert.strictEqual(submitFired, false, 'Form submit must not fire on Enter');

    // 2. Tags preview chips
    formTags.value = 'fantasy, litrpg, slow burn';
    formTags.dispatchEvent(new window.Event('input', { bubbles: true }));
    
    assert.strictEqual(tagsContainer.style.display, 'flex');
    const chips = tagsContainer.querySelectorAll('.tag-preview-chip');
    assert.strictEqual(chips.length, 3, 'Should render 3 tag chips');
    assert.strictEqual(chips[0].querySelector('.tag-chip-text').textContent, 'fantasy');
    assert.strictEqual(chips[1].querySelector('.tag-chip-text').textContent, 'litrpg');
    assert.strictEqual(chips[2].querySelector('.tag-chip-text').textContent, 'slow burn');

    // 3. Remove second tag chip ('litrpg')
    const removeBtn = chips[1].querySelector('.tag-chip-remove');
    removeBtn.click();
    assert.strictEqual(formTags.value, 'fantasy, slow burn');
    const updatedChips = tagsContainer.querySelectorAll('.tag-preview-chip');
    assert.strictEqual(updatedChips.length, 2, 'Should have 2 tag chips left');
    assert.strictEqual(updatedChips[1].querySelector('.tag-chip-text').textContent, 'slow burn');

    // 4. Genre chip sync
    const formGenre = doc.getElementById('form-genre');
    const sciFiPill = doc.querySelector('.pill-btn[data-genre="Sci-Fi"]');
    assert.ok(sciFiPill, 'Sci-Fi genre pill should exist');
    sciFiPill.click();
    assert.strictEqual(formGenre.value, 'Sci-Fi');
    assert.strictEqual(sciFiPill.classList.contains('active'), true);
  });

  // A26: Keyboard inset mechanism --kb applies only while text-entry element is focused, and resets to 0 on focusout
  await test('A26', 'Keyboard inset --kb applies only while text-entry element is focused, and resets to 0 on focusout', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Set initial system insets
    window.setSystemInsets(40, 24, 0, 0);
    assert.strictEqual(doc.documentElement.style.getPropertyValue('--inset-bottom'), '24px');
    assert.strictEqual(doc.documentElement.style.getPropertyValue('--kb'), '0px');

    // 1. Open form
    doc.getElementById('btn-add-novel-top').click();
    const formModal = doc.getElementById('modal-novel-form');
    assert.strictEqual(formModal.style.display, 'flex');

    const formTitle = doc.getElementById('form-title');

    // 2. Focus input and call setKeyboardInset with positive value (e.g. 320)
    formTitle.focus();
    formTitle.dispatchEvent(new window.Event('focusin', { bubbles: true }));
    window.setKeyboardInset(320);

    // Rule 1: --kb is 320px while text-entry element has focus
    assert.strictEqual(doc.documentElement.style.getPropertyValue('--kb'), '320px', '--kb must equal 320px when input focused');
    // Rule 4: --inset-bottom is 0 while --kb > 0
    assert.strictEqual(doc.documentElement.style.getPropertyValue('--inset-bottom'), '0px', '--inset-bottom must be 0 while --kb > 0');

    // Rule 3: On focusout, after 120ms, if no text element has focus, --kb is forced to 0 regardless of whether setKeyboardInset(0) was called
    formTitle.blur();
    formTitle.dispatchEvent(new window.Event('focusout', { bubbles: true }));

    // Wait for the 120ms debounce (within 200ms)
    await new Promise(resolve => setTimeout(resolve, 150));

    assert.strictEqual(doc.documentElement.style.getPropertyValue('--kb'), '0px', '--kb must reset to 0px on focusout even if native setKeyboardInset(0) was missed');
    assert.strictEqual(doc.documentElement.style.getPropertyValue('--inset-bottom'), '24px', '--inset-bottom must restore to system insets');
  });

  // A27: Unrated label exists with shared class in grid, list, and details, with uniform font-size smaller than title
  await test('A27', 'Unrated label has shared class across grid, list, and details views and is smaller than title', async () => {
    const unratedNovel = {
      id: 'test-unrated-1',
      title: 'Unrated Journey',
      author: 'Author Name',
      chaptersRead: 5,
      chaptersTotal: 100,
      status: 'Reading',
      rating: 0
    };
    const { window } = createDom({
      novelshelf_library_v1: JSON.stringify([unratedNovel])
    });
    const doc = window.document;

    // 1. Grid view
    const gridContainer = doc.getElementById('novels-container');
    const gridCard = gridContainer.querySelector(`.novel-card[data-id="${unratedNovel.id}"]`);
    assert.ok(gridCard, 'Grid card must exist');
    const gridUnrated = gridCard.querySelector('.novel-unrated-label, .rating-unrated');
    assert.ok(gridUnrated, 'Grid card must have unrated label with shared class');
    assert.ok(gridUnrated.classList.contains('novel-unrated-label') || gridUnrated.classList.contains('rating-unrated'));
    assert.strictEqual(gridUnrated.textContent.trim(), 'Not rated');

    // 2. List view
    doc.getElementById('view-list-btn').click();
    const listCard = gridContainer.querySelector(`.novel-card[data-id="${unratedNovel.id}"]`);
    assert.ok(listCard, 'List card must exist');
    const listUnrated = listCard.querySelector('.novel-unrated-label, .rating-unrated');
    assert.ok(listUnrated, 'List card must have unrated label with shared class');
    assert.strictEqual(listUnrated.textContent.trim(), 'Not rated');

    // 3. Details view
    listCard.click();
    const detailsView = doc.getElementById('view-novel-details');
    assert.strictEqual(detailsView.style.display, 'flex');
    const detailsUnrated = detailsView.querySelector('.novel-unrated-label, .rating-unrated');
    assert.ok(detailsUnrated, 'Details view must have unrated label with shared class');
    assert.strictEqual(detailsUnrated.textContent.trim(), 'Not rated');

    // Verify shared class presence
    assert.ok(gridUnrated.classList.contains('rating-unrated'));
    assert.ok(listUnrated.classList.contains('rating-unrated'));
    assert.ok(detailsUnrated.classList.contains('rating-unrated'));

    // Step 1: Font stack unifications and CSS source checks
    assert.match(css, /--font-main:[^;]*'Plus Jakarta Sans'/i, '--font-main must include Plus Jakarta Sans');
    assert.doesNotMatch(css, /--font-main:[^;]*'Nunito'/i, '--font-main must not contain Nunito');
    assert.doesNotMatch(css, /--font-main:[^;]*ui-rounded/i, '--font-main must not contain ui-rounded');
    assert.match(css, /\.rating-unrated[^{]*\{[^}]*font-family:\s*inherit/i, 'rating-unrated must inherit font');

    // Verify unrated font-size is smaller than author line in details
    const authorEl = detailsView.querySelector('.detail-author');
    if (window.getComputedStyle && authorEl && detailsUnrated) {
      const authorFs = parseFloat(window.getComputedStyle(authorEl).fontSize) || 0;
      const unratedFs = parseFloat(window.getComputedStyle(detailsUnrated).fontSize) || 0;
      if (authorFs > 0 && unratedFs > 0) {
        assert.ok(unratedFs <= authorFs, 'Unrated font-size must be smaller than or equal to author line');
      }
    }
  });

  // A28: Filter row, status tabs, search box, and cards list alignment
  await test('A28', 'Filter row, status tabs, search box, and cards container share identical gutter padding', async () => {
    const { window } = createDom();
    const doc = window.document;

    const appHeader = doc.querySelector('.app-header');
    const mainContent = doc.querySelector('.main-content');
    const shelfControls = doc.querySelector('.shelf-controls');

    assert.ok(appHeader, 'app-header must exist');
    assert.ok(mainContent, 'main-content must exist');
    assert.ok(shelfControls, 'shelf-controls must exist');
  });

  // A29: Currently Reading row structure (separate block elements for title and chapter)
  await test('A29', 'Stats Currently Reading rows have separate block elements for title and chapter line', async () => {
    const readingNovels = [
      {
        id: 'reading-1',
        title: 'Shadow Slave',
        author: 'Guiltythree',
        chaptersRead: 982,
        chaptersTotal: 2396,
        status: 'Reading',
        startedDate: '2026-01-01',
        lastUpdatedDate: '2026-11-18'
      },
      {
        id: 'reading-2',
        title: 'Lord of the Mysteries',
        author: 'Cuttlefish',
        chaptersRead: 450,
        chaptersTotal: 1432,
        status: 'Reading',
        startedDate: '2026-02-01',
        lastUpdatedDate: '2026-10-01'
      }
    ];
    const { window } = createDom({
      novelshelf_library_v1: JSON.stringify(readingNovels)
    });
    const doc = window.document;

    // Switch to stats view
    doc.getElementById('nav-tab-stats').click();
    const progressList = doc.getElementById('reading-progress-list');
    assert.ok(progressList, 'reading-progress-list must exist');

    const items = progressList.querySelectorAll('.reading-progress-item');
    assert.strictEqual(items.length, 2, 'Must render 2 currently reading items');

    items.forEach((item, idx) => {
      const titleEl = item.querySelector('.reading-item-title');
      const chEl = item.querySelector('.reading-item-ch');
      assert.ok(titleEl, `Item ${idx} must have separate .reading-item-title element`);
      assert.ok(chEl, `Item ${idx} must have separate .reading-item-ch element`);
      assert.notStrictEqual(titleEl.parentElement, chEl, 'Title must not be nested in chapter line');
      assert.notStrictEqual(chEl.parentElement, titleEl, 'Chapter line must not be nested in title');
      // They should be sibling elements in the left column
      assert.strictEqual(titleEl.parentElement, chEl.parentElement, 'Title and chapter must be sibling blocks in the left column');
    });
  });

  // A30: Status Breakdown and Rating Distribution use standard stats-section-card glass card component
  await test('A30', 'Status Breakdown and Rating Distribution sections use stats-section-card with icon and heading', async () => {
    const { window } = createDom();
    const doc = window.document;

    const statusSec = doc.getElementById('section-status-breakdown');
    const ratingSec = doc.getElementById('section-rating-distribution');

    assert.ok(statusSec, 'section-status-breakdown must exist');
    assert.ok(ratingSec, 'section-rating-distribution must exist');

    assert.ok(statusSec.classList.contains('stats-section-card'), 'Status breakdown must use stats-section-card class');
    assert.ok(ratingSec.classList.contains('stats-section-card'), 'Rating distribution must use stats-section-card class');

    assert.ok(statusSec.querySelector('.stats-card-heading svg'), 'Status breakdown must contain icon');
    assert.ok(statusSec.querySelector('.stats-card-heading h3'), 'Status breakdown must contain h3');
    assert.ok(ratingSec.querySelector('.stats-card-heading svg'), 'Rating distribution must contain icon');
    assert.ok(ratingSec.querySelector('.stats-card-heading h3'), 'Rating distribution must contain h3');
  });

  // A31: Details page centered badges, no +1/+5 on Completed, single mention of title in delete dialog
  await test('A31', 'Details page centered badge row, no +1/+5 on Completed, and single title mention in delete confirm', async () => {
    const testNovels = [
      {
        id: 'completed-novel-1',
        title: 'Lord of the Mysteries',
        author: 'Cuttlefish',
        chaptersRead: 1432,
        chaptersTotal: 1432,
        status: 'Completed',
        rating: 5.0
      },
      {
        id: 'unrated-reading-1',
        title: 'Omniscient Reader',
        author: 'Sing Shong',
        chaptersRead: 200,
        chaptersTotal: 551,
        status: 'Reading',
        rating: 0
      }
    ];

    const { window } = createDom({
      novelshelf_library_v1: JSON.stringify(testNovels)
    });
    const doc = window.document;

    // 1. Open completed novel details: assert no +1 / +5 buttons exist
    const completedCard = doc.querySelector(`.novel-card[data-id="completed-novel-1"]`);
    assert.ok(completedCard, 'Completed card must exist');
    completedCard.click();

    assert.strictEqual(doc.getElementById('btn-detail-add-1'), null, 'Completed novel must NOT have +1 Chapter button in details');
    assert.strictEqual(doc.getElementById('btn-detail-add-5'), null, 'Completed novel must NOT have +5 Chapters button in details');

    const badgeRow = doc.querySelector('.detail-badges-row');
    assert.ok(badgeRow, 'detail-badges-row must exist');

    // 2. Open delete confirm dialog: assert title is "Delete novel?" and title is mentioned only once in the message
    doc.getElementById('btn-detail-delete').click();
    const confirmTitle = doc.getElementById('confirm-title');
    const confirmMsg = doc.getElementById('confirm-message');

    assert.strictEqual(confirmTitle.textContent, 'Delete novel?');
    // Ensure title is mentioned, but duplicate "Delete ..." is not in message
    assert.ok(confirmMsg.textContent.includes('Lord of the Mysteries'));
    assert.ok(!confirmMsg.textContent.startsWith('Delete "Lord of the Mysteries"?'));
    assert.ok(confirmMsg.textContent.includes("This can't be undone."));

    // Cancel delete dialog and return
    doc.getElementById('btn-confirm-no').click();
    doc.getElementById('btn-back-shelf').click();

    // 3. Open unrated reading novel: assert badge row exists and has unrated label
    const unratedCard = doc.querySelector(`.novel-card[data-id="unrated-reading-1"]`);
    assert.ok(unratedCard, 'Unrated card must exist');
    unratedCard.click();

    const unratedBadgeRow = doc.querySelector('.detail-badges-row');
    assert.ok(unratedBadgeRow, 'Unrated detail-badges-row must exist');
    const unratedLabel = unratedBadgeRow.querySelector('.rating-unrated');
    assert.ok(unratedLabel, 'Unrated label must exist in badge row');
    assert.strictEqual(unratedLabel.textContent.trim(), 'Not rated');

    // On reading novel, +1 and +5 buttons must exist
    assert.ok(doc.getElementById('btn-detail-add-1'), 'Reading novel MUST have +1 Chapter button in details');
    assert.ok(doc.getElementById('btn-detail-add-5'), 'Reading novel MUST have +5 Chapters button in details');
  });

  // A32: Single solid background on html, screen wrappers grow with min-height, no viewport-tied wrapper heights
  await test('A32', 'Single solid page background on html, screen wrappers grow with min-height without viewport-tied height', async () => {
    const { window } = createDom();
    const doc = window.document;

    // Check style.css rules directly and via computed styles
    // 1. html has background: var(--surface-base)
    assert.match(css, /html\s*\{[^}]*background:\s*var\(--surface-base\)/i, 'html must specify background: var(--surface-base)');
    assert.match(css, /html\s*\{[^}]*min-height:\s*var\(--app-height,\s*100%\)/i, 'html must use min-height, not fixed height');
    assert.doesNotMatch(css, /html\s*\{[^}]*(?<!-)\bheight:\s*var\(--app-height/i, 'html must not have fixed viewport height');

    // 2. body has transparent background and min-height
    assert.match(css, /body\s*\{[^}]*background:\s*transparent/i, 'body must have transparent background');
    assert.doesNotMatch(css, /body\s*\{[^}]*(?<!-)\bheight:\s*var\(--app-height/i, 'body must not have fixed viewport height');

    // 3. .app-container has min-height and transparent background
    assert.match(css, /\.app-container\s*\{[^}]*min-height:\s*var\(--app-height,\s*100%\)/i, '.app-container must use min-height');
    assert.doesNotMatch(css, /\.app-container\s*\{[^}]*(?<!-)\bheight:\s*var\(--app-height/i, '.app-container must not have fixed viewport height');

    // 4. .details-page-view has min-height and transparent background
    assert.match(css, /\.details-page-view\s*\{[^}]*background:\s*transparent/i, '.details-page-view must have transparent background');
    assert.doesNotMatch(css, /\.details-page-view\s*\{[^}]*background:\s*var\(--surface-base\)\s*!important/i, '.details-page-view must not paint separate solid background');

    // 5. ambient-layer is fixed with inset 0 and height 100%
    assert.match(css, /\.ambient-layer\s*\{[^}]*position:\s*fixed/i, '.ambient-layer must be position: fixed');
    assert.match(css, /\.ambient-layer\s*\{[^}]*inset:\s*0/i, '.ambient-layer must have inset: 0');
  });

  // A33: Build stamp is rendered on the Backup screen
  await test('A33', 'Build stamp element exists on Backup screen and displays version, commit, and timestamp', async () => {
    const { window } = createDom();
    const doc = window.document;

    const buildStamp = doc.getElementById('backup-build-stamp');
    assert.ok(buildStamp, 'backup-build-stamp element must exist on Backup screen');
    assert.ok(buildStamp.classList.contains('backup-build-stamp'), 'Must have class backup-build-stamp');
    assert.match(buildStamp.textContent, /^v\d+\.\d+\.\d+\s*\(\d+\)/, 'Build stamp must display version and version code');
  });

  // A34: Form screen fills viewport with bottom tied to --kb and form-scroll-body has overflow-y: auto
  await test('A34', 'Form screen fills viewport with bottom tied to --kb and form-scroll-body has overflow-y: auto for internal scrolling', async () => {
    const { window } = createDom();
    const doc = window.document;

    doc.getElementById('btn-add-novel-top').click();
    const formModal = doc.getElementById('modal-novel-form');
    assert.strictEqual(formModal.style.display, 'flex');

    const scrollBody = formModal.querySelector('.form-scroll-body');
    assert.ok(scrollBody, 'Form scroll body must exist');

    assert.match(css, /\.form-page-view\s*\{[^}]*position:\s*fixed/i, '.form-page-view must use position: fixed');
    assert.match(css, /\.form-page-view\s*\{[^}]*bottom:\s*var\(--kb/i, '.form-page-view must have bottom: var(--kb, 0px)');
    assert.doesNotMatch(css, /\.form-page-view\s*\{[^}]*(?<!-)\bheight:\s*var/i, '.form-page-view must not derive height from --app-height');
    assert.match(css, /\.form-scroll-body[^{]*\{[^}]*overflow-y:\s*auto/i, '.form-scroll-body must have overflow-y: auto');
    assert.match(css, /\.form-scroll-body[^{]*\{[^}]*scroll-padding-bottom:\s*16px/i, '.form-scroll-body must have scroll-padding-bottom: 16px');
  });

  // A35: Form action bar stays docked at bottom without parent height dependency and form ends at --kb when open
  await test('A35', 'Form action bar stays docked at bottom without parent height dependency and form ends at --kb when open', async () => {
    const { window } = createDom();
    const doc = window.document;

    window.innerHeight = 892;
    window.setSystemInsets(40, 24, 0, 0);

    doc.getElementById('btn-add-novel-top').click();
    const formModal = doc.getElementById('modal-novel-form');
    assert.strictEqual(formModal.style.display, 'flex');

    const actionBar = formModal.querySelector('.form-actions-bottom');
    assert.ok(actionBar, 'Form action bar must exist');
    assert.match(css, /\.form-actions-bottom\s*\{[^}]*flex:\s*none/i, 'Action bar must have flex: none');
    assert.match(css, /\.form-actions-bottom\s*\{[^}]*position:\s*static/i, 'Action bar must have position: static');
    assert.match(css, /\.form-actions-bottom\s*\{[^}]*padding:[^;]*var\(--inset-bottom\)/i, 'Action bar must pad for bottom insets');

    // When --kb is 0, verify --kb is 0
    assert.strictEqual(doc.documentElement.style.getPropertyValue('--kb'), '0px');

    // Focus input and simulate keyboard
    const formTitle = doc.getElementById('form-title');
    formTitle.focus();
    formTitle.dispatchEvent(new window.Event('focusin', { bubbles: true }));
    window.setKeyboardInset(350);

    assert.strictEqual(doc.documentElement.style.getPropertyValue('--kb'), '350px');
  });

  // A36: Export to TXT includes summary header with status counts, serial numbers, and chapters read by total
  await test('A36', 'Export to TXT includes summary header with status counts, serial numbers, and chapters read / total', async () => {
    const { window } = createDom();
    const doc = window.document;

    const sampleNovels = [
      {
        id: 'n1',
        title: 'Shadow Slave',
        status: 'Reading',
        chaptersRead: 982,
        chaptersTotal: 1500,
        rating: 4.5,
        started: '2026-10-30',
        finished: null,
        notes: 'Great world building',
        author: 'Guiltythree',
        source: 'Webnovel',
        genre: 'Dark Fantasy',
        tags: ['Nightmare Spell', 'Sunny']
      },
      {
        id: 'n2',
        title: 'The Legendary Mechanic',
        status: 'On Hold',
        chaptersRead: 59,
        chaptersTotal: null,
        rating: 0,
        started: '2026-10-22',
        finished: null,
        notes: ''
      },
      {
        id: 'n3',
        title: 'Unscientific Beast Taming',
        status: 'Completed',
        chaptersRead: 1962,
        chaptersTotal: 1962,
        rating: 5,
        started: '2026-10-01',
        finished: '2026-10-23',
        notes: 'Balanced system'
      }
    ];

    const txt = window.generateLibraryTxt(sampleNovels);
    assert.ok(txt, 'Generated TXT should not be empty');

    // Check summary header counts
    assert.match(txt, /Total Novels:\s*3/, 'Must show Total Novels: 3');
    assert.match(txt, /Completed:\s*1/, 'Must show Completed: 1');
    assert.match(txt, /Reading \(Pending\):\s*1/, 'Must show Reading (Pending): 1');
    assert.match(txt, /On Hold \(Paused\):\s*1/, 'Must show On Hold (Paused): 1');

    // Check serial numbers
    assert.match(txt, /1\.\s*\[\s*Shadow Slave\s*\]/, 'Entry 1 must have serial number 1.');
    assert.match(txt, /2\.\s*\[\s*The Legendary Mechanic\s*\]/, 'Entry 2 must have serial number 2.');
    assert.match(txt, /3\.\s*\[\s*Unscientific Beast Taming\s*\]/, 'Entry 3 must have serial number 3.');

    // Check author, source, genre, tags details
    assert.match(txt, /Author:\s*Guiltythree\s*\|\s*Source:\s*Webnovel/, 'Must show author and source');
    assert.match(txt, /Genre:\s*Dark Fantasy\s*\|\s*Tags:\s*Nightmare Spell,\s*Sunny/, 'Must show genre and tags');
    assert.match(txt, /Author:\s*Unknown\s*\|\s*Source:\s*N\/A/, 'Must show fallback author and source when missing');
    assert.match(txt, /Genre:\s*N\/A\s*\|\s*Tags:\s*None/, 'Must show fallback genre and tags when missing');

    // Check chapters read by total
    assert.match(txt, /Ch:\s*982\s*\/\s*1500/, 'Must show chapters read / total when total exists');
    assert.match(txt, /Ch:\s*59\s*\/\s*\?/, 'Must show ? when total is unknown');
    assert.match(txt, /Ch:\s*1962\s*\/\s*1962/, 'Must show 1962 / 1962 for completed novel');
  });

  // A37: Grid cards have uniform row structure with pinned footer and non-overlapping placeholder cover
  await test('A37', 'Grid cards have uniform row structure with pinned footer and non-overlapping placeholder cover', async () => {
    const novels = [
      { id: 'g1', title: 'Rated with Genre', author: 'Author A', chaptersRead: 10, chaptersTotal: 50, rating: 4.5, genre: 'Fantasy', status: 'Reading' },
      { id: 'g2', title: 'Unrated no Genre', author: '', chaptersRead: 0, chaptersTotal: null, rating: 0, genre: '', status: 'Reading' }
    ];
    const { window } = createDom({
      novelshelf_library_v1: JSON.stringify(novels)
    });
    const doc = window.document;

    const card1 = doc.querySelector(`.novel-card[data-id="g1"]`);
    const card2 = doc.querySelector(`.novel-card[data-id="g2"]`);
    assert.ok(card1 && card2, 'Both grid cards must exist');

    // Both cards must contain identical row elements in order
    assert.ok(card1.querySelector('.card-cover-column'), 'Card 1 must have cover column');
    assert.ok(card2.querySelector('.card-cover-column'), 'Card 2 must have cover column');

    assert.ok(card1.querySelector('.card-title'), 'Card 1 must have card-title');
    assert.ok(card2.querySelector('.card-title'), 'Card 2 must have card-title');

    assert.ok(card1.querySelector('.card-author'), 'Card 1 must have card-author');
    assert.ok(card2.querySelector('.card-author'), 'Card 2 must have card-author');

    assert.ok(card1.querySelector('.card-rating-row'), 'Card 1 must have card-rating-row');
    assert.ok(card2.querySelector('.card-rating-row'), 'Card 2 must have card-rating-row');

    assert.ok(card1.querySelector('.card-genre-row'), 'Card 1 must have card-genre-row');
    assert.ok(card2.querySelector('.card-genre-row'), 'Card 2 must have card-genre-row');

    // Card 2 (empty genre) has genre-pill-empty placeholder so heights stay identical
    assert.ok(card2.querySelector('.card-genre-row .genre-pill-empty'), 'Card 2 must have empty genre pill placeholder');

    // Progress bar must always be rendered even at Ch. 0
    assert.ok(card1.querySelector('.card-progress-wrap .progress-track'), 'Card 1 must have progress track');
    assert.ok(card2.querySelector('.card-progress-wrap .progress-track'), 'Card 2 must have progress track even at Ch 0');

    // Footers must exist and be pinned
    const footer1 = card1.querySelector('.card-quick-actions');
    const footer2 = card2.querySelector('.card-quick-actions');
    assert.ok(footer1 && footer2, 'Both cards must have quick action footers');

    // CSS source assertion for pinned footer and card structure
    assert.match(css, /\.card-quick-actions\s*\{[^}]*margin-top:\s*auto/i, 'Footer must have margin-top: auto');
    assert.match(css, /\.novels-grid\s*\.card-title\s*\{[^}]*min-height/i, 'Grid title must reserve 2 lines');

    // Step 3: Placeholder cover clearance
    const placeholder2 = card2.querySelector('.cover-art-placeholder');
    assert.ok(placeholder2, 'Uncovered novel must render cover-art-placeholder');
    assert.ok(placeholder2.querySelector('.placeholder-badge-clearance'), 'Placeholder must have badge clearance space');
    // Empty author should not render placeholder-author element
    assert.strictEqual(placeholder2.querySelector('.placeholder-author'), null, 'Empty author should not render placeholder-author text');
  });

  // A38: Bottom clearance on main content, stats container, and backup container
  await test('A38', 'Bottom clearance uses --nav-clearance + 16px across shelf, stats, and backup', async () => {
    assert.match(css, /--nav-clearance:\s*calc\(96px\s*\+\s*var\(--inset-bottom\)\)/i, '--nav-clearance must include 96px base');
    assert.match(css, /\.main-content\s*\{[^}]*padding:[^;]*calc\(var\(--nav-clearance\)\s*\+\s*16px\)/i, '.main-content padding-bottom must use calc(var(--nav-clearance) + 16px)');
    assert.match(css, /\.stats-page-container,\s*\.backup-tab-container\s*\{[^}]*padding-bottom:\s*calc\(var\(--nav-clearance\)\s*\+\s*16px\)/i, 'Stats and backup containers must use calc(var(--nav-clearance) + 16px)');
  });

  // A39: Stats Currently Reading wording and completion chip with undo toast
  await test('A39', 'Currently Reading shows "Started today" for 0d, completion chip when read >= total, and undo works', async () => {
    const todayStr = (new Date()).toISOString().slice(0, 10);
    const novels = [
      {
        id: 'n_today',
        title: 'Started Today Novel',
        author: 'Author A',
        chaptersRead: 5,
        chaptersTotal: 100,
        status: 'Reading',
        started: todayStr
      },
      {
        id: 'n_finished_ch',
        title: 'Ready to Complete Novel',
        author: 'Author B',
        chaptersRead: 1962,
        chaptersTotal: 1962,
        status: 'Reading',
        started: '2026-01-01'
      }
    ];

    const { window } = createDom({
      novelshelf_library_v1: JSON.stringify(novels)
    });
    const doc = window.document;

    // Switch to Stats screen
    doc.getElementById('nav-tab-stats').click();
    const readingItems = doc.querySelectorAll('.reading-progress-item');
    assert.strictEqual(readingItems.length, 2, 'Must have 2 in-progress reading items');

    // Check "Started today" wording for 0d
    const todayItem = Array.from(readingItems).find(el => el.textContent.includes('Started Today Novel'));
    assert.ok(todayItem, 'Started Today item must be present');
    assert.ok(todayItem.querySelector('.reading-badge-days').textContent.includes('Started today'), '0d reading must display "Started today"');
    assert.strictEqual(todayItem.querySelector('.chip-mark-completed'), null, 'Incomplete novel must not have mark completed chip');

    // Check completion chip for 1962/1962
    const completeItem = Array.from(readingItems).find(el => el.textContent.includes('Ready to Complete Novel'));
    assert.ok(completeItem, 'Ready to complete item must be present');
    const chipBtn = completeItem.querySelector('.chip-mark-completed');
    assert.ok(chipBtn, 'Novel with chaptersRead >= chaptersTotal must show completion chip');
    assert.strictEqual(chipBtn.textContent.trim(), 'All chapters read: mark completed');

    // Verify novel status is NOT changed automatically before user taps
    const rawLibrary = JSON.parse(window.localStorage.getItem('novelshelf_library_v1'));
    const rawNovel = rawLibrary.find(n => n.id === 'n_finished_ch');
    assert.strictEqual(rawNovel.status, 'Reading', 'Status must NOT change automatically before tap');

    // Also verify chip appears on details page
    doc.getElementById('nav-tab-shelf').click();
    const readyCard = doc.querySelector('.novel-card[data-id="n_finished_ch"]');
    assert.ok(readyCard, 'Card must exist on shelf');
    readyCard.click();
    const detailChip = doc.getElementById('btn-detail-mark-completed');
    assert.ok(detailChip, 'Details page must also display "All chapters read: mark completed" chip');

    // Tap completion chip
    detailChip.click();

    // Verify status changed to Completed and finished date set
    const updatedLibrary = JSON.parse(window.localStorage.getItem('novelshelf_library_v1'));
    const updatedNovel = updatedLibrary.find(n => n.id === 'n_finished_ch');
    assert.strictEqual(updatedNovel.status, 'Completed', 'Tapping chip must set status to Completed');
    assert.ok(updatedNovel.finished, 'Finished date must be set');
    assert.strictEqual(updatedNovel.finishedEstimated, false);

    // Verify undo toast appeared
    const toast = doc.querySelector('.toast-undo') || doc.querySelector('.toast:last-child');
    assert.ok(toast, 'Undo toast must be shown');
    assert.ok(toast.textContent.includes('Marked "Ready to Complete Novel" as completed'));

    // Tap undo
    const undoBtn = toast.querySelector('.toast-action-btn');
    assert.ok(undoBtn, 'Undo button must exist in toast');
    undoBtn.click();

    // Verify status restored to Reading
    const restoredLibrary = JSON.parse(window.localStorage.getItem('novelshelf_library_v1'));
    const restoredNovel = restoredLibrary.find(n => n.id === 'n_finished_ch');
    assert.strictEqual(restoredNovel.status, 'Reading', 'Tapping undo must restore status to Reading');
    assert.strictEqual(restoredNovel.finished, '', 'Finished date must be cleared');
  });

  // A40: Form spacing uses --space-form-gap token for form-row
  await test('A40', 'Form spacing uses --space-form-gap token for form-row across viewports', async () => {
    assert.match(css, /\.form-row\s*\{[^}]*gap:\s*var\(--space-form-gap,\s*20px\)/i, '.form-row must use --space-form-gap');
    assert.match(css, /@media\s*\(max-width:\s*460px\)\s*\{[^}]*\.form-row\s*\{[^}]*gap:\s*var\(--space-form-gap,\s*20px\)/i, '.form-row mobile query must use --space-form-gap');
  });

  console.log('\n--- Test Summary ---');
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  console.log(`Total: ${results.length}, Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests();
