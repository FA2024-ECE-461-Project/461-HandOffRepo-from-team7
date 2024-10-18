#!/usr/bin/env ts-node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { getReadmeContent, parseGitHubUrl, classifyURL, UrlType, extractNpmPackageName, getNpmPackageGitHubUrl } from './url';
import {get_bus_factor} from './metrics/bus-factor';
import {getCorrectnessMetric} from './metrics/correctness';
import { get_license_compatibility } from './metrics/license-compatibility';
import { get_ramp_up_time_metric } from './metrics/ramp-up-time';
import { calculateResponsiveness } from './metrics/responsiveness';
import { calculatePRCodeReviews } from './metrics/PRCodeReviews';
import { getDependencyPinningFraction } from './metrics/dependency'; // Adjust the path accordingly
import logger from './logger';
import { promisify } from 'util';


interface MetricsResult {
  URL: string;
  NetScore: number;
  NetScore_Latency: number;
  RampUp: number;
  RampUp_Latency: number;
  Correctness: number;
  Correctness_Latency: number;
  BusFactor: number;
  BusFactor_Latency: number;
  ResponsiveMaintainer: number;
  ResponsiveMaintainer_Latency: number;
  License: number;
  License_Latency: number;
  PR_Code_Reviews: number;
  PR_Code_Reviews_Latency: number;
  DependencyMetric: number;
  DependencyMetric_Latency: number;
}

async function cloneRepository(url: string, dir: string): Promise<void> {
  if (fs.existsSync(path.join(dir, '.git'))) {
    logger.debug(`Repository already exists, skipping clone: ${url}`);
    return;
  }

  try {
    logger.info(`Cloning repository: ${url}`);
    await git.clone({
      fs,
      http,
      dir,
      url,
      singleBranch: true,
      depth: 1
    });
    logger.info(`Repository cloned successfully: ${url}`);
  } catch (error) {
    logger.error(`Error cloning repository ${url}:`, { error });
    throw error;
  }
}

async function processUrl(url: string): Promise<MetricsResult> {
  const urlType = classifyURL(url);
  let githubUrl = '';

  switch (urlType) {
    case UrlType.GitHub:
      githubUrl = url;
      break;
    case UrlType.NPM:
      const packageName = extractNpmPackageName(url);
      if (packageName) {
        const extractedGithubUrl = await getNpmPackageGitHubUrl(packageName);
        if (extractedGithubUrl) {
          githubUrl = extractedGithubUrl;
          logger.info(`NPM package ${url} converted to GitHub URL: ${githubUrl}`);
        } else {
          logger.error(`Unable to extract GitHub URL for NPM package: ${url}`);
          return createEmptyMetricsResult(url);
        }
      } else {
        logger.error(`Invalid NPM package URL: ${url}`);
        return createEmptyMetricsResult(url);
      }
      break;
    case UrlType.Other:
      logger.error(`Unsupported URL type: ${url}`);
      return createEmptyMetricsResult(url);
  }

  const repoInfo = parseGitHubUrl(githubUrl);
  if (repoInfo) {
    try {
      const cloneDir = path.join(process.cwd(), 'cloned_repos', `${repoInfo.owner}_${repoInfo.repo}`);
      await cloneRepository(githubUrl, cloneDir);
      return getMetrics(githubUrl, cloneDir);
    } catch (error) {
      logger.error(`Error processing ${githubUrl}:`, { error });
      return createEmptyMetricsResult(url);
    }
  } else {
    logger.error(`Invalid GitHub URL: ${githubUrl}`);
    return createEmptyMetricsResult(url);
  }
}


