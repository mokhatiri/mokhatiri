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
    
    // Generate language bars
    const langBars = topLangs.map(([lang, count]) => {
      const percentage = ((count / totalLangRepos) * 100).toFixed(1);
      return `${lang.padEnd(15)} ${generateProgressBar(parseFloat(percentage))} ${percentage}%`;
    }).join('\n');
    
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
