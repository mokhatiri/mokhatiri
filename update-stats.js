const https = require('https');
const fs = require('fs');

const USERNAME = process.env.USERNAME || 'mokhatiri';
const TOKEN = process.env.GITHUB_TOKEN;

// GraphQL query to get comprehensive stats
const query = `
query($username: String!) {
  user(login: $username) {
    contributionsCollection {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            contributionCount
            date
          }
        }
      }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      nodes {
        stargazerCount
        primaryLanguage {
          name
        }
      }
    }
    followers {
      totalCount
    }
    following {
      totalCount
    }
  }
}
`;

function graphqlRequest(query, variables) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query, variables });
    
    const options = {
      hostname: 'api.github.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'GitHub-Stats-Action',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function calculateStreak(weeks) {
  const today = new Date();
  let currentStreak = 0;
  let longestStreak = 0;
  let tempStreak = 0;
  
  // Flatten all days and sort by date descending
  const allDays = weeks
    .flatMap(w => w.contributionDays)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  
  // Calculate current streak (from today backwards)
  for (const day of allDays) {
    const dayDate = new Date(day.date);
    if (dayDate > today) continue;
    
    if (day.contributionCount > 0) {
      currentStreak++;
    } else {
      break;
    }
  }
  
  // Calculate longest streak
  for (const day of allDays.reverse()) {
    if (day.contributionCount > 0) {
      tempStreak++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else {
      tempStreak = 0;
    }
  }
  
  return { currentStreak, longestStreak };
}

function getTopLanguages(repos) {
  const langCount = {};
  
  repos.forEach(repo => {
    if (repo.primaryLanguage) {
      const lang = repo.primaryLanguage.name;
      langCount[lang] = (langCount[lang] || 0) + 1;
    }
  });
  
  return Object.entries(langCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
}

function generateProgressBar(percentage, length = 20) {
  const filled = Math.round((percentage / 100) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCircularProgressPath(cx, cy, radius, progress) {
  const normalized = clamp(progress, 0, 1);
  if (normalized <= 0) {
    return '';
  }

  const startAngle = -90;
  const endAngle = startAngle + normalized * 360;
  const start = {
    x: cx + radius * Math.cos((startAngle * Math.PI) / 180),
    y: cy + radius * Math.sin((startAngle * Math.PI) / 180)
  };
  const end = {
    x: cx + radius * Math.cos((endAngle * Math.PI) / 180),
    y: cy + radius * Math.sin((endAngle * Math.PI) / 180)
  };

  if (normalized >= 1) {
    return `
      M ${cx} ${cy - radius}
      A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius}
      A ${radius} ${radius} 0 1 1 ${cx} ${cy - radius}
    `;
  }

  const largeArcFlag = normalized > 0.5 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function buildCircleCardSvg({
  title,
  subtitle,
  centerLabel,
  centerValue,
  footerLabel,
  progress,
  colorStart,
  colorEnd,
  backgroundStart,
  backgroundEnd,
  fileName
}) {
  const width = 700;
  const height = 320;
  const cx = 180;
  const cy = 160;
  const radius = 92;
  const arcPath = getCircularProgressPath(cx, cy, radius, progress);
  const percentage = Math.round(clamp(progress, 0, 1) * 100);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${backgroundStart}" />
      <stop offset="100%" stop-color="${backgroundEnd}" />
    </linearGradient>
    <linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colorStart}" />
      <stop offset="100%" stop-color="${colorEnd}" />
    </linearGradient>
    <filter id="soft-shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000000" flood-opacity="0.35" />
    </filter>
  </defs>

  <rect width="${width}" height="${height}" rx="24" fill="url(#bg-grad)" />

  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#ffffff22" stroke-width="18" />
  <path d="${arcPath}" fill="none" stroke="url(#ring-grad)" stroke-width="18" stroke-linecap="round" filter="url(#soft-shadow)" />

  <text x="${cx}" y="146" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#ffffffb3">${centerLabel}</text>
  <text x="${cx}" y="184" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700" fill="#ffffff">${centerValue}</text>
  <text x="${cx}" y="216" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#ffffffb3">${percentage}%</text>

  <text x="330" y="110" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="700" fill="#ffffff">${title}</text>
  <text x="330" y="145" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#ffffffcc">${subtitle}</text>
  <text x="330" y="195" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="600" fill="#ffffff">${footerLabel}</text>
  <text x="330" y="228" font-family="Segoe UI, Arial, sans-serif" font-size="14" fill="#ffffff99">Auto-generated by update-stats.js</text>
</svg>`;

  fs.mkdirSync('generated', { recursive: true });
  fs.writeFileSync(`generated/${fileName}`, svg);
}

async function main() {
  try {
    const response = await graphqlRequest(query, { username: USERNAME });
    
    if (response.errors) {
      console.error('GraphQL errors:', response.errors);
      process.exit(1);
    }
    
    const user = response.data.user;
    const contrib = user.contributionsCollection;
    const calendar = contrib.contributionCalendar;
    
    // Calculate stats
    const totalStars = user.repositories.nodes.reduce((sum, repo) => sum + repo.stargazerCount, 0);
    const { currentStreak, longestStreak } = calculateStreak(calendar.weeks);
    const topLangs = getTopLanguages(user.repositories.nodes);
    const totalLangRepos = topLangs.reduce((sum, [, count]) => sum + count, 0);

    // Progress for circle cards
    const contributionTarget = Math.max(500, Math.ceil(calendar.totalContributions / 500) * 500);
    const contributionProgress = contributionTarget > 0 ? calendar.totalContributions / contributionTarget : 0;
    const streakProgress = longestStreak > 0 ? currentStreak / longestStreak : 0;
    
    // Generate language bars
    const langBars = topLangs.map(([lang, count]) => {
      const percentage = ((count / totalLangRepos) * 100).toFixed(1);
      return `${lang.padEnd(15)} ${generateProgressBar(parseFloat(percentage))} ${percentage}%`;
    }).join('\n');

    buildCircleCardSvg({
      title: 'Contribution Progress',
      subtitle: `Goal for this season: ${contributionTarget.toLocaleString()} contributions`,
      centerLabel: 'Contributions',
      centerValue: calendar.totalContributions.toLocaleString(),
      footerLabel: `Commits ${contrib.totalCommitContributions} • PRs ${contrib.totalPullRequestContributions} • Issues ${contrib.totalIssueContributions}`,
      progress: contributionProgress,
      colorStart: '#ffd166',
      colorEnd: '#f97316',
      backgroundStart: '#1f2937',
      backgroundEnd: '#111827',
      fileName: 'stats-circle.svg'
    });

    buildCircleCardSvg({
      title: 'Streak Momentum',
      subtitle: 'Current streak compared to your personal best',
      centerLabel: 'Current Streak',
      centerValue: `${currentStreak} days`,
      footerLabel: `Best streak: ${longestStreak} days`,
      progress: streakProgress,
      colorStart: '#06d6a0',
      colorEnd: '#118ab2',
      backgroundStart: '#0f172a',
      backgroundEnd: '#111827',
      fileName: 'streak-circle.svg'
    });
    
    // Read template and replace placeholders
    let readme = fs.readFileSync('README.template.md', 'utf8');
    
    const replacements = {
      '{{TOTAL_REPOS}}': user.repositories.totalCount,
      '{{TOTAL_STARS}}': totalStars,
      '{{TOTAL_COMMITS}}': contrib.totalCommitContributions,
      '{{TOTAL_PRS}}': contrib.totalPullRequestContributions,
      '{{TOTAL_ISSUES}}': contrib.totalIssueContributions,
      '{{TOTAL_CONTRIBUTIONS}}': calendar.totalContributions,
      '{{CURRENT_STREAK}}': currentStreak,
      '{{LONGEST_STREAK}}': longestStreak,
      '{{FOLLOWERS}}': user.followers.totalCount,
      '{{FOLLOWING}}': user.following.totalCount,
      '{{TOP_LANGUAGES}}': langBars,
      '{{CONTRIB_TARGET}}': contributionTarget,
      '{{CONTRIB_PROGRESS}}': `${(clamp(contributionProgress, 0, 1) * 100).toFixed(1)}%`,
      '{{STREAK_PROGRESS}}': `${(clamp(streakProgress, 0, 1) * 100).toFixed(1)}%`,
      '{{LAST_UPDATED}}': new Date().toUTCString()
    };
    
    for (const [placeholder, value] of Object.entries(replacements)) {
      readme = readme.replace(new RegExp(placeholder, 'g'), value);
    }
    
    fs.writeFileSync('README.md', readme);
    console.log('README.md updated successfully!');
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
