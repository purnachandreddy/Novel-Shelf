const assert = require('assert');
const fs = require('fs');
const path = require('path');
const StatsCalculator = require('../stats-calculator.js');

console.log('--- Running Stats Calculator Unit Tests ---');

let passed = 0;
let failed = 0;

function it(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${desc}`);
    console.error(`    ${err.stack || err.message}`);
    failed++;
  }
}

// 1. Timezone and Local Date Parsing
it('parseLocalDate: parses YYYY-MM-DD as local date without UTC off-by-one', () => {
  const d = StatsCalculator.parseLocalDate('2026-05-15');
  assert.notStrictEqual(d, null);
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 4); // 0-indexed May
  assert.strictEqual(d.getDate(), 15);
  assert.strictEqual(d.getHours(), 0);
  assert.strictEqual(d.getMinutes(), 0);
});

it('parseLocalDate: returns null on invalid or empty date strings', () => {
  assert.strictEqual(StatsCalculator.parseLocalDate(''), null);
  assert.strictEqual(StatsCalculator.parseLocalDate(null), null);
  assert.strictEqual(StatsCalculator.parseLocalDate(undefined), null);
  assert.strictEqual(StatsCalculator.parseLocalDate('not-a-date'), null);
  assert.strictEqual(StatsCalculator.parseLocalDate('2026-13-45'), null);
  assert.strictEqual(StatsCalculator.parseLocalDate('2026-02-30'), null);
});

it('formatLocalDate: formats Date to YYYY-MM-DD correctly', () => {
  const d = new Date(2026, 4, 9); // May 9, 2026
  assert.strictEqual(StatsCalculator.formatLocalDate(d), '2026-05-09');
});

it('formatDateShort: formats YYYY-MM-DD to DD/MM/YY correctly', () => {
  assert.strictEqual(StatsCalculator.formatDateShort('2026-05-09'), '09/05/26');
  assert.strictEqual(StatsCalculator.formatDateShort('2024-11-20'), '20/11/24');
  assert.strictEqual(StatsCalculator.formatDateShort(''), '');
  assert.strictEqual(StatsCalculator.formatDateShort(null), '');
});

it('diffDays: calculates day difference correctly', () => {
  assert.strictEqual(StatsCalculator.diffDays('2026-05-01', '2026-05-11'), 10);
  assert.strictEqual(StatsCalculator.diffDays('2026-05-11', '2026-05-01'), -10);
  assert.strictEqual(StatsCalculator.diffDays('2026-05-01', '2026-05-01'), 0);
  assert.strictEqual(StatsCalculator.diffDays(null, '2026-05-01'), null);
  assert.strictEqual(StatsCalculator.diffDays('2026-05-01', null), null);
});

// 2. Empty Library & Edge Cases
it('computeStats: handles empty library gracefully', () => {
  const now = new Date(2026, 10, 14);
  const stats = StatsCalculator.computeStats([], 'all', now);

  assert.strictEqual(stats.totalNovels, 0);
  assert.strictEqual(stats.chapters.total, 0);
  assert.strictEqual(stats.chapters.inCompleted, 0);
  assert.strictEqual(stats.chapters.inReading, 0);
  assert.strictEqual(stats.completed.count, 0);
  assert.strictEqual(stats.completed.avgDaysToFinish, null);
  assert.strictEqual(stats.completed.avgReadingPace, null);
  assert.strictEqual(stats.completed.fastest, null);
  assert.strictEqual(stats.completed.longest, null);
  assert.strictEqual(stats.ratings.average, null);
  assert.strictEqual(stats.ratings.totalRated, 0);
  assert.strictEqual(stats.monthlyCompletions.length, 6);
  assert.strictEqual(stats.monthlyCompletions.every(m => m.count === 0), true);
  assert.strictEqual(stats.inProgressNovels.length, 0);
  assert.strictEqual(stats.genreBreakdown, null);
  assert.strictEqual(stats.droppedAnalysis, null);
  assert.strictEqual(stats.topLists.highestRated.length, 0);
  assert.strictEqual(stats.topLists.longestCompleted.length, 0);
  assert.strictEqual(stats.topLists.mostReadAuthor, null);
});

it('computeStats: handles rating 0 as unrated everywhere', () => {
  const now = new Date(2026, 10, 14);
  const novels = [
    { id: '1', title: 'Unrated 1', status: 'Reading', rating: 0, chaptersRead: 10, genre: 'Fantasy' },
    { id: '2', title: 'Unrated 2', status: 'Plan to Read', rating: '0', chaptersRead: 0, genre: 'Sci-Fi' },
    { id: '3', title: 'Rated Novel', status: 'Completed', rating: 4.5, chaptersRead: 50, genre: 'Fantasy' }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);

  assert.strictEqual(stats.ratings.average, '4.5');
  assert.strictEqual(stats.ratings.totalRated, 1);
  // Top lists: highest rated should only have 1 novel (the rated one)
  assert.strictEqual(stats.topLists.highestRated.length, 1);
  assert.strictEqual(stats.topLists.highestRated[0].title, 'Rated Novel');
  // Genre Sci-Fi has only unrated novel -> avgRating null
  const scifi = stats.genreBreakdown.find(g => g.name === 'Sci-Fi');
  assert.strictEqual(scifi.avgRating, null);
  // Genre Fantasy has 1 rated novel -> avgRating '4.5'
  const fantasy = stats.genreBreakdown.find(g => g.name === 'Fantasy');
  assert.strictEqual(fantasy.avgRating, '4.5');
});

// 3. Same-Day Completion Clamp & Total Chapters / Total Days Pace
it('computeStats: clamps same-day completions to minimum 1 day and calculates pace as total chapters / total days', () => {
  const now = new Date(2026, 10, 14);
  const novels = [
    {
      id: '1',
      title: 'Quick Read',
      status: 'Completed',
      started: '2026-10-10',
      finished: '2026-10-10', // 0 days -> clamped to 1
      chaptersRead: 25,
      rating: 4.5
    },
    {
      id: '2',
      title: 'Normal Read',
      status: 'Completed',
      started: '2026-10-01',
      finished: '2026-10-05', // 4 days
      chaptersRead: 35,
      rating: 4.0
    }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);

  assert.strictEqual(stats.completed.count, 2);
  // Total chapters = 25 + 35 = 60; Total days = 1 + 4 = 5. Pace = 60 / 5 = 12.0 ch/day
  assert.strictEqual(stats.completed.avgReadingPace, '12.0');
});

// 4. Exclusion of Estimated Dates
it('computeStats: excludes estimated dates from pace, avgDaysToFinish, fastest, and longest', () => {
  const now = new Date(2026, 10, 14);
  const novels = [
    {
      id: '1',
      title: 'Accurate Novel',
      status: 'Completed',
      started: '2026-10-01',
      finished: '2026-10-11', // 10 days
      chaptersRead: 100,
      startedEstimated: false,
      finishedEstimated: false
    },
    {
      id: '2',
      title: 'Estimated Novel',
      status: 'Completed',
      started: '2026-09-01',
      finished: '2026-09-03', // 2 days, would skew fastest/pace if included
      chaptersRead: 500,
      startedEstimated: true,
      finishedEstimated: false
    }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);

  assert.strictEqual(stats.completed.count, 2);
  assert.strictEqual(stats.completed.avgDaysToFinish, 10);
  assert.strictEqual(stats.completed.avgReadingPace, '10.0');
  assert.deepStrictEqual(stats.completed.fastest, { title: 'Accurate Novel', days: 10, chapters: 100 });
});

it('computeStats: auto-complete via chapter increment sets finishedEstimated = false, allowing novel to count in pace stats', () => {
  const now = new Date(2026, 10, 14);
  // Novel that was reading with estimated completion flag from backfill
  const novel = {
    id: 'novel-auto',
    title: 'Auto Completed Novel',
    status: 'Reading',
    started: '2026-11-04',
    startedEstimated: false,
    finished: '',
    finishedEstimated: true, // was previously estimated
    chaptersRead: 99,
    chaptersTotal: 100
  };

  // Simulate incrementChapter() completion logic
  novel.chaptersRead++;
  if (novel.chaptersTotal && novel.chaptersRead >= novel.chaptersTotal && novel.status !== 'Completed') {
    novel.status = 'Completed';
    novel.finished = '2026-11-14'; // 10 days
    novel.finishedEstimated = false;
  }

  const stats = StatsCalculator.computeStats([novel], 'all', now);
  assert.strictEqual(stats.completed.count, 1);
  assert.strictEqual(stats.completed.avgDaysToFinish, 10);
  assert.strictEqual(stats.completed.avgReadingPace, '10.0');
  assert.deepStrictEqual(stats.completed.fastest, { title: 'Auto Completed Novel', days: 10, chapters: 100 });
});

it('computeStats: form edit clearing finishedEstimated and startedEstimated allows novel to count in pace stats', () => {
  const now = new Date(2026, 10, 14);
  // Novel imported with estimated dates
  const importedNovel = {
    id: 'novel-edit',
    title: 'Edited Novel',
    status: 'Completed',
    started: '2026-10-01',
    finished: '2026-10-05',
    startedEstimated: true,
    finishedEstimated: true,
    chaptersRead: 100,
    chaptersTotal: 100
  };

  // Before edit: novel is excluded from pace stats
  const beforeStats = StatsCalculator.computeStats([importedNovel], 'all', now);
  assert.strictEqual(beforeStats.completed.count, 1);
  assert.strictEqual(beforeStats.completed.avgReadingPace, null);
  assert.strictEqual(beforeStats.completed.fastest, null);

  // User edits form: provides actual dates
  const formStarted = '2026-10-01';
  const formFinished = '2026-10-11'; // changed finished date (10 days)

  const startedChanged = formStarted !== importedNovel.started;
  const finishedChanged = formFinished !== importedNovel.finished;

  const editedNovel = {
    ...importedNovel,
    started: formStarted,
    finished: formFinished,
    startedEstimated: false, // user verified/entered started
    finishedEstimated: finishedChanged ? false : importedNovel.finishedEstimated
  };

  const afterStats = StatsCalculator.computeStats([editedNovel], 'all', now);
  assert.strictEqual(afterStats.completed.count, 1);
  assert.strictEqual(afterStats.completed.avgDaysToFinish, 10);
  assert.strictEqual(afterStats.completed.avgReadingPace, '10.0');
  assert.deepStrictEqual(afterStats.completed.fastest, { title: 'Edited Novel', days: 10, chapters: 100 });
});

// 5. FEATURE 1: Estimated finish date for in-progress novels
it('computeStats: calculates finish estimate using novel own pace when daysReading >= 3 and active', () => {
  const now = new Date(2026, 10, 14); // Nov 14, 2026
  const novels = [
    {
      id: '1',
      title: 'Finished Benchmark',
      status: 'Completed',
      started: '2026-10-01',
      finished: '2026-10-11', // 10 days
      chaptersRead: 100 // pace = 10 ch/day
    },
    {
      id: '2',
      title: 'Active Reading (Own Pace)',
      status: 'Reading',
      started: '2026-11-01', // 13 days reading (>= 3)
      updatedAt: '2026-11-13T10:00:00.000Z', // 1 day ago (not stale)
      chaptersRead: 50,
      chaptersTotal: 150 // remaining = 100 ch -> 100 / (50/13) = 26 days -> Dec 10
    }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);
  const ownPace = stats.inProgressNovels.find(n => n.id === '2');
  assert.notStrictEqual(ownPace.estimatedFinish, null);
  assert.strictEqual(ownPace.estimatedFinish.daysLeft, 26);
  assert.strictEqual(ownPace.estimatedFinish.targetDateFormatted, 'Dec 10');
  assert.strictEqual(ownPace.estimatedFinish.paceBasisLabel, "this novel's pace");
  assert.strictEqual(ownPace.estimatedFinish.text, '~26 days left (around Dec 10)');
});

it('computeStats: falls back to overall usual pace when novel daysReading < 3', () => {
  const now = new Date(2026, 10, 14); // Nov 14, 2026
  const novels = [
    {
      id: '1',
      title: 'Finished Benchmark',
      status: 'Completed',
      started: '2026-10-01',
      finished: '2026-10-11', // 10 days
      chaptersRead: 100 // pace = 10 ch/day
    },
    {
      id: '3',
      title: 'New Reading (Usual Pace Fallback)',
      status: 'Reading',
      started: '2026-11-13', // 1 day reading (< 3)
      updatedAt: '2026-11-13T10:00:00.000Z', // 1 day ago (not stale)
      chaptersRead: 10,
      chaptersTotal: 110 // remaining = 100 ch -> 100 / 10 = 10 days -> Nov 24
    }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);
  const usualPace = stats.inProgressNovels.find(n => n.id === '3');
  assert.notStrictEqual(usualPace.estimatedFinish, null);
  assert.strictEqual(usualPace.estimatedFinish.daysLeft, 10);
  assert.strictEqual(usualPace.estimatedFinish.targetDateFormatted, 'Nov 24');
  assert.strictEqual(usualPace.estimatedFinish.paceBasisLabel, "your usual pace");
  assert.strictEqual(usualPace.estimatedFinish.text, '~10 days left (around Nov 24)');
});

it('computeStats: shows stale messaging when Reading novel has not been updated in 14+ days', () => {
  const now = new Date(2026, 10, 14); // Nov 14, 2026
  const novels = [
    {
      id: '1',
      title: 'Finished Benchmark',
      status: 'Completed',
      started: '2026-10-01',
      finished: '2026-10-11',
      chaptersRead: 100
    },
    {
      id: '4',
      title: 'Stale Reading',
      status: 'Reading',
      started: '2026-09-01',
      updatedAt: '2026-10-25T10:00:00.000Z', // 20 days ago (stale!)
      chaptersRead: 80,
      chaptersTotal: 280
    }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);
  const stale = stats.inProgressNovels.find(n => n.id === '4');
  assert.notStrictEqual(stale.estimatedFinish, null);
  assert.strictEqual(stale.estimatedFinish.isStale, true);
  assert.strictEqual(stale.estimatedFinish.daysLeft, null);
  assert.strictEqual(stale.estimatedFinish.targetDateFormatted, null);
  assert.strictEqual(stale.estimatedFinish.text, 'Update progress for an estimate');
});

it('computeStats: caps finish estimate text at 1+ year left when daysLeft > 365', () => {
  const now = new Date(2026, 10, 14); // Nov 14, 2026
  const novels = [
    {
      id: '1',
      title: 'Finished Benchmark',
      status: 'Completed',
      started: '2026-10-01',
      finished: '2026-10-11',
      chaptersRead: 100
    },
    {
      id: '5',
      title: 'Massive Epic (> 1 Year)',
      status: 'Reading',
      started: '2026-11-01', // 13 days reading
      updatedAt: '2026-11-13T10:00:00.000Z',
      chaptersRead: 13, // 1 ch / day
      chaptersTotal: 1000 // remaining = 987 ch -> 987 days (> 365)
    }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);
  const massive = stats.inProgressNovels.find(n => n.id === '5');
  assert.notStrictEqual(massive.estimatedFinish, null);
  assert.strictEqual(massive.estimatedFinish.daysLeft, 987);
  assert.strictEqual(massive.estimatedFinish.text, '1+ year left');
});

it('computeStats: hides finish estimate when no completed novels, chaptersTotal is null, or remaining <= 0', () => {
  const now = new Date(2026, 10, 14);
  const novels = [
    {
      id: '1',
      title: 'No Total',
      status: 'Reading',
      chaptersRead: 50,
      chaptersTotal: null
    },
    {
      id: '2',
      title: 'Completed Chapters Ahead',
      status: 'Reading',
      chaptersRead: 100,
      chaptersTotal: 100 // remaining = 0
    }
  ];
  // No completed benchmark novels -> pace is 0
  const stats = StatsCalculator.computeStats(novels, 'all', now);
  assert.strictEqual(stats.inProgressNovels[0].estimatedFinish, null);
  assert.strictEqual(stats.inProgressNovels[1].estimatedFinish, null);
});

it('formatTargetDate: includes year when target date is next year', () => {
  const now = new Date(2026, 11, 20); // Dec 20, 2026
  const nextYear = new Date(2027, 0, 15); // Jan 15, 2027
  assert.strictEqual(StatsCalculator.formatTargetDate(nextYear, now), 'Jan 15, 2027');
  const sameYear = new Date(2026, 11, 28);
  assert.strictEqual(StatsCalculator.formatTargetDate(sameYear, now), 'Dec 28');
});

// 6. FEATURE 2: Genre breakdown & normalization
it('computeStats: normalizes genres, splits comma-separated strings, and computes average rating', () => {
  const now = new Date(2026, 10, 14);
  const novels = [
    { id: '1', title: 'A', genre: 'Fantasy, Adventure', rating: 5 },
    { id: '2', title: 'B', genre: 'fantasy ', rating: 3 },
    { id: '3', title: 'C', genre: 'Adventure, Sci-Fi', rating: 0 }, // rating 0 = unrated
    { id: '4', title: 'D', genre: 'Sci-Fi', rating: 4 }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);

  assert.notStrictEqual(stats.genreBreakdown, null);
  // Fantasy: 2 novels (A, B). Ratings: 5, 3 -> avg 4.0
  const fantasy = stats.genreBreakdown.find(g => g.name.toLowerCase() === 'fantasy');
  assert.strictEqual(fantasy.count, 2);
  assert.strictEqual(fantasy.avgRating, '4.0');

  // Adventure: 2 novels (A, C). Ratings: 5 (C is unrated) -> avg 5.0
  const adventure = stats.genreBreakdown.find(g => g.name.toLowerCase() === 'adventure');
  assert.strictEqual(adventure.count, 2);
  assert.strictEqual(adventure.avgRating, '5.0');

  // Sci-Fi: 2 novels (C, D). Ratings: 4 (C is unrated) -> avg 4.0
  const scifi = stats.genreBreakdown.find(g => g.name.toLowerCase() === 'sci-fi');
  assert.strictEqual(scifi.count, 2);
  assert.strictEqual(scifi.avgRating, '4.0');
});

it('computeStats: hides genre breakdown if fewer than 2 novels have a genre', () => {
  const now = new Date(2026, 10, 14);
  const novels = [
    { id: '1', title: 'A', genre: 'Fantasy' },
    { id: '2', title: 'B', genre: '' },
    { id: '3', title: 'C', genre: null }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);
  assert.strictEqual(stats.genreBreakdown, null);
});

// 7. FEATURE 3: Dropped analysis
it('computeStats: calculates dropped stats, excludes chapter 0, and handles single dropped wording', () => {
  const now = new Date(2026, 10, 14);
  const novels = [
    { id: '1', title: 'Novel A', status: 'Dropped', chaptersRead: 20, chaptersTotal: 100 },
    { id: '2', title: 'Novel B', status: 'Completed', chaptersRead: 80 },
    { id: '3', title: 'Novel C', status: 'Dropped', chaptersRead: 0, chaptersTotal: 50 } // dropped at ch 0 -> excluded from avg
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);

  assert.notStrictEqual(stats.droppedAnalysis, null);
  assert.strictEqual(stats.droppedAnalysis.droppedCount, 2);
  // Average dropped chapter excludes Novel C (ch 0) -> only Novel A (ch 20)
  assert.strictEqual(stats.droppedAnalysis.avgDroppedChapter, 20);
  assert.strictEqual(stats.droppedAnalysis.avgDroppedPercentage, 20); // 20 / 100 = 20%
  // Completion rate: 1 completed / (1 completed + 2 dropped) = 33%
  assert.strictEqual(stats.droppedAnalysis.completionRate, 33);
  // 2 dropped novels wording
  assert.strictEqual(stats.droppedAnalysis.insightText, 'You dropped "Novel A" at chapter 20 and "Novel C" at chapter 0.');
});

it('computeStats: hides dropped section if 0 dropped novels, and hides completion rate if Completed+Dropped=0', () => {
  const now = new Date(2026, 10, 14);
  const novels = [
    { id: '1', title: 'Novel A', status: 'Reading', chaptersRead: 20 },
    { id: '2', title: 'Novel B', status: 'Plan to Read', chaptersRead: 0 }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);
  assert.strictEqual(stats.droppedAnalysis, null);
});

it('computeStats: single dropped novel wording', () => {
  const now = new Date(2026, 10, 14);
  const novels = [
    { id: '1', title: 'Solo Drop', status: 'Dropped', chaptersRead: 45, chaptersTotal: 200 }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);
  assert.strictEqual(stats.droppedAnalysis.insightText, 'You dropped "Solo Drop" at chapter 45.');
  assert.strictEqual(stats.droppedAnalysis.avgDroppedPercentage, 23); // 45 / 200 = 22.5% -> 23%
});

// 8. FEATURE 4: Top lists
it('computeStats: highest rated breaks ties by chaptersRead, longest completed, and hides single-author spotlight', () => {
  const now = new Date(2026, 10, 14);
  const novels = [
    { id: '1', title: 'Tie Low Ch', status: 'Reading', rating: 4.5, chaptersRead: 50, author: 'Author One' },
    { id: '2', title: 'Tie High Ch', status: 'Completed', rating: 4.5, chaptersRead: 250, author: 'Author One' },
    { id: '3', title: 'Top Novel', status: 'Completed', rating: 5.0, chaptersRead: 100, author: 'Author One' },
    { id: '4', title: 'Unrated Big', status: 'Completed', rating: 0, chaptersRead: 1000, author: 'Author One' }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);

  // Highest rated: Top Novel (5.0), Tie High Ch (4.5, 250 ch), Tie Low Ch (4.5, 50 ch)
  assert.strictEqual(stats.topLists.highestRated.length, 3);
  assert.strictEqual(stats.topLists.highestRated[0].title, 'Top Novel');
  assert.strictEqual(stats.topLists.highestRated[1].title, 'Tie High Ch');
  assert.strictEqual(stats.topLists.highestRated[2].title, 'Tie Low Ch');

  // Longest completed: Unrated Big (1000 ch), Tie High Ch (250 ch), Top Novel (100 ch)
  assert.strictEqual(stats.topLists.longestCompleted.length, 3);
  assert.strictEqual(stats.topLists.longestCompleted[0].title, 'Unrated Big');
  assert.strictEqual(stats.topLists.longestCompleted[1].title, 'Tie High Ch');
  assert.strictEqual(stats.topLists.longestCompleted[2].title, 'Top Novel');

  // Single distinct author -> spotlight is hidden (null)
  assert.strictEqual(stats.topLists.mostReadAuthor, null);
});

it('computeStats: spotlight shows most-read author when 2+ distinct authors exist', () => {
  const now = new Date(2026, 10, 14);
  const novels = [
    { id: '1', title: 'A', status: 'Reading', chaptersRead: 100, author: 'Cuttlefish That Loves Diving' },
    { id: '2', title: 'B', status: 'Completed', chaptersRead: 500, author: 'cuttlefish that loves diving ' },
    { id: '3', title: 'C', status: 'Completed', chaptersRead: 300, author: 'Sing Shong' }
  ];
  const stats = StatsCalculator.computeStats(novels, 'all', now);

  assert.notStrictEqual(stats.topLists.mostReadAuthor, null);
  // Cuttlefish has 600 chapters across 2 novels
  assert.strictEqual(stats.topLists.mostReadAuthor.name, 'Cuttlefish That Loves Diving');
  assert.strictEqual(stats.topLists.mostReadAuthor.totalChapters, 600);
  assert.strictEqual(stats.topLists.mostReadAuthor.count, 2);
});

// 9. Time Filter Boundaries & All-Time Sections
it('computeStats: time filter affects finished stats while genre, dropped, and top lists stay all-time', () => {
  const now = new Date(2026, 10, 14); // November 2026
  const novels = [
    {
      id: '1',
      title: 'Old Novel',
      status: 'Completed',
      started: '2025-01-01',
      finished: '2025-01-11', // 2025
      chaptersRead: 100,
      rating: 5,
      genre: 'Fantasy',
      author: 'Author A'
    },
    {
      id: '2',
      title: 'This Month Novel',
      status: 'Completed',
      started: '2026-11-01',
      finished: '2026-11-06', // Nov 2026
      chaptersRead: 50,
      rating: 4,
      genre: 'Sci-Fi',
      author: 'Author B'
    },
    {
      id: '3',
      title: 'Dropped Novel',
      status: 'Dropped',
      chaptersRead: 15,
      chaptersTotal: 60,
      genre: 'Fantasy',
      author: 'Author C'
    }
  ];

  const statsMonth = StatsCalculator.computeStats(novels, 'month', now);
  // Finished stats respect month filter: only 1 novel finished this month
  assert.strictEqual(statsMonth.completed.count, 1);
  assert.strictEqual(statsMonth.completed.fastest.title, 'This Month Novel');

  // Genre, dropped, and top lists remain all-time
  assert.notStrictEqual(statsMonth.genreBreakdown, null);
  assert.strictEqual(statsMonth.genreBreakdown.find(g => g.name === 'Fantasy').count, 2);
  assert.notStrictEqual(statsMonth.droppedAnalysis, null);
  assert.strictEqual(statsMonth.droppedAnalysis.droppedCount, 1);
  assert.strictEqual(statsMonth.topLists.highestRated[0].title, 'Old Novel');
});

// 10. Step 1: Safe Load Storage Validation Logic
function simulateLoadLibrary(storedValue) {
  let library = [];
  let recoveryMode = false;
  let rawCorruptedStorage = null;

  if (storedValue === null || storedValue === '') {
    library = [];
    recoveryMode = false;
    rawCorruptedStorage = null;
  } else {
    try {
      const parsed = JSON.parse(storedValue);
      if (!Array.isArray(parsed)) {
        recoveryMode = true;
        rawCorruptedStorage = storedValue;
        library = [];
      } else {
        library = parsed.filter(item => typeof item === 'object' && item !== null && typeof item.id === 'string');
        recoveryMode = false;
        rawCorruptedStorage = null;
      }
    } catch (e) {
      recoveryMode = true;
      rawCorruptedStorage = storedValue;
      library = [];
    }
  }
  return { library, recoveryMode, rawCorruptedStorage };
}

it('safeLoad: handles corrupted JSON by preserving raw string and entering recovery mode', () => {
  const badJson = '{"title": "Broken, incomplete...';
  const res = simulateLoadLibrary(badJson);
  assert.strictEqual(res.recoveryMode, true);
  assert.strictEqual(res.rawCorruptedStorage, badJson);
  assert.strictEqual(res.library.length, 0);
});

it('safeLoad: handles non-array JSON by preserving raw string and entering recovery mode', () => {
  const objectJson = '{"novel": 123}';
  const res = simulateLoadLibrary(objectJson);
  assert.strictEqual(res.recoveryMode, true);
  assert.strictEqual(res.rawCorruptedStorage, objectJson);
  assert.strictEqual(res.library.length, 0);

  const primitiveJson = '42';
  const res2 = simulateLoadLibrary(primitiveJson);
  assert.strictEqual(res2.recoveryMode, true);
  assert.strictEqual(res2.rawCorruptedStorage, '42');
});

it('safeLoad: handles empty string and null gracefully without entering recovery mode', () => {
  const resNull = simulateLoadLibrary(null);
  assert.strictEqual(resNull.recoveryMode, false);
  assert.strictEqual(resNull.rawCorruptedStorage, null);
  assert.strictEqual(resNull.library.length, 0);

  const resEmpty = simulateLoadLibrary('');
  assert.strictEqual(resEmpty.recoveryMode, false);
  assert.strictEqual(resEmpty.rawCorruptedStorage, null);
  assert.strictEqual(resEmpty.library.length, 0);
});

it('safeLoad: parses valid array JSON without entering recovery mode', () => {
  const validJson = JSON.stringify([{ id: 'nov_1', title: 'Test Novel' }]);
  const res = simulateLoadLibrary(validJson);
  assert.strictEqual(res.recoveryMode, false);
  assert.strictEqual(res.rawCorruptedStorage, null);
  assert.strictEqual(res.library.length, 1);
  assert.strictEqual(res.library[0].id, 'nov_1');
});

it('tags: deduplicates tags case-insensitively while preserving first-typed casing', () => {
  // Test the tag deduplication logic used in form submit and import normalization
  function dedupeTags(rawTags) {
    const seen = new Set();
    const result = [];
    for (const tag of rawTags) {
      const trimmed = String(tag || '').trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        result.push(trimmed);
      }
    }
    return result;
  }

  const rawInput = ['Fantasy', 'magic', 'fantasy', 'Magic', 'LITRPG', 'litrpg', 'OP MC', 'op mc'];
  const deduped = dedupeTags(rawInput);
  assert.deepStrictEqual(deduped, ['Fantasy', 'magic', 'LITRPG', 'OP MC']);

  // Also test comma-separated string split and dedupe (as in form submit)
  const formValue = 'Action, action, ACTION, Fantasy, Sci-Fi, sci-fi';
  const fromForm = dedupeTags(formValue.split(','));
  assert.deepStrictEqual(fromForm, ['Action', 'Fantasy', 'Sci-Fi']);
});

// 11. A3: 50-Novel Library Export -> Import Round Trip (Replace and Merge)
it('import/export: 50-novel library round trip preserves all fields and covers in Replace and Merge modes', () => {
  const appJsSource = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
  const normMatch = appJsSource.match(/function normalizeImportedNovel\(n\) \{[\s\S]*?\n  \}/);
  assert.ok(normMatch, 'Must find normalizeImportedNovel in app.js');

  const normalizeImportedNovel = new Function('localDateString', 'return ' + normMatch[0])((d = new Date()) => {
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  });

  // Generate 50 novels covering all statuses, cover types, ratings, and edge cases
  const library = [];
  for (let i = 0; i < 50; i++) {
    const isCompleted = i % 5 === 0;
    const isReading = i % 5 === 1;
    const status = isCompleted ? 'Completed' : (isReading ? 'Reading' : (i % 5 === 2 ? 'Plan to Read' : (i % 5 === 3 ? 'On Hold' : 'Dropped')));
    const started = '2026-01-' + String((i % 28) + 1).padStart(2, '0');
    const finished = isCompleted ? '2026-02-' + String((i % 28) + 1).padStart(2, '0') : '';

    let cover = '';
    if (i % 3 === 0) {
      cover = 'data:image/jpeg;base64,' + Buffer.from('fake-base64-image-bytes-' + i).toString('base64');
    } else if (i % 3 === 1) {
      cover = 'https://example.com/covers/novel_' + i + '.jpg';
    }

    const novel = {
      id: 'novel_roundtrip_' + i,
      title: 'Roundtrip Novel ' + i + ' <Special & "Chars">',
      author: 'Author ' + (i % 8),
      status,
      chaptersRead: isCompleted ? 200 : (status === 'Reading' ? i * 3 : 0),
      chaptersTotal: (i % 4 === 0) ? null : 200,
      rating: (i % 11) / 2, // 0 to 5.0
      started,
      finished,
      startedEstimated: i % 2 === 0,
      finishedEstimated: isCompleted && i % 4 === 0,
      source: 'RoyalRoad',
      link: 'https://royalroad.com/fiction/' + i,
      genre: 'Fantasy, Adventure',
      tags: ['tag-a', 'tag-b', 'novel-' + i],
      notes: 'Line 1 for novel ' + i + '\nLine 2 with symbols: &<>"\'',
      cover,
      createdAt: 1700000000000 + i * 1000,
      updatedAt: 1700050000000 + i * 1000
    };
    library.push(novel);
  }

  // 1. Export format serialization
  const exportPayload = {
    app: 'NovelShelf',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    novels: library
  };
  const jsonStr = JSON.stringify(exportPayload, null, 2);

  // 2. Import Replace Mode
  const parsedData = JSON.parse(jsonStr);
  const rawNovels = parsedData.novels;
  const replacedLibrary = rawNovels.map(normalizeImportedNovel);

  assert.strictEqual(replacedLibrary.length, 50, 'Replace must retain all 50 novels');

  for (let i = 0; i < library.length; i++) {
    const orig = library[i];
    const imported = replacedLibrary[i];
    assert.deepStrictEqual(imported, orig, `Novel at index ${i} must match exactly after Replace import`);
  }

  // 3. Import Merge Mode
  // Existing library has 25 novels with local progress edits
  const existingLibrary = library.slice(0, 25).map(n => ({
    ...n,
    chaptersRead: n.chaptersRead + 10,
    notes: n.notes + '\n[Local Note Added]'
  }));

  // Simulate app.js:2393-2420 Merge logic
  const existingIds = new Set(existingLibrary.map(n => n.id));
  let addedCount = 0;
  const mergeMap = new Map();
  replacedLibrary.forEach(n => {
    if (!existingIds.has(n.id)) {
      addedCount++;
    }
    mergeMap.set(n.id, n);
  });
  existingLibrary.forEach(n => mergeMap.set(n.id, n)); // local progress wins on id collision
  const mergedResult = Array.from(mergeMap.values());

  assert.strictEqual(mergedResult.length, 50, 'Merged library must contain exactly 50 novels');
  assert.strictEqual(addedCount, 25, 'Merge must report exactly 25 newly added novels');

  // Verify the 25 new novels merged with 100% field preservation
  for (let i = 25; i < 50; i++) {
    const orig = library[i];
    const merged = mergedResult.find(n => n.id === orig.id);
    assert.ok(merged, `Novel ${orig.id} must exist in merged library`);
    assert.deepStrictEqual(merged, orig, `Newly merged novel ${orig.id} must preserve all fields and cover`);
  }

  // Verify the 25 existing novels preserved local edits
  for (let i = 0; i < 25; i++) {
    const local = existingLibrary[i];
    const merged = mergedResult.find(n => n.id === local.id);
    assert.ok(merged, `Local novel ${local.id} must exist in merged library`);
    assert.strictEqual(merged.chaptersRead, local.chaptersRead, `Local chaptersRead must be preserved for ${local.id}`);
    assert.strictEqual(merged.notes, local.notes, `Local notes must be preserved for ${local.id}`);
    assert.strictEqual(merged.cover, local.cover, `Local cover must be preserved for ${local.id}`);
  }
});

console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
