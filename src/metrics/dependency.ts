import axios from "axios";

// Assuming parseGitHubUrl and logger are defined elsewhere in your project
import { parseGitHubUrl } from '../url'; // Adjust the import path accordingly
import logger from '../logger'; // Adjust the import path accordingly

/**
 * Generates Axios parameters including owner, repo, and headers.
 * @param url GitHub repository URL.
 * @param token GitHub Personal Access Token.
 * @returns An object containing owner, repo, and headers.
 */
export function get_axios_params(
  url: string,
  token: string
): { owner: string; repo: string; headers: any } {
  const { owner, repo } = parseGitHubUrl(url);
  const headers = {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github.v3+json",
  };
  logger.debug("Generated axios parameters", { owner, repo });
  return { owner, repo, headers };
}

/**
 * Determines if a version string is pinned to at least a major and minor version.
 * @param version The version string from package.json.
 * @returns True if the version is pinned, false otherwise.
 */
function isVersionPinned(version: string): boolean {
  // Regex to match versions like ^2.3.x, ~2.3.*, 2.3.4, 2.3.x, etc.
  const PINNED_VERSION_REGEX = /^(\^|~)?\d+\.\d+(\.\d+|\.\*|\.x)?$/;
  return PINNED_VERSION_REGEX.test(version.trim());
}

/**
 * Calculates the dependency pinning score.
 * @param dependencies An object containing dependency versions.
 * @returns The fraction of dependencies that are pinned. Returns 1.0 if there are no dependencies.
 */
function calculatePinningScore(dependencies: { [key: string]: string }): number {
  const dependencyNames = Object.keys(dependencies);
  const total = dependencyNames.length;

  if (total === 0) {
    return 1.0;
  }

  let pinnedCount = 0;

  dependencyNames.forEach((dep) => {
    const version = dependencies[dep];
    if (isVersionPinned(version)) {
      pinnedCount += 1;
    }
  });

  return pinnedCount / total;
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
    const packageResponse = await axios.get(packageJsonUrl, {
      headers: headers,
    });

    // Decode package.json content from base64
    if (packageResponse.data.content) {
      const packageContent = Buffer.from(
        packageResponse.data.content,
        "base64"
      ).toString("utf-8");
      const packageJson = JSON.parse(packageContent);

      // Combine all dependencies
      const allDependencies: { [key: string]: string } = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
        ...packageJson.optionalDependencies,
      };

      // Calculate pinning score
      const pinningScore: number = calculatePinningScore(allDependencies);

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
 * @param token GitHub Personal Access Token.
 * @returns The dependency pinning score as a number between 0 and 1, or null if failed.
 */
export async function getDependencyPinningFraction(
  url: string,
  token: string
): Promise<number | null> {
  try {
    const { owner, repo, headers } = get_axios_params(url, token);
    return await _getDependencyPinningFractionFromPackageJson(owner, repo, headers);
  } catch (error: any) {
    logger.error(`Error processing ${url}:`, error.message);
    return null;
  }
}