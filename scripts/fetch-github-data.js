const fs = require('fs');
const https = require('https');
const path = require('path');

// Load environment variables if .env file exists
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
    try {
        const fileContent = fs.readFileSync(envPath, 'utf8');
        fileContent.split('\n').forEach(line => {
            const match = line.match(/^\s*([^=]+?)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                // Remove quotes
                if (value.length > 0 &&
                    (value.startsWith('"') && value.endsWith('"')) ||
                    (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                process.env[key] = value;
            }
        });
    } catch (error) {
        console.error('Error manually loading .env file', error);
    }
}

// Read config
const configPath = path.resolve(__dirname, '../config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
    console.error('Error reading config.json:', error);
    process.exit(1);
}

// Extract GitHub username from URL
const githubUrl = config.student?.github || '';
const username = githubUrl.split('/').pop() || 'example-user';

console.log(`Fetching data for user: ${username}`);

// Helper to extract owner and repo from URL
function getRepoDetails(url) {
    if (!url) return null;
    try {
        const urlObj = new URL(url);
        const path = urlObj.pathname.replace(/^\/|\/$/g, '');
        const parts = path.split('/');
        if (parts.length >= 2) {
            return { owner: parts[0], repo: parts[1] };
        }
    } catch (e) {
        console.error("Invalid repo URL", e);
    }
    return null;
}

// Function to make GitHub API request
function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: path,
            headers: {
                'User-Agent': 'GSoC-Dashboard',
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        // Add Authorization header solely if token is present
        if (process.env.GITHUB_TOKEN) {
            options.headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
        }

        https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode !== 200) {
                        // Handle 404 or other errors gracefully for individual requests
                        if (res.statusCode === 404) {
                            resolve({ data: null, headers: res.headers });
                            return;
                        }
                        // Handle rate limit specifically
                        if (res.statusCode === 403 && res.headers['x-ratelimit-remaining'] === '0') {
                            reject(new Error(`API Rate Limit Exceeded. Please provide a GITHUB_TOKEN to increase limits.`));
                            return;
                        }
                        // Handle Bad Credentials specifically
                        if (res.statusCode === 401) {
                            reject(new Error(`Authentication Failed (401). Your GITHUB_TOKEN is invalid or expired.`));
                            return;
                        }
                        reject(new Error(`Request failed with status code ${res.statusCode}: ${path}`));
                        return;
                    }
                    resolve({ data: JSON.parse(data), headers: res.headers });
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

// Main function
async function fetchData() {
    // Check if token is a placeholder or empty
    if (process.env.GITHUB_TOKEN &&
        (process.env.GITHUB_TOKEN === 'your_github_token_here' ||
            process.env.GITHUB_TOKEN === 'your_token' ||
            process.env.GITHUB_TOKEN.trim() === '')) {
        console.warn('WARNING: GITHUB_TOKEN appears to be a placeholder or empty. Ignoring it.');
        delete process.env.GITHUB_TOKEN;
    }

    if (!process.env.GITHUB_TOKEN) {
        console.warn('WARNING: GITHUB_TOKEN environment variable is not set.');
        console.warn('Running in unauthenticated mode. Rate limits will be lower (60 requests/hour).');
        console.warn('To increase limits, create a .env file with GITHUB_TOKEN=your_token.');
    }

    try {
        // Normalize repositories list
        let repositories = [];
        if (config.project.repositories && Array.isArray(config.project.repositories)) {
            repositories = config.project.repositories;
        } else if (config.project.repository) {
            repositories = [config.project.repository];
        }

        if (repositories.length === 0 || !username) {
            console.warn("Repositories list or student GitHub URL missing/invalid in config.");
            return;
        }

        console.log(`Processing ${repositories.length} repositories...`);

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
        const dateStr = sixMonthsAgo.toISOString().split('T')[0]; // YYYY-MM-DD

        let totalStats = { commits: 0, pullRequests: 0, issues: 0, reviews: 0 };
        let allContributions = [];

        // Process all repositories in parallel
        const promises = repositories.map(async (repoUrl) => {
            const repoDetails = getRepoDetails(repoUrl);
            if (!repoDetails) return;

            const { owner, repo } = repoDetails;
            console.log(`Fetching data for ${owner}/${repo}...`);

            try {
                // Fetch Pull Requests (Only merged)
                const prQuery = `repo:${owner}/${repo} is:pr is:merged author:${username} created:>${dateStr}`;
                const prRes = await makeRequest(`/search/issues?q=${encodeURIComponent(prQuery)}`);
                const prCount = prRes.data?.total_count || 0;

                // Fetch Issues
                const issueQuery = `repo:${owner}/${repo} is:issue author:${username} created:>${dateStr}`;
                const issueRes = await makeRequest(`/search/issues?q=${encodeURIComponent(issueQuery)}`);
                const issueCount = issueRes.data?.total_count || 0;

                // Fetch Reviews (Exclude own PRs)
                const reviewQuery = `repo:${owner}/${repo} is:pr reviewed-by:${username} -author:${username} created:>${dateStr}`;
                const reviewRes = await makeRequest(`/search/issues?q=${encodeURIComponent(reviewQuery)}`);
                const reviewCount = reviewRes.data?.total_count || 0;

                // Fetch Commits - Use Link Header Strategy for Total Count
                let commitCount = 0;
                // Fetch per_page=1 to get the Link header to find total pages
                const commitsPath = `/repos/${owner}/${repo}/commits?author=${username}&since=${sixMonthsAgo.toISOString()}&per_page=1`;
                const commitsRes = await makeRequest(commitsPath);

                const linkHeader = commitsRes.headers['link'];
                if (linkHeader) {
                    const match = linkHeader.match(/&page=(\d+)>; rel="last"/);
                    if (match) {
                        commitCount = parseInt(match[1], 10);
                    } else if (commitsRes.data && Array.isArray(commitsRes.data)) {
                        // If link header exists but no rel="last", fallback to length if possible
                        commitCount = 1;
                    }
                } else {
                    // No link header means results fit in one page (which is size 1 here)
                    if (commitsRes.data && Array.isArray(commitsRes.data)) {
                        commitCount = commitsRes.data.length;
                    }
                }

                // Note: We only utilize PRs and Issues for the detailed contribution list to maintain a clean UI.
                // However, we still fetch commit counts to ensure the "Total Commits" stat is accurate.

                // Collect contributions (from PRs only)
                if (prRes.data?.items && prRes.data.items.length > 0) {
                    const recentPRs = prRes.data.items.slice(0, 5).map(item => ({
                        title: item.title,
                        description: `Pull Request #${item.number} in ${owner}/${repo}`,
                        date: item.created_at,
                        url: item.html_url,
                        timestamp: new Date(item.created_at).getTime()
                    }));
                    allContributions.push(...recentPRs);
                }

                // Update totals
                totalStats.commits += commitCount;
                totalStats.pullRequests += prCount;
                totalStats.issues += issueCount;
                totalStats.reviews += reviewCount;

            } catch (error) {
                console.error(`Error processing ${owner}/${repo}:`, error.message);
            }
        });

        await Promise.all(promises);

        // Sort contributions by date desc and limit
        allContributions.sort((a, b) => b.timestamp - a.timestamp);
        const limitedContributions = allContributions.slice(0, 20);

        // Remove timestamp user for sorting
        const finalContributions = limitedContributions.map(({ timestamp, ...rest }) => rest);

        const output = {
            stats: totalStats,
            contributions: finalContributions,
            lastUpdated: new Date().toISOString()
        };

        // Ensure data directory exists
        const dataDir = path.resolve(__dirname, '../data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir);
        }

        const outputPath = path.join(dataDir, 'github-contributions.json');
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
        console.log('GitHub data updated successfully!');
        console.log(`Saved to: ${outputPath}`);
        console.log('Stats:', totalStats);

    } catch (error) {
        console.error('Error fetching GitHub data:', error.message || error);
        process.exit(1);
    }
}

fetchData();
