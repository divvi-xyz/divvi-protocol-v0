import yargs from 'yargs'
import { BigNumber } from 'bignumber.js'
import { createAddRewardSafeTransactionJSON } from '../utils/createSafeTransactionsBatch'
import { ResultDirectory } from '../../src/resultDirectory'
import { calculateSqrtProportionalPrizeContest } from '../../src/proportionalPrizeContest'
import { getDivviRewardsExcludedReferrers } from '../utils/divviRewardsExcludedReferrers'

const REWARD_POOL_ADDRESS = '0x0000000000000000000000000000000000000000' // on Morph mainnet (TODO: fill this in after ENG-527 is done)

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
    .option('reward-amount', {
      alias: 'r',
      description: 'the reward amount for this time period',
      type: 'string',
      demandOption: true,
    })
    .strict()
    .parseSync()

  return {
    resultDirectory: new ResultDirectory({
      datadir: args.datadir,
      name: 'morph',
      startTimestamp: new Date(args['start-timestamp']),
      endTimestampExclusive: new Date(args['end-timestamp']),
    }),
    startTimestamp: args['start-timestamp'],
    endTimestampExclusive: args['end-timestamp'],
    rewardAmount: args['reward-amount'],
  }
}

export async function main(args: ReturnType<typeof parseArgs>) {
  const startTimestamp = new Date(args.startTimestamp)
  const endTimestampExclusive = new Date(args.endTimestampExclusive)
  const resultDirectory = args.resultDirectory
  const rewardAmount = args.rewardAmount
  const kpiData = await resultDirectory.readKpi()

  const excludedReferrers = await getDivviRewardsExcludedReferrers()
  await resultDirectory.writeExcludeList(Object.values(excludedReferrers))

  const rewards = calculateSqrtProportionalPrizeContest({
    kpiData,
    rewards: new BigNumber(rewardAmount),
    excludedReferrers,
  })

  const totalTransactionsPerReferrer: {
    [referrerId: string]: number
  } = {}

  for (const { referrerId, kpi } of kpiData) {
    totalTransactionsPerReferrer[referrerId] =
      (totalTransactionsPerReferrer[referrerId] ?? 0) + Number(kpi) // kpi is the number of transactions
  }

  const rewardsWithMetadata = rewards.map((reward) => ({
    ...reward,
    totalTransactions: totalTransactionsPerReferrer[reward.referrerId],
  }))

  createAddRewardSafeTransactionJSON({
    filePath: resultDirectory.safeTransactionsFilePath,
    rewardPoolAddress: REWARD_POOL_ADDRESS,
    rewards,
    startTimestamp,
    endTimestampExclusive,
  })

  await resultDirectory.writeRewards(rewardsWithMetadata)
}

// Only run main if this file is being executed directly
if (require.main === module) {
  main(parseArgs()).catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