async function getMetrics(url: string, cloneDir: string): Promise<MetricsResult> {
  try {
    const startTime = Date.now();
    
    const [
      correctnessResult,
      busFactorResult,
      licenseCompatibility,
      rampUpTime,
      responsivenessResult,
      PRCodeReviewsResult,
      DependencyResult
    ] = await Promise.all([
      getCorrectnessMetric(url),
      get_bus_factor(url),
      get_license_compatibility(cloneDir),
      get_ramp_up_time_metric(url),
      calculateResponsiveness(url),
      calculatePRCodeReviews(url),
      getDependencyPinningFraction(url)
    ]);

    const endTime = Date.now();
    const totalLatency = endTime - startTime;

    const netScore = calculateNetScore(
      correctnessResult.score,
      busFactorResult.normalizedScore,
      licenseCompatibility.score,
      rampUpTime.score,
      responsivenessResult.score,
      PRCodeReviewsResult.score,
      DependencyResult.score
    );

    logger.info('Metrics calculated', { 
      url, 
      netScore, 
      totalLatency,
      correctness: correctnessResult.score,
      busFactor: busFactorResult.normalizedScore,
      license: licenseCompatibility.score,
      rampUp: rampUpTime.score,
      responsiveness: responsivenessResult.score,
      PRCodeReviewsResult: PRCodeReviewsResult.score,
      Dependency: DependencyResult.score
    });

    return {
      URL: url,
      NetScore: netScore,
      NetScore_Latency: totalLatency,
      RampUp: rampUpTime.score,
      RampUp_Latency: rampUpTime.latency,
      Correctness: correctnessResult.score,
      Correctness_Latency: correctnessResult.latency,
      BusFactor: busFactorResult.normalizedScore,
      BusFactor_Latency: busFactorResult.latency,  // Now using the latency from busFactorResult
      ResponsiveMaintainer: responsivenessResult.score,
      ResponsiveMaintainer_Latency: responsivenessResult.latency,
      License: licenseCompatibility.score,
      License_Latency: licenseCompatibility.latency,
      PR_Code_Reviews: PRCodeReviewsResult.score,
      PR_Code_Reviews_Latency: PRCodeReviewsResult.latency,
      DependencyMetric: DependencyResult.score,
      DependencyMetric_Latency: DependencyResult.latency
    };
  } catch (error) {
    logger.error(`Error calculating metrics for ${url}:`, error);
    return createEmptyMetricsResult(url);
  }
}
function calculateNetScore(correctness: number, busFactor: number, license: number, rampUp: number, responsiveness: number, prCodeReviews: number, dependency: number): number {
  const weights = {
    correctness: 0.2,
    busFactor: 0.2,
    responsiveness: 0.2,
    rampUp: 0.2,
    license: 0.1,
    prCodeReviews: 0.05,
    dependency: 0.05
  };

  return (
    correctness * weights.correctness +
    busFactor * weights.busFactor +
    responsiveness * weights.responsiveness +
    rampUp * weights.rampUp +
    license * weights.license + 
    prCodeReviews * weights.prCodeReviews +
    dependency * weights.dependency
  );
}

function createEmptyMetricsResult(url: string): MetricsResult {
  return {
    URL: url,
    NetScore: 0,
    NetScore_Latency: 0,
    RampUp: 0,
    RampUp_Latency: 0,
    Correctness: 0,
    Correctness_Latency: 0,
    BusFactor: 0,
    BusFactor_Latency: 0,
    ResponsiveMaintainer: 0,
    ResponsiveMaintainer_Latency: 0,
    License: 0,
    License_Latency: 0,
    PR_Code_Reviews: 0,
    PR_Code_Reviews_Latency: 0,
    DependencyMetric: 0,
    DependencyMetric_Latency: 0
  };
}


const program = new Command();

program
  .version('1.0.0')
  .description('ACME Module Trustworthiness CLI');
  program
