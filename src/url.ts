import * as dotenv from 'dotenv';
import axios from 'axios';
import * as responsive from './metrics/responsiveness';
import logger from './logger';  // Import the logger
import { get } from 'http';

dotenv.config();

interface RepoContent {
    name: string;
    url: string;
}

interface ReadmeContent {
    content: string;
}

interface NpmPackageInfo {
    repository?: {
        url?: string;
    };
}

interface Comment {
    created_at: string;
}

export enum UrlType {
    GitHub,
    NPM,
    Other
}

export function getToken(): string {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
        logger.error('GITHUB_TOKEN is not set in .env file');
    }
    return githubToken as string;
}

export function test_API(): void {
    const githubToken = getToken();
    const OWNER = 'nikivakil';
    const REPO = '461-team';
    
    const getPullRequestCount = async() => {
        try {
            const response = await axios.get(`https://api.github.com/repos/${OWNER}/${REPO}/pulls?state=all`, {
                headers: {
                    Authorization: `token ${githubToken}`
                }
            });
            logger.info(`Number of pull requests: ${response.data.length}`, { owner: OWNER, repo: REPO });
        } catch (error) {
            logger.error('Error fetching pull requests', { error: (error as Error).message, owner: OWNER, repo: REPO });
        }
    }
    getPullRequestCount();
}

export async function getOpenPRs(owner: string, repo: string, headers: any): Promise<number> {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open`;
    logger.debug('Fetching open PRs', { owner, repo });
    const response = await axios.get(apiUrl, { headers });
    logger.debug('Open PRs fetched', { count: response.data.length, owner, repo });
    return response.data.length;
}

export async function getClosedPRs(owner: string, repo: string, headers: any): Promise<number> {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/pulls?state=closed`;
    logger.debug('Fetching closed PRs', { owner, repo });
    const response = await axios.get(apiUrl, { headers });
    logger.debug('Closed PRs fetched', { count: response.data.length, owner, repo });
    return response.data.length;
}

export function classifyURL(url: string): UrlType {
    logger.debug('Classifying URL', { url });
    if (url.includes('github.com')) {
        return UrlType.GitHub;
    } else if (url.includes('npmjs.com') || url.startsWith('npm:')) {
        return UrlType.NPM;
    } else {
        return UrlType.Other;
    }
}

export function extractNpmPackageName(url: string): string | null {
    logger.debug('Extracting NPM package name', { url });
    const match = url.match(/npmjs\.com\/package\/([^/]+)/);
    return match ? match[1] : null;
}

export async function getNpmPackageGitHubUrl(packageName: string): Promise<string | null> {
    logger.debug('Fetching GitHub URL for NPM package', { packageName });
    try {
        const response = await axios.get<NpmPackageInfo>(`https://registry.npmjs.org/${packageName}`);
        const repoUrl = response.data.repository?.url;
        
        if (repoUrl) {
            let cleanUrl = repoUrl.replace(/^git\+/, '').replace(/\.git$/, '');
            if (cleanUrl.startsWith('git://')) {
                cleanUrl = 'https://' + cleanUrl.slice(6);
            }
            logger.debug('GitHub URL fetched for NPM package', { packageName, cleanUrl });
            return cleanUrl;
        }
        logger.warn('No GitHub URL found for NPM package', { packageName });
        return null;
    } catch (error) {
        logger.error('Error fetching NPM package info', { packageName, error: (error as Error).message });
        return null;
    }
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } {
    logger.debug('Parsing GitHub URL', { url });
    const match = url.match(/github.com\/([^/]+)\/([^/]+)/);
    return match ? { owner: match[1], repo: match[2] } : { owner: '', repo: '' };
}

export function get_axios_params(url: string, token: string): {owner: string, repo: string, headers: any} {
    const {owner, repo} = parseGitHubUrl(url);
    const headers = {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json'
    };
    logger.debug('Generated axios parameters', { owner, repo });
    return {owner, repo, headers};
}

