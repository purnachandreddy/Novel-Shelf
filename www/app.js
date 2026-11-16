/**
 * 📚 Novel Shelf - Core Application Logic
 * Fixes: touch star-rating, render bugs, cover handling, custom delete dialog,
 *        Android-safe export, offline fonts, 120Hz animation, all logic errors.
 */

(function () {
  'use strict';

  // --- Storage & State ---
  const STORAGE_KEY = 'novelshelf_library_v1';
  const VIEW_PREF_KEY = 'novelshelf_view_mode';

  // Single source of truth for date helpers (backed by StatsCalculator)
  function localDateString(d) {
    if (window.StatsCalculator && window.StatsCalculator.formatLocalDate) {
      return window.StatsCalculator.formatLocalDate(d || new Date());
    }
    const dt = d || new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDateShort(dateStr) {
    if (window.StatsCalculator && window.StatsCalculator.formatDateShort) {
      return window.StatsCalculator.formatDateShort(dateStr);
    }
    if (!dateStr || typeof dateStr !== 'string') return '';
    const parts = dateStr.trim().split('-');
    if (parts.length === 3) {
      return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0].slice(-2)}`;
    }
    return dateStr;
  }

  let library = [];
  let activeStatusFilter = 'ALL';
  let activeGenreFilter = 'ALL';
  let activeSort = 'updated-desc';
  let searchQuery = '';
  let currentView = 'grid'; // loaded safely in loadLibrary
  let currentRating = 0;
  let viewingNovelId = null;
  let ratingTouchActive = false;

  // Stats time filter state ('all' | 'year' | 'month')
  let statsTimeFilter = 'all';

  // A1 — track whether the edit form was opened from details view
  let formOpenedFromDetails = false;
  let currentScreen = 'shelf';
  let subscreenReturnTo = 'shelf';

  // A9 — cancel function for the active confirm dialog
  let activeConfirmCancel = null;

  // Step 1: Storage recovery mode
  let recoveryMode = false;
  let rawCorruptedStorage = null;

  // Fix #14 — track which card IDs have already been animated
  const _animatedCardIds = new Set();

  // Fix #14 — debounce helper
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // A12 — URL normalizer
  function normalizeUrl(s) {
    s = (s || '').trim();
    if (!s) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    return /^https?:\/\//i.test(s) ? s : '';
  }

  // --- Sample Dataset ---
  const SAMPLE_NOVELS = [
    {
      id: 'novel_sample_1',
      title: 'Lord of the Mysteries',
      author: 'Cuttlefish That Loves Diving',
      cover: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=400&q=80',
      status: 'Reading',
      chaptersRead: 560,
      chaptersTotal: 1432,
      rating: 5.0,
      started: '2024-02-10',
      finished: '',
      source: 'Webnovel',
      link: 'https://www.webnovel.com',
      genre: 'Fantasy',
      tags: ['Steampunk', 'Mystery', 'Tarot Club', 'Gods', 'Potion Progression'],
      notes: 'Masterpiece of progression fantasy and Victorian Eldritch mystery. The 22 potion pathways and fool sequence are unmatched.',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
      updatedAt: Date.now() - 1000 * 60 * 60 * 2
    },
    {
      id: 'novel_sample_2',
      title: "Omniscient Reader's Viewpoint",
      author: 'Sing Shong',
      cover: 'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=400&q=80',
      status: 'Completed',
      chaptersRead: 551,
      chaptersTotal: 551,
      rating: 4.5,
      started: '2023-09-01',
      finished: '2023-12-15',
      source: 'Webnovel',
      link: 'https://www.webnovel.com',
      genre: 'LitRPG',
      tags: ['Apocalypse', 'Constellations', 'Fourth Wall', 'Doomsday'],
      notes: "Kim Dokja only reader of a failed webnovel when it becomes reality. The ending chapters (51% vs 49%) are emotionally unforgettable.",
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 90,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 10
    },
    {
      id: 'novel_sample_3',
      title: 'Shadow Slave',
      author: 'Guiltythree',
      cover: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?auto=format&fit=crop&w=400&q=80',
      status: 'Reading',
      chaptersRead: 1120,
      chaptersTotal: 1980,
      rating: 4.5,
      started: '2024-01-05',
      finished: '',
      source: 'Webnovel',
      link: 'https://www.webnovel.com',
      genre: 'Dark Fantasy',
      tags: ['Nightmare Spell', 'Sunny', 'Survival', 'Fated', 'Memories'],
      notes: 'Sunny and Nephis dynamic is brilliant. The Forgotten Shore arc was peak tension.',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 45,
      updatedAt: Date.now() - 1000 * 60 * 60 * 5
    },
    {
      id: 'novel_sample_4',
      title: 'Mother of Learning',
      author: 'Domagoj Kurmaic (nobody103)',
      cover: 'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=400&q=80',
      status: 'Completed',
      chaptersRead: 108,
      chaptersTotal: 108,
      rating: 5.0,
      started: '2023-06-12',
      finished: '2023-08-01',
      source: 'Royal Road',
      link: 'https://www.royalroad.com',
      genre: 'Fantasy',
      tags: ['Time Loop', 'Magic Academy', 'Mind Magic', 'Zorian', 'Invasion'],
      notes: 'One of the best executed time loop stories in fiction. Incredible magic discipline and pacing.',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 120,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 40
    },
    {
      id: 'novel_sample_5',
      title: 'The Beginning After The End',
      author: 'TurtleMe',
      cover: 'https://images.unsplash.com/photo-1532012164546-f432f2e3777f?auto=format&fit=crop&w=400&q=80',
      status: 'On Hold',
      chaptersRead: 420,
      chaptersTotal: 500,
      rating: 4.0,
      started: '2023-11-20',
      finished: '',
      source: 'Tapas',
      link: 'https://tapas.io',
      genre: 'Action',
      tags: ['Reincarnation', 'Mana Core', 'Dragons', 'War', 'Arthur Leywin'],
      notes: 'King Grey reincarnates as Arthur. Great early academy arc, darker war tone in later volumes.',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 60,
      updatedAt: Date.now() - 1000 * 60 * 60 * 24 * 15
    }
  ];

  // --- DOM Elements ---
  const novelsContainer = document.getElementById('novels-container');
  const emptyState = document.getElementById('empty-state');
  const noSearchResults = document.getElementById('no-search-results');
  const searchInput = document.getElementById('search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const genreFilter = document.getElementById('genre-filter');
  const sortFilter = document.getElementById('sort-filter');
  const statusTabs = document.getElementById('status-tabs');
  const viewGridBtn = document.getElementById('view-grid-btn');
  const viewListBtn = document.getElementById('view-list-btn');

  // Stats Screen & View
  const viewStats = document.getElementById('view-stats');
  const btnStatsToggle = document.getElementById('btn-stats-toggle');
  const btnBackStats = document.getElementById('btn-back-stats');
  const statTotalNovels = document.getElementById('stat-total-novels');
  const statChaptersRead = document.getElementById('stat-chapters-read');
  const statChaptersSub = document.getElementById('stat-chapters-sub');
  const statNovelsFinished = document.getElementById('stat-novels-finished');
  const statAvgRating = document.getElementById('stat-avg-rating');
  const statAvgRatingSub = document.getElementById('stat-avg-rating-sub');
  const stackedStatusBar = document.getElementById('stacked-status-bar');
  const statusLegend = document.getElementById('status-legend');
  const ratingHistogram = document.getElementById('rating-histogram');
  const statsTimePills = document.getElementById('stats-time-pills');
  const sectionPace = document.getElementById('section-pace');
  const statAvgDays = document.getElementById('stat-avg-days');
  const statAvgPace = document.getElementById('stat-avg-pace');
  const statAvgPaceSub = document.getElementById('stat-avg-pace-sub');
  const paceRecords = document.getElementById('pace-records');
  const sectionMonthly = document.getElementById('section-monthly');
  const monthlyBarChart = document.getElementById('monthly-bar-chart');
  const sectionInProgress = document.getElementById('section-in-progress');
  const readingProgressList = document.getElementById('reading-progress-list');
  const sectionGenres = document.getElementById('section-genres');
  const genreBreakdownList = document.getElementById('genre-breakdown-list');
  const btnToggleGenres = document.getElementById('btn-toggle-genres');
  const sectionDropped = document.getElementById('section-dropped');
  const itemDropChapter = document.getElementById('item-drop-chapter');
  const statDropChapter = document.getElementById('stat-drop-chapter');
  const itemDropPct = document.getElementById('item-drop-pct');
  const statDropPct = document.getElementById('stat-drop-pct');
  const itemCompletionRate = document.getElementById('item-completion-rate');
  const statCompletionRate = document.getElementById('stat-completion-rate');
  const droppedInsight = document.getElementById('dropped-insight');
  const sectionTopLists = document.getElementById('section-top-lists');
  const blockHighestRated = document.getElementById('block-highest-rated');
  const listHighestRated = document.getElementById('list-highest-rated');
  const blockLongestCompleted = document.getElementById('block-longest-completed');
  const listLongestCompleted = document.getElementById('list-longest-completed');
  const blockMostReadAuthor = document.getElementById('block-most-read-author');
  const tileMostReadAuthor = document.getElementById('tile-most-read-author');
  let genresExpanded = false;

  // Form & Modals
  const modalNovelForm = document.getElementById('modal-novel-form');
  const novelForm = document.getElementById('novel-form');
  const modalFormTitle = document.getElementById('modal-form-title');
  const formNovelId = document.getElementById('form-novel-id');
  const formTitle = document.getElementById('form-title');
  const formAuthor = document.getElementById('form-author');
  const formStatus = document.getElementById('form-status');
  const formChaptersRead = document.getElementById('form-chapters-read');
  const formChaptersTotal = document.getElementById('form-chapters-total');
  const formRating = document.getElementById('form-rating');
  const ratingValueDisplay = document.getElementById('rating-value-display');
  const starRatingControl = document.getElementById('star-rating-control');
  const btnClearRating = document.getElementById('btn-clear-rating');
  const formStarted = document.getElementById('form-started');
  const formFinished = document.getElementById('form-finished');
  const formSource = document.getElementById('form-source');
  const formLink = document.getElementById('form-link');
  const formGenre = document.getElementById('form-genre');
  const formTags = document.getElementById('form-tags');
  const formNotes = document.getElementById('form-notes');
  const coverFileInput = document.getElementById('cover-file-input');
  const coverUrlInput = document.getElementById('cover-url-input');
  const coverImgPreview = document.getElementById('cover-img-preview');
  const coverPlaceholder = document.getElementById('cover-placeholder');
  const btnRemoveCover = document.getElementById('btn-remove-cover');
  const coverPreviewBox = document.getElementById('cover-preview-box');

  // Details Screen & Shelf Screen
  const viewShelf = document.getElementById('view-shelf');
  const viewNovelDetails = document.getElementById('view-novel-details');
  const detailHeaderTitle = document.getElementById('detail-header-title');
  const detailBodyContent = document.getElementById('detail-body-content');
  const btnBackShelf = document.getElementById('btn-back-shelf');
  const btnDetailEdit = document.getElementById('btn-detail-edit');
  const btnDetailDelete = document.getElementById('btn-detail-delete');

  // Backup & Restore Screen & View
  const viewBackup = document.getElementById('view-backup');
  const btnBackupMenu = document.getElementById('btn-backup-menu');
  const btnBackBackup = document.getElementById('btn-back-backup');
  const btnExportJson = document.getElementById('btn-export-json');
  const btnExportTxt = document.getElementById('btn-export-txt');
  const importJsonFile = document.getElementById('import-json-file');
  const btnLoadSampleMenu = document.getElementById('btn-load-sample-menu');

  // Confirm Dialog
  const confirmDialog = document.getElementById('confirm-dialog');
  const confirmMessage = document.getElementById('confirm-message');
  const btnConfirmYes = document.getElementById('btn-confirm-yes');
  const btnConfirmNo = document.getElementById('btn-confirm-no');

  // Misc
  const btnAddNovelTop = document.getElementById('btn-add-novel-top');
  const btnAddNovelEmpty = document.getElementById('btn-add-novel-empty');
  const btnLoadSample = document.getElementById('btn-load-sample');
  const btnCloseForm = document.getElementById('btn-close-form');
  const btnCancelForm = document.getElementById('btn-cancel-form');
  const btnResetFilters = document.getElementById('btn-reset-filters');
  const toastContainer = document.getElementById('toast-container');

  // Floating Bottom Navigation
  const floatingNav = document.getElementById('floating-bottom-nav');
  const navIndicator = document.getElementById('nav-active-indicator');

  // --- Navigation & Native Back Bridge ---
  function updateNavState(activeScreen) {
    if (!floatingNav) return;
    if (isRootTab(activeScreen)) {
      floatingNav.classList.remove('nav-hidden');
      const tabs = floatingNav.querySelectorAll('.nav-tab-btn');
      tabs.forEach(tab => {
        const isSelected = tab.dataset.tab === activeScreen;
        tab.classList.toggle('active', isSelected);
        tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        if (isSelected && navIndicator) {
          const leftOffset = tab.offsetLeft;
          navIndicator.style.transform = `translateX(${leftOffset}px)`;
          navIndicator.style.width = `${tab.offsetWidth}px`;
        }
      });
    } else {
      floatingNav.classList.add('nav-hidden');
    }
  }
  function canHandleBack() {
    const isConfirmOpen = !!(confirmDialog && confirmDialog.style.display === 'flex');
    return isConfirmOpen || currentScreen !== 'shelf';
  }

  function updateNativeBackState() {
    if (window.Android && typeof window.Android.setCanGoBack === 'function') {
      window.Android.setCanGoBack(canHandleBack());
    }
  }

  // --- Custom Confirm Dialog (2-button: yes / no) ---
  // A9 — guard against two dialogs open at once; expose cancel handle for popstate
  function showConfirm(message, yesLabel = 'Delete', noLabel = 'Cancel') {
    if (confirmDialog.style.display === 'flex') return Promise.resolve(false);
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      btnConfirmYes.textContent = yesLabel;
      btnConfirmNo.textContent = noLabel;
      confirmDialog.style.display = 'flex';
      updateNativeBackState();

      const finish = (val) => {
        activeConfirmCancel = null;
        confirmDialog.style.display = 'none';
        btnConfirmYes.removeEventListener('click', onYes);
        btnConfirmNo.removeEventListener('click', onNo);
        updateNativeBackState();
        resolve(val);
      };
      const onYes = () => {
        if (window.Motion) Motion.haptic('confirm');
        finish(true);
      };
      const onNo = () => finish(false);
      btnConfirmYes.addEventListener('click', onYes);
      btnConfirmNo.addEventListener('click', onNo);
      activeConfirmCancel = () => finish(false);
    });
  }

  // Fix #4 — 3-button import dialog: Merge / Replace / Cancel
  // Returns 'replace', 'merge', or 'cancel'
  // A9 — guard against two dialogs; expose cancel handle
  function showImportChoiceDialog(message) {
    if (confirmDialog.style.display === 'flex') return Promise.resolve('cancel');
    return new Promise((resolve) => {
      confirmMessage.textContent = message;
      btnConfirmYes.textContent = 'Replace';
      btnConfirmNo.textContent = 'Cancel';

      const btnMerge = document.createElement('button');
      btnMerge.className = 'btn btn-secondary';
      btnMerge.textContent = 'Merge';
      btnConfirmYes.parentNode.insertBefore(btnMerge, btnConfirmYes);

      confirmDialog.style.display = 'flex';
      updateNativeBackState();

      const cleanup = (val) => {
        activeConfirmCancel = null;
        confirmDialog.style.display = 'none';
        btnMerge.remove();
        btnConfirmYes.removeEventListener('click', onReplace);
        btnConfirmNo.removeEventListener('click', onCancel);
        btnMerge.removeEventListener('click', onMerge);
        updateNativeBackState();
        resolve(val);
      };
      const onReplace = () => {
        if (window.Motion) Motion.haptic('confirm');
        cleanup('replace');
      };
      const onMerge = () => {
        if (window.Motion) Motion.haptic('confirm');
        cleanup('merge');
      };
      const onCancel = () => cleanup('cancel');

      btnConfirmYes.addEventListener('click', onReplace);
      btnMerge.addEventListener('click', onMerge);
      btnConfirmNo.addEventListener('click', onCancel);
      activeConfirmCancel = () => cleanup('cancel');
    });
  }

  // --- Initializer ---
  function init() {
    loadLibrary();
    setupEventListeners();
    renderLibrary();
    applyViewMode(currentView, false); // false = don't re-render
    updateGenreDropdown();
    updateTabBadges();
    updateStatsDashboard();
    try {
      if (window.history && window.history.replaceState) {
        window.history.replaceState({ screen: 'shelf' }, '');
      }
    } catch (e) { }
    updateNativeBackState();
    updateNavState('shelf');
    isFirstLoad = false;
  }

  // --- Storage ---
  // A5 — normalizeImportedNovel is declared below (function declaration hoists); loadLibrary uses it.
  function loadLibrary() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === null || stored === '') {
        library = [];
        recoveryMode = false;
        rawCorruptedStorage = null;
      } else {
        const parsed = JSON.parse(stored);
        // Guard against corrupt storage (non-array, plain object, primitive)
        if (!Array.isArray(parsed)) {
          console.error('Storage contains non-array JSON:', parsed);
          recoveryMode = true;
          rawCorruptedStorage = stored;
          library = [];
          setTimeout(showRecoveryDialog, 100);
        } else {
          library = parsed
            .filter(item => typeof item === 'object' && item !== null && typeof item.id === 'string')
            .map(normalizeImportedNovel);
          recoveryMode = false;
          rawCorruptedStorage = null;
        }
      }
    } catch (e) {
      console.error('Failed to load library (corrupted JSON):', e);
      recoveryMode = true;
      try {
        rawCorruptedStorage = localStorage.getItem(STORAGE_KEY);
      } catch (err) {
        rawCorruptedStorage = null;
      }
      library = [];
      setTimeout(showRecoveryDialog, 100);
    }
    // A5 — wrap VIEW_PREF_KEY reads in try/catch
    try {
      currentView = localStorage.getItem(VIEW_PREF_KEY) || 'grid';
    } catch (e) {
      currentView = 'grid';
    }
  }

  function exportRawCorruptedData() {
    const text = rawCorruptedStorage || '';
    const filename = 'novelshelf-corrupted-' + localDateString() + '.txt';
    if (window.Android && typeof window.Android.saveText === 'function') {
      window._onExportResult = function (success, cancelled) {
        window._onExportResult = null;
        if (success) {
          showToast('Corrupted data file saved!', 'success');
        } else if (!cancelled) {
          showToast('Export failed.', 'error');
        }
      };
      window.Android.saveText(filename, text);
    } else {
      try {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Corrupted data downloaded!', 'success');
      } catch (err) {
        console.error('Export raw data failed:', err);
        showToast('Export failed.', 'error');
      }
    }
  }

  async function showRecoveryDialog() {
    const choice = await showConfirm(
      'Storage data appears corrupted or unreadable. Would you like to export the raw text for recovery, or start fresh with an empty library?',
      'Export Raw Data',
      'Start Fresh'
    );
    if (choice) {
      exportRawCorruptedData();
      showToast('Raw data exported. Storage remains protected.', 'info');
    } else {
      const confirmReset = await showConfirm(
        'Are you sure you want to start fresh? Any unreadable data in storage will be permanently erased.',
        'Yes, Start Fresh',
        'Cancel'
      );
      if (confirmReset) {
        recoveryMode = false;
        rawCorruptedStorage = null;
        library = [];
        try {
          localStorage.setItem(STORAGE_KEY, '[]');
        } catch (e) {
          console.error(e);
        }
        renderLibrary();
        updateTabBadges();
        updateGenreDropdown();
        updateStatsDashboard();
        showToast('Library reset. You can now use the app normally.', 'info');
      } else {
        setTimeout(showRecoveryDialog, 200);
      }
    }
  }

  function saveLibrary() {
    if (recoveryMode) {
      console.warn('saveLibrary blocked: storage is in recovery mode to prevent overwriting corrupted data.');
      showToast('Cannot save changes: storage is in recovery mode.', 'error');
      return false;
    }
    let ok = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
    } catch (e) {
      console.error('Storage error:', e);
      showToast('Storage limit reached. Try using cover image URLs instead of files.', 'error');
      ok = false;
    }
    // These always run so the UI stays consistent even on failure
    updateTabBadges();
    updateGenreDropdown();
    updateStatsDashboard();
    return ok;
  }

  // --- Half-Star Rating (touch + mouse) ---
  function getRatingFromElement(el) {
    const half = el.closest ? el.closest('.star-half') : null;
    if (half) return parseFloat(half.dataset.val);
    return null;
  }

  function setRating(val) {
    currentRating = val === 0 ? 0 : Math.max(0.5, Math.min(5, Math.round(val * 2) / 2));
    formRating.value = currentRating;
    ratingValueDisplay.textContent = currentRating === 0 ? '0.0 ★' : currentRating.toFixed(1) + ' ★';
    renderStars(currentRating);
  }

  function renderStars(val) {
    const starWrappers = starRatingControl.querySelectorAll('.star-wrapper');
    starWrappers.forEach((star) => {
      const i = parseInt(star.dataset.star, 10);
      star.classList.remove('full', 'half');
      if (val >= i) {
        star.classList.add('full');
      } else if (val >= i - 0.5) {
        star.classList.add('half');
      }
    });
  }

  // --- Rendering ---
  function getFilteredNovels() {
    let filtered = [...library];

    if (activeStatusFilter !== 'ALL') {
      filtered = filtered.filter(n => n.status === activeStatusFilter);
    }
    if (activeGenreFilter !== 'ALL') {
      const targetGenre = activeGenreFilter.toLowerCase().trim();
      filtered = filtered.filter(n => {
        if (!n.genre || typeof n.genre !== 'string') return false;
        return n.genre.split(',').map(s => s.trim().toLowerCase()).includes(targetGenre);
      });
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(n => {
        const tags = Array.isArray(n.tags) ? n.tags.join(' ').toLowerCase() : '';
        return (
          (n.title || '').toLowerCase().includes(q) ||
          (n.author || '').toLowerCase().includes(q) ||
          (n.genre || '').toLowerCase().includes(q) ||
          (n.source || '').toLowerCase().includes(q) ||
          (n.notes || '').toLowerCase().includes(q) ||
          tags.includes(q)
        );
      });
    }

    filtered.sort((a, b) => {
      switch (activeSort) {
        case 'rating-desc':
          return ((b.rating || 0) - (a.rating || 0)) || ((b.updatedAt || 0) - (a.updatedAt || 0));
        case 'progress-desc': {
          const pA = a.chaptersTotal ? (a.chaptersRead || 0) / a.chaptersTotal : 0;
          const pB = b.chaptersTotal ? (b.chaptersRead || 0) / b.chaptersTotal : 0;
          return (pB - pA) || ((b.updatedAt || 0) - (a.updatedAt || 0));
        }
        case 'title-asc':
          return (a.title || '').localeCompare(b.title || '');
        case 'chapters-desc':
          return ((b.chaptersRead || 0) - (a.chaptersRead || 0));
        default: // updated-desc
          return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
    });

    return filtered;
  }

  function updateCardDom(card, novel) {
    if (!card || !novel) return;
    const read = novel.chaptersRead || 0;
    const total = novel.chaptersTotal || 0;
    const percent = total > 0 ? Math.min(100, Math.round((read / total) * 100)) : 0;
    const ratingDisplay = novel.rating > 0 ? novel.rating.toFixed(1) + ' ★' : '—';
    const statusClass = getStatusClass(novel.status);

    // Update cover if changed
    if (card._lastCover !== novel.cover || card._lastTitle !== novel.title || card._lastGenre !== novel.genre) {
      card._lastCover = novel.cover;
      card._lastTitle = novel.title;
      card._lastGenre = novel.genre;
      const wrap = card.querySelector('.card-cover-wrap');
      if (wrap) wrap.innerHTML = renderCardCoverMarkup(novel);
    }

    // Status badge
    const badge = card.querySelector('.status-badge');
    if (badge) {
      badge.className = `status-badge ${statusClass}`;
      badge.textContent = novel.status || 'Reading';
    }

    // Title & Author
    const titleEl = card.querySelector('.card-title');
    if (titleEl && titleEl.textContent !== novel.title) {
      titleEl.textContent = novel.title;
    }
    const authorEl = card.querySelector('.card-author');
    const authorText = novel.author || 'Unknown Author';
    if (authorEl && authorEl.textContent !== authorText) {
      authorEl.textContent = authorText;
    }

    // Rating
    const starPill = card.querySelector('.star-rating-pill, .rating-unrated');
    if (starPill) {
      if (!novel.rating || novel.rating <= 0) {
        starPill.className = 'rating-unrated';
        starPill.textContent = 'Not rated';
      } else {
        starPill.className = 'star-rating-pill';
        const starsHtml = renderStarsDisplay(novel.rating);
        const ratingDisplay = novel.rating.toFixed(1) + ' ★';
        starPill.innerHTML = `${starsHtml}<span class="rating-num">${ratingDisplay}</span>`;
      }
    }

    // Genre pill
    let genrePill = card.querySelector('.genre-pill');
    if (novel.genre) {
      if (genrePill) {
        if (genrePill.textContent !== novel.genre) genrePill.textContent = novel.genre;
      } else {
        const metaRow = card.querySelector('.card-meta-row');
        if (metaRow) {
          const pill = document.createElement('span');
          pill.className = 'genre-pill';
          pill.textContent = novel.genre;
          metaRow.appendChild(pill);
        }
      }
    } else if (genrePill) {
      genrePill.remove();
    }

    // Progress
    const progInfo = card.querySelector('.progress-info');
    if (progInfo && progInfo.children.length >= 2) {
      const chText = 'Ch. ' + read + (total ? ' / ' + total : '');
      const pctText = total ? percent + '%' : '';
      if (progInfo.children[0].textContent !== chText) progInfo.children[0].textContent = chText;
      if (progInfo.children[1].textContent !== pctText) progInfo.children[1].textContent = pctText;
    }
    const fill = card.querySelector('.progress-fill');
    if (fill) {
      fill.style.width = (total ? percent : 0) + '%';
    }

    // Quick actions source
    const srcEl = card.querySelector('.card-source-label');
    if (srcEl && srcEl.textContent !== (novel.source || '')) {
      srcEl.textContent = novel.source || '';
    }
    const quickBtn = card.querySelector('[data-action="quick-add"]');
    if (quickBtn) {
      quickBtn.setAttribute('aria-label', `Add 1 chapter to ${novel.title}`);
    }

    card.setAttribute('aria-label', `${novel.title} by ${authorText}, ${novel.status}`);
  }

  function renderLibrary() {
    emptyState.style.display = 'none';
    noSearchResults.style.display = 'none';

    if (library.length === 0) {
      emptyState.style.display = 'flex';
      novelsContainer.style.display = 'none';
      novelsContainer.innerHTML = '';
      return;
    }

    const filtered = getFilteredNovels();

    if (filtered.length === 0) {
      noSearchResults.style.display = 'flex';
      novelsContainer.style.display = 'none';
      novelsContainer.innerHTML = '';
      return;
    }

    novelsContainer.style.display = '';

    // Keyed reconciliation
    const existingCards = new Map();
    for (const child of Array.from(novelsContainer.children)) {
      if (child.dataset && child.dataset.id) {
        existingCards.set(child.dataset.id, child);
      }
    }

    const activeIds = new Set();
    filtered.forEach((novel, index) => {
      activeIds.add(novel.id);
      let card = existingCards.get(novel.id);
      if (card) {
        updateCardDom(card, novel);
      } else {
        card = createNovelCard(novel);
      }

      const currentAtPos = novelsContainer.children[index];
      if (currentAtPos !== card) {
        novelsContainer.insertBefore(card, currentAtPos || null);
      }
    });

    for (const [id, child] of existingCards.entries()) {
      if (!activeIds.has(id)) {
        child.remove();
      }
    }
  }

  function getStatusClass(status) {
    const map = {
      'Reading': 'status-reading',
      'Completed': 'status-completed',
      'Plan to Read': 'status-plan',
      'On Hold': 'status-onhold',
      'Dropped': 'status-dropped'
    };
    return map[status] || 'status-reading';
  }

  // --- Unified Card Component Helpers (Single Source of Truth) ---
  function renderCardCoverMarkup(novel) {
    const title = escHtml(novel.title || 'Novel');
    const author = escHtml(novel.author || 'Unknown');
    const genre = escHtml(novel.genre || 'Novel');
    if (novel.cover) {
      return `<img class="card-cover-img" src="${escHtml(novel.cover)}" alt="${title}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="cover-art-placeholder" style="display:none;">
          <span class="placeholder-spine">${genre}</span>
          <h3 class="placeholder-title">${title}</h3>
          <span class="placeholder-author">${author}</span>
        </div>`;
    }
    return `<div class="cover-art-placeholder">
        <span class="placeholder-spine">${genre}</span>
        <h3 class="placeholder-title">${title}</h3>
        <span class="placeholder-author">${author}</span>
      </div>`;
  }

  function renderCardStatusBadgeMarkup(novel) {
    const statusClass = getStatusClass(novel.status);
    return `<span class="status-badge ${statusClass}">${escHtml(novel.status || 'Reading')}</span>`;
  }

  function renderCardStarsMarkup(novel) {
    if (!novel.rating || novel.rating <= 0) {
      return `<span class="rating-unrated">Not rated</span>`;
    }
    const ratingDisplay = novel.rating.toFixed(1) + ' ★';
    const starsHtml = renderStarsDisplay(novel.rating);
    return `<span class="star-rating-pill">${starsHtml}<span class="rating-num">${ratingDisplay}</span></span>`;
  }

  function renderCardProgressMarkup(novel) {
    const read = novel.chaptersRead || 0;
    const total = novel.chaptersTotal || 0;
    const percent = total > 0 ? Math.min(100, Math.round((read / total) * 100)) : 0;
    return `<div class="card-progress-wrap">
      <div class="progress-info">
        <span>Ch. ${read}${total ? ' / ' + total : ''}</span>
        <span>${total ? percent + '%' : ''}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${total ? percent : 0}%"></div>
      </div>
    </div>`;
  }

  function renderCardQuickActionsMarkup(novel) {
    const source = escHtml(novel.source || '');
    const title = escHtml(novel.title || 'novel');
    return `<div class="card-quick-actions">
      <span class="card-source-label">${source}</span>
      <button class="btn-quick-chapter" data-action="quick-add" data-id="${escHtml(novel.id)}" aria-label="Add 1 chapter to ${title}">＋1 Ch</button>
    </div>`;
  }

  function createNovelCard(novel) {
    const card = document.createElement('div');
    card.className = 'novel-card';
    card.dataset.id = novel.id;

    // Fix #14 — only animate on first appearance
    const isNew = !_animatedCardIds.has(novel.id);
    if (isNew) {
      _animatedCardIds.add(novel.id);
    } else {
      card.style.animation = 'none';
    }

    // Fix #10 — accessibility
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${novel.title} by ${novel.author || 'Unknown Author'}, ${novel.status}`);

    card.innerHTML = `
      <div class="card-cover-column">
        <div class="card-cover-wrap">
          ${renderCardCoverMarkup(novel)}
        </div>
        ${renderCardStatusBadgeMarkup(novel)}
      </div>
      <div class="card-content">
        <h3 class="card-title">${escHtml(novel.title)}</h3>
        <p class="card-author">${escHtml(novel.author || 'Unknown Author')}</p>
        <div class="card-meta-row">
          ${renderCardStarsMarkup(novel)}
          ${novel.genre ? `<span class="genre-pill">${escHtml(novel.genre)}</span>` : ''}
        </div>
        ${renderCardProgressMarkup(novel)}
        ${renderCardQuickActionsMarkup(novel)}
      </div>`;

    card.addEventListener('click', () => openNovelDetails(novel.id));
    // Fix #10 — keyboard navigation
    card.addEventListener('keydown', (e) => {
      if (e.target !== card) return; // A11 — ignore events from child buttons
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNovelDetails(novel.id); }
    });

    const quickAddBtn = card.querySelector('[data-action="quick-add"]');
    if (quickAddBtn) {
      quickAddBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        incrementChapter(novel.id, 1);
      });
    }

    return card;
  }

  // Unified component alias so both grid and list share one implementation
  const createNovelListItem = createNovelCard;

  function renderStarsDisplay(rating) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      if (rating >= i) {
        html += '<span class="s-star full">★</span>';
      } else if (rating >= i - 0.5) {
        html += '<span class="s-star half">★</span>';
      } else {
        html += '<span class="s-star empty">★</span>';
      }
    }
    return html;
  }

  // --- Increment Chapter ---
  // A7 — update card in-place (no resort while shelf is visible)
  function incrementChapter(id, amount) {
    if (window.Motion) Motion.haptic('tick');
    const novel = library.find(n => n.id === id);
    if (!novel) return;

    // A13 — guard already-at-last
    if (novel.chaptersTotal && novel.chaptersRead >= novel.chaptersTotal) {
      showToast('Already at the last chapter', 'info');
      return;
    }

    // A4 — snapshot for rollback
    const snapshot = JSON.parse(JSON.stringify(library));

    novel.chaptersRead = (novel.chaptersRead || 0) + amount;

    // A13 — clamp to total
    if (novel.chaptersTotal && novel.chaptersRead > novel.chaptersTotal) {
      novel.chaptersRead = novel.chaptersTotal;
    }

    // A13 — switch On Hold / Dropped → Reading on chapter log
    if (novel.status === 'On Hold' || novel.status === 'Dropped') {
      novel.status = 'Reading';
    }

    // Fix #13 — switching Plan to Read → Reading on first chapter
    if (novel.status === 'Plan to Read') {
      novel.status = 'Reading';
      if (!novel.started) novel.started = localDateString();
    }

    let statusChanged = false;
    if (novel.chaptersTotal && novel.chaptersRead >= novel.chaptersTotal && novel.status !== 'Completed') {
      novel.status = 'Completed';
      novel.finished = localDateString();
      novel.finishedEstimated = false;
      statusChanged = true;
      showToast(`🎉 Finished "${novel.title}"!`, 'success');
    } else {
      showToast(`Ch. ${novel.chaptersRead} logged for "${novel.title}"`, 'success');
    }

    novel.updatedAt = Date.now();

    const saved = saveLibrary();
    if (!saved) {
      library = snapshot;
      saveLibrary(); // re-sync UI with restored state (saveLibrary always updates UI)
      return;
    }

    if (statusChanged) {
      renderLibrary();
    } else {
      // In-place card update (zero list rebuild, zero scroll jump, no lost focus)
      const card = novelsContainer.querySelector('[data-id="' + id + '"]');
      if (card) {
        updateCardDom(card, novel);
      } else {
        renderLibrary();
      }
    }

    // Re-find from library and refresh detail view if open
    if (viewingNovelId === id) {
      const updated = library.find(n => n.id === id);
      if (updated) renderNovelDetailsContent(updated);
    }
  }

  // --- Screen Router / Navigation ---
  let activeViewTransition = null;
  let isFirstLoad = true;
  const TAB_ORDER = { shelf: 0, stats: 1, backup: 2 };

  function isRootTab(screenName) {
    return screenName === 'shelf' || screenName === 'stats' || screenName === 'backup';
  }

  function showScreen(name, { push = false, id = null, from = null } = {}) {
    if (window.Motion && typeof window.Motion.cancelAllCountUps === 'function') {
      window.Motion.cancelAllCountUps();
    }

    if (activeViewTransition && typeof activeViewTransition.skipTransition === 'function') {
      try { activeViewTransition.skipTransition(); } catch (e) { }
      activeViewTransition = null;
    }

    const prevScreen = currentScreen;
    if (name === 'details' || name === 'form') {
      subscreenReturnTo = from || prevScreen || 'shelf';
    }

    let transitionDirection = null;
    let transitionType = null;
    let cardCoverEl = null;

    const canAnimate = !isFirstLoad &&
      (typeof window.effectsReduced === 'function' ? !window.effectsReduced() : true) &&
      typeof document.startViewTransition === 'function';

    if (canAnimate) {
      if (isRootTab(prevScreen) && isRootTab(name) && prevScreen !== name) {
        transitionDirection = (TAB_ORDER[name] || 0) > (TAB_ORDER[prevScreen] || 0) ? 'forward' : 'backward';
      } else if (name === 'form' || prevScreen === 'form') {
        transitionType = 'sheet';
      } else if (name === 'details' && (id || viewingNovelId)) {
        const targetId = id || viewingNovelId;
        cardCoverEl = document.querySelector(`.novel-card[data-id="${targetId}"] .card-cover-wrap`) ||
          document.querySelector(`.novel-card[data-id="${targetId}"] .card-cover-column`);
      }
    }

    // Heavy rendering executed BEFORE starting the transition
    if (name === 'shelf') {
      viewingNovelId = null;
      renderLibrary();
    } else if (name === 'stats') {
      viewingNovelId = null;
      updateStatsDashboard(true);
    } else if (name === 'backup') {
      viewingNovelId = null;
    } else if (name === 'details') {
      const targetId = id || viewingNovelId;
      if (targetId) {
        const novel = library.find(n => n.id === targetId);
        if (novel) {
          viewingNovelId = targetId;
          renderNovelDetailsContent(novel);
        }
      }
    }

    const allScreens = [
      { el: viewShelf, name: 'shelf' },
      { el: viewStats, name: 'stats' },
      { el: viewBackup, name: 'backup' },
      { el: viewNovelDetails, name: 'details' },
      { el: modalNovelForm, name: 'form' }
    ];

    const updateDOM = () => {
      allScreens.forEach(({ el, name: screenName }) => {
        if (!el) return;
        if (screenName === name) {
          el.style.display = (name === 'shelf' ? '' : 'flex');
          el.inert = false;
        } else {
          el.style.display = 'none';
          el.inert = true;
        }
      });

      if (name === 'stats' && viewStats) {
        const reduced = typeof effectsReduced === 'function' ? effectsReduced() : false;
        if (!reduced) {
          viewStats.classList.add('stats-entrance');
          setTimeout(() => {
            if (viewStats) viewStats.classList.remove('stats-entrance');
          }, 850);
        }
      }

      currentScreen = name;

      // History management
      try {
        if (window.history) {
          if (isRootTab(name)) {
            window.history.replaceState({ screen: name }, '');
          } else if (push) {
            window.history.pushState({ screen: name, id: id || viewingNovelId, from: subscreenReturnTo }, '');
          }
        }
      } catch (e) {
        // Ignore history API errors
      }

      updateNativeBackState();
      updateNavState(name);
      try { window.scrollTo({ top: 0, behavior: 'instant' }); } catch (e) { }
    };

    if (canAnimate && (transitionDirection || transitionType || cardCoverEl)) {
      if (transitionDirection) document.documentElement.dataset.transitionDirection = transitionDirection;
      if (transitionType) document.documentElement.dataset.transitionType = transitionType;
      if (cardCoverEl) cardCoverEl.style.viewTransitionName = 'novel-cover';

      let safetyTimer = null;

      try {
        const vt = document.startViewTransition(() => {
          if (cardCoverEl) cardCoverEl.style.viewTransitionName = '';
          updateDOM();
          const detailCoverBox = document.querySelector('.detail-cover-box');
          if (detailCoverBox) detailCoverBox.style.viewTransitionName = 'novel-cover';
        });
        activeViewTransition = vt;

        safetyTimer = setTimeout(() => {
          if (activeViewTransition === vt) {
            try { vt.skipTransition(); } catch (e) { }
            activeViewTransition = null;
          }
        }, 400);

        vt.finished.finally(() => {
          if (safetyTimer) clearTimeout(safetyTimer);
          delete document.documentElement.dataset.transitionDirection;
          delete document.documentElement.dataset.transitionType;
          const detailCoverBox = document.querySelector('.detail-cover-box');
          if (detailCoverBox) detailCoverBox.style.viewTransitionName = '';
          if (activeViewTransition === vt) activeViewTransition = null;
        });
      } catch (err) {
        if (safetyTimer) clearTimeout(safetyTimer);
        delete document.documentElement.dataset.transitionDirection;
        delete document.documentElement.dataset.transitionType;
        if (cardCoverEl) cardCoverEl.style.viewTransitionName = '';
        updateDOM();
      }
    } else {
      updateDOM();
    }
  }

  // --- Details Tab (Full-Page View) ---
  function openNovelDetails(id, from = currentScreen) {
    showScreen('details', { push: true, id, from });
  }

  function closeNovelDetails(popHistory = true) {
    if (popHistory && window.history && window.history.state && window.history.state.screen === 'details') {
      window.history.back();
    } else {
      showScreen(subscreenReturnTo || 'shelf', { push: false });
    }
  }

  // --- Full-Page Reading Stats Tab ---
  function openStatsView() {
    showScreen('stats');
  }

  function closeStatsView(popHistory = true) {
    showScreen('shelf');
  }

  // --- Full-Page Backup & Restore Tab ---
  function openBackupView() {
    showScreen('backup');
  }

  function closeBackupView(popHistory = true) {
    showScreen('shelf');
  }

  // --- Novel Form (Add / Edit Full-Page Screen) ---
  function openFormModal(from = currentScreen) {
    showScreen('form', { push: true, from });
  }

  function closeFormModal(popHistory = true) {
    if (popHistory && window.history && window.history.state && window.history.state.screen === 'form') {
      window.history.back();
    } else {
      const destination = (formOpenedFromDetails && viewingNovelId) ? 'details' : (subscreenReturnTo || 'shelf');
      formOpenedFromDetails = false;
      showScreen(destination, { push: false, id: viewingNovelId });
    }
  }

  function renderNovelDetailsContent(novel) {
    detailHeaderTitle.textContent = novel.title;

    const read = novel.chaptersRead || 0;
    const total = novel.chaptersTotal || 0;
    const percent = total > 0 ? Math.min(100, Math.round((read / total) * 100)) : 0;
    const statusClass = getStatusClass(novel.status);
    const ratingHtml = (novel.rating && novel.rating > 0)
      ? `<span class="detail-stars">${renderStarsDisplay(novel.rating)}<span class="detail-rating-num">${novel.rating.toFixed(1)}</span></span>`
      : `<span class="rating-unrated detail-unrated">Not rated</span>`;

    let coverHtml;
    if (novel.cover) {
      coverHtml = `<img src="${escHtml(novel.cover)}" alt="${escHtml(novel.title)}" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="cover-art-placeholder" style="display:none;">
          <span class="placeholder-spine">${escHtml(novel.genre || 'Novel')}</span>
          <h3 class="placeholder-title">${escHtml(novel.title)}</h3>
          <span class="placeholder-author">${escHtml(novel.author || 'Unknown')}</span>
        </div>`;
    } else {
      coverHtml = `<div class="cover-art-placeholder">
          <span class="placeholder-spine">${escHtml(novel.genre || 'Novel')}</span>
          <h3 class="placeholder-title">${escHtml(novel.title)}</h3>
          <span class="placeholder-author">${escHtml(novel.author || 'Unknown')}</span>
        </div>`;
    }

    const tagsHtml = (novel.tags && novel.tags.length > 0)
      ? novel.tags.map(t => `<span class="tag-badge">#${escHtml(t.trim())}</span>`).join('')
      : '<span class="no-tags">No tags added</span>';

    let sourceLinkHtml = novel.source ? escHtml(novel.source) : '—';
    if (novel.link && novel.source && /^https?:\/\//i.test(novel.link)) {
      sourceLinkHtml = `<a href="${escHtml(novel.link)}" target="_blank" rel="noopener noreferrer">${escHtml(novel.source)} ↗</a>`;
    } else if (novel.link && /^https?:\/\//i.test(novel.link)) {
      sourceLinkHtml = `<a href="${escHtml(novel.link)}" target="_blank" rel="noopener noreferrer">Visit Source ↗</a>`;
    }

    const dateStr = [
      novel.started ? 'Started: ' + escHtml(novel.started) : null,
      novel.finished ? 'Finished: ' + escHtml(novel.finished) : null
    ].filter(Boolean).join('<br>') || '—';

    detailBodyContent.innerHTML = `
      <div class="detail-hero">
        <div class="detail-cover-box">${coverHtml}</div>
        <div class="detail-info">
          <h1 class="detail-title">${escHtml(novel.title)}</h1>
          <p class="detail-author">by ${escHtml(novel.author || 'Unknown Author')}</p>
          <div class="detail-badges-row">
            <span class="status-badge ${statusClass}">${escHtml(novel.status)}</span>
            ${ratingHtml}
            ${novel.genre ? `<span class="genre-pill">${escHtml(novel.genre)}</span>` : ''}
          </div>
          <div class="detail-progress-card">
            <div class="detail-progress-header">
              <span>Chapter Progress</span>
              <strong>${read}${total ? ' / ' + total + ' (' + percent + '%)' : ' chapters'}</strong>
            </div>
            <div class="progress-track" style="height:8px;margin-top:6px">
              <div class="progress-fill" style="width: ${total ? percent : 0}%"></div>
            </div>
            <div class="detail-progress-buttons">
              <button class="btn btn-secondary btn-sm" id="btn-detail-add-1">＋1 Chapter</button>
              <button class="btn btn-secondary btn-sm" id="btn-detail-add-5">＋5 Chapters</button>
              ${/^https?:\/\//i.test(novel.link || '') ? `<a class="btn btn-primary btn-sm detail-read-btn" href="${escHtml(novel.link)}" target="_blank" rel="noopener noreferrer">Read ↗</a>` : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="detail-meta-grid">
        <div class="meta-item">
          <div class="meta-item-label">Source</div>
          <div class="meta-item-value">${sourceLinkHtml}</div>
        </div>
        <div class="meta-item">
          <div class="meta-item-label">Dates</div>
          <div class="meta-item-value">${dateStr}</div>
        </div>
      </div>
      <div class="detail-tags-wrap">${tagsHtml}</div>
      ${novel.notes ? `<div class="detail-notes-card"><h4>Notes &amp; Review</h4><div class="detail-notes-content">${escHtml(novel.notes)}</div></div>` : ''}
    `;

    document.getElementById('btn-detail-add-1').addEventListener('click', () => incrementChapter(novel.id, 1));
    document.getElementById('btn-detail-add-5').addEventListener('click', () => incrementChapter(novel.id, 5));
  }

  // --- Add / Edit Modal ---
  function setStatusPill(status, autoFillDates = false) {
    const val = status || 'Reading';
    if (formStatus) formStatus.value = val;
    const container = document.getElementById('status-quick-pills');
    if (container) {
      container.querySelectorAll('.status-pill-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.status === val);
      });
    }
    // Fix #13 — auto-fill dates when setting status (only on explicit user tap)
    if (autoFillDates) {
      if (val === 'Reading' && formStarted && !formStarted.value) {
        formStarted.value = localDateString();
      }
      if (val === 'Completed') {
        if (formFinished && !formFinished.value) {
          formFinished.value = localDateString();
        }
      } else {
        // If switching to non-completed, clear finished date
        if (formFinished) formFinished.value = '';
      }
    }
  }

  function openAddModal() {
    if (window.Motion) Motion.haptic('tick');
    formOpenedFromDetails = false; // A1 — opened from shelf
    novelForm.reset();
    formNovelId.value = '';
    modalFormTitle.textContent = 'Add novel';
    setRating(0);
    resetCoverPreview();
    setStatusPill('Reading');
    formChaptersRead.value = '0';
    formChaptersTotal.value = '';
    formStarted.value = localDateString(); // Auto-set started to today on creation
    formFinished.value = '';
    // Reset genre quick pills visual state
    const genrePills = document.getElementById('genre-quick-pills');
    if (genrePills) genrePills.querySelectorAll('.pill-btn').forEach(p => p.classList.remove('active'));
    openFormModal();
  }

  function openEditModal(id) {
    const novel = library.find(n => n.id === id);
    if (!novel) return;

    novelForm.reset();
    formNovelId.value = novel.id;
    modalFormTitle.textContent = 'Edit novel';

    formTitle.value = novel.title || '';
    formAuthor.value = novel.author || '';
    setStatusPill(novel.status || 'Reading');
    formChaptersRead.value = novel.chaptersRead != null ? String(novel.chaptersRead) : '0';
    formChaptersTotal.value = novel.chaptersTotal != null ? String(novel.chaptersTotal) : '';
    setRating(novel.rating || 0);
    formStarted.value = novel.started || '';
    formFinished.value = novel.finished || '';
    formSource.value = novel.source || '';
    formLink.value = novel.link || '';
    formGenre.value = novel.genre || '';
    formTags.value = Array.isArray(novel.tags) ? novel.tags.join(', ') : (novel.tags || '');
    formNotes.value = novel.notes || '';

    // A13 — sync genre quick pills with formGenre
    const genrePills = document.getElementById('genre-quick-pills');
    if (genrePills) {
      const gNorm = (formGenre.value || '').trim().toLowerCase();
      genrePills.querySelectorAll('.pill-btn').forEach(p => {
        p.classList.toggle('active', p.dataset.genre.toLowerCase() === gNorm);
      });
    }

    if (novel.cover) {
      setCoverPreview(novel.cover);
      // Only show URL in input if it's a real URL, not a data URI
      coverUrlInput.value = novel.cover.startsWith('data:') ? '' : novel.cover;
    } else {
      resetCoverPreview();
    }

    openFormModal();
  }

  function handleFormSubmit(e) {
    e.preventDefault();

    const title = formTitle.value.trim();
    if (!title) {
      showToast('Please enter a novel title', 'error');
      formTitle.focus();
      return;
    }

    const id = formNovelId.value || 'novel_' + Date.now();
    let read = Math.max(0, parseInt(formChaptersRead.value, 10) || 0);
    const totalRaw = parseInt(formChaptersTotal.value, 10);
    const total = isNaN(totalRaw) || totalRaw <= 0 ? null : totalRaw;
    let status = formStatus.value;
    let started = formStarted.value || localDateString();
    let finished = formFinished.value;

    // A10 & Task 1: Auto-set finished when status becomes Completed, clear when it leaves Completed
    if (status === 'Completed') {
      if (total) read = total;
      if (!finished) {
        finished = localDateString();
        formFinished.value = finished;
      }
    } else {
      // Clear finished if leaving Completed status
      finished = '';
      if (formFinished) formFinished.value = '';
    }

    const rating = parseFloat(formRating.value) || 0;
    const tags = formTags.value
      ? formTags.value.split(',').map(t => t.trim()).filter(Boolean)
      : [];

    // A12 — Cover and Link normalization
    let cover = '';
    if (coverImgPreview.style.display === 'block' && coverImgPreview.src) {
      if (coverImgPreview.src.startsWith('data:')) {
        cover = coverImgPreview.src;
      } else {
        cover = normalizeUrl(coverUrlInput.value);
      }
    } else if (coverUrlInput.value.trim()) {
      cover = normalizeUrl(coverUrlInput.value);
    }

    const link = normalizeUrl(formLink.value);

    // Existing novel lookup to preserve creation date and properly update estimated flags
    const existingIndex = library.findIndex(n => n.id === id);
    const existing = existingIndex >= 0 ? library[existingIndex] : null;

    let startedEstimated = false;
    let finishedEstimated = false;
    if (existing) {
      // Clear startedEstimated if user explicitly changed/entered started date
      const startedChanged = formStarted.value && formStarted.value !== existing.started;
      startedEstimated = startedChanged ? false : Boolean(existing.startedEstimated);

      // Clear finishedEstimated if status became Completed or user edited/entered finished date
      const finishedChanged = formFinished.value && formFinished.value !== existing.finished;
      const becameCompleted = status === 'Completed' && existing.status !== 'Completed';
      if (becameCompleted || finishedChanged) {
        finishedEstimated = false;
      } else {
        finishedEstimated = status === 'Completed' ? Boolean(existing.finishedEstimated) : false;
      }
    }

    const novelData = {
      id,
      title,
      author: formAuthor.value.trim(),
      status,
      chaptersRead: read,
      chaptersTotal: total,
      rating,
      started,
      finished,
      startedEstimated,
      finishedEstimated,
      source: formSource.value.trim(),
      link,
      genre: formGenre.value.trim(),
      tags,
      notes: formNotes.value.trim(),
      cover,
      updatedAt: Date.now()
    };

    // A4 — rollback snapshot
    const snapshot = JSON.parse(JSON.stringify(library));
    const isNew = existingIndex < 0;

    if (!isNew) {
      novelData.createdAt = library[existingIndex].createdAt || Date.now();
      library[existingIndex] = novelData;
    } else {
      novelData.createdAt = Date.now();
      library.unshift(novelData);
    }

    const saved = saveLibrary();
    if (!saved) {
      library = snapshot;
      saveLibrary();
      return;
    }

    if (!isNew) {
      showToast(`Updated "${title}"`, 'success');
    } else {
      showToast(`Added "${title}" to your shelf!`, 'success');
    }

    renderLibrary();
    closeFormModal(true);

    // Fix #7 — re-render details in place instead of re-opening (which pushes another history entry)
    if (viewingNovelId === id) {
      const updated = library.find(n => n.id === id);
      if (updated) renderNovelDetailsContent(updated);
    }
  }

  async function deleteNovel(id) {
    const novel = library.find(n => n.id === id);
    if (!novel) return;

    const confirmed = await showConfirm(`Delete "${novel.title}"? This cannot be undone.`);
    if (!confirmed) return;

    // A4 — snapshot for rollback
    const snapshot = JSON.parse(JSON.stringify(library));
    library = library.filter(n => n.id !== id);

    const saved = saveLibrary();
    if (!saved) {
      library = snapshot;
      saveLibrary();
      return;
    }

    renderLibrary();
    if (viewNovelDetails.style.display === 'flex') {
      closeNovelDetails(true);
    }
    viewingNovelId = null;
    showToast(`Deleted "${novel.title}"`, 'success');
  }

  // --- Cover Handling ---
  function setCoverPreview(src) {
    coverImgPreview.src = src;
    coverImgPreview.style.display = 'block';
    coverPlaceholder.style.display = 'none';
    btnRemoveCover.style.display = 'flex';
  }

  function resetCoverPreview() {
    coverImgPreview.removeAttribute('src');
    coverImgPreview.style.display = 'none';
    coverPlaceholder.style.display = 'flex';
    btnRemoveCover.style.display = 'none';
    coverUrlInput.value = '';
    // Reset file input safely
    try { coverFileInput.value = ''; } catch (e) {/* ignore */ }
  }

  function handleCoverFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Step 3: Cap longest side to ~300x450 to conserve localStorage quota
        const MAX_W = 300;
        const MAX_H = 450;
        let w = img.width;
        let h = img.height;

        // A13 — guard w/h === 0
        if (!w || !h) {
          showToast('Invalid image dimensions.', 'error');
          return;
        }

        // Scale proportionally to fit within MAX_W x MAX_H
        const scaleW = w > MAX_W ? MAX_W / w : 1;
        const scaleH = h > MAX_H ? MAX_H / h : 1;
        const scale = Math.min(scaleW, scaleH);
        w = Math.round(w * scale);
        h = Math.round(h * scale);

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        // A13 — fill white background so transparent PNGs aren't black
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.70);
        setCoverPreview(dataUrl);
        coverUrlInput.value = '';
      };
      img.onerror = () => showToast('Failed to load image file.', 'error');
      img.src = e.target.result;
    };
    reader.onerror = () => showToast('Failed to read image file.', 'error');
    reader.readAsDataURL(file);
  }

  // --- Stats Dashboard ---
  function updateStatsDashboard(animateNumbers = false) {
    if (!viewStats) return;

    const calc = (typeof window !== 'undefined' && window.StatsCalculator)
      ? window.StatsCalculator
      : (typeof StatsCalculator !== 'undefined' ? StatsCalculator : null);

    if (!calc) return;

    const now = new Date();
    const stats = calc.computeStats(library, statsTimeFilter, now);
    const hasMotion = Boolean(window.Motion && typeof window.Motion.countUp === 'function');

    // Top Cards
    if (statTotalNovels) {
      if (animateNumbers && hasMotion) {
        window.Motion.countUp(statTotalNovels, stats.totalNovels);
      } else {
        statTotalNovels.textContent = stats.totalNovels;
      }
    }
    if (statNovelsFinished) {
      if (animateNumbers && hasMotion) {
        window.Motion.countUp(statNovelsFinished, stats.completed.count);
      } else {
        statNovelsFinished.textContent = stats.completed.count;
      }
    }

    if (statChaptersRead) {
      if (animateNumbers && hasMotion) {
        window.Motion.countUp(statChaptersRead, stats.chapters.total);
      } else {
        statChaptersRead.textContent = stats.chapters.total.toLocaleString();
      }
    }
    if (statChaptersSub) {
      statChaptersSub.textContent = `${stats.chapters.inCompleted.toLocaleString()} completed • ${stats.chapters.inReading.toLocaleString()} reading`;
    }

    if (statAvgRating) {
      if (stats.ratings.average) {
        if (animateNumbers && hasMotion) {
          window.Motion.countUp(statAvgRating, stats.ratings.average, { suffix: ' ★', decimals: 1 });
        } else {
          statAvgRating.textContent = stats.ratings.average + ' ★';
        }
      } else {
        statAvgRating.textContent = '—';
      }
    }
    if (statAvgRatingSub) {
      statAvgRatingSub.textContent = stats.ratings.totalRated > 0
        ? `from ${stats.ratings.totalRated} rating${stats.ratings.totalRated !== 1 ? 's' : ''}`
        : 'no ratings';
    }

    // 1. Reading Pace & Speed Section (Filtered completed stats)
    if (sectionPace) {
      const hasCompleted = stats.completed.count > 0 && (stats.completed.avgDaysToFinish !== null || stats.completed.fastest);
      if (hasCompleted) {
        sectionPace.style.display = 'block';
        if (statAvgDays) {
          if (stats.completed.avgDaysToFinish != null) {
            if (animateNumbers && hasMotion) {
              window.Motion.countUp(statAvgDays, stats.completed.avgDaysToFinish, { suffix: 'd' });
            } else {
              statAvgDays.textContent = `${stats.completed.avgDaysToFinish}d`;
            }
          } else {
            statAvgDays.textContent = '—';
          }
        }
        if (statAvgPace) {
          if (stats.completed.avgReadingPace != null) {
            if (animateNumbers && hasMotion) {
              window.Motion.countUp(statAvgPace, stats.completed.avgReadingPace, { decimals: 1 });
            } else {
              statAvgPace.textContent = stats.completed.avgReadingPace;
            }
          } else {
            statAvgPace.textContent = '—';
          }
        }
        if (statAvgPaceSub) {
          if (stats.completed.avgReadingPace != null && stats.completed.paceBasisCount > 0) {
            statAvgPaceSub.textContent = stats.completed.paceBasisCount === 1
              ? 'based on 1 novel'
              : `based on ${stats.completed.paceBasisCount} novels`;
          } else {
            statAvgPaceSub.textContent = '';
          }
        }

        if (paceRecords) {
          paceRecords.innerHTML = '';
          const completedCount = stats.completed.count || 0;
          if (completedCount >= 2) {
            paceRecords.style.display = 'flex';
            if (stats.completed.fastest) {
              const fRow = document.createElement('div');
              fRow.className = 'pace-record-row';
              fRow.innerHTML = `
                <div style="display:flex;align-items:center;min-width:0;flex:1;">
                  <span class="pace-record-tag tag-fastest">Fastest</span>
                  <span class="pace-record-title" title="${escHtml(stats.completed.fastest.title)}">${escHtml(stats.completed.fastest.title)}</span>
                </div>
                <span class="pace-record-days">${stats.completed.fastest.days}d (${stats.completed.fastest.chapters} ch)</span>
              `;
              paceRecords.appendChild(fRow);
            }
            if (stats.completed.longest && (!stats.completed.fastest || stats.completed.longest.days !== stats.completed.fastest.days || stats.completed.longest.title !== stats.completed.fastest.title)) {
              const lRow = document.createElement('div');
              lRow.className = 'pace-record-row';
              lRow.innerHTML = `
                <div style="display:flex;align-items:center;min-width:0;flex:1;">
                  <span class="pace-record-tag tag-longest">Longest</span>
                  <span class="pace-record-title" title="${escHtml(stats.completed.longest.title)}">${escHtml(stats.completed.longest.title)}</span>
                </div>
                <span class="pace-record-days">${stats.completed.longest.days}d (${stats.completed.longest.chapters} ch)</span>
              `;
              paceRecords.appendChild(lRow);
            }
          } else {
            paceRecords.style.display = 'none';
          }
        }
      } else {
        sectionPace.style.display = 'none';
      }
    }

    // 2. Monthly Completions Chart (Last 6 Months)
    if (sectionMonthly && monthlyBarChart) {
      const hasAnyCompleted = stats.monthlyCompletions.some(m => m.count > 0);
      if (hasAnyCompleted) {
        sectionMonthly.style.display = 'block';
        monthlyBarChart.innerHTML = '';
        const maxCount = Math.max(...stats.monthlyCompletions.map(m => m.count), 1);

        stats.monthlyCompletions.forEach(m => {
          const col = document.createElement('div');
          col.className = 'monthly-col';
          const heightPct = m.count > 0 ? Math.max(12, Math.round((m.count / maxCount) * 100)) : 0;
          col.innerHTML = `
            <span class="monthly-col-count" style="${m.count === 0 ? 'opacity:0;visibility:hidden;' : ''}">${m.count > 0 ? m.count : ''}</span>
            <div class="monthly-bar-track">
              <div class="monthly-bar-fill" style="height:${heightPct}%;${m.count === 0 ? 'opacity:0.12;min-height:2px;' : ''}"></div>
            </div>
            <span class="monthly-col-label">${escHtml(m.label)}</span>
          `;
          monthlyBarChart.appendChild(col);
        });
      } else {
        sectionMonthly.style.display = 'none';
      }
    }

    // 3. In-Progress Novels (Reading status)
    if (sectionInProgress && readingProgressList) {
      if (stats.inProgressNovels.length > 0) {
        sectionInProgress.style.display = 'block';
        readingProgressList.innerHTML = '';

        stats.inProgressNovels.forEach(n => {
          const item = document.createElement('div');
          item.className = 'reading-progress-item';
          const totalStr = n.chaptersTotal ? ` / ${n.chaptersTotal}` : '';
          const staleTag = n.isStale
            ? `<span class="stale-read-indicator" title="No chapters logged in 14+ days">Untouched 14d+</span>`
            : '';

          let estimateHtml = '';
          if (n.estimatedFinish) {
            const staleClass = n.estimatedFinish.isStale ? ' stale-estimate' : '';
            estimateHtml = `
              <div class="reading-row-estimate${staleClass}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>${escHtml(n.estimatedFinish.text)}</span>
              </div>
            `;
          }

          let metaHtml = '';
          if (n.estimatedFinish && !n.estimatedFinish.isStale && n.estimatedFinish.paceBasisLabel) {
            metaHtml = `<div class="reading-row-meta"><span>Last updated ${n.daysSinceUpdate === 0 ? 'today' : `${n.daysSinceUpdate}d ago`}</span> • <span>${escHtml(n.estimatedFinish.paceBasisLabel)}</span></div>`;
          } else if (n.daysSinceUpdate != null) {
            metaHtml = `<div class="reading-row-meta"><span>Last updated ${n.daysSinceUpdate === 0 ? 'today' : `${n.daysSinceUpdate}d ago`}</span></div>`;
          }

          item.innerHTML = `
            <div class="reading-item-main">
              <div class="reading-row-line1">
                <span class="reading-item-title">${escHtml(n.title)}</span>
                <span class="reading-item-ch">Ch. ${n.chaptersRead}${totalStr}</span>
              </div>
              ${estimateHtml}
              ${metaHtml}
            </div>
            <div class="reading-item-badge-wrap">
              <span class="reading-badge-days">${n.daysReading}d reading</span>
              ${staleTag}
            </div>
          `;
          // Click to view details
          item.style.cursor = 'pointer';
          item.addEventListener('click', () => {
            openNovelDetails(n.id, 'stats');
          });
          readingProgressList.appendChild(item);
        });
      } else {
        sectionInProgress.style.display = 'none';
      }
    }

    // 4. Genre Breakdown (All Time)
    if (sectionGenres && genreBreakdownList) {
      if (stats.genreBreakdown && stats.genreBreakdown.length > 0) {
        sectionGenres.style.display = 'block';
        genreBreakdownList.innerHTML = '';

        const maxGenreCount = Math.max(...stats.genreBreakdown.map(g => g.count), 1);
        const displayGenres = (!genresExpanded && stats.genreBreakdown.length > 5)
          ? stats.genreBreakdown.slice(0, 5)
          : stats.genreBreakdown;

        displayGenres.forEach(g => {
          const row = document.createElement('div');
          row.className = 'genre-row';
          const pct = Math.max(8, Math.round((g.count / maxGenreCount) * 100));

          let ratingText = '—';
          if (g.avgRating) {
            if (g.ratedCount < g.count) {
              ratingText = `★ ${g.avgRating} · ${g.ratedCount} rated`;
            } else {
              ratingText = `★ ${g.avgRating}`;
            }
          }

          row.innerHTML = `
            <div class="genre-row-header">
              <span class="genre-row-name">${escHtml(g.name)}</span>
              <div class="genre-row-stats">
                <span class="genre-rating">${ratingText}</span>
                <span class="genre-count">${g.count} novel${g.count > 1 ? 's' : ''}</span>
              </div>
            </div>
            <div class="genre-bar-track">
              <div class="genre-bar-fill" style="width: ${pct}%;"></div>
            </div>
          `;

          row.addEventListener('click', () => {
            closeStatsView(true);
            activeGenreFilter = g.name;
            if (genreFilter) genreFilter.value = g.name;
            renderLibrary();
          });
          genreBreakdownList.appendChild(row);
        });

        if (btnToggleGenres) {
          if (stats.genreBreakdown.length > 5) {
            btnToggleGenres.style.display = 'block';
            btnToggleGenres.textContent = genresExpanded
              ? 'Show less'
              : `Show all (${stats.genreBreakdown.length})`;
          } else {
            btnToggleGenres.style.display = 'none';
          }
        }
      } else {
        sectionGenres.style.display = 'none';
      }
    }

    // 5. Dropped Analysis (All Time)
    if (sectionDropped) {
      if (stats.droppedAnalysis) {
        sectionDropped.style.display = 'block';
        if (statDropChapter) {
          if (stats.droppedAnalysis.avgDroppedChapter != null) {
            if (animateNumbers && hasMotion) {
              window.Motion.countUp(statDropChapter, stats.droppedAnalysis.avgDroppedChapter, { prefix: 'Ch. ' });
            } else {
              statDropChapter.textContent = `Ch. ${stats.droppedAnalysis.avgDroppedChapter}`;
            }
          } else {
            statDropChapter.textContent = '—';
          }
        }
        if (itemDropPct && statDropPct) {
          if (stats.droppedAnalysis.avgDroppedPercentage != null) {
            itemDropPct.style.display = 'flex';
            if (animateNumbers && hasMotion) {
              window.Motion.countUp(statDropPct, stats.droppedAnalysis.avgDroppedPercentage, { suffix: '%' });
            } else {
              statDropPct.textContent = `${stats.droppedAnalysis.avgDroppedPercentage}%`;
            }
          } else {
            itemDropPct.style.display = 'none';
          }
        }
        if (itemCompletionRate && statCompletionRate) {
          if (stats.droppedAnalysis.completionRate != null) {
            itemCompletionRate.style.display = 'flex';
            if (animateNumbers && hasMotion) {
              window.Motion.countUp(statCompletionRate, stats.droppedAnalysis.completionRate, { suffix: '%' });
            } else {
              statCompletionRate.textContent = `${stats.droppedAnalysis.completionRate}%`;
            }
          } else {
            itemCompletionRate.style.display = 'none';
          }
        }
        if (droppedInsight) {
          droppedInsight.textContent = stats.droppedAnalysis.insightText;
        }
      } else {
        sectionDropped.style.display = 'none';
      }
    }

    // 6. Top Lists (All Time)
    if (sectionTopLists) {
      let hasAnyTopList = false;

      // Highest Rated
      if (blockHighestRated && listHighestRated) {
        if (stats.topLists && stats.topLists.highestRated && stats.topLists.highestRated.length > 0) {
          blockHighestRated.style.display = 'flex';
          listHighestRated.innerHTML = '';
          stats.topLists.highestRated.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'top-list-row';
            row.innerHTML = `
              <span class="top-rank rank-${idx + 1}">#${idx + 1}</span>
              <span class="top-novel-title" title="${escHtml(item.title)}">${escHtml(item.title)}</span>
              <span class="top-metric">★ ${item.rating.toFixed(1)} (${item.chaptersRead} ch)</span>
            `;
            row.addEventListener('click', () => {
              openNovelDetails(item.id, 'stats');
            });
            listHighestRated.appendChild(row);
          });
          hasAnyTopList = true;
        } else {
          blockHighestRated.style.display = 'none';
        }
      }

      // Longest Completed
      if (blockLongestCompleted && listLongestCompleted) {
        if (stats.topLists && stats.topLists.longestCompleted && stats.topLists.longestCompleted.length > 0) {
          blockLongestCompleted.style.display = 'flex';
          listLongestCompleted.innerHTML = '';
          stats.topLists.longestCompleted.forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'top-list-row';
            row.innerHTML = `
              <span class="top-rank rank-${idx + 1}">#${idx + 1}</span>
              <span class="top-novel-title" title="${escHtml(item.title)}">${escHtml(item.title)}</span>
              <span class="top-metric">${item.chaptersRead.toLocaleString()} ch</span>
            `;
            row.addEventListener('click', () => {
              openNovelDetails(item.id, 'stats');
            });
            listLongestCompleted.appendChild(row);
          });
          hasAnyTopList = true;
        } else {
          blockLongestCompleted.style.display = 'none';
        }
      }

      // Most-Read Author
      if (blockMostReadAuthor && tileMostReadAuthor) {
        if (stats.topLists && stats.topLists.mostReadAuthor) {
          blockMostReadAuthor.style.display = 'flex';
          const a = stats.topLists.mostReadAuthor;
          tileMostReadAuthor.innerHTML = `
            <span class="author-tile-name">${escHtml(a.name)}</span>
            <span class="author-tile-stats">${a.totalChapters.toLocaleString()} ch (${a.count} novel${a.count > 1 ? 's' : ''})</span>
          `;
          hasAnyTopList = true;
        } else {
          blockMostReadAuthor.style.display = 'none';
        }
      }

      sectionTopLists.style.display = hasAnyTopList ? 'block' : 'none';
    }

    // 4. Status Breakdown Bar & Legend
    if (stackedStatusBar && statusLegend) {
      stackedStatusBar.innerHTML = '';
      statusLegend.innerHTML = '';
      const colors = {
        Reading: 'var(--color-reading)',
        'Plan to Read': 'var(--color-plan)',
        Completed: 'var(--color-completed)',
        'On Hold': 'var(--color-onhold)',
        Dropped: 'var(--color-dropped)'
      };
      const total = stats.totalNovels || 1;

      Object.entries(stats.statuses).forEach(([status, count]) => {
        if (count > 0) {
          const seg = document.createElement('div');
          seg.className = 'stacked-segment';
          seg.style.width = ((count / total) * 100).toFixed(1) + '%';
          seg.style.backgroundColor = colors[status];
          seg.title = `${status}: ${count}`;
          stackedStatusBar.appendChild(seg);
        }

        const li = document.createElement('div');
        li.className = 'legend-item' + (count === 0 ? ' dimmed' : '');
        li.innerHTML = `
          <span class="legend-dot" style="background:${colors[status]}"></span>
          <span class="legend-text">${escHtml(status)}</span>
          <span class="legend-count">${count}</span>
        `;

        if (count > 0) {
          li.addEventListener('click', () => {
            closeStatsView(true);
            activeStatusFilter = status;
            statusTabs.querySelectorAll('.status-tab').forEach(t =>
              t.classList.toggle('active', t.dataset.status === status)
            );
            renderLibrary();
          });
        }
        statusLegend.appendChild(li);
      });
    }

    // 5. Rating Distribution
    if (ratingHistogram) {
      ratingHistogram.innerHTML = '';
      if (stats.ratings.totalRated === 0) {
        ratingHistogram.innerHTML = '<div class="rating-empty-state">No rated novels yet</div>';
      } else {
        const bucketLabels = [
          { key: '5', label: '5★' },
          { key: '4.5', label: '4.5★' },
          { key: '4', label: '4★' },
          { key: '3.5', label: '3.5★' },
          { key: '3', label: '3★' },
          { key: '<3', label: '<3★' }
        ];
        const maxCount = Math.max(...Object.values(stats.ratings.distribution), 1);
        bucketLabels.forEach(({ key, label }) => {
          const count = stats.ratings.distribution[key];
          const pct = ((count / maxCount) * 100).toFixed(0);
          const row = document.createElement('div');
          row.className = 'rating-bar-row' + (count === 0 ? ' dimmed' : '');
          row.innerHTML = `
            <span class="rating-bar-label">${label}</span>
            <div class="rating-bar-track"><div class="rating-bar-fill" style="width:${count > 0 ? pct : 0}%"></div></div>
            <span class="rating-bar-count">${count}</span>`;
          ratingHistogram.appendChild(row);
        });
      }
    }
  }

  let _lastTabCountsKey = '';
  function updateTabBadges() {
    const counts = { ALL: library.length, Reading: 0, 'Plan to Read': 0, Completed: 0, 'On Hold': 0, Dropped: 0 };
    library.forEach(n => { if (counts[n.status] !== undefined) counts[n.status]++; });
    const key = `${counts.ALL}|${counts.Reading}|${counts['Plan to Read']}|${counts.Completed}|${counts['On Hold']}|${counts.Dropped}`;
    if (key === _lastTabCountsKey) return;
    _lastTabCountsKey = key;
    document.getElementById('count-all').textContent = counts.ALL;
    document.getElementById('count-reading').textContent = counts.Reading;
    document.getElementById('count-plan').textContent = counts['Plan to Read'];
    document.getElementById('count-completed').textContent = counts.Completed;
    document.getElementById('count-onhold').textContent = counts['On Hold'];
    document.getElementById('count-dropped').textContent = counts.Dropped;
  }

  let _lastGenreKey = '';
  function updateGenreDropdown() {
    if (!genreFilter) return;
    // A8 — De-duplicate genres case-insensitively, keeping first-seen casing
    const genreMap = new Map();
    library.forEach(n => {
      if (n.genre && typeof n.genre === 'string') {
        const parts = n.genre.split(',').map(s => s.trim()).filter(Boolean);
        parts.forEach(val => {
          const lower = val.toLowerCase();
          if (!genreMap.has(lower)) {
            genreMap.set(lower, val);
          }
        });
      }
    });

    const sortedGenres = Array.from(genreMap.values()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const currentVal = (genreFilter.value || 'ALL').trim();
    const genreKey = sortedGenres.join(';;') + '::' + currentVal;
    if (genreKey === _lastGenreKey) return;
    _lastGenreKey = genreKey;

    const currentValLower = currentVal.toLowerCase();
    genreFilter.innerHTML = '<option value="ALL">All Genres</option>';

    sortedGenres.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = g;
      genreFilter.appendChild(opt);
    });

    // A8 — If the previously selected genre still exists (case-insensitive), restore it; otherwise reset activeGenreFilter = 'ALL'
    if (currentVal !== 'ALL' && genreMap.has(currentValLower)) {
      const matchingCased = genreMap.get(currentValLower);
      genreFilter.value = matchingCased;
      activeGenreFilter = matchingCased;
    } else {
      genreFilter.value = 'ALL';
      activeGenreFilter = 'ALL';
    }
  }

  function applyViewMode(mode, doRender = true) {
    currentView = mode;
    try {
      localStorage.setItem(VIEW_PREF_KEY, mode);
    } catch (e) {
      // ignore storage failure
    }

    if (mode === 'list') {
      novelsContainer.className = 'novels-list';
      viewListBtn.classList.add('active');
      viewGridBtn.classList.remove('active');
    } else {
      novelsContainer.className = 'novels-grid';
      viewGridBtn.classList.add('active');
      viewListBtn.classList.remove('active');
    }
    if (doRender) renderLibrary();
  }

  // --- Export (Fix #2: use Android.saveJson bridge; blob fallback for browser) ---
  function exportLibraryJson() {
    if (library.length === 0) {
      showToast('Library is empty — nothing to export.', 'error');
      return;
    }

    const exportData = { app: 'NovelShelf', version: '1.0', exportedAt: new Date().toISOString(), novels: library };
    const jsonStr = JSON.stringify(exportData, null, 2);
    const filename = 'novel-shelf-backup-' + localDateString() + '.json';

    // Fix #2 — if running in the Android WebView with our bridge, use it
    if (window.Android && typeof window.Android.saveJson === 'function') {
      // Set up callback before invoking native (A13/B2: signature (success, cancelled))
      window._onExportResult = function (success, cancelled) {
        window._onExportResult = null;
        if (success) {
          showToast('Library backup saved!', 'success');
          closeBackupView(true);
        } else if (cancelled) {
          showToast('Export cancelled.', 'info');
        } else {
          showToast('Export failed.', 'error');
        }
      };
      window.Android.saveJson(filename, jsonStr);
      return;
    }

    // Browser fallback: Blob + anchor
    try {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Library backup exported!', 'success');
      closeBackupView(true);
    } catch (err) {
      showToast('Export failed on this device.', 'error');
    }
  }

  // --- Export TXT Summary ---
  function exportLibraryTxt() {
    if (library.length === 0) {
      showToast('Library is empty — nothing to export.', 'error');
      return;
    }

    const blocks = library.map(novel => {
      const title = novel.title || 'Untitled';
      const ch = novel.chaptersRead != null ? novel.chaptersRead : 0;

      const sDate = formatDateShort(novel.started);
      const fDate = formatDateShort(novel.finished);
      let dateLine = '';
      if (sDate && fDate) {
        dateLine = `${sDate} - ${fDate}`;
      } else if (sDate) {
        dateLine = `${sDate} - Present`;
      } else if (fDate) {
        dateLine = fDate;
      } else {
        dateLine = 'N/A';
      }

      // Convert 5-star rating scale to 10-point scale: rating * 2
      const ratingVal = novel.rating != null && novel.rating > 0 ? (novel.rating * 2) : 0;
      const ratingLine = ratingVal > 0 ? `${Number(ratingVal.toFixed(1))}/10` : 'Unrated';
      const notesLine = (novel.notes && novel.notes.trim()) ? novel.notes.trim() : 'No notes.';

      return `[ ${title} ]\nCh: ${ch} | Date: ${dateLine}\nRating: ${ratingLine}\nNotes: ${notesLine}`;
    });

    const txtContent = blocks.join('\n\n') + '\n';
    const filename = 'novel-shelf-export-' + localDateString() + '.txt';

    if (window.Android && typeof window.Android.saveText === 'function') {
      window._onExportResult = function (success, cancelled) {
        window._onExportResult = null;
        if (success) {
          showToast('Text summary saved!', 'success');
          closeBackupView(true);
        } else if (cancelled) {
          showToast('Export cancelled.', 'info');
        } else {
          showToast('Export failed.', 'error');
        }
      };
      window.Android.saveText(filename, txtContent);
      return;
    }

    // Fallback: Browser Blob download
    try {
      const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Text summary exported!', 'success');
      closeBackupView(true);
    } catch (err) {
      showToast('Export failed on this device.', 'error');
    }
  }

  // Fix #11 — normalize an imported novel item (A3, A10)
  function normalizeImportedNovel(n) {
    const VALID_STATUSES = new Set(['Reading', 'Plan to Read', 'Completed', 'On Hold', 'Dropped']);
    const total = n.chaptersTotal ? Math.max(0, parseInt(n.chaptersTotal, 10) || 0) || null : null;
    let read = Math.max(0, parseInt(n.chaptersRead, 10) || 0);
    // A10 — clamp read <= total
    if (total && read > total) {
      read = total;
    }

    // A10 — snap rating to nearest 0.5
    const rawRating = parseFloat(n.rating) || 0;
    const rating = Math.max(0, Math.min(5, Math.round(rawRating * 2) / 2));

    // A3 — date format validation: keep only if /^\d{4}-\d{2}-\d{2}$/
    let started = (typeof n.started === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.started)) ? n.started : '';
    let finished = (typeof n.finished === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.finished)) ? n.finished : '';
    let startedEstimated = Boolean(n.startedEstimated);
    let finishedEstimated = Boolean(n.finishedEstimated);

    // Auto-set & Backfill:
    // If started is empty, backfill from createdAt if available, otherwise today
    if (!started) {
      if (n.createdAt) {
        started = localDateString(new Date(n.createdAt));
        startedEstimated = true;
      } else {
        started = localDateString();
      }
    }

    // If Completed and finished is empty, backfill from updatedAt if available
    const status = VALID_STATUSES.has(n.status) ? n.status : 'Plan to Read';
    if (status === 'Completed' && !finished) {
      if (n.updatedAt) {
        finished = localDateString(new Date(n.updatedAt));
        finishedEstimated = true;
      } else {
        finished = localDateString();
      }
    } else if (status !== 'Completed') {
      finished = '';
      finishedEstimated = false;
    }

    return {
      id: (n.id && typeof n.id === 'string' && n.id.trim())
        ? n.id.trim()
        : 'novel_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      title: String(n.title || 'Untitled').slice(0, 300),
      author: String(n.author || '').slice(0, 200),
      status,
      chaptersRead: read,
      chaptersTotal: total,
      rating,
      started,
      finished,
      startedEstimated,
      finishedEstimated,
      source: String(n.source || '').slice(0, 200),
      link: /^https?:\/\//i.test(n.link || '') ? n.link : '',
      genre: String(n.genre || '').slice(0, 100),
      tags: Array.isArray(n.tags) ? n.tags.map(t => String(t).trim()).filter(Boolean) : [],
      notes: String(n.notes || '').slice(0, 5000),
      cover: typeof n.cover === 'string' ? n.cover : '',
      createdAt: Number(n.createdAt) || Date.now(),
      updatedAt: Number(n.updatedAt) || Date.now(),
    };
  }

  function importLibraryJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const raw = Array.isArray(data) ? data : (data.novels || []);

        if (!Array.isArray(raw) || raw.length === 0) {
          showToast('Invalid backup or no novels found.', 'error');
          return;
        }

        // Fix #11 — normalise every item
        const importedNovels = raw.map(normalizeImportedNovel);

        // Fix #4 — 3-button dialog
        const choice = await showImportChoiceDialog(
          `Found ${importedNovels.length} novel${importedNovels.length !== 1 ? 's' : ''} in backup.\n\nMerge = keep yours + add new ones.\nReplace = overwrite your library.`
        );
        if (choice === 'cancel') return;

        // A4 — snapshot for rollback
        const snapshot = JSON.parse(JSON.stringify(library));
        let successMessage = '';

        if (choice === 'replace') {
          // Step 2: Explicit confirmation stating how many novels will be deleted
          if (library.length > 0) {
            const confirmed = await showConfirm(
              `Are you sure you want to replace your library? This will delete ${library.length} existing novel${library.length !== 1 ? 's' : ''}.`,
              'Yes, Replace',
              'Cancel'
            );
            if (!confirmed) return;
          }

          // A6 — de-duplicate imported ids (keep last)
          const map = new Map();
          importedNovels.forEach(n => map.set(n.id, n));
          library = Array.from(map.values());
          successMessage = `Restored ${library.length} novels!`;
        } else {
          // A6 — Merge: local progress wins on id conflict.
          // Count actual added novels.
          const existingIds = new Set(library.map(n => n.id));
          let addedCount = 0;

          // De-duplicate imported items among themselves (regenerate id for duplicates within import if needed)
          const seenImportIds = new Set();
          const dedupedImported = [];
          importedNovels.forEach(n => {
            let item = n;
            if (seenImportIds.has(item.id)) {
              item = { ...item, id: 'novel_' + Date.now() + '_' + Math.random().toString(36).slice(2) };
            }
            seenImportIds.add(item.id);
            dedupedImported.push(item);
          });

          // Imported first, then existing library overwrites so local wins
          const map = new Map();
          dedupedImported.forEach(n => {
            if (!existingIds.has(n.id)) {
              addedCount++;
            }
            map.set(n.id, n);
          });
          library.forEach(n => map.set(n.id, n)); // local wins!
          library = Array.from(map.values());

          successMessage = `Merged: ${addedCount} new novels added`;
        }

        const saved = saveLibrary();
        if (!saved) {
          library = snapshot;
          saveLibrary();
          return;
        }

        renderLibrary();
        updateGenreDropdown();
        closeBackupView(true);
        showToast(successMessage, 'success');
      } catch (err) {
        console.error(err);
        showToast('Error reading backup. Make sure it is a valid JSON file.', 'error');
      }
    };
    reader.onerror = () => showToast('Failed to read file.', 'error');
    reader.readAsText(file);
  }

  // Fix #3 — guard loadSampleData when library is non-empty
  async function loadSampleData() {
    const snapshot = JSON.parse(JSON.stringify(library));
    if (library.length > 0) {
      const choice = await showImportChoiceDialog(
        `You already have ${library.length} novel${library.length !== 1 ? 's' : ''} in your library.\n\nMerge = add sample novels alongside yours.\nReplace = overwrite your library with samples.`
      );
      if (choice === 'cancel') return;
      if (choice === 'replace') {
        // Step 2: Explicit confirmation stating how many novels will be deleted
        const confirmed = await showConfirm(
          `Are you sure you want to replace your library? This will delete ${library.length} existing novel${library.length !== 1 ? 's' : ''}.`,
          'Yes, Replace',
          'Cancel'
        );
        if (!confirmed) return;
        library = JSON.parse(JSON.stringify(SAMPLE_NOVELS));
      } else {
        // Merge — don't overwrite existing entries with the same id
        const map = new Map();
        JSON.parse(JSON.stringify(SAMPLE_NOVELS)).forEach(n => map.set(n.id, n));
        library.forEach(n => map.set(n.id, n)); // existing wins
        library = Array.from(map.values());
      }
    } else {
      library = JSON.parse(JSON.stringify(SAMPLE_NOVELS));
    }
    const saved = saveLibrary();
    if (!saved) {
      library = snapshot;
      saveLibrary();
      return;
    }
    renderLibrary();
    updateGenreDropdown();
    showToast('Loaded 5 sample novels!', 'success');
    closeBackupView(true);
  }

  // --- Toast ---
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast' + (type === 'success' ? ' toast-success' : type === 'error' ? ' toast-error' : '');
    const icon = type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ';
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${escHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    // Limit max toasts
    const allToasts = toastContainer.querySelectorAll('.toast');
    if (allToasts.length > 3) allToasts[0].remove();

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  function escHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // --- Event Listeners ---
  function setupEventListeners() {
    if (btnAddNovelTop) btnAddNovelTop.addEventListener('click', openAddModal);
    if (btnAddNovelEmpty) btnAddNovelEmpty.addEventListener('click', openAddModal);

    // Form
    if (btnCloseForm) btnCloseForm.addEventListener('click', () => closeFormModal(true));
    if (btnCancelForm) btnCancelForm.addEventListener('click', () => closeFormModal(true));
    if (novelForm) novelForm.addEventListener('submit', handleFormSubmit);

    // Stats Screen (Full-page tab)
    if (btnStatsToggle) btnStatsToggle.addEventListener('click', openStatsView);
    if (btnBackStats) btnBackStats.addEventListener('click', () => closeStatsView(true));
    if (statsTimePills) {
      statsTimePills.addEventListener('click', (e) => {
        const btn = e.target.closest('.time-pill-btn');
        if (!btn) return;
        statsTimePills.querySelectorAll('.time-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        statsTimeFilter = btn.dataset.filter || 'all';
        updateStatsDashboard(true);
      });
    }
    if (btnToggleGenres) {
      btnToggleGenres.addEventListener('click', () => {
        genresExpanded = !genresExpanded;
        updateStatsDashboard();
      });
    }

    // Backup & Restore Screen (Full-page tab)
    if (btnBackupMenu) btnBackupMenu.addEventListener('click', openBackupView);
    if (btnBackBackup) btnBackBackup.addEventListener('click', () => closeBackupView(true));
    if (btnExportJson) btnExportJson.addEventListener('click', exportLibraryJson);
    if (btnExportTxt) btnExportTxt.addEventListener('click', exportLibraryTxt);
    if (importJsonFile) {
      importJsonFile.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) importLibraryJson(e.target.files[0]);
        e.target.value = ''; // reset so same file can be imported again
      });
    }
    if (btnLoadSampleMenu) btnLoadSampleMenu.addEventListener('click', loadSampleData);
    if (btnLoadSample) btnLoadSample.addEventListener('click', loadSampleData);

    // Reduce Effects Setting Toggle
    const toggleReduceEffects = document.getElementById('toggle-reduce-effects');
    const toggleReduceEffectsStatus = document.getElementById('toggle-reduce-effects-status');
    const updateToggleStatusLabel = (isChecked) => {
      if (toggleReduceEffectsStatus) {
        toggleReduceEffectsStatus.textContent = isChecked ? 'On' : 'Off';
        toggleReduceEffectsStatus.classList.toggle('active', Boolean(isChecked));
      }
    };
    if (toggleReduceEffects) {
      const isCurrentlyReduced = (typeof window.effectsReduced === 'function')
        ? window.effectsReduced()
        : document.documentElement.classList.contains('reduced-effects');
      toggleReduceEffects.checked = isCurrentlyReduced;
      updateToggleStatusLabel(isCurrentlyReduced);
      toggleReduceEffects.addEventListener('change', () => {
        const isChecked = toggleReduceEffects.checked;
        updateToggleStatusLabel(isChecked);
        try {
          localStorage.setItem('novelshelf_reduce_effects', String(isChecked));
        } catch (e) { }
        if (isChecked) {
          document.documentElement.classList.add('reduced-effects');
          document.documentElement.setAttribute('data-reduced-motion', 'true');
        } else {
          document.documentElement.classList.remove('reduced-effects');
          document.documentElement.removeAttribute('data-reduced-motion');
        }
        showToast(isChecked ? 'Reduce effects enabled' : 'Full visual effects enabled', 'info');
      });
    }

    // Floating Bottom Navigation Tabs
    if (floatingNav) {
      floatingNav.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.nav-tab-btn');
        if (tabBtn && tabBtn.dataset.tab) {
          if (window.Motion) Motion.haptic('tick');
          showScreen(tabBtn.dataset.tab);
        }
      });
    }

    if (searchInput && floatingNav) {
      searchInput.addEventListener('focus', () => {
        floatingNav.classList.add('nav-hidden');
      });
      searchInput.addEventListener('blur', () => {
        if (isRootTab(currentScreen)) {
          floatingNav.classList.remove('nav-hidden');
        }
      });
    }

    window.addEventListener('resize', () => {
      updateNavState(currentScreen);
    });

    // Search — fix #14: debounce to avoid flickering on every keystroke
    const debouncedRender = debounce(renderLibrary, 150);
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      btnClearSearch.style.display = searchQuery ? 'block' : 'none';
      debouncedRender();
    });
    btnClearSearch.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      btnClearSearch.style.display = 'none';
      renderLibrary();
    });
    btnResetFilters.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      btnClearSearch.style.display = 'none';
      activeStatusFilter = 'ALL';
      activeGenreFilter = 'ALL';
      activeSort = 'updated-desc';
      if (sortFilter) sortFilter.value = 'updated-desc';
      if (genreFilter) genreFilter.value = 'ALL';
      statusTabs.querySelectorAll('.status-tab').forEach(t =>
        t.classList.toggle('active', t.dataset.status === 'ALL')
      );
      renderLibrary();
    });

    // Status tabs
    statusTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.status-tab');
      if (!tab) return;
      statusTabs.querySelectorAll('.status-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeStatusFilter = tab.dataset.status;
      renderLibrary();
    });

    if (genreFilter) genreFilter.addEventListener('change', (e) => { activeGenreFilter = e.target.value; renderLibrary(); });
    if (sortFilter) sortFilter.addEventListener('change', (e) => { activeSort = e.target.value; renderLibrary(); });

    // View toggles
    viewGridBtn.addEventListener('click', () => applyViewMode('grid'));
    viewListBtn.addEventListener('click', () => applyViewMode('list'));

    // ---- Star Rating — Mouse + Touch ----
    function handleRatingInteract(e) {
      const val = getRatingFromElement(e.target);
      if (val !== null) setRating(val);
    }
    function handleRatingPreview(e) {
      const val = getRatingFromElement(e.target);
      if (val !== null) {
        ratingValueDisplay.textContent = val.toFixed(1) + ' ★';
        renderStars(val);
      }
    }
    function handleRatingReset() {
      renderStars(currentRating);
      ratingValueDisplay.textContent = currentRating === 0 ? '0.0 ★' : currentRating.toFixed(1) + ' ★';
    }

    // Mouse
    starRatingControl.addEventListener('click', handleRatingInteract);
    starRatingControl.addEventListener('mousemove', handleRatingPreview);
    starRatingControl.addEventListener('mouseleave', handleRatingReset);

    // Touch (Android)
    starRatingControl.addEventListener('touchstart', (e) => {
      ratingTouchActive = true;
    }, { passive: true });
    starRatingControl.addEventListener('touchmove', (e) => {
      if (!ratingTouchActive) return;
      e.preventDefault();
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el) {
        const val = getRatingFromElement(el);
        if (val !== null) {
          ratingValueDisplay.textContent = val.toFixed(1) + ' ★';
          renderStars(val);
        }
      }
    }, { passive: false });
    starRatingControl.addEventListener('touchend', (e) => {
      if (!ratingTouchActive) return;
      ratingTouchActive = false;
      const touch = e.changedTouches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el) {
        const val = getRatingFromElement(el);
        if (val !== null) setRating(val);
        else handleRatingReset();
      } else {
        handleRatingReset();
      }
    }, { passive: true });

    btnClearRating.addEventListener('click', () => setRating(0));

    // Quick date buttons — fix #5: use local date
    document.querySelectorAll('.btn-quick-date').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (input) input.value = localDateString();
      });
    });

    // Genre quick pills
    const genrePills = document.getElementById('genre-quick-pills');
    if (genrePills) {
      genrePills.addEventListener('click', (e) => {
        const pill = e.target.closest('.pill-btn');
        if (!pill) return;
        formGenre.value = pill.dataset.genre;
        // Visually mark active pill
        genrePills.querySelectorAll('.pill-btn').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
      });
    }

    // A13 — sync genre quick pills when typing in formGenre
    if (formGenre && genrePills) {
      formGenre.addEventListener('input', () => {
        const val = formGenre.value.trim().toLowerCase();
        genrePills.querySelectorAll('.pill-btn').forEach(p => {
          p.classList.toggle('active', p.dataset.genre.toLowerCase() === val);
        });
      });
    }

    // Reading status quick pills
    const statusPillsContainer = document.getElementById('status-quick-pills');
    if (statusPillsContainer) {
      statusPillsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.status-pill-btn');
        if (!btn) return;
        setStatusPill(btn.dataset.status, true); // true = auto-fill dates
      });
    }

    // A2 — Smart focus scroll: center field when obscured or near edges
    if (novelForm) {
      const entryFields = novelForm.querySelectorAll('input:not([type="hidden"]), select, textarea');
      entryFields.forEach(field => {
        field.addEventListener('focus', () => {
          setTimeout(() => {
            if (modalNovelForm.style.display === 'none') return;
            const fieldRect = field.getBoundingClientRect();
            if (fieldRect.bottom > window.innerHeight - 12 || fieldRect.top < 8) {
              field.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
          }, 250);
        });
      });
    }

    // Cover photo
    coverPreviewBox.addEventListener('click', () => {
      if (coverImgPreview.style.display !== 'block') coverFileInput.click();
    });
    coverFileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) handleCoverFile(e.target.files[0]);
    });

    // A12 — Cover URL input debounced and error handled
    coverImgPreview.addEventListener('error', () => {
      // Only handle error if an actual image was being loaded
      if (coverImgPreview.getAttribute('src')) {
        showToast("Couldn't load that image", 'error');
        resetCoverPreview();
      }
    });

    const handleCoverUrlChange = debounce(() => {
      const url = normalizeUrl(coverUrlInput.value);
      if (url) {
        setCoverPreview(url);
      } else if (coverImgPreview.src && !coverImgPreview.src.startsWith('data:')) {
        resetCoverPreview();
      }
    }, 400);

    coverUrlInput.addEventListener('input', handleCoverUrlChange);

    btnRemoveCover.addEventListener('click', (e) => {
      e.stopPropagation();
      resetCoverPreview();
    });

    // Details navigation
    btnBackShelf.addEventListener('click', () => closeNovelDetails(true));
    btnDetailEdit.addEventListener('click', () => {
      if (viewingNovelId) {
        formOpenedFromDetails = true; // A1 — set flag when opened from details
        openEditModal(viewingNovelId);
      }
    });
    btnDetailDelete.addEventListener('click', () => {
      if (viewingNovelId) deleteNovel(viewingNovelId);
    });

    // --- Centralized Back Sequence ---
    // 1. If confirm dialog open: cancel it
    // 2. Else if on sub-screen (details or form): pop back to previous screen
    // 3. Else if on any root tab other than Shelf (stats, backup): go to Shelf
    // 4. Else if on Shelf: exit app (return false to native Android dispatcher)
    function handleAppBack() {
      if (confirmDialog && confirmDialog.style.display === 'flex') {
        if (typeof activeConfirmCancel === 'function') {
          activeConfirmCancel();
        }
        updateNativeBackState();
        return true;
      }

      if (currentScreen === 'form') {
        closeFormModal(true);
        return true;
      }
      if (currentScreen === 'details') {
        closeNovelDetails(true);
        return true;
      }

      if (currentScreen === 'stats' || currentScreen === 'backup') {
        showScreen('shelf');
        return true;
      }

      return false;
    }
    window.handleAppBack = handleAppBack;

    // History popstate (Android back button & browser back navigation)
    window.addEventListener('popstate', (e) => {
      // If confirm dialog open: cancel it
      if (confirmDialog && confirmDialog.style.display === 'flex') {
        if (typeof activeConfirmCancel === 'function') {
          activeConfirmCancel();
        }
        updateNativeBackState();
        return;
      }

      const state = e.state;
      if (state && state.screen) {
        showScreen(state.screen, { push: false, id: state.id, from: state.from });
      } else {
        showScreen('shelf', { push: false });
      }
    });

    // Escape to close screens / modals
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        handleAppBack();
      }
    });

    // Pause ambient background animation when app is in background to save GPU & battery
    document.addEventListener('visibilitychange', () => {
      document.body.classList.toggle('ambient-paused', document.hidden);
    });

    // Modal backdrop click and scroll lock
    // (modalNovelForm is now a dedicated full-page screen)
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