program
  .argument('<file>', 'Process URLs from a file')
  .action(async (file: string) => {
    if (!process.env.LOG_FILE) {
      console.error('LOG_FILE environment variable is not set');
      process.exit(1);
    }

    if (!process.env.GITHUB_TOKEN) {
      console.error('GITHUB_TOKEN environment variable is not set');
      process.exit(1);
    }

    try {
      const absolutePath = path.resolve(file);
      const urls = fs.readFileSync(absolutePath, 'utf-8').split('\n').filter(url => url.trim() !== '');
      
      for (const url of urls) {
        try {
          const result = await processUrl(url);
          const formattedResult = {
            URL: result.URL,
            NetScore: parseFloat(result.NetScore.toFixed(3)),
            NetScore_Latency: parseFloat((result.NetScore_Latency / 1000).toFixed(3)),
            RampUp: parseFloat(result.RampUp.toFixed(3)),
            RampUp_Latency: parseFloat((result.RampUp_Latency / 1000).toFixed(3)),
            Correctness: parseFloat(result.Correctness.toFixed(3)),
            Correctness_Latency: parseFloat((result.Correctness_Latency / 1000).toFixed(3)),
            BusFactor: parseFloat(result.BusFactor.toFixed(3)),
            BusFactor_Latency: parseFloat((result.BusFactor_Latency / 1000).toFixed(3)),
            ResponsiveMaintainer: parseFloat(result.ResponsiveMaintainer.toFixed(3)),
            ResponsiveMaintainer_Latency: parseFloat((result.ResponsiveMaintainer_Latency / 1000).toFixed(3)),
            License: parseFloat(result.License.toFixed(3)),
            License_Latency: parseFloat((result.License_Latency / 1000).toFixed(3)),
            PR_Code_Reviews: parseFloat(result.PR_Code_Reviews.toFixed(3)),
            PR_Code_Reviews_Latency: parseFloat((result.PR_Code_Reviews_Latency / 1000).toFixed(3)),
            DependencyMectric: parseFloat(result.DependencyMetric.toFixed(3)),
            DependencyNetric_Latency: parseFloat((result.DependencyMetric_Latency / 1000).toFixed(3))
          };
          console.log(JSON.stringify(formattedResult));
        } catch (error) {
          logger.error(`Error processing URL ${url}:`, { error });
          const emptyResult = {
            URL: url,
            NetScore: -1,
            NetScore_Latency: -1,
            RampUp: -1,
            RampUp_Latency: -1,
            Correctness: -1,
            Correctness_Latency: -1,
            BusFactor: -1,
            BusFactor_Latency: -1,
            ResponsiveMaintainer: -1,
            ResponsiveMaintainer_Latency: -1,
            License: -1,
            License_Latency: -1,
            PR_Code_Reviews: -1,
            PR_Code_Reviews_Latency: -1,
            DependencyMetric: -1,
            DependencyMetric_Latency: -1
          };
          console.log(JSON.stringify(emptyResult));
        }
      }
      
      process.exit(0);
    } catch (error) {
      logger.error('Error processing URL file:', { error });
      process.exit(1);
    }
  });

  program
  .command('test')
  .description('Run test suite')
  .action(() => {
    console.log('Running test suite...');

    const resultsFilePath = path.resolve(__dirname, '../jest-results.json');
    const coverageSummaryPath = path.resolve(__dirname, '../coverage/coverage-summary.json');

    const jestProcess = spawn('npx', [
      'jest',
      '--silent',
      '--coverage',
      '--json',
      `--outputFile=${resultsFilePath}`
    ]);

    jestProcess.on('close', () => {
      // Check for coverage summary file existence
      const checkFileExists = (filePath: string, retries: number = 5) => {
        if (fs.existsSync(filePath)) {
          return true;
        }
        if (retries > 0) {
          // Retry after a short delay
          setTimeout(() => checkFileExists(filePath, retries - 1), 1000);
        }
        return false;
      };

      if (!checkFileExists(coverageSummaryPath)) {
        console.error('Coverage summary file does not exist:', coverageSummaryPath);
        return;
      }

      try {
        const results = JSON.parse(fs.readFileSync(resultsFilePath, 'utf-8'));
        const coverageSummary = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf-8'));
      
        const lineCoverage = Math.round(coverageSummary.total.lines.pct);  // Round to nearest whole number
      
        console.log(`Total: ${results.numTotalTests}`);
        console.log(`Passed: ${results.numPassedTests}`);
        console.log(`Line Coverage: ${lineCoverage}%`);
        console.log(`${results.numPassedTests}/${results.numTotalTests} test cases passed. ${lineCoverage}% line coverage achieved.`);
      } catch (error) {
        console.error('Error reading Jest results or coverage summary:', error);
      } finally {
        if (fs.existsSync(resultsFilePath)) {
          fs.unlinkSync(resultsFilePath);
        }
      }
    });
  });



program.parse(process.argv);