export async function getReadmeContent(owner: string, repo: string): Promise<string> {
    logger.info('Fetching README content', { owner, repo });
    const token = getToken();
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents`;

    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    };

    try {
        const response = await axios.get<RepoContent[]>(apiUrl, { headers });
        const readmeFile = response.data.find(file => file.name.toLowerCase().startsWith('readme'));
        if (!readmeFile) {
            logger.warn('README file not found', { owner, repo });
            throw new Error('README file not found');
        }

        const readmeResponse = await axios.get<ReadmeContent>(readmeFile.url, { headers });
        const decodedContent = Buffer.from(readmeResponse.data.content, 'base64').toString('utf-8');
        logger.debug('README content fetched successfully', { owner, repo, contentLength: decodedContent.length });
        return decodedContent;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            logger.error('API request failed', { owner, repo, status: error.response?.status, statusText: error.response?.statusText });
            throw new Error(`API request failed: ${error.response?.status} ${error.response?.statusText}`);
        }
        logger.error('Error fetching README content', { owner, repo, error: (error as Error).message });
        throw error;
    }
}

export function test_getReadmeContent(): void {
    const OWNER = 'nikivakil';
    const REPO = '461-team';

    getReadmeContent(OWNER, REPO)
        .then(readmeContent => logger.info('README content fetched', { owner: OWNER, repo: REPO, contentLength: readmeContent.length }))
        .catch(error => logger.error('Error fetching README content', { owner: OWNER, repo: REPO, error: error.message }));
}

export async function get_avg_ClosureTime(owner: string, repo: string, headers: any) {
    logger.debug('Calculating average closure time', { owner, repo });
    try {
        const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/issues?state=closed`, { headers });
        
        let totalClosureTime = 0;
        let totalIssues = 0;
        for (const issue of response.data) {
            if (issue.state === 'closed') {
                totalClosureTime += responsive.getTimeDifferenceInHours(issue.created_at, issue.closed_at);
                totalIssues++;
            }
        }
        if (totalIssues === 0) {
            logger.warn('No closed issues found', { owner, repo });
            return 0;
        }
        const avgClosureTime = totalClosureTime / totalIssues;
        logger.debug('Average closure time calculated', { owner, repo, avgClosureTime });
        return avgClosureTime;
    } catch (error) {
        logger.error('Error calculating average closure time', { owner, repo, error: (error as Error).message });
    }
}

export async function getComments(owner: string, repo: string, number: number, headers: any): Promise<Comment[]> {
    logger.debug('Fetching comments', { owner, repo, prNumber: number });
    try {
        const response = await axios.get<Comment[]>(`https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`, { headers });
        logger.debug('Comments fetched', { owner, repo, prNumber: number, commentCount: response.data.length });
        return response.data;
    } catch (error) {
        logger.error('Error fetching comments', { owner, repo, prNumber: number, error: (error as Error).message });
        return [];
    }
}

export async function get_avg_Responsetime(owner: string, repo: string, headers: any) {
    logger.debug('Calculating average response time', { owner, repo });
    try {
        const Pulls = await axios.get(`https://api.github.com/repos/${owner}/${repo}/pulls?state=all`, { headers });
        let total_Pulls = 0;
        let total = 0;

        for (const pull of Pulls.data) {
            const PR_number = pull.number;
            const comments = await getComments(owner, repo, PR_number, headers);
            if (comments.length == 0) {
                total_Pulls++;
                continue;
            } else if (comments.length == 1) {
                total += responsive.getTimeDifferenceInHours(pull.created_at, comments[0].created_at);
            } else {
                comments.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                total += responsive.getTimeDifferenceInHours(pull.created_at, comments[0].created_at);
            }
            total_Pulls++;
        }
        if (total_Pulls == 0) {
            logger.warn('No pull requests found', { owner, repo });
            return 0;
        }
        const avgResponseTime = total / total_Pulls;
        logger.debug('Average response time calculated', { owner, repo, avgResponseTime });
        return avgResponseTime;
    } catch (error) {
        logger.error('Error calculating average response time', { owner, repo, error: (error as Error).message });
    }
}

