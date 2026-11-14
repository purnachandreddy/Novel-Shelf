(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StatsCalculator = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Parse a YYYY-MM-DD string into a local Date object at 00:00:00 local time.
   * Avoids new Date('YYYY-MM-DD') which parses as UTC and causes day-shifts.
   */
  function parseLocalDate(str) {
    if (!str || typeof str !== 'string') return null;
    const parts = str.trim().split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    if (m < 0 || m > 11 || d < 1 || d > 31) return null;
    const dt = new Date(y, m, d, 0, 0, 0, 0);
    if (isNaN(dt.getTime())) return null;
    if (dt.getFullYear() !== y || dt.getMonth() !== m || dt.getDate() !== d) return null;
    return dt;
  }

  /**
   * Format a Date into a YYYY-MM-DD local string.
   */
  function formatLocalDate(dt) {
    if (!dt || isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Calculate difference in whole calendar days between two local Date objects or date strings.
   * dt2 - dt1
   */
  function diffDays(d1, d2) {
    if (!d1 || !d2) return null;
    const dt1 = (d1 instanceof Date) ? d1 : parseLocalDate(d1);
    const dt2 = (d2 instanceof Date) ? d2 : parseLocalDate(d2);
    if (!dt1 || !dt2 || isNaN(dt1.getTime()) || isNaN(dt2.getTime())) return null;
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const utc1 = Date.UTC(dt1.getFullYear(), dt1.getMonth(), dt1.getDate());
    const utc2 = Date.UTC(dt2.getFullYear(), dt2.getMonth(), dt2.getDate());
    return Math.floor((utc2 - utc1) / MS_PER_DAY);
  }

  /**
   * Format target finish date.
   * If the target year differs from the current year, include the year.
   */
  function formatTargetDate(dt, now) {
    if (!dt || isNaN(dt.getTime())) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mStr = months[dt.getMonth()];
    const dStr = dt.getDate();
    const yStr = dt.getFullYear();
    const nowY = now ? now.getFullYear() : new Date().getFullYear();
    return yStr !== nowY ? `${mStr} ${dStr}, ${yStr}` : `${mStr} ${dStr}`;
  }

  /**
   * Format date helper: YYYY-MM-DD -> DD/MM/YY
   */
  function formatDateShort(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const parts = dateStr.trim().split('-');
    if (parts.length === 3) {
      const year = parts[0].slice(-2);
      const month = parts[1].padStart(2, '0');
      const day = parts[2].padStart(2, '0');
      return `${day}/${month}/${year}`;
    }
    return dateStr;
  }

  /**
   * Check if a YYYY-MM-DD finished date falls within the time filter.
   * filter: 'all' | 'year' | 'month'
   */
  function isWithinFilter(finishedStr, filter, now) {
    if (!filter || filter === 'all') return true;
    const dt = parseLocalDate(finishedStr);
    if (!dt) return false;
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    if (filter === 'year') {
      return dt.getFullYear() === currentYear;
    }
    if (filter === 'month') {
      return dt.getFullYear() === currentYear && dt.getMonth() === currentMonth;
    }
    return true;
  }

  /**
   * Main calculation function
   * @param {Array} novels - library array
   * @param {string} filter - 'all' | 'year' | 'month'
   * @param {Date} [now] - Current date/time reference
   */
  function computeStats(novels, filter = 'all', now = new Date()) {
    const list = Array.isArray(novels) ? novels : [];

    // All-time chapters breakdown
    let chaptersCompletedAllTime = 0;
    let chaptersReadingAllTime = 0;
    let chaptersOtherAllTime = 0;

    // All-time Status Breakdown
    const statusCounts = {
      Reading: 0,
      'Plan to Read': 0,
      Completed: 0,
      'On Hold': 0,
      Dropped: 0
    };

    // All-time Rating Distribution (rating > 0 is rated, 0 is unrated)
    const ratingBuckets = { '5': 0, '4.5': 0, '4': 0, '3.5': 0, '3': 0, '<3': 0 };
    let ratingSum = 0;
    let ratedCount = 0;

    list.forEach(n => {
      const read = Math.max(0, parseInt(n.chaptersRead, 10) || 0);
      if (n.status === 'Completed') {
        chaptersCompletedAllTime += read;
      } else if (n.status === 'Reading') {
        chaptersReadingAllTime += read;
      } else {
        chaptersOtherAllTime += read;
      }

      if (statusCounts[n.status] !== undefined) {
        statusCounts[n.status]++;
      }

      const r = parseFloat(n.rating) || 0;
      if (r > 0) {
        ratingSum += r;
        ratedCount++;
        if (r >= 5) ratingBuckets['5']++;
        else if (r >= 4.5) ratingBuckets['4.5']++;
        else if (r >= 4) ratingBuckets['4']++;
        else if (r >= 3.5) ratingBuckets['3.5']++;
        else if (r >= 3) ratingBuckets['3']++;
        else ratingBuckets['<3']++;
      }
    });

    const averageRating = ratedCount > 0 ? (ratingSum / ratedCount).toFixed(1) : null;

    // --- All-time Completed Exact Pace (Used for in-progress finish date estimates) ---
    // Pace = total chapters / total days across completed novels with exact dates
    let allTimeExactChapters = 0;
    let allTimeExactDays = 0;
    let allTimeExactCount = 0;

    list.forEach(n => {
      if (n.status === 'Completed' && !n.startedEstimated && !n.finishedEstimated) {
        const dtStart = parseLocalDate(n.started);
        const dtFinish = parseLocalDate(n.finished);
        if (dtStart && dtFinish) {
          const rawDays = diffDays(dtStart, dtFinish);
          if (rawDays !== null) {
            const days = Math.max(1, rawDays);
            const ch = Math.max(0, parseInt(n.chaptersRead, 10) || 0);
            allTimeExactChapters += ch;
            allTimeExactDays += days;
            allTimeExactCount++;
          }
        }
      }
    });

    const allTimeOverallPace = (allTimeExactDays > 0 && allTimeExactCount > 0)
      ? (allTimeExactChapters / allTimeExactDays)
      : 0;

    // --- Completed Novels Stats (Filtered by finished date) ---
    const completedNovels = list.filter(n => n.status === 'Completed' && isWithinFilter(n.finished, filter, now));
    const completedCount = completedNovels.length;

    let filteredExactChapters = 0;
    let filteredExactDays = 0;
    let filteredExactCount = 0;
    let totalFinishDays = 0;
    let validDaysCount = 0;

    let fastest = null; // { novel, days, chapters }
    let longest = null; // { novel, days, chapters }

    completedNovels.forEach(n => {
      // Exclude estimated dates from pace / days-to-finish
      if (n.startedEstimated || n.finishedEstimated) return;

      const dtStart = parseLocalDate(n.started);
      const dtFinish = parseLocalDate(n.finished);

      if (dtStart && dtFinish) {
        // Difference in calendar days. Same-day finishes clamp to a minimum of 1 day.
        const rawDays = diffDays(dtStart, dtFinish);
        if (rawDays !== null) {
          const days = Math.max(1, rawDays);
          const chapters = Math.max(0, parseInt(n.chaptersRead, 10) || 0);

          totalFinishDays += days;
          validDaysCount++;

          filteredExactChapters += chapters;
          filteredExactDays += days;
          filteredExactCount++;

          if (!fastest || days < fastest.days) {
            fastest = { title: n.title || 'Untitled', days, chapters };
          }
          if (!longest || days > longest.days) {
            longest = { title: n.title || 'Untitled', days, chapters };
          }
        }
      }
    });

    const avgDaysToFinish = validDaysCount > 0 ? Math.round(totalFinishDays / validDaysCount) : null;
    const avgReadingPace = filteredExactDays > 0 ? (filteredExactChapters / filteredExactDays).toFixed(1) : null;

    // Monthly completed chart (last 6 calendar months ending at `now`)
    const monthlyCompletions = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('en-US', { month: 'short' });
      monthlyCompletions.push({
        monthKey,
        label,
        year: d.getFullYear(),
        month: d.getMonth(),
        count: 0
      });
    }

    list.forEach(n => {
      if (n.status === 'Completed' && n.finished) {
        const dt = parseLocalDate(n.finished);
        if (dt) {
          const mKey = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
          const bucket = monthlyCompletions.find(b => b.monthKey === mKey);
          if (bucket) {
            bucket.count++;
          }
        }
      }
    });

    // In-progress novels (Reading status): reading for X days & finish date estimate
    const inProgressNovels = list
      .filter(n => n.status === 'Reading')
      .map(n => {
        let daysReading = 0;
        if (n.started) {
          const dtStart = parseLocalDate(n.started);
          if (dtStart) {
            daysReading = Math.max(0, diffDays(dtStart, now) || 0);
          }
        } else if (n.createdAt) {
          const dtCreated = new Date(n.createdAt);
          if (!isNaN(dtCreated.getTime())) {
            daysReading = Math.max(0, diffDays(dtCreated, now) || 0);
          }
        }

        // Stale if updatedAt (or createdAt) was 14+ days ago
        let daysSinceUpdate = 0;
        const lastUpdatedStr = n.updatedAt || n.createdAt;
        if (lastUpdatedStr) {
          const dtUpdated = new Date(lastUpdatedStr);
          if (!isNaN(dtUpdated.getTime())) {
            daysSinceUpdate = Math.max(0, diffDays(dtUpdated, now) || 0);
          }
        }
        const isStale = daysSinceUpdate >= 14;

        const read = Math.max(0, parseInt(n.chaptersRead, 10) || 0);
        const total = (n.chaptersTotal != null && n.chaptersTotal !== '' && !isNaN(parseInt(n.chaptersTotal, 10)))
          ? parseInt(n.chaptersTotal, 10)
          : null;
        const remaining = total !== null ? total - read : null;

        // Finish date estimate
        let estimatedFinish = null;
        if (total !== null && remaining !== null && remaining > 0) {
          if (isStale) {
            estimatedFinish = {
              daysLeft: null,
              targetDateFormatted: null,
              isStale: true,
              daysSinceUpdate,
              paceBasisLabel: 'Update your progress for an estimate',
              text: 'Update your progress for an estimate'
            };
          } else {
            let pace = 0;
            let paceBasisLabel = '';

            if (daysReading >= 3 && read > 0 && daysSinceUpdate < 14) {
              pace = read / daysReading;
              paceBasisLabel = "at this novel's pace";
            } else if (allTimeOverallPace > 0) {
              pace = allTimeOverallPace;
              paceBasisLabel = 'at your usual pace';
            }

            if (pace > 0) {
              const daysLeft = Math.ceil(remaining / pace);
              let targetDateFormatted = null;
              let estimateText = '';

              if (daysLeft > 365) {
                estimateText = '1+ year left';
              } else {
                const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysLeft);
                targetDateFormatted = formatTargetDate(targetDate, now);
                estimateText = `~${daysLeft} day${daysLeft === 1 ? '' : 's'} left (around ${targetDateFormatted})`;
              }

              estimatedFinish = {
                daysLeft,
                targetDateFormatted,
                isStale: false,
                daysSinceUpdate,
                paceBasisLabel,
                text: estimateText
              };
            }
          }
        }

        return {
          id: n.id,
          title: n.title || 'Untitled',
          chaptersRead: read,
          chaptersTotal: total,
          remaining,
          daysReading,
          daysSinceUpdate,
          isStale,
          estimatedFinish
        };
      })
      .sort((a, b) => b.daysReading - a.daysReading);

    // --- FEATURE 2: Genre Breakdown (All time) ---
    // Split and normalize comma-separated genres. Rated means rating > 0.
    const genreMap = new Map();
    let novelsWithGenreCount = 0;

    list.forEach(n => {
      if (!n.genre || typeof n.genre !== 'string') return;
      const rawParts = n.genre.split(',').map(s => s.trim()).filter(Boolean);
      if (rawParts.length > 0) {
        novelsWithGenreCount++;
      }
      const seenForNovel = new Set();
      const rating = parseFloat(n.rating) || 0;
      const isRated = rating > 0;

      rawParts.forEach(part => {
        const key = part.toLowerCase();
        if (seenForNovel.has(key)) return;
        seenForNovel.add(key);

        if (!genreMap.has(key)) {
          genreMap.set(key, {
            name: part,
            count: 0,
            ratingSum: 0,
            ratedCount: 0
          });
        }
        const entry = genreMap.get(key);
        entry.count++;
        if (isRated) {
          entry.ratingSum += rating;
          entry.ratedCount++;
        }
      });
    });

    let genreBreakdown = null;
    // Hide the section if fewer than 2 novels have a genre
    if (novelsWithGenreCount >= 2 && genreMap.size > 0) {
      genreBreakdown = Array.from(genreMap.values()).map(g => ({
        name: g.name,
        count: g.count,
        avgRating: g.ratedCount > 0 ? (g.ratingSum / g.ratedCount).toFixed(1) : null,
        ratedCount: g.ratedCount
      }));
      // Sort by count descending, tie-break by name
      genreBreakdown.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }

    // --- FEATURE 3: Dropped Analysis (All time) ---
    const droppedNovels = list.filter(n => n.status === 'Dropped');
    let droppedAnalysis = null;

    if (droppedNovels.length > 0) {
      // Exclude novels dropped at chapter 0 from average chapter and percentage
      const droppedAboveZero = droppedNovels.filter(n => (parseInt(n.chaptersRead, 10) || 0) > 0);

      let avgDroppedChapter = null;
      if (droppedAboveZero.length > 0) {
        const sumChapters = droppedAboveZero.reduce((acc, n) => acc + (parseInt(n.chaptersRead, 10) || 0), 0);
        avgDroppedChapter = Math.round(sumChapters / droppedAboveZero.length);
      }

      // Percentage for novels with chaptersTotal > 0 and chaptersTotal >= chaptersRead > 0
      const droppedWithPct = droppedAboveZero.filter(n => {
        const tot = parseInt(n.chaptersTotal, 10) || 0;
        const read = parseInt(n.chaptersRead, 10) || 0;
        return tot > 0 && tot >= read;
      });

      let avgDroppedPercentage = null;
      if (droppedWithPct.length > 0) {
        const sumPct = droppedWithPct.reduce((acc, n) => {
          const tot = parseInt(n.chaptersTotal, 10);
          const read = parseInt(n.chaptersRead, 10);
          return acc + ((read / tot) * 100);
        }, 0);
        avgDroppedPercentage = Math.round(sumPct / droppedWithPct.length);
      }

      // Completion rate = Completed / (Completed + Dropped). Hide if Completed + Dropped = 0.
      const completedAllTime = statusCounts.Completed;
      const droppedAllTime = droppedNovels.length;
      const totalDecided = completedAllTime + droppedAllTime;
      const completionRate = totalDecided > 0
        ? Math.round((completedAllTime / totalDecided) * 100)
        : null;

      // Insight wording: specific for < 3 dropped novels
      let insightText = '';
      if (droppedNovels.length === 1) {
        const d = droppedNovels[0];
        const ch = parseInt(d.chaptersRead, 10) || 0;
        insightText = `You dropped "${d.title || 'Untitled'}" at chapter ${ch}.`;
      } else if (droppedNovels.length === 2) {
        const d1 = droppedNovels[0];
        const d2 = droppedNovels[1];
        const ch1 = parseInt(d1.chaptersRead, 10) || 0;
        const ch2 = parseInt(d2.chaptersRead, 10) || 0;
        insightText = `You dropped "${d1.title || 'Untitled'}" at chapter ${ch1} and "${d2.title || 'Untitled'}" at chapter ${ch2}.`;
      } else {
        // 3 or more dropped novels
        if (avgDroppedChapter !== null) {
          const pctStr = avgDroppedPercentage !== null ? ` (${avgDroppedPercentage}% through)` : '';
          insightText = `You usually drop around chapter ${avgDroppedChapter}${pctStr}.`;
        } else {
          insightText = `You usually drop novels before starting chapter 1.`;
        }
      }

      droppedAnalysis = {
        droppedCount: droppedNovels.length,
        avgDroppedChapter,
        avgDroppedPercentage,
        completionRate,
        insightText
      };
    }

    // --- FEATURE 4: Top Lists (All time) ---
    // 1. Highest Rated: top 3 by rating > 0, tie-broken by chaptersRead (descending)
    const ratedNovels = list.filter(n => (parseFloat(n.rating) || 0) > 0);
    ratedNovels.sort((a, b) => {
      const rDiff = (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0);
      if (Math.abs(rDiff) > 0.0001) return rDiff;
      const cDiff = (parseInt(b.chaptersRead, 10) || 0) - (parseInt(a.chaptersRead, 10) || 0);
      if (cDiff !== 0) return cDiff;
      return (a.title || '').localeCompare(b.title || '');
    });
    const highestRated = ratedNovels.slice(0, 3).map(n => ({
      id: n.id,
      title: n.title || 'Untitled',
      rating: parseFloat(n.rating) || 0,
      chaptersRead: parseInt(n.chaptersRead, 10) || 0
    }));

    // 2. Longest Completed: top 3 completed novels by chaptersRead (descending)
    const completedAllList = list.filter(n => n.status === 'Completed');
    completedAllList.sort((a, b) => {
      const cDiff = (parseInt(b.chaptersRead, 10) || 0) - (parseInt(a.chaptersRead, 10) || 0);
      if (cDiff !== 0) return cDiff;
      return (a.title || '').localeCompare(b.title || '');
    });
    const longestCompleted = completedAllList.slice(0, 3).map(n => ({
      id: n.id,
      title: n.title || 'Untitled',
      chaptersRead: parseInt(n.chaptersRead, 10) || 0
    }));

    // 3. Most-read Author: normalize case & whitespace, ignore empty, hide if only 1 distinct author
    const authorMap = new Map();
    list.forEach(n => {
      if (!n.author || typeof n.author !== 'string') return;
      const name = n.author.trim();
      if (!name) return;
      const key = name.toLowerCase();
      if (!authorMap.has(key)) {
        authorMap.set(key, { name, totalChapters: 0, count: 0 });
      }
      const entry = authorMap.get(key);
      entry.totalChapters += Math.max(0, parseInt(n.chaptersRead, 10) || 0);
      entry.count++;
    });

    let mostReadAuthor = null;
    if (authorMap.size >= 2) {
      const authors = Array.from(authorMap.values());
      authors.sort((a, b) => b.totalChapters - a.totalChapters || b.count - a.count || a.name.localeCompare(b.name));
      if (authors.length > 0 && authors[0].totalChapters > 0) {
        mostReadAuthor = authors[0];
      }
    }

    const topLists = {
      highestRated,
      longestCompleted,
      mostReadAuthor
    };

    return {
      totalNovels: list.length,
      filter,
      // Chapters split
      chapters: {
        total: chaptersCompletedAllTime + chaptersReadingAllTime + chaptersOtherAllTime,
        inCompleted: chaptersCompletedAllTime,
        inReading: chaptersReadingAllTime
      },
      // Ratings (all-time)
      ratings: {
        average: averageRating,
        totalRated: ratedCount,
        distribution: ratingBuckets
      },
      // Status breakdown (all-time)
      statuses: statusCounts,
      // Date derived (filtered)
      completed: {
        count: completedCount,
        avgDaysToFinish,
        avgReadingPace,
        fastest,
        longest,
        paceBasisCount: filteredExactCount
      },
      // Monthly completions
      monthlyCompletions,
      // In progress with finish date estimates
      inProgressNovels,
      // Feature 2
      genreBreakdown,
      // Feature 3
      droppedAnalysis,
      // Feature 4
      topLists
    };
  }

  return {
    parseLocalDate,
    formatLocalDate,
    formatDateShort,
    diffDays,
    formatTargetDate,
    isWithinFilter,
    computeStats
  };
});
