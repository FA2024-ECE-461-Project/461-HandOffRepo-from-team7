import axios from 'axios';
import logger from '../logger'; // Adjust the import path accordingly
import { get_axios_params, getToken } from '../url'; // Adjust the import path accordingly
import semver from 'semver';

interface DependencyResult {
  score: number;
  latency: number;
}

/**
 * Determines if a version string is pinned to at least a major and minor version.
 * @param version The version string from package.json.
 * @returns True if the version is pinned, false otherwise.
 */
function isVersionPinned(version: string): boolean {
  try {
    const range = new semver.Range(version);
    const [semverSet] = range.set;

    // Check if the range is pinned to at least major and minor
    return semverSet.every((comparator) => {
      return (
        comparator.operator === '' &&
        comparator.semver.major !== null &&
        comparator.semver.minor !== null
      );
    });
  } catch (error) {
    logger.warn(`Invalid semver version: ${version}`, { error: (error as Error).message });
    return false;
  }
}

/**
 * Calculates the dependency pinning score.
 * @param dependencies An object containing dependency versions.
 * @returns The fraction of dependencies that are pinned. Returns 1.0 if there are no dependencies.
 */
function calculatePinningScore(dependencies: { [key: string]: string }): number {
  const totalDependencies = Object.keys(dependencies).length;
  if (totalDependencies === 0) {
    return 1.0;
  }

  const pinnedDependencies = Object.values(dependencies).filter(isVersionPinned).length;
  return pinnedDependencies / totalDependencies;
}

/**
 * Fetches the package.json from a GitHub repository and calculates the dependency pinning score.
 * @param owner The owner of the repository (user or organization).
 * @param repo The name of the repository.
 * @param headers Axios headers including authorization.
 * @returns The dependency pinning score as a number between 0 and 1, or null if failed.
 */
async function _getDependencyPinningFractionFromPackageJson(
  owner: string,
  repo: string,
  headers: any
): Promise<number | null> {
  try {
    const packageJsonUrl = `https://api.github.com/repos/${owner}/${repo}/contents/package.json`;
    const packageResponse = await axios.get(packageJsonUrl, { headers });

    // Decode package.json content from base64
    if (packageResponse.data.content) {
      const packageContent = Buffer.from(packageResponse.data.content, 'base64').toString('utf-8');
      const packageJson = JSON.parse(packageContent);

      // Combine all dependencies
      const allDependencies: { [key: string]: string } = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
        ...packageJson.optionalDependencies,
      };

      // Calculate pinning score
      const pinningScore = calculatePinningScore(allDependencies);
      return pinningScore;
    }

    logger.error(`package.json content not found for ${owner}/${repo}.`);
    return null;
  } catch (error: any) {
    logger.error(`Failed to fetch package.json for ${owner}/${repo}:`, error.message);
    return null;
  }
}

/**
 * Fetches the dependency pinning fraction from package.json of a GitHub repository.
 * @param url GitHub repository URL.
 * @returns The dependency pinning score as a MetricResult object containing score and latency.
 */
export async function getDependencyPinningFraction(url: string): Promise<DependencyResult> {
  const startTime = Date.now();
  logger.info('Starting Dependency Pinning calculation', { url });

  try {
    const token = getToken(); // Fetch token internally
    const { owner, repo, headers } = get_axios_params(url, token);
    const pinningScore = await _getDependencyPinningFractionFromPackageJson(owner, repo, headers);
    const latency = Date.now() - startTime;

    // Ensure pinningScore is a number
    const score = pinningScore ?? 0;

    logger.info('Dependency Pinning calculation complete', { url, score, latency });
    return { score, latency };
  } catch (error: any) {
    const latency = Date.now() - startTime;
    logger.error(`Error calculating Dependency Pinning for ${url}:`, error.message);
    return { score: 0, latency };
  }
}