export async function getIssues(owner: string, repo: string) {
    logger.debug('Fetching all issues', { owner, repo });
    const token = getToken();
    const { headers } = get_axios_params(`https://github.com/${owner}/${repo}`, token);
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=all`;

    try {
        const response = await axios.get(apiUrl, { headers });
        logger.debug('Issues fetched', { owner, repo, issueCount: response.data.length });
        return response.data;
    } catch (error) {
        logger.error('Error fetching issues', { owner, repo, error: (error as Error).message });
        throw error;
    }
}

export async function getOpenIssues(owner: string, repo: string, headers: any): Promise<number> {
    logger.debug('Fetching open issues', { owner, repo });
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=open`;
    const response = await axios.get(apiUrl, { headers });
    logger.debug('Open issues fetched', { owner, repo, count: response.data.length });
    return response.data.length;
}

export async function getClosedIssues(owner: string, repo: string, headers: any): Promise<number> {
    logger.debug('Fetching closed issues', { owner, repo });
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues?state=closed`;
    const response = await axios.get(apiUrl, { headers });
    logger.debug('Closed issues fetched', { owner, repo, count: response.data.length });
    return response.data.length;
}

export async function getCommitsAndContributors(owner: string, repo: string, headers: any) {
    logger.debug('Fetching commits and contributors', { owner, repo });
    const commitsUrl = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100`;
    const contributorsUrl = `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=100`;
  
    try {
        const [commitsResponse, contributorsResponse] = await Promise.all([
            axios.get(commitsUrl, { headers }),
            axios.get(contributorsUrl, { headers })
        ]);
  
        logger.debug('Commits and contributors fetched', { 
            owner, 
            repo, 
            commitCount: commitsResponse.data.length, 
            contributorCount: contributorsResponse.data.length 
        });
        return {
            commits: commitsResponse.data,
            contributors: contributorsResponse.data
        };
    } catch (error) {
        logger.error('Error fetching commits and contributors', { owner, repo, error: (error as Error).message });
        return { commits: [], contributors: [] };
    }
}

export async function getCodeReviewLines(owner: string, repo: string, headers: any) {
    logger.debug('Calculating number of lines that were code reviewed', { owner, repo });
    try {
        const Pulls = await axios.get(`https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100`, { headers });
        let totalLinesAdded = 0;
        let reviewedLinesAdded = 0;
        
        if(Pulls.data.length == 0) {
            logger.warn('No pull requests found', { owner, repo });
            return 0;
        }
        
        for (const pull of Pulls.data) {
            const prData = await axios.get(`https://api.github.com/repos/${owner}/${repo}/pulls/${pull.number}`, { headers });
            totalLinesAdded += prData.data.additions;

            const reviewsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${pull.number}/reviews`;
            const reviews = await axios.get(reviewsUrl, {headers});

            if (reviews.data.length > 0) {
                // If the PR has reviews, add its additions to the reviewed lines count
                reviewedLinesAdded += prData.data.additions;
            }
        }
        if (totalLinesAdded == 0) {
            logger.warn('No lines added found', { owner, repo });
            return 0;
        }
        if (reviewedLinesAdded == 0) {
            logger.warn('No lines reviewed found', { owner, repo });
            return 0;
        }
        const ratioReviewedLinesAdded = (reviewedLinesAdded / totalLinesAdded);
        logger.debug('Calculated values for lines that were code reviewed', { owner, repo, reviewedLinesAdded, totalLinesAdded, ratioReviewedLinesAdded });
        return ratioReviewedLinesAdded;
    } catch (error) {
        logger.error('Error calculating number of lines added through code reviews', { owner, repo, error: (error as Error).message });
    }
}