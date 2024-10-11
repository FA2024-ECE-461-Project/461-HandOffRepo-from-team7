import logger from '../logger';  // Import the logger
import { getToken, get_axios_params, getCodeReviewLines } from '../url';

interface PRCodeReviewsResult {
  score: number;
  latency: number;
}

export async function calculatePRCodeReviews(url: string): Promise<PRCodeReviewsResult> {
    const startTime = Date.now();
    logger.info('Starting PR code reviews calculation', { url });

    try {
        const token = getToken();
        const { owner, repo, headers } = get_axios_params(url, token);
        logger.debug('Fetching closure and response times', { owner, repo });
        const ratioCodeReviewLines = await getCodeReviewLines(owner, repo, headers);
        let score = ratioCodeReviewLines ?? 0;
        const latency = Date.now() - startTime;
        logger.info('PR Code Reviews calculation complete', { url, score, latency });
        return { score, latency };
    } catch(error) {
        logger.error('Error calculating PR code reviews', { url, error: (error as Error).message });
        return { score: 0, latency: Date.now() - startTime };
    }
}
