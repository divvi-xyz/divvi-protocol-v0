import yargs from 'yargs'
import { parseEther } from 'viem'
import { BigNumber } from 'bignumber.js'
import { createAddRewardSafeTransactionJSON } from '../utils/createSafeTransactionsBatch'
import { ResultDirectory } from '../../src/resultDirectory'
import { getReferrerMetricsFromKpi } from './getReferrerMetricsFromKpi'
import { getDivviRewardsExcludedReferrers } from '../utils/divviRewardsExcludedReferrers'

const REWARD_POOL_ADDRESS = '0xBBF7B15C819102B137A96703E63eCF1c3d57CC68'
const REWARD_AMOUNT_IN_DECIMALS = '15000'

export function calculateRewardsLiskV0({
  kpiData,
  excludedReferrers,
  maximumRewardAmount,
}: {
  kpiData: KpiRow[]
  excludedReferrers: Record<
    string,
    { referrerId: string; shouldWarn?: boolean }
  >
  maximumRewardAmount: BigNumber
}) {
  const totalRewardsForPeriod = new BigNumber(
    parseEther(REWARD_AMOUNT_IN_DECIMALS),
  )

  const { referrerReferrals, referrerKpis } = getReferrerMetricsFromKpi(kpiData)

  const kpiSum = Object.entries(referrerKpis).reduce(
    (sum, [referrerId, kpi]) => {
      if (referrerId.toLowerCase() in excludedReferrers) {
        if (excludedReferrers[referrerId.toLowerCase()].shouldWarn) {
          console.warn(
            `⚠️ Flagged address ${referrerId} is a referrer, they will be excluded from campaign rewards.`,
          )
        } else {
          console.log(
            `Excluded referrer ${referrerId} kpi's are ignored for reward calculations.`,
          )
        }
        return sum
      }
      return sum.plus(kpi)
    },
    BigNumber(0),
  )

  const referrerQueue = Object.entries(referrerKpis).sort((a, b) =>
    BigNumber(b[1]).minus(BigNumber(a[1])).toNumber(),
  )
  const rewards = []
  let rewardsRemaining = totalRewardsForPeriod
  let kpiSumRemaining = kpiSum

  for (const [referrerId, kpi] of referrerQueue) {
    const isExcludedReferrer = referrerId.toLowerCase() in excludedReferrers
    const proportion =
      isExcludedReferrer || kpiSumRemaining.isZero()
        ? BigNumber(0)
        : BigNumber(kpi).div(kpiSumRemaining)

    const rewardAmount = BigNumber.min(
      rewardsRemaining.times(proportion),
      maximumRewardAmount,
    )
    rewardsRemaining = rewardsRemaining.minus(rewardAmount)
    if (!isExcludedReferrer) {
      kpiSumRemaining = kpiSumRemaining.minus(kpi)
    }

    const rewardRow = {
      referrerId,
      rewardAmount: rewardAmount.toFixed(0, BigNumber.ROUND_DOWN),
      referralCount: referrerReferrals[referrerId],
      kpi,
    }

    rewards.push(rewardRow)
  }
  return rewards
}

function parseArgs() {
  const args = yargs
    .option('datadir', {
      description: 'the directory to store the results',
      type: 'string',
      default: 'rewards',
    })
    .option('start-timestamp', {
      alias: 's',
      description: 'start timestamp',
      type: 'string',
      demandOption: true,
    })
    .option('end-timestamp', {
      alias: 'e',
      description: 'end timestamp',
      type: 'string',
      demandOption: true,
    })
    .option('maximum-reward-proportion', {
      alias: 'm',
      description:
        'Maximum proportion of the reward amount any builder can earn (e.g., 0.2)',
      type: 'string',
      demandOption: true,
    })
    .strict()
    .parseSync()

  return {
    resultDirectory: new ResultDirectory({
      datadir: args.datadir,
      name: 'lisk-v0',
      startTimestamp: new Date(args['start-timestamp']),
      endTimestampExclusive: new Date(args['end-timestamp']),
    }),
    startTimestamp: args['start-timestamp'],
    endTimestampExclusive: args['end-timestamp'],
    maximumRewardProportion: new BigNumber(args['maximum-reward-proportion']),
  }
}

interface KpiRow {
  referrerId: string
  userAddress: string
  kpi: string
}

export async function main(args: ReturnType<typeof parseArgs>) {
  const startTimestamp = new Date(args.startTimestamp)
  const endTimestampExclusive = new Date(args.endTimestampExclusive)
  const resultDirectory = args.resultDirectory
  const kpiData = await resultDirectory.readKpi()

  const excludedReferrers = await getDivviRewardsExcludedReferrers()
  await resultDirectory.writeExcludeList(Object.values(excludedReferrers))

  const maximumRewardAmount = new BigNumber(
    parseEther(REWARD_AMOUNT_IN_DECIMALS),
  ).times(args.maximumRewardProportion)
  const rewards = calculateRewardsLiskV0({
    kpiData,
    excludedReferrers,
    maximumRewardAmount,
  })

  createAddRewardSafeTransactionJSON({
    filePath: resultDirectory.safeTransactionsFilePath,
    rewardPoolAddress: REWARD_POOL_ADDRESS,
    rewards,
    startTimestamp,
    endTimestampExclusive,
  })

  await resultDirectory.writeRewards(rewards)
}

// Only run main if this file is being executed directly
if (require.main === module) {
  main(parseArgs()).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